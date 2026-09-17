"use strict";
/* =====================================================================
   Our Money — ספקים והתקשרויות: talking to the data.
   Source: BudgetKey's open API (contract_spending, ~1M rows) — live,
   CORS-open, no relay:
       https://next.obudget.org/api/query?query=<SQL>

   Everything here was VERIFIED against the live table on 2026-09-08:
   - supplier_name is a JSON ARRAY (usually one name), and its ::text form
     round-trips exactly through JSON.stringify — that is what makes
     name-equality drill-down possible for suppliers with no entity_id.
   - entity_id is the company/עמותה registrar number; NULL on ~a quarter of
     rows (individuals, old records). Grouping by
     COALESCE(entity_id, supplier_name::text) keeps those apart.
   - THE YEARS ARE DIRTY AT BOTH EDGES: min_year 1899, max_year 2099/9999
     exist. A junk max means "open-ended" and the contract may genuinely
     still run, so it is kept when filtering "in force in year Y"; a junk
     MIN would put the contract in force in every year since 1899, so rows
     with min_year <= 1990 are excluded from the ranking. For DISPLAY both
     edges are clamped (see saneYear) — never print 2099 as a fact.
   - Coverage becomes real in 2015 (111,865 contracts in force vs 2,873 in
     2014) and thins after 2024 — ministries report late. FIRST_YEAR and the
     default year encode that; the wording carries the caveat.
   - `executed` is the CUMULATIVE paid as BudgetKey read it. From 2024 on
     its ingest often drops the paid column, so `executed` can undercount.
     The page says so out loud (paidInfoB) and points to the budget page's
     per-line table, which merges the ministries' own files.
   The top-of-year aggregation takes ~4s at BudgetKey — cached per year in
   state.topByYear, and the page shows a loading note meanwhile.
   ===================================================================== */

