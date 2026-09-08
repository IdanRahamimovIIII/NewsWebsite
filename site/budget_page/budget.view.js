"use strict";
/* =====================================================================
   Our Money — the budget page: drawing it.
   Everything that touches the DOM lives here. The init block is at the
   bottom and is the only thing that runs on load.
   ===================================================================== */

/* ---------- numbers ---------- */
const nfmt = (opts) => new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-US", opts);

function fmtFull(v) {
  if (v == null || isNaN(v)) return "—";
  return nfmt().format(Math.round(v * SCALE));
}
function fmtCompact(v) {
  if (v == null || isNaN(v)) return "—";
  const n = v * SCALE, abs = Math.abs(n);
  if (abs >= 1e9) return nfmt({ maximumFractionDigits: 1 }).format(n / 1e9) + t("bn");
  if (abs >= 1e6) return nfmt({ maximumFractionDigits: 1 }).format(n / 1e6) + t("mn");
  return nfmt().format(Math.round(n)) + " ₪";
}
const fmtBn  = v => nfmt({ maximumFractionDigits: 1 }).format((v * SCALE) / 1e9);
const fmtPct = v => nfmt({ maximumFractionDigits: 1 }).format(v) + "%";

/* ---------- tooltip (charts) ---------- */
const tip = document.getElementById("tip");
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.style.display = "block";
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = lang === "he" ? evt.clientX - w - pad : evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x < 4) x = evt.clientX + pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
  tip.style.left = Math.max(4, x) + "px";
  tip.style.top = Math.max(4, y) + "px";
}
function hideTip() { tip.style.display = "none"; }

function barTip(evt, el) {
  const r = el._row; if (!r) return;
  showTip(evt, `<div class="t">${esc(r.title)}</div>
    <div class="r"><span>${t("colAllocated")}</span><b>${fmtFull(+r.net_allocated)} ₪</b></div>
    <div class="r"><span>${t("colRevised")}</span><b>${fmtFull(+r.net_revised)} ₪</b></div>
    <div class="r"><span>${t("colExecuted")}</span><b>${fmtFull(+r.net_executed)} ₪</b></div>`);
}
function barTipFocus(el) {
  const b = el.getBoundingClientRect();
  barTip({ clientX: b.left + b.width / 2, clientY: b.top + b.height }, el);
}

/* =====================================================================
   THE FOUR FLOWS — the money coming in
   ===================================================================== */

const TILES = [
  { k: "tax",  cls: "tax",   name: "fTax",  ask: "askTax",  ans: "ansTax" },
  { k: "debt", cls: "debt",  name: "fDebt", ask: "askRed",  ans: "ansDebt", red: true },
  { k: "int",  cls: "debt",  name: "fInt",  ask: "askRed",  ans: "ansInt",  red: true },
  { k: "prin", cls: "muted", name: "fPrin", ask: "askPrin", ans: "ansPrin" },
];

/* taxes and fees are one number to a reader, two codes in the data */
const tileValue = (f, k) => k === "tax" ? fv(f, "tax") + fv(f, "fees") : fv(f, k);
const tilePlan  = (f, k) => k === "tax"
  ? (f.tax[PLAN] || 0) + (f.fees[PLAN] || 0)
  : (f[k][PLAN] || 0);

/* agorot of interest per shekel of tax — the one ratio worth saying out loud */
const agorot = f => nfmt({ maximumFractionDigits: 1 }).format(100 * fv(f, "int") / (fv(f, "tax") || 1));

/* The line under each number says what it MEANS, not how it was booked.
   Budget-vs-execution is real but it is bookkeeping — it moved to the popover,
   where the people who care will go looking for it. */
function ctxNote(f, k) {
  const inAll = flowIn(f) || 1;
  if (k === "tax")  return fill(t("ctxTax"),  { p: fmtPct(100 * tileValue(f, "tax") / inAll) });
  if (k === "debt") return fill(t("ctxDebt"), { p: fmtPct(100 * fv(f, "debt") / inAll) });
  if (k === "int")  return fill(t("ctxInt"),  { a: agorot(f) });
  // principal: what the year did to the debt as a whole
  const net = fv(f, "debt") - fv(f, "prin");
  return fill(t(net >= 0 ? "ctxPrinUp" : "ctxPrinDown"), { d: fmtCompact(Math.abs(net)) });
}

function renderYearState() {
  const el = document.getElementById("flowsnote");
  if (!el) return;
  const f = state.flowByYear[state.year];
  el.textContent = f ? t(isPlanYear(f) ? "flowsPlan" : "flowsActual") : "";
}

