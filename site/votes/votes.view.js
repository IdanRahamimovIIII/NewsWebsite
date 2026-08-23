"use strict";
/* =====================================================================
   votes.view.js — drawing the page
   Every piece of HTML the votes tab produces, plus the small interactions
   (expanding a row, the autocomplete, the advanced panel).
   ===================================================================== */

const ROWS_PER_PAGE = 40;  // rows per page of results

const passBadge = g =>
  g._passed === true ? `<span class="passed yes">${esc(t("passedYes"))}</span>`
  : g._passed === false ? `<span class="passed no">${esc(t("passedNo"))}</span>` : "";

const countsHtml = g => !g._counts ? "" :
  `<span class="chip"><span class="dot for"></span>${esc(t("forL"))} ${g._counts.for}</span>` +
  `<span class="chip"><span class="dot against"></span>${esc(t("againstL"))} ${g._counts.against}</span>` +
  `<span class="chip"><span class="dot abstain"></span>${esc(t("abstainL"))} ${g._counts.abstain}</span>`;

const resLabel = title => {
  if (lang === "he") return title;
  const c = resClass(title);
  return c === "for" ? t("forL") : c === "against" ? t("againstL")
       : c === "abstain" ? t("abstainL") : t("noVoteL");
};

/* ---------- Hebrew-friendly text matching ----------
   Official titles are punctuated ("חוק הגיוס, התשפ״ה-2025") and people type
   two words in any order — so compare on a normalized form, word by word. */

function renderVotes() {
  const box = document.getElementById("votes");
  const all = currentList();
  renderContext();
  if (!all.length) {
    state.shown = [];
    if (state.advWork) { box.innerHTML = workNote(); return; }          // still checking
    if (state.deepWork) { box.innerHTML = deepNote(); return; }         // widening the search
    if (state.mkSel && !state.mkSel.groups) { box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`; return; }
    box.innerHTML = emptyHtml();
    return;
  }
  const pages = Math.max(1, Math.ceil(all.length / ROWS_PER_PAGE));
  if (state.page > pages) state.page = pages;
  const list = all.slice((state.page - 1) * ROWS_PER_PAGE, state.page * ROWS_PER_PAGE);
  state.shown = list;
  let html = (state.advWork ? workNote() : state.deepWork ? deepNote() : "");
  html += list.map((g, i) => `<button class="vote${g._open ? " sel" : ""}" onclick="openGroup(${i})">
      <div class="vtitle">${g._open ? "▾" : "▸"} ${esc(g.title)}</div>
      <div class="vmeta"><span>${fmtDate(g.date)}</span>${passBadge(g)}${countsHtml(g)}${
        g._initOk === null ? `<span class="resnote">${esc(t("byNameOnly"))}</span>` : ""}</div>
    </button>` + (g._open ? groupDetailHtml(g, i) : "")).join("");
  // pager: within loaded pages; the feed reaches further back, and an advanced
  // search still has candidates waiting to be checked
  const canOlder = (!state.q && !state.mkSel && !state.advGroups && !state.found && !state.noMore)
    || (state.advGroups && !state.advAllChecked);
  if (pages > 1 || canOlder) {
    html += `<div class="pager">` +
      (state.page > 1 ? `<button class="votechip" onclick="goPage(-1)">${esc(t("prevPage"))}</button>` : "") +
      `<span>${esc(t("pageN").replace("{n}", state.page))}</span>` +
      (state.page < pages || canOlder ? `<button class="votechip" onclick="goPage(1)">${esc(t("nextPage"))}</button>` : "") +
      `</div>`;
  }
  box.innerHTML = html;
  // fill in ✔/✘ for the rows actually on screen (an advanced search does its
  // own checking, page by page — don't duplicate the requests here)
  if (!needsChecking(state.adv)) annotateGroups(list, renderVotes);
}

/* honest progress + empty states — a spinner that can never end is a bug */
const workNote = () => `<div class="loading">${esc(t(
  state.adv && state.adv.initIds ? "verifying" : "advProgress")
  .replace("{a}", state.advWork.done).replace("{b}", state.advWork.total))}</div>`;

const deepNote = () => `<div class="loading">${esc(t("deepening")
  .replace("{a}", state.deepWork.done).replace("{b}", state.deepWork.total))}</div>`;


function emptyHtml() {
  // an initiator search that found bills but no votes: show the bills — that IS the answer
  const a = state.adv || {};
  if (a.initBills && a.initBills.length) {
    const name = a.init || "";
    const shown = a.initsAll ? a.initBills : a.initBills.slice(0, 12);
    const list = shown.map(b =>
      `<div class="faction">• ${esc(b.Name)}${state.statuses[b.StatusID]
        ? ` <span class="names">— ${esc(state.statuses[b.StatusID])}</span>` : ""}</div>`).join("");
    const tpNote = a.tp && a.tp !== "all"
      ? " · " + t("initOfType").replace("{n}", a.initBills.length).replace("{tp}", TPMAP[a.tp]) : "";
    return `<div class="hint" style="margin:8px 0 4px"><b>${esc(t("initFound")
        .replace("{n}", a.initTotal || a.initBills.length).replace("{name}", name))}</b>${esc(tpNote)}</div>
      <div class="hint" style="margin:0 0 10px">${esc(t("initNoVotes"))}</div>
      <div style="margin:10px 0"><b>${esc(t("initSome").replace("{name}", name))}</b></div>
      ${list}
      ${a.initBills.length > 12 ? `<div style="margin-top:8px"><button class="votechip" onclick="state.adv.initsAll=!state.adv.initsAll;renderVotes()">${esc(t(a.initsAll ? "hideAll" : "showAll"))} (${a.initBills.length})</button></div>` : ""}
      <div style="margin-top:12px"><button class="votechip" onclick="goBillsFor(${JSON.stringify(name).replace(/"/g, "&quot;")})">${esc(t("initShowBills"))}</button></div>`;
  }
  if (state.deepDone) return `<div class="loading">${esc(t("deepNone"))}</div>`;
  return `<div class="loading">${esc(t(state.advGroups ? "emptyAdv" : "empty"))}</div>`;
}

