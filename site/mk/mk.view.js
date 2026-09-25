"use strict";
/* =====================================================================
   mk.view.js — drawing the page
   Every piece of HTML the page produces, the small interactions, and the
   init block at the bottom. All data comes from mk.data.js's `state`.

   Sections (search for "N. " to jump):
     1. shared bits           (badges, chips, avatars)
     2. the directory grid    (cards, infinite scroll, the search that filters it)
     3. the portfolio shell   (show/hide, history + Back, ?name= arrivals)
     4. the hero              (portrait, name · role, story line, bills sentence, background table)
     5. positions
     6. bills + documents
     7. the voting record
     8. init
   ===================================================================== */

const VOTES_PER_PAGE = 25;
const POS_PREVIEW = 4;     // positions shown before "show all" (Mercy: the last 4)
const BILLS_PAGE = 20;     // bills shown before "more" (one list, filtered)

/* =====================================================================
   1. SHARED BITS
   ===================================================================== */
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

/* ---- avatars: the official photo when the relay's manifest names one,
   initials otherwise — and initials again if a photo fails to load ---- */
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

/* =====================================================================
   2. THE DIRECTORY GRID
   ===================================================================== */

/* ---- the search filters the grid in place (Mercy) ----
   Typing cuts the cards that don't match (name, party or role); nothing
   else changes on screen. People the grid doesn't hold yet are fetched by
   name and slotted in as cards. Enter / the button opens a lone match. */
let searchSeq = 0, searchTimer = null;
function liveSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runLiveSearch(false), 250);
}
async function runLiveSearch(openUnique) {
  const q = document.getElementById("mkq").value.trim();
  const my = ++searchSeq;
  state.dirQ = q;
  renderDirectory();                       // cut at once from what is on the page
  if (q) {
    try { await dirSearch(q); } catch (e) { debug("search: " + e.message); }
    if (searchSeq !== my) return;
    renderDirectory();                     // …then again with anyone fetched by name
  }
  if (openUnique && q) {
    const shown = visibleDir();
    if (shown.length === 1) openPerson(shown[0].e);
  }
}
const mkSearch = () => runLiveSearch(true);
/* the entries the grid shows right now, with why each matched */
function visibleDir() {
  const list = state._dir || [];
  const words = String(state.dirQ || "").split(/\s+/).filter(Boolean);
  if (!words.length) return list.map((e, i) => ({ e, i, hit: "" }));
  return dirMatches(list, words);
}

/* ---- the grid of profile cards ----
   Photo, name, then party · years · role · bills. The grid draws at once
   from what's free (cmb + persons); role and bills fill in per card as it
   scrolls into view (dirWant → mk.data.js). */
