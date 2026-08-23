"use strict";
/* =====================================================================
   votes.data.js — everything that talks to the outside world
   The Knesset APIs, the frozen archive, our own vote index, and the page's
   shared memory (state). Nothing here draws anything.
   ---------------------------------------------------------------------
   Where the facts come from (all official, through the relay in config.js):
     Bills:   Knesset OData        https://knesset.gov.il/Odata/ParliamentInfo.svc
     Votes:   Knesset website API  /WebSiteApi/knessetapi/Votes/
        POST GetVotesHeaders {SearchType:1,FromDate,ToDate} → votes in a range
        POST GetVotesHeaders {SearchType:2,KnessetNum,MkId} → one MK's votes
        GET  GetVoteDetails/{voteId} → header, counters, per-MK results
        GET  GetVotesCmbData         → Knessets + MK directory
     Archive: Knesset OData Votes.svc — frozen at 13.7.2021, but complete
     Ours:    /search/votes on the worker — every vote 2003→today
   ===================================================================== */

const PARL = "https://knesset.gov.il/Odata/ParliamentInfo.svc/";
const KAPI = "https://knesset.gov.il/WebSiteApi/knessetapi/Votes/";
const OLDSVC = "https://knesset.gov.il/Odata/Votes.svc/";  // the frozen archive
const OLD_MAX = "2021-07-13";

/* OData rows (adds $format=json, unwraps both v3 JSON flavors) */
async function od(base, path) {
  const url = base + path + (path.includes("?") ? "&" : "?") + "$format=json";
  const j = await viaRelay(url);
  return (j && (j.value || (j.d && (j.d.results || j.d)))) || [];
}

/* Knesset website votes API */
const kapi = (path, bodyObj) => viaRelay(KAPI + path, bodyObj);

const rowsOf = j => !j ? [] : (Array.isArray(j) ? j : (j.Table || []));

/* ---------- state ---------- */
const state = { groups: [], drillData: null, statuses: {}, cmb: null,
                q: "", res: null, mkSel: null, tab: "votes", btab: null,
                page: 1, maxDays: 120, noMore: false, shown: [],
                advSeq: 0, advWork: null, advCursor: 0, advAllChecked: false,
                deepSeq: 0, deepWork: null, deepDone: false, found: null };

window.onLangChange = () => {
  if (state.groups || state.mkSel) renderVotes();
  if (state.btab) renderBTab();
};

/* group the reservation marathons: same bill, same day → one entry,
   the first (latest) vote in the group is the decisive one */

/* group the reservation marathons: same bill, same day → one entry,
   the first (latest) vote in the group is the decisive one */
/* Newest first — ALWAYS by a real date, never by comparing the text.
   The sources disagree on format ("2023-03-15", "15/03/2023", "/Date(…)/"),
   and comparing those as strings sorts by day-of-month: that's what put a
   2023 vote above a 2026 one. dateOf() (common.js) understands all three. */
const voteTime = r => {
  const d = dateOf(r && r.VoteDate);
  if (!d) return 0;
  let t = d.getTime();
  // some sources give the date only — then the separate time field orders the day
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    const hm = /^(\d{1,2}):(\d{2})/.exec(String((r && r.VoteTimeStr) || ""));
    if (hm) t += (+hm[1] * 60 + +hm[2]) * 60000;
  }
  return t;
};
const voteDay = r => {
  const d = dateOf(r && r.VoteDate);
  return d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : String((r && r.VoteDateStr) || "");
};

function groupVotes(rows) {
  rows = rows.slice().sort((a, b) =>
    voteTime(b) - voteTime(a) || ((b.VoteProtocolNo || 0) - (a.VoteProtocolNo || 0)));
  const groups = [], byKey = {};
  rows.forEach(r => {
    const key = voteDay(r) + "|" + (r.ItemTitle || "");
    if (!byKey[key]) { byKey[key] = { title: r.ItemTitle || "—", date: r.VoteDate, votes: [] }; groups.push(byKey[key]); }
    byKey[key].votes.push(r);
  });
  return groups;
}

/* fetch ✔/✘ for ONE group's decisive vote (cached on the group).
   Always settles: on failure _passed becomes null, never stays undefined. */

/* fetch ✔/✘ for ONE group's decisive vote (cached on the group).
   Always settles: on failure _passed becomes null, never stays undefined. */
