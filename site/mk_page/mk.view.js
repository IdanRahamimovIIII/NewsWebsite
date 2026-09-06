"use strict";
/* =====================================================================
   mk.view.js — drawing the portfolio
   Every piece of HTML the page produces, the small interactions, and the
   init block at the bottom. All data comes from mk.data.js's `state`.
   ===================================================================== */

const VOTES_PER_PAGE = 25;
const POS_PREVIEW = 12;    // positions shown before "show all"
const BILLS_PREVIEW = 8;   // bills shown per pile before "show more"

/* ---------- shared bits ---------- */
const passBadge = g =>
  g._passed === true ? `<span class="passed yes">${esc(t("passedYes"))}</span>`
  : g._passed === false ? `<span class="passed no">${esc(t("passedNo"))}</span>` : "";

const countsHtml = g => !g._counts ? "" :
  `<span class="chip"><span class="dot for"></span>${esc(t("forL"))} ${g._counts.for}</span>` +
  `<span class="chip"><span class="dot against"></span>${esc(t("againstL"))} ${g._counts.against}</span>` +
  `<span class="chip"><span class="dot abstain"></span>${esc(t("abstainL"))} ${g._counts.abstain}</span>`;

const myVoteChip = g => {
  if (!g._my) return "";
  const c = resClass(g._my);
  const label = lang === "he" ? g._my
    : (c === "for" ? t("forL") : c === "against" ? t("againstL")
       : c === "abstain" ? t("abstainL") : t("noVoteL"));
  return `<span class="myvote ${c}">${esc(t("votedL"))}: ${esc(label)}</span>`;
};

/* ---------- avatars: the official photo when we have the pattern,
   initials otherwise — and initials again if a photo 404s ---------- */
function avatarHtml(name, mkId, cls) {
  const initials = String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("");
  const url = photoOf(mkId);
  if (!url) return `<span class="avatar ${cls}">${esc(initials)}</span>`;
  return `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy" data-init="${esc(initials)}" onerror="avFail(this)">`;
}
function avFail(img) {
  const s = document.createElement("span");
  s.className = img.className;
  s.textContent = img.dataset.init || "";
  img.replaceWith(s);
}

/* ---------- search: live, ranked, with a face and a title ----------
   Results update as you type (debounced, and a newer keystroke cancels an
   older answer). Enter / the button opens a unique match directly. */
