/**
 * Our Money — data relay + snapshot store + vote index (Cloudflare Worker) — v7
 * ----------------------------------------------------------------
 * WHAT'S NEW IN v7: our own INDEX of every Knesset plenum vote, 2003 → today.
 *   The Knesset API can only answer "which votes happened between two dates",
 *   so searching the whole history through it means ~165 requests from the
 *   browser. Instead we harvest every vote once into KV (~7 MB, one file per
 *   year) and search OUR copy: whole history, instantly, no date defaults.
 *   ONE-TIME: open build.html in your browser after deploying this file. It
 *   runs the harvest step by step (~2 minutes) and shows progress. The 6-hourly
 *   cron then keeps the current window fresh by itself.
 *   Endpoints: /build/votes (one harvest step) · /search/votes?q=… ·
 *              /data/votesmeta (what the index holds)
 *
 * Four jobs:
 *   1. RELAY — fetches Israeli government open data server-side and returns
 *      it with CORS headers (the browsers of your visitors can't reach the
 *      Knesset/court APIs directly).
 *   2. SNAPSHOT STORE — keeps a fresh copy of the site's core data in
 *      Cloudflare KV, so the site works even when a government server is
 *      down or overloaded. Served at /data/<name>.
 *   3. SCHEDULED REFRESH — a cron trigger re-fetches the snapshots a few
 *      times a day.
 *
 * ONE-TIME SETUP in the Cloudflare dashboard (after pasting this file):
 *   A. Storage & databases → KV → Create namespace → name: our-money-data
 *   B. Your worker → Settings → Bindings → Add → KV namespace →
 *      Variable name: DATA   → select "our-money-data" → Save → Deploy
 *   C. Your worker → Settings → Triggers → Cron Triggers → Add →
 *      cron expression:  0 *\/6 * * *      (every 6 hours) → Save
 *      (write it without the backslash — it's escaped here only because
 *       this text sits inside a code comment)
 *
 * Endpoints:
 *   GET  /build/votes[?reset=1&key=rebuild]    — one step of the index harvest
 *   GET  /search/votes?q=…[&qs=a|b][&from=&to=][&y0=&y1=][&limit=]
 *   GET  /data/votesmeta                       — index manifest (years, rows)
 *   GET  /data/<budget|votes|bills|verdicts>   — snapshot (auto-refreshes;
 *        serves the last good copy if the government source is down)
 *   GET/POST /?url=<encoded address>           — raw relay
 *   GET  /b64/<base64url>                      — raw relay, path form
 *   GET  /postb64/<base64url>?body=<base64url> — POST via GET (diagnostics)
 *   GET  /preset/<name>?params                 — named upstream queries
 *   any of the above + &wrap=1                 — wrap response for diagnostics
 *   any of the above + &head=1                 — status/type/size only, no body
 *   /preset/reports?sec=0020[&n=3000]          — which reports exist, one section
 */

const ALLOWED = (host) =>
  host === "knesset.gov.il" ||
  host.endsWith(".knesset.gov.il") ||
  host === "court.gov.il" ||
  host.endsWith(".court.gov.il") ||
  host === "next.obudget.org" ||
  host === "data.gov.il" ||
  // the ministries' quarterly procurement reports (.xlsx) live on these two.
  // BudgetKey ingests the same files but drops the payment column, so we read
  // them ourselves — see CLAUDE.md, "USE contract_spending, NOT contracts_data".
  host === "www.gov.il" ||
  host === "gov.il" ||
  host === "foi.gov.il";

const CACHE_SECONDS = 300;
/* only someone who knows this word can wipe the index and start the harvest
   over (?reset=1&key=…). Change it if you like — build.html asks for it. */
const BUILD_KEY = "rebuild";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
const UA = "Mozilla/5.0 (compatible; OurMoneyIL/1.0; civic transparency site)";

function fromB64url(s) {
  try { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); }
  catch { return null; }
}
const iso = (d) => d + "T00:00:00.000Z";
const day = (offsetDays) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const seg = (t, op) => [{ Text: t || "", textOperator: op, option: "2", Inverted: false, Synonym: false, NearDistance: 3, MatchOrder: false }];

