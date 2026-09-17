"use strict";
/* =====================================================================
   votes.search.js — deciding WHICH votes to show
   Text matching, the plain search, the advanced search, paging and the
   background checks that verify results. Calls votes.data.js, then asks
   votes.view.js to redraw.
   ===================================================================== */
const normTxt = s => String(s ?? "")
  .replace(/[״"'׳`]/g, "")
  .replace(/[־–—]/g, "-")
  .replace(/\s+/g, " ")
  .trim();

function textMatch(hay, q) {
  const h = normTxt(hay), w = normTxt(q).split(" ").filter(Boolean);
  return w.length > 0 && w.every(x => h.includes(x));
}
/* the identifying core of a bill name: drop the boilerplate that vote titles
   spell differently (הצעת חוק / (תיקון מס' 3) / , התשפ״ה-2025) */
function billCore(name) {
  return normTxt(name)
    .replace(/^הצעת\s+חוק\s*/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/,?\s*הת[א-ת]*\s*-?\s*\d{4}.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* does this vote title belong to one of the person's bills? */
function matchesAnyBill(title, cores) {
  const c0 = billCore(title);
  if (!c0) return false;
  return (cores || []).some(c => c.length >= 6 && (c0.includes(c) || c.includes(c0)));
}

/* =====================================================================
   OUR VOTE INDEX (worker v7): every plenum vote 2003→today, in Cloudflare KV.
   The Knesset API only answers "votes between two dates", so searching the
   whole history through it means walking the calendar. Here we ask our own
   copy instead — one question, all the years. If the index isn't deployed
   yet, every call below returns null and the page falls back to the old
   window-walking behaviour.
   ===================================================================== */

/* ---------- recent votes ---------- */
async function loadVotes() {
  const box = document.getElementById("votes");
  try {
    let rows;
    try {
      // 1st choice: our snapshot dataset (survives Knesset outages)
      rows = (await dataset("votes")).rows || [];
    } catch (e) {
      debug("snapshot: " + e.message);
      const j = await kapi("GetVotesHeaders", {
        SearchType: 1, FromDate: isoDaysAgo(120), ToDate: isoDaysAgo(0)
      });
      rows = rowsOf(j);
    }
    state.groups = groupVotes(rows);
    renderVotes();
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`;
    debug("votes: " + e.message);
  }
}

/* the one list the page always shows: feed, filtered feed, an MK's votes,
   or an advanced-search result */

/* the one list the page always shows: feed, filtered feed, an MK's votes,
   or an advanced-search result */
/* Which filters can only be answered by asking about a vote one by one */
function needsChecking(a) {
  return !!(a && (a.initIds || (a.res && a.res !== "all") ||
                  (a.tp && a.tp !== "all" && !a.initCores)));
}
/* Has this vote been checked for every filter that needs it?
   An unchecked vote is NOT shown — showing it and removing it later is how a
   bill by somebody else stayed on screen. */
function checked(g, a) {
  if (a.initIds && g._initOk === undefined) return false;
  if (a.res && a.res !== "all" && g._passed === undefined) return false;
  if (a.tp && a.tp !== "all" && !a.initCores && (!g._bill || g._bill === "loading")) return false;
  return true;
}

function currentList() {
  if (state.mkSel) return state.mkSel.groups || [];
  if (state.advGroups) {
    const a = state.adv;
    let l = state.advGroups;
    if (needsChecking(a)) l = l.filter(g => checked(g, a));
    // _served: the index already filtered by text/initiator — don't filter twice
    if (a.law && !a._served) l = l.filter(g => textMatch(g.title, a.law));
    if (a.res === "passed") l = l.filter(g => g._passed === true);
    if (a.res === "failed") l = l.filter(g => g._passed === false);
    // the vote's own header names the bill it belongs to: keep only the person's
    // own bills (null = an archive vote, where no bill id exists to check)
    if (a.initIds) l = l.filter(g => g._initOk === true || g._initOk === null);
    if (a.initCores && !a._served) l = l.filter(g => matchesAnyBill(g.title, a.initCores));
    else if (!a.initCores && a.tp && a.tp !== "all") l = l.filter(g =>
      g._bill && g._bill !== "loading" && g._bill.subType === TPMAP[a.tp]);
    return l;
  }
  if (state.found) return state.found.groups;
  if (state.q) return (state.groups || []).filter(g => textMatch(g.title, state.q));
  return state.groups || [];
}

async function goPage(d) {
  if (d < 0) {
    if (state.page > 1) { state.page--; renderVotes(); }
    return;
  }
  const all = currentList();
  const pages = Math.max(1, Math.ceil(all.length / ROWS_PER_PAGE));
  const moreToCheck = state.advGroups && !state.advAllChecked;
  if (state.page < pages || moreToCheck) {
    state.page++;
    renderVotes();
    await fillPage(state.advSeq);          // top the new page up to a full one
    if (currentList().length <= (state.page - 1) * ROWS_PER_PAGE) state.page--;  // nothing more qualified
    renderVotes();
    return;
  }
  if (!state.q && !state.mkSel && !state.advGroups && !state.noMore) await loadOlder();
}

/* the feed's next page beyond what's loaded */
async function loadOlder() {
  if (await fetchOlderChunk()) state.page++;
  renderVotes();
}

/* A search that only looks at what's already on screen isn't a search.
   When nothing matches the loaded feed, walk backwards through older windows
   until something turns up (or we reach the edge of the current system). */
const DEEP_MAX_DAYS = 1080;   // ~3 years

async function deepenSearch(q) {
  if (state.noMore || state.maxDays >= DEEP_MAX_DAYS) {
    state.deepDone = true; renderVotes(); return;
  }
  const seq = ++state.deepSeq;
  const steps = Math.ceil((DEEP_MAX_DAYS - state.maxDays) / 120);
  state.deepWork = { done: 0, total: steps };
  state.deepDone = false;
  renderVotes();
  for (let s = 0; s < steps; s++) {
    if (state.deepSeq !== seq || state.q !== q) { state.deepWork = null; return; }
    await fetchOlderChunk();
    state.deepWork.done = s + 1;
    renderVotes();
    if (currentList().length || state.noMore) break;
  }
  if (state.deepSeq !== seq) return;
  state.deepWork = null;
  state.deepDone = !currentList().length;
  renderVotes();
}

async function doSearch() {
  const q = document.getElementById("q").value.trim();
  // any advanced filter set → the one search button runs the advanced path,
  // with the main bar's text as the law filter
  const hasAdv = document.getElementById("advmk").value.trim() ||
    document.getElementById("advinit").value.trim() ||
    document.getElementById("advtype").value !== "all" ||
    document.getElementById("advfrom").value || document.getElementById("advto").value ||
    document.getElementById("advresult").value !== "all";
  if (hasAdv) return advSearch();
  if (!q) return clearSearch();
  state.q = q; state.mkSel = null; state.page = 1;
  state.adv = null; state.advGroups = null; state.advPickList = null; state.found = null;
  state.advWork = null; state.advCursor = 0; state.advAllChecked = false;
  state.deepDone = false; state.deepSeq++;
  renderVotes();

  // Ask the index and the MK directory AT THE SAME TIME. Waiting for the
  // directory first made every search pay for a request it doesn't need.
  document.getElementById("votes").innerHTML = `<div class="loading">${esc(t("searchingAll"))}</div>`;
  const hitsP = idxMeta().then(idx => idx ? idxSearch([q], {}) : null).catch(() => null);
  const mksP = ensureCmb().then(cmb => matchMks(q, cmb)).catch(e => { debug("mks: " + e.message); return []; });

  const hits = await hitsP;
  if (state.q !== q) return;          // a newer search took over
  const mks = await mksP;
  if (state.q !== q) return;
  state.res = { mks };

  // auto-detect a person: exactly one MK matches and no law title does →
  // open their voting record directly, no extra click
  const lawMatches = hits ? hits.rows.length
    : (state.groups || []).filter(g => textMatch(g.title, q)).length;
  if (mks.length === 1 && !lawMatches) return mkOpenObj(mks[0]);
  // several people match and no laws do → this is a job for the advanced search
  if (mks.length > 1 && !lawMatches) {
    state.q = ""; state.res = null;
    document.getElementById("q").value = "";
    document.getElementById("advmk").value = q;
    toggleAdv(true);
    state.advPickList = { kind: "mk", list: mks };
    renderAdvPick();
    return;
  }
  if (hits) {
    state.found = { q, groups: groupsFromIndex(hits.rows), truncated: hits.truncated,
                    total: hits.rows.length };
    state.page = 1;
  }
  renderVotes();
  // no index yet, nothing here and nobody by that name → walk further back
  if (!hits && !lawMatches && !mks.length) deepenSearch(q);
}

function clearSearch() {
  state.q = ""; state.res = null; state.mkSel = null; state.page = 1;
  state.adv = null; state.advGroups = null; state.advPickList = null; state.found = null;
  state.advWork = null; state.advCursor = 0; state.advAllChecked = false;
  state.deepWork = null; state.deepDone = false; state.deepSeq++;
  document.getElementById("q").value = "";
  renderVotes();
}

async function mkOpen(idx) { return mkOpenObj(state.res.mks[idx]); }

async function mkOpenObj(mk) {
  state.mkSel = { mk, groups: null };
  state.page = 1;
  renderVotes();
  try {
    const j = await kapi("GetVotesHeaders", { SearchType: 2, KnessetNum: mk.KnessetId, MkId: mk.Id });
    state.mkSel.groups = groupVotes(rowsOf(j));
  } catch (e) {
    state.mkSel.groups = [];
    debug("mk: " + e.message);
  }
  renderVotes();
}

function advPick(i) {
  const p = state.advPickList;
  const x = p.list[i];
  state.advPickList = null;
  if (p.kind === "mk") {
    document.getElementById("advmk").value = x.Name;
    advSearch(x);
  } else {
    document.getElementById("advinit").value = x;
    advSearch();
  }
}

async function advSearch(mkObj) {
  const law = document.getElementById("q").value.trim();
  const name = document.getElementById("advmk").value.trim();
  const from = document.getElementById("advfrom").value;
  const to = document.getElementById("advto").value;
  const res = document.getElementById("advresult").value;

  state.q = ""; state.res = null; state.mkSel = null; state.advPickList = null; state.found = null;
  const box = document.getElementById("results");
  box.style.display = "block";
  box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;

  // resolve the person, if one was named
  let mk = mkObj || null;
  if (!mk && name) {
    try {
      const matches = matchMks(name, await ensureCmb());
      if (!matches.length) { box.innerHTML = `<div class="error">${esc(t("advNoMk"))}</div>`; return; }
      if (matches.length > 1) { state.advPickList = { kind: "mk", list: matches }; renderAdvPick(); return; }
      mk = matches[0];
    } catch (e) { box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`; return; }
  }

  const tp = document.getElementById("advtype").value;

  // "proposed by": start from the PERSON's bills. The type filter is applied
  // here, on the bills themselves — not by inspecting every vote one by one.
  let initChosen = "", initCores = null, initBills = null, initTotal = 0, initIds = null;
  const initN = document.getElementById("advinit").value.trim();
  if (initN) {
    try {
      await ensureStatuses();
      const r = await personBills(initN);
      if (!r) { box.innerHTML = `<div class="error">${esc(t("advNoMk"))}</div>`; return; }
      if (r.pick) { state.advPickList = { kind: "init", list: r.pick }; renderAdvPick(); return; }
      initChosen = r.chosen; initTotal = r.total;
      initBills = r.bills;
      if (tp !== "all") initBills = initBills.filter(b => +b.SubTypeID === +tp);
      initCores = initBills.map(b => billCore(b.Name)).filter(c => c.length >= 6);
      initIds = new Set(initBills.map(b => +b.BillID).filter(Boolean));
    } catch (e) { box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`; return; }
  }

  // normalize the range: swap if inverted. With the index, an empty date field
  // means EVERYTHING — no hidden default. Without it we must bound the range,
  // because every window is a live request to the Knesset.
  const idx = await idxMeta();
  const shiftDays = (iso, d) => new Date(new Date(iso + "T12:00:00").getTime() + d * 864e5).toISOString().slice(0, 10);
  let fromEff = from, toEff = to;
  if (fromEff && toEff && fromEff > toEff) [fromEff, toEff] = [toEff, fromEff];
  const canIndex = idx && !mk && (initCores || law);
  if (!canIndex) {
    if (!fromEff) fromEff = toEff ? shiftDays(toEff, -365) : isoDaysAgo(365);
    if (!toEff) toEff = isoDaysAgo(0);
  }

  const seq = ++state.advSeq;
  try {
    let rows, groups = null, served = false, truncated = false;
    if (canIndex) {
      // one question to our own copy, covering every year we hold
      box.innerHTML = `<div class="loading">${esc(t("searchingAll"))}</div>`;
      const phrases = initCores ? initCores.slice(0, 40) : [law];
      const r = await idxSearch(phrases, { from: fromEff, to: toEff });
      if (state.advSeq !== seq) return;
      if (r) { groups = groupsFromIndex(r.rows); served = true; truncated = r.truncated; }
    }
    if (!groups) {
      if (mk) {
        rows = rowsOf(await kapi("GetVotesHeaders", { SearchType: 2, KnessetNum: mk.KnessetId, MkId: mk.Id }));
      } else {
        // current system for dates after mid-2021; the frozen archive before it
        rows = [];
        if (toEff > OLD_MAX)
          rows = await fetchVotesRange(fromEff > OLD_MAX ? fromEff : OLD_MAX, toEff);
        if (fromEff <= OLD_MAX)
          rows = rows.concat(await fetchOldVotes(fromEff, toEff < OLD_MAX ? toEff : OLD_MAX));
      }
      if (state.advSeq !== seq) return;   // a newer search took over
      // safety net: enforce the range ourselves, whatever the API returned
      if (from || to) rows = rows.filter(r => {
        const d = String(r.VoteDate || "").slice(0, 10);
        return d >= fromEff && d <= toEff;
      });
      groups = groupVotes(rows);
    }
    state.adv = { law, mk, from: fromEff, to: toEff, res, tp,
                  init: initChosen, initCores, initBills, initTotal, initIds,
                  _served: served, truncated };
    state.advGroups = groups;
    // archive groups already know their outcome — no extra fetch needed
    state.advGroups.forEach(g => {
      if (g.votes[0] && g.votes[0]._old) {
        const r = g.votes[0]._raw;
        g._old = true;
        g._passed = r.is_accepted === 1;
        g._counts = { for: +r.total_for || 0, against: +r.total_against || 0, abstain: +r.total_abstain || 0 };
      }
    });
    state.page = 1;
    state.advWork = null;
    renderVotes();
    // the result filter needs every group inspected; the type filter only when
    // no person was named (with a person, their bills already carry the type)
    const need = { res: res !== "all", tp: tp !== "all" && !initCores, init: initIds };
    state.advCursor = 0; state.advAllChecked = false;
    fillPage(seq);   // checks only as far as this page needs
  } catch (e) {
    if (state.advSeq !== seq) return;
    box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`;
    debug("adv: " + e.message);
  }
}
/* ---------- checking candidates: only as many as this page needs ----------
   Each check costs one request to the Knesset (the vote's own detail), so we
   walk the candidates in small batches and STOP as soon as the current page is
   full. Moving to the next page continues from exactly where we left off. */
const CHECK_BATCH = 12;

async function checkOne(g, a) {
  const needBill = a.tp && a.tp !== "all" && !a.initCores;
  try {
    // The vote's DETAILS are what name the bill behind it — so the type filter
    // needs them just as much as the result filter does. Without this, a search
    // by סוג alone never learned which bill a vote belonged to and therefore
    // matched nothing, ever.
    if (a.initIds || needBill || (a.res && a.res !== "all")) await annotateOne(g);
    if (a.initIds || needBill) {
      const v0 = g.votes[0];
      if (v0 && v0._old) await oldItemId(v0);
    }
    if (a.initIds) {
      // the exact join: modern votes name their bill in the header, archive
      // votes in sess_item_id — either way we compare ids, never names
      const bid = billItemIdOf(g);
      g._initOk = bid ? a.initIds.has(bid) : null;   // null = no id at all, name match only
    }
    if (needBill) await loadBillInfo(g);
  } catch (e) { /* annotateOne / loadBillInfo always settle the group */ }
}

async function fillPage(seq) {
  const a = state.adv;
  if (!a || !state.advGroups || !needsChecking(a)) { state.advWork = null; return; }
  const want = state.page * ROWS_PER_PAGE + 1;      // +1 so the pager knows if more exist
  while (currentList().length < want && (state.advCursor || 0) < state.advGroups.length) {
    if (state.advSeq !== seq) return;
    const from = state.advCursor || 0;
    const batch = state.advGroups.slice(from, from + CHECK_BATCH);
    state.advCursor = from + batch.length;
    state.advWork = { done: state.advCursor, total: state.advGroups.length };
    renderVotes();
    await Promise.all(batch.map(g => checkOne(g, a)));
    if (state.advSeq !== seq) return;
    renderVotes();
  }
  state.advWork = null;
  state.advAllChecked = (state.advCursor || 0) >= state.advGroups.length;
  renderVotes();
}

function advClear() {
  ["advmk", "advinit", "advfrom", "advto"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("advresult").value = "all";
  document.getElementById("advtype").value = "all";
  state.adv = null; state.advGroups = null; state.advPickList = null;
  state.advWork = null; state.advCursor = 0; state.advAllChecked = false; state.advSeq++;
  state.deepWork = null; state.deepDone = false;
  state.page = 1;
  doSearch(); // falls back to the plain search, or the feed if the bar is empty
}

const TPMAP = { "54": "פרטית", "53": "ממשלתית" };

/* person name → every bill they put their name to (name, type, status).
   One trip through the OData tables; the answer drives BOTH the "proposed by"
   filter and the fallback that shows the bills themselves. */