const API = "https://next.obudget.org/api/query?query=";
const sqlq = s => String(s).replace(/'/g, "''");

async function bk(sql, numRows) {
  const j = await fetchJson(API + encodeURIComponent(sql) + (numRows ? "&num_rows=" + numRows : ""));
  // BudgetKey can answer HTTP 200 with {"success":false,"error":"…"} when its
  // database is overloaded — surface that as an error, never as "zero data".
  if (j && (j.success === false || j.error))
    throw new Error("UPSTREAM::" + String(j.error || "unknown").slice(0, 160));
  return j.rows || j.data || j.results || [];
}
const bkFriendly = e => String(e.message).startsWith("UPSTREAM::") ? t("errBusy") : t("err");

/* ---------- years ---------- */
const THIS_YEAR = new Date().getFullYear();
const FIRST_YEAR = 2015;           // where coverage becomes real (verified live)
const YEARS = [];
for (let y = THIS_YEAR; y >= FIRST_YEAR; y--) YEARS.push(y);

/* display clamp: 1899 / 2099 / 9999 are placeholders, not dates */
const saneYear = y => (y = +y) && y > 1990 && y <= THIS_YEAR + 20 ? y : null;

/* ---------- state ---------- */
const state = {
  year: THIS_YEAR - 1,   // the last full calendar year; reporting for it is
                         // still partial, and topRecent says so
  topMode: "all",        // "all" | "exempt" — the lens on the top list
  topByYear: {},         // {year: {all: rows, exempt: rows}} — cached per year
  tilesByYear: {},       // {year: {n, total, exempt_vol, exempt_n}}
  exByYear: {},          // {year: exemption-regulation rows}
  supplier: null,        // {sid, label, kind, facts, byOffice, rows, series}
  lastSearch: null,
};

/* ---------- the opening numbers ----------
   One exact query, no classification table: the method field's own words.
   "בפטור ממכרז" counts the contracts whose report records פטור ממכרז —
   the field is dirty (currency codes, empty arrays, multi-value combos,
   verified live), so counting the phrase as-published is the
   only claim that needs no judgment call of ours. */
const EXEMPT_MARK = "פטור ממכרז";
const inForce = y => `min_year <= ${+y} AND max_year >= ${+y} AND min_year > 1990`;
const exemptCond = `purchase_method::text LIKE '%${EXEMPT_MARK}%'`;

async function loadTiles(year) {
  if (state.tilesByYear[year]) return state.tilesByYear[year];
  const rows = await bk(`SELECT count(*) AS n,
      count(DISTINCT COALESCE(entity_id, supplier_name::text)) AS suppliers,
      sum(volume) AS total,
      sum(CASE WHEN ${exemptCond} THEN volume ELSE 0 END) AS exempt_vol,
      count(CASE WHEN ${exemptCond} THEN 1 END) AS exempt_n
    FROM contract_spending WHERE ${inForce(year)}`, 2);
  state.tilesByYear[year] = rows[0] || null;
  return state.tilesByYear[year];
}

/* ---------- who is a supplier ----------
   sid = entity_id when there is one (all digits), else the EXACT ::text of
   the supplier_name array — verified to round-trip through JSON.stringify. */
const sidWhere = sid => /^\d+$/.test(String(sid))
  ? `entity_id = '${sqlq(sid)}'`
  : `supplier_name::text = '${sqlq(sid)}'`;

/* ---------- the top suppliers of one year ----------
   Two lenses on the same ranking: everything, or only the contracts whose
   report records פטור ממכרז. Same definition, one extra condition. */
const TOP_LIMIT = 25;
async function loadTopSuppliers(year, mode) {
  const cache = state.topByYear[year] || (state.topByYear[year] = {});
  if (cache[mode]) return cache[mode];
  const rows = await bk(`SELECT COALESCE(entity_id, supplier_name::text) AS sid,
      min(supplier_name::text) AS name, min(entity_kind) AS kind,
      count(*) AS n, sum(volume) AS volume, sum(executed) AS executed
    FROM contract_spending
    WHERE ${inForce(year)}${mode === "exempt" ? ` AND ${exemptCond}` : ""}
    GROUP BY COALESCE(entity_id, supplier_name::text)
    ORDER BY sum(volume) DESC NULLS LAST LIMIT ${TOP_LIMIT}`, TOP_LIMIT + 5);
  cache[mode] = rows;
  return rows;
}

/* ---------- which exemption regulations carry the money ----------
   exemption_reason is an array, verbatim from the report — including
   combinations. The field also carries junk (an order number was seen in
   it, verified live), so only rows that actually cite a תקנה
   are asked for; the view prints the citation exactly as recorded. */
async function loadExemptions(year) {
  if (state.exByYear[year]) return state.exByYear[year];
  /* the caption says "ההתקשרויות הפטורות ממכרז" — so the query must require
     BOTH: the contract records פטור ממכרז, and it cites a תקנה. A citation
     on a tendered contract must never sneak into this table. */
  const rows = await bk(`SELECT exemption_reason, count(*) AS n, sum(volume) AS volume
    FROM contract_spending
    WHERE ${inForce(year)} AND ${exemptCond} AND exemption_reason::text LIKE '%תקנה%'
    GROUP BY exemption_reason
    ORDER BY sum(volume) DESC NULLS LAST LIMIT 10`, 15);
  state.exByYear[year] = rows;
  return rows;
}

/* ---------- free-text search ----------
   Stays on BudgetKey live — deliberately (2026-09-08 ruling): our own D1
   database has no text index, and an infix LIKE there would scan ~1M billed
   rows per search. An FTS table is the day it moves.
   entity_id rides along so a result row can open the supplier's profile. */
async function searchContracts(q) {
  return bk(`SELECT entity_id, supplier_name, purpose, publisher_name,
      min_year, max_year, volume, executed
    FROM contract_spending
    WHERE supplier_name::text ILIKE '%${sqlq(q)}%' OR purpose ILIKE '%${sqlq(q)}%'
    ORDER BY volume DESC NULLS LAST LIMIT 25`, 25);
}

/* ---------- one supplier, in full ---------- */
/* the supplier's in-force volume per year — the profile's chart. Same
   definition as everything else on the page: a contract counts, in full,
   in every year it is in force. Verified live 2026-09-08 on three big
   suppliers: the series are stable and legible (דן's 2022 franchise jump
   is plainly visible); the fade near the present is the reporting horizon,
   and the chart hatches those years and says so. */
async function loadSupplierSeries(sid) {
  const rows = await bk(`SELECT y AS year, sum(volume) AS volume FROM
    (SELECT generate_series(GREATEST(min_year, ${FIRST_YEAR}), LEAST(max_year, ${THIS_YEAR})) AS y, volume
     FROM contract_spending WHERE ${sidWhere(sid)} AND min_year > 1990) s
    GROUP BY y ORDER BY y`, YEARS.length + 5);
  return rows.filter(r => saneYear(r.year));
}

const SUP_LIMIT = 25;
async function loadSupplier(sid) {
  const where = sidWhere(sid);
  const [facts, byOffice, rows, series] = await Promise.all([
    bk(`SELECT count(*) AS n, min(supplier_name::text) AS name,
        sum(volume) AS volume, sum(executed) AS executed,
        min(CASE WHEN min_year > 1990 THEN min_year END) AS y0,
        max(CASE WHEN max_year <= ${THIS_YEAR + 20} THEN max_year END) AS y1
      FROM contract_spending WHERE ${where}`, 2),
    bk(`SELECT publisher_name, count(*) AS n, sum(volume) AS volume, sum(executed) AS executed
      FROM contract_spending WHERE ${where}
      GROUP BY publisher_name ORDER BY sum(volume) DESC NULLS LAST LIMIT 30`, 35),
    bk(`SELECT purpose, publisher_name, purchase_method, tender_key, min_year, max_year, volume, executed
      FROM contract_spending WHERE ${where}
      ORDER BY volume DESC NULLS LAST LIMIT ${SUP_LIMIT}`, SUP_LIMIT + 5),
    loadSupplierSeries(sid),
  ]);
  return { sid, facts: facts[0] || { n: 0 }, byOffice, rows, series };
}

/* ---------- the exemption's own publication ----------
   ~9% of exempt contracts carry a tender_key into the mr.gov.il exemptions
   register (3,822 of 41,180 in force 2024, verified live) —
   each element is a JSON STRING encoding [publication_id, type, tender_id].
   Where one exists, the register has the publication's description, the
   reason, the regulation, the committee decision and the page itself
   (reason is filled on ~102k of its ~140k records). The button appears
   only when a publication exists — never a column of dashes. */
function exemptionPubId(r) {
  if (!Array.isArray(r && r.tender_key)) return null;
  for (const el of r.tender_key) {
    try {
      const k = JSON.parse(el);
      if (Array.isArray(k) && k[1] === "exemptions" && k[0]) return String(k[0]);
    } catch (e) {}
  }
  return null;
}

const pubCache = {};
async function loadExemptionPub(pid) {
  if (pubCache[pid]) return pubCache[pid];
  const rows = await bk(`SELECT publication_id, description, reason, regulation, decision, page_url
    FROM procurement_tenders
    WHERE publication_id = ${+pid} AND tender_type = 'exemptions' LIMIT 2`, 3);
  pubCache[pid] = rows[0] || null;
  return pubCache[pid];
}

/* ---------- small helpers ---------- */
/* fill("ב-{y} …", {y: 2025}) — every number in a sentence comes from the data */
function fill(str, vals) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vals[k] !== undefined ? vals[k] : m));
}
