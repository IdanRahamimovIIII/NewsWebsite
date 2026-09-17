"use strict";
/* =====================================================================
   Our Money — ספקים והתקשרויות: drawing it.
   Everything that touches the DOM lives here. The init block is at the
   bottom and is the only thing that runs on load.

   The page is three doors into the same table:
     the top suppliers of a year → click a name → the supplier's profile
     the free-text search        → click a name → the same profile
   A profile is addressable (#s=…), so a reader can send a supplier to
   someone else and the back button behaves.
   ===================================================================== */

/* ---------- numbers ---------- */
const nfmt = (opts) => new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-US", opts);
function fmtCompact(v) {
  if (v == null || isNaN(v)) return "—";
  const n = +v, abs = Math.abs(n);
  if (abs >= 1e9) return nfmt({ maximumFractionDigits: 1 }).format(n / 1e9) + t("bn");
  if (abs >= 1e6) return nfmt({ maximumFractionDigits: 1 }).format(n / 1e6) + t("mn");
  return nfmt().format(Math.round(n)) + " ₪";
}
const fmtCount = v => nfmt().format(+v || 0);

/* supplier_name is a JSON array; show it as words */
function cleanName(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string") {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p.join(", "); } catch (e) {}
    return v.replace(/^\["|"\]$/g, "");
  }
  return v ?? "—";
}

/* the register's categories, as words; rare kinds stay unchipped */
const ENTITY = {
  company: "entityCompany", association: "entityAssoc", municipality: "entityMuni",
  government_office: "entityGov", university: "entityUni", cooperative: "entityCoop",
  partnership: "entityPartner", law_mandated_organization: "entityLawOrg",
  "ottoman-association": "entityOttoman", health_service: "entityHealth",
  foreign_company: "entityForeign",
};
const kindChip = (kind) => {
  const k = ENTITY[String(kind)];
  return k ? ` <span class="ekind">${esc(t(k))}</span>` : "";
};

/* the years a contract was REPORTED in — the edges hold placeholders
   (1899, 2099, 9999); never print those as dates */
function contractYears(r) {
  const a = saneYear(r.min_year), b = saneYear(r.max_year);
  if (a && b) return a === b ? String(a) : a + "–" + b;
  return String(a || b || "");
}

const methodText = (m) => Array.isArray(m) ? m.join(" · ") : (m || "");

/* ---------- the popover (column explanations) ---------- */
let popKey = null;
function closePop() {
  popKey = null;
  document.getElementById("pop").classList.remove("open");
  document.querySelectorAll("[aria-haspopup='dialog']").forEach(b => b.setAttribute("aria-expanded", "false"));
}
function showPop(key, btn, title, bodyHtml, src) {
  if (popKey === key) { closePop(); btn.focus(); return; }
  closePop();
  popKey = key;
  const p = document.getElementById("pop");
  p.className = "pop open";
  p.innerHTML = `<button class="popx" type="button" aria-label="${esc(t("close"))}"
      onclick="closePop()">✕</button>
    <div class="popq">${esc(title)}</div>
    <div class="popa">${bodyHtml}</div>
    ${src ? `<div class="popsrc">${esc(src)}</div>` : ""}`;
  btn.setAttribute("aria-expanded", "true");
  const b = btn.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
  let x = Math.min(Math.max(8, b.left + b.width / 2 - w / 2), innerWidth - w - 8);
  let y = b.bottom + 8;
  if (y + h > innerHeight - 8) y = Math.max(8, b.top - h - 8);
  p.style.left = x + "px";
  p.style.top = y + "px";
  p.focus();
}
function infoPop(btn, key) {
  showPop("info:" + key, btn, t(key + "InfoT"), esc(t(key + "InfoB")));
}
const infoBtn = (key) => `<button class="info-i" type="button" aria-haspopup="dialog"
  aria-expanded="false" aria-label="${esc(t("info"))}" onclick="infoPop(this,'${key}')">?</button>`;
document.addEventListener("keydown", e => { if (e.key === "Escape" && popKey) closePop(); });
document.addEventListener("click", e => {
  if (!popKey) return;
  if (e.target.closest("#pop") || e.target.closest("[aria-haspopup='dialog']")) return;
  closePop();
});
addEventListener("scroll", () => { if (popKey) closePop(); }, { passive: true });
addEventListener("resize", () => { if (popKey) closePop(); });

