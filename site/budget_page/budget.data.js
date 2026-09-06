"use strict";
/* =====================================================================
   Our Money — the budget page: talking to the data.
   Source: BudgetKey open API (הסדנא לידע ציבורי)
           https://next.obudget.org/api/query?query=<SQL>   (CORS-open, no relay)

   THE ONE THING TO KNOW ABOUT raw_budget (verified live 2026-08-22):
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
  lastSearch: null,
  flows: null,        // [{y, tax:[plan,actual], fees, other, debt, int, prin}]
  flowByYear: {},
  debt: null,         // {year: total government debt in ₪} — OECD, may be absent
  paidData: undefined, // sections with a ministry-report overlay; null = not deployed
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
   map observations by position; read the codelist and index into it. */
const DEBT_URL = "https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,1.3/" +
  "ISR.GGFL.A?startPeriod=1997&format=jsondata&dimensionAtObservation=AllDimensions";

function parseSdmxAnnual(j) {
  const st = (j.data && j.data.structures ? j.data.structures[0] : j.structure);
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
   WE USE contract_spending, NOT contracts_data. Both describe the same
   procurement reports, but only contract_spending carries (all verified live
   2026-08-22):
     • payments[] — one entry per published quarterly report, each with the
       year, the quarter, the cumulative executed as of that report, and a URL
       to the .xlsx the ministry published. This is the ONLY real per-year
       money in the dataset. contracts_data's volume_per_year /
       executed_per_year are the lifetime total divided by the number of years
       — an average dressed as a measurement. Do not go back to them.
     • exemption_reason — the actual regulation a no-tender contract rests on
       ("תקנה 3(1) - התקשרות ששווייה אינה עולה על 50,000 ש״ח").
     • budget_code ALREADY in the budget's own 10-digit form ('0008510313'),
       so a prefix match is the whole join — no dotted translation needed.
   What it does NOT carry: a contract start date (start_date is 100% NULL,
   end_date only 32%). So the years we print are the years the contract was
   REPORTED in, min_year–max_year, and the column says so. */
const isAdminCode = (code) => {
  const s = String(code || "");
  return s.length >= 4 && s.slice(0, 2) === "00" && /^\d+$/.test(s) && s !== "0000";
};

/* Contracts ARE filtered to the selected year — a contract reported 2022–2023
   has no business appearing under 2025, however carefully the caption is
   worded. A contract with NO known years is EXCLUDED: not knowing when it ran
   is a reason to leave it out, never a reason to assume it ran now.
   (7,782 of 1,036,112 rows have no max_year.) */
const CONTRACTS_LIMIT = 25;
async function loadContracts(code, year) {
  if (!isAdminCode(code)) return null;
  const y = +year;
  const inYear = y ? `AND min_year IS NOT NULL AND max_year IS NOT NULL
       AND min_year <= ${y} AND max_year >= ${y}` : "";
  /* Ordered by the whole-contract volume — the same number the first money
     column prints, so "the top 25" means the top 25 of what the reader sees. */
  const rows = await bk(`SELECT supplier_name, entity_name, entity_kind, purpose,
      publisher_name, purchase_method, exemption_reason, volume, executed,
      payments, min_year, max_year, order_id, budget_code
    FROM contract_spending
    WHERE budget_code LIKE '${sqlq(String(code))}%' ${inYear}
    ORDER BY volume DESC NULLS LAST`, CONTRACTS_LIMIT + 1);
  // one extra row is fetched only to learn whether there are more
  const out = rows.slice(0, CONTRACTS_LIMIT);
  await attachReportedPaid(out, code);
  return { rows: out, more: rows.length > CONTRACTS_LIMIT, year: y };
}

/* ---------- the ministry's own figure, read from its own report ----------
   BudgetKey ingests the quarterly .xlsx files but does not map the payment
   column: for משרד החינוך's 2025 Q1 report it stores the order value to the
   agora and the amount paid as 0.00, with no parse error flagged. Four
   contracts checked by hand, 2026-08-22 — ₪7.8bn of payments reading as zero.

   So where we have the ministry's file, we prefer what the ministry published.
   The pipeline parses the reports into one document per budget section:
     { sources: [url…], orders: { "<order_id>:<10-digit code>": [paid, volume] } }
   Since 2026-09-06 those documents live on Cloudflare, not in this folder
   (Mercy: everything the pages use comes from a public API or from
   Cloudflare). The page reads them through the relay, same envelope as every
   other snapshot ({t, stale?, data}):
     GET <PROXY>/data/paid/index      → data = { sections: ["0020", …] }
     GET <PROXY>/data/paid/<section>  → data = { sources, orders }
   Nothing here overwrites a figure BudgetKey does have — this only fills in
   what would otherwise be a dash, and the row says where the number came from.
   A missing section is not an error; most sections have none yet. */
/* The index lists the sections a document exists for. Without it the page
   cannot tell "no report for this ministry yet" (normal — most sections)
   from "the relay never got the paid data" (a bug that otherwise shows up as
   dashes everywhere and no error anywhere). state.paidData records which. */
const reportedCache = {};
let manifestPromise = null;
function paidDoc(name) {
  // one relay snapshot, unwrapped. null on 404/501/network — never throws.
  if (!PROXY) return Promise.resolve(null);
  return fetch(PROXY + "/data/paid/" + name)
    .then(r => r.ok ? r.json() : null)
    .then(j => (j && !j.error && j.data !== undefined) ? j.data : null)
    .catch(() => null);
}
function loadPaidManifest() {
  if (!manifestPromise) {
    manifestPromise = paidDoc("index").then(m => {
      state.paidData = m && Array.isArray(m.sections) ? m.sections : null;
      if (!state.paidData)
        debug("paid overlay: the relay has no /data/paid/index — was the paid data published to Cloudflare?");
      return state.paidData;
    });
  }
  return manifestPromise;
}

function loadReported(section) {
  if (!(section in reportedCache)) {
    reportedCache[section] = paidDoc(section)
      .then(doc => { if (!doc) debug("paid overlay " + section + ": not on the relay"); return doc; });
  }
  return reportedCache[section];
}

async function attachReportedPaid(rows, code) {
  const section = String(code).slice(0, 4);
  const have = await loadPaidManifest();
  if (!have || have.indexOf(section) < 0) return;   // nothing published for it
  let doc = null;
  try { doc = await loadReported(section); } catch (e) { doc = null; }
  if (!doc || !doc.orders) return;
  for (const r of rows) {
    if (+r.executed > 0) continue;          // BudgetKey has it — leave it alone
    const hit = doc.orders[String(r.order_id) + ":" + String(r.budget_code)];
    if (hit && hit[0] > 0) { r.reportedPaid = hit[0]; r.reportedSrc = doc.sources; }
  }
}

/* ---------- what was actually paid in one year ----------
   Every payments[] entry is one published report carrying the CUMULATIVE
   amount executed on the contract so far — checked against six contracts, the
   figure only ever climbs within a run of reports. So the money that moved
   during year Y is (cumulative at the end of Y) − (cumulative at the end of
   Y−1). Two things in the real data will wreck that if ignored, both seen live:

   1. The SAME report is published twice (foi.gov.il and gov.il) — dedupe by
      year+period or every quarter counts twice.
   2. From 2024 on, a great many reports carry executed = 0 beside a volume
      that is still there. A contract reading 144,719,601 in 2024 Q2 does not
      read 0 in Q3 — that is the field going unreported, not a refund. We
      refuse to answer rather than print a collapse that did not happen.

   Coverage, counted live: of the contracts last reported in 2015 90% carry a
   non-zero executed; 2023 66%; 2024 35%; 2025 14%. The blanks in the recent
   years are the government's reporting, and the caption says so. */
const reportOrder = (p) => (+p.year || 0) * 10 + (p.period == null ? 9 : +p.period || 0);

function reportsUpTo(payments, y) {
  if (!Array.isArray(payments)) return [];
  return payments
    .filter(p => p && +p.year && +p.year <= y)
    .sort((a, b) => reportOrder(a) - reportOrder(b));
}

const anyPaid = (payments) => reportsUpTo(payments, 9999).some(p => +p.executed > 0);

/* cumulative paid as reported at the end of year y — null when unknowable.
   A ZERO IS NOT A FACT HERE. Checked live: משרד החינוך's contract 4502539235
   with מילגם reads volume 409,961,432.74 and executed 0.0 in BudgetKey's raw
   ingest, with no parse error flagged — while the ministry's own published
   file carries a real paid figure. So a contract whose reports are ALL zero
   tells us nothing at all, and we say nothing. A zero BEFORE the first
   positive figure is different: that one is credible as "signed, nothing paid
   yet", and it is kept. */
function cumulativeTo(payments, y) {
  if (!anyPaid(payments)) return null;
  const rs = reportsUpTo(payments, y);
  if (!rs.length) return null;
  const last = +rs[rs.length - 1].executed || 0;
  if (last > 0) return last;
  // a zero that follows a positive figure is a gap in the reporting, not a fact
  return rs.some(p => +p.executed > 0) ? null : 0;
}

/* the whole-contract total: BudgetKey's figure, else the ministry's own
   report, else nothing — never a zero dressed up as a fact */
const totalPaid = (r) => !r ? null
  : (+r.executed > 0) ? +r.executed
  : (+r.reportedPaid > 0) ? +r.reportedPaid
  : null;
const isReported = (r) => !!(r && !(+r.executed > 0) && +r.reportedPaid > 0);

const hasReportIn = (payments, y) =>
  Array.isArray(payments) && payments.some(p => p && +p.year === +y);

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
  const p = r.payments;
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
  const rs = reportsUpTo(r && r.payments, 9999);
  return rs.length ? rs[rs.length - 1] : null;
}

/* the first array element the source gives, as plain text */
const firstOf = (v) => Array.isArray(v) ? (v.length ? String(v[0]) : "") : String(v || "");

/* a budget line can hold contracts only in the administrative tree */
const canHoldContracts = (mode, code) => mode === "admin" && isAdminCode(code);

async function searchContracts(q) {
  return bk(`SELECT supplier_name, purpose, publisher_name, min_year, max_year, volume, executed
     FROM contract_spending
     WHERE supplier_name::text ILIKE '%${sqlq(q)}%' OR purpose ILIKE '%${sqlq(q)}%'
     ORDER BY volume DESC NULLS LAST`, 25);
}

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
