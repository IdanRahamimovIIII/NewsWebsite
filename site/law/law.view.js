"use strict";
/* =====================================================================
   The law section's main page: the highlights. Each block shows a few
   items, the full count, and "show all" opens the rest in place (never a
   partial list shown as complete).
   ===================================================================== */

const SHOW = 5;
const open = {};              // which blocks show everything

function block(id, items, render, emptyKey) {
  const el = document.getElementById(id);
  if (!el) return;
  const cnt = document.getElementById(id + "N");
  if (cnt) cnt.textContent = items.length ? "(" + fmtN(items.length) + ")" : "";
  if (!items.length) { el.innerHTML = `<p class="hint">${esc(t(emptyKey || "none"))}</p>`; return; }
  const all = open[id] || items.length <= SHOW + 1;
  const shown = all ? items : items.slice(0, SHOW);
  let html = `<ul class="hl">${shown.map(render).join("")}</ul>`;
  if (items.length > SHOW + 1) {
    html += `<button class="morebtn" onclick="toggleBlock('${id}')">${esc(all ? t("showLess") : fill(t("showAll"), { n: fmtN(items.length) }))}</button>`;
  }
  el.innerHTML = html;
}
function toggleBlock(id) { open[id] = !open[id]; render(); }

/* ---------- one line per kind of item ---------- */
function stateWords(l) {
  const s = lawState(l);
  if (s === "pending") return l.s ? t("startsDate") + fmtDate(l.s) : t("stPending") + " · " + t("noDate");
  return t(STATE_KEY[s]);
}

function courtItem(c) {
  const l = LAW.byId.get(c.l);
  const panel = c.pn ? `<span>${esc(c.pn + t("judges"))}${c.ds ? " · " + esc(t("dissent") + c.ds) : ""}</span>` : "";
  return `<li>
    <div class="ttl"><span class="lbadge court">${esc(t(KIND_KEY[c.k] || "kPartial"))}</span>
      <a href="${lawLink(l)}">${esc(lawName(l))}</a></div>
    <div class="what">${esc(c.w)}</div>
    <div class="meta"><a class="doclink" href="${esc(c.u)}" target="_blank" rel="noopener">${esc(t("ruling"))}: ${esc(c.c)}</a>
      <span>${esc(fmtDate(c.d))}</span>${panel}
      <span>${esc(t("knessetSays") + (l.st || ""))}</span></div>
  </li>`;
}

function lawItem(dateWords) {
  return l => `<li>
    <div class="ttl"><a href="${lawLink(l)}">${esc(lawName(l))}</a></div>
    <div class="meta"><span>${esc(dateWords(l))}</span>${(l.t || []).slice(0, 3).map(id => `<span>${esc(LAW.topics[id] || "")}</span>`).join("")}</div>
  </li>`;
}

function billItem(b) {
  const ty = /ממשלת/.test(b.ty) ? "tyGov" : /ועד/.test(b.ty) ? "tyCommittee" : "tyPrivate";
  const by = (b.by || []).length ? `<span>${esc(t("by") + b.by.join(", "))}${b.nb > b.by.length ? esc(fill(t("moreBy"), { n: b.nb - b.by.length })) : ""}</span>` : "";
  const twins = (b.twins || []).length ? `<span>${esc(fill(t("twins"), { n: b.twins.length }))}</span>` : "";
  const pieces = (b.pieces || []).length
    ? `<div class="what">${esc(fill(t("pieces"), { n: b.pieces.length }))}</div><ul class="sub">${b.pieces.map(p => `<li>${esc(p.n)} · ${esc(p.st)}</li>`).join("")}</ul>` : "";
  return `<li>
    <div class="ttl">${esc(b.n)}</div>
    <div class="meta"><span class="lbadge soft">${esc(t(ty))}</span><span class="lbadge soft">${esc(t(b.am ? "amends" : "newLaw"))}</span>
      <span>${esc(b.st)}</span></div>
    <div class="meta"><span>${esc(t("lastDiscussed") + fmtDate(b.d))}</span>${b.cm ? `<span>${esc(t("committee") + b.cm)}</span>` : ""}${by}${twins}</div>
    ${pieces}
  </li>`;
}

/* ---------- the blocks ---------- */
function render() {
  const d = LAW.data;
  if (!d) return;
  const laws = d.laws;
  const in90 = addDays(TODAY, 90), ago90 = addDays(TODAY, -90);

  // the court: laws the Knesset still lists as applying (or about to)
  const court = (d.court || []).filter(c => {
    const l = LAW.byId.get(c.l);
    return l && ["in", "pending"].includes(lawState(l));
  }).sort((a, b) => b.d.localeCompare(a.d));
  block("court", court, courtItem);
  const rev = document.getElementById("courtRev");
  if (rev) rev.textContent = d.courtReviewed ? t("courtReviewed") + fmtDate(d.courtReviewed) : "";

  const soon = laws.filter(l => lawState(l) === "pending")
    .sort((a, b) => (a.s || "9999").localeCompare(b.s || "9999"));
  block("soon", soon, lawItem(stateWords));

  const started = laws.filter(l => lawState(l) === "in" && !isBudget(l) &&
      ((l.s && l.s >= ago90 && l.s <= TODAY) || (!l.s && l.p && l.p >= ago90)))
    .sort((a, b) => (b.s || b.p).localeCompare(a.s || a.p));
  block("started", started, lawItem(l => l.s ? t("startedDate") + fmtDate(l.s) : t("publishedDate") + fmtDate(l.p)));

  const expiring = laws.filter(l => lawState(l) === "in" && l.e && l.e >= TODAY && l.e <= in90)
    .sort((a, b) => a.e.localeCompare(b.e));
  block("expiring", expiring, lawItem(l => t("untilDate") + fmtDate(l.e)));

  const temp = laws.filter(l => lawState(l) === "in" && !isBudget(l) && isTemp(l) && !(l.e && l.e < TODAY))
    .sort((a, b) => (a.e || "9999").localeCompare(b.e || "9999"));
  block("temp", temp, lawItem(l => l.e ? t("untilDate") + fmtDate(l.e) : t("noDate")));

  block("bills", d.bills || [], billItem, "noneBills");
}

window.onLangChange = render;

(async function init() {
  try {
    await loadLaws();
    render();
  } catch (e) {
    debug(e.message);
    for (const id of ["court", "soon", "started", "expiring", "temp", "bills"]) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p class="error">${esc(friendly(e))}</p>`;
    }
  }
  const s = document.getElementById("suggest");
  if (s) s.href = mailSuggest(t("suggestSubject"));
})();
