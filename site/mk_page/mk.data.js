"use strict";
/* =====================================================================
   mk.data.js — everything the portfolio page fetches
   People come from TWO official directories that use different id spaces:
     - the votes API (GetVotesCmbData): MkId per Knesset — for voting records
     - the OData persons table (our /data/persons snapshot): PersonID —
       for bills (KNS_BillInitiator) and positions (KNS_PersonToPosition)
   The bridge between them is the person's NAME, matched word-order-blind
   (one stores "לפיד יאיר", the other "יאיר לפיד"). Nothing here draws.
   ---------------------------------------------------------------------
   Sources (all official, through the relay in config.js):
     Positions: KNS_PersonToPosition (verified live 2026-08-25: PositionID,
                KnessetNum, StartDate/FinishDate, GovMinistryName, DutyDesc,
                FactionName, CommitteeName, GovernmentNum, IsCurrent)
                + KNS_Position for the role names
     Bills:     KNS_BillInitiator (paged — the service caps every page at
                100 rows whatever $top says) + KNS_Bill + KNS_Status
     Votes:     POST Votes/GetVotesHeaders {SearchType:2,KnessetNum,MkId}
                + GET Votes/GetVoteDetails/{id} (also says how THIS MK voted)
   ===================================================================== */

const PARL = "https://knesset.gov.il/Odata/ParliamentInfo.svc/";
const KAPI = "https://knesset.gov.il/WebSiteApi/knessetapi/Votes/";

/* OData rows (adds $format=json, unwraps both v3 JSON flavors) */
async function od(base, path) {
  const url = base + path + (path.includes("?") ? "&" : "?") + "$format=json";
  const j = await viaRelay(url);
  return (j && (j.value || (j.d && (j.d.results || j.d)))) || [];
}
const kapi = (path, bodyObj) => viaRelay(KAPI + path, bodyObj);
const rowsOf = j => !j ? [] : (Array.isArray(j) ? j : (j.Table || []));

/* ---------- state ---------- */
const state = {
  sel: null,            // the chosen person: {name, key, cmb:[{Id,KnessetId}], personIds}
  cmb: null, persons: null, posNames: null, statuses: null, dropdown: null,
  pick: null,           // several candidates → the pick-chips
  positions: null, posAll: false,
  bills: null, billsOpen: {},   // {bucket: true} = full list shown
  votesByK: {},         // KnessetId → groups (each: title, date, votes[])
  vK: null,             // the Knesset whose record is on screen
  vPage: 1,
  seq: 0,               // a newer selection cancels older loads
};

window.onLangChange = () => { renderAll(); };

/* ---------- directories ---------- */
async function ensureCmb() {
  if (!state.cmb) state.cmb = await kapi("GetVotesCmbData");
  return state.cmb;
}
async function ensurePersons() {
  if (state.persons) return state.persons;
  try { state.persons = (await dataset("persons")) || {}; }
  catch (e) { state.persons = {}; debug("persons: " + e.message); }
  return state.persons;
}

/* name → a stable key: the words, sorted. "לפיד יאיר" and "יאיר לפיד" meet. */
const nameKey = s => String(s || "").split(/\s+/).filter(Boolean).sort().join(" ");
const nameHas = (nm, words) => words.every(w => String(nm || "").includes(w));

/* every person the query matches, across BOTH directories, merged by name.
   Returns [{name, key, cmb:[{Id,KnessetId}…newest first], personIds:[…]}]. */
