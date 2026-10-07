"use strict";
/* =====================================================================
   The laws list: every law in the Knesset register. Search, topic and
   the options filter the SAME list in place. Budget laws and laws that no
   longer apply are hidden by default, one click shows them (Mercy); a
   law not yet in force always leads (change first, Mercy).
   A row is a link to the law's own page /law/<id>/ — no dropdown; the rare
   facts (start, end, replaced by) sit in the row itself (Mercy).
   Address: ?q= ?topic=; an old ?law=<id> goes to that law's page.
   ===================================================================== */

const PAGE_SIZE = 150;
const V = { q: "", topic: "", kind: "in", basic: false, court: false,   // budget laws always listed; kind: all|in|gone (Mercy)
            sort: "changed", limit: PAGE_SIZE };

const normHe = s => String(s || "").replace(/[֑-ׇ]/g, "").replace(/["'״׳]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function matches(l, loose) {   // loose: the name only, no settings
  if (V.q) {
    const words = normHe(V.q).split(" ").filter(Boolean);
    const name = normHe(l.n);
    if (!words.every(w => name.includes(w))) return false;
  }
  if (loose) return true;
  if (V.topic && !(l.t || []).includes(Number(V.topic))) return false;
  if (V.basic && !(l.f || "").includes("b")) return false;
  if (V.court && !courtOf(l).length) return false;
  if (V.kind === "in" && isGone(l)) return false;           // in force per the Knesset (+ not yet, which leads)
  if (V.kind === "gone" && !notApplying(l)) return false;
  return true;
}

/* "בוטלו או לא בתוקף" = the Knesset says repealed / expired / obsolete, OR
   the court voided or froze the whole law. The latter still shows among
   "חלים היום" when the Knesset says so — in both lists, marked red (Mercy) */
const notApplying = l => isGone(l) || courtStops(l);

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
    st === "in" ? "" : `<span class="lbadge${st === "voided" ? " stop" : ""}">${esc(t(STATE_KEY[st]))}</span>`,   // no tag = applies today
    cb && !(st === "voided" && cb.k === "void") ? `<span class="lbadge ${cb.k === "void" || cb.k === "frozen" ? "stop" : "court"}">${esc(t(KIND_KEY[cb.k]))}</span>` : "",
    (l.f || "").includes("b") ? `<span class="lbadge soft">${esc(t("basicLaw"))}</span>` : "",
    isTemp(l) ? `<span class="lbadge soft">${esc(t("temporary"))}</span>` : "",
    isBudget(l) ? `<span class="lbadge soft">${esc(t("budgetLaw"))}</span>` : "",
  ].join("");
  const am = l.a === 0 ? t("neverAmended") : l.a === 1 ? t("amendedOnce") : fill(t("amendedN"), { n: fmtN(l.a) });
  const topics = (l.t || []).slice(0, 3).map(id => `<span>${esc(LAW.topics[id] || "")}</span>`).join("");
  // the rare facts, in the row: a start still ahead, an end, a successor
  const rep = isGone(l) && l.r && LAW.byId.get(l.r);   // a law in force was not replaced (sections only — pipeline NOTES)
  const facts = [
    lawState(l) === "pending" && l.s ? `<span><b>${esc(t("kvStart"))}:</b> ${esc(fmtDate(l.s))}</span>` : "",
    l.e ? `<span><b>${esc(t("kvEnd"))}:</b> ${esc(fmtDate(l.e))}</span>` : "",
    rep ? `<span><b>${esc(t("kvReplaced"))}:</b> <a class="replink" href="${lawLink(rep)}">${esc(lawName(rep))}</a></span>` : "",
  ].join("");
  // the name's link covers the whole row (.lawrow a.go::after); the successor's link sits above it
  return `<div class="lawrow" id="law-${l.i}">
    <div class="nm"><a class="go" href="${lawLink(l)}">${nameHtml(lawName(l))}</a></div>
    <div class="meta">${chips}<span>${esc(am)}</span>${l.lp ? `<span>${esc(t("changedOn") + fmtDate(l.lp))}</span>` : ""}${topics}</div>
    ${facts ? `<div class="facts">${facts}</div>` : ""}
  </div>`;
}