async function annotateOne(g) {
  if (!g || g._passed !== undefined) return;
  try {
    const v = g.votes[0];
    const j = v._old ? await oldDetail(v) : await kapi("GetVoteDetails/" + (+v.VoteId));
    const hdr = (j && j.VoteHeader && j.VoteHeader[0]) || {};
    // keep the full answer: expanding this vote later costs nothing
    g._detById = g._detById || {};
    g._detById[v.VoteId] = j;
    g._passed = hdr.IsForAccepted === true;
    const c = { for: 0, against: 0, abstain: 0 };
    ((j && j.VoteCounters) || []).forEach(x => {
      const k = resClass(x.Title);
      if (k in c) c[k] += +x.countOfResult || 0;
    });
    g._counts = c;
  } catch (e) { g._passed = null; }
}

/* fetch ✔/✘ for a list of groups (the visible page of the feed) */
async function annotateGroups(groups, onDone) {
  const todo = (groups || []).filter(g => g && g._passed === undefined);
  if (!todo.length) return;
  let i = 0;
  const worker = async () => { while (i < todo.length) await annotateOne(todo[i++]); };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  if (onDone) onDone();
}

/* classify a result title (API is Hebrew) into a visual class */
function resClass(title) {
  const s = String(title || "");
  if (s.includes("בעד")) return "for";
  if (s.includes("נגד")) return "against";
  if (s.includes("נמנע")) return "abstain";
  return "none";
}
async function idxMeta() {
  if (state._idxMeta !== undefined) return state._idxMeta;
  state._idxMeta = null;
  try {
    const r = await fetch(PROXY + "/data/votesmeta");
    if (r.ok) {
      const j = await r.json();
      if (j && j.rows && j.years) state._idxMeta = j;
    }
  } catch (e) { debug("index: " + e.message); }
  return state._idxMeta;
}

/* an index row → the same shape the rest of the page already speaks */
function idxRowToVote(r) {
  const [y, m, d] = String(r.date || "").split("-");
  const v = {
    VoteId: r.id, ItemTitle: r.title || "—",
    VoteDate: r.date + "T" + (r.time || "00:00") + ":00",
    VoteDateStr: `${+d}.${+m}.${y}`,
    VoteTimeStr: r.time || "",
    VoteProtocolNo: +r.protocol || 0,
    _idxPassed: r.passed,
  };
  if (r.src === "a") {   // the frozen archive carries its results with it
    v._old = true;
    v._raw = { vote_id: r.id, vote_date: r.date, vote_time: r.time,
               is_accepted: r.passed ? 1 : 0, sess_item_dscr: r.title,
               total_for: r.for, total_against: r.against, total_abstain: r.abstain,
               vote_nbr_in_sess: +r.protocol || 0 };
    v._idxCounts = { for: r.for, against: r.against, abstain: r.abstain };
  }
  return v;
}

function groupsFromIndex(rows) {
  const groups = groupVotes(rows.map(idxRowToVote));
  groups.forEach(g => {
    const v = g.votes[0] || {};
    if (v._idxPassed === true || v._idxPassed === false) g._passed = v._idxPassed;
    if (v._idxCounts) g._counts = v._idxCounts;
    if (v._old) g._old = true;
  });
  return groups;
}

/* Search the index. phrases are OR-ed; the words inside one phrase are AND-ed.
   Split across year blocks and phrase chunks so no single worker request has
   to scan more than a megabyte (the free plan allows 10ms of CPU). */
async function idxSearch(phrases, opts) {
  const meta = await idxMeta();
  if (!meta || !phrases.length) return null;
  const years = Object.keys(meta.years).map(Number).filter(Boolean).sort((a, b) => a - b);
  if (!years.length) return null;
  const blocks = [];
  for (let i = 0; i < years.length; i += 6)
    blocks.push([years[i], years[Math.min(i + 6, years.length) - 1]]);
  const chunks = [];
  for (let i = 0; i < phrases.length; i += 8) chunks.push(phrases.slice(i, i + 8));

  const jobs = [];
  for (const [y0, y1] of blocks) for (const ch of chunks) jobs.push([y0, y1, ch]);
  const out = [];
  let truncated = false;
  await Promise.all(jobs.map(async ([y0, y1, ch]) => {
    const qs = new URLSearchParams({ qs: ch.join("|"), y0, y1, limit: "400" });
    if (opts && opts.from) qs.set("from", opts.from);
    if (opts && opts.to) qs.set("to", opts.to);
    try {
      const r = await fetch(PROXY + "/search/votes?" + qs.toString());
      if (!r.ok) return;
      const j = await r.json();
      if (j.truncated) truncated = true;
      out.push(...(j.rows || []));
    } catch (e) { debug("idxsearch: " + e.message); }
  }));
  const seen = {}, rows = [];
  for (const r of out) { if (!seen[r.id]) { seen[r.id] = 1; rows.push(r); } }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return { rows, truncated };
}