/* ---------- the opening numbers ----------
   Three tiles: how much is in force, how much of it is exempt from tender,
   and how concentrated it is. The words carry the weight — no colour says
   "bad": an exemption is lawful, and the page holds no opinions. */
const fmtPct = v => nfmt({ maximumFractionDigits: 1 }).format(v) + "%";

/* a compact money figure, split so the unit can render small beside the number */
function moneyParts(v) {
  if (v == null || isNaN(v)) return null;
  const n = +v, abs = Math.abs(n);
  if (abs >= 1e9) return { num: nfmt({ maximumFractionDigits: 1 }).format(n / 1e9), unit: t("bn").trim() };
  if (abs >= 1e6) return { num: nfmt({ maximumFractionDigits: 1 }).format(n / 1e6), unit: t("mn").trim() };
  return { num: nfmt().format(Math.round(n)), unit: "₪" };
}
const moneyHtml = v => {
  const p = moneyParts(v);
  return p ? `${esc(p.num)}<span class="u">${esc(p.unit)}</span>` : "—";
};

function tileVals() {
  const d = state.tilesByYear[state.year];
  if (!d || !+d.total) return null;
  const top = (state.topByYear[state.year] || {}).all;
  const top10 = top ? top.slice(0, 10).reduce((a, r) => a + (+r.volume || 0), 0) : null;
  return {
    n: fmtCount(d.n), ns: fmtCount(d.suppliers),
    total: d.total, exempt: d.exempt_vol,
    v: fmtCompact(d.total), ev: fmtCompact(d.exempt_vol),
    ep: fmtPct(100 * d.exempt_vol / d.total),
    cp: top10 != null ? fmtPct(100 * top10 / d.total) : null,
    y: state.year,
  };
}

function renderTiles() {
  const box = document.getElementById("tiles");
  if (state.tilesByYear[state.year] === undefined) return;   // still on its way
  document.getElementById("tileshint").textContent = fill(t("tilesHint"), { y: state.year });
  const v = tileVals();
  if (!v) { box.innerHTML = `<div class="loading">${esc(t("topEmpty"))}</div>`; return; }
  const tile = (cls, name, numHtml, ctx, i, ask) => `
    <div class="kpi ${cls}">
      <div class="lbl"><i class="dot"></i>${esc(t(name))}</div>
      <div class="num">${numHtml}</div>
      <div class="plan">${esc(ctx)}</div>
      <button class="ask" type="button" aria-expanded="false" aria-haspopup="dialog"
        onclick="tilePop(${i}, this)">${esc(t(ask))}</button>
    </div>`;
  box.innerHTML =
    tile("tax", "tTotal", moneyHtml(v.total), fill(t("tTotalCtx"), { n: v.n }), 0, "askTotal") +
    tile("muted", "tExempt", moneyHtml(v.exempt), fill(t("tExemptCtx"), { p: v.ep }), 1, "askExempt") +
    (v.cp != null
      ? tile("muted", "tConc", esc(v.cp), fill(t("tConcCtx"), { p: v.cp, n: v.ns }), 2, "askConc")
      : "");
}

function tilePop(i, btn) {
  const v = tileVals();
  if (!v) return;
  const keys = ["Total", "Exempt", "Conc"];
  const body = fill(t("ans" + keys[i]), { y: v.y, v: i === 1 ? v.ev : v.v, n: v.n,
    p: i === 2 ? v.cp : v.ep });
  const src = t("ans" + keys[i] + "Src");
  showPop("tile:" + i, btn, t("ask" + keys[i]), esc(body),
    src === "ans" + keys[i] + "Src" ? "" : src);
}

/* ---------- the top suppliers of a year ---------- */
function renderTopSwitch() {
  const box = document.getElementById("topswitch");
  box.innerHTML = [["all", "viewAll"], ["exempt", "viewExempt"]].map(([m, k]) =>
    `<button type="button" class="segbtn${state.topMode === m ? " on" : ""}"
       aria-pressed="${state.topMode === m}" onclick="setTopMode('${m}')">${esc(t(k))}</button>`).join("");
}

async function setTopMode(mode) {
  if (state.topMode === mode) return;
  state.topMode = mode;
  renderTopSwitch();
  renderTopHint();
  const out = document.getElementById("topout");
  if (!(state.topByYear[state.year] || {})[mode]) {
    out.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
    try { await loadTopSuppliers(state.year, mode); }
    catch (e) {
      out.innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
      debug("top " + mode + ": " + e.message);
      return;
    }
  }
  renderTop();
}

