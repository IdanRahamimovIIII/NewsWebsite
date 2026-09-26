"use strict";
/* =====================================================================
   The law section's main page: the highlights. Each block shows two
   items and "show all N" opens the rest in place (never a partial list
   shown as complete). An item is a name + ONE quiet line; ▸ opens its
   details in place (like the bills), and the way to the full record is an
   explicit link INSIDE the opened part — names are never coloured links.
   ===================================================================== */

const SHOW = 2;               // no more than two items before "show all" (Mercy)
const open = {};              // which blocks show everything
const openItem = new Set();   // which items are expanded ("block:id")

function block(id, items, row, emptyKey) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) { el.innerHTML = `<p class="hint">${esc(t(emptyKey || "none"))}</p>`; return; }
  const all = open[id] || items.length <= SHOW;
  const shown = all ? items : items.slice(0, SHOW);
  let html = `<ul class="hl">${shown.map(it => row(it, id)).join("")}</ul>`;
  // the full count lives on the button: never a partial list shown as complete
  if (items.length > SHOW) {
    html += `<button class="morebtn" onclick="toggleBlock('${id}')">${esc(all ? t("showLess") : fill(t("showAll"), { n: fmtN(items.length) }))}</button>`;
  }
  el.innerHTML = html;
}
function toggleBlock(id) { open[id] = !open[id]; render(); }
function toggleItem(key) { openItem.has(key) ? openItem.delete(key) : openItem.add(key); render(); }

/* one row: the head toggles, the details render only when open */
function item(key, name, line, details, tag) {
  const on = openItem.has(key);
  return `<li class="it${on ? " open" : ""}">
    <button class="head" type="button" aria-expanded="${on}" onclick="toggleItem('${esc(key)}')">
      <span class="nm"><span class="chev" aria-hidden="true">${on ? "▾" : "▸"}</span>${tag ? `<span class="lbadge">${esc(tag)}</span>` : ""}${nameHtml(name)}</span>
      <span class="line">${esc(line)}</span>
    </button>
    ${on ? `<div class="det">${details()}</div>` : ""}
  </li>`;
}

/* the explanations behind the "?" buttons: hidden sources the tooltip reads */
function fillInfo() {
  document.querySelectorAll(".qbtn").forEach(b => b.setAttribute("aria-label", t("infoBtn")));
  const upd = window._freshT ? t("dataUpdated") + fmtDate(new Date(window._freshT)) : "";
  document.querySelectorAll(".info .upd").forEach(p => { p.textContent = upd; });
  const d = LAW.data;
  document.querySelectorAll(".info .rev").forEach(p => {
    p.textContent = d && d.courtReviewed ? t("courtReviewed") + fmtDate(d.courtReviewed) : "";
  });
  document.querySelectorAll(".suggest").forEach(a => { a.href = mailSuggest(t("suggestSubject")); });
}

/* ---------- what an opened row shows: "label: value" (law.data.js kv) ---------- */
const goLaw = l => `<p><a class="golink" href="${lawLink(l)}">${esc(t("detailsLink"))} ←</a></p>`;
const hasPage = id => (LAW.data.billPages || []).some(b => b.i === id);
const goBill = (b, key) => hasPage(b.i) ? `<p><a class="golink" href="${billLink(b)}">${esc(t(key))} ←</a></p>` : "";
const lawRow = line => (l, id) => item(id + ":" + l.i, lawName(l), line(l), () =>
  `<div class="kv"><b>${esc(t("bNewLaw"))}</b></div>` + lawKv(l, { status: false }) + goLaw(l));   // "חוק חדש", bold, no "סוג:" (Mercy)

/* ---------- amendments (the data's `amends`: every amending act of the last
   year, with the laws it changes and when it starts). Mercy's split: an act
   that changes ONE law folds under that law (one row per law, its amendments
   inside); an act that changes SEVERAL laws is a row of its own. ---------- */
