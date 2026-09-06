# NOTES.md — the budget page (site\budget_page\)

Everything settled about THIS page: layout, the data model of raw_budget,
Mercy's rulings, the traps the tests arm. Shared front-end rules are in
`site\CLAUDE.md`; upstream API facts in `site\SOURCES.md`. Same
keep-it-current rule as CLAUDE.md.

Files (load order: ../config → budget.strings → ../shared/common →
budget.data → budget.view): `index.html` shell only · `budget.css` ·
`budget.strings.js` (window.PAGE + PAGE_STR, all wording) · `budget.data.js`
(SQL, the code-tree map, `state`, `attachReportedPaid()` — reads the
ministry-report overlay from the relay: `/data/paid/index` and
`/data/paid/<section>`, since 2026-09-06; before that it was
`data\paid\*.json` on disk) · `budget.view.js` (all DOM, init at the bottom)
· `test_budget.mjs` (Playwright, mocked upstreams — to RUN it Claude also
needs `../config.js` and `../shared/`, which the page loads).

## THIS FOLDER IS THE WHOLE PAGE (Mercy's rule, 2026-09-06)

To change this page, a chat needs THIS folder and nothing else. Everything
the page shows comes from a public API or from Cloudflare (via the relay);
nothing is read from disk. The only files outside this folder the page
touches are three shared ones it must NOT edit from here:

- `../config.js` — `window.PROXY_URL`, the relay address. Read-only.
- `../shared/style.css` — design tokens + shared components. Read-only;
  page styling goes in this folder's own `.css`.
- `../shared/common.js` — loaded AFTER this page's strings file and BEFORE
  its data file. What it gives us (plain globals, no modules):
  `t(key)` (page string, else common string, else the key) ·
  `applyLang()` / `toggleLang()` + `lang` ("he"|"en"); the page sets
  `window.PAGE` (nav tab id), `window.PAGE_STR = {he:{…}, en:{…}}` and
  `window.onLangChange` · `buildChrome()` runs on load and fills
  `<header class="topbar">` (brand, nav tabs, language button) and adds the
  tagline when `PAGE_STR.*.tagline` exists · `esc(s)` · `isoDaysAgo(n)` ·
  `dateOf(v)` / `fmtDate(v, "long"?)` · `PROXY` (relay base, no trailing
  slash) · `viaRelay(url, body?)` (relay GET/POST of a government URL,
  204→null) · `preset(name, params)` · `dataset(name)` (relay KV snapshot,
  unwraps `{t, data}` and shows "data updated" in the footer) ·
  `fetchJson(url)` · `friendly(err)` · `debug(msg)` (writes into `#debug`).
  Common strings available through `t()`: title, navBudget, navVotes, navMk,
  navCourt, loading, searchBtn, empty, credit, err, updatedAt, errCors,
  errProxy.
- Links to other pages are `../<name>_page/` (budget_page, votes_page,
  mk_page, court_page); the nav itself is built by common.js.

If a change needs something NEW from common.js or style.css, say so and ask
for `../shared/` — don't copy code from there into this folder.


### PAID COVERAGE, paidInYear() AND THE ORDERING (2026-08-22)

Coverage of a non-zero `executed`, by the last year a contract was reported
(counted live): 2015 **90%**, 2017 83%, 2020 77%, 2022 72%, 2023 **66%**,
2024 **35%**, 2025 **14%**. The government's reporting of what it actually paid
thins out sharply as you approach the present. That is a finding about the
data, not a bug in the page — the caption under each table counts the rows it
cannot answer for and says so.