function renderFlows() {
  renderYearState();
  const box = document.getElementById("flows");
  if (!box) return;
  const f = state.flowByYear[state.year];
  if (!f) { box.innerHTML = ""; return; }
  box.innerHTML = TILES.map((tl, i) => `
    <div class="kpi ${tl.cls}">
      <div class="lbl"><i class="dot"></i>${esc(t(tl.name))}</div>
      <div class="num">${fmtBn(tileValue(f, tl.k))}<span class="u">${esc(t("bn").trim())}</span></div>
      <div class="plan">${esc(ctxNote(f, tl.k))}</div>
      <button class="ask" type="button" aria-expanded="false" aria-haspopup="dialog"
        onclick="togglePop(${i}, this)">${esc(t(tl.ask))}</button>
    </div>`).join("");
}

/* ---------- the popover: one popup, opened by anything ---------- */
let popKey = null;
function answerText(i) {
  const tl = TILES[i], f = state.flowByYear[state.year];
  const inAll = flowIn(f) || 1;
  let out = fill(t(tl.ans), {
    y: state.year,
    v: fmtCompact(tileValue(f, tl.k)),
    p: fmtPct(100 * tileValue(f, tl.k) / inAll),
    a: agorot(f),
  });
  const p = tilePlan(f, tl.k);
  if (!isPlanYear(f) && p) {
    out += " " + fill(t("vsPlan"), { p: fmtCompact(p), v: fmtCompact(tileValue(f, tl.k)) });
  }
  // "…out of a total debt of X" — only when we actually have the stock
  if (tl.k === "prin") {
    const stock = state.debt && state.debt[state.year];
    if (stock > 0) {
      out += " " + fill(t(isPlanYear(f) ? "ansPrinDebtEst" : "ansPrinDebt"), {
        p: fmtPct(100 * fv(f, "prin") / stock),
        v: fmtCompact(stock),
      });
    }
  }
  return out;
}
/* the debt figure comes from somewhere else than the budget — say so, there */
const answerSource = i =>
  (TILES[i].k === "prin" && state.debt && state.debt[state.year] > 0) ? t("debtSrc") : "";
function closePop() {
  popKey = null;
  const p = document.getElementById("pop");
  p.classList.remove("open");
  document.querySelectorAll("[aria-haspopup='dialog']").forEach(b => b.setAttribute("aria-expanded", "false"));
}

/* body may contain markup — callers escape their own values */
function showPop(key, btn, title, bodyHtml, src, red) {
  if (popKey === key) { closePop(); btn.focus(); return; }
  closePop();
  popKey = key;
  const p = document.getElementById("pop");
  p.className = "pop open" + (red ? " red" : "");
  p.innerHTML = `<button class="popx" type="button" aria-label="${esc(t("close"))}"
      onclick="closePop()">✕</button>
    <div class="popq">${esc(title)}</div>
    <div class="popa">${bodyHtml}</div>
    ${src ? `<div class="popsrc">${esc(src)}</div>` : ""}`;
  btn.setAttribute("aria-expanded", "true");
  positionPop(btn);
  p.focus();
}

function togglePop(i, btn) {
  showPop("tile:" + i, btn, t(TILES[i].ask), esc(answerText(i)), answerSource(i), TILES[i].red);
}

/* a short explanation, opened from a column header or a chip.
   {y} is the selected year and {p} the one before it — the text that explains
   a subtraction has to name the two years it subtracts, from live state. */
function infoPop(btn, key) {
  const v = { y: state.year, p: (+state.year || 0) - 1 };
  showPop("info:" + key, btn, fill(t(key + "InfoT"), v), esc(fill(t(key + "InfoB"), v)),
    t(key + "InfoSrc") === key + "InfoSrc" ? "" : t(key + "InfoSrc"));
}
const infoBtn = (key) => `<button class="info-i" type="button" aria-haspopup="dialog"
  aria-expanded="false" aria-label="${esc(t("info"))}" onclick="infoPop(this,'${key}')">?</button>`;