/* which bill is behind this group's decisive vote (0 = unknown yet) */
/* The archive's own link from a vote to what it was about: every old vote row
   carries sess_item_id, which is KNS_PlmSessionItem.ItemID — and when that item
   is a bill (ItemTypeID 2) the very same number IS the BillID. Verified live:
   item 88733 → "חוק התכנית להבראת כלכלת ישראל", Knesset 16.
   So pre-2021 votes can name their initiators too; the id just isn't in our
   index yet, so we fetch it once per vote and remember it. */
async function oldItemId(v) {
  if (!v || !v._old) return 0;
  v._raw = v._raw || {};
  if (v._raw.sess_item_id !== undefined) return +v._raw.sess_item_id || 0;
  try {
    const rows = await od(OLDSVC,
      `View_vote_rslts_hdr_Approved()?$filter=vote_id eq ${+v.VoteId}&$select=sess_item_id&$top=1`);
    v._raw.sess_item_id = +((rows[0] || {}).sess_item_id || 0);
  } catch (e) {
    v._raw.sess_item_id = 0;
    debug("olditem: " + e.message);
  }
  return +v._raw.sess_item_id || 0;
}

function billItemIdOf(g) {
  const v = g.votes[0];
  if (!v) return 0;
  if (v._old) return +((v._raw || {}).sess_item_id || 0);
  const j = g._detById && g._detById[v.VoteId];
  const hdr = j && j !== "loading" && j.VoteHeader && j.VoteHeader[0];
  return hdr ? +(hdr.FK_ItemID || 0) : 0;
}

async function ensureDetail(g, voteId) {
  g._detById = g._detById || {};
  if (g._detById[voteId]) return;
  g._detById[voteId] = "loading";
  try {
    const v = g.votes.find(x => x.VoteId === voteId);
    const j = (v && v._old) ? await oldDetail(v) : await kapi("GetVoteDetails/" + (+voteId));
    g._detById[voteId] = j;
    // also fetch the bill behind the vote: who brought it + official documents
    const itemId = (v && v._old) ? await oldItemId(v)
      : +(((j.VoteHeader || [])[0] || {}).FK_ItemID || 0);
    ensureBillInfo(g, itemId);
  } catch (e) {
    g._detById[voteId] = { _err: true };
    debug("breakdown: " + e.message);
  }
  renderVotes();
}

async function getPersons() {
  if (state._persons) return state._persons;
  try { state._persons = (await dataset("persons")) || {}; }
  catch (e) { state._persons = {}; debug("persons: " + e.message); }
  return state._persons;
}

/* awaited version: always settles g._bill, even when no bill stands behind
   the vote (a motion, a no-confidence vote…). Used by the type filter, which
   would otherwise wait forever for a value that never arrives. */
async function loadBillInfo(g) {
  const p = ensureBillInfo(g, billItemIdOf(g));
  if (p) return p;
  if (!g._bill) g._bill = { names: [], subType: "", docs: [] };
  return g._bill;
}

function ensureBillInfo(g, itemId) {
  if (g._billP) return g._billP;
  if (!itemId) return null;          // id unknown yet — the caller retries after details load
  g._bill = "loading";
  g._billP = fetchBillInfo(g, itemId);
  return g._billP;
}