async function findCandidates(q) {
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const [cmb, persons] = await Promise.all([
    ensureCmb().catch(e => { debug("cmb: " + e.message); return { MKS: [] }; }),
    ensurePersons(),
  ]);
  const byKey = {};
  const claim = (name) => {
    const key = nameKey(name);
    return byKey[key] = byKey[key] || { name, key, cmb: [], personIds: [] };
  };
  (cmb.MKS || []).forEach(m => {
    if (!nameHas(m.Name, words)) return;
    const c = claim(m.Name);
    c.cmb.push({ Id: m.Id, KnessetId: m.KnessetId });
  });
  for (const [pid, nm] of Object.entries(persons)) {
    if (!nameHas(nm, words)) continue;
    const c = claim(nm);
    c.name = nm;                      // prefer "יאיר לפיד" over "לפיד יאיר" for display
    if (c.personIds.length < 3) c.personIds.push(+pid);
  }
  const out = Object.values(byKey);
  out.forEach(c => {
    const seen = {};
    c.cmb = c.cmb.sort((a, b) => b.KnessetId - a.KnessetId)
      .filter(x => seen[x.KnessetId] ? false : (seen[x.KnessetId] = true));
  });
  // people who can actually show something first: current cmb presence, then breadth
  out.sort((a, b) => (b.cmb.length - a.cmb.length) || (b.personIds.length - a.personIds.length));
  return out.slice(0, 12);
}

/* the persons snapshot misses nobody recent, but the OData table is the truth —
   when the snapshot gave no PersonID, ask KNS_Person directly by both orders */
async function fallbackPersonIds(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];
  const tryPair = async (first, last) => od(PARL,
    `KNS_Person()?$filter=FirstName eq '${first}' and LastName eq '${last}'&$select=PersonID&$top=3`)
    .catch(() => []);
  const a = await tryPair(words[0], words.slice(1).join(" "));
  if (a.length) return a.map(r => +r.PersonID);
  const b = await tryPair(words[words.length - 1], words.slice(0, -1).join(" "));
  return b.map(r => +r.PersonID);
}

/* ---------- positions ---------- */
async function ensurePosNames() {
  if (state.posNames) return state.posNames;
  const map = {};
  try {
    for (let skip = 0; skip < 500; skip += 100) {
      const rows = await od(PARL, `KNS_Position()?$select=PositionID,Description&$skip=${skip}&$top=100`);
      rows.forEach(p => { map[p.PositionID] = p.Description; });
      if (rows.length < 100) break;
    }
  } catch (e) { debug("posnames: " + e.message); }
  return state.posNames = map;
}

async function loadPositions(sel, seq) {
  let rows = [];
  try {
    // same batched, per-person-cached fetch the search uses — a person the
    // searcher just hovered over costs nothing to open
    const byId = await positionsForMany(sel.personIds);
    rows = sel.personIds.flatMap(id => byId[id] || []);
  } catch (e) { debug("positions: " + e.message); }
  if (state.seq !== seq) return;
  state.positions = tidyPositions(rows);
  renderPositions();
  renderHead();   // the faction + Knessets-served line feeds off the positions
}

/* The register is dirty in two specific ways (measured live on PersonID 965,
   2026-08-25): the SAME office appears twice under two gendered position
   codes (45 and 39 are both "ראש הממשלה", same dates, both current), and one
   continuous term is split into rows wherever the GovernmentNum changed
   mid-Knesset (K23: 16.3→17.5.2020 + 17.5.2020→6.4.2021). The first is a
   duplicate, the second is proceduralia — a citizen asked "who held the
   office" and the answer didn't change. So: collapse rows that RENDER the
   same, then stitch spans of the same office that touch or overlap.
   Genuinely separate short stints (a 3-day ministry hand-off) have a real
   gap between them and are kept as the register wrote them. */
function tidyPositions(rows) {
  const dayMs = 864e5;
  const start = r => { const d = dateOf(r.StartDate); return d ? d.getTime() : 0; };
  const finish = r => {
    if (!r.FinishDate) return Infinity;              // open-ended = ongoing
    const d = dateOf(r.FinishDate); return d ? d.getTime() : Infinity;
  };
  const office = r => [r._role, r.GovMinistryName || "", r.CommitteeName || "",
                       r.FactionName || "", r.KnessetNum || ""].join("|");
  // 1 — exact duplicates (same office, same span) collapse to one
  const seen = {};
  rows = rows.filter(r => {
    const k = office(r) + "|" + start(r) + "|" + finish(r);
    if (seen[k]) return false;
    return seen[k] = true;
  });
  // 2 — same office, spans that touch or overlap → one continuous row
  const byOffice = {};
  rows.forEach(r => { (byOffice[office(r)] = byOffice[office(r)] || []).push(r); });
  const out = [];
  Object.values(byOffice).forEach(list => {
    list.sort((a, b) => start(a) - start(b));
    let cur = list[0];
    for (let i = 1; i < list.length; i++) {
      const r = list[i];
      if (start(r) <= finish(cur) + dayMs) {         // touching (≤1 day apart) or overlapping
        if (finish(r) > finish(cur)) {
          cur.FinishDate = r.FinishDate;
          cur.IsCurrent = cur.IsCurrent || r.IsCurrent;
        }
      } else { out.push(cur); cur = r; }
    }
    out.push(cur);
  });
  out.sort((a, b) => start(b) - start(a) || (b.KnessetNum || 0) - (a.KnessetNum || 0));
  return out;
}