/* one contract, in full — keeps the table down to columns that fit */
function contractPop(btn, code, i, focus) {
  const n = state.nodeByCode[code];
  const r = n && n.contracts && n.contracts.rows[i];
  if (!r) return;
  const line = (label, value, ltr) => value
    ? `<div class="poprow"><span>${esc(label)}</span><b${ltr ? ' dir="ltr"' : ''}>${esc(value)}</b></div>` : "";
  const rep = lastReport(r);
  /* The source names the regulation for BOTH routes — "תקנה 1ב - מכרז פומבי
     רגיל" as much as "תקנה 3(1) - התקשרות ששווייה אינה עולה על 50,000 ש״ח".
     Print it verbatim; it is the most precise thing we have about the deal. */
  const body = `<div class="poppurpose">${esc(r.purpose || "—")}</div>`
    + line(t("colOffice"), r.ministry)
    + line(t("colMethod"), r.method)
    + line(t("cExemption"), r.exemption)
    /* which sources fed this record — a reader is entitled to know (rule R3;
       per-field provenance stays in Mercy's local audit db, the public copy
       carries the source list) */
    + line(t("cSources"), sourcesText(r))
    /* Years, volume and both paid figures are columns in the table — and on a
       phone they are still there, as labelled lines in the card. Repeating
       them here would just be the same numbers twice. This view carries only
       what the table has no room for. */
    + (rep && rep.url ? `<div class="poprow"><a href="${esc(rep.url)}" target="_blank"
        rel="noopener">${esc(fill(t("cReportLink"), { y: rep.year }))} →</a></div>` : "");
  const title = focus === "tender" ? t("tenderInfoT") : supplierOf(r);
  showPop("c:" + code + ":" + i, btn, title,
    focus === "tender" ? `<div class="popbody">${esc(t("tenderInfoB"))}</div>`
      + line(t("cExemption"), r.exemption) : body,
    focus === "tender" ? t("tenderInfoSrc") : "");
}
function positionPop(btn) {
  const p = document.getElementById("pop");
  if (!p.classList.contains("open")) return;
  const b = btn.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight;
  let x = b.left + b.width / 2 - w / 2;
  x = Math.min(Math.max(8, x), innerWidth - w - 8);
  let y = b.bottom + 8;
  if (y + h > innerHeight - 8) y = Math.max(8, b.top - h - 8);
  p.style.left = x + "px";
  p.style.top = y + "px";
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && popKey) closePop(); });
document.addEventListener("click", e => {
  if (!popKey) return;
  if (e.target.closest("#pop") || e.target.closest("[aria-haspopup='dialog']")) return;
  closePop();
});
addEventListener("scroll", () => { if (popKey) closePop(); }, { passive: true });
addEventListener("resize", () => { if (popKey) closePop(); });

/* ---------- one way to change the year, from anywhere on the page ----------
   A table row or a chart column can set it. The sticky bar then pulses, so the
   change is never silent — the reader's eye is already on the bar, not on the
   numbers that moved further up the page. */
function selectYear(y) {
  y = +y;
  if (!y || y === state.year) return;
  const sel = document.getElementById("yearsel");
  if (!sel || !state.years.includes(y)) return;
  sel.value = String(y);
  const bar = document.getElementById("yearbar");
  if (bar) {
    bar.classList.remove("changed");
    void bar.offsetWidth;              // restart the animation
    bar.classList.add("changed");
  }
  loadAll();
}

/* ---------- chart: where the money came from ---------- */
function renderChartIn() {
  const svg = document.getElementById("chartIn");
  if (!svg || !state.flows) return;
  const D = state.flows;
  const W = 900, H = 340, mT = 28, mB = 44, mL = 8, mR = 82;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const max = Math.max(...D.map(flowIn), 1);
  const step = plotW / D.length, bw = Math.min(22, step - 4);
  const yOf = q => mT + plotH - (q / max) * plotH;
  const xOf = i => mL + i * step + (step - bw) / 2;
  const HUE = { tax: "var(--series-1)", other: "var(--ink-3)", debt: "var(--danger)" };

  let s = "<defs>" + Object.entries(HUE).map(([k, c]) =>
    `<pattern id="pf-${k}" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
       <rect width="6" height="6" fill="var(--surface-1)"/>
       <line x1="0" y1="0" x2="0" y2="6" stroke="${c}" stroke-width="3.4"/></pattern>`).join("") + "</defs>";

  const gridStep = max / 1e9 > 600 ? 200 : 100;
  for (let gv = gridStep; gv * 1e9 <= max; gv += gridStep) {
    const y = yOf(gv * 1e9);
    s += `<line class="gridline" x1="${mL}" x2="${W - mR}" y1="${y}" y2="${y}"/>`;
    s += `<text class="axis val" x="${W - mR + 8}" y="${y + 4}">${gv}</text>`;
  }
  s += `<text class="axis val" x="${W - mR + 8}" y="${yOf(0) + 4}">0</text>`;

  D.forEach((f, i) => {
    const x = xOf(i), plan = isPlanYear(f);
    const segs = [["tax", fv(f, "tax") + fv(f, "fees")], ["other", fv(f, "other")], ["debt", fv(f, "debt")]];
    let acc = 0, g = "";
    segs.forEach(([k, q], si) => {
      if (q <= 0) return;
      const y0 = yOf(acc + q), y1 = yOf(acc);
      const hgt = Math.max(1, y1 - y0 - 2);          // 2px surface gap between segments
      const top = si === 2 ? ' rx="3"' : "";
      g += plan
        ? `<rect x="${x}" y="${y0}" width="${bw}" height="${hgt}" fill="url(#pf-${k})"
             stroke="${HUE[k]}" stroke-width="1.2"${top}/>`
        : `<rect x="${x}" y="${y0}" width="${bw}" height="${hgt}" fill="${HUE[k]}"${top}/>`;
      acc += q;
    });
    const tot = flowIn(f);
    const tt = `<div class="t">${f.y} · ${esc(t(plan ? "tipPlan" : "tipExec"))}</div>
      <div class="r"><span>${esc(t("legTax"))}</span><b>${fmtBn(fv(f, "tax") + fv(f, "fees"))}</b></div>
      <div class="r"><span>${esc(t("legOther"))}</span><b>${fmtBn(fv(f, "other"))}</b></div>
      <div class="r"><span>${esc(t("legDebt"))}</span><b>${fmtBn(fv(f, "debt"))}</b></div>
      <div class="r tt"><span>${esc(t("tipTotal"))}</span><b>${fmtBn(tot)}</b></div>
      <div class="r"><span>${esc(t("tipOfWhich"))}</span><b>${fmtPct(100 * fv(f, "debt") / (tot || 1))}</b></div>`;
    const cur = f.y === state.year;
    const marker = cur
      ? `<rect class="marker" x="${x - 1}" y="${yOf(0) + 3}" width="${bw + 2}" height="3" rx="1.5"/>`
      : "";
    s += `<g class="col${cur ? " current" : ""}">${g}${marker}
      <rect class="hit" x="${mL + i * step}" y="${mT}" width="${step}" height="${plotH}"
      onmousemove='showTip(event,${JSON.stringify(tt)})' onmouseleave="hideTip()"
      onclick="selectYear(${f.y})"><title>${esc(fill(t("showYear"), { y: f.y }))}</title></rect></g>`;
    if ((f.y % 5 === 0 && !plan && f.y !== lastActualYear()) || i === 0)
      s += `<text class="axis" x="${x + bw / 2}" y="${H - mB + 18}" text-anchor="middle">${f.y}</text>`;
    if (plan) {
      s += `<text class="axis" x="${x + bw / 2}" y="${H - mB + 18}" text-anchor="middle">${f.y}</text>`;
      s += `<text class="axis tiny" x="${x + bw / 2}" y="${H - mB + 32}" text-anchor="middle">${esc(t("planTag"))}</text>`;
    }
  });
  s += `<line class="gridline base" x1="${mL}" x2="${W - mR}" y1="${yOf(0)}" y2="${yOf(0)}"/>`;
  s += `<text class="axis tiny" x="${W - mR + 8}" y="${mT - 12}">${esc(t("bn").trim())}</text>`;
  svg.innerHTML = s;

  document.getElementById("legIn").innerHTML =
    [["legTax", "var(--series-1)"], ["legOther", "var(--ink-3)"], ["legDebt", "var(--danger)"]]
      .map(([k, c]) => `<span><i style="background:${c}"></i>${esc(t(k))}</span>`).join("") +
    `<span><i class="plan"></i>${esc(t("legPlan"))}</span>`;
}