/* digits only. These land inside SQL and the caller is the open internet. */
const digits = (s, fallback) => (String(s || "").replace(/\D/g, "") || fallback);

/* ---------- named upstream queries ---------- */
const PRESETS = {
  // Supreme Court verdicts published between p.from and p.to
  verdicts: (p) => ({
    url: "https://supremedecisions.court.gov.il/Home/SearchVerdicts",
    method: "POST",
    body: JSON.stringify({
      document: {
        Year: null, Month: null, CaseNum: null, Technical: null,
        fromPages: null, toPages: null,
        dateType: 1, PublishFrom: iso(p.from), PublishTo: iso(p.to), publishDate: 8,
        translationDateType: 1, translationPublishFrom: iso(p.from),
        translationPublishTo: iso(p.to), translationPublishDate: 8,
        SearchText: seg(p.q, 1), Judges: null, Parties: seg("", 2), Counsel: seg("", 2),
        Mador: null, CodeMador: [], TypeCourts: null, TypeCourts1: null,
        TerrestrialCourts: null, LastInyan: null, LastCourtsYear: null,
        LastCourtsMonth: null, LastCourtCaseNum: null, Old: false,
        JudgesOperator: 2, Judgment: null, Type: null, CodeTypes: [],
        CodeJudges: p.judge ? [Number(p.judge)] : [], Inyan: null, CodeInyan: [],
        AllSubjects: [{ Subject: null, SubSubject: null, SubSubSubject: null }],
        CodeSub2: [], Category1: null, Category3: null, CodeCategory3: [],
        OldMainNumFormat: false, Volume: null,
        Subjects: null, SubSubjects: null, SubSubSubjects: null,
      },
      lan: Number(p.lan || 1),
    }),
  }),
  /* Which procurement reports exist, for ONE budget section.
       /preset/reports?sec=0020

     The SQL lives here so the caller's address stays about sixty characters:
     Claude's fetch refuses a relay URL much past 248, and this query in the
     /b64/ form comes to 343.

     WHY sec= AND NOT ALL AT ONCE: the previous version of this preset asked
     for DISTINCT ON (publisher) across the whole table and it TIMES OUT —
     tested 2026-08-23, "Read timeout while fetching the URL". That table has
     roughly four million rows and sorting all of them to pick one per
     publisher is too much work for one request. Filtered to a section it is
     an index range and answers in seconds; the same query ran fine inside
     GitHub Actions. So: one call per section, 0001..0099.

     Returns one row per (url, publisher, year, period) — the caller decides
     what to keep. */
  reports: (p) => ({
    url: "https://next.obudget.org/api/query?num_rows=" + digits(p.n, "3000") +
      "&query=" + encodeURIComponent(
        'SELECT DISTINCT "report-url" AS url, publisher, ' +
        '"report-year" AS year, "report-period" AS period ' +
        "FROM quarterly_contract_spending_reports " +
        "WHERE budget_code LIKE '" + digits(p.sec, "0020") + "%' " +
        'AND "report-url" IS NOT NULL'),
  }),
  // Knesset plenum votes between p.from and p.to (current system)
  votes: (p) => ({
    url: "https://knesset.gov.il/WebSiteApi/knessetapi/Votes/GetVotesHeaders",
    method: "POST",
    body: JSON.stringify({ SearchType: Number(p.type || 1), FromDate: p.from, ToDate: p.to }),
  }),
};

/* ---------- upstream fetch (shared by relay + snapshots) ---------- */
async function upstream(url, method, body, cacheable) {
  // immutable content (past votes, bill documents/details) may be cached far
  // longer than the default — a vote from 2024 will never change
  const ttl = /GetVoteDetails|GetLegislationBillItem|KNS_DocumentBill|KNS_BillInitiator|Votes\.svc/.test(url)
    ? 86400 : CACHE_SECONDS;
  return fetch(url, {
    method: method || "GET",
    body: method === "POST" ? (body || "{}") : undefined,
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    cf: (method || "GET") === "GET" && cacheable !== false
      ? { cacheTtl: ttl, cacheEverything: true } : {},
  });
}
async function upstreamJson(url, method, body) {
  const res = await upstream(url, method, body, false);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("HTTP " + res.status + " from " + url);
  const j = await res.json();
  // BudgetKey failure mode: HTTP 200 with {"success":false,"error":"…"}
  if (j && (j.success === false)) throw new Error("upstream error: " + String(j.error).slice(0, 140));
  return j;
}

