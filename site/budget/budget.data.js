"use strict";
/* =====================================================================
   Our Money — the budget page: talking to the data.
   Sources:
     the budget TREE and the flows — BudgetKey open API (הסדנא לידע ציבורי)
           https://next.obudget.org/api/query?query=<SQL>   (CORS-open, no relay)
     the CONTRACTS — our own database, served by the relay from Cloudflare D1
           GET <PROXY>/contracts?code=<budget line>&year=<y>&n=25
       (one deduplicated record per contract, ministry
        files + BudgetKey + the mr.gov.il registers merged field by field
        by the pipeline — see pipeline\CLAUDE.md. BudgetKey's own contract
        rows drop the paid column on newer reports; ours do not.)

   THE ONE THING TO KNOW ABOUT raw_budget (verified live):
   the `code` column holds TWO SEPARATE TREES plus the revenue root.
     '00'          המדינה — the root of the administrative tree
     '0000'        הכנסות המדינה — REVENUE. A child of '00', but not a ministry.
     '00xx'        a real budget section (ministry / topic). 61 of them in 2025.
                   Each level down adds 2 characters: 6 → 8 → 10 (תקנה).
     'C1'…'C8'     the functional tree — the same money grouped by purpose.
                   C1 ביטחון · C2 שירותים חברתיים · C3 תשתיות · C4 משרדי מטה ·
                   C5 עניני משק · C6 החזרי חוב · C7 הוצאות אחרות · C8 הכנסות.
                   Exactly two levels deep: 'C1' → 'C1xx'. Nothing below.
   Asking for `length(code) = 4` returns BOTH trees at once plus revenue —
   which is what the page used to do, so every ministry appeared twice and
   revenue topped the chart. Never select by code length alone.

   THE FOUR FLOWS (the block at the top of the page):
     tax   = C881 + C882   מסים ישירים + עקיפים
     fees  = C883          אגרות
     other = C884          הכנסות אחרות
     debt  = C886          הכנסות למימון גירעון  — i.e. NEW BORROWING
     int   = section 0045  תשלום ריבית ועמלות
     prin  = section 0084  תשלום חובות — principal only, no interest
   tax+fees+other+debt sums exactly to '0000' (הכנסות המדינה).
   Each flow has TWO values: what was budgeted (net_revised) and what actually
   happened (net_executed). A year with no execution yet is a PLAN, and the
   page has to say so — never present a budget as if it were a fact.
   ===================================================================== */