/* ---------- chart: what the debt costs (actuals only) ---------- */
function renderChartCost() {
  const svg = document.getElementById("chartCost");
  if (!svg || !state.flows) return;
  const A = state.flows.filter(f => !isPlanYear(f) && fv(f, "tax") > 0);
  if (A.length < 2) { svg.innerHTML = ""; return; }
  const W = 900, H = 250, mT = 26, mB = 32, mL = 34, mR = 76;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const pts = A.map(f => ({ y: f.y, v: 100 * fv(f, "int") / fv(f, "tax") }));
  const max = Math.ceil(Math.max(...pts.map(p => p.v)) / 5) * 5 + 4;
  const xOf = i => mL + (i / (pts.length - 1)) * plotW;
  const yOf = q => mT + plotH - (q / max) * plotH;
  let s = "";
  for (let gv = 0; gv <= max - 4; gv += 5) {
    const y = yOf(gv);
    s += `<line class="gridline" x1="${mL}" x2="${W - mR}" y1="${y}" y2="${y}"/>`;
    s += `<text class="axis val" x="${W - mR + 8}" y="${y + 4}">${gv}%</text>`;
  }
  s += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join("")}"
    fill="none" stroke="var(--danger)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => {
    const first = i === 0, last = i === pts.length - 1;
    if (first || last) {
      s += `<circle cx="${xOf(i)}" cy="${yOf(p.v)}" r="4.5" fill="var(--danger)"
        stroke="var(--surface-1)" stroke-width="2"/>`;
      s += `<text class="endlabel" x="${xOf(i)}" y="${yOf(p.v) - 13}"
        text-anchor="${first ? "start" : "end"}">${fmtPct(p.v)}</text>`;
    }
    const tt = `<div class="t">${p.y}</div>
      <div class="r"><span>${esc(t("tipInt"))}</span><b>${fmtBn(fv(A[i], "int"))}</b></div>
      <div class="r"><span>${esc(t("tipTax"))}</span><b>${fmtBn(fv(A[i], "tax"))}</b></div>
      <div class="r tt"><span>${esc(t("tipShare"))}</span><b>${fmtPct(p.v)}</b></div>`;
    s += `<rect class="hit" x="${xOf(i) - plotW / pts.length / 2}" y="${mT}"
      width="${plotW / pts.length}" height="${plotH}"
      onmousemove='showTip(event,${JSON.stringify(tt)})' onmouseleave="hideTip()"></rect>`;
    if (p.y % 5 === 0)
      s += `<text class="axis" x="${xOf(i)}" y="${H - mB + 18}" text-anchor="middle">${p.y}</text>`;
  });
  svg.innerHTML = s;

  const f0 = A[0], f1 = A[A.length - 1];
  document.getElementById("costreads").textContent = fill(t("costReads"), {
    y0: f0.y, y1: f1.y,
    p0: fmtPct(100 * fv(f0, "int") / fv(f0, "tax")),
    p1: fmtPct(100 * fv(f1, "int") / fv(f1, "tax")),
    v0: fmtCompact(fv(f0, "int")), v1: fmtCompact(fv(f1, "int")),
  });
}

