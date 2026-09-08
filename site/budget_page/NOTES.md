# NOTES.md — the budget SECTION (site\budget_page\)

Everything settled about THIS section: layout, the data model of raw_budget,
Mercy's rulings, the traps the tests arm. Shared front-end rules are in
`site\CLAUDE.md`; upstream API facts in `site\SOURCES.md`. Same
keep-it-current rule as CLAUDE.md.

SINCE 2026-09-08 THIS FOLDER HOLDS TWO PAGES, joined by a sub-header
(tabs: התקציב · ספקים והתקשרויות — Mercy's call: no new button in the main
nav, this is all part of תקציב; both pages keep `window.PAGE = "budget"` so
the main nav tab stays lit, and both load budget.css, which styles the
section, not one page):
- `index.html` — the budget (flows, debt, the tree, contracts per line)
- `contractors.html` — ספקים והתקשרויות (the top suppliers of a year, the
  free-text search that used to be a card on the budget page, and a
  per-supplier profile). See "THE CONTRACTORS PAGE" below.

Files (load order: ../shared/config → <page>.strings → ../shared/common →
<page>.data → <page>.view): `index.html` / `contractors.html` shells only ·
`budget.css` (both pages) ·
`budget.strings.js` / `contractors.strings.js` (window.PAGE + PAGE_STR, all
wording) · `budget.data.js`
(SQL for the budget tree/flows, the code-tree map, `state`, and
`loadContracts()` — since 2026-09-08 the contracts come from OUR OWN
database on Cloudflare D1 via the relay, `GET <PROXY>/contracts?code=…
&year=…&n=25`, worker v8; the `/data/paid/*` overlay era is over, see
"THE CONTRACTS NOW COME FROM D1" below) · `contractors.data.js` (the
contract_spending SQL) · `budget.view.js` / `contractors.view.js` (all DOM,
init at the bottom) · `test_budget.mjs` + `test_contractors.mjs`
(Playwright, mocked upstreams — to RUN
them Claude also needs `../shared/`, which the pages load and which carries
config.js since 2026-09-08).

## THIS FOLDER IS THE WHOLE PAGE (Mercy's rule, 2026-09-06; + shared\, 2026-09-08)

To change this page, a chat needs THIS folder plus `../shared/` and nothing
else (shared\ holds config.js too since 2026-09-08, so the pair also runs
the Playwright test). Everything
the page shows comes from a public API or from Cloudflare (via the relay);
nothing is read from disk. The only files outside this folder the page
touches are three shared ones it must NOT edit from here:

- `../shared/config.js` — `window.PROXY_URL`, the relay address. Read-only.
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


### THE CONTRACTORS PAGE — ספקים והתקשרויות (2026-09-08)

Mercy asked to take the חיפוש התקשרויות וספקים card off the budget page and
give contractors a page of their own, reached through a sub-header rather
than a new main-nav button. What the page is, and the rulings baked into it:

- Three doors into the same table, all BudgetKey's `contract_spending`,
  LIVE (the D1 ruling stands — no text index there, and the worker has no
  supplier endpoints): the top suppliers of a year · the moved free-text
  search · a per-supplier profile (totals, per-ministry breakdown, the 25
  largest contracts). A profile is addressable (`#s=<entity_id or name>`),
  so it can be sent to someone and the back button behaves.
- **The ranking's definition is the caption's first job.** "The top
  suppliers of {y}" = contracts IN FORCE in y (min_year ≤ y ≤ max_year),
  ranked by sum of VOLUME — the whole-contract figure, same number the
  reader sees, NOT what moved that year (BudgetKey cannot answer that;
  reports[]-differencing lives on the budget page against our D1). The hint
  says "היקף אינו תשלום" out loud, and warns that years near the present
  are partially reported.