const actStart = a => a.c || a.d;                       // no start date → the gazette date
const lawLinkHtml = id => { const l = LAW.byId.get(id); return l ? `<a class="golink" href="${lawLink(l)}">${esc(lawName(l))}</a>` : ""; };
function actLine(a, future) {
  const d = actStart(a);
  return (a.c ? (future ? t("startsDate") : t("startedDate")) : t("publishedDate")) + fmtDate(d);
}
function actListHtml(acts, future) {
  return `<ul>${acts.map(a => `<li>${esc(a.n)} · ${esc(actLine(a, future))}${a.c && a.c !== a.d ? " · " + esc(t("publishedDate") + fmtDate(a.d)) : ""}</li>`).join("")}</ul>`;
}
/* rows for one block: {sort, html(id)} — laws, one-law amendment groups, multi-law acts */
function amendRows(acts, future) {
  const byLaw = new Map(), multi = [];
  for (const a of acts) {
    if ((a.laws || []).length === 1) {
      const id = a.laws[0];
      if (!LAW.byId.has(id)) continue;
      (byLaw.get(id) || byLaw.set(id, []).get(id)).push(a);
    } else if ((a.laws || []).length > 1) multi.push(a);
  }
  const rows = [];
  for (const [id, list] of byLaw) {
    const l = LAW.byId.get(id);
    if (!future && shownState(l) !== "in") continue;        // only what reads "חל היום" (Mercy)
    list.sort((x, y) => actStart(future ? x : y).localeCompare(actStart(future ? y : x)));
    const lead = list[0];                                    // the soonest (future) / the latest (past)
    // the act in short when it is named after the law ("(תיקון מס' 155)"), else its full name
    const short = n => splitName(n)[0] === splitName(l.n)[0] ? (splitName(n)[1].match(/^\([^)]*\)/) || [splitName(n)[1]])[0] : n;
    const line = (list.length === 1 ? short(lead.n) : fill(t("amendsN"), { n: list.length })) + " · " + actLine(lead, future);
    rows.push({ sort: actStart(lead), html: key => item(key + ":L" + id, lawName(l), line, () =>
      kv("bAmendOf", lawLinkHtml(id)) + actListHtml(list, future) + goLaw(l)) });   // "תיקון לחוק: [link]" (Mercy)
  }
  for (const a of multi) {
    rows.push({ sort: actStart(a), html: key => item(key + ":A" + a.i, a.n, actLine(a, future), () =>
      kv("bAmendOf", affectsHtml(a.laws.map(id => ({ i: id, n: lawName(LAW.byId.get(id) || {}) })), true)) +
      (a.c && a.c !== a.d ? kv("bPublished", esc(fmtDate(a.d))) : "") + goBill(a, "detailsAmend")) });
  }
  return rows;
}

function courtRow(c, id) {
  const l = LAW.byId.get(c.l);
  return item(id + ":" + c.l + ":" + c.d, lawName(l), t(KIND_KEY[c.k] || "kPartial") + " · " + c.w, () =>
    kv("kvType", esc(t(KIND_KEY[c.k] || "kPartial"))) +
    kv("kvWhat", esc(c.w)) +
    kv("kvRuling", rulingLink(c)) +
    kv("kvDate", esc(fmtDate(c.d))) +
    kv("kvPanel", c.pn ? esc(c.pn + t("judges")) + (c.ds ? " · " + esc(t("dissent") + c.ds) : "") : "") +
    (knessetDiffers(l) ? kv("kvKnesset", esc(l.st)) : "") +
    goLaw(l));
}

const openProps = new Set();     // bills whose full sponsor list is open
function toggleProps(key) { openProps.has(key) ? openProps.delete(key) : openProps.add(key); render(); }