/* ---------- the paragraph — every number comes from the data ---------- */
function renderDebtPara() {
  const el = document.getElementById("debtpara");
  if (!el || !state.flows) return;
  const f = state.flowByYear[state.year];
  if (!f) { el.textContent = ""; return; }
  el.textContent = fill(t(isPlanYear(f) ? "debtParaPlan" : "debtPara"), {
    y: state.year,
    prin: fmtCompact(fv(f, "prin")),
    int: fmtCompact(fv(f, "int")),
    ag: nfmt({ maximumFractionDigits: 1 }).format(100 * fv(f, "int") / (fv(f, "tax") || 1)),
  });
}

/* ---------- the flows table ---------- */
function renderFlowTable() {
  const body = document.querySelector("#flowtbl tbody");
  if (!body || !state.flows) return;
  document.querySelector("#flowtbl thead").innerHTML = `<tr>
    <th>${esc(t("colYear"))}</th><th class="num">${esc(t("legTax"))}</th>
    <th class="num">${esc(t("legOther"))}</th><th class="num">${esc(t("legDebt"))}</th>
    <th class="num">${esc(t("tipTotal"))}</th><th class="num">${esc(t("colDebtShare"))}</th>
    <th class="num">${esc(t("fInt"))}</th><th class="num">${esc(t("fPrin"))}</th></tr>`;
  body.innerHTML = state.flows.slice().reverse().map(f => {
    const tot = flowIn(f);
    const cur = f.y === state.year;
    return `<tr class="${cur ? "current" : ""}">
      <td class="yr"><button class="yearbtn" type="button" aria-current="${cur}"
        title="${esc(cur ? t("thisYear") : fill(t("showYear"), { y: f.y }))}"
        onclick="selectYear(${f.y})">${f.y}${isPlanYear(f) ? " ★" : ""}</button></td>
      <td class="num">${fmtBn(fv(f, "tax") + fv(f, "fees"))}</td>
      <td class="num">${fmtBn(fv(f, "other"))}</td>
      <td class="num">${fmtBn(fv(f, "debt"))}</td>
      <td class="num">${fmtBn(tot)}</td>
      <td class="num">${fmtPct(100 * fv(f, "debt") / (tot || 1))}</td>
      <td class="num">${fmtBn(fv(f, "int"))}</td>
      <td class="num">${fmtBn(fv(f, "prin"))}</td></tr>`;
  }).join("");
}

function renderFlowsAll() {
  renderFlows();
  renderChartIn();
  renderChartCost();
  renderDebtPara();
  renderFlowTable();
}

/* =====================================================================
   THE TREE — where the money goes
   ===================================================================== */

function renderModeSwitch() {
  const box = document.getElementById("modeswitch");
  if (!box) return;
  box.innerHTML = [["admin", "viewAdmin"], ["func", "viewFunc"]].map(([m, k]) =>
    `<button type="button" class="segbtn${state.mode === m ? " on" : ""}"
       aria-pressed="${state.mode === m}" onclick="setMode('${m}')">${esc(t(k))}</button>`).join("");
  document.getElementById("charthint").textContent = t(state.mode === "func" ? "viewFuncHint" : "viewAdminHint");
  renderCount();
}

async function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  renderModeSwitch();
  const chart = document.getElementById("chart");
  if (!state.rows[mode]) {
    chart.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
    try { await loadRoots(mode); }
    catch (e) {
      chart.innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
      debug("roots " + mode + ": " + e.message);
      return;
    }
  }
  renderCount();
  renderTree();
}

function renderCount() {
  const el = document.getElementById("treecount");
  if (!el) return;
  const rows = state.rows[state.mode] || [];
  el.textContent = rows.length
    ? fill(t(state.mode === "func" ? "areasCount" : "sectionsCount"), { n: rows.length })
    : "";
}

function makeNodes(rows, depth) {
  return rows.slice().sort((a, b) => val(b) - val(a)).map(r => {
    const n = { r, code: String(r.code), depth, children: null, open: false, loading: false };
    state.nodeByCode[n.code] = n;
    return n;
  });
}