/* jump to the bills tab with this person pre-filled — "what they brought to the table" */
function goBillsFor(name) {
  document.getElementById("binit").value = name;
  state.btabPickName = null; state.btabPickFor = null;
  const loaded = !!state.btab;   // setTab loads the tab (and searches) on first open
  setTab("bills");
  if (loaded) runBSearch();
}

/* the small line above the list while searching / viewing an MK */
function renderContext() {
  const box = document.getElementById("results");
  if (state.advPickList) return; // the pick-chips own this area right now
  if (!state.q && !state.mkSel && !state.advGroups && !state.found) { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  let html = "";
  if (state.advGroups && !state.mkSel) {
    const a = state.adv;
    const parts = [a.mk && a.mk.Name, a.init && `${t("advInit")} ${a.init}`,
      a.tp && a.tp !== "all" && TPMAP[a.tp], a.law && `"${a.law}"`,
      (!a.mk && a.from) && `${t("advRange")}: ${a.from} → ${a.to}`,
      a.res === "passed" ? t("passedOpt") : a.res === "failed" ? t("failedOpt") : ""].filter(Boolean);
    html = `<div class="hint" style="margin:0 0 10px"><b>${esc(t("advSummary"))}</b>: ${esc(parts.join(" · "))}
      <button class="votechip" style="margin-inline-start:8px" onclick="advClear()">${esc(t("clearBtn"))}</button></div>`;
    box.innerHTML = html;
    return;
  }
  if (state.mkSel) {
    html = `<div class="hint" style="margin:0 0 10px"><b>${esc(state.mkSel.mk.Name)}</b>
      <button class="votechip" style="margin-inline-start:8px" onclick="state.mkSel=null;renderVotes()">${esc(t("backToResults"))}</button></div>`;
  } else {
    const f = state.found;
    html = `<div class="hint" style="margin:0 0 10px">${esc(t("resultsFor"))} "<b>${esc(state.q)}</b>"` +
      (f ? ` · ${esc(t("idxHits").replace("{n}", f.total))}` : "") +
      `<button class="votechip" style="margin-inline-start:8px" onclick="clearSearch()">${esc(t("clearBtn"))}</button></div>` +
      (f && f.truncated ? `<div class="hint" style="margin:0 0 8px">${esc(t("idxTruncated"))}</div>` : "");
    const mks = (state.res && state.res.mks) || [];
    if (mks.length) {
      html += `<div class="hint" style="margin:0 0 8px"><b>${esc(t("secMks"))}</b>: ` +
        mks.map((m, i) => `<button class="votechip" style="margin:0 3px 4px 0" onclick="mkOpen(${i})">${esc(m.Name)}</button>`).join(" ") + `</div>`;
    }
  }
  box.innerHTML = html;
}

/* ---------- per-vote breakdown: expands down, like the bills ---------- */
async function openGroup(i) {
  const g = (state.shown || [])[i];
  if (!g) return;
  if (g._open) { g._open = false; renderVotes(); return; }
  g._open = true;
  g._active = g._active || g.votes[0].VoteId;
  renderVotes();
  ensureDetail(g, g._active);
  ensureBillInfo(g, billItemIdOf(g)); // works even when details were pre-loaded for the badge
}

async function pickVote(i, voteId) {
  const g = (state.shown || [])[i];
  if (!g) return;
  g._active = voteId;
  renderVotes();
  ensureDetail(g, voteId);
}

/* The expanded panel, in the order Mercy set (2026-08-22):
     1. who proposed it
     2. כנסת · ישיבה · how many votes it took  (the individual ones on demand)
     3. the decision text
     4. who voted what, by faction
     5. the official documents — last
   The ✔/✘ and the tallies are NOT repeated here: they're in the row above.
   Only the decisive vote is shown; almost nobody wants a list of 30
   reservation votes, so those are one click away. */
function groupDetailHtml(g, i) {
  const j = g._detById && g._detById[g._active];
  const ready = j && j !== "loading" && !j._err;
  const hdr = ready ? ((j.VoteHeader || [])[0] || {}) : {};
  const bill = (g._bill && g._bill !== "loading") ? g._bill : null;

  /* 1 — who brought it to the table */
  const initLine = bill
    ? initiatorsHtml(bill.names, bill.subType, `openGroupInits(${i})`, g._initsOpen) : "";

  /* 2 — where it happened, and how many votes this bill took that day */
  const has = v => v !== undefined && v !== null && v !== "";
  const bits = [];
  if (has(hdr.FK_Knesset)) bits.push(`${t("knesset")} ${hdr.FK_Knesset}`);
  if (has(hdr.SessionNumber)) bits.push(`${t("sessionNo")} ${hdr.SessionNumber}`);
  if (g.votes.length > 1) bits.push(`${g.votes.length} ${t("votesInGroup")}`);
  const toggle = g.votes.length > 1
    ? ` <button class="votechip" onclick="event.stopPropagation();toggleInstances(${i})">${
        esc(t(g._votesOpen ? "hideAll" : "showVotes"))}</button>` : "";
  const metaLine = bits.length
    ? `<div class="sub" style="margin:4px 0 8px">${esc(bits.join(" · "))}${toggle}</div>` : "";

  const chips = (g._votesOpen && g.votes.length > 1)
    ? `<div class="sub" style="margin:0 0 10px">` + g.votes.map((v, idx) =>
        `<button class="votechip${v.VoteId === g._active ? " on" : ""}" onclick="event.stopPropagation();pickVote(${i},${v.VoteId})">` +
        `${idx === 0 ? esc(t("finalChip")) + " · " : ""}${esc(t("voteNo"))} ${v.VoteProtocolNo} · ${esc(v.VoteTimeStr || "")}</button>`
      ).join(" ") + `</div>`
    : "";

  /* 3 + 4 — the decision and the who-voted breakdown */
  const body = (!j || j === "loading") ? `<div class="loading">${esc(t("loading"))}</div>`
    : j._err ? `<div class="error">${esc(t("err"))}</div>`
    : detailHtml(j);

  /* 5 — the official documents */
  const docs = bill ? docsLineHtml(bill.docs) : "";

  return `<div class="kidsbox">${initLine}${metaLine}${chips}${body}${docs}</div>`;
}

function toggleInstances(i) {
  const g = (state.shown || [])[i];
  if (!g) return;
  g._votesOpen = !g._votesOpen;
  renderVotes();
}

function detailHtml(j) {
  const hdr = (j.VoteHeader && j.VoteHeader[0]) || {};
  const details = j.VoteDetails || [];

  // no result badge and no tallies here — the row above already says
  // "✔ התקבלה · בעד 5 · נגד 43"; saying it twice is just noise
  const decision = hdr.Decision
    ? `<div class="sub" style="margin-bottom:8px">${esc(t("decisionL"))}: ${esc(hdr.Decision)}</div>` : "";

  // buckets by result title, each grouped by faction
  const byTitle = {};
  details.forEach(d => {
    const k = d.Title || "?";
    (byTitle[k] = byTitle[k] || []).push(d);
  });
  const order = Object.keys(byTitle).sort((a, b) => {
    const rank = c => ({ for: 0, against: 1, abstain: 2, none: 3 }[resClass(c)]);
    return rank(a) - rank(b);
  });
  const buckets = order.map(k => {
    const list = byTitle[k];
    const byFaction = {};
    list.forEach(d => {
      const f = (d.FactionName || "—").trim();
      (byFaction[f] = byFaction[f] || []).push((d.MkName || "?").trim());
    });
    const factions = Object.entries(byFaction).sort((a, b) => b[1].length - a[1].length);
    return `<div class="bucket">
      <h4><span class="dot ${resClass(k)}"></span>${esc(resLabel(k))} <span class="n">· ${list.length} ${esc(t("membersShown"))}</span></h4>
      ${factions.map(([f, names]) =>
        `<div class="faction"><b>${esc(f)}</b> (${names.length}): <span class="names">${esc(names.join(", "))}</span></div>`).join("")}
    </div>`;
  }).join("");

  return decision + (buckets || `<div class="loading">${esc(t("empty"))}</div>`);
}

/* Who proposed it. Mercy's rule (2026-08-22): up to four names are listed in
   full; more than that and we say HOW MANY and let the reader open the list.
   Never show some names and quietly hide the rest — the one you were looking
   for is exactly the one that ends up hidden. */
function initiatorsHtml(names, subType, toggleCall, open) {
  const list = (names || []).filter(Boolean);
  if (!list.length)
    return subType === "ממשלתית"
      ? `<div class="faction"><b>${esc(t("initiatorsL"))}:</b> ${esc(t("govInitiator"))}</div>` : "";
  if (list.length <= 4)
    return `<div class="faction"><b>${esc(t("initiatorsL"))}:</b> ${esc(list.join(", "))}</div>`;
  return `<div class="faction"><b>${esc(t("initiatorsL"))}:</b> ${esc(t("initsCount").replace("{n}", list.length))}
    <button class="votechip" style="margin-inline-start:6px"
      onclick="event.stopPropagation();${toggleCall}">${esc(t(open ? "hideAll" : "showAll"))}</button>
    ${open ? `<div class="names" style="margin-top:6px">${esc(list.join(", "))}</div>` : ""}</div>`;
}
function openBillInits(idx) {
  const b = (state.billArr || [])[idx];
  if (!b) return;
  b._initsOpen = !b._initsOpen;
  renderBTab();
}
function openGroupInits(i) {
  const g = (state.shown || [])[i];
  if (!g) return;
  g._initsOpen = !g._initsOpen;
  renderVotes();
}

/* the bills tab hands us the names as one string */
function initLineHtml(gnl, toggleCall, open) {
  const raw = ((gnl || {}).Initiators || "").trim();
  const names = raw ? raw.split(/\s*,\s*/).filter(Boolean) : [];
  return initiatorsHtml(names, (gnl || {}).SubType, toggleCall, open);
}

/* official documents — straight to the Knesset's own PDF server */
function docsLineHtml(docs) {
  const seen = {};
  const links = (docs || [])
    .filter(d => d.ApplicationDesc === "PDF" && d.FilePath)
    .filter(d => seen[d.GroupTypeDesc] ? false : (seen[d.GroupTypeDesc] = true))
    .slice(0, 6)
    .map(d => `<a class="doclink" href="${esc(d.FilePath)}" target="_blank" rel="noopener">${esc(d.GroupTypeDesc || "PDF")} ⇗</a>`)
    .join(" · ");
  return links ? `<div class="faction" style="margin-top:6px"><b>${esc(t("docsL"))}:</b> ${links}</div>` : "";
}

function billItemHtml(item, docs, idx, open) {
  if (!item) return `<div class="loading">${esc(t("loading"))}</div>`;
  if (item._err) return `<div class="error">${esc(t("err"))}</div>`;
  const g = item.general || {};
  const initLine = initLineHtml(g, `openBillInits(${idx})`, open);
  const docsLine = docsLineHtml(docs);
  const sessions = ((item.sessionAndDocs && item.sessionAndDocs.Sessions) || [])
    .filter(s => s.StepTitle)
    .sort((a, b) => String(b.StartDate || "").localeCompare(String(a.StartDate || "")));
  const meta = [
    g.SubType ? `${esc(t("billType"))}: ${esc(g.SubType)}` : "",
    g.CommitteeName ? `${esc(t("billCommittee"))}: ${esc(g.CommitteeName)}` : "",
    g.PublicationSeriesLaw ? esc(g.PublicationSeriesLaw) : "",
  ].filter(Boolean).map(s => `<span>${s}</span>`).join("");
  const steps = sessions.slice(0, 8).map(s =>
    `<div class="faction"><b>${esc(fmtDate(s.SessionDate || s.StartDate))}</b> · ${esc(s.StepTitle)}${s.Location ? ` <span class="names">(${esc(s.Location)})</span>` : ""}</div>`).join("");
  return `<div class="vmeta" style="margin-bottom:8px">${meta}</div>` + initLine + docsLine +
    (steps ? `<div class="hint" style="margin:10px 0 4px"><b>${esc(t("journey"))}</b></div>${steps}` : "");
}

/* ---------- autocomplete (Google-style suggestions from our directories) ---------- */
function matchNames(q, all) {
  const w = q.split(/\s+/).filter(Boolean);
  if (!w.length) return [];
  const seen = {}, out = [];
  for (const nm of all) {
    if (nm && w.every(x => nm.includes(x)) && !seen[nm]) {
      seen[nm] = 1; out.push(nm);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function attachAC(inputId, getNames, onPick) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const list = document.createElement("div");
  list.className = "aclist";
  inp.parentElement.appendChild(list);
  let tmr;
  inp.addEventListener("input", () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const q = inp.value.trim();
      if (q.length < 2) { list.style.display = "none"; return; }
      let names = [];
      try { names = await getNames(q); } catch (e) { /* directory unavailable */ }
      if (!names.length || (names.length === 1 && names[0] === q)) { list.style.display = "none"; return; }
      list.innerHTML = names.map(n => `<button type="button">${esc(n)}</button>`).join("");
      [...list.children].forEach(btn => {
        btn.onclick = () => { inp.value = btn.textContent; list.style.display = "none"; onPick && onPick(); };
      });
      list.style.display = "block";
    }, 150);
  });
  inp.addEventListener("blur", () => setTimeout(() => { list.style.display = "none"; }, 250));
}