async function fetchBillInfo(g, itemId) {
  // 1st choice: our permanent store — one fast request, saved forever after first touch
  try {
    const r = await fetch(PROXY + "/data/billinfo/" + itemId);
    if (r.ok) {
      const d = await r.json();
      // keep EVERY name: the view decides how to show them (4 or fewer are
      // listed; more are counted, with a click to see all of them)
      g._bill = { names: d.names || [], subType: d.subType || "", docs: d.docs || [] };
      renderVotes();
      return g._bill;
    }
  } catch (e) { /* old worker — fall through to direct queries */ }
  try {
    // three light queries in parallel — replaces the heavy 2-second bill-page call
    const [initRows, docs, billRow, persons] = await Promise.all([
      od(PARL, `KNS_BillInitiator()?$filter=BillID eq ${itemId}&$top=60`).catch(() => []),
      od(PARL, `KNS_DocumentBill()?$filter=BillID eq ${itemId}&$top=40`).catch(() => []),
      od(PARL, `KNS_Bill()?$filter=BillID eq ${itemId}&$select=SubTypeDesc&$top=1`).catch(() => []),
      getPersons(),
    ]);
    initRows.sort((a, b) => ((b.IsInitiator ? 1 : 0) - (a.IsInitiator ? 1 : 0)) || ((a.Ordinal || 99) - (b.Ordinal || 99)));
    let names = initRows.map(x => persons[x.PersonID]).filter(Boolean);
    // fallback: no persons snapshot yet (worker not updated) → the slow but sure path
    if (initRows.length && !names.length) {
      const item = await viaRelay("https://knesset.gov.il/WebSiteApi/knessetapi/LegislationItem/GetLegislationBillItem?ItemId=" + itemId).catch(() => null);
      const s = (((item || {}).general || {}).Initiators || "").trim();
      if (s) names = [s];
    }
    g._bill = { names, subType: (billRow[0] || {}).SubTypeDesc || "", docs };
  } catch (e) {
    g._bill = { names: [], subType: "", docs: [] };
    debug("billinfo: " + e.message);
  }
  renderVotes();
  return g._bill;
}

/* ---------- the frozen archive (votes until 13.7.2021) ---------- */
function mapOldRow(r) {
  const d = String(r.vote_date || "").slice(0, 10);
  const [y, m, dd] = d.split("-");
  return {
    VoteId: r.vote_id, _old: true, _raw: r,
    ItemTitle: r.sess_item_dscr || r.vote_item_dscr || "—",
    VoteDate: d + "T" + (r.vote_time || "00:00") + ":00",
    VoteDateStr: `${+dd}.${+m}.${y}`,
    VoteTimeStr: r.vote_time || "",
    VoteProtocolNo: r.vote_nbr_in_sess,
  };
}

async function fetchOldVotes(from, to) {
  const rows = await od(OLDSVC,
    `View_vote_rslts_hdr_Approved()?$filter=vote_date ge datetime'${from}T00:00:00' and vote_date le datetime'${to}T23:59:59'&$orderby=vote_date desc&$top=400`);
  return rows.map(mapOldRow);
}

const OLD_RES = { 1: "בעד", 2: "נגד", 3: "נמנע" };

async function oldDetail(v) {
  const r = v._raw;
  const members = await od(OLDSVC, `vote_rslts_kmmbr_shadow()?$filter=vote_id eq ${+v.VoteId}&$top=250`);
  return {
    VoteHeader: [{
      VoteId: v.VoteId, ItemTitle: v.ItemTitle,
      IsForAccepted: r.is_accepted === 1,
      Decision: r.vote_item_dscr && r.vote_item_dscr !== v.ItemTitle ? r.vote_item_dscr : null,
      FK_Knesset: r.knesset_num, SessionNumber: r.session_num,
    }],
    VoteCounters: [
      { Title: "בעד", countOfResult: +r.total_for || 0 },
      { Title: "נגד", countOfResult: +r.total_against || 0 },
      { Title: "נמנע", countOfResult: +r.total_abstain || 0 },
    ],
    VoteDetails: members.map(m => ({
      MkName: m.kmmbr_name, FactionName: m.faction_name,
      Title: OLD_RES[m.vote_result] || "לא הצביע",
    })),
  };
}

/* ---------- unified search: laws, bills, MKs ---------- */
async function ensureCmb() {
  if (!state.cmb) state.cmb = await kapi("GetVotesCmbData");
  return state.cmb;
}

/* word-order blind name match: directory stores "לפיד יאיר", people type "יאיר לפיד" */
function matchMks(q, cmb) {
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const seen = {};
  return (cmb.MKS || []).filter(m => words.every(w => (m.Name || "").includes(w)))
    .sort((a, b) => b.KnessetId - a.KnessetId)
    .filter(m => seen[m.Name] ? false : (seen[m.Name] = true))
    .slice(0, 10);
}