/* "ביטחון וסדר ציבורי / ביטחון" inside the ביטחון branch is just noise —
   show the last part, keep the full title in the tooltip. */
function shortTitle(node) {
  const full = String(node.r.title || "");
  if (state.mode === "func" && node.depth > 0 && full.includes(" / ")) return full.split(" / ").pop().trim();
  return full;
}

function renderTree() {
  const chart = document.getElementById("chart");
  const mode = state.mode;
  const rows = state.rows[mode] || [];
  if (!state.roots[mode]) state.roots[mode] = makeNodes(rows, 0);
  const roots = state.roots[mode];
  if (!roots.length) { chart.innerHTML = `<div class="loading">${esc(t("empty"))}</div>`; return; }

  const shown = state.showAll[mode] ? roots : roots.slice(0, 15);
  let html = treeHtml(shown, null);
  if (roots.length > 15) {
    const label = state.showAll[mode] ? t("showLess") : fill(t("showAllBtn"), { n: roots.length });
    html += `<div class="showall"><button class="chipbtn" onclick="toggleShowAll()">${esc(label)}</button></div>`;
  }
  chart.innerHTML = html;
  chart.querySelectorAll(".barrow").forEach(el => {
    const n = state.nodeByCode[el.dataset.code];
    if (n) el._row = n.r;
  });
  document.getElementById("chartnote").textContent = t("note");
}

function toggleShowAll() {
  state.showAll[state.mode] = !state.showAll[state.mode];
  renderTree();
}

function treeHtml(nodes, parentV) {
  const max = Math.max(...nodes.map(n => val(n.r)), 1);
  return nodes.map(n => {
    const v = val(n.r);
    const w = Math.max(0.4, v / max * 100);
    const leaf = isLeaf(state.mode, n.code);
    // a leaf is the end of the budget tree, but not the end of the trail:
    // it is where the contracts paid out of that line attach
    const payers = canHoldContracts(state.mode, n.code);
    const dead = leaf && !payers;
    const caret = dead ? `<span class="caret"></span>`
                       : `<span class="caret">${n.open ? "▾" : "▸"}</span>`;
    const pct = parentV ? ` <span class="pct">· ${Math.round(v / parentV * 100)}%</span>` : "";
    let kids = "";
    if (n.open) {
      let inner = "";
      if (n.loading) inner = `<div class="note">${esc(t("loading"))}</div>`;
      else if (n.children && n.children.length) inner = treeHtml(n.children, v);
      else if (!payers) inner = `<div class="note">${esc(t("noChildren"))}</div>`;
      inner += paidBlock(n);
      kids = `<div class="kids">${inner}</div>`;
    }
    return `<button class="barrow" data-code="${esc(n.code)}"
      onmousemove="barTip(event,this)" onmouseleave="hideTip()" onfocus="barTipFocus(this)" onblur="hideTip()"
      ${dead ? "style='cursor:default'" : `onclick="toggleNode('${esc(n.code)}')"`}>
      <span class="name" title="${esc(n.r.title)}">${caret}${esc(shortTitle(n))}</span>
      <span class="bartrack"><span class="bar" style="width:${w}%"></span></span>
      <span class="val">${fmtCompact(v)}${pct}</span>
    </button>` + kids;
  }).join("");
}

/* Contracts hang off EVERY level, not just the bottom. A תקנה usually has one
   contract or none — most budget lines are salaries and transfers — while the
   ministry above it has tens of thousands. Offering this only at the leaf meant
   almost every click landed on "nothing recorded", which is how it shipped the
   first time. The query prefix-matches on whole code groups, so a section
   answers for everything beneath it. */
function paidBlock(n) {
  if (!canHoldContracts(state.mode, n.code)) return "";
  const label = fill(t("whoPaid"), { name: shortTitle(n) });
  const btn = (cls) => `<button class="paidbtn${cls}" type="button"
    aria-expanded="${!!n.paidOpen}" onclick="togglePaid('${esc(n.code)}')">${esc(label)}</button>`;
  if (!n.paidOpen) return `<div class="paidline">${btn("")}</div>`;
  if (n.paidLoading) return `<div class="paidline">${btn(" on")}
    <div class="note">${esc(t("loading"))}</div></div>`;
  return `<div class="paidline">${btn(" on")}${contractsHtml(n)}</div>`;
}

async function togglePaid(code) {
  const n = state.nodeByCode[code];
  if (!n) return;
  if (n.paidOpen) { n.paidOpen = false; renderTree(); return; }
  n.paidOpen = true;
  if (n.contracts === undefined) {
    n.paidLoading = true;
    renderTree();
    try { n.contracts = await loadContracts(code, state.year); }
    catch (e) { n.paidOpen = false; debug("contracts " + code + ": " + e.message); }
    n.paidLoading = false;
  }
  renderTree();
}