function renderTopHint() {
  const y = state.year;
  document.getElementById("tophint").textContent =
    (state.topMode === "exempt" ? t("topHintExempt")
      : fill(t("topHint"), { y }) + (y >= THIS_YEAR - 1 ? " " + t("topRecent") : ""));
  document.getElementById("topnote").textContent = t("topNote");
}

/* the blanks are the government's reporting, not a bug — count them out loud */
function renderTopGap(rows) {
  const el = document.getElementById("topgap");
  const gap = rows.filter(r => r.executed == null || +r.executed === 0).length;
  el.textContent = gap
    ? fill(t(gap === 1 ? "topGapOne" : "topGapSome"), { n: gap, of: rows.length })
    : "";
}

const topRows = () => (state.topByYear[state.year] || {})[state.topMode];

function renderTop() {
  const out = document.getElementById("topout");
  const rows = topRows();
  if (!rows) return;
  if (!rows.length) {
    out.innerHTML = `<div class="loading">${esc(t("topEmpty"))}</div>`;
    document.getElementById("topgap").textContent = "";
    return;
  }
  out.innerHTML = `<div class="tw cardify"><table>
    <thead><tr><th></th><th>${esc(t("colSupplier"))}</th>
      <th class="num">${esc(t("colContracts"))}</th>
      <th class="num">${esc(t("colVolume"))} ${infoBtn("vol")}</th>
      <th class="num">${esc(t("colPaidToDate"))} ${infoBtn("paid")}</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><button class="supbtn" type="button"
        onclick="openTopSupplier(${i})">${esc(cleanName(r.name))}</button>${kindChip(r.kind)}</td>
      <td class="num" data-l="${esc(t("colContracts"))}">${fmtCount(r.n)}</td>
      <td class="num" data-l="${esc(t("colVolume"))}">${fmtCompact(r.volume)}</td>
      <td class="num" data-l="${esc(t("colPaidToDate"))}">${fmtCompact(r.executed)}</td>
    </tr>`).join("")}</tbody></table></div>`;
  renderTopGap(rows);
}

/* the year drives everything above the search: the tiles, the top list and
   the exemption table load together, and each draws as soon as it lands */
async function loadYear() {
  state.year = +document.getElementById("yearsel").value || state.year;
  renderTopHint();
  document.getElementById("tileshint").textContent = fill(t("tilesHint"), { y: state.year });
  const loading = `<div class="loading">${esc(t("loading"))}</div>`;
  if (!state.tilesByYear[state.year]) document.getElementById("tiles").innerHTML = loading;
  if (!topRows()) document.getElementById("topout").innerHTML = loading;
  if (!state.exByYear[state.year]) document.getElementById("exout").innerHTML = loading;

  const failed = (id, tag) => (e) => {
    document.getElementById(id).innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
    debug(tag + " " + state.year + ": " + e.message);
  };
  const jobs = [
    loadTiles(state.year).then(renderTiles, failed("tiles", "tiles")),
    /* the concentration tile always needs the unfiltered ranking */
    loadTopSuppliers(state.year, "all")
      .then(() => { renderTop(); renderTiles(); }, failed("topout", "top")),
    loadExemptions(state.year).then(renderExemptions, failed("exout", "exempt")),
  ];
  if (state.topMode !== "all")
    jobs.push(loadTopSuppliers(state.year, state.topMode)
      .then(renderTop, failed("topout", "top")));
  await Promise.all(jobs);
}

function openTopSupplier(i) {
  const r = (topRows() || [])[i];
  if (r) openSupplier(r.sid, cleanName(r.name), r.kind);
}

/* ---------- which exemption regulations carry the money ---------- */
function renderExemptions() {
  const rows = state.exByYear[state.year];
  if (!rows) return;
  document.getElementById("exhint").textContent = fill(t("exHint"), { y: state.year });
  const out = document.getElementById("exout");
  if (!rows.length) { out.innerHTML = `<div class="loading">${esc(t("topEmpty"))}</div>`; return; }
  out.innerHTML = `<div class="tw cardify"><table>
    <thead><tr><th>${esc(t("colRegulation"))}</th>
      <th class="num">${esc(t("colContracts"))}</th>
      <th class="num">${esc(t("colVolume"))} ${infoBtn("vol")}</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="wrap">${esc(Array.isArray(r.exemption_reason)
        ? r.exemption_reason.join(" + ") : String(r.exemption_reason ?? ""))}</td>
      <td class="num" data-l="${esc(t("colContracts"))}">${fmtCount(r.n)}</td>
      <td class="num" data-l="${esc(t("colVolume"))}">${fmtCompact(r.volume)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ---------- the search ---------- */
async function doSearch() {
  const q = document.getElementById("q").value.trim();
  if (!q) return;
  const out = document.getElementById("searchout");
  out.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
  try {
    state.lastSearch = await searchContracts(q);
    renderSearch();
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
    debug("search: " + e.message);
  }
}

function renderSearch() {
  const rows = state.lastSearch;
  if (!rows) return;
  const out = document.getElementById("searchout");
  if (!rows.length) { out.innerHTML = `<div class="loading">${esc(t("searchEmpty"))}</div>`; return; }
  out.innerHTML = `<div class="tw cardify"><table>
    <thead><tr>
      <th>${esc(t("colSupplier"))}</th><th>${esc(t("colPurpose"))}</th><th>${esc(t("colOffice"))}</th>
      <th class="num">${esc(t("colYears"))}</th>
      <th class="num">${esc(t("colVolume"))} ${infoBtn("vol")}</th>
      <th class="num">${esc(t("colPaid"))} ${infoBtn("paid")}</th>
    </tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td><button class="supbtn" type="button"
        onclick="openSearchSupplier(${i})">${esc(cleanName(r.supplier_name))}</button></td>
      <td class="wrap">${esc(r.purpose)}</td>
      <td>${esc(r.publisher_name)}</td>
      <td class="num" data-l="${esc(t("colYears"))}"><span dir="ltr">${esc(contractYears(r))}</span></td>
      <td class="num" data-l="${esc(t("colVolume"))}">${fmtCompact(r.volume)}</td>
      <td class="num" data-l="${esc(t("colPaid"))}">${fmtCompact(r.executed)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function openSearchSupplier(i) {
  const r = (state.lastSearch || [])[i];
  if (!r) return;
  /* the sid is the entity_id when there is one; otherwise the EXACT text
     form of the name array — verified to round-trip via JSON.stringify */
  const sid = r.entity_id || JSON.stringify(r.supplier_name);
  openSupplier(sid, cleanName(r.supplier_name), null);
}

/* ---------- one supplier, in full ---------- */
async function openSupplier(sid, label, kind) {
  const card = document.getElementById("supcard");
  card.hidden = false;
  document.getElementById("supname").innerHTML = esc(label || "") + kindChip(kind);
  document.getElementById("supfacts").innerHTML = "";
  document.getElementById("supbody").innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  if (history.replaceState)
    history.replaceState(null, "", "#s=" + encodeURIComponent(sid));
  try { state.supplier = await loadSupplier(sid); }
  catch (e) {
    document.getElementById("supbody").innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
    debug("supplier: " + e.message);
    return;
  }
  /* a hash-opened profile arrives with only an id for a label — once the
     data is here, the supplier's actual name takes over */
  state.supplier.label = (label && !/^\d+$/.test(label))
    ? label : cleanName(state.supplier.facts.name || label);
  state.supplier.kind = kind;
  renderSupplier();
}

function renderSupplier() {
  const s = state.supplier;
  if (!s || document.getElementById("supcard").hidden) return;
  document.getElementById("supname").innerHTML = esc(s.label || "") + kindChip(s.kind);
  const f = s.facts;
  if (!(+f.n)) {
    document.getElementById("supfacts").innerHTML = "";
    document.getElementById("supbody").innerHTML = `<div class="loading">${esc(t("supEmpty"))}</div>`;
    return;
  }
  const fact = (label, val, ltr) =>
    `<span>${esc(label)}: <b${ltr ? ' dir="ltr"' : ""}>${esc(val)}</b></span>`;
  const years = (f.y0 && f.y1) ? (f.y0 === f.y1 ? String(f.y0) : f.y0 + "–" + f.y1) : "";
  document.getElementById("supfacts").innerHTML =
    fact(t("factContracts"), fmtCount(f.n)) +
    fact(t("factVolume"), fmtCompact(f.volume)) +
    fact(t("factPaid"), fmtCompact(f.executed)) +
    (years ? fact(t("factYears"), years, true) : "");

  const spark = sparkHtml(s.series);

  const offices = `<h3 class="subhead2">${esc(t("byOfficeTitle"))}</h3>
    <div class="tw cardify"><table>
      <thead><tr><th>${esc(t("colOffice"))}</th>
        <th class="num">${esc(t("colContracts"))}</th>
        <th class="num">${esc(t("colVolume"))} ${infoBtn("vol")}</th>
        <th class="num">${esc(t("colPaidToDate"))} ${infoBtn("paid")}</th></tr></thead>
      <tbody>${s.byOffice.map(r => `<tr>
        <td>${esc(r.publisher_name ?? "—")}</td>
        <td class="num" data-l="${esc(t("colContracts"))}">${fmtCount(r.n)}</td>
        <td class="num" data-l="${esc(t("colVolume"))}">${fmtCompact(r.volume)}</td>
        <td class="num" data-l="${esc(t("colPaidToDate"))}">${fmtCompact(r.executed)}</td>
      </tr>`).join("")}</tbody></table></div>`;

  const more = +f.n > s.rows.length
    ? `<p class="axisnote">${esc(fill(t("supMore"), { n: s.rows.length, of: fmtCount(f.n) }))}</p>` : "";
  const contracts = `<h3 class="subhead2">${esc(t("bigTitle"))}</h3>
    <div class="tw cardify"><table>
      <thead><tr><th>${esc(t("colPurpose"))}</th><th>${esc(t("colOffice"))}</th>
        <th>${esc(t("colMethod"))}</th>
        <th class="num">${esc(t("colYears"))}</th>
        <th class="num">${esc(t("colVolume"))} ${infoBtn("vol")}</th>
        <th class="num">${esc(t("colPaid"))} ${infoBtn("paid")}</th></tr></thead>
      <tbody>${s.rows.map((r, i) => `<tr>
        <td class="wrap">${esc(r.purpose ?? "—")}</td>
        <td>${esc(r.publisher_name ?? "—")}</td>
        <td data-l="${esc(t("colMethod"))}"><span class="method">${esc(methodText(r.purchase_method))}</span>${
          exemptionPubId(r) ? ` <button class="purposebtn" type="button" aria-haspopup="dialog"
            aria-expanded="false" onclick="exemptPop(this,${i})">${esc(t("whyExempt"))}</button>` : ""}</td>
        <td class="num" data-l="${esc(t("colYears"))}"><span dir="ltr">${esc(contractYears(r))}</span></td>
        <td class="num" data-l="${esc(t("colVolume"))}">${fmtCompact(r.volume)}</td>
        <td class="num" data-l="${esc(t("colPaid"))}">${fmtCompact(r.executed)}</td>
      </tr>`).join("")}</tbody></table></div>${more}`;

  document.getElementById("supbody").innerHTML = spark + offices + contracts;
}

/* ---------- the profile's chart: in-force volume, year by year ----------
   The same definition as everything else on the page — a contract counts,
   in full, in every year it is in force — so the chart and the tables can
   never disagree. The two youngest years are hatched: they are still being
   reported, and sparkNote says so. */
function sparkHtml(series) {
  const by = {};
  for (const r of series || []) by[+r.year] = +r.volume || 0;
  const years = [];
  for (let y = FIRST_YEAR; y <= THIS_YEAR; y++) years.push({ y, v: by[y] || 0 });
  if (years.filter(p => p.v > 0).length < 2) return "";
  const W = 900, H = 170, mT = 24, mB = 26, mL = 8, mR = 76;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const max = Math.max(...years.map(p => p.v));
  const step = plotW / years.length, bw = Math.min(34, step - 6);
  const yOf = v => mT + plotH - (v / max) * plotH;
  const xOf = i => mL + i * step + (step - bw) / 2;
  let s = `<defs><pattern id="sp-part" width="6" height="6" patternTransform="rotate(45)"
      patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--surface-1)"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--series-1)" stroke-width="3.4"/></pattern></defs>`;
  s += `<line class="gridline base" x1="${mL}" x2="${W - mR}" y1="${yOf(0)}" y2="${yOf(0)}"/>`;
  s += `<text class="axis val" x="${W - mR + 8}" y="${yOf(max) + 4}">${esc(fmtCompact(max))}</text>`;
  years.forEach((p, i) => {
    const partial = p.y >= THIS_YEAR - 1;      // still being reported
    const hgt = Math.max(p.v > 0 ? 1 : 0, yOf(0) - yOf(p.v));
    if (hgt) s += partial
      ? `<rect x="${xOf(i)}" y="${yOf(p.v)}" width="${bw}" height="${hgt}" rx="2"
           fill="url(#sp-part)" stroke="var(--series-1)" stroke-width="1.2"><title>${p.y}: ${esc(fmtCompact(p.v))}</title></rect>`
      : `<rect x="${xOf(i)}" y="${yOf(p.v)}" width="${bw}" height="${hgt}" rx="2"
           fill="var(--series-1)"><title>${p.y}: ${esc(fmtCompact(p.v))}</title></rect>`;
    if (p.y % 2 === (FIRST_YEAR % 2) || i === years.length - 1)
      s += `<text class="axis" x="${xOf(i) + bw / 2}" y="${H - mB + 18}"
        text-anchor="middle">${p.y}</text>`;
  });
  return `<h3 class="subhead2">${esc(t("sparkTitle"))}</h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${esc(t("sparkTitle"))}">${s}</svg>
    <p class="axisnote">${esc(t("sparkNote"))}</p>`;
}

/* the exemption's own publication: what the ministry wrote when it asked
   not to hold a tender — the description, the reason, the regulation, the
   committee decision, and the publication itself on mr.gov.il. Everything
   verbatim; the page adds nothing. */
async function exemptPop(btn, i) {
  const r = state.supplier && state.supplier.rows[i];
  const pid = r && exemptionPubId(r);
  if (!pid) return;
  let pub = null;
  try { pub = await loadExemptionPub(pid); }
  catch (e) { debug("pub " + pid + ": " + e.message); }
  if (!pub) return;
  const line = (label, value) => value
    ? `<div class="poprow"><span>${esc(label)}</span><b>${esc(value)}</b></div>` : "";
  const url = String(pub.page_url || "");
  const body = (pub.description ? `<div class="poppurpose">${esc(pub.description)}</div>` : "")
    + line(t("pubReason"), pub.reason)
    + line(t("pubRegulation"), pub.regulation)
    + line(t("pubDecision"), pub.decision)
    + (/^https:\/\//.test(url) ? `<div class="poprow"><a href="${esc(url)}" target="_blank"
        rel="noopener">${esc(t("pubLink"))} →</a></div>` : "");
  showPop("pub:" + pid, btn, t("pubTitle"), body, t("pubSrc"));
}

function closeSupplier() {
  document.getElementById("supcard").hidden = true;
  state.supplier = null;
  if (history.replaceState)
    history.replaceState(null, "", location.pathname + location.search);
}

/* a shared link opens straight onto the supplier it names */
function openFromHash() {
  const m = /[#&]s=([^&]+)/.exec(location.hash || "");
  if (!m) return false;
  const sid = decodeURIComponent(m[1]);
  const label = /^\d+$/.test(sid) ? sid : cleanName(sid);
  openSupplier(sid, label, null);
  return true;
}

/* ---------- language ---------- */
window.onLangChange = () => {
  closePop();
  document.getElementById("yearnote").textContent = t("yearNote");
  renderTopSwitch();
  renderTopHint();
  renderTiles();
  renderTop();
  renderExemptions();
  if (state.lastSearch) renderSearch();
  if (state.supplier) renderSupplier();
};

/* the sticky year bar has to clear the sticky site header, whose height
   depends on the language and the viewport — measure it, don't hard-code */
function syncStickyOffset() {
  const bar = document.querySelector("header.topbar");
  if (!bar) return;
  document.documentElement.style.setProperty("--topbar-h", bar.offsetHeight + "px");
}
addEventListener("resize", syncStickyOffset);

/* ---------- init ---------- */
function init() {
  applyLang();
  syncStickyOffset();
  document.getElementById("yearnote").textContent = t("yearNote");
  const sel = document.getElementById("yearsel");
  sel.innerHTML = YEARS.map(y => `<option value="${y}">${y}</option>`).join("");
  sel.value = state.year;
  renderTopSwitch();
  renderTopHint();
  loadYear();
  openFromHash();
  addEventListener("hashchange", () => { if (!openFromHash()) closeSupplier(); });
}

init();