let searchSeq = 0, searchTimer = null;
function liveSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runLiveSearch(false), 250);
}
async function runLiveSearch(openUnique) {
  const q = document.getElementById("mkq").value.trim();
  const box = document.getElementById("pick");
  const my = ++searchSeq;
  if (q.length < 2) { state.pick = null; box.style.display = "none"; box.innerHTML = ""; return; }
  let list = [];
  try { list = await findCandidates(q); }
  catch (e) {
    if (searchSeq === my) { box.style.display = "block"; box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`; }
    return;
  }
  if (searchSeq !== my) return;
  if (!list.length) { box.style.display = "block"; box.innerHTML = `<div class="error">${esc(t("noneFound"))}</div>`; return; }
  if (openUnique && list.length === 1) {
    box.style.display = "none"; box.innerHTML = "";
    return openPerson(list[0]);
  }
  // draw NOW with the cheap signals; the position lines fill in as they land
  await enrichCheap(list);
  if (searchSeq !== my) return;
  state.pick = rankCandidates(list);
  renderPick();
  enrichPositions(state.pick).then(() => {
    if (searchSeq !== my) return;
    state.pick = rankCandidates(state.pick);
    renderPick();
  }).catch(e => debug("enrich: " + e.message));
}
const mkSearch = () => runLiveSearch(true);

function renderPick() {
  const box = document.getElementById("pick");
  const list = state.pick || [];
  box.style.display = "block";
  box.innerHTML = list.map((c, i) => {
    const sub = c._rows === undefined ? "…"
      : (c._posLine || (c._lastK ? `${t("knesset")} ${c._lastK}` : ""));
    return `<button class="mkcard" onclick="pickOpen(${i})">
      ${avatarHtml(c.name, c._mkId, "")}
      <span class="mcbody"><span class="mcname">${esc(c.name)}</span>
        <span class="mcsub">${esc(sub)}</span></span>
      ${c._isCurrent ? `<span class="nowchip">${esc(t("servingNow"))}</span>` : ""}
    </button>`;
  }).join("");
}
function pickOpen(i) {
  const c = (state.pick || [])[i];
  if (!c) return;
  const box = document.getElementById("pick");
  box.style.display = "none"; box.innerHTML = "";
  openPerson(c);
}

/* ---------- the directory (current Knesset) ---------- */
async function loadDirectory() {
  const box = document.getElementById("dir");
  try {
    const cmb = await ensureCmb();
    const mks = cmb.MKS || [];
    const latest = Math.max(...mks.map(m => +m.KnessetId || 0), 0);
    const seen = {};
    state._dir = mks.filter(m => m.KnessetId === latest)
      .filter(m => seen[m.Name] ? false : (seen[m.Name] = true))
      .sort((a, b) => String(a.Name).localeCompare(String(b.Name), "he"));
    box.innerHTML = state._dir.map((m, i) =>
      `<button class="votechip dirchip" onclick="dirOpen(${i})">${avatarHtml(m.Name, m.Id, "avsm")}${esc(m.Name)}</button>`).join(" ");
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`;
    debug("dir: " + e.message);
  }
}
async function dirOpen(i) {
  const m = (state._dir || [])[i];
  if (!m) return;
  const list = await findCandidates(m.Name).catch(() => []);
  const exact = list.find(c => c.key === nameKey(m.Name));
  openPerson(exact || list[0] || { name: m.Name, key: nameKey(m.Name), cmb: [m], personIds: [] });
}

/* ---------- the portfolio ---------- */
function renderAll() {
  const on = !!state.sel;
  document.getElementById("profile").style.display = on ? "block" : "none";
  document.getElementById("dirCard").style.display = on ? "none" : "block";
  if (!on) return;
  renderHead(); renderTiles(); renderBio(); renderPositions(); renderBills(); renderVotesSec();
}

/* ---------- personal background — only the fields the member actually filled ---------- */
function renderBio() {
  const card = document.getElementById("bioCard");
  const b = state.bio;
  const rows = [];
  if (b) {
    const line = (key, val) => {
      const v = String(val ?? "").trim();
      if (v) rows.push(`<div class="biorow"><span class="biok">${esc(t(key))}</span><span>${esc(v).replace(/\n/g, "<br>")}</span></div>`);
    };
    const by = yearOf(b.DateOfBirth), dy = yearOf(b.DeathDate);
    if (by) line("bioBorn", dy ? `${by}–${dy}` : String(by));
    line("bioBirthplace", b.PlaceOfBirth);
    if (b.ImmigrationYear) line("bioAliyah", b.ImmigrationYear);
    line("bioResidence", b.Residence);
    line("bioEducation", b.Education);
    line("bioArmy", b.MilitaryService);
    line("bioNational", b.NationalService);
    line("bioProfession", b.profession || b.ProfessionsDetails);
    line("bioLanguages", b.Languages);
  }
  card.style.display = rows.length ? "block" : "none";
  document.getElementById("bio").innerHTML = rows.join("");
}
function backToDir() {
  state.sel = null; state.seq++;
  try {
    const u = new URL(location.href);
    u.searchParams.delete("name");
    history.replaceState(null, "", u);
  } catch (e) { /* never fatal */ }
  renderAll();
}

function renderHead() {
  const s = state.sel;
  if (!s) return;
  const pos = Array.isArray(state.positions) ? state.positions : [];
  // Knessets served: the votes directory + the positions register together
  const ks = [...new Set([...s.cmb.map(x => x.KnessetId),
    ...pos.map(p => p.KnessetNum).filter(Boolean)])].sort((a, b) => a - b);
  // their faction: the freshest position row that names one
  const fRow = pos.find(p => p.IsCurrent && p.FactionName) || pos.find(p => p.FactionName);
  document.getElementById("phead").innerHTML =
    `<button class="backbtn" onclick="backToDir()">${esc(t("backToDir"))}</button>
     <div class="pheadrow">
       ${avatarHtml(s.name, s._mkId || (s.cmb[0] && s.cmb[0].Id), "avlg")}
       <div>
         <h1 class="mkname">${esc(s.name)}</h1>
         <div class="vmeta">
           ${ks.length ? `<span>${esc(t("servedIn"))}: ${ks.join(", ")}</span>` : ""}
           ${fRow ? `<span>${esc(t("currentFaction"))}: ${esc(fRow.FactionName)}</span>` : ""}
         </div>
       </div>
     </div>`;
}

function renderTiles() {
  const s = state.sel;
  if (!s) return;
  const b = state.bills;
  const n = k => (b ? b.bills.filter(x => x._bucket === k).length : null);
  const g = state.vK !== null ? state.votesByK[state.vK] : null;
  const nv = Array.isArray(g) ? g.reduce((a, x) => a + x.votes.length, 0) : null;
  const tile = (val, label) =>
    `<div class="tile"><div class="tv">${val === null ? "…" : val}</div><div class="tl">${esc(label)}</div></div>`;
  document.getElementById("ptiles").innerHTML =
    tile(b ? b.total : null, t("tileBills")) +
    tile(n("passed"), t("tilePassed")) +
    tile(n("rejected"), t("tileRejected")) +
    tile(nv, t("tileVotes") + (state.vK !== null ? ` · ${t("knesset")} ${state.vK}` : ""));
}

/* ---------- positions ---------- */
function renderPositions() {
  const box = document.getElementById("positions");
  const rows = state.positions;
  if (rows === null) { box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`; return; }
  if (!rows.length) { box.innerHTML = `<div class="loading">${esc(t("posNoData"))}</div>`; return; }
  const shown = state.posAll ? rows : rows.slice(0, POS_PREVIEW);
  const line = r => {
    const role = r._role || t("posMember");
    const ctx = [r.GovMinistryName, r.CommitteeName, r.FactionName].filter(Boolean).join(" · ");
    const from = fmtDate(r.StartDate), to = fmtDate(r.FinishDate);
    const now = r.IsCurrent && !r.FinishDate;
    return `<div class="posrow">
      <div class="posdates">${esc(from)}${from || to ? " – " : ""}${now ? `<span class="nowchip">${esc(t("posNow"))}</span>` : esc(to)}</div>
      <div class="posbody"><b>${esc(role)}</b>${ctx ? ` <span class="names">· ${esc(ctx)}</span>` : ""}${
        r.KnessetNum ? ` <span class="names">· ${esc(t("posKnesset"))} ${r.KnessetNum}</span>` : ""}</div>
    </div>`;
  };
  let html = shown.map(line).join("");
  if (rows.length > POS_PREVIEW)
    html += `<div style="margin-top:8px"><button class="votechip" onclick="state.posAll=!state.posAll;renderPositions()">${
      esc(state.posAll ? t("posHideSome") : t("posShowAll"))} (${rows.length})</button></div>`;
  box.innerHTML = html;
}

/* ---------- bills ---------- */
function renderBills() {
  const box = document.getElementById("bills");
  const b = state.bills;
  if (b === null) { box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`; return; }
  if (!b.bills.length) { box.innerHTML = `<div class="loading">${esc(t("bNoBills"))}</div>`; return; }
  const buckets = [["passed", "bPassed"], ["rejected", "bRejected"], ["process", "bProcess"]];
  box.innerHTML = buckets.map(([key, label]) => {
    const list = b.bills.filter(x => x._bucket === key);
    if (!list.length) return "";
    const open = !!state.billsOpen[key];
    const shown = open ? list : list.slice(0, BILLS_PREVIEW);
    const rows = shown.map(x => `<div class="faction">• ${esc(x.Name)}${
        x._lead ? ` <span class="leadchip">${esc(t("bLead"))}</span>` : ""}
        <span class="names">— ${esc(x._status)}${x.KnessetNum ? ` · ${esc(t("knesset"))} ${x.KnessetNum}` : ""}</span></div>`).join("");
    const more = list.length > BILLS_PREVIEW
      ? `<div style="margin:6px 0 0"><button class="votechip" onclick="toggleBucket('${key}')">${
          esc(open ? t("bLess") : t("bMore").replace("{n}", list.length - BILLS_PREVIEW))}</button></div>`
      : "";
    return `<div class="bucket"><h4><span class="dot ${key === "passed" ? "for" : key === "rejected" ? "against" : "abstain"}"></span>${
      esc(t(label))} <span class="n">· ${list.length}</span></h4>${rows}${more}</div>`;
  }).join("");
}
function toggleBucket(key) {
  state.billsOpen[key] = !state.billsOpen[key];
  renderBills();
}

/* ---------- the voting record ---------- */
function renderVotesSec() {
  const s = state.sel;
  if (!s) return;
  const kbox = document.getElementById("mkknessets");
  const box = document.getElementById("mkvotes");
  if (!s.cmb.length) {
    kbox.innerHTML = "";
    box.innerHTML = `<div class="loading">${esc(t("vNoVotesAtAll"))}</div>`;
    return;
  }
  kbox.innerHTML = s.cmb.map(x =>
    `<button class="votechip${x.KnessetId === state.vK ? " on" : ""}" onclick="pickKnesset(${x.KnessetId})">${
      esc(t("vKnesset").replace("{n}", x.KnessetId))}</button>`).join(" ");

  const g = state.votesByK[state.vK];
  if (!g || g === "loading") { box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`; return; }
  if (!g.length) { box.innerHTML = `<div class="loading">${esc(t("vNoVotes"))}</div>`; return; }

  const pages = Math.max(1, Math.ceil(g.length / VOTES_PER_PAGE));
  if (state.vPage > pages) state.vPage = pages;
  const list = g.slice((state.vPage - 1) * VOTES_PER_PAGE, state.vPage * VOTES_PER_PAGE);
  state._vShown = list;
  let html = list.map((x, i) => `<button class="vote${x._open ? " sel" : ""}" onclick="openVote(${i})">
      <div class="vtitle">${x._open ? "▾" : "▸"} ${esc(x.title)}</div>
      <div class="vmeta"><span>${fmtDate(x.date)}</span>${passBadge(x)}${myVoteChip(x)}</div>
    </button>` + (x._open ? voteDetailHtml(x) : "")).join("");
  if (pages > 1) {
    html += `<div class="pager">` +
      (state.vPage > 1 ? `<button class="votechip" onclick="votePage(-1)">${esc(t("prevPage"))}</button>` : "") +
      `<span>${esc(t("pageN").replace("{n}", state.vPage))}</span>` +
      (state.vPage < pages ? `<button class="votechip" onclick="votePage(1)">${esc(t("nextPage"))}</button>` : "") +
      `</div>`;
  }
  box.innerHTML = html;
  annotateGroups(list, state.seq, renderVotesSec);
}

function voteDetailHtml(g) {
  const j = g._det;
  if (!j) return `<div class="kidsbox"><div class="loading">${esc(t("loading"))}</div></div>`;
  const hdr = (j.VoteHeader && j.VoteHeader[0]) || {};
  const has = v => v !== undefined && v !== null && v !== "";
  const bits = [];
  if (has(hdr.FK_Knesset)) bits.push(`${t("knesset")} ${hdr.FK_Knesset}`);
  if (has(hdr.SessionNumber)) bits.push(`${t("sessionNo")} ${hdr.SessionNumber}`);
  if (g.votes.length > 1) bits.push(`${g.votes.length} ${t("votesInGroup")}`);
  const decision = hdr.Decision
    ? `<div class="sub" style="margin:4px 0 8px">${esc(t("decisionL"))}: ${esc(hdr.Decision)}</div>` : "";
  return `<div class="kidsbox">
    ${bits.length ? `<div class="sub" style="margin:4px 0 8px">${esc(bits.join(" · "))}</div>` : ""}
    ${decision}
    <div class="vmeta" style="margin:4px 0 8px">${myVoteChip(g)}${countsHtml(g)}</div>
  </div>`;
}

function openVote(i) {
  const g = (state._vShown || [])[i];
  if (!g) return;
  g._open = !g._open;
  renderVotesSec();
}
function pickKnesset(k) {
  state.vK = k; state.vPage = 1;
  renderVotesSec();
  renderTiles();
  loadMkVotes(k, state.seq);
}
function votePage(d) {
  state.vPage = Math.max(1, state.vPage + d);
  renderVotesSec();
}

/* ---------- init ---------- */
const PAGE_VER = "25.08b · חיפוש חי + דירוג"; // bumped on every update — an older stamp in the footer means a cached/old copy
document.getElementById("pagever").textContent = "גרסה " + PAGE_VER;
applyLang();
// the results ARE the suggestions: they update with every letter typed
document.getElementById("mkq").addEventListener("input", liveSearchInput);
loadDirectory();
// once the photo manifest arrives from the relay, swap the
// initials for faces wherever something is already drawn
photosReady.then(() => {
  if (!photoMap) return;
  if (state.sel) renderAll();
  else loadDirectory();
  if (state.pick) renderPick();
});
// arriving with ?name= (a link from the votes page, or a share) → open them
(function () {
  let nm = "";
  try { nm = new URL(location.href).searchParams.get("name") || ""; } catch (e) { /* ignore */ }
  if (nm) { document.getElementById("mkq").value = nm; mkSearch(); }
})();
