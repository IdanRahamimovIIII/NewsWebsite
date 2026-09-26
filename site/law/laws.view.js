"use strict";
/* =====================================================================
   The laws list: every law in the Knesset register. Search, topic and
   the options filter the SAME list in place. Budget laws and laws that no
   longer apply are hidden by default, one click shows them (Mercy); a
   law not yet in force always leads (change first, Mercy).
   Address: ?q= ?topic= ?law=<IsraelLawID> (opens that law).
   ===================================================================== */

const PAGE_SIZE = 150;
const V = { q: "", topic: "", budget: false, gone: false, basic: false, court: false,
            sort: "changed", limit: PAGE_SIZE, openId: null };

const normHe = s => String(s || "").replace(/[֑-ׇ]/g, "").replace(/["'״׳]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function matches(l) {
  if (V.q) {
    const words = normHe(V.q).split(" ").filter(Boolean);
    const name = normHe(l.n);
    if (!words.every(w => name.includes(w))) return false;
  }
  if (V.topic && !(l.t || []).includes(Number(V.topic))) return false;
  if (V.basic && !(l.f || "").includes("b")) return false;
  if (V.court && !courtOf(l).length) return false;
  // hidden by default — but a law the reader asked for by address is always shown
  if (l.i === V.openId) return true;
  if (!V.budget && isBudget(l)) return false;
  if (!V.gone && isGone(l)) return false;
  return true;
}

const SORTS = {
  changed: (a, b) => (b.lp || b.p || "").localeCompare(a.lp || a.p || ""),
  newest: (a, b) => (b.p || "").localeCompare(a.p || ""),
  oldest: (a, b) => (a.p || "9999").localeCompare(b.p || "9999"),
  amended: (a, b) => (b.a - a.a) || (b.lp || "").localeCompare(a.lp || ""),
  name: (a, b) => a.n.localeCompare(b.n, "he"),
};

function rowHtml(l) {
  const st = shownState(l);
  const cb = courtBadge(l);
  const chips = [
    `<span class="lbadge${st === "voided" ? " court" : ""}">${esc(t(STATE_KEY[st]))}</span>`,
    cb && !(st === "voided" && cb.k === "void") ? `<span class="lbadge court">${esc(t(KIND_KEY[cb.k]))}</span>` : "",
    (l.f || "").includes("b") ? `<span class="lbadge soft">${esc(t("basicLaw"))}</span>` : "",
    isTemp(l) ? `<span class="lbadge soft">${esc(t("temporary"))}</span>` : "",
    isBudget(l) ? `<span class="lbadge soft">${esc(t("budgetLaw"))}</span>` : "",
  ].join("");
  const am = l.a === 0 ? t("neverAmended") : l.a === 1 ? t("amendedOnce") : fill(t("amendedN"), { n: fmtN(l.a) });
  const topics = (l.t || []).slice(0, 3).map(id => `<span>${esc(LAW.topics[id] || "")}</span>`).join("");
  return `<div class="lawrow${V.openId === l.i ? " open" : ""}" id="law-${l.i}">
    <button class="head" aria-expanded="${V.openId === l.i}" onclick="toggleLaw(${l.i})">
      <div class="nm"><span class="chev" aria-hidden="true">${V.openId === l.i ? "▾" : "▸"}</span>${nameHtml(lawName(l))}</div>
      <div class="meta">${chips}<span>${esc(am)}</span>${l.lp ? `<span>${esc(t("changedOn") + fmtDate(l.lp))}</span>` : ""}${topics}</div>
    </button>
    <div class="det">${V.openId === l.i ? detailHtml(l) : ""}</div>
  </div>`;
}

function detailHtml(l) {
  const st = shownState(l);
  const status = [`<p>${esc(t(STATE_KEY[st]))} · ${esc(t("knessetSays") + (l.st || ""))}</p>`];
  if (l.s) status.push(`<p>${esc((st === "pending" ? t("startsDate") : t("fromDate")) + fmtDate(l.s))}</p>`);
  if (l.e) status.push(`<p>${esc((l.e < TODAY ? t("endedDate") : t("untilDate")) + fmtDate(l.e))}</p>`);
  const rep = l.r && LAW.byId.get(l.r);
  if (rep) status.push(`<p>${esc(t("replacedBy"))}<a class="golink" href="${lawLink(rep)}">${esc(lawName(rep))}</a></p>`);

  const hist = [];
  if (l.p) hist.push(`<p>${esc(t("firstPub") + fmtDate(l.p))}</p>`);
  if (l.lp && l.lp !== l.p) hist.push(`<p>${esc(t("lastPub") + fmtDate(l.lp))}</p>`);
  hist.push(`<p>${esc(l.a ? fill(t("amendDetail"), { a: fmtN(l.a), d: fmtN(l.ad), i: fmtN(l.a - l.ad) }) : t("neverAmended"))}</p>`);

  const court = courtOf(l);
  const courtHtml = court.length ? `<h3>${esc(t("dCourt"))}</h3><ul>${court.map(c =>
    `<li><b>${esc(t(KIND_KEY[c.k]))}</b> — ${esc(c.w)} · <a class="doclink" href="${esc(c.u)}" target="_blank" rel="noopener">${esc(c.c)}</a> · ${esc(fmtDate(c.d))}${c.pn ? " · " + esc(c.pn + t("judges")) : ""}${c.ds ? " · " + esc(t("dissent") + c.ds) : ""}</li>`).join("")}</ul>` : "";

  const topics = (l.t || []).map(id => LAW.topics[id]).filter(Boolean);
  return `<h3>${esc(t("dStatus"))}</h3>${status.join("")}
    <h3>${esc(t("dHistory"))}</h3>${hist.join("")}
    ${courtHtml}
    ${topics.length ? `<h3>${esc(t("dTopics"))}</h3><p>${esc(topics.join(" · "))}</p>` : ""}
    <p><a class="golink" href="${lawLink(l)}">${esc(t("detailsLink"))} ←</a></p>
    <h3>${esc(t("dSources"))}</h3>
    <p class="srcs"><a class="doclink" href="${wikisourceUrl(l)}" target="_blank" rel="noopener">${esc(t("srcText"))}</a>
      <a class="doclink" href="${knessetRecordUrl(l)}" target="_blank" rel="noopener">${esc(t("srcKnesset"))}</a></p>
    <p class="notadvice">${esc(t("notAdvice"))}</p>`;
}

function renderList() {
  const d = LAW.data;
  if (!d) return;
  const hits = d.laws.filter(matches);
  // not yet in force leads, whatever the order (change first)
  hits.sort((a, b) => ((lawState(b) === "pending") - (lawState(a) === "pending")) || SORTS[V.sort](a, b));
  const shown = hits.slice(0, V.limit);
  const total = d.laws.length;
  const hidB = V.budget ? 0 : d.laws.filter(isBudget).length;
  const hidG = V.gone ? 0 : d.laws.filter(l => isGone(l) && !isBudget(l)).length;
  const stat = document.getElementById("stat");
  stat.innerHTML = esc(hits.length === total ? fill(t("shown"), { n: fmtN(hits.length) })
      : fill(t("shownOf"), { n: fmtN(hits.length), m: fmtN(total) })) +
    ((hidB || hidG) ? ` <span class="hid">${esc(fill(t("hiddenNote"), { b: fmtN(hidB), g: fmtN(hidG) }))}</span>` : "");
  const list = document.getElementById("list");
  if (!hits.length) { list.innerHTML = `<p class="hint">${esc(t("noMatch"))}</p>`; return; }
  let html = shown.map(rowHtml).join("");
  if (hits.length > shown.length) {
    html += `<button class="morebtn" onclick="V.limit += ${PAGE_SIZE}; renderList()">${esc(fill(t("more"), { n: fmtN(Math.min(PAGE_SIZE, hits.length - shown.length)) }))}</button>`;
  }
  list.innerHTML = html;
}

function toggleLaw(id) {
  V.openId = V.openId === id ? null : id;
  renderList();
  syncUrl();
}
function openLaw(id) {
  V.openId = id;
  // the law must be in view: make sure the filters and the page size let it through
  const d = LAW.data, l = LAW.byId.get(id);
  if (!l) return;
  V.q = ""; document.getElementById("q").value = "";
  V.topic = ""; document.getElementById("topic").value = "";
  const hits = d.laws.filter(matches).sort((a, b) => ((lawState(b) === "pending") - (lawState(a) === "pending")) || SORTS[V.sort](a, b));
  const pos = hits.findIndex(x => x.i === id);
  if (pos >= V.limit) V.limit = pos + 1;
  renderList();
  syncUrl();
  const el = document.getElementById("law-" + id);
  if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
}

function syncUrl() {
  const p = new URLSearchParams();
  if (V.q) p.set("q", V.q);
  if (V.topic) p.set("topic", V.topic);
  if (V.openId) p.set("law", V.openId);
  const qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

function applyControls() {
  V.q = document.getElementById("q").value.trim();
  V.topic = document.getElementById("topic").value;
  V.budget = document.getElementById("optBudget").checked;
  V.gone = document.getElementById("optGone").checked;
  V.basic = document.getElementById("optBasic").checked;
  V.court = document.getElementById("optCourt").checked;
  V.sort = document.getElementById("sort").value;
  V.limit = PAGE_SIZE;
  renderList();
  syncUrl();
}

function fillControls() {
  const d = LAW.data;
  // topics with how many laws each holds (of the laws that apply today)
  const counts = {};
  for (const l of d.laws) if (!isGone(l) && !isBudget(l)) for (const id of l.t || []) counts[id] = (counts[id] || 0) + 1;
  const opts = Object.keys(LAW.topics).filter(id => counts[id])
    .sort((a, b) => LAW.topics[a].localeCompare(LAW.topics[b], "he"));
  const sel = document.getElementById("topic");
  sel.innerHTML = `<option value="">${esc(t("topicAll"))}</option>` +
    opts.map(id => `<option value="${id}">${esc(LAW.topics[id])} (${fmtN(counts[id])})</option>`).join("");
  sel.value = V.topic;
  const sort = document.getElementById("sort");
  sort.innerHTML = ["changed", "newest", "oldest", "amended", "name"].map(k =>
    `<option value="${k}">${esc(t("sort" + k[0].toUpperCase() + k.slice(1)))}</option>`).join("");
  sort.value = V.sort;
}

window.onLangChange = () => { fillControls(); renderList(); };

(async function init() {
  const p = new URLSearchParams(location.search);
  V.q = p.get("q") || "";
  V.topic = p.get("topic") || "";
  const want = Number(p.get("law")) || null;
  document.getElementById("q").value = V.q;
  try {
    await loadLaws();
    fillControls();
    if (want && LAW.byId.has(want)) openLaw(want);
    else renderList();
  } catch (e) {
    debug(e.message);
    document.getElementById("list").innerHTML = `<p class="error">${esc(friendly(e))}</p>`;
  }
})();