async function ensureStatuses() {
  if (Object.keys(state.statuses).length) return;
  let sts = null;
  try { sts = (await dataset("bills")).statuses; } catch (e) { /* fall through */ }
  if (!sts) { try { sts = await od(PARL, "KNS_Status()?$top=200"); } catch (e) { sts = []; } }
  (sts || []).forEach(s => { state.statuses[s.StatusID] = s.Desc; });
}
async function personBills(q) {
  const persons = await getPersons();
  const w = q.split(/\s+/).filter(Boolean);
  const byName = {};
  for (const [id, nm] of Object.entries(persons))
    if (w.every(x => (nm || "").includes(x))) (byName[nm] = byName[nm] || []).push(id);
  const names = Object.keys(byName);
  if (!names.length) return null;
  if (names.length > 1) return { pick: names.slice(0, 12) };

  const key = "pb:" + names[0];
  if (state._pbCache && state._pbCache[key]) return state._pbCache[key];

  // NOTE: this service answers at most 100 rows per page whatever $top says —
  // asking for 300 and taking what comes back silently lost every bill after
  // the 100th. Page with $skip until a page comes back short.
  let bids = [];
  for (const id of byName[names[0]].slice(0, 3)) {
    for (let skip = 0; skip < 600; skip += 100) {
      const rows = await od(PARL,
        `KNS_BillInitiator()?$filter=PersonID eq ${+id}&$skip=${skip}&$top=100&$select=BillID`).catch(() => []);
      bids.push(...rows.map(r => r.BillID).filter(Boolean));
      if (rows.length < 100) break;
    }
  }
  bids = [...new Set(bids)];
  // batch the lookups, 10 ids per request, 4 requests at a time
  const batches = [];
  for (let i = 0; i < bids.length; i += 10) batches.push(bids.slice(i, i + 10));
  const bills = [];
  let bi = 0;
  const worker = async () => {
    while (bi < batches.length) {
      const f = batches[bi++].map(b => `BillID eq ${+b}`).join(" or ");
      const rows = await od(PARL,
        `KNS_Bill()?$filter=${f}&$select=BillID,Name,SubTypeID,StatusID,LastUpdatedDate&$top=10`).catch(() => []);
      bills.push(...rows);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker));
  bills.sort((a, b) => (dateOf(b.LastUpdatedDate) || 0) - (dateOf(a.LastUpdatedDate) || 0));
  const out = { chosen: names[0], bills, total: bids.length };
  state._pbCache = state._pbCache || {};
  state._pbCache[key] = out;
  return out;
}

async function fetchVotesRange(from, to) {
  const out = [];
  const shift = (iso, d) => new Date(new Date(iso + "T12:00:00").getTime() + d * 864e5).toISOString().slice(0, 10);
  let cur = from, guard = 0;
  while (cur <= to && guard++ < 40) {
    let end = shift(cur, VOTE_WINDOW);
    if (end > to) end = to;
    out.push(...rowsOf(await kapi("GetVotesHeaders", { SearchType: 1, FromDate: cur, ToDate: end })));
    if (end === to) break;
    cur = shift(end, 1);
  }
  return out;
}

/* Background work for the result / type filters.
   Bounded, counted, and always finished — the old version asked "is everything
   checked?" about groups it never sent for checking, so it waited forever. */

/* GetVotesHeaders is happiest with ~120-day windows — walk long ranges in steps */
const VOTE_WINDOW = 120;

/* one older 120-day window of the feed; returns how many rows it added */
async function fetchOlderChunk() {
  try {
    const j = await kapi("GetVotesHeaders", {
      SearchType: 1, FromDate: isoDaysAgo(state.maxDays + 120), ToDate: isoDaysAgo(state.maxDays + 1)
    });
    const rows = rowsOf(j);
    state.maxDays += 120;
    if (rows.length) state.groups = state.groups.concat(groupVotes(rows));
    else if (state.maxDays >= DEEP_MAX_DAYS) state.noMore = true;
    return rows.length;
  } catch (e) {
    debug("older: " + e.message);
    state.noMore = true;   // don't spin on a failing relay
    return 0;
  }
}
