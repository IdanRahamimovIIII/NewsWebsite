# NOTES — budget section (site\budget\)

TWO pages joined by a sub-header (התקציב · ספקים והתקשרויות; Mercy: no new
main-nav button). Both set `window.PAGE = "budget"` and load `budget.css`.
- `index.html` — budget: flows, debt, the tree, contracts per line.
  `budget.strings.js` · `budget.data.js` (SQL, code-tree map, `state`,
  `loadContracts()`) · `budget.view.js` · `test_budget.mjs`.
- `contractors.html` — top suppliers, free-text search, supplier profile.
  `contractors.strings.js` · `contractors.data.js` (BudgetKey SQL) ·
  `contractors.view.js` · `test_contractors.mjs`.

## BudgetKey API — `next.obudget.org/api/query?query=<SQL>`
Open CORS, no key, ANNUAL data. Saturated Postgres → HTTP 200 with
`{"success":false,"error":"…connection slots…"}` → `bk()` throws UPSTREAM::,
page says "temporarily overloaded". Caches by query TEXT. Unindexed ILIKE is
fine with LIMIT, fatal with ORDER BY / count(). 118 public tables.

## Budget page rules (Mercy)
- Titles settled, don't churn: tagline `תקציב המדינה — מה קורה לכסף שלנו` ·
  blocks `מאיפה הכסף מגיע, ומה החוב עולה לנו` · `לאן הולך הכסף`; a chart
  subhead names what the chart adds (`לאורך השנים`).
- Default year = `lastActualYear()`: an unfinished year is a PLAN — hatched
  in charts, ★ in tables, says so.
- Every tile shows budget vs actual ("בתקציב: 482 · בפועל 30 יותר").
- Prose via `fill()` only. Line under the cost chart states numbers, stops.
- Always "קרן החוב" (קרן alone is ambiguous). Interest is paid on the WHOLE
  debt, not on this year's principal.
- NO headline "total budget" tile. Three defensible 2026 totals: 710.4bn =
  code '00' · 966.8bn = 61 admin sections summed · 811.7bn = MoF booklet
  "סך-הכול כללי" (unreproducible from raw_budget — don't spend a session on
  it). If a total is ever needed, name its definition.
- Spine = the four flows, stacked columns (borrowed in red) + one line
  (interest as % of tax). Not a pie (two inflows, two outflows, over time).

## raw_budget — the data model
- Values in WHOLE ₪. 1997–2026, ~400k rows. ~60 columns.
- Code map (full map in budget.data.js header; change ROOT_SQL/childSql/
  isLeaf/MAX_LEN, never ad-hoc): '00' root · '0000' revenue · '00xx' 61
  sections, +2 chars per level to 10 = תקנה (2/4/6/8/10 = root/סעיף/תחום/
  תכנית/תקנה) · 'C1'–'C8' functional tree, two levels. NEVER select by
  length alone (`length=4` mixes both trees + '0000').
- Page: switch `state.mode` admin|func, each mode keeps its open state; func
  children drop the "parent / " prefix (full title in tooltip); tree opens to
  10 chars; card says it's spending only. Worker snapshot already filters
  admin sections; `cleanAdmin()` stays as a guard; func tree is always live.
- The trees don't sum alike — not a bug. 2026: `0084` תשלום חובות 171.41 =
  principal only (008405 פנים 146.61 + 008406 חוץ 24.80); interest is `0045`
  63.05. `C6` החזרי חוב 82.65 = C661 ריבית 63.05 + C663 ביטוח לאומי 19.60 (no
  market principal — it buys nothing). Admin sections 966.81 − '00' 710.43 =
  104.57 מפעלים עסקיים (kind 5) + 151.81 market principal. C1–C7 = '00'
  exactly.
- budget_kind 2026 (sections): 1 רגיל 558.18 · 2 פיתוח 56.92 · 5 מפעלים
  104.57 · 6 החזר חובות 234.46 · 7 רזרבות 12.69 · 4 הכנסות 850.59. Kinds
  1+2+7+6 net_allocated = kind 4 to the shekel; מפעלים self-balances.
- Four flows (`loadFlows()`, one query, `[plan, actual]` per year, read via
  `fv()`/`isPlanYear()`): מסים = C881+C882 · אגרות C883 · אחרות C884 · חוב
  חדש C886 · ריבית 0045 · קרן 0084. Inflows sum to '0000'. Story: borrowing
  25–38% of money in (46% in 2020); interest/tax 20.9% (1997) → 11.4%
  (2026) but 38bn (2019) → 63bn (2026); principal 37.5 → 171.4bn.