async function loadDirectory() {
  const box = document.getElementById("dir");
  try {
    await buildDirectory();
    renderDirectory();
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`;
    debug("dir: " + e.message);
  }
}
let dirObserver = null, moreObserver = null;
function renderDirectory() {
  const box = document.getElementById("dir");
  const list = state._dir;
  if (!list) return;
  // one continuous grid: the current Knesset, then everyone else by the last
  // year in office — no dividers (Mercy), the years on the cards say it.
  // A search only removes cards; a match by party/role adds the reason to its card.
  const shown = visibleDir();
  const searching = !!(state.dirQ || "").trim();
  let html = `<div class="dirgrid">`;
  shown.forEach(({ e, i, hit }) => {
    html += `<button class="dircard" data-i="${i}" onclick="dirOpen(${i})">${dirCardHtml(e, hit)}</button>`;
  });
  html += `</div>`;
  if (searching && !shown.length) html += `<div class="loading">${esc(t("noneFound"))}</div>`;
  // the sentinel: reaching it fetches the next Knesset back (or says the archive ends) — not while searching
  const more = !searching && state._dirNextK >= 16;
  if (!searching) html += `<div id="dirmore" class="dirmore">${esc(more ? t("dirLoadingMore") : t("dirEnd"))}</div>`;
  box.innerHTML = html;
  if (dirObserver) dirObserver.disconnect();
  if (moreObserver) moreObserver.disconnect();
  if ("IntersectionObserver" in window) {
    dirObserver = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { dirWant(+en.target.dataset.i); dirObserver.unobserve(en.target); } });
    }, { rootMargin: "300px 0px" });   // start a little before the card is on screen
    box.querySelectorAll(".dircard").forEach(el => dirObserver.observe(el));
    if (more) {
      moreObserver = new IntersectionObserver(entries => {
        if (entries.some(en => en.isIntersecting)) dirMore();
      }, { rootMargin: "600px 0px" });
      moreObserver.observe(document.getElementById("dirmore"));
    }
  } else {
    list.forEach((e, i) => dirWant(i));
  }
}
/* the sentinel came into view: append the previous Knesset and redraw */
async function dirMore() {
  if (state._dirLoading) return;
  if (moreObserver) moreObserver.disconnect();
  const grew = await loadNextKnesset();
  if (!state.sel) renderDirectory();   // (a portfolio may have opened meanwhile — the grid redraws on return)
  else if (!grew) return;
}
function dirCardHtml(e, hit) {
  const role = cardRole(e);
  const years = cardYears(e);
  // no laws passed → no line at all (Mercy); unknown → no line either
  const bills = e.bills === undefined ? "…" : !e.bills ? ""
    : e.bills === 1 ? t("dirPassed1") : t("dirPassed").replace("{n}", e.bills);
  // name → role (blue, the eye's second stop) → party → years → laws (Mercy)
  return avatarHtml(e.name, e.m.Id, "avxl") +
    `<span class="dcname">${esc(e.name)}</span>` +
    `<span class="dcrole">${role === null ? "…" : esc(role)}</span>` +
    (e.faction ? `<span class="dcparty" data-tip="${esc(t("factionTip"))}">${esc(e.faction)}</span>` : "") +
    (years ? `<span class="dcyears">${esc(years)}</span>` : "") +
    (bills ? `<span class="dcbills">${esc(bills)}</span>` : "") +
    (hit && hit !== role && hit !== e.faction ? `<span class="dchit">${esc(hit)}</span>` : "");   // why this card survived the search — unless the card already says it
}
/* one card's contents, after its role or bills landed — the grid stays put */
function refreshDirCard(e) {
  const i = (state._dir || []).indexOf(e);
  const el = i < 0 ? null : document.querySelector(`#dir .dircard[data-i="${i}"]`);
  if (!el) return;
  const shown = visibleDir().find(x => x.e === e);
  el.innerHTML = dirCardHtml(e, shown ? shown.hit : "");
}
function dirOpen(i) {
  const e = (state._dir || [])[i];
  if (e) openPerson(e);
}

/* =====================================================================
   3. THE PORTFOLIO SHELL
   ===================================================================== */
function renderAll() {
  const on = !!state.sel;
  document.getElementById("profile").style.display = on ? "block" : "none";
  document.getElementById("dirCard").style.display = on ? "none" : "block";
  // a portfolio is just the person: the search card goes away. Found via the
  // search box, not by id — a browser that cached an older index.html must
  // not crash here (2026-09-06: it did, and a card click froze on "loading")
  const searchCard = document.getElementById("mkq").closest(".card");
  if (searchCard) searchCard.style.display = on ? "none" : "block";
  // …and so does the site tagline common.js puts above the cards (Mercy)
  document.querySelectorAll('[data-i18n="tagline"]').forEach(el => { el.style.display = on ? "none" : ""; });
  if (!on) { renderDirectory(); return; }   // (a language switch re-words the cards)
  renderHead(); renderTiles(); renderPositions(); renderBills(); renderVotesSec();
}

/* the page's own Back button behaves like the browser's: if opening this
   person pushed a history entry, step back through it (so Forward works
   too); otherwise (arrived by link) just show the directory */
function backToDir() {
  if (history.state && history.state.name) { history.back(); return; }
  showDirectory();
  try {
    const u = new URL(location.href);
    u.searchParams.delete("name");
    if (ENTITY) {                           // leaving an entity address → the list's own
      u.pathname = ENTITY.dir;
      if (ENTITY.title.list) document.title = ENTITY.title.list;
    }
    history.replaceState(null, "", u);
  } catch (e) { /* never fatal */ }
}
/* a language switch on an entity address moves to that language's address */
function syncEntityLang() {
  if (!ENTITY || !atEntity(state.sel)) return;
  try {
    const u = new URL(location.href);
    u.pathname = ENTITY.url[lang];
    history.replaceState(history.state, "", u);
    document.title = ENTITY.title[lang];
  } catch (e) { /* never fatal */ }
}
/* the entity address names an MkId: open the directory's entry for it,
   else (an earlier Knesset) the search result carrying that MkId — a
   namesake must never open instead — and only then the plain name */
async function openByMkId(id, nm) {
  const has = x => (x.cmb || []).some(r => +r.Id === +id);
  await buildDirectory().catch(() => null);
  const e = (state._dir || []).find(has);
  if (e) return openPerson(e);
  const c = (await findCandidates(nm).catch(() => [])).find(has);
  if (c) return openPerson(c);
  return openByName(nm);
}
function showDirectory() {
  state.sel = null; state.seq++;
  renderAll();
}
/* browser Back/Forward: the address says who (or nobody) should be on screen */
window.addEventListener("popstate", () => {
  let nm = "";
  try { nm = new URL(location.href).searchParams.get("name") || ""; } catch (e) { /* ignore */ }
  if (!nm) { showDirectory(); return; }
  if (state.sel && state.sel.name === nm) return;
  openByName(nm);
});
/* open whoever the address names — a unique match opens; namesakes filter the grid */
async function openByName(nm) {
  const list = await findCandidates(nm).catch(() => []);
  const exact = list.find(c => c.key === nameKey(nm));
  if (exact || list.length === 1) return openPerson(exact || list[0]);
  showDirectory();
  document.getElementById("mkq").value = nm;
  runLiveSearch(false);   // the grid filters to the namesakes
}

/* =====================================================================
   4. THE HERO
   ===================================================================== */

/* the Knesset sends these fields as they were typed into its CMS: HTML
   entities in the text ("&#x0D;" for a carriage return, "&amp;", "&quot;")
   and "\n" line breaks. Decode the entities to plain text FIRST — then the
   result is escaped for the DOM like everything else, so nothing from
   upstream is ever interpreted as markup. */
function bioText(v) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(v ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
    .replace(/\r\n?/g, "\n")
    .split("\n").map(s => s.trim()).filter(Boolean).join("\n");
}

/* a CMS field as one clause: bullets ("- …") become a comma-separated run */
const bioClause = v => bioText(v).split("\n").map(s => s.replace(/^[-–•]\s*/, "").trim()).filter(Boolean).join(", ");
/* a year out of whatever the CMS wrote — "כ\"ח בתשרי תש\"י , 21/10/1949" included */
const yearIn = v => { const m = String(v || "").match(/\d{4}/g); return m ? m[m.length - 1] : ""; };
/* ---- personal background: a small table under the bills sentence (Mercy) ----
   Label · value, one row per filled-in field, as little space as it can:
   two tight columns, bullets folded into comma runs, no borders. */
function bioFacts() {
  const b = state.bio;
  if (!b) return [];
  const out = [];
  const add = (key, v) => { v = String(v || "").trim(); if (v) out.push({ k: t(key), v }); };
  const by = yearIn(b.DateOfBirth), dy = yearIn(b.DeathDate);
  const place = bioClause(b.PlaceOfBirth).replace(/,\s*ישראל$/, "");   // "תל-אביב, ישראל" → the city
  add("factBorn", [by, place].filter(Boolean).join(" · "));
  if (dy) add("factDied", dy);
  add("factAliyah", bioClause(b.ImmigrationYear));
  if (!dy) add("factHome", bioClause(b.Residence));
  add("factEdu", bioClause(b.Education));
  add("factArmy", bioClause(b.MilitaryService));
  add("factNat", bioClause(b.NationalService));
  add("factProf", bioClause(b.profession || b.ProfessionsDetails));
  add("factLangs", bioClause(b.Languages));
  return out;
}
const bioTableHtml = () => {
  const f = bioFacts();
  return f.length ? `<div class="biot">${f.map(x =>
    `<span class="bk">${esc(x.k)}</span><span class="bv">${esc(x.v)}</span>`).join("")}</div>` : "";
};
/* "בכנסת מאז 1988 (37 שנה)" — or "בכנסת 2013–2024" for someone who left.
   First year: the register's earliest row, else the first Knesset the votes
   directory lists them in (cmb.Knessets has the start dates). */
function tenureLine(s, pos) {
  const years = pos.map(r => yearOf(r.StartDate)).filter(Boolean);
  let a = years.length ? Math.min(...years) : 0;
  if (!a && s.cmb.length && state.cmb) {
    const firstK = Math.min(...s.cmb.map(x => x.KnessetId));
    const k = (state.cmb.Knessets || []).find(x => x.KnessetId === firstK);
    a = k ? yearOf(k.KnessetStart) : 0;
  }
  if (!a) return "";
  // "מאז" only for someone in the current Knesset; an open row alone is not
  // enough — the register leaves rows open for people long gone
  const ongoing = inLatestKnesset(s) && (pos.some(r => !r.FinishDate) || !pos.length);
  if (!ongoing) {
    const ends = pos.map(r => yearOf(r.FinishDate)).filter(Boolean);
    return t("tenureSpan").replace("{a}", a).replace("{b}", ends.length ? Math.max(...ends) : t("untilNow"));
  }
  const n = new Date().getFullYear() - a;
  return t("tenureSince").replace("{y}", a) + (n >= 2 ? " " + t("tenureYears").replace("{n}", n) : "");
}

/* is this person in the current Knesset at all? (the votes directory says) */
const inLatestKnesset = s => {
  const latest = Math.max(...(((state.cmb && state.cmb.MKS) || []).map(m => +m.KnessetId || 0)), 0);
  return !latest || (s.cmb || []).some(x => x.KnessetId === latest);
};

/* ---- the hero: one breath about the person (Mercy) ----
   portrait · name and what they are today · one line of story (faction,
   how long in the Knesset) */
function renderHead() {
  const s = state.sel;
  if (!s) return;
  const pos = Array.isArray(state.positions) ? state.positions : [];
  const fRow = pos.find(p => p.IsCurrent && p.FactionName) || pos.find(p => p.FactionName);
  const role = inLatestKnesset(s) ? currentRole(pos) : "";   // no "current" role for someone no longer there
  // faction · how long in the Knesset. (The ever-PM spans were here and
  // came out as clutter — Mercy, 2026-09-06; the timeline below has them.)
  const story = [
    fRow ? `<span class="factionname" data-tip="${esc(t("factionTip"))}">${esc(fRow.FactionName.trim())}</span>` : "",
    esc(tenureLine(s, pos)),
  ].filter(Boolean);
  document.getElementById("phead").innerHTML =
    `<button class="backbtn" onclick="backToDir()">${esc(t("backToDir"))}</button>
     <div class="pheadcol">
       ${avatarHtml(s.name, s._mkId || (s.cmb[0] && s.cmb[0].Id), "avxxl")}
       <h1 class="mkname">${esc(s.name)}${role ? ` <span class="mkrole">· ${esc(role)}</span>` : ""}</h1>
       ${story.length ? `<div class="story">${story.join(`<span class="sep"> · </span>`)}</div>` : ""}
     </div>`;
}

/* ---- one sentence instead of four tiles (into #ptiles) ----
   "31 הצעות חוק — 6 הפכו לחוק", then the three counts (passed / fell /
   not passed yet) with the piles' colors. The plenum-votes number moved
   down to the votes section, where it means something. */
function renderTiles() {
  const s = state.sel;
  if (!s) return;
  const box = document.getElementById("ptiles");
  const b = state.bills;
  let bar;
  if (!b) bar = `<div class="loading">${esc(t("loading"))}</div>`;
  else {
    const n = k => b.bills.filter(x => x._bucket === k).length;
    const p = n("passed"), r = n("rejected"), q = n("pending"), z = n("undecided"), total = b.total || b.bills.length;
    if (!total) bar = `<div class="story">${esc(t("bNoBills"))}</div>`;
    else {
      const head = p === 0 ? t("billsStory0").replace("{t}", total)
        : p === 1 ? t("billsStory1").replace("{t}", total)
        : t("billsStory").replace("{t}", total).replace("{p}", p);
      // the sentence and the three counts; the stacked bar that was between
      // them said nothing the counts don't (Mercy)
      bar = `<div class="billsbar">
          <div class="bhead">${esc(head)}</div>
          <div class="vmeta bleg">
            <span class="chip" data-tip="${esc(t("tipPassed"))}"><span class="dot for"></span>${esc(t("bPassed"))} ${p}</span>
            <span class="chip" data-tip="${esc(t("tipRejected"))}"><span class="dot against"></span>${esc(t("bRejected"))} ${r}</span>
            ${q ? `<span class="chip" data-tip="${esc(t("tipPending"))}"><span class="dot pending"></span>${esc(t("bPending"))} ${q}</span>` : ""}
            ${z ? `<span class="chip" data-tip="${esc(t("tipUndecided"))}"><span class="dot abstain"></span>${esc(t("bUndecided"))} ${z}</span>` : ""}
          </div>
        </div>`;
    }
  }
  box.innerHTML = bar + bioTableHtml();   // the background table rides under the bar, same block
}

/* =====================================================================
   5. POSITIONS
   ===================================================================== */
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

/* =====================================================================
   6. BILLS + DOCUMENTS
   ===================================================================== */

/* ---- the bills: one list, newest Knesset first, with the reader in
   control (Mercy, 2026-09-06/07) — ONE pile at a time (עברו · נפלו · בתהליך ·
   לא הוכרעו, radio-style; עברו by default, else the first pile that has
   anything), and a name search inside it ---- */
const BUCKETS = [["passed", "bPassed", "for", "tipPassed"], ["rejected", "bRejected", "against", "tipRejected"],
                 ["pending", "bPending", "pending", "tipPending"], ["undecided", "bUndecided", "abstain", "tipUndecided"]];
function renderBills() {
  const box = document.getElementById("bills");
  const b = state.bills;
  if (b === null) { box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`; box.dataset.for = ""; return; }
  if (!b.bills.length) { box.innerHTML = `<div class="loading">${esc(t("bNoBills"))}</div>`; box.dataset.for = ""; return; }
  const count = k => b.bills.filter(x => x._bucket === k).length;
  if (!state.billPile || !count(state.billPile))
    state.billPile = (BUCKETS.map(u => u[0]).find(k => count(k)) || "passed");
  // the controls are built once per person (typing must not lose the caret); the list every time
  if (box.dataset.for !== String(state.seq)) {
    box.dataset.for = String(state.seq);
    box.innerHTML = `<div class="billsctl">
        <div class="fchips">${BUCKETS.map(([k, label, dot, tip]) => count(k)
          ? `<button class="fchip" data-k="${k}" role="radio" data-tip="${esc(t(tip))}" onclick="pickBillPile('${k}')"><span class="ck ${dot}"></span>${esc(t(label))} · ${count(k)}</button>` : "").join("")}</div>
        <input class="billq" type="search" placeholder="${esc(t("bSearchPh"))}" oninput="billSearch(this.value)">
      </div><div id="billslist"></div>`;
  }
  box.querySelectorAll(".fchip").forEach(el => {
    const on = el.dataset.k === state.billPile;
    el.classList.toggle("on", on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  });
  const q = state.billQ.trim();
  const list = b.bills.filter(x => x._bucket === state.billPile && (!q || String(x.Name || "").includes(q)))
    .sort((a, c) => (+c.KnessetNum || 0) - (+a.KnessetNum || 0) || (dateOf(c.LastUpdatedDate) || 0) - (dateOf(a.LastUpdatedDate) || 0));
  const dotOf = Object.fromEntries(BUCKETS.map(([k, , dot]) => [k, dot]));
  const shown = list.slice(0, state.billShown);
  state._bShown = shown;
  // each row opens to the bill's official documents (Mercy)
  const rows = shown.map((x, i) => `<button class="brow${x._open ? " sel" : ""}" onclick="openBill(${i})"><span class="dot ${dotOf[x._bucket]}" data-tip="${esc(t(BUCKETS.find(u => u[0] === x._bucket)[1]))}"></span><span class="bname">${x._open ? "▾" : "▸"} ${esc(x.Name)}${
      x._lead ? ` <span class="leadchip">${esc(t("bLead"))}</span>` : ""}
      <span class="names">— ${esc(x._status)}${x.KnessetNum ? ` · ${esc(t("knesset"))} ${x.KnessetNum}` : ""}</span></span></button>` +
      (x._open ? `<div class="kidsbox">${docsHtml(x._docs)}</div>` : "")).join("");
  const more = list.length > shown.length
    ? `<div style="margin:8px 0 0"><button class="votechip" onclick="state.billShown+=${BILLS_PAGE};renderBills()">${
        esc(t("bMore").replace("{n}", list.length - shown.length))}</button></div>` : "";
  document.getElementById("billslist").innerHTML = list.length ? rows + more : `<div class="loading">${esc(t("bNoMatch"))}</div>`;
}
function openBill(i) {
  const x = (state._bShown || [])[i];
  if (!x) return;
  x._open = !x._open;
  if (x._open && x._docs === undefined) {
    x._docs = "loading";
    const seq = state.seq;
    billDocs(x.BillID).then(d => { x._docs = d; if (state.seq === seq) renderBills(); });
  }
  renderBills();
}
function pickBillPile(k) {
  state.billPile = k;
  state.billShown = BILLS_PAGE;
  renderBills();
}
function billSearch(v) {
  state.billQ = v || "";
  state.billShown = BILLS_PAGE;
  renderBills();
}

/* ---- the official documents block (bills and votes share it) ----
   docs: undefined = not asked, "loading", null = the register failed, [] = none */
function docsHtml(docs) {
  if (docs === undefined || docs === "loading") return `<div class="loading">${esc(t("loading"))}</div>`;
  if (docs === null) return `<div class="sub">${esc(t("docsFail"))}</div>`;
  if (!docs.length) return `<div class="sub">${esc(t("docsNone"))}</div>`;
  return `<div class="docs"><div class="dtitle">${esc(t("docsTitle"))}</div>` + docs.map(g =>
    `<div class="drow"><span class="dtype">${esc(g.type)}</span>${g.files.map(f =>
      `<a class="dlink" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.fmt)}</a>`).join("")}</div>`).join("") + `</div>`;
}

/* =====================================================================
   7. THE VOTING RECORD
   ===================================================================== */
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
  const gk = state.votesByK[state.vK];
  const nv = Array.isArray(gk) ? gk.reduce((a, x) => a + x.votes.length, 0) : null;
  // the controls (count line, Knesset chips, the subject search) are built
  // once per person and updated in place — typing must not lose the caret
  if (kbox.dataset.for !== String(state.seq)) {
    kbox.dataset.for = String(state.seq);
    kbox.innerHTML = `<div class="story vcount"></div>
      <div class="votectl"><span class="kchips">${s.cmb.map(x =>
        `<button class="votechip" data-k="${x.KnessetId}" onclick="pickKnesset(${x.KnessetId})">${esc(t("vKnesset").replace("{n}", x.KnessetId))}</button>`).join(" ")}</span>
      <input class="billq voteq" type="search" placeholder="${esc(t("vSearchPh"))}" oninput="voteSearch(this.value)"></div>`;
  }
  kbox.querySelector(".vcount").textContent = nv !== null ? t("vCount").replace("{n}", nv).replace("{k}", state.vK) : "";
  kbox.querySelectorAll(".kchips .votechip").forEach(el => el.classList.toggle("on", +el.dataset.k === state.vK));

  const all = state.votesByK[state.vK];
  if (!all || all === "loading") { box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`; return; }
  if (!all.length) { box.innerHTML = `<div class="loading">${esc(t("vNoVotes"))}</div>`; return; }
  const q = state.voteQ.trim();
  const g = q ? all.filter(x => String(x.title || "").includes(q)) : all;
  if (!g.length) { box.innerHTML = `<div class="loading">${esc(t("vNoMatch"))}</div>`; return; }

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
  // the bill behind the vote (FK_ItemID is its BillID) → its official documents
  if (hdr.FK_ItemID && g._docs === undefined) {
    g._docs = "loading";
    const seq = state.seq;
    billDocs(hdr.FK_ItemID).then(d => { g._docs = d; if (state.seq === seq) renderVotesSec(); });
  }
  return `<div class="kidsbox">
    ${bits.length ? `<div class="sub" style="margin:4px 0 8px">${esc(bits.join(" · "))}</div>` : ""}
    ${decision}
    <div class="vmeta" style="margin:4px 0 8px">${myVoteChip(g)}${countsHtml(g)}</div>
    ${hdr.FK_ItemID ? docsHtml(g._docs) : ""}
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
function voteSearch(v) {
  state.voteQ = v || "";
  state.vPage = 1;
  renderVotesSec();
}
function votePage(d) {
  state.vPage = Math.max(1, state.vPage + d);
  renderVotesSec();
}

/* =====================================================================
   8. INIT
   ===================================================================== */
const PAGE_VER = "26.09aj · טולטיפ אחד"; // bumped on every update — an older stamp in the footer means a cached/old copy
document.getElementById("pagever").textContent = "גרסה " + PAGE_VER;
if (ENTITY && ENTITY.lang === "en") lang = "en";   // the English entity address
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
});
// arriving with ?name= (a link from the votes page, or a share) → open them
// …or with an entity address (/mk/<id>-<name>/) → open that MK
(function () {
  if (ENTITY && location.pathname !== ENTITY.dir) { openByMkId(ENTITY.id, ENTITY.he); return; }
  let nm = "";
  try { nm = new URL(location.href).searchParams.get("name") || ""; } catch (e) { /* ignore */ }
  if (nm) openByName(nm);
})();