/* ---------- snapshot datasets ---------- */
const BK = (sql, n) => "https://next.obudget.org/api/query?query=" + encodeURIComponent(sql) + (n ? "&num_rows=" + n : "");
const PARL = "https://knesset.gov.il/Odata/ParliamentInfo.svc/";
const odRows = (j) => (j && (j.value || (j.d && (j.d.results || j.d)))) || [];

const DATASETS = {
  budget: {
    ttlHours: 12,
    async build() {
      const yearsJ = await upstreamJson(BK("SELECT DISTINCT year FROM raw_budget ORDER BY year DESC", 60));
      const years = (yearsJ.rows || []).map(r => r.year).filter(y => y >= 2000);
      const year = years[0];
      const secsJ = await upstreamJson(BK(
        `SELECT code, title, net_allocated, net_revised, net_executed FROM raw_budget ` +
        `WHERE year = ${year} AND length(code) = 4 ` +
        `ORDER BY COALESCE(net_revised, net_allocated) DESC NULLS LAST`, 200));
      let total = null;
      try {
        const totJ = await upstreamJson(BK(
          `SELECT title, net_allocated, net_revised, net_executed FROM raw_budget WHERE year = ${year} AND code = '00'`, 2));
        total = (totJ.rows || [])[0] || null;
      } catch (e) { /* sections-sum fallback happens client-side */ }
      return { year, years, sections: secsJ.rows || [], total };
    },
  },
  votes: {
    ttlHours: 6,
    async build() {
      const p = PRESETS.votes({ from: day(-120), to: day(0) });
      const j = await upstreamJson(p.url, "POST", p.body);
      return { rows: (j && (Array.isArray(j) ? j : j.Table)) || [] };
    },
  },
  bills: {
    ttlHours: 6,
    async build() {
      const sts = odRows(await upstreamJson(PARL + "KNS_Status()?$top=200&$format=json"));
      const bills = odRows(await upstreamJson(PARL + "KNS_Bill()?$orderby=LastUpdatedDate desc&$top=15&$format=json"));
      return { statuses: sts, bills };
    },
  },
  verdicts: {
    ttlHours: 6,
    async build() {
      const p = PRESETS.verdicts({ from: day(-90), to: day(1) });
      const j = await upstreamJson(p.url, "POST", p.body);
      return { data: (j && j.data) || [] };
    },
  },
  // the persons directory: PersonID → full name (changes rarely; lets pages
  // resolve bill initiators without the slow GetLegislationBillItem call)
  persons: {
    ttlHours: 72,
    async build() {
      const map = {};
      for (let skip = 0; skip < 4500; skip += 100) {
        const j = await upstreamJson(PARL +
          "KNS_Person()?$select=PersonID,FirstName,LastName&$skip=" + skip + "&$top=100&$format=json");
        const rows = odRows(j);
        rows.forEach(p => { map[p.PersonID] = ((p.FirstName || "") + " " + (p.LastName || "")).trim(); });
        if (rows.length < 100) break;
      }
      return map;
    },
  },
};

async function refreshDataset(name, env) {
  const data = await DATASETS[name].build();
  const entry = { t: Date.now(), data };
  await env.DATA.put("ds:" + name, JSON.stringify(entry));
  return entry;
}