function renderList() {
  const d = LAW.data;
  if (!d) return;
  let hits = d.laws.filter(l => matches(l));
  // a name search the settings emptied: show what they hid, and say so (Mercy)
  const loose = !hits.length && V.q ? d.laws.filter(l => matches(l, true)) : [];
  if (loose.length) hits = loose;
  // not yet in force leads, whatever the order (change first)
  hits.sort((a, b) => (isSoon(b) - isSoon(a)) || SORTS[V.sort](a, b));
  const shown = hits.slice(0, V.limit);
  const total = d.laws.length;
  const hidB = 0;                                           // budget laws are always listed
  const hidG = V.kind === "in" && !loose.length ? d.laws.filter(isGone).length : 0;
  const stat = document.getElementById("stat");
  stat.innerHTML = esc(hits.length === total ? fill(t("shown"), { n: fmtN(hits.length) })
      : fill(t("shownOf"), { n: fmtN(hits.length), m: fmtN(total) })) +
    ((hidB || hidG) ? ` <span class="hid">${esc(fill(t(hidB ? "hiddenNote" : "hiddenGone"), { b: fmtN(hidB), g: fmtN(hidG) }))}</span>` : "");
  const list = document.getElementById("list");
  if (!hits.length) { list.innerHTML = `<p class="hint">${esc(t("noMatch"))}</p>`; return; }
  let html = (loose.length ? `<p class="loosenote"><b>!</b> ${esc(t("looseNote"))}</p>` : "") + shown.map(rowHtml).join("");
  if (hits.length > shown.length) {
    html += `<button class="morebtn" onclick="V.limit += ${PAGE_SIZE}; renderList()">${esc(fill(t("more"), { n: fmtN(Math.min(PAGE_SIZE, hits.length - shown.length)) }))}</button>`;
  }
  list.innerHTML = html;
}

function syncUrl() {
  const p = new URLSearchParams();
  if (V.q) p.set("q", V.q);
  if (V.topic) p.set("topic", V.topic);
  const qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

/* ---------- suggestions under the search field (attachSuggest, common.js):
   every law, whatever the settings, with its tag; a pick goes to that law's
   page (Mercy) ---------- */
function lawSuggest(text) {
  const q = normHe(text), words = q.split(" ").filter(Boolean);
  if (!words.length || !LAW.data) return [];
  const hits = [];
  for (const l of LAW.data.laws) {
    const n = normHe(l.n);
    if (words.every(w => n.includes(w))) hits.push([l, n.includes(q) ? 0 : 1, notApplying(l) ? 1 : 0, n.length]);
  }
  // the typed phrase whole first, then laws in force, then the shorter name
  hits.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  return hits.slice(0, 8).map(([l]) => {
    const st = shownState(l), cb = courtBadge(l);
    const tags = (st === "in" ? "" : `<span class="lbadge${st === "voided" ? " stop" : ""}">${esc(t(STATE_KEY[st]))}</span>`) +
      (cb && cb.k === "frozen" ? `<span class="lbadge stop">${esc(t(KIND_KEY.frozen))}</span>` : "");
    return { html: `<span class="sname">${markWords(lawName(l), words)}</span>${tags}`, pick: () => { location.href = lawLink(l); } };
  });
}

function applyControls() {
  V.q = document.getElementById("q").value.trim();
  V.topic = document.getElementById("topic").value;
  V.kind = document.getElementById("kind").value;
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
  const kind = document.getElementById("kind");
  kind.innerHTML = [["all", "kindAll"], ["in", "kindIn"], ["gone", "kindGone"]].map(([v, k]) =>
    `<option value="${v}">${esc(t(k))}</option>`).join("");
  kind.value = V.kind;
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
  if (want) { location.replace("/law/" + want + "/"); return; }   // an old address: the law has its own page
  document.getElementById("q").value = V.q;
  try {
    await loadLaws();
    fillControls();
    attachSuggest(document.getElementById("q"), lawSuggest);
    renderList();
  } catch (e) {
    debug(e.message);
    document.getElementById("list").innerHTML = `<p class="error">${esc(friendly(e))}</p>`;
  }
})();