/* ---------- photos ----------
   Official MK photos, collected ONCE by the pipeline's get-photos.bat
   (Mercy's call 2026-08-25: a one-time collection refreshed after each
   election beats hotlinking a pattern that can change or start blocking).
   Since 2026-09-06 the site keeps NO photos of its own (Mercy: everything the
   pages use comes from a public API or from Cloudflare). The page asks the
   relay for the manifest, GET <PROXY>/data/mkphotos → {t, data:{"<MkId>":
   "<image URL or filename>"}}; a bare filename means <PROXY>/photos/mk/<file>.
   When the relay has no manifest (404/501/error), photos are simply off and
   the initials avatars show. The page never guesses image URLs — no 404
   spam, not at the Knesset and not at our own host. */
let photoMap = null;
const photosReady = (async () => {
  if (!PROXY) return;
  try {
    const r = await fetch(PROXY + "/data/mkphotos");
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.data && typeof j.data === "object") photoMap = j.data;
  } catch (e) { /* relay down or manifest not published yet — avatars it is */ }
})();
const photoOf = mkId => {
  const v = photoMap && photoMap[mkId];
  if (!v) return "";
  return /^https?:\/\//.test(v) ? v : PROXY + "/photos/mk/" + v;
};

/* ---------- the current-members directory (light: one GET, cached) ---------- */
async function ensureDropdown() {
  if (state.dropdown) return state.dropdown;
  const map = {};
  try {
    const list = await viaRelay("https://knesset.gov.il/WebSiteApi/knessetapi/MKs/GetMksDropdown?languageKey=he");
    (list || []).forEach(m => { map[nameKey(m.Name)] = { ID: m.ID, IsCurrent: !!m.IsCurrent }; });
  } catch (e) { debug("dropdown: " + e.message); }
  return state.dropdown = map;
}

/* ---------- positions for SEARCH candidates (batched, cached per person) ---------- */
const posCache = {};   // PersonID → rows (with _role resolved, tidied)

async function positionsForMany(pids) {
  const missing = [...new Set(pids)].filter(id => !(id in posCache));
  if (missing.length) {
    const namesP = ensurePosNames();
    for (let i = 0; i < missing.length; i += 6) {
      const chunk = missing.slice(i, i + 6);
      const f = chunk.map(id => `PersonID eq ${+id}`).join(" or ");
      const rows = [];
      try {
        for (let skip = 0; skip < 900; skip += 100) {
          const page = await od(PARL, `KNS_PersonToPosition()?$filter=${f}&$skip=${skip}&$top=100`);
          rows.push(...page);
          if (page.length < 100) break;
        }
      } catch (e) { debug("pos-batch: " + e.message); }
      const names = await namesP;
      chunk.forEach(id => { posCache[id] = []; });   // asked = answered, even when empty
      rows.forEach(r => {
        r._role = r.DutyDesc || names[r.PositionID] || "";
        (posCache[r.PersonID] = posCache[r.PersonID] || []).push(r);
      });
      chunk.forEach(id => { posCache[id] = tidyPositions(posCache[id]); });
    }
  }
  const out = {};
  pids.forEach(id => { out[id] = posCache[id] || []; });
  return out;
}

/* ---------- ranking: who is the searcher most likely looking for ---------- */
/* how heavy a role is. The exact wording comes from the register (DutyDesc /
   KNS_Position.Description, which spells יושב–ראש with an en-dash). */