/* a bill — the ONE bill format (shared/bills.js billPanelHtml) */
function billRow(b, id) {
  const ty = /ממשלת/.test(b.ty) ? "tyGov" : /ועד/.test(b.ty) ? "tyCommittee" : "tyPrivate";
  const key = id + ":" + b.i;
  return item(key, b.n, t(ty) + " · " + b.st + (b.d ? " · " + fmtDate(b.d) : ""), () => billPanelHtml({
    proposers: proposersHtml(b.by, /ממשלת/.test(b.ty), `toggleProps('${key}')`, openProps.has(key)),
    type: esc(t(ty)),
    stage: esc(b.st),
    committee: esc(b.cm || ""),
    date: b.d ? esc(t("bDiscussed").replace("{d}", fmtDate(b.d))) : "",
    affects: affectsHtml(b.law || (b.am ? lawForBillName(b.n) : null), b.am),   // the official link, else the name's exact match
  }) + ((b.twins || []).length ? kv("kvTwins", esc(fmtN(b.twins.length))) : "") +
    ((b.pieces || []).length ? kv("kvPieces", esc(fmtN(b.pieces.length))) +
      `<ul>${b.pieces.map(p => `<li>${esc(p.n)} · ${esc(p.st)}</li>`).join("")}</ul>` : "") + goBill(b, "detailsBill"));
}

/* ---------- the blocks ---------- */
function render() {
  const d = LAW.data;
  if (!d) return;
  const laws = d.laws;
  const in90 = addDays(TODAY, 90), ago90 = addDays(TODAY, -90);

  // new laws + amendments, one list in date order (a row = {sort, html})
  const acts = d.amends || [];
  const asRows = (list, row) => list.map(l => ({ sort: l.s || l.p || "", html: key => row(l, key) }));
  const soonRow = lawRow(l => l.s ? t("startsDate") + fmtDate(l.s) : t("stPending") + " · " + t("noDate"));
  const soon = laws.filter(l => lawState(l) === "pending")
    .map(l => ({ sort: l.s || "9999", html: key => soonRow(l, key) }))      // no start date → last, never first
    .concat(amendRows(acts.filter(a => a.c && a.c > TODAY), true))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  block("soon", soon, (r, id) => r.html(id));

  // only what reads "חל היום": a law voided in full is out, a partly voided one stays (Mercy)
  const startedRow = lawRow(l => l.s ? t("startedDate") + fmtDate(l.s) : t("publishedDate") + fmtDate(l.p));
  const started = asRows(laws.filter(l => shownState(l) === "in" && !isBudget(l) &&
      ((l.s && l.s >= ago90 && l.s <= TODAY) || (!l.s && l.p && l.p >= ago90))), startedRow)
    .concat(amendRows(acts.filter(a => { const s = actStart(a); return s && s >= ago90 && s <= TODAY; }), false))
    .sort((a, b) => b.sort.localeCompare(a.sort));
  block("started", started, (r, id) => r.html(id));

  // the court: laws the Knesset still lists as applying (or about to)
  const court = (d.court || []).filter(c => {
    const l = LAW.byId.get(c.l);
    return l && ["in", "pending"].includes(lawState(l));
  }).sort((a, b) => b.d.localeCompare(a.d));
  block("court", court, courtRow);

  // "about to expire" is not a block of its own: it is the head of this list (Mercy)
  const temp = laws.filter(l => shownState(l) === "in" && !isBudget(l) && isTemp(l) && !(l.e && l.e < TODAY))
    .sort((a, b) => (a.e || "9999").localeCompare(b.e || "9999"));
  block("temp", temp, (l, id) => item(id + ":" + l.i, lawName(l),
    l.e ? t("untilDate") + fmtDate(l.e) : t("noDate"), () => lawKv(l, { status: false }) + goLaw(l),
    l.e && l.e <= in90 ? t("expiresSoon") : ""));

  block("bills", d.bills || [], billRow, "noneBills");
  fillInfo();
}

window.onLangChange = render;

(async function init() {
  try {
    await loadLaws();
    render();
  } catch (e) {
    debug(e.message);
    for (const id of ["court", "soon", "started", "temp", "bills"]) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p class="error">${esc(friendly(e))}</p>`;
    }
  }
  fillInfo();
})();