/* ---------- advanced search ---------- */
function toggleAdv(force) {
  const p = document.getElementById("advpanel");
  const show = force !== undefined ? force : p.style.display === "none";
  p.style.display = show ? "block" : "none";
}

function renderAdvPick() {
  const p = state.advPickList;
  if (!p) return;
  const box = document.getElementById("results");
  box.style.display = "block";
  document.getElementById("votes").innerHTML = "";
  box.innerHTML = `<div class="hint" style="margin:0 0 8px">${esc(t("advPickMk"))}</div>` +
    p.list.map((x, i) =>
      `<button class="votechip" style="margin:0 4px 6px 0" onclick="advPick(${i})">${esc(p.kind === "mk" ? x.Name : x)}</button>`).join(" ");
}

/* ---------- init ---------- */
const PAGE_VER = "22.08 · פאנל מסודר"; // bumped on every update — if the footer shows an older stamp, you're on a cached/old copy
document.getElementById("pagever").textContent = "גרסה " + PAGE_VER;
applyLang();
// autocomplete, fed by our own directories
attachAC("advmk", async q => matchNames(q, ((await ensureCmb()).MKS || []).map(m => m.Name)), doSearch);
attachAC("advinit", async q => matchNames(q, Object.values(await getPersons())), doSearch);
attachAC("binit", async q => matchNames(q, Object.values(await getPersons())), runBSearch);
loadVotes();