async function serveDataset(name, env) {
  const ds = DATASETS[name];
  if (!ds) return new Response("Unknown dataset", { status: 404, headers: CORS });
  if (!env.DATA)
    return new Response(JSON.stringify({ error: "KV binding DATA is missing — see setup step B in worker.js" }),
      { status: 501, headers: { ...CORS, "Content-Type": "application/json" } });

  let entry = null;
  try { entry = JSON.parse(await env.DATA.get("ds:" + name)); } catch (e) { entry = null; }
  const fresh = entry && (Date.now() - entry.t) < ds.ttlHours * 3600e3;

  if (!fresh) {
    try { entry = await refreshDataset(name, env); }
    catch (e) {
      if (!entry)
        return new Response(JSON.stringify({ error: "snapshot build failed: " + e.message }),
          { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      /* upstream down → serve the last good copy (the whole point) */
    }
  }
  return new Response(JSON.stringify({ t: entry.t, stale: (Date.now() - entry.t) >= ds.ttlHours * 3600e3, ...{ data: entry.data } }),
    { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
}

/* who proposed a bill + its official documents — fetched once, kept forever */
async function serveBillInfo(id, env) {
  const headers = { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" };
  if (!id) return new Response('{"error":"bad id"}', { status: 400, headers });
  if (!env.DATA) return new Response('{"error":"KV binding DATA missing"}', { status: 501, headers });

  const key = "bi:" + id;
  const cached = await env.DATA.get(key);
  if (cached) return new Response(cached, { headers });

  const [initsJ, docsJ, billJ] = await Promise.all([
    upstreamJson(PARL + `KNS_BillInitiator()?$filter=BillID eq ${id}&$top=60&$format=json`).catch(() => null),
    upstreamJson(PARL + `KNS_DocumentBill()?$filter=BillID eq ${id}&$top=40&$format=json`).catch(() => null),
    upstreamJson(PARL + `KNS_Bill()?$filter=BillID eq ${id}&$select=SubTypeDesc&$top=1&$format=json`).catch(() => null),
  ]);
  const initRows = odRows(initsJ).sort((a, b) =>
    ((b.IsInitiator ? 1 : 0) - (a.IsInitiator ? 1 : 0)) || ((a.Ordinal || 99) - (b.Ordinal || 99)));

  // resolve names from the persons snapshot; fall back to the heavy endpoint once
  let names = [];
  try {
    const p = JSON.parse(await env.DATA.get("ds:persons") || "null");
    const map = (p && p.data) || {};
    names = initRows.map(r => map[r.PersonID]).filter(Boolean);
  } catch (e) { /* no persons snapshot yet */ }
  if (initRows.length && !names.length) {
    try {
      const item = await upstreamJson("https://knesset.gov.il/WebSiteApi/knessetapi/LegislationItem/GetLegislationBillItem?ItemId=" + id);
      const s = (((item || {}).general || {}).Initiators || "").trim();
      if (s) names = [s];
    } catch (e) { /* leave empty */ }
  }

  const seen = {};
  const docs = odRows(docsJ)
    .filter(d => d.ApplicationDesc === "PDF" && d.FilePath)
    .filter(d => seen[d.GroupTypeDesc] ? false : (seen[d.GroupTypeDesc] = true))
    .slice(0, 6)
    .map(d => ({ GroupTypeDesc: d.GroupTypeDesc, ApplicationDesc: "PDF", FilePath: d.FilePath }));

  const body = JSON.stringify({
    names, subType: (odRows(billJ)[0] || {}).SubTypeDesc || "", docs,
  });
  await env.DATA.put(key, body);
  return new Response(body, { headers });
}

/* =====================================================================
   THE VOTE INDEX — our own copy of every plenum vote, 2003 → today
   ---------------------------------------------------------------------
   Storage: one KV key per year (plus overflow parts), each holding plain
   TSV text — one line per vote:

     id ⇥ date ⇥ time ⇥ src ⇥ passed ⇥ for ⇥ against ⇥ abstain ⇥ protocol ⇥ title

   src: "m" = modern API (2021→), "a" = the frozen archive (→13.7.2021).
   passed: 1 / 0 / "-" (the modern API doesn't return results in bulk).
   Plain text, not JSON, on purpose: searching it costs a String.indexOf
   instead of a multi-megabyte JSON.parse — the free plan allows 10ms of CPU
   per request, and parsing would blow through that.
   ===================================================================== */
const IDX_META = "vi:meta";
const idxKey = (year, seq) => `vi:${year}:${seq}`;
const MODERN_FROM = "2021-07-14";   // the day after the old service froze
const MODERN_WINDOW = 45;           // days per harvest step (keeps CPU + payload small)
const ARCHIVE_PAGE = 400;           // rows per harvest step
const OLDSVC = "https://knesset.gov.il/Odata/Votes.svc/";
const KAPI = "https://knesset.gov.il/WebSiteApi/knessetapi/Votes/";

const clean = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
const shiftDay = (isoDate, n) =>
  new Date(new Date(isoDate + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);

function freshMeta() {
  return { v: 7, phase: "modern", modernFrom: MODERN_FROM, archiveSkip: 0,
           years: {}, rows: 0, started: Date.now(), updated: 0, done: false };
}
const readMeta = async (env) => {
  try { return JSON.parse(await env.DATA.get(IDX_META)) || freshMeta(); }
  catch (e) { return freshMeta(); }
};

/* a vote row → one index line */
const lineModern = (r) => {
  const d = String(r.VoteDate || "").slice(0, 10);
  return [r.VoteId, d, String(r.VoteTimeStr || "").slice(0, 5), "m", "-", "", "", "",
          r.VoteProtocolNo || "", clean(r.ItemTitle)].join("\t");
};
const lineArchive = (r) => {
  const d = String(r.vote_date || "").slice(0, 10);
  return [r.vote_id, d, String(r.vote_time || "").slice(0, 5), "a",
          r.is_accepted === 1 ? 1 : 0, +r.total_for || 0, +r.total_against || 0, +r.total_abstain || 0,
          r.vote_nbr_in_sess || "", clean(r.sess_item_dscr || r.vote_item_dscr)].join("\t");
};

/* store a batch of lines, grouped by year (one new key per year per step —
   never rewriting an existing key, so the 1-write-per-second-per-key rule
   can't bite and a failed step can simply be repeated) */
async function storeLines(env, meta, lines) {
  const byYear = {};
  for (const ln of lines) {
    const y = ln.split("\t")[1].slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    (byYear[y] = byYear[y] || []).push(ln);
  }
  for (const [y, arr] of Object.entries(byYear)) {
    const seq = meta.years[y] || 0;
    await env.DATA.put(idxKey(y, seq), arr.join("\n"));
    meta.years[y] = seq + 1;
    meta.rows += arr.length;
  }
}

/* ONE harvest step: at most one upstream request, a few KV writes */
async function buildStep(env) {
  const meta = await readMeta(env);
  if (meta.done) return { ...meta, added: 0, step: "done" };
  const today = new Date().toISOString().slice(0, 10);
  let added = 0, step = meta.phase;

  if (meta.phase === "modern") {
    const from = meta.modernFrom;
    let to = shiftDay(from, MODERN_WINDOW);
    if (to > today) to = today;
    const j = await upstreamJson(KAPI + "GetVotesHeaders", "POST",
      JSON.stringify({ SearchType: 1, FromDate: from, ToDate: to }));
    const rows = (j && (Array.isArray(j) ? j : j.Table)) || [];
    await storeLines(env, meta, rows.map(lineModern));
    added = rows.length;
    meta.modernFrom = shiftDay(to, 1);
    step = `modern ${from}→${to}`;
    if (to >= today) { meta.phase = "archive"; }
  } else if (meta.phase === "archive") {
    const j = await upstreamJson(OLDSVC +
      `View_vote_rslts_hdr_Approved()?$orderby=vote_id&$skip=${meta.archiveSkip}&$top=${ARCHIVE_PAGE}&$format=json`);
    const rows = odRows(j);
    await storeLines(env, meta, rows.map(lineArchive));
    added = rows.length;
    step = `archive ${meta.archiveSkip}+${rows.length}`;
    // NEVER treat "fewer rows than I asked for" as the end: this service caps
    // pages at its own size (~250) and says so with odata.nextLink. Advance by
    // what actually came back, and stop only when a page comes back empty.
    meta.archiveSkip += rows.length || ARCHIVE_PAGE;
    if (!rows.length || meta.archiveSkip > 200000) {
      meta.phase = "compact";
      meta.compactLeft = Object.keys(meta.years).sort();
    }
  } else {
    /* compaction: each harvest step left a separate file behind, so a year can
       be spread over a dozen keys. Merge each year into one — a search then
       reads ~23 keys instead of ~130, which matters against the free plan's
       100,000 reads/day. */
    const y = (meta.compactLeft || []).shift();
    if (!y) { meta.done = true; meta.phase = "done"; step = "done"; }
    else {
      const n = meta.years[y] || 0;
      const parts = await Promise.all(
        Array.from({ length: n }, (_, s) => env.DATA.get(idxKey(y, s))));
      // merge AND dedupe: a repeated sweep (or a resumed build) can write the
      // same vote twice, and the same line twice is pure waste
      const seen = new Set(), keep = [];
      for (const p of parts) {
        if (!p) continue;
        for (const ln of p.split("\n")) {
          const id = ln.slice(0, ln.indexOf("\t"));
          if (!id || seen.has(id)) continue;
          seen.add(id);
          keep.push(ln);
        }
      }
      meta.rows -= Math.max(0, (meta.yearRows && meta.yearRows[y] || keep.length) - keep.length);
      await env.DATA.put(idxKey(y, 0), keep.join("\n"));
      for (let s = 1; s < n; s++) await env.DATA.delete(idxKey(y, s));
      meta.years[y] = 1;
      meta.yearRows = meta.yearRows || {};
      meta.yearRows[y] = keep.length;
      step = `compact ${y} (${keep.length})`;
      if (!meta.compactLeft.length) {
        meta.done = true; meta.phase = "done";
        meta.rows = Object.values(meta.yearRows).reduce((a, b) => a + b, 0);
      }
    }
  }

  meta.updated = Date.now();
  await env.DATA.put(IDX_META, JSON.stringify(meta));
  return { ...meta, added, step };
}

/* cron: keep the index current without rebuilding — re-harvest the last 60
   days into a single "live" key that gets overwritten each time. Duplicate
   vote ids are dropped at search time. */
async function refreshIndexTail(env) {
  const meta = await readMeta(env);
  if (!meta.done) return;
  const to = new Date().toISOString().slice(0, 10);
  const from = shiftDay(to, -60);
  const j = await upstreamJson(KAPI + "GetVotesHeaders", "POST",
    JSON.stringify({ SearchType: 1, FromDate: from, ToDate: to }));
  const rows = (j && (Array.isArray(j) ? j : j.Table)) || [];
  if (!rows.length) return;
  await env.DATA.put("vi:live", rows.map(lineModern).join("\n"));
  meta.liveUpdated = Date.now();
  meta.liveRows = rows.length;
  await env.DATA.put(IDX_META, JSON.stringify(meta));
}

/* Scan one text blob for lines containing every phrase.
   The date range is applied HERE, not afterwards: filtering after the cap made
   a dated search come back empty whenever the first `limit` matches all fell
   outside the range. */
function scanBlob(text, phrases, out, limit, from, to) {
  if (!text) return false;
  const first = phrases[0];
  let i = 0;
  while ((i = text.indexOf(first, i)) !== -1) {
    const s = text.lastIndexOf("\n", i) + 1;
    let e = text.indexOf("\n", i);
    if (e === -1) e = text.length;
    const line = text.slice(s, e);
    const t1 = line.indexOf("\t");
    const date = t1 < 0 ? "" : line.slice(t1 + 1, line.indexOf("\t", t1 + 1));
    const inRange = (!from || date >= from) && (!to || date <= to);
    if (inRange && phrases.every(p => line.includes(p))) {
      out.push(line);
      if (out.length >= limit) return true;
    }
    i = e + 1;
  }
  return false;
}

const lineToRow = (ln) => {
  const p = ln.split("\t");
  return { id: +p[0], date: p[1], time: p[2], src: p[3],
           passed: p[4] === "1" ? true : p[4] === "0" ? false : null,
           for: +p[5] || 0, against: +p[6] || 0, abstain: +p[7] || 0,
           protocol: p[8], title: p.slice(9).join(" ") };
};

/* GET /search/votes?q=…&qs=a|b&from=&to=&y0=&y1=&limit= */
async function searchIndex(url, env) {
  const headers = { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" };
  if (!env.DATA) return new Response('{"error":"KV binding DATA missing"}', { status: 501, headers });
  const p = url.searchParams;
  const meta = await readMeta(env);
  if (!meta.rows) return new Response(JSON.stringify({ error: "index not built", meta }), { status: 503, headers });

  const raw = (p.get("qs") || p.get("q") || "").replace(/["'״׳]/g, "").trim();
  const phrases = raw.split("|").map(s => s.trim()).filter(Boolean);
  if (!phrases.length) return new Response('{"error":"empty query"}', { status: 400, headers });
  // a single query is AND-ed word by word; multiple phrases (qs=a|b) are OR-ed
  const groups = p.get("qs")
    ? phrases.map(ph => ph.split(/\s+/).filter(Boolean))
    : [phrases[0].split(/\s+/).filter(Boolean)];

  const from = p.get("from") || "", to = p.get("to") || "";
  const limit = Math.min(+p.get("limit") || 400, 1000);
  const y0 = +p.get("y0") || 1900, y1 = +p.get("y1") || 2999;

  // narrow by year from the date range too, so we don't read files we can't use
  const fy = from ? +from.slice(0, 4) : 0, ty = to ? +to.slice(0, 4) : 9999;
  const keys = [];
  for (const [y, n] of Object.entries(meta.years)) {
    if (+y < y0 || +y > y1) continue;
    if (+y < fy || +y > ty) continue;
    for (let s = 0; s < n; s++) keys.push(idxKey(y, s));
  }
  if (meta.liveRows && y1 >= new Date().getFullYear()) keys.push("vi:live");

  const blobs = await Promise.all(keys.map(k => env.DATA.get(k)));
  const hits = [];
  let truncated = false;
  for (const b of blobs) {
    for (const words of groups) {
      if (scanBlob(b, words, hits, limit, from, to)) { truncated = true; break; }
    }
    if (truncated) break;
  }

  const seen = new Set();
  const rows = [];
  for (const ln of hits) {
    const r = lineToRow(ln);
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return new Response(JSON.stringify({ rows, truncated, keys: keys.length, indexRows: meta.rows }), { headers });
}

/* ---------- the worker ---------- */
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const reqUrl = new URL(request.url);
    const wrap = reqUrl.searchParams.get("wrap") === "1";
    // &head=1 — status, type and size only. wrap=1 decodes the whole body as
    // text, which on a 680KB spreadsheet is both useless and slow; this asks
    // "would this fetch have worked?" without paying for the answer.
    const headOnly = reqUrl.searchParams.get("head") === "1";

    /* ---- self-test mailbox: selftest.html posts its report here, so Claude
       can read what actually happened in your browser without you copying
       anything. Holds one report; nothing personal, just pass/fail lines. ---- */
    if (reqUrl.pathname === "/qa/report") {
      const h = { ...CORS, "Content-Type": "application/json" };
      if (!env.DATA) return new Response('{"error":"KV binding DATA missing"}', { status: 501, headers: h });
      if (request.method === "POST") {
        const body = (await request.text()).slice(0, 200000);
        await env.DATA.put("qa:last", body);
        return new Response('{"ok":true}', { headers: h });
      }
      return new Response((await env.DATA.get("qa:last")) || '{"empty":true}', { headers: h });
    }

    /* ---- the vote index ---- */
    if (reqUrl.pathname === "/data/votesmeta") {
      if (!env.DATA) return new Response('{"error":"KV binding DATA missing"}',
        { status: 501, headers: { ...CORS, "Content-Type": "application/json" } });
      const meta = await readMeta(env);
      return new Response(JSON.stringify(meta),
        { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
    }
    if (reqUrl.pathname === "/search/votes") return searchIndex(reqUrl, env);
    if (reqUrl.pathname === "/build/votes") {
      const headers = { ...CORS, "Content-Type": "application/json" };
      if (!env.DATA) return new Response('{"error":"KV binding DATA missing — see setup step B"}', { status: 501, headers });
      try {
        // a rebuild wipes the manifest only (old year files are overwritten as
        // the harvest walks past them); the key guards against random visitors
        if (reqUrl.searchParams.get("reset") === "1") {
          if (reqUrl.searchParams.get("key") !== BUILD_KEY)
            return new Response('{"error":"bad build key"}', { status: 403, headers });
          await env.DATA.put(IDX_META, JSON.stringify(freshMeta()));
        }
        // the archive is already complete — skip straight to the tidy-up pass
        // (merge each year into one file, dropping duplicate votes)
        if (reqUrl.searchParams.get("finish") === "1") {
          const m = await readMeta(env);
          m.phase = "compact"; m.done = false;
          m.compactLeft = Object.keys(m.years).sort();
          await env.DATA.put(IDX_META, JSON.stringify(m));
        }
        // re-run just the archive sweep, keeping everything already collected
        // (duplicate lines are dropped by vote id at search time)
        if (reqUrl.searchParams.get("resume") === "archive") {
          const m = await readMeta(env);
          m.phase = "archive"; m.archiveSkip = 0; m.done = false; m.compactLeft = [];
          await env.DATA.put(IDX_META, JSON.stringify(m));
        }
        const r = await buildStep(env);
        return new Response(JSON.stringify(r), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message).slice(0, 200) }), { status: 502, headers });
      }
    }

    /* per-bill info: built on first request, stored forever (immutable) */
    if (reqUrl.pathname.startsWith("/data/billinfo/"))
      return serveBillInfo(+reqUrl.pathname.slice(15), env);

    /* snapshots */
    if (reqUrl.pathname.startsWith("/data/"))
      return serveDataset(reqUrl.pathname.slice(6), env);

    /* relay modes */
    let target = null;
    let method = request.method;
    let body = null;

    if (reqUrl.pathname.startsWith("/preset/")) {
      const preset = PRESETS[reqUrl.pathname.slice(8)];
      if (!preset)
        return new Response("Unknown preset", { status: 404, headers: CORS });
      const built = preset(Object.fromEntries(reqUrl.searchParams));
      target = built.url;
      method = built.method || "GET";
      body = built.body || null;
    } else if (reqUrl.pathname.startsWith("/b64/")) {
      target = fromB64url(reqUrl.pathname.slice(5));
    } else if (reqUrl.pathname.startsWith("/postb64/")) {
      target = fromB64url(reqUrl.pathname.slice(9));
      method = "POST";
      const b = reqUrl.searchParams.get("body");
      body = b ? fromB64url(b) : "{}";
    } else {
      target = reqUrl.searchParams.get("url");
      if (request.method === "POST") body = await request.text();
    }

    if (!target)
      return new Response("Missing target address", { status: 400, headers: CORS });
    let t;
    try { t = new URL(target); } catch {
      return new Response("Bad url", { status: 400, headers: CORS });
    }
    if (t.protocol !== "https:" || !ALLOWED(t.hostname))
      return new Response("Host not allowed", { status: 403, headers: CORS });
    if (method !== "GET" && method !== "POST")
      return new Response("Only GET/POST", { status: 405, headers: CORS });

    const res = await upstream(t.toString(), method, body);

    if (headOnly) {
      return new Response(JSON.stringify({
        upstream_status: res.status,
        content_type: res.headers.get("Content-Type"),
        content_length: res.headers.get("Content-Length"),
      }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (wrap) {
      const text = (await res.text()).slice(0, 30000);
      return new Response(JSON.stringify({
        upstream_status: res.status,
        content_type: res.headers.get("Content-Type"),
        body: text,
      }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const headers = new Headers(CORS);
    headers.set("Content-Type", res.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "public, max-age=" + CACHE_SECONDS);
    return new Response(res.body, { status: res.status, headers });
  },

  /* cron: refresh every snapshot; one failure doesn't stop the others */
  async scheduled(event, env, ctx) {
    if (!env.DATA) return;
    for (const name of Object.keys(DATASETS)) {
      ctx.waitUntil(refreshDataset(name, env).catch(e =>
        console.log("snapshot " + name + " failed: " + e.message)));
    }
    // keep the vote index current (and finish an interrupted build, slowly)
    ctx.waitUntil(refreshIndexTail(env).catch(e => console.log("index tail: " + e.message)));
    ctx.waitUntil((async () => {
      for (let i = 0; i < 20; i++) {
        const m = await readMeta(env);
        if (m.done) return;
        await buildStep(env).catch(e => console.log("build: " + e.message));
      }
    })());
  },
};