- 2020 has no approved budget (revenue reads 0) → label תקציב המשכי, never a cliff.
- History per code = one query (`SELECT year,net_revised,net_executed FROM
  raw_budget WHERE code='0020'`, 30 points).
- Unused columns: `total_econ_cls_*` (salaries, transfers, procurement,
  investment, credit, reserve, debt interest/principal, dedicated/grants/
  loans income) · `personnel_*` = תקנים · `commitment_allowance_*` = הרשאה
  להתחייב · `gross_*`/`dedicated_*` · `contractors_*` · `covid19_expenses_*`
  · `func_cls_title_1/2` · `budget_kind_title` · `direction` ·
  `children`/`parent`/`hierarchy`. salaries ÷ personnel = cost per position.
- Revenue by tax type: `income_items_data` (code, title, year, level 1–3,
  amount_allocated/revised/used, classes). 2024 used: מס הכנסה 231.9 · מע"מ
  141.7 · מס קניה 26.7 · דלק 24.0 … · מלוות פנים 224.3 · חוץ 54.1 (~¼ of
  "revenue" is borrowing).

## Contracts under a budget line (worker v8 D1)
- `loadContracts()` = one fetch `/contracts?code=&year=&n=25`: worker joins on
  LIVE allocations, excludes contracts with no known years (Mercy), orders by
  volume DESC (the figure the reader sees). Fields: `supplier`, `ministry`,
  `method`, `exemption`, `volume`, `paid`, `first_year`/`last_year`,
  `sources`, `reports[]` (`paid_cumulative` per published report).
- `paidInYear(r, y)` = cumulative end y − end y−1 from deduped reports;
  null (dash) on a zero-after-positive, a gap, or a negative difference.
- `paid` = merged best figure; no asterisks. פרטים popover has a מקורות line
  from `sources`: file → "הדוח שפרסם המשרד" · bk → "מפתח התקציב" · tn/ex →
  the registers. Per-field provenance stays private (audit db only).
- Merged `paid` 0 is a dash unless a ministry file is among the sources
  (`totalPaid()`).
- Three kinds of empty (Mercy: readers should know): `noContracts` (other
  years have some — one extra n=1 request without year) · `noContractsAtAll`
  · `noContractsDefence` for 0015/0016 (`DEFENCE_SECTIONS`): BudgetKey has
  zero rows there; wording claims only separate exemption rules + a partly
  classified budget, nothing about legal duty.
- Paid coverage thins toward the present (non-zero executed by last reported
  year: 2015 90% · 2020 77% · 2023 66% · 2024 35% · 2025 14%) — a finding;
  captions count rows they can't answer for.
- Don't parse a year out of the purpose text (tender numbers, school years).
- test_budget.mjs mocks the worker's `/contracts` with only its columns,
  404s unmodelled routes, throws on any contract_spending query from
  index.html; fixture traps: report published twice, annual `period: null`
  sorting after Q4, executed dropping to 0, no years at all, array fields.

## Contractors page (BudgetKey `contract_spending` live, until the swap)
- Three doors: top suppliers of a year · free-text search (entity_id +
  LIMIT 25) · profile addressable as `#s=<entity_id or name>`.
- Definitions mirror the build's `ctr_*` tables (pipeline owns them): in
  force in y = min_year ≤ y ≤ max_year AND min_year > 1990 (junk max =
  open-ended); display clamps via `saneYear` ≤ THIS_YEAR+20; ranked by
  VOLUME; a contract counts in full in every year in force (profile chart
  too, `generate_series`); group by `COALESCE(entity_id, supplier_name::text)`
  (entity_id NULL on ~¼); no-entity drill-down matches `supplier_name::text =
  JSON.stringify(array)` (verified exact); SUM over only-NULLs stays a dash.
- Opens with three tiles ("כמה מהרכש עובר בלי תחרות?"): volume in force ·
  share recorded "פטור ממכרז" (method text contains the phrase — the field is
  dirty: ILS codes, empty arrays, contradictory combos; no bucket taxonomy
  without Mercy) · top-10 share. NOTHING red (an exemption is lawful); the
  explainer words it both ways. 2024: 210.4bn, 66.7bn = 31.7% exempt.
- Top list has an exempt lens ("מי מקבל הכי הרבה כשאף אחד לא התמודד"); the
  unfiltered list always loads (the concentration tile uses it).
- Regulations ranked by money ("באילו פטורים נעשה שימוש?"), verbatim, only
  citations containing "תקנה" on contracts recorded exempt; combos joined.
- Under the top list: suppliers with executed NULL or 0 = "לא מופיע במקור
  ולו תשלום אחד" (bk writes 0 where the paid column was dropped ~2024); paid
  column says it can undercount and points to the budget page. Defence
  absence is a card ("ומשרד הביטחון?", no size claims).