`paidInYear(r, y)` = cumulative at end of `y` − cumulative at end of `y−1`,
both from deduped reports, `null` (→ a dash) when either endpoint is a
zero-after-positive or the difference runs negative (restatements happen).
`min_year`/`max_year` NULL → the contract is **excluded**, never assumed to be
running now (Mercy's rule: not knowing when it ran is a reason to leave it out).

`loadContracts` orders by `volume DESC` — the same number the first money
column prints, so "the top 25" is the top 25 of what the reader can see.

### THE FIXTURE MUST HONOUR THE `SELECT` LIST (2026-08-22)

`test_budget.mjs` handed back every column of its contract rows regardless of
what the query asked for. So `contractsHtml` could read `r.volume_per_year`
while `loadContracts` never fetched it: 81 tests green, and live the page would
have silently fallen back to lifetime totals in a column headed "per year".
The mock now projects each row through the SELECT list, plus an explicit
assertion that the generated SQL names both per-year columns.

This is the same failure that produced "everywhere I look I only see
לא נרשמו": **a fixture more generous than the real source turns a test into a
rubber stamp.** When adding a field to the view, add it to the query and to
the SQL assertion in the same edit.

The fixture now arms every trap the live data actually contains: a report
published twice, an annual report with `period: null` that must sort after Q4,
an `executed` that drops to 0 in the newest report, a contract with no years at
all, and `purchase_method` / `exemption_reason` as arrays rather than strings.

### DON'T PARSE THE YEAR OUT OF THE PURPOSE TEXT (asked and answered 2026-08-22)

Mercy noticed most titles carry what looks like a date: `מכרז מס' 7/7.2013 הזנה
עפ"י חוק תשע"ח`, `הסכם זרוע ביצוע מול החברה למתנ"סים 2018`, `הזנה עפ"י חוק תשע"ו`.
The answer is no. `7/7.2013` is a **tender number** — its year is when the
tender was issued, not when money moved. The `תשע"ח` markers are real (they name
a school year) but appear in a minority of titles and in several spellings.
Either way it is a date inferred from prose and printed as data. `payments[].year`
is a reported year on a published report; use that.

## BUDGET PAGE v4 — the four flows (2026-08-22)

The page now leads with the money COMING IN, then the tree of where it goes.
`loadFlows()` in budget.data.js pulls all seven codes for all years in ONE query
(C881,C882,C883,C884,C886,0045,0084) and stores `[plan, actual]` per flow per
year. Everything downstream reads through `fv()` / `isPlanYear()`.

Rules baked in, do not undo them:
- **Default year = `lastActualYear()`**, not the newest year. Mercy's point:
  a year that has not ended is a PLAN, and the page must never show a budget as
  if it were a fact. A plan year says so, is hatched in the chart, and is ★ in
  the table.
- **Every tile shows budget vs actual** ("בתקציב: 482 · בפועל 30 יותר").
  2025 real: taxes came in ₪31.5bn ABOVE budget, borrowing ₪18.1bn below.
- **No number is ever hard-coded in a sentence.** All prose runs through
  `fill()` with values from the loaded series — Mercy asked for this explicitly.
- **Explanations live in a POPOVER** (`#pop`), anchored to a question button
  under each number, closing on Esc / outside click / scroll. Her call, and she
  was right: an inline accordion shoves the page down. It is NOT hover-only —
  hover does not exist on a phone.
- **No opinions on the page.** The line under the cost chart states the numbers
  and stops; an earlier draft editorialised and she cut it. Keep it that way.
- **"קרן" alone is ambiguous in Hebrew** — always "קרן החוב".
- Interest is paid on the WHOLE accumulated debt, not on the principal repaid
  this year. An early draft implied otherwise and she caught it.
- The hero "total budget" tile is GONE on purpose — see the headline-total
  problem below. Don't add one back.

## BUDGET PAGE v3 — split + the two-tree fix (2026-08-22)

Files (load order: config → budget.strings → common → budget.data → budget.view):
`index.html` shell only · `budget.css` · `budget.strings.js` (window.PAGE +
PAGE_STR, all wording) · `budget.data.js` (SQL, the code-tree map, `state`) ·
`budget.view.js` (all DOM, init at the bottom).

**NEVER SELECT BUDGET ROWS BY CODE LENGTH ALONE.** The header comment in
budget.data.js has the full map; the short version: '00' root · '0000' revenue ·
'00xx' the 61 real sections (+2 chars per level, down to 10 = תקנה) ·
'C1'–'C8' the functional tree, exactly two levels deep. ROOT_SQL/childSql/
isLeaf/MAX_LEN in budget.data.js encode this — change them, not ad-hoc queries.

What v3 does: segmented switch (`state.mode` = admin|func) above the chart;
per-mode rows/roots/showAll so switching keeps each tree's open state; the
count tile follows the visible view; func children drop the repeated
"parent / " prefix for display but keep the full title in the tooltip;
tree opens to 10 chars; the card says out loud that this is spending only.

**The snapshot is still the OLD mixed query** (worker builds `length(code)=4`).
`cleanAdmin()` filters it in the page, so the fix works with no redeploy — but
that also means the func tree always comes from a live query. Fixing the worker
is queued in TODO.md as optional.

**Testing: `test_budget.mjs`** (Playwright, /opt/pw-browsers/chromium) —
a fake raw_budget deliberately containing both trees, '0000', 22 sections and
a real 4→6→8→10 chain, plus a mocked snapshot serving the OLD mixed rows.
27 assertions, all passing. Extend this before touching the tree again.
Live spot-checks done through the relay: 61 admin sections, 8 C roots / 37 C
children (no deeper), and 00206101 → real תקנות ("שעות תקן במוסדות רשמיים").

## THE BUDGET DATA — WHAT WE ACTUALLY HAVE (2026-08-22, all verified live)

Mercy asked "how deep can we go, what do we have on revenue and expense, and
what's missing". Everything here came back from real queries against
next.obudget.org through the relay's /b64/ path. Full briefing lives at
https://claude.ai/code/artifact/ae4671eb-5cc4-4e4b-a774-134bf219b512

**THE OPEN BUG — the ministry chart shows two trees at once.** index.html asks
for `length(code)=4`. For 2025 that returns 99 rows: **62 real sections ('00xx')
and 37 functional-classification nodes ('Cxxx')**, plus code **'0000' =
הכנסות המדינה (₪755.9bn)** which is REVENUE and ranks first. Verified top rows,
in the page's own order: 0000 · C881 מסים ישירים · C886 הכנסות למימון גירעון ·
C882 מסים עקיפים · 0084 תשלום חובות · 0015 משרד הביטחון · C111 ביטחון ·
C222 חינוך · 0020 משרד החינוך. So every big ministry is drawn twice and the
first bar (755.9bn) exceeds the hero total (682.8bn = code '00' המדינה, the
expenditure total). The tile "סעיפי תקציב ראשיים: 99" counts both trees.
Fix: `code LIKE '00%' AND length(code)=4 AND code <> '0000'` for the
administrative view; `code LIKE 'C%'` is a genuinely good SECOND view
(by purpose, not by office). Length-2 roots 2025: 00 המדינה 682.8bn ·
C1 ביטחון 197.6 · C2 שירותים חברתיים 272.9 · C3 תשתיות 58.9 · C4 משרדי מטה 35.1 ·
C5 עניני משק 8.3 · C6 החזרי חוב 77.4 · C7 הוצאות אחרות 32.6 · C8 הכנסות 755.9.

**THE TWO TREES DO NOT SUM TO THE SAME NUMBER — THAT IS NOT A BUG** (verified
2026-08-22 after Mercy spotted תשלום חובות 171.4bn vs החזרי חוב 82.7bn).
2026 figures, net_revised, and the arithmetic closes exactly:
- `0084` תשלום חובות = **171.41bn** = 008405 מלוות פנים 146.61 + 008406 מלוות
  חוץ 24.80. This is PRINCIPAL only. Interest is a SEPARATE section,
  `0045` תשלום ריבית ועמלות = 63.05bn.
- `C6` החזרי חוב = **82.65bn** = C661 ריבית 63.05 + C663 קרן־ביטוח לאומי 19.60.
  It deliberately omits the 151.81bn of principal repaid to the markets:
  repaying a loan buys nothing, so it has no functional purpose. (The matching
  borrowing sits on the revenue side as מלוות פנים/חוץ.)
- Therefore **the section bars do NOT sum to the headline total.** 2026: the 61
  admin sections sum to 966.81bn, `'00'` = 710.43bn. The gap is exactly
  104.57 (מפעלים עסקיים, budget_kind 5) + 151.81 (market principal) = 256.38.
  Sum of C1–C7 = 710.43 = `'00'` exactly, so the FUNCTIONAL tree is the one
  that reconciles with the headline tile.
- Section-level totals by budget_kind, 2026: 1 רגיל 558.18 · 2 פיתוח 56.92 ·
  5 מפעלים עסקיים 104.57 · 6 החזר חובות 234.46 · 7 רזרבות 12.69 ·
  4 הכנסות 850.59 (that's '0000').
- OPEN UX ISSUE: nothing on the page tells a visitor that the by-ministry bars
  exceed the tile above them. Mercy found it in 5 minutes; visitors will too.

**THE HEADLINE-TOTAL PROBLEM — DON'T PRINT ONE (2026-08-22).** Three different
"total budget" numbers for 2026, all defensible: **710.4bn** = code '00' (net
spending, no market principal, no מפעלים עסקיים) · **966.8bn** = the 61 admin
sections added up · **811.7bn** = "סך-הכול כללי" in the MoF's own עיקרי התקציב
booklet (fetched and read: the gov.il /BlobFolder/ PDF DOES answer WebFetch).
The first two reconcile exactly (gap = 104.57 מפעלים + 151.81 market principal).
**The third could NOT be reproduced** — not by adding dedicated income
(gross_allocated at depth 1: kind 1 = 65.71bn, kind 2 = 11.56bn, 77.28 total),
not by adding מפעלים עסקיים, and no row in raw_budget carries 811.7bn.
Don't spend another session on it; if a total is ever needed, say which
definition it uses. Recommendation given to Mercy: drop the hero total tile and
lead with four unambiguous flows instead (each = one budget code).

**THE FOUR FLOWS (Mercy's framing, 2026-08-22) — the proposed page spine.**
Verified series 1997–2026, executed where it exists, revised for 2026:
- מסים = C881+C882 · אגרות = C883 · הכנסות אחרות = C884 · **חוב חדש = C886**
  (הכנסות למימון גירעון) · **ריבית = section 0045** · **קרן = section 0084**.
- The four + other sum EXACTLY to '0000' (2026: 553.82+11.50+21.64+263.63 =
  850.59bn). The approved budget also balances to the shekel: kinds 1+2+7+6
  (net_allocated) = 850,590,078,000 = kind 4. מפעלים עסקיים (104.57) is a
  separate self-balancing block on both sides.
- Story numbers: borrowing is 25–38% of all money coming in, and **46% in 2020**.
  Interest as a share of tax collection FELL 20.9% (1997) → 11.4% (2026) — the
  good-news counterweight — but in shekels it is climbing fast, 38bn (2019) →
  63bn (2026). Principal repaid: 37.5bn (1997) → 171.4bn (2026).
- Design mockup with the real data (approved palette, validated for CVD):
  https://claude.ai/code/artifact/334148ff-f6c5-412a-9b2b-748ea01f129a
  Charts: stacked columns (money IN, red = borrowed) + one line (interest as %
  of tax). NOT a pie — a pie can't show change over time and these four are not
  parts of one whole (two are inflows, two are outflows).

**Depth and span.** raw_budget = 1997–2026, 6,758–22,000 rows/year (~400k).
Code lengths 2/4/6/8/10 = root / סעיף / תחום / תכנית / **תקנה**; 2025 counts
9 / 99 / 366 / 640 / 5,772. index.html treats length>=8 as a leaf, so the
deepest layer (תקנה) is never openable today — one constant away.

**raw_budget has ~60 columns, we use 5.** Verified on 0020 משרד החינוך 2025:
net 89.8bn allocated → 96.3bn revised → 90.7bn executed; `total_econ_cls_*`
salaries 34.75bn, transfers 57.26bn, procurement 4.15bn, internal_transfers
142.3m (also: investment, credit, reserve, debt_repayment_interest/principal,
dedicated_income, income_bank_of_israel, income_grants, income_loans);
`personnel_*` = תקנים (2,776.5 budgeted / 2,541.7 executed);
`commitment_allowance_*` = הרשאה להתחייב (₪2.196bn — future years already
committed, almost nothing public shows this); `gross_*`/`dedicated_*`;
`contractors_*`; `covid19_expenses_*`; `func_cls_title_1/2`
(שירותים חברתיים / חינוך); `budget_kind_title`; `direction` (הכנסה/הוצאה);
`children`/`parent`/`hierarchy` pre-joined. budget_kind_title 2025:
תקציב רגיל 4,941 · פיתוח 938 · מפעלים עסקיים 660 · הכנסות המדינה 281 ·
החזר חובות 49 · רזרבות 17.

**History is ONE request** (Mercy's idea #4 needs no new source):
`SELECT year,net_revised,net_executed FROM raw_budget WHERE code='0020'` →
30 points, 18.1bn (1997) → 96.3bn (2025) → 99.2bn (2026 budgeted).
**2020 has no approved budget** — revenue comes back 0; any multi-year chart
must SAY תקציב המשכי there instead of drawing a cliff.

**Revenue exists, two ways.** (a) the C8 subtree in raw_budget: C881 מסים
ישירים · C882 מסים עקיפים · C883 אגרות · C884 הכנסות אחרות · C886 הכנסות
למימון גירעון; 189.9bn (1997) → 755.9bn (2025) → 850.6bn (2026).
(b) `income_items_data` — code,title,year,level,amount_allocated/revised/used,
functional_class, economic_class_primary/secondary, item_url; 1997–2026;
3 levels (2025: 50/81/144). 2024 amount_used by tax: מס הכנסה 231.9bn ·
מע"מ ברוטו 141.7 · מס קניה 26.7 · מס דלק 24.0 · מיסים על הוצאות שכר 15.8 ·
אגרות כלי רכב 5.9 · מס שבח 5.4 · תמלוגים 2.5 · מס רכישה 2.0 · מכס 1.8 ·
**מלוות פנים 224.3 · מלוות חוץ 54.1** — i.e. ~a quarter of "revenue" is
borrowing. Taxes vs borrowing on one screen = the deficit, explained.

**Other tables on the SAME API (no relay, no setup), verified live:**
- `budget_changes` — 19,127 rows, 2005–2026. Every in-year העברה תקציבית with
  the full explanation text, requester, committee, change type, from→to
  summary. This IS the gap between net_allocated and net_revised that the
  page already draws without explaining.
- `activities` (241 rows; `all_activities` 414, all kind=gov_social_service) —
  the social-services catalogue: plain-language description, **the budget codes
  it draws on**, beneficiaries per year, suppliers, tenders, target audience.
  Example: digital learning content → codes 0020630110/0020670…, 6,373
  beneficiaries 2025 (11,915 in 2024), ₪1.98m approved/executed, 28 suppliers.
  This is a big head start on Mercy's glossary idea — official, not our opinion,
  but only covers social services.
- `supports_data` — 329,589 rows 2004–2025 (תמיכות, named recipient + entity id)
- `contract_spending` — 1,036,112 rows. Year fields are dirty at the edges
  (min_year 1899, max_year 9999) — any year filter needs a sanity range.
- `procurement_tenders` (+ exemptions: reason, regulation invoked, documents)
- `government_decisions` — full decision text, office, unit, numbers, dates
- `muni_budgets` — 2010–2025 but **only 21 distinct authorities**. Real but
  partial; never present it as national coverage.
- 118 public tables in total (`information_schema.tables`) — also
  political_donations, government_companies, guidestar, entities, company_registry.

**Outside BudgetKey** (BudgetKey is ANNUAL — that's its main limit):
- OECD COFOG, VERIFIED working, no key: `https://sdmx.oecd.org/public/rest/
  data/OECD.SDD.NAD,DSD_NASEC10@DF_TABLE11,1.1/A.ISR...........?startPeriod=
  2021&dimensionAtObservation=AllDimensions&format=jsondata` (13 dimensions).
- Bank of Israel deficit/debt: dataflow `BOI.STATISTICS:PS(1.0)` via
  edge.boi.gov.il SDMX. Structure verified, CALL NOT TESTED; needs the host
  added to the worker allowlist + Mercy re-deploying.
- CBS price index (for real-terms figures): api.cbs.gov.il — docs verified,
  call not tested; reportedly REQUIRES a User-Agent header (Workers don't
  send one by default).
- דברי הסבר לתקציב (per-ministry booklets, the official "why"): PDFs DO fetch
  at `gov.il/BlobFolder/dynamiccollectorresultitem/{ministry}-proposal-2026/
  he/…pdf`, but the URL pattern CHANGED between 2025 and 2026 and the index
  page is an Angular shell — the listing must be captured from Mercy's DevTools.
- Monthly execution (חשב כללי, תקנה level, 2001→now, XLSX) —
  gov.il/he/Departments/DynamicCollectors/budget-execution-estimate and
  …/budget-execution-regulations. Files listed by JS; needs a DevTools capture.
- Knesset Finance Committee transfer requests: PDFs exist on fs.knesset.gov.il
  but there is **no OData entity** for them (KNS_DocumentCommitteeSession
  filtered on FINANCE = 0 rows), and fs./m.knesset.gov.il answer 474 to cloud
  fetchers. So we get MoF's numbers + reasoning, never the committee debate.
- Outside the state budget entirely (say so on the page): ביטוח לאומי (PDF
  only), local authorities, חברות ממשלתיות, קופות חולים, the classified
  defence annex + war supplements, קרן לאזרחי ישראל. State Comptroller has no
  API (SharePoint REST → 401) but stable PDF URL shapes, so a curated list works.

## FOUR QUESTIONS MERCY ASKED (2026-08-22) — answer before re-researching

She asked what a visitor would look for. Short verdicts; detail in the artifact.

1. **Salaries, PM → clerk: PARTLY, in three tiers that must never be blurred.**
   (a) Set in law, exact and named per OFFICE — נשיא 64,564 · רה"מ 55,812 ·
   שר 49,850 · סגן שר 44,176 · ח"כ ≈48,700 · ראשי רשויות 50,011–54,957 by
   population tier · judges by rank. Sources: Knesset compendium
   m.knesset.gov.il/Activity/Legislation/documents/salaries__benefits.pdf +
   משרד הפנים circular (gov.il, updated 5.2.2026).
   (b) Pay tables per ROLE/grade — gov-company CEOs 26,929–71,094,
   local-authority seniors 22,910–45,237, civil-service דירוגים
   (gov.il/he/departments/dynamiccollectors/genaral-managers-salary).
   (c) דוח הממונה על השכר — per BODY, anonymised (~800 bodies: headcount,
   positions, avg salary, avg employer cost) + a חריגות שכר report that names
   bodies. gov.il/he/Departments/DynamicCollectors/salary-supervisor-reports.
   **NOT available: named individual civil servants.** MoF collects a row per
   employee (name + ID) and publishes only aggregates; data.gov.il has nothing.
   One exception: the התנועה לחופש המידע court-ordered Excel naming 1,516
   gov-company executives 2023–24 (meida.org.il/17055) — a one-off, label it.
   ALL OF IT IS PDF — no API, no Excel annex. Tiers (a)+(b) are small enough
   to transcribe by hand once a year.
   **FREE ANSWER we already have:** total_econ_cls_salaries ÷ personnel_* on
   any raw_budget row = average cost per position, any unit, 1997–2026.

2. **Tax per city: THE TAX HALF IS IMPOSSIBLE — don't spend time on it again.**
   Verified by reading MoF's דוח הכנסות המדינה: revenue is split by tax type,
   decile, gender, employment status, level of government — **no geographic
   dimension at all**. No locality/district/נפה tax collection is published by
   anyone. Extra trap: corporate tax would attach to the registered HQ address.
   No Israeli body has ever published tax-paid-vs-received per locality; the
   closest study (IECA 11/2025) does it by decile for exactly this reason.
   **The other direction IS available and gives most of the insight:** own
   income vs government income per authority (data.gov.il org `interior_affairs`,
   audited statements 2018–2024; CBS קובץ הרשויות המקומיות), ארנונה
   residential/non-residential (nationally ₪31bn = 34% of local income),
   מענק איזון per capita + MoI מדד איתנות פיננסית ranking all 256 authorities
   (2023), תב"רים, NII benefits paid per locality (XLS), NII average wage +
   deciles per locality, CBS מדד חברתי-כלכלי.
   Frame the page as "כמה כסף ציבורי נכנס לעיר — ומאיפה", never "מי משלם ומי
   מקבל". ALSO SAY: central spending (roads, hospitals, bases) is not
   attributed to geography by anyone, and that gap systematically undercounts
   the periphery.

3. **Contractors: YES per contract, NO per item/hour.** `contracts_data` =
   779,202 rows with supplier name + entity_id + kind, purpose,
   purchasing_ministry, purchasing_method, volume vs executed (promised vs
   paid), per-year amounts, start/end, item_url — **and `budget_code`, which
   joins a contract to the exact budget line**. That join is the best thing in
   the whole dataset: click a תקנה → see who got paid from it.
   purchasing_method 2025 distribution: ~381k רכישה ישירה + large exemption
   blocks vs ~250k competitive tenders — a headline in itself.
   Unit/hourly prices exist only inside tender PDFs; not structured, don't
   promise them.

4. **One-time vs permanent: YES, three independent ways.**
   (a) budget_kind — 2025 summed at depth=4: תקציב רגיל ₪544.9bn ·
   **תקציב פיתוח ₪60.5bn** · מפעלים עסקיים ₪95.5bn · החזר חובות ₪213.7bn ·
   הכנסות ₪755.9bn · רזרבות 0. (Don't try to reconcile these to '00' — they
   net differently.)
   (b) economic classification: capital_expenditure / investment vs
   salaries / procurement / transfers.
   (c) הרשאה להתחייב — future years already committed = the signature of a
   project. `non_repeating` also exists (188 rows flagged in 2025) but its
   leaf-level semantics are UNVERIFIED — parents just aggregate children's
   values into an array.
   Label it **capital vs current**, not "one-time vs forever" — the
   development budget contains some recurring programmes.