- **Grouping is `COALESCE(entity_id, supplier_name::text)`** — entity_id
  is NULL on ~a quarter of rows and clumping those into one NULL supplier
  would invent a giant. Drill-down for a no-entity_id supplier matches
  `supplier_name::text = '<JSON.stringify(the array)>'` — VERIFIED
  2026-09-08 that the jsonb ::text form round-trips JSON.stringify exactly
  (spacing included), quotes-in-names too.
- **The years are dirty at BOTH edges** (1899 · 2099 · 9999 all live).
  A junk max means "open-ended" → the contract still counts as in force;
  a junk MIN would put it in force since 1899 → `min_year > 1990` is in
  every in-force filter (the test fixture arms a 50bn contract "running
  since 1899" that must never top a list). For DISPLAY both edges are
  clamped (`saneYear`, ≤ THIS_YEAR+20 — 2099 slipped past the old < 2100
  rule); never print a placeholder as a date.
- **Postgres SUM over only-NULLs is NULL, and stays a dash.** A supplier
  whose contracts never reported a payment gets — , not an invented 0 ₪.
  The mock mimics that semantics; don't "fix" it back to 0.
- `executed` here is BudgetKey's cumulative paid, which its ingest often
  drops from 2024 on — the paid column explains it can undercount and
  points to the budget page's per-line table (the merged D1 figures).
  The explainer card says the same, and why defence is absent entirely.
- Years span 2015..now (coverage counted live: 111,865 contracts in force
  2015 vs 2,873 in 2014); default year = last full calendar year. The
  top-of-year aggregation costs ~4s at BudgetKey — cached per year.
- The search query gained `entity_id` (to open profiles) and an explicit
  `LIMIT 25` (it leaned on num_rows only). test_budget.mjs now throws on
  ANY contract_spending query from the budget page — index.html has no
  business there since the search moved out.
- `test_contractors.mjs` (71 asserts): the mock projects every answer
  through the query's own SELECT list and throws on any expression it does
  not model — the honour-the-SELECT-list lesson, third outing. It also
  mimics Postgres SUM-over-only-NULLs (→ NULL, → a dash on the page).

### CONTRACTORS v2 — "raise questions, no opinions" (2026-09-08, same day)

Mercy: most readers give a table 10 seconds. The brief was to make the data
raise its own questions — surface what might be problematic — WITHOUT the
page holding an opinion. The device, as everywhere on the site: choose
which facts stand next to each other, phrase headers as questions, let the
reader supply the judgment. What was added, and the rulings:

- **The page opens with three tiles, not a table** ("כמה מהרכש עובר בלי
  תחרות?"): total volume in force · the share of it recorded as פטור ממכרז
  · the share held by the ten largest suppliers. Verified 2024: 210.4bn in
  force, 66.7bn = **31.7% carries "פטור ממכרז"** in its own record.
  **NOTHING IS COLOURED RED HERE** — an exemption is lawful, and colour is
  opinion; the budget page's red is for debt, not for this. The words and
  the question buttons carry it (the פטור explainer keeps the both-ways
  wording: lawful and documented / nobody else competed, citing the law).
- **THE METHOD FIELD IS DIRTY, SO THE COUNT USES THE RECORD'S OWN WORDS.**
  purchase_method (an array) carries currency codes ("ILS"), empty arrays,
  and contradictory combos ("מכרז פומבי"+"פטור ממכרז") — verified live. Any
  clean tender/no-tender taxonomy would be OUR judgment call. Instead one
  exact query counts contracts whose method text contains "פטור ממכרז",
  and the explainer says exactly that. Don't replace it with a bucket table
  without a ruling from Mercy.
- **The top list grew a second lens** (segmented switch): the same ranking
  restricted to exempt contracts — "מי מקבל הכי הרבה כשאף אחד לא התמודד".
  Same definition, one condition; the unfiltered list still always loads,
  because the concentration tile is computed from it (top-10 volume ÷ the
  tiles query's total; supplier count via COUNT(DISTINCT COALESCE(...))).
- **The exemption regulations are ranked by the money riding on them**
  ("באילו פטורים נעשה שימוש?"), verbatim as recorded — 2024 verified: תקנה
  3(16) רשות מקומית 30bn · 3(5) חברה ממשלתית 9.6bn · ספק יחיד 1.87bn over
  2,236 contracts. The field carries junk (an order number was seen in it):
  the query keeps only citations containing "תקנה", requires the contract
  itself to be recorded פטור ממכרז (the caption promises exempt contracts,
  so the query must too), and combos are shown joined, as reported, per
  the card's note.
- **The reporting gap is counted out loud under the top list**: suppliers
  with executed NULL **or 0** are "לא מופיע במקור ולו תשלום אחד" — 0 and
  NULL are the same statement here (BudgetKey's ingest writes 0 where the
  paid column was dropped; the מילגם lesson).
- **The defence absence is a card, not a footnote** ("ומשרד הביטחון?") —
  the approved wording, no size claims (procurement scale unverified).
- **The supplier profile draws a year-by-year chart.** Mercy doubted
  per-year numbers; the answer is a series with the SAME definition as the
  rest of the page — a contract counts, in full, in every year it is in
  force (generate_series over the span, min_year > 1990, clamped) — so the
  chart can never disagree with the tables. Validated live on three big
  suppliers before building: the series are stable and legible (דן's 2022
  franchise jump is plainly visible). The two youngest years are hatched
  (the budget chart's plan-year convention) and the caption says partially
  reported years "עשויות להיראות נמוכות מכפי שיתבררו" — the fade near the
  present is the reporting horizon, never a finding.
- Per-resident framing (Mercy's idea #7) was NOT built: it needs a live
  population figure and she rated it marginal; percent-of-total framing
  covers it. Revisit only with a trustworthy live source (CBS).
- **"מדוע פטור?" — the exemption's own publication (Mercy asked; added
  same day).** ~9% of exempt contracts carry a `tender_key` into the
  mr.gov.il exemptions register (3,822 of 41,180 in force 2024). Each
  tender_key element is a JSON **string** encoding [publication_id, type,
  tender_id]; type 'exemptions' joins `procurement_tenders` on
  publication_id (139,576 exemption publications; reason filled on ~102k;
  decision always; page_url always). The profile's contract rows show the
  button ONLY where a publication exists — never a column of dashes — and
  the popover prints description, reason, regulation, decision verbatim
  plus the mr.gov.il link, with a source line saying when the button
  appears. `explanation` and `manof_excerpts` on contract_spending were
  checked and are empty/near-useless — don't go back to them.

### WHY THIS PAGE READS BUDGETKEY AND NOT OUR D1 (Mercy asked, 2026-09-08)

Not a preference — a constraint, twice over: (a) worker v8 serves only
`/contracts?code=…`; there are no supplier or aggregate endpoints. (b) D1
bills every row read and has no text index, so a top-suppliers or method
aggregation there would scan the ~1M-row table per page view — the same
economics that kept free-text search on BudgetKey (the 2026-09-08 ruling).

THE MIGRATION IS STILL RIGHT, done properly: these aggregates change at
most quarterly, so the PIPELINE should precompute them at build time
(top suppliers per year · the tiles · the regulations ranking · per-supplier
series) into D1 tables or KV, and the worker should grow endpoints for them
plus a supplier-profile lookup (needs an entity_id index in build_sqlite.py).
Then this page serves OUR merged figures — better `paid`, one data story —
at snapshot speed. Needs `worker\` + `pipeline\` folders and a redeploy;
queued for after the polish pass. Until then: BudgetKey live, limits stated.

Also queued by Mercy (2026-09-08): unify the site's search bars (hers to
explore); link supplier names in the budget page's per-line contracts table
to contractors.html#s=<entity_id> (agreed, later).
- Relay trivia for future spot-checks: WebFetch-style fetchers get 403 on
  SQL-looking relay URLs (a WAF pattern, plain and /b64/ alike); the
  in-browser fetch to next.obudget.org works fine and is how everything
  above was verified.

### THE CONTRACTS NOW COME FROM D1 (2026-09-08) — read this before the older contract notes

The contracts table under a budget line reads the WORKER's D1 endpoint
(`/contracts?code=<line>&year=<y>&n=25`, worker v8), which serves the
pipeline's merged database: one deduplicated record per order — ministry
files + BudgetKey + the mr.gov.il registers, merged field by field. What
changed on this page, and why:

- `loadContracts()` is one fetch; the worker does the prefix join (on live
  allocations — a moved charge is not double-listed), the year filter (a
  contract with no known years is still EXCLUDED), the volume-DESC order and
  the limit. Field names are the database's: `supplier`, `ministry`,
  `method`, `exemption`, `volume`, `paid`, `first_year`/`last_year`,
  `sources`, `reports[]`.
- `reports[]` replaces BudgetKey's `payments[]`; each entry still carries the
  CUMULATIVE paid per published report (`paid_cumulative`), and
  `paidInYear()` still derives the per-year figure HERE, under the same
  refusal rules (zero-after-positive, gaps, restatements). The build dedupes
  a report published at two addresses; the zero trap is in the reports as
  published, so it survives the merge and the guards stay.
- **The `*` marking is gone.** `paid` is now the merged best figure (the
  ministry's file outranks BudgetKey on payment, per the pipeline's
  precedence table), so a per-row asterisk had nothing precise left to say.
  Instead every contract's פרטים popover carries a מקורות line built from
  the record's `sources` — the tags the build actually writes, verified
  against the live db 2026-09-08: file → "הדוח שפרסם המשרד", bk →
  "מפתח התקציב", tn/ex → the registers. Per-field provenance exists only
  in Mercy's local audit db — deliberately not public (2026-08-25 ruling).
- **A merged `paid` of 0 is a dash unless the ministry's own file is among
  the sources.** The build holds zeros back, so 0 means "every source wrote
  0" — credible from a ministry file (they write 0 when they mean 0),
  unknowable from BudgetKey alone (its ingest drops the paid column).
  `totalPaid()` encodes exactly that.
- **Free-text search STAYS on BudgetKey live**, deliberately: D1 has no text
  index, and an infix LIKE would scan ~1M billed rows per search. An FTS
  table is the day it moves.
- `attachReportedPaid()` and the `/data/paid/*` overlay are DELETED — that
  bridge existed only because BudgetKey read the paid column as 0. The
  full teardown (KV keys, publisher, workflow step) happened 2026-09-08 —
  `pipeline\CLAUDE.md`, section "THE PAID OVERLAY IS GONE".
- **THREE KINDS OF EMPTY (Mercy, 2026-09-08: "the readers should know").**
  An empty contracts list says WHICH empty it is. Empty for the chosen
  year but not overall → `noContracts` ("reported in other periods"; one
  extra n=1 request without the year tells them apart, cached by the
  worker). Empty at the source entirely → `noContractsAtAll`. And for the
  DEFENCE sections (0015, 0016 — `DEFENCE_SECTIONS` in budget.data.js) →
  `noContractsDefence`: the contracts exist, they are not public. Verified
  live 2026-09-08 before writing it: BudgetKey's contract table has ZERO
  rows under '0015'/'0016' (so the old page was just as empty — this is
  the source, not the D1 switch), while 0007 (משטרה/כבאות/שב"ס) answers
  normally. The wording claims only what was verified: defence procurement
  runs under separate exemption regulations and a partly classified
  budget; it does NOT claim whether the reporting duty legally binds the
  MoD. No opinions on the page — this is a fact about the data.
- test_budget.mjs mocks the WORKER (`/contracts`) instead of BudgetKey's
  contract_spending, hands back only the worker's columns (the old
  honour-the-SELECT-list lesson, same trap, new shape), and 404s any relay
  route it does not model. The worker's own SQL is tested in
  `worker\wtest_d1.mjs` against a db built by the real build_sqlite.py.

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