/* the contract list under one budget line */
const ENTITY = { company: "entityCompany", association: "entityAssoc", municipality: "entityMuni" };
const NO_TENDER = /פטור|ישיר/;          // the data's own Hebrew wording

/* the years the contract was REPORTED in, not its legal period — no source
   has a reliable start date. Junk years exist at both edges; never print them. */
function contractYears(r) {
  const ok = y => y && y > 1990 && y < 2100;
  const a = ok(+r.first_year) ? +r.first_year : null;
  const b = ok(+r.last_year) ? +r.last_year : null;
  if (a && b) return a === b ? String(a) : a + "–" + b;
  return String(a || b || "");
}
const supplierOf = (r) => cleanName(r.supplier);

/* the db's source tags, as words (verified against the live db 2026-09-08:
   the build writes "bk", "file", "tn", "ex") */
const SRC_NAMES = { file: "srcFile", bk: "srcBk",
                    tn: "srcTenders", ex: "srcExemptions" };
function sourcesText(r) {
  if (!Array.isArray(r.sources)) return "";
  const seen = new Set(), names = [];
  for (const s of r.sources) {
    const k = SRC_NAMES[s];
    if (k && !seen.has(k)) { seen.add(k); names.push(t(k)); }
  }
  return names.join(" · ");
}

function contractsHtml(n) {
  const c = n.contracts;
  const year = (c && c.year) || state.year;
  if (!c || !c.rows.length)
    return `<div class="note">${esc(fill(t(emptyContractsKey(n.code, c)), { y: year }))}</div>`;
  const nf = v => v == null ? "—" : fmtCompact(v);
  let unreported = 0;
  const rows = c.rows.map((r, i) => {
    const kind = ENTITY[String(r.entity_kind)];
    const method = String(r.method || "");
    const paid = paidInYear(r, year);
    if (paid == null) unreported++;
    return `<tr>
      <td>${esc(supplierOf(r))}${kind ? ` <span class="ekind">${esc(t(kind))}</span>` : ""}</td>
      <td>${NO_TENDER.test(method)
        ? `<button class="method open" type="button" aria-haspopup="dialog" aria-expanded="false"
             onclick="contractPop(this,'${esc(n.code)}',${i},'tender')">${esc(t("noTender"))}</button>`
        : ""}</td>
      <td class="num" data-l="${esc(t("colReportedYears"))}"><span dir="ltr">${esc(contractYears(r))}</span></td>
      <td class="num" data-l="${esc(t("colVolume"))}">${nf(r.volume != null ? +r.volume : null)}</td>
      <td class="num" data-l="${esc(t("colPaidTotal"))}">${nf(totalPaid(r))}</td>
      <td class="num" data-l="${esc(fill(t("colPaidInYear"), { y: year }))}">${paid == null ? "—" : nf(paid)}</td>
      <td><button class="purposebtn" type="button" aria-haspopup="dialog" aria-expanded="false"
        onclick="contractPop(this,'${esc(n.code)}',${i})">${esc(t("purposeBtn"))}</button></td>
    </tr>`;
  }).join("");
  /* the blanks are the government's reporting, not a bug in the page — count
     them out loud rather than leaving the reader to wonder what a dash means */
  const gap = unreported
    ? " " + fill(t(unreported === c.rows.length ? "paidNoneReported"
                   : unreported === 1 ? "paidOneUnreported" : "paidSomeUnreported"),
                 { n: unreported, of: c.rows.length, y: year })
    : "";
  return `<div class="whopaid">
    <div class="tw"><table>
      <thead><tr><th>${esc(t("colSupplier"))}</th>
        <th></th><th class="num">${esc(t("colReportedYears"))} ${infoBtn("years")}</th>
        <th class="num">${esc(t("colVolume"))} ${infoBtn("vol")}</th>
        <th class="num">${esc(t("colPaidTotal"))} ${infoBtn("total")}</th>
        <th class="num">${esc(fill(t("colPaidInYear"), { y: year }))} ${infoBtn("paid")}</th>
        <th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="wp-note">${esc(fill(t("contractsInYear"), { y: year }))}${
      c.more ? " " + esc(fill(t("contractsCap"), { n: c.rows.length })) : ""}${esc(gap)}</div>
  </div>`;
}

async function toggleNode(code) {
  const n = state.nodeByCode[code];
  if (!n) return;
  if (n.open) { n.open = false; renderTree(); return; }
  n.open = true;
  const leaf = isLeaf(state.mode, code);
  if (!leaf && n.children === null) {
    n.loading = true;
    renderTree();
    try {
      n.children = makeNodes(await loadChildren(state.mode, code), n.depth + 1);
    } catch (e) {
      n.open = false;
      n.children = null;
      debug("expand " + code + ": " + e.message);
    }
    n.loading = false;
  }
  renderTree();
  // a תקנה has nothing below it in the budget, so go straight to the money
  if (leaf && canHoldContracts(state.mode, code) && !n.paidOpen) togglePaid(code);
}