function roleRank(role) {
  const s = String(role || "").trim();
  if (s === "ראש הממשלה") return 100;
  if (/ראש הממשלה החלופי/.test(s)) return 92;
  if (/ממלא מקום ראש הממשלה/.test(s)) return 90;
  if (/סגן.{0,6}יושב[-–\s]?ראש הכנסת/.test(s)) return 35;
  if (/יושב(ת)?[-–\s]?ראש הכנסת/.test(s)) return 85;
  if (/ראש האופוזיציה/.test(s)) return 75;
  if (/^סגנ(ית)?\s*שר|^סגן שר/.test(s)) return 60;
  if (/ממלא מקום שר|מ"מ שר/.test(s)) return 58;
  if (/^שר/.test(s)) return 80;
  if (/יושב(ת)?[-–\s]?ראש\s*ועד|יו"ר\s*ועד/.test(s)) return 50;
  if (/יושב(ת)?[-–\s]?ראש\s*סיע|יו"ר\s*סיע/.test(s)) return 40;
  if (/חבר(ת)?\s*ועד/.test(s)) return 10;
  return 5;
}

const posStart = r => { const d = dateOf(r.StartDate); return d ? d.getTime() : 0; };
const posFinish = r => {
  if (!r.FinishDate) return Infinity;
  const d = dateOf(r.FinishDate); return d ? d.getTime() : Infinity;
};
const yearOf = v => { const d = dateOf(v); return d ? d.getFullYear() : ""; };

/* the one line under a name in the search: what they ARE, or last were.
   Mercy's rule (2026-08-25): a current position wins; otherwise the last
   one; but someone who was ever ראש הממשלה shows that, with the years. */
function positionLine(rows) {
  if (!rows || !rows.length) return "";
  const ctx = r => {
    // generic roles earn their context; a named role speaks for itself
    if (/ועד/.test(r._role) && r.CommitteeName) return `${r._role} · ${r.CommitteeName}`;
    if (/סיע/.test(r._role) && r.FactionName) return `${r._role} · ${r.FactionName}`;
    return r._role;
  };
  const pm = rows.filter(r => String(r._role || "").trim() === "ראש הממשלה")
    .sort((a, b) => posStart(a) - posStart(b));
  if (pm.length) {
    const spans = pm.map(r => yearOf(r.StartDate) +
      "–" + (r.FinishDate ? yearOf(r.FinishDate) : t("untilNow")));
    return "ראש הממשלה " + spans.join(" · ");
  }
  const current = rows.filter(r => !r.FinishDate)
    .sort((a, b) => roleRank(b._role) - roleRank(a._role));
  if (current.length) return ctx(current[0]);
  const last = rows.slice().sort((a, b) => posFinish(b) - posFinish(a))[0];
  const y0 = yearOf(last.StartDate), y1 = yearOf(last.FinishDate);
  return ctx(last) + (y0 ? ` · ${y0}${y1 && y1 !== y0 ? "–" + y1 : ""}` : "");
}

/* Mercy's order (2026-08-25): serving now → how recently they served →
   the weight of the heaviest role they ever held → how many roles. */
function rankCandidates(list) {
  return list.slice().sort((a, b) =>
    ((b._isCurrent ? 1 : 0) - (a._isCurrent ? 1 : 0)) ||
    ((b._lastK || 0) - (a._lastK || 0)) ||
    ((b._rank || 0) - (a._rank || 0)) ||
    ((b._nPos || 0) - (a._nPos || 0)) ||
    String(a.name).localeCompare(String(b.name), "he"));
}

/* cheap signals first (one cached GET), the position-based ones second */
async function enrichCheap(list) {
  const drop = await ensureDropdown();
  const latestK = Math.max(...((state.cmb && state.cmb.MKS) || []).map(m => +m.KnessetId || 0), 0);
  list.forEach(c => {
    const d = drop[c.key];
    c._mkId = (c.cmb[0] && c.cmb[0].Id) || (d && d.ID) || 0;
    c._lastK = c.cmb.length ? c.cmb[0].KnessetId : 0;
    c._isCurrent = (d && d.IsCurrent) || (c._lastK === latestK && latestK > 0);
  });
  return list;
}
async function enrichPositions(list) {
  const pids = list.flatMap(c => c.personIds);
  const byId = await positionsForMany(pids);
  list.forEach(c => {
    const rows = c.personIds.flatMap(id => byId[id] || []);
    c._rows = rows;
    c._nPos = rows.length;
    c._rank = rows.reduce((m, r) => Math.max(m, roleRank(r._role)), 0);
    c._posLine = positionLine(rows);
    if (rows.some(r => !r.FinishDate && r.IsCurrent)) c._isCurrent = true;
  });
  return list;
}

/* ---------- bills ---------- */
async function ensureStatuses() {
  if (state.statuses) return state.statuses;
  let sts = null;
  try { sts = (await dataset("bills")).statuses; } catch (e) { /* fall through */ }
  if (!sts) { try { sts = await od(PARL, "KNS_Status()?$top=200"); } catch (e) { sts = []; } }
  const map = {};
  (sts || []).forEach(s => { map[s.StatusID] = s.Desc; });
  return state.statuses = map;
}

/* which pile does this status text belong to? The exact wording is shown on
   every row, so a miss here is visible, never hidden. */
function billBucket(desc) {
  const s = String(desc || "");
  if (/התקבלה|פורסמ.*רשומות/.test(s)) return "passed";
  if (/נדח|הסרה|הוסר|נעצר|בוטל|מבוטל|נסגר/.test(s)) return "rejected";
  return "process";
}

async function loadBills(sel, seq) {
  let out = { bills: [], total: 0 };
  try {
    const stP = ensureStatuses();
    if (!sel.personIds.length) sel.personIds = await fallbackPersonIds(sel.name);
    // every bill id they are signed on. NOTE: this service answers at most 100
    // rows per page whatever $top says — page with $skip until a short page.
    let inits = [];
    for (const pid of sel.personIds) {
      for (let skip = 0; skip < 1200; skip += 100) {
        const rows = await od(PARL,
          `KNS_BillInitiator()?$filter=PersonID eq ${+pid}&$skip=${skip}&$top=100&$select=BillID,IsInitiator,Ordinal`);
        inits.push(...rows);
        if (rows.length < 100) break;
      }
    }
    const lead = {};   // BillID → they were the lead sponsor (Ordinal 1 / IsInitiator)
    inits.forEach(r => {
      if (r.BillID && (r.IsInitiator === true || +r.Ordinal === 1))
        lead[r.BillID] = true;
    });
    const bids = [...new Set(inits.map(r => r.BillID).filter(Boolean))];
    // batch the lookups, 10 ids per request, 4 requests at a time
    const batches = [];
    for (let i = 0; i < bids.length; i += 10) batches.push(bids.slice(i, i + 10));
    const bills = [];
    let bi = 0;
    const worker = async () => {
      while (bi < batches.length) {
        if (state.seq !== seq) return;
        const f = batches[bi++].map(b => `BillID eq ${+b}`).join(" or ");
        const rows = await od(PARL,
          `KNS_Bill()?$filter=${f}&$select=BillID,Name,SubTypeID,SubTypeDesc,StatusID,KnessetNum,LastUpdatedDate&$top=10`).catch(() => []);
        bills.push(...rows);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker));
    const statuses = await stP;
    bills.forEach(b => {
      b._status = statuses[b.StatusID] || "";
      b._bucket = billBucket(b._status);
      b._lead = !!lead[b.BillID];
    });
    bills.sort((a, b) => (dateOf(b.LastUpdatedDate) || 0) - (dateOf(a.LastUpdatedDate) || 0));
    out = { bills, total: bids.length };
  } catch (e) { debug("bills: " + e.message); }
  if (state.seq !== seq) return;
  state.bills = out;
  renderBills();
  renderTiles();
}

/* ---------- the voting record ---------- */
const voteTime = r => {
  const d = dateOf(r && r.VoteDate);
  if (!d) return 0;
  let t = d.getTime();
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

/* the reservation marathons: same bill, same day → one entry; the first
   (latest) vote in the group is the decisive one — same rule as votes.html */
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

function resClass(title) {
  const s = String(title || "");
  if (s.includes("בעד")) return "for";
  if (s.includes("נגד")) return "against";
  if (s.includes("נמנע")) return "abstain";
  return "none";
}

/* one Knesset's record for the selected person (cached) */
async function loadMkVotes(kId, seq) {
  if (state.votesByK[kId]) return;
  state.votesByK[kId] = "loading";
  renderVotesSec();
  let groups = [];
  try {
    const entry = (state.sel.cmb || []).find(x => x.KnessetId === kId);
    const j = await kapi("GetVotesHeaders", { SearchType: 2, KnessetNum: kId, MkId: entry.Id });
    groups = groupVotes(rowsOf(j));
  } catch (e) { debug("mkvotes: " + e.message); }
  if (state.seq !== seq) return;
  state.votesByK[kId] = groups;
  renderVotesSec();
  renderTiles();
}

/* ✔/✘ + how THIS MK voted, for one group (cached on the group).
   Always settles: on failure _passed becomes null, never stays undefined. */
async function annotateOne(g) {
  if (!g || g._passed !== undefined) return;
  try {
    const v = g.votes[0];
    const j = await kapi("GetVoteDetails/" + (+v.VoteId));
    const hdr = (j && j.VoteHeader && j.VoteHeader[0]) || {};
    g._det = j;
    g._passed = hdr.IsForAccepted === true;
    const c = { for: 0, against: 0, abstain: 0 };
    ((j && j.VoteCounters) || []).forEach(x => {
      const k = resClass(x.Title);
      if (k in c) c[k] += +x.countOfResult || 0;
    });
    g._counts = c;
    // their own line in the breakdown — matched word-order-blind, like the search
    const words = (state.sel ? state.sel.key : "").split(" ").filter(Boolean);
    const mine = ((j && j.VoteDetails) || []).find(d => {
      const w2 = nameKey(d.MkName).split(" ").filter(Boolean);
      return words.length && words.every(x => w2.includes(x));
    });
    g._my = mine ? mine.Title : "";
  } catch (e) { g._passed = null; }
}

async function annotateGroups(groups, seq, onDone) {
  const todo = (groups || []).filter(g => g && g._passed === undefined);
  if (!todo.length) return;
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      if (state.seq !== seq) return;
      await annotateOne(todo[i++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  if (state.seq === seq && onDone) onDone();
}

/* ---------- the personal background (Mercy spotted it, 2026-08-25) ----------
   GetMkDetailsContent carries what the member reported to the Knesset:
   birth, immigration, residence, education, military/national service,
   profession, languages. Official, Hebrew-only, one GET per person. */
async function loadBio(sel, seq) {
  let bio = null;
  try {
    let mkId = sel._mkId || (sel.cmb[0] && sel.cmb[0].Id) || 0;
    if (!mkId) {
      const d = (await ensureDropdown())[sel.key];
      mkId = d ? d.ID : 0;
    }
    if (mkId) {
      bio = await viaRelay("https://knesset.gov.il/WebSiteApi/knessetapi/MKs/GetMkDetailsContent?mkId="
        + (+mkId) + "&languageKey=he");
    }
  } catch (e) { debug("bio: " + e.message); }
  if (state.seq !== seq) return;
  state.bio = bio;
  renderBio();
}

/* ---------- opening a person ---------- */
async function openPerson(c) {
  const seq = ++state.seq;
  state.sel = c;
  state.pick = null;
  state.positions = null; state.posAll = false;
  state.bills = null; state.billsOpen = {}; state.bio = null;
  state.votesByK = {}; state.vPage = 1;
  state.vK = c.cmb.length ? c.cmb[0].KnessetId : null;
  renderAll();
  // remember the person in the address bar, so the page can be linked/shared
  try {
    const u = new URL(location.href);
    u.searchParams.set("name", c.name);
    history.replaceState(null, "", u);
  } catch (e) { /* file:// quirks — never fatal */ }
  loadPositions(c, seq);
  loadBills(c, seq);
  loadBio(c, seq);
  if (state.vK !== null) loadMkVotes(state.vK, seq);
}