- Profile chart: two youngest years hatched; caption: partial years
  "עשויות להיראות נמוכות מכפי שיתבררו". Years 2015..now; default = last full
  year; top-of-year ~4 s at BudgetKey → cached per year.
- "מדוע פטור?": button only where a publication exists. tender_key elements
  are JSON strings [publication_id, type, tender_id]; type 'exemptions' joins
  `procurement_tenders` (description, reason, regulation, decision, page_url)
  — printed verbatim + mr.gov.il link. ~9% of exempt contracts have one.
  `explanation`/`manof_excerpts` are empty — don't revisit.
- test_contractors.mjs (77): mock projects answers through the query's SELECT
  list, throws on unmodelled expressions, mimics SUM-over-NULLs.
- Per-resident framing not built (needs a live CBS population figure).

## Research verdicts (don't re-research)
- Salaries: (a) by law per OFFICE (נשיא, רה"מ, שר, ח"כ, ראשי רשויות, judges —
  Knesset salaries__benefits.pdf + משרד הפנים circular) · (b) pay tables per
  role/grade (gov.il genaral-managers-salary) · (c) דוח הממונה על השכר per
  body, anonymised (+ חריגות שכר). No named civil servants (one court-ordered
  exception: 1,516 gov-company execs 2023–24, meida.org.il/17055 — label it).
  All PDF.
- Tax per city: impossible (no geographic tax data anywhere). Available:
  public money INTO a city — own vs government income per authority
  (data.gov.il `interior_affairs`), ארנונה, מענק איזון, MoI מדד איתנות, NII
  benefits/wages per locality, CBS מדד חברתי-כלכלי. Frame "כמה כסף ציבורי
  נכנס לעיר — ומאיפה"; say central spending isn't geographic.
- Unit/hourly prices exist only in tender PDFs — don't promise them.
- Capital vs current (not "one-time vs forever"): budget_kind פיתוח ·
  economic class · הרשאה להתחייב. `non_repeating` leaf semantics unverified.
- Other BudgetKey tables: `budget_changes` 19,127 transfers 2005–2026 with
  justification · `activities`/`all_activities` 414 social services (codes,
  beneficiaries, suppliers) · `supports_data` 329,589 תמיכות · 
  `procurement_tenders` · `government_decisions` · `muni_budgets` (only 21
  authorities — never national) · political_donations, government_companies,
  guidestar, entities, company_registry.
- Outside BudgetKey: Bank of Israel SDMX WORKS
  (`edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/PS/1.0/?format=csv&startPeriod=2020`; Mercy ran it: monthly to
  2026-07; MOF_ED_NO_CREDIT_M_N, I_TAX_TOT_M, MOF_DEFD_NO_CREDIT_M_N, …;
  UNIT_MULT varies — read it; host `edge.boi.gov.il` not on the allowlist) ·
  data.gov.il CKAN works via relay (`/api/3/action/package_search?q=`): MoF
  quarterly אומדן ביצוע XLSX 2017→2025-06, שינויי תקציב 2005–2013 · OECD COFOG
  works, no key (`sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NASEC10@DF_TABLE11,1.1/A.ISR...........?format=jsondata`)
  · CBS api.cbs.gov.il untested (needs User-Agent) · MoF booklets
  `gov.il/BlobFolder/dynamiccollectorresultitem/{ministry}-proposal-{year}/he/…`
  (pattern changed 2025→2026; listing needs DevTools) · monthly execution
  XLSX at gov.il budget-execution-estimate / -regulations (JS-listed) ·
  outside the state budget: ביטוח לאומי, local authorities, חברות ממשלתיות,
  קופות חולים, classified defence annex, קרן לאזרחי ישראל; State Comptroller
  = PDFs only.
- Briefing artifacts: ae4671eb-5cc4-4e4b-a774-134bf219b512 (data),
  334148ff-f6c5-412a-9b2b-748ea01f129a (flows mockup) under claude.ai/code/artifact/.

## Open
- Contractors swap: `contractors.data.js` SQL → worker `/contractors/*`
  (v9), mocks → worker routes; "מדוע פטור?" stays on BudgetKey.
- Link supplier names in the per-line table to `contractors.html#s=`.
- Anatomy of a section: salaries/transfers/procurement, תקנים budgeted vs
  filled, הרשאה להתחייב.
- `budget_changes` → explain מקורי vs מעודכן. `activities` → glossary head
  start, cost per beneficiary. Glossary per item (Claude drafts, Mercy edits).
- History chart per section, annotated with governments/ministers.
- Revenue tree by tax type.
- Monthly execution: Mercy's DevTools capture of the gov.il file-list request.
- More spending data: תמיכות, tenders.
