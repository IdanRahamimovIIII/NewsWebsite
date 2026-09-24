"use strict";
/* =====================================================================
   mk.data.js — everything the portfolio page fetches. Nothing here draws.

   People come from TWO official directories that use different id spaces:
     - the votes API (GetVotesCmbData): MkId per Knesset — voting records
     - the OData persons table (our /data/persons snapshot): PersonID —
       bills (KNS_BillInitiator) and positions (KNS_PersonToPosition)
   The bridge between them is the person's NAME, matched word-order-blind
   (one stores "לפיד יאיר", the other "יאיר לפיד").

   Sections (search for "N. " to jump):
     1. setup + state
     2. directories + names   (cmb, persons, dropdown, KNS_Person fallback, photos)
     3. positions             (fetching, tidying the register, role weights)
     4. the directory grid    (build, rank, infinite scroll, cards, lazy fills)
     5. search                (word matching, filtering the grid, fetching by name)
     6. bills + documents
     7. the voting record
     8. personal background
     9. opening a person
   Everything measured about the APIs is in NOTES.md.
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

/* =====================================================================
   1. STATE
   ===================================================================== */

const state = {
  sel: null,            // the chosen person: {name, key, cmb:[{Id,KnessetId}], personIds}
  cmb: null, persons: null, posNames: null, statuses: null, dropdown: null,
  positions: null, posAll: false,
  bills: null,
  billPile: "",                 // the ONE pile on screen (radio, Mercy); "" = pick the default
  billQ: "", billShown: 20,     // the name search, and how many rows are on screen
  votesByK: {},         // KnessetId → groups (each: title, date, votes[])
  vK: null,             // the Knesset whose record is on screen
  vPage: 1,
  voteQ: "",            // the votes search (by subject), inside the chosen Knesset
  seq: 0,               // a newer selection cancels older loads
};

window.onLangChange = () => { syncEntityLang(); renderAll(); };

/* =====================================================================
   2. DIRECTORIES + NAMES
   ===================================================================== */

/* ---- the two directories ----
   Both are cached as PROMISES, not results: the directory is drawn at load
   AND redrawn when the photo manifest lands, and the live search fires on
   every keystroke — the second caller must join the first request, not
   start a second one (GetVotesCmbData is the biggest payload on the page). */
function ensureCmb() {
  if (!state._cmbP) state._cmbP = kapi("GetVotesCmbData")
    .then(j => (state.cmb = j))                       // state.cmb stays the plain result (enrichCheap reads it)
    .catch(e => { state._cmbP = null; throw e; });    // a failed load may be retried
  return state._cmbP;
}
function ensurePersons() {
  if (!state._personsP) state._personsP = dataset("persons")
    .then(d => (state.persons = d || {}))
    .catch(e => { debug("persons: " + e.message); return (state.persons = {}); });
  return state._personsP;
}

/* name → a stable key: the words, sorted. "לפיד יאיר" and "יאיר לפיד" meet. */
const nameKey = s => String(s || "").split(/\s+/).filter(Boolean).sort().join(" ");
const nameHas = (nm, words) => words.every(w => String(nm || "").includes(w));

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

/* ---- MKs/GetMksDropdown: who is current (light: one GET, cached) ---- */
async function ensureDropdown() {
  if (state.dropdown) return state.dropdown;
  const map = {};
  try {
    const list = await viaRelay("https://knesset.gov.il/WebSiteApi/knessetapi/MKs/GetMksDropdown?languageKey=he");
    (list || []).forEach(m => { map[nameKey(m.Name)] = { ID: m.ID, IsCurrent: !!m.IsCurrent }; });
  } catch (e) { debug("dropdown: " + e.message); }
  return state.dropdown = map;
}

/* ---- photos ----
   Official MK photos, collected ONCE by the pipeline's get-photos.bat
   (Mercy's call: a one-time collection refreshed after each
   election beats hotlinking a pattern that can change or start blocking).
   The site keeps NO photos of its own (Mercy: everything the
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

/* =====================================================================
   3. POSITIONS
   ===================================================================== */

/* ---- KNS_Position: PositionID → role name (paged; the service caps a page at 100) ---- */
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

/* ---- positions per person (batched, cached per PersonID) — the profile's
   timeline and the directory cards both come through here. Chunks of 6
   PersonIDs per OR-filter, up to 3 chunks in flight — a screenful of
   directory cards (~24 people) is 4 queries, ~1s. */
const posCache = {};   // PersonID → rows (with _role resolved, tidied)