/* ---------- contracts search ---------- */
async function doSearch() {
  const q = document.getElementById("q").value.trim();
  if (!q) return;
  const out = document.getElementById("searchout");
  out.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
  try {
    state.lastSearch = await searchContracts(q);
    renderSearch(state.lastSearch);
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
    debug("search: " + e.message);
  }
}

function renderSearch(rows) {
  const out = document.getElementById("searchout");
  if (!rows.length) { out.innerHTML = `<div class="loading">${esc(t("searchEmpty"))}</div>`; return; }
  const nf = v => v == null ? "—" : nfmt().format(Math.round(v));
  out.innerHTML = `<div style="overflow-x:auto"><table>
    <thead><tr>
      <th>${t("colSupplier")}</th><th>${t("colPurpose")}</th><th>${t("colOffice")}</th>
      <th>${t("colYears")}</th><th>${t("colVolume")}</th><th>${t("colPaid")}</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${esc(cleanName(r.supplier_name))}</td>
      <td>${esc(r.purpose)}</td>
      <td>${esc(r.publisher_name)}</td>
      <td class="num">${esc(r.min_year ?? "")}${r.max_year && r.max_year !== r.min_year ? "–" + esc(r.max_year) : ""}</td>
      <td class="num">${nf(r.volume)}</td>
      <td class="num">${nf(r.executed)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function cleanName(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string") {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p.join(", "); } catch (e) {}
    return v.replace(/^\["|"\]$/g, "");
  }
  return v ?? "—";
}

/* ---------- language ---------- */
window.onLangChange = () => {
  closePop();
  syncStickyOffset();
  document.getElementById("chartnote").textContent = t("note");
  renderModeSwitch();
  if (state.flows) renderFlowsAll();
  if (state.rows[state.mode]) renderTree();
  if (state.lastSearch) renderSearch(state.lastSearch);
};

/* ---------- loading a year ---------- */
function fillYearSelect() {
  const sel = document.getElementById("yearsel");
  sel.innerHTML = state.years.map(y => `<option value="${y}">${y}</option>`).join("");
  sel.value = state.year;
}

async function loadAll() {
  state.year = +document.getElementById("yearsel").value || state.year;
  closePop();
  resetTrees();
  if (state.flows) renderFlowsAll();
  const chart = document.getElementById("chart");
  chart.classList.add("stale");
  try {
    await loadRoots(state.mode);
    await loadTotal();
    autoScale(state.total.net_revised || state.total.net_allocated);
    renderCount();
    renderTree();
  } catch (e) {
    chart.innerHTML = `<div class="error">${esc(bkFriendly(e))}</div>`;
    debug("loadAll: " + e.message);
  }
  chart.classList.remove("stale");
}

/* the sticky year bar has to clear the sticky site header, whose height
   depends on the language and the viewport — so measure it, don't hard-code */
function syncStickyOffset() {
  const bar = document.querySelector("header.topbar");
  if (!bar) return;
  document.documentElement.style.setProperty("--topbar-h", bar.offsetHeight + "px");
}
addEventListener("resize", syncStickyOffset);

/* ---------- init ---------- */
async function init() {
  applyLang();
  syncStickyOffset();
  renderModeSwitch();
  document.getElementById("chartnote").textContent = t("note");
  const st = document.getElementById("globalstate");
  st.textContent = t("loading");

  // the four flows and the year list load together
  const flows = loadFlows().catch(e => { debug("flows: " + e.message); return null; });
  // the debt stock is a nice-to-have from a different source: if it fails,
  // one sentence in one popover is missing and nothing else changes
  const debt = loadDebtStock().catch(e => { debug("debt: " + e.message); return null; });
  let snap = null;
  try { snap = await loadSnapshot(); } catch (e) { debug("snapshot: " + e.message); }
  if (!snap) { try { await loadYears(); } catch (e) { debug("years: " + e.message); } }

  await flows;
  await debt;
  if (!state.flows) document.getElementById("flowsec").hidden = true;

  // default to the last year we have REAL execution for, not the newest plan
  const best = lastActualYear();
  state.year = (best && state.years.includes(best)) ? best
             : (snap ? snap.year : state.years[0]);

  if (!state.years.length) {
    st.textContent = "";
    document.getElementById("chart").innerHTML = `<div class="error">${esc(t("err"))}</div>`;
    return;
  }
  fillYearSelect();
  st.textContent = "";

  if (state.flows) renderFlowsAll();
  syncStickyOffset();

  if (snap && state.year === snap.year) {          // the snapshot already has this year
    state.rows.admin = snap.sections;
    state.total = snap.total;
    autoScale(state.total.net_revised || state.total.net_allocated);
    renderCount();
    renderTree();
  } else {
    await loadAll();
  }
}

init();
