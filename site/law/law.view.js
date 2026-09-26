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
const lawRow = line => (l, id) => item(id + ":" + l.i, lawName(l), line(l), () => lawKv(l) + goLaw(l));

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
    affects: affectsHtml(b.law, b.am),
  }) + ((b.twins || []).length ? kv("kvTwins", esc(fmtN(b.twins.length))) : "") +
    ((b.pieces || []).length ? kv("kvPieces", esc(fmtN(b.pieces.length))) +
      `<ul>${b.pieces.map(p => `<li>${esc(p.n)} · ${esc(p.st)}</li>`).join("")}</ul>` : ""));
}

/* ---------- the blocks ---------- */
function render() {
  const d = LAW.data;
  if (!d) return;
  const laws = d.laws;
  const in90 = addDays(TODAY, 90), ago90 = addDays(TODAY, -90);

  const soon = laws.filter(l => lawState(l) === "pending")
    .sort((a, b) => (a.s || "9999").localeCompare(b.s || "9999"));
  block("soon", soon, lawRow(l => l.s ? t("startsDate") + fmtDate(l.s) : t("stPending") + " · " + t("noDate")));

  const started = laws.filter(l => lawState(l) === "in" && !isBudget(l) &&
      ((l.s && l.s >= ago90 && l.s <= TODAY) || (!l.s && l.p && l.p >= ago90)))
    .sort((a, b) => (b.s || b.p).localeCompare(a.s || a.p));
  block("started", started, lawRow(l => l.s ? t("startedDate") + fmtDate(l.s) : t("publishedDate") + fmtDate(l.p)));

  // the court: laws the Knesset still lists as applying (or about to)
  const court = (d.court || []).filter(c => {
    const l = LAW.byId.get(c.l);
    return l && ["in", "pending"].includes(lawState(l));
  }).sort((a, b) => b.d.localeCompare(a.d));
  block("court", court, courtRow);

  // "about to expire" is not a block of its own: it is the head of this list (Mercy)
  const temp = laws.filter(l => lawState(l) === "in" && !isBudget(l) && isTemp(l) && !(l.e && l.e < TODAY))
    .sort((a, b) => (a.e || "9999").localeCompare(b.e || "9999"));
  block("temp", temp, (l, id) => item(id + ":" + l.i, lawName(l),
    l.e ? t("untilDate") + fmtDate(l.e) : t("noDate"), () => lawKv(l) + goLaw(l),
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