async function positionsForMany(pids) {
  const missing = [...new Set(pids)].filter(id => !(id in posCache));
  if (missing.length) {
    const namesP = ensurePosNames();
    const chunks = [];
    for (let i = 0; i < missing.length; i += 6) chunks.push(missing.slice(i, i + 6));
    let ci = 0;
    const worker = async () => {
      while (ci < chunks.length) {
        const chunk = chunks[ci++];
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
    };
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
  }
  const out = {};
  pids.forEach(id => { out[id] = posCache[id] || []; });
  return out;
}

/* every row of the register that matches a filter, all pages in parallel
   (the service caps a page at 100 rows; $count first, then the pages).
   Roles resolved like everywhere else. NOT tidied — these feed the ranking
   and the first-paint role line, not the timeline. */
async function bulkPositions(filter) {
  const [n, names] = await Promise.all([
    viaRelay(PARL + "KNS_PersonToPosition()/$count?$filter=" + filter).then(x => +x || 0),
    ensurePosNames(),
  ]);
  const skips = [];
  for (let s = 0; s < n; s += 100) skips.push(s);
  const rows = [];
  let i = 0;
  const worker = async () => {
    while (i < skips.length) {
      const skip = skips[i++];
      const page = await od(PARL, `KNS_PersonToPosition()?$filter=${filter}&$skip=${skip}&$top=100` +
        "&$select=PersonID,PositionID,KnessetNum,StartDate,FinishDate,GovMinistryName,DutyDesc,CommitteeName,FactionName,IsCurrent");
      rows.push(...page);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, skips.length) }, worker));
  rows.forEach(r => { r._role = r.DutyDesc || names[r.PositionID] || ""; });
  return rows;
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

/* the timeline's order (Mercy): everything they hold NOW first,
   heaviest role first, then the past newest-first as before */
function ongoingFirst(rows) {
  const start = r => { const d = dateOf(r.StartDate); return d ? d.getTime() : 0; };
  const now = rows.filter(r => !r.FinishDate)
    .sort((a, b) => roleRank(b._role) - roleRank(a._role) || start(b) - start(a));
  return now.concat(rows.filter(r => r.FinishDate));
}

/* ---- role weights ----
   How heavy a role is. The exact wording comes from the register (DutyDesc /
   KNS_Position.Description, which spells יושב–ראש with an en-dash). */