const API = "https://next.obudget.org/api/query?query=";
const sqlq = s => String(s).replace(/'/g, "''");

/* values arrive in whole shekels; SCALE is a guard for the rare small subtree */
let SCALE = 1;
function autoScale(total) {
  if (!total) return;
  SCALE = (total > 1e10) ? 1 : 1000;
}

async function bk(sql, numRows) {
  const j = await fetchJson(API + encodeURIComponent(sql) + (numRows ? "&num_rows=" + numRows : ""));
  // BudgetKey can answer HTTP 200 with {"success":false,"error":"…"} when its
  // database is overloaded — surface that as an error, never as "zero data".
  if (j && (j.success === false || j.error))
    throw new Error("UPSTREAM::" + String(j.error || "unknown").slice(0, 160));
  return j.rows || j.data || j.results || [];
}

const bkFriendly = e => String(e.message).startsWith("UPSTREAM::") ? t("errBusy") : t("err");

/* ---------- which rows belong to which tree ---------- */
const VALUE_COLS = "code, title, net_allocated, net_revised, net_executed";
const ORDER = "ORDER BY COALESCE(net_revised, net_allocated) DESC NULLS LAST";

const isFuncCode  = c => /^C/.test(String(c));
const isAdminRoot = c => { const s = String(c); return s.length === 4 && s.slice(0, 2) === "00" && s !== "0000"; };

const ROOT_SQL = {
  admin: y => `SELECT ${VALUE_COLS} FROM raw_budget
    WHERE year = ${y} AND code LIKE '00%' AND length(code) = 4 AND code <> '0000' ${ORDER}`,
  // C8 is revenue — it is not spending, so it stays out of a spending view
  func: y => `SELECT ${VALUE_COLS} FROM raw_budget
    WHERE year = ${y} AND code LIKE 'C%' AND length(code) = 2 AND code <> 'C8' ${ORDER}`,
};

const MAX_LEN = { admin: 10, func: 4 };
const STEP    = { admin: 2,  func: 2 };
const isLeaf  = (mode, code) => String(code).length >= MAX_LEN[mode];

function childSql(mode, code, year) {
  const want = String(code).length + STEP[mode];
  return `SELECT ${VALUE_COLS} FROM raw_budget
    WHERE year = ${year} AND code LIKE '${sqlq(code)}%' AND length(code) = ${want} ${ORDER}`;
}

/* ---------- state ---------- */
const state = {
  year: null,
  years: [],
  mode: "admin",
  rows:    { admin: null, func: null },
  roots:   { admin: null, func: null },
  showAll: { admin: false, func: false },
  nodeByCode: {},
  total: null,
  flows: null,        // [{y, tax:[plan,actual], fees, other, debt, int, prin}]
  flowByYear: {},
  debt: null,         // {year: total government debt in ₪} — OECD, may be absent
};

function resetTrees() {
  state.rows = { admin: null, func: null };
  state.roots = { admin: null, func: null };
  state.showAll = { admin: false, func: false };
  state.nodeByCode = {};
}

/* ---------- the four flows ---------- */
const FLOW_CODES = { C881: "tax", C882: "tax", C883: "fees", C884: "other", C886: "debt",
                     "0045": "int", "0084": "prin" };
const FLOW_SQL =
  `SELECT year, code, net_revised, net_executed FROM raw_budget
   WHERE code IN ('C881','C882','C883','C884','C886','0045','0084') AND year >= 1997
   ORDER BY year`;

const PLAN = 0, ACT = 1;

async function loadFlows() {
  const rows = await bk(FLOW_SQL, 400);
  const byYear = {};
  for (const r of rows) {
    const key = FLOW_CODES[String(r.code)];
    if (!key) continue;
    const y = +r.year;
    const f = byYear[y] || (byYear[y] = { y, tax: [null, null], fees: [null, null],
      other: [null, null], debt: [null, null], int: [null, null], prin: [null, null] });
    const add = (slot, v) => {
      if (v == null || v === "") return;
      f[key][slot] = (f[key][slot] || 0) + (+v);
    };
    add(PLAN, r.net_revised);
    add(ACT, r.net_executed);
  }
  state.flows = Object.values(byYear).sort((a, b) => a.y - b.y);
  state.flowByYear = byYear;
  return state.flows;
}

/* the value to show: what really happened, or the plan when the year isn't done */
const fv = (f, k) => (f && f[k] ? (f[k][ACT] != null ? f[k][ACT] : f[k][PLAN]) : 0) || 0;
const isPlanYear = f => !f || f.tax[ACT] == null;
const flowIn = f => fv(f, "tax") + fv(f, "fees") + fv(f, "other") + fv(f, "debt");

/* ---------- total government debt (the stock, not the flows) ----------
   BudgetKey has no debt stock, and neither does the Bank of Israel dataflow we
   can reach; data.gov.il returns nothing. The one machine-readable series that
   gives SHEKEL LEVELS year by year is the OECD Economic Outlook, which for
   Israel is a passthrough of the CBS/BoI national-accounts figure (verified:
   2010 = 617.806bn matches the Knesset Research Centre's table exactly).
   It is GENERAL government, GROSS — central + local authorities, i.e. Israel's
   חוב ציבורי. That runs 2–3% above the Finance Ministry's central-government
   figure, so the page must say which one it is showing.
   The last two years are OECD PROJECTIONS, and are labelled as such.

   TRAP, and it cost a wrong number once already: SDMX returns the TIME_PERIOD
   values in whatever order it likes — the response we get is DESCENDING. Never
   map observations by position; read the codelist and index into it.
   The envelope moves too: SDMX-JSON 2.0 has `data.structures[0]`, 1.0 has
   `data.structure` (OECD switched to 1.0 by 2026-09 and the page lost the
   debt figure), older answers a top-level `structure` — read all three. */
const DEBT_URL = "https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,1.3/" +
  "ISR.GGFL.A?startPeriod=1997&format=jsondata&dimensionAtObservation=AllDimensions";

function parseSdmxAnnual(j) {
  const d = j.data || {};
  const st = (d.structures ? d.structures[0] : d.structure || j.structure);
  const dims = (st && st.dimensions && st.dimensions.observation) || [];
  const ti = dims.findIndex(d => d.id === "TIME_PERIOD");
  if (ti < 0) throw new Error("SDMX::no TIME_PERIOD dimension");
  const years = dims[ti].values.map(v => +v.id);
  const ds = ((j.data ? j.data.dataSets : j.dataSets) || [])[0] || {};
  const out = {};
  for (const key of Object.keys(ds.observations || {})) {
    const y = years[+key.split(":")[ti]];
    const raw = ds.observations[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (y && v != null) out[y] = +v;
  }
  if (!Object.keys(out).length) throw new Error("SDMX::no observations");
  return out;
}

async function loadDebtStock() {
  const j = await fetchJson(DEBT_URL);
  state.debt = parseSdmxAnnual(j);
  return state.debt;
}

/* the newest year that actually has execution figures — the honest default */
function lastActualYear() {
  const done = (state.flows || []).filter(f => !isPlanYear(f));
  return done.length ? done[done.length - 1].y : null;
}

/* ---------- loading ---------- */

/* The snapshot in our worker still stores the OLD mixed query (all length-4
   rows). Filtering here means the fix works today, with no redeploy. */
const cleanAdmin = rows => (rows || []).filter(r => isAdminRoot(r.code));

async function loadSnapshot() {
  const snap = await dataset("budget");
  state.years = snap.years || [];
  const secs = cleanAdmin(snap.sections);
  if (!secs.length) throw new Error("snapshot had no administrative sections");
  return { year: snap.year, sections: secs, total: snap.total || sumRows(secs) };
}

async function loadYears() {
  const rows = await bk("SELECT DISTINCT year FROM raw_budget ORDER BY year DESC", 60);
  state.years = rows.map(r => r.year).filter(y => y >= 2000);
}

async function loadRoots(mode) {
  if (state.rows[mode]) return state.rows[mode];
  state.rows[mode] = await bk(ROOT_SQL[mode](state.year), 200);
  return state.rows[mode];
}

async function loadTotal() {
  try {
    const tot = await bk(`SELECT title, net_allocated, net_revised, net_executed
      FROM raw_budget WHERE year = ${state.year} AND code = '00'`, 2);
    if (tot.length) { state.total = tot[0]; return; }
  } catch (e) { debug("total: " + e.message); }
  state.total = sumRows(state.rows.admin || []);
}

async function loadChildren(mode, code) {
  const rows = await bk(childSql(mode, code, state.year), 400);
  return rows.filter(r => String(r.code) !== String(code));
}


/* ---------- contracts under a budget line ----------
   Since 2026-09-08 the contracts come from OUR OWN DATABASE — the pipeline's
   merge of the ministries' quarterly files, BudgetKey and the mr.gov.il
   registers, one deduplicated record per order — served by the relay from
   Cloudflare D1: GET <PROXY>/contracts?code=<line>&year=<y>&n=25.
   Each row carries the merged fields (supplier, ministry, method, exemption,
   volume, paid, first_year–last_year, sources) plus reports[] — one entry
   per PUBLISHED quarterly report with the cumulative paid to that date, the
   only real per-year money. Per-year figures are still derived HERE, by
   differencing the cumulative reports under the same refusal rules as
   always. What no source carries: a contract start date. The years we print
   are the years the contract was REPORTED in, and the column says so.
   (The worker filters to contracts in force in the chosen year and excludes
   ones with no known years — not knowing when a contract ran is a reason to
   leave it out, never a reason to assume it ran now.) */
const isAdminCode = (code) => {
  const s = String(code || "");
  return s.length >= 4 && s.slice(0, 2) === "00" && /^\d+$/.test(s) && s !== "0000";
};

/* Contracts ARE filtered to the selected year (the worker does it) — a
   contract reported 2022–2023 has no business appearing under 2025, however
   carefully the caption is worded. Ordered by the whole-contract volume —
   the same number the first money column prints, so "the top 25" means the
   top 25 of what the reader sees. */
const CONTRACTS_LIMIT = 25;
async function loadContracts(code, year) {
  if (!isAdminCode(code)) return null;
  const y = +year || 0;
  if (!PROXY) throw new Error("CORS_OR_NET::no-relay");
  const base = PROXY + "/contracts?code=" + encodeURIComponent(String(code));
  const j = await fetchJson(base + (y ? "&year=" + y : "") + "&n=" + CONTRACTS_LIMIT);
  if (!j || j.error || !Array.isArray(j.rows))
    throw new Error("DATASET::" + ((j && j.error) || "bad /contracts response"));
  const out = { rows: j.rows, more: !!j.more, year: y };
  /* An empty YEAR list can mean two different things, and the reader should
     know which (Mercy): "nothing in force this year" versus
     "this line appears in the public reporting not at all". One extra
     request tells them apart — the worker caches it, so it is nearly free. */
  if (!out.rows.length) {
    if (!y) out.noneAtAll = true;
    else {
      const any = await fetchJson(base + "&n=1").catch(() => null);
      out.noneAtAll = !!(any && Array.isArray(any.rows) && !any.rows.length);
    }
  }
  return out;
}

/* Sections whose emptiness we have VERIFIED at the source and can explain:
   the defence budget. Checked live 2026-09-08 — BudgetKey's contract table
   has zero rows under '0015' or '0016', and the report collection found no
   defence files either ("0015 → nothing", pipeline\CLAUDE.md). Defence
   procurement runs under its own exemption regulations and a partly
   classified budget; the page says that instead of a shrug. */
const DEFENCE_SECTIONS = { "0015": 1, "0016": 1 };
const emptyContractsKey = (code, c) =>
  !(c && c.noneAtAll) ? "noContracts"
  : DEFENCE_SECTIONS[String(code).slice(0, 4)] ? "noContractsDefence"
  : "noContractsAtAll";

/* ---------- what was actually paid in one year ----------
   Every reports[] entry is one published report carrying the CUMULATIVE
   amount paid on the contract so far — checked against six contracts, the
   figure only ever climbs within a run of reports. So the money that moved
   during year Y is (cumulative at the end of Y) − (cumulative at the end of
   Y−1). The real data will wreck that if a trap is ignored, seen live:
   a great many reports from 2024 on carry paid = 0 beside a volume that is
   still there. A contract reading 144,719,601 in 2024 Q2 does not read 0 in
   Q3 — that is the field going unreported, not a refund. We refuse to answer
   rather than print a collapse that did not happen.
   (The build already dedupes a report published at two addresses — url is
   not part of a report's identity — but the zero trap survives the merge,
   because the zeros are in the reports as published.) */
const reportOrder = (p) => (+p.year || 0) * 10 + (p.period == null ? 9 : +p.period || 0);

function reportsUpTo(reports, y) {
  if (!Array.isArray(reports)) return [];
  return reports
    .filter(p => p && +p.year && +p.year <= y)
    .sort((a, b) => reportOrder(a) - reportOrder(b));
}

const anyPaid = (reports) => reportsUpTo(reports, 9999).some(p => +p.paid_cumulative > 0);

/* cumulative paid as reported at the end of year y — null when unknowable.
   A ZERO IS NOT A FACT HERE. Checked live: משרד החינוך's contract 4502539235
   with מילגם reads volume 409,961,432.74 and paid 0.0 in BudgetKey's raw
   ingest, with no parse error flagged — while the ministry's own published
   file carries a real paid figure. So a contract whose reports are ALL zero
   tells us nothing at all, and we say nothing. A zero BEFORE the first
   positive figure is different: that one is credible as "signed, nothing paid
   yet", and it is kept. */
function cumulativeTo(reports, y) {
  if (!anyPaid(reports)) return null;
  const rs = reportsUpTo(reports, y);
  if (!rs.length) return null;
  const last = +rs[rs.length - 1].paid_cumulative || 0;
  if (last > 0) return last;
  // a zero that follows a positive figure is a gap in the reporting, not a fact
  return rs.some(p => +p.paid_cumulative > 0) ? null : 0;
}

/* which sources fed this contract (the db's `sources` is a JSON list the
   worker already parsed: "file" = the ministry's own published .xlsx,
   "cs"/"qr"/"cd" = BudgetKey, "tn"/"ex" = the mr.gov.il registers) */
const hasSource = (r, s) => !!(r && Array.isArray(r.sources) && r.sources.indexOf(s) >= 0);

/* the whole-contract total: the merged figure from our database. The build
   holds zeros back, so paid = 0 means EVERY source that answered wrote 0 —
   a fact when the ministry's own file is among them (ministries write 0 when
   they mean 0), and unknowable when only BudgetKey answered, since its
   ingest drops the paid column. Never a zero dressed up as a fact. */
const totalPaid = (r) => (!r || r.paid == null) ? null
  : (+r.paid > 0) ? +r.paid
  : hasSource(r, "file") ? 0
  : null;

const hasReportIn = (reports, y) =>
  Array.isArray(reports) && reports.some(p => p && +p.year === +y);

/* A YEAR WITH NO REPORT IS NOT A YEAR WITH NO SPENDING.
   Reporting runs stop and restart: מ. מ. ירוחם is reported in 2017, then not
   again until 2023. Carrying the 2017 figure forward and subtracting it from
   itself would print a confident 0 for 2018–2022 — five years of "nothing was
   paid" that nobody ever reported. So the difference is only taken when BOTH
   ends rest on a report actually filed for that year; the one exception is a
   contract whose reporting begins in y, where the cumulative IS the year. */
function paidInYear(r, y) {
  y = +y;
  if (!y || !r) return null;
  const p = r.reports;
  if (!hasReportIn(p, y)) return null;
  const now = cumulativeTo(p, y);
  if (now == null) return null;
  if (!reportsUpTo(p, y - 1).length) return now;   // the reporting starts here
  if (!hasReportIn(p, y - 1)) return null;         // a gap: the span is not one year
  const before = cumulativeTo(p, y - 1);
  if (before == null) return null;
  const d = now - before;
  return d >= 0 ? d : null;          // restatements can run backwards; say nothing
}

/* the newest report we have for a contract, so a row can link to the source */
function lastReport(r) {
  const rs = reportsUpTo(r && r.reports, 9999);
  return rs.length ? rs[rs.length - 1] : null;
}

/* a budget line can hold contracts only in the administrative tree */
const canHoldContracts = (mode, code) => mode === "admin" && isAdminCode(code);

/* The free-text supplier search moved to contractors.html (2026-09-08);
   this page queries BudgetKey only for the budget tree and the flows. */

/* ---------- small helpers ---------- */
const val = r => +r.net_revised || +r.net_allocated || 0;
function sumRows(rows) {
  const s = k => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  return { net_allocated: s("net_allocated"), net_revised: s("net_revised"), net_executed: s("net_executed") };
}
/* fill("ב-{y} …", {y: 2025}) — every number in a sentence comes from the data */
function fill(str, vals) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vals[k] !== undefined ? vals[k] : m));
}