function roleRank(role) {
  const s = String(role || "").trim();
  if (s === "ראש הממשלה") return 100;
  if (/ראש הממשלה החלופי/.test(s)) return 92;
  if (/ממלא מקום ראש הממשלה|סגן ראש הממשלה/.test(s)) return 90;
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

/* generic roles earn their context; a named role speaks for itself */
function posCtx(r) {
  if (/ועד/.test(r._role) && r.CommitteeName) return `${r._role} · ${r.CommitteeName}`;
  if (/סיע/.test(r._role) && r.FactionName) return `${r._role} · ${r.FactionName}`;
  return r._role;
}

/* faction membership and the bare "חבר הכנסת" row are not roles of substance */
const plainRole = r => /סיע/.test(r._role) || /^חבר(ת)?\s*(ה)?כנסת$/.test(String(r._role || "").trim());
/* the heaviest role of substance they hold NOW, or "" (the cards and the
   portfolio header share this — one answer to "what are they today") */
function currentRole(rows) {
  const cur = (rows || []).filter(r => r._role && !plainRole(r) && !r.FinishDate)
    .sort((a, b) => roleRank(b._role) - roleRank(a._role));
  return cur.length ? posCtx(cur[0]) : "";
}

async function loadPositions(sel, seq) {
  let rows = [];
  try {
    // the same batched, per-person-cached fetch the cards use — a person
    // whose card was on screen costs nothing to open
    const byId = await positionsForMany(sel.personIds);
    rows = sel.personIds.flatMap(id => byId[id] || []);
  } catch (e) { debug("positions: " + e.message); }
  if (state.seq !== seq) return;
  state.positions = ongoingFirst(tidyPositions(rows));
  renderPositions();
  renderHead();   // the hero's faction + tenure line feeds off the positions
}

/* =====================================================================
   4. THE DIRECTORY GRID
   ===================================================================== */

/* ---- what a card shows and where it comes from ----
   (Mercy: "like a profile on social media" — photo in the middle,
   name, then party · years · last role · bills count.)
   What the card shows and where it comes from, cheapest first:
     party   — GetVotesCmbData carries a Factions table and each member's
               faction_id (measured: 16 factions in K25). Free.
     years   — first Knesset they appear in (cmb.Knessets has KnessetStart)
               … refined to the register's earliest StartDate once positions
               land (cmb only reaches back to K16 / 2003).
     role    — KNS_PersonToPosition, batched, only for cards that scrolled
               into view (an IntersectionObserver in the view asks dirWant()).
     laws    — bills they signed that BECAME LAW (Mercy: "law
               they wanted to pass that actually got passed"):
               KNS_BillInitiator/$count?$filter=PersonID eq N and
               (KNS_Bill/StatusID eq 118 …) — the passed statuses are the
               ones billBucket() calls "passed", so the card and the
               profile's pile agree. One small GET per member (~0.5s via the
               relay, measured; cross-checked bill-by-bill on 965: 6 of 31),
               again only for visible cards, 4 in flight. The firewall in
               front of the OData service answers 473 "access denied" to
               any()/all() lambdas — a navigation PATH in the filter is what
               works. A relay snapshot would make this free — a pipeline
               job, noted for v2. */

/* the official faction string, fit for a card: trailing spaces gone, the
   "בראשות <leader>" suffix dropped, and Shas by the name everyone uses
   (its registered name is 14 words long) */
function factionShort(name) {
  let s = String(name || "").trim();
  if (!s) return "";
  if (/התאחדות הספרדים/.test(s)) return 'ש"ס';
  s = s.replace(/\s*[-–]?\s*בראשות\s.*$/, "").trim();
  return s;
}

/* ---- the importance order (Mercy) ----
   1 serving now · 2 tier: PM → alternate/deputy PM → Knesset Speaker →
   opposition leader → minister → deputy minister → committee chair →
   former minister (most recent ministry first) → everyone else ·
   3 for those who left: last year in the Knesset · 4 name.
   Inputs: every register row of the current Knesset (who holds what now,
   who left and when) + every ministry row since K16 (who WAS a minister,
   and when last). Both fetched in bulk at load — ~17 small requests. */
const isMkRow = r => /^חבר(ת)?\s*(ה)?כנסת$/.test(String(r._role || "").trim());
const isDeputyish = r => /סגן|סגנית|ממלא מקום|מ"מ/.test(String(r._role || ""));
const isMinisterRow = r => !!r.GovMinistryName && !isDeputyish(r);   // the PM's rows count too
/* For the CURRENT Knesset the tier comes from the roles held NOW (open-ended
   rows); for an EARLIER Knesset's block (infinite scroll) from
   the roles held at any point DURING that Knesset — nobody there is
   "serving", so the same tiers just order the block. */
function dirRank(e, drop, past, kEnd) {
  const role = r => String(r._role || "").trim();
  const open = past ? e.k25 : e.k25.filter(r => !r.FinishDate);
  const has = re => open.some(r => re.test(role(r)));
  const d = drop[e.key];
  e.serving = !past && (!!(d && d.IsCurrent) || open.some(isMkRow));
  e.lastMin = 0;
  if (open.some(r => role(r) === "ראש הממשלה")) e.tier = 10;
  else if (has(/ראש הממשלה החלופי|ממלא מקום ראש הממשלה|סגן ראש הממשלה/)) e.tier = 9;
  else if (open.some(r => /יושב(ת)?[-–\s]?ראש הכנסת/.test(role(r)) && !isDeputyish(r))) e.tier = 8;
  else if (has(/ראש האופוזיציה/)) e.tier = 7;
  else if (open.some(isMinisterRow)) e.tier = 6;
  else if (has(/^סגנ(ית)?\s*שר|סגן שר/)) e.tier = 5;
  else if (open.some(r => /יושב(ת)?[-–\s]?ראש\s*ועד|יו"ר\s*ועד/.test(role(r)) && !isDeputyish(r))) e.tier = 4;
  else {
    const past = [...e.k25, ...e.minRows].filter(r => isMinisterRow(r) && r.FinishDate);
    if (past.length) { e.tier = 3; e.lastMin = Math.max(...past.map(r => yearOf(r.FinishDate) || 0)); }
    else e.tier = 0;
  }
  const ends = e.k25.map(r => yearOf(r.FinishDate) || 0);
  // the last year in office: the latest FinishDate in that Knesset's rows,
  // else the Knesset's own end (someone the register has no rows for)
  e.lastK = e.serving ? 9999 : (ends.length ? Math.max(...ends) : ((kEnd && kEnd[e.block]) || 0));
}
/* after the current Knesset: everyone else by the last year they were in
   office, newest first (Mercy), then the tiers, then name */
const tailOrder = (a, b) =>
  (b.lastK - a.lastK) || (b.tier - a.tier) || (b.lastMin - a.lastMin) ||
  String(a.m.Name).localeCompare(String(b.m.Name), "he");
const dirOrder = (a, b) =>
  ((b.serving ? 1 : 0) - (a.serving ? 1 : 0)) ||
  (b.tier - a.tier) ||
  (b.lastMin - a.lastMin) ||
  (b.lastK - a.lastK) ||
  String(a.m.Name).localeCompare(String(b.m.Name), "he");   // surname first, the cmb form

/* cached as a PROMISE (like ensureCmb): the directory is asked for at load
   AND when the photo manifest lands; two concurrent builds once raced — the
   later one built its block against a page that already showed everyone,
   got an empty block, and overwrote the directory with it (seen live
   once: the 25th Knesset vanished, the 24th loaded undeduplicated). */
function buildDirectory() {
  if (!state._dirP) state._dirP = buildDirectoryOnce().catch(e => { state._dirP = null; throw e; });
  return state._dirP;
}
async function buildDirectoryOnce() {
  const [cmb, persons, drop] = await Promise.all([ensureCmb(), ensurePersons(), ensureDropdown()]);
  const mks = cmb.MKS || [];
  const latest = Math.max(...mks.map(m => +m.KnessetId || 0), 0);
  const [k25, minRows] = await Promise.all([
    bulkPositions(`KnessetNum eq ${latest}`).catch(e => { debug("dir-k25: " + e.message); return []; }),
    bulkPositions(`GovMinistryID ne null and KnessetNum ge 16 and KnessetNum lt ${latest}`)
      .catch(e => { debug("dir-min: " + e.message); return []; }),
  ]);
  const minByPid = {};
  minRows.forEach(r => { (minByPid[r.PersonID] = minByPid[r.PersonID] || []).push(r); });
  const kStart = {}, kEnd = {}, fName = {}, pidByKey = {}, firstK = {};
  (cmb.Knessets || []).forEach(k => { kStart[k.KnessetId] = yearOf(k.KnessetStart); kEnd[k.KnessetId] = yearOf(k.KnessetEnd); });
  (cmb.Factions || []).forEach(f => { fName[f.ID] = f.FactionName; });
  for (const [pid, nm] of Object.entries(persons)) (pidByKey[nameKey(nm)] = pidByKey[nameKey(nm)] || []).push(+pid);
  mks.forEach(m => { const k = nameKey(m.Name); firstK[k] = Math.min(firstK[k] || 99, +m.KnessetId || 99); });
  /* who is this, in the persons table? Exact word-set match first. When
     that misses (6 of 151 in K25, measured: "גנץ בני" is
     "בנימין גנץ", "סטרוק אורית" is "אורית מלכה סטרוק", "סגלוביץ" carries an
     apostrophe, "פינדרוס יצחק זאב" / "מלקו צגה צגנש" have an extra word),
     a tolerant pass: apostrophes and quotes ignored, every word of the
     SHORTER name must appear in the longer one, each word used once, at
     least one of them an exact match (a 3+-letter word may otherwise match
     as a prefix: בני ~ בנימין — but "אליסף אליעזר" must NOT ride on "אלי"
     twice, which is what a looser rule did on the first live run).
     And whenever more than one PersonID answers — two "אלי כהן"s, two
     "ישראל כץ"s — the register decides: the one with rows in THIS Knesset
     is the sitting member. */
  const plain = s => String(s || "").replace(/['"׳״]/g, "");
  const wordsOf = s => plain(s).split(/\s+/).filter(Boolean);
  const prefixFits = (a, b) => a.length >= 3 && b.length >= 3 && (b.startsWith(a) || a.startsWith(b));
  const looseMatch = (cmbName, personName) => {
    const A = wordsOf(cmbName), B = wordsOf(personName);
    const [short, long] = A.length <= B.length ? [A, B] : [B.slice(), A.slice()];
    if (short.length < 2) return false;
    const pool = long.slice();
    let exact = 0;
    for (const w of short) {
      let i = pool.indexOf(w);
      if (i >= 0) exact++;
      else i = pool.findIndex(x => prefixFits(w, x));
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return exact >= 1;
  };
  const personEntries = Object.entries(persons);
  /* one Knesset's block of cards: its members (minus anyone already on the
     page), resolved, ranked, sorted. `kRows` = that Knesset's register rows
     (bulk). Used for the current Knesset at load and for each earlier one
     the infinite scroll appends. */
  const buildBlock = async (k, kRows, past) => {
    const byPid = {};
    kRows.forEach(r => { (byPid[r.PersonID] = byPid[r.PersonID] || []).push(r); });
    const resolvePids = (cmbName) => {
      let pids = pidByKey[nameKey(cmbName)] || [];
      if (!pids.length) pids = personEntries.filter(([, nm]) => looseMatch(cmbName, nm)).map(([pid]) => +pid);
      const inThisK = pids.filter(id => byPid[id]);
      return (inThisK.length ? inThisK : pids).slice(0, 3);
    };
    const shown = new Set((state._dir || []).map(e => e.key));
    const seen = {};
    const block = mks.filter(m => m.KnessetId === k)
      .filter(m => seen[m.Name] ? false : (seen[m.Name] = true))
      .filter(m => !shown.has(nameKey(m.Name)))          // already on the page under a later Knesset
      .map(m => {
        const key = nameKey(m.Name);
        const personIds = resolvePids(m.Name);
        const seenK = {};
        // the entry doubles as the candidate openPerson() takes: {name, key, cmb, personIds}
        return {
          m, key, personIds, block: k,
          name: (personIds.length && persons[personIds[0]]) || m.Name,   // "יאיר לפיד", not "לפיד יאיר"
          cmb: mks.filter(x => nameKey(x.Name) === key).sort((a, b) => b.KnessetId - a.KnessetId)
            .filter(x => seenK[x.KnessetId] ? false : (seenK[x.KnessetId] = true))
            .map(x => ({ Id: x.Id, KnessetId: x.KnessetId })),
          faction: factionShort(fName[m.faction_id]),
          since: kStart[firstK[key]] || "",
          k25: personIds.flatMap(id => byPid[id] || []),        // their rows in THIS block's Knesset (bulk)
          minRows: personIds.flatMap(id => minByPid[id] || []), // their ministry rows before the current Knesset (bulk, at load)
          rows: undefined,     // full positions — undefined = not asked yet (lazy, per visible card)
          bills: undefined,    // laws passed — undefined = not asked yet, null = unknowable
        };
      });
    // the few names the persons snapshot spells differently (6 of 151 in K25,
    // measured): one try by KNS_Person, both word orders, BEFORE
    // ranking — without a PersonID they have no rows and would sink to the
    // bottom as if they had left
    await Promise.all(block.filter(e => !e.personIds.length).map(async e => {
      e.personIds = await fallbackPersonIds(e.name).catch(() => []);
      if (e.personIds.length && persons[e.personIds[0]]) e.name = persons[e.personIds[0]];
      e.k25 = e.personIds.flatMap(id => byPid[id] || []);
      e.minRows = e.personIds.flatMap(id => minByPid[id] || []);
    }));
    block.forEach(e => dirRank(e, drop, past, kEnd));
    block.sort(past ? tailOrder : dirOrder);
    return block;
  };
  /* a card for someone the grid doesn't hold — found by name: no bulk rows
     of a Knesset behind them, so the lazy per-card load fills role and
     years; placed by the last Knesset the votes directory lists them in */
  const makeEntry = (c) => {
    const lastCmb = c.cmb[0] || null;
    const pids = c.personIds.slice(0, 3);
    const key = c.key;
    const e = {
      m: { Id: lastCmb ? lastCmb.Id : 0, Name: c.name }, key, personIds: pids,
      block: lastCmb ? lastCmb.KnessetId : 0,
      name: (pids.length && persons[pids[0]]) || c.name,
      cmb: c.cmb,
      faction: factionShort(fName[(mks.find(m => lastCmb && m.Id === lastCmb.Id && m.KnessetId === lastCmb.KnessetId) || {}).faction_id]),
      since: kStart[firstK[key]] || "",
      k25: [], minRows: pids.flatMap(id => minByPid[id] || []),
      rows: undefined, bills: undefined,
    };
    dirRank(e, drop, true, kEnd);
    return e;
  };
  state._dirCtx = { buildBlock, makeEntry, latest, kStart, kEnd };
  state._dirNextK = latest - 1;      // the next Knesset the infinite scroll will append
  state._dir = await buildBlock(latest, k25, false);
  return state._dir;
}

/* ---- infinite scroll (Mercy): when the reader reaches the
   bottom, the previous Knesset's members (those not on the page yet) are
   fetched — one bulk query per Knesset, ~550 rows — and the whole tail
   after the current Knesset is re-sorted by the last year in office,
   newest first. Back to K16 (2003), where the votes directory ends. The
   array is sorted IN PLACE: its identity is what buildDirectory() resolved
   to, and every card's flags live on its entry. */
async function loadNextKnesset() {
  const ctx = state._dirCtx;
  if (!ctx || state._dirLoading || state._dirNextK < 16) return false;
  const k = state._dirNextK;
  state._dirLoading = true;
  try {
    const rows = await bulkPositions(`KnessetNum eq ${k}`).catch(e => { debug("dir-k" + k + ": " + e.message); return []; });
    const block = await ctx.buildBlock(k, rows, true);
    state._dir.push(...block);
    const cur = e => e.block === ctx.latest;
    state._dir.sort((a, b) => ((cur(b) ? 1 : 0) - (cur(a) ? 1 : 0)) || (cur(a) ? dirOrder(a, b) : tailOrder(a, b)));
    state._dirNextK = k - 1;
    return true;
  } finally { state._dirLoading = false; }
}

/* the card's role line: the heaviest CURRENT role of substance, else the
   last one with its years, else plain "חבר/ת הכנסת". Faction membership and
   the bare "חבר הכנסת" row are not substance — the party line already says
   that. Until the full history lands, this Knesset's rows (bulk, at load)
   answer — so the line is there at first paint; null only if neither is. */
function cardRole(e) {
  const rows = e.rows !== undefined ? e.rows : e.k25;
  if (rows === undefined) return null;
  const now = currentRole(rows);
  if (now) return now;
  // a sitting member with no role of substance today is "חבר/ת הכנסת" — the
  // current role always outranks a historical one (Mercy: a card
  // saying "סגן שר · 2022" next to "2019–היום" read as a contradiction).
  // The past role lives in the portfolio's timeline.
  if (e.serving) return t("posMember");
  const subst = rows.filter(r => r._role && !plainRole(r));
  const last = subst.slice().sort((a, b) => posFinish(b) - posFinish(a))[0];
  if (!last) return t("posMember");
  const y0 = yearOf(last.StartDate), y1 = yearOf(last.FinishDate);
  return posCtx(last) + (y0 ? ` · ${y0}${y1 && y1 !== y0 ? "–" + y1 : ""}` : "");
}

/* the card's years line: "2013–היום", or "2013–2025" for someone who left */
function cardYears(e) {
  let a = e.since;
  const rows = e.rows && e.rows.length ? e.rows : (e.k25 || []);
  const ys = rows.map(r => yearOf(r.StartDate)).filter(Boolean);
  if (ys.length) a = a ? Math.min(a, ...ys) : Math.min(...ys);
  if (!a) return "";
  // "היום" only for someone sitting in the current Knesset — the register
  // leaves rows open for people who are long gone, so an open row is not
  // enough (Mercy)
  if (e.serving) return `${a}–${t("untilNow")}`;
  const ends = rows.map(r => yearOf(r.FinishDate)).filter(Boolean);
  const b = ends.length ? Math.max(...ends) : (e.lastK && e.lastK !== 9999 ? e.lastK : "");
  return b ? `${a}–${b}` : String(a);
}

/* lazy enrichment: the view asks for the cards that scrolled into view;
   asks are pooled for 120ms so a screenful becomes a few batched queries */
const dirAsk = new Set();
let dirTimer = null;
function dirWant(i) {
  const e = (state._dir || [])[i];
  if (!e || e._asked) return;
  e._asked = true;
  dirAsk.add(e);
  clearTimeout(dirTimer);
  dirTimer = setTimeout(dirFlush, 120);
}
async function dirFlush() {
  const batch = [...dirAsk];
  dirAsk.clear();
  const pids = batch.flatMap(e => e.personIds);
  positionsForMany(pids).then(byId => {
    batch.forEach(e => { e.rows = e.personIds.flatMap(id => byId[id] || []); refreshDirCard(e); });
  }).catch(e => debug("dir-pos: " + e.message));
  batch.forEach(e => { if (e.personIds.length) billQ.push(e); else { e.bills = null; refreshDirCard(e); } });
  pumpBills();
}
const billQ = [];
let billBusy = 0;
function pumpBills() {
  while (billBusy < 4 && billQ.length) {
    const e = billQ.shift();
    billBusy++;
    countBills(e).finally(() => { billBusy--; pumpBills(); });
  }
}
async function countBills(e) {
  let n = 0;
  try {
    const statuses = await ensureStatuses();
    const passed = Object.entries(statuses).filter(([, d]) => billBucket(d) === "passed").map(([id]) => +id);
    if (!passed.length) throw new Error("no passed statuses known");
    const st = "(" + passed.map(id => `KNS_Bill/StatusID eq ${id}`).join(" or ") + ")";
    for (const pid of e.personIds)
      n += +(await viaRelay(PARL + `KNS_BillInitiator()/$count?$filter=PersonID eq ${+pid} and ${st}`)) || 0;
    e.bills = n;
  } catch (err) { e.bills = null; debug("dir-laws: " + err.message); }
  refreshDirCard(e);
}

/* =====================================================================
   5. SEARCH
   ===================================================================== */

/* does a directory entry match these words — by name, party or role?
   null = no; "" = by name; otherwise the line that matched ("שר החוץ ·
   2015–2019", or the party). Dashes and quote marks are normalized on both
   sides: the register writes "יושב–ראש" (en dash) for some rows and
   "יושב-ראש" for others, and people type a hyphen (Ohana, the sitting
   Speaker, was missed live). */
/* Matching is by WORDS, not substrings (Mercy, 2026-09-07 — "ראש ממשלה"
   was catching Ohana through the old faction name "הליכוד בהנהגת בנימין
   נתניהו לראשות הממשלה": "ראש" inside "לראשות"). Every query word must be a
   whole word of ONE text — a name, one role, or one faction name — allowing
   a Hebrew prefix on the text's word (ראש ~ הראש, ממשלה ~ הממשלה, ~ לממשלה);
   only the LAST query word, the one being typed, may also be a prefix of
   the text's word. Dashes split words ("יושב–ראש" → יושב, ראש), so the
   register's en dash and a typed hyphen meet. Anything that matches this
   way stays — the deputy PM for "ראש הממשלה" included; the card says why. */
const HEB_PREFIXES = ["", "ה", "ו", "ב", "ל", "מ", "ש", "כ", "וה", "וב", "ול", "ומ", "וש", "וכ", "שה", "שב", "של", "שמ", "מה", "כש", "וכש", "לכש"];
const tokensOf = s => String(s || "").replace(/[״"׳']/g, "").split(/[\s\-–—־·,()\/]+/).filter(Boolean);
const wordFits = (qw, tw, last) =>
  HEB_PREFIXES.some(p => tw === p + qw || (last && tw.startsWith(p + qw)));
const textFits = (text, qws) => {
  const tws = tokensOf(text);
  return qws.every((qw, i) => tws.some(tw => wordFits(qw, tw, i === qws.length - 1)));
};
function entryHit(e, words) {
  const qws = words.flatMap(w => tokensOf(w));
  if (!qws.length) return "";
  if (textFits(e.name + " " + ((e.m && e.m.Name) || ""), qws)) return "";          // by name — the card says it
  const yrs = r => { const y0 = yearOf(r.StartDate), y1 = r.FinishDate ? yearOf(r.FinishDate) : t("untilNow"); return y0 ? ` · ${y0}${y1 && y1 !== y0 ? "–" + y1 : ""}` : ""; };
  const rowsAll = [...(e.rows || []), ...(e.k25 || []), ...(e.minRows || [])]
    .sort((a, b) => posStart(b) - posStart(a));                                     // latest first
  // a role (substance first — a faction-membership row is "why" only through its faction name)
  const roleRow = rowsAll.find(r => !plainRole(r) && textFits(posCtx(r), qws));
  if (roleRow) return posCtx(roleRow) + yrs(roleRow);
  // a faction — the card's short party, or an official (often longer) faction name in a row
  if (textFits(e.faction, qws)) return "";                                          // the card says it
  const fRow = rowsAll.find(r => r.FactionName && textFits(r.FactionName, qws));
  if (fRow) return String(fRow.FactionName).trim() + yrs(fRow);
  const plainRow = rowsAll.find(r => plainRole(r) && textFits(posCtx(r), qws));    // "חבר הכנסת" for "חבר כנסת"
  if (plainRow) return posCtx(plainRow) + yrs(plainRow);
  return null;
}
/* the entries matching a query, with why each does */
function dirMatches(list, words) {
  const out = [];
  list.forEach((e, i) => { const hit = entryHit(e, words); if (hit !== null) out.push({ e, i, hit }); });
  return out;
}

/* the grid IS the search result (Mercy): typing filters the
   cards in place. Names the grid doesn't hold yet (people not scrolled to,
   or in the persons table only) are fetched by findCandidates and added
   to the grid as cards — in their place by last year in office — so there
   is one visual, never a second list. */
async function dirSearch(q) {
  const words = String(q || "").split(/\s+/).filter(Boolean);
  state.dirQ = words.join(" ");
  if (!words.length) return;
  const ctx = state._dirCtx;
  if (!ctx) return;
  const found = await findCandidates(q).catch(() => []);
  const have = new Set(state._dir.map(e => e.key));
  const extras = found.filter(c => !have.has(c.key) && c.personIds.length).map(c => ctx.makeEntry(c));
  if (!extras.length) return;
  state._dir.push(...extras);
  const cur = e => e.block === ctx.latest;
  state._dir.sort((a, b) => ((cur(b) ? 1 : 0) - (cur(a) ? 1 : 0)) || (cur(a) ? dirOrder(a, b) : tailOrder(a, b)));
}

/* every person the query matches — by NAME across both directories, and
   (Mercy) by PARTY or ROLE across the people the directory
   knows: the current Knesset's members with all their rows in it plus every
   ministry row since 2003, and anyone the infinite scroll has already
   appended. "שר החוץ" finds every foreign minister since 2003, "ליכוד" the
   whole faction. A match by party/role carries `_hit` — the line that
   matched — so the result can say why it is there.
   Returns [{name, key, cmb:[{Id,KnessetId}…newest first], personIds:[…]}]. */
async function findCandidates(q) {
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const [cmb, persons, dir] = await Promise.all([
    ensureCmb().catch(e => { debug("cmb: " + e.message); return { MKS: [] }; }),
    ensurePersons(),
    buildDirectory().catch(() => []),
  ]);
  const byKey = {};
  const claim = (name) => {
    const key = nameKey(name);
    return byKey[key] = byKey[key] || { name, key, cmb: [], personIds: [] };
  };
  (cmb.MKS || []).forEach(m => {
    if (!nameHas(m.Name, words)) return;
    const c = claim(m.Name);
    c._hit = "";
    c.cmb.push({ Id: m.Id, KnessetId: m.KnessetId });
  });
  for (const [pid, nm] of Object.entries(persons)) {
    if (!nameHas(nm, words)) continue;
    const c = claim(nm);
    c.name = nm;                      // prefer "יאיר לפיד" over "לפיד יאיר" for display
    if (c.personIds.length < 3) c.personIds.push(+pid);
  }
  // by party or role, over what the directory already holds — exact first
  dirMatches(dir || [], words).forEach(({ e, hit }) => {
    if (byKey[e.key]) return;                          // already found by name
    e._hit = hit;
    byKey[e.key] = e;                                   // the directory's own entry (openPerson takes it as is)
  });
  const out = Object.values(byKey);
  out.forEach(c => {
    if (c._hit === undefined || byKey[c.key] !== c) c._hit = c._hit || "";
    const seen = {};
    c.cmb = c.cmb.sort((a, b) => b.KnessetId - a.KnessetId)
      .filter(x => seen[x.KnessetId] ? false : (seen[x.KnessetId] = true));
  });
  // people who can actually show something first: current cmb presence, then breadth
  out.sort((a, b) => (b.cmb.length - a.cmb.length) || (b.personIds.length - a.personIds.length));
  return out.slice(0, 30);   // a whole faction can be that many
}

/* =====================================================================
   6. BILLS + DOCUMENTS
   ===================================================================== */

/* ---- statuses: StatusID → text (from the /data/bills snapshot, else KNS_Status) ---- */
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
    // the undecided split by Knesset (Mercy): a bill of THIS
    // Knesset with no verdict is "בתהליך"; one from an earlier Knesset never
    // got a verdict and never will — "לא הוכרעו", not "still pending"
    const latestK = Math.max(...(((state.cmb && state.cmb.MKS) || []).map(m => +m.KnessetId || 0)), 0);
    bills.forEach(b => {
      b._status = statuses[b.StatusID] || "";
      b._bucket = billBucket(b._status);
      if (b._bucket === "process") b._bucket = (latestK && +b.KnessetNum === latestK) ? "pending" : "stale";
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

/* ---- a bill's official documents (Mercy) ----
   KNS_DocumentBill: one row per file — GroupTypeDesc is the stage ("הצעת
   חוק לדיון מוקדם", "…לקריאה הראשונה", "…השנייה והשלישית", "חוק - פרסום
   ברשומות", "חומר רקע", "קטע מדברי הכנסת"), ApplicationDesc the format
   (PDF/DOC), FilePath the file on fs.knesset.gov.il (measured:
   public, 200 application/pdf; paths may carry a doubled slash after the
   host and even spaces — normalized here). A vote's VoteHeader.FK_ItemID
   is the BillID for a bill vote (verified: 2202055 ↔ the same Name), so
   the votes list can show the same documents. Cached per BillID. */
const docCache = {};
const docUrl = u => encodeURI(String(u || "").trim().replace(/^(https?:\/\/[^/]+)\/\/+/, "$1/"));
async function billDocs(billId) {
  const id = +billId;
  if (!id) return [];
  if (!docCache[id]) docCache[id] = od(PARL,
      `KNS_DocumentBill()?$filter=BillID eq ${id}&$select=GroupTypeDesc,ApplicationDesc,FilePath&$top=50`)
    .then(rows => {
      const groups = [], byType = {};
      rows.forEach(r => {
        if (!r.FilePath) return;
        const type = String(r.GroupTypeDesc || "").trim() || "—";
        if (!byType[type]) { byType[type] = { type, files: [] }; groups.push(byType[type]); }
        // the format from the file itself — the register labels a .pdf "PPT" now and then (seen live)
        const ext = (String(r.FilePath).match(/\.([a-z0-9]+)\s*$/i) || [])[1];
        const fmt = ext ? ext.toUpperCase().replace(/^DOCX$/, "DOC").replace(/^PPTX$/, "PPT").replace(/^XLSX$/, "XLS")
          : (String(r.ApplicationDesc || "").trim().toUpperCase() || "DOC");
        if (!byType[type].files.some(f => f.fmt === fmt)) byType[type].files.push({ fmt, url: docUrl(r.FilePath) });
      });
      return groups;
    })
    .catch(e => { debug("docs: " + e.message); delete docCache[id]; return null; });
  return docCache[id];
}

/* =====================================================================
   7. THE VOTING RECORD
   ===================================================================== */

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
  if (!g || g._passed !== undefined || g._busy) return;
  g._busy = true;   // a re-render mid-flight (opening a row) must not ask twice
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
  g._busy = false;
}

async function annotateGroups(groups, seq, onDone) {
  const todo = (groups || []).filter(g => g && g._passed === undefined && !g._busy);
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

/* =====================================================================
   8. PERSONAL BACKGROUND
   ===================================================================== */

/* ---- GetMkDetailsContent (Mercy spotted it) ----
   GetMkDetailsContent carries what the member reported to the Knesset:
   birth, immigration, residence, education, military/national service,
   profession, languages. Official, Hebrew-only, one GET per person. */
async function loadBio(sel, seq) {
  let bio = null;
  try {
    let mkId = (sel.cmb[0] && sel.cmb[0].Id) || 0;
    if (!mkId) {
      const d = (await ensureDropdown())[sel.key];
      mkId = d ? d.ID : 0;
    }
    if (mkId) {
      bio = await viaRelay("https://knesset.gov.il/WebSiteApi/knessetapi/MKs/GetMkDetailsContent?mkId="
        + (+mkId) + "&languageKey=he");
    }
  } catch (e) { debug("bio: " + e.message); }
  // (a gender for prose verbs is one GET away — KNS_Person GenderID 251 זכר /
  //  250 נקבה, measured — should the hero ever speak in sentences again)
  if (state.seq !== seq) return;
  state.bio = bio;
  renderTiles();   // the background table rides under the bills sentence
}

/* =====================================================================
   9. OPENING A PERSON
   ===================================================================== */

/* an entity address (/mk/<id>-<name>/, built by worker\pages.js) already
   names this person — nothing to push. window.MK_ENTITY = {id, lang, he,
   dir, url:{he,en}, title:{he,en}}; absent on the plain /mk/ page. */
const ENTITY = window.MK_ENTITY || null;
const atEntity = c => !!ENTITY && location.pathname !== ENTITY.dir &&
  !!c && (c.cmb || []).some(r => +r.Id === +ENTITY.id);

async function openPerson(c) {
  const seq = ++state.seq;
  state.sel = c;
  state.positions = null; state.posAll = false;
  state.bills = null; state.bio = null;
  state.billPile = ""; state.billQ = ""; state.billShown = 20;
  state.votesByK = {}; state.vPage = 1;
  state.vK = c.cmb.length ? c.cmb[0].KnessetId : null; state.voteQ = "";
  renderAll();
  // the person goes into the address bar (linkable/shareable) AND into the
  // browser history: a card click is a step the Back button must undo
  // (Mercy: Back used to leave the site — replaceState). When
  // the address already names them (a ?name= arrival, a popstate) there is
  // nothing to push.
  try {
    const u = new URL(location.href);
    if (u.searchParams.get("name") !== c.name && !atEntity(c)) {
      u.searchParams.set("name", c.name);
      history.pushState({ name: c.name }, "", u);
    }
  } catch (e) { /* file:// quirks — never fatal */ }
  loadBio(c, seq);
  if (state.vK !== null) loadMkVotes(state.vK, seq);
  // someone the persons snapshot missed (found only in the votes directory)
  // still has a PersonID in KNS_Person — resolve it ONCE, before both the
  // positions and the bills ask for it (positions used to be
  // asked with an empty id list and came back "no recorded positions")
  if (!c.personIds.length) {
    c.personIds = await fallbackPersonIds(c.name).catch(() => []);
    if (state.seq !== seq) return;
  }
  loadPositions(c, seq);
  loadBills(c, seq);
}
