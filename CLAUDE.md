# CLAUDE.md — project knowledge base

Notes from Claude to Claude (and Mercy) for future chats about this project.

## THE RULE THAT GOVERNS THIS FILE

Keep it honest and CURRENT. Whenever work in a chat proves a conclusion here
wrong, outdated, or incomplete — update or delete it in the same chat, and
date the change. A wrong "conclusion" is worse than none. This is distilled
knowledge, not a log: once a story is settled, keep the conclusion and the
lesson, drop the play-by-play. (Cleaned on this rule 2026-08-25, at Mercy's
request; the full history is in git.)

## START HERE — WHERE THE PROJECT STANDS (2026-08-25)

**Current focus: the contracts database.** The other fronts are parked in
good states: votes page done for now (own index, searchable history, one
queued fix — "THE REAL FIX STILL PENDING" below), budget page v4 live,
court page works. The sections from "THE CONTRACTS DATABASE" down to the
collection lessons are where the action is; everything after that is
reference for the other fronts.

**The immediate sequence, agreed with Mercy 2026-08-25:**

1. Mercy: commit+push; buy Workers Paid ($5/mo — her call: ONE bootstrap
   month, keep only if still needed at project end); run "collect
   budgetkey" in Actions, re-running until it reports nothing remaining;
   download the `budgetkey-raw` artifact into the project folder.
2. Claude: rebuild the dataset with all three sources → `contracts.db`
   (full, audit) + `contracts-public.db` (D1 upload).
3. One-time D1 bootstrap + worker endpoints (`/contract?id=`,
   `/supplier?hp=`). CALLS RULES: D1 bills rows READ — every endpoint must
   hit an index (a full scan on 513K rows costs 513K reads), Cache API on
   the worker so repeats never reach D1, LIMIT on every list endpoint.
4. ~~compare.html overhaul~~ **DONE 2026-08-25 — the audit tool is built:**
   - **`build-database.bat`** (root) → `tools/build_database.py`: the whole
     build on HER machine, one double-click — finds full-records.zip, the
     register JSONs (gunzips the .gz), budgetkey-raw.zip when it exists
     (loud NOTE when it doesn't), and produces `contracts.db` (full: audit
     + registers embedded, ~765 MB — too big for the bridge, hence local
     build) and `contracts-public.db` at the root. Needs python; the .bat
     says what to install if missing.
   - **`audit.bat`** (root) → `tools/audit_server.py`: stdlib http.server +
     sqlite3, serves site/ on :8081 plus read-only `/audit/*` endpoints
     (status · contract?id= · search?q= · register?pub= · random) from the
     FULL db. CORS open so serve.bat-served pages can reach it too. GOTCHA
     fixed: http.server decodes the request line latin-1 — Hebrew query
     args need the latin-1→utf-8 round-trip.
   - **`site/tools/compare.html` BUILD 2026-08-25a**: probes /audit/status
     (same origin, then :8081 — AUDIT === "" is same-origin, every check
     must be `!== null`, "" is falsy!). With audit.bat: the green column
     shows the record AS STORED (values + provenance labels straight from
     the db, locked against the client-side derivation), search goes
     through the built db first — **file-only contracts finally findable**
     (the old KNOWN GAP), with the BudgetKey column honestly saying
     "קיימת רק בקובץ המשרד" — two new register columns (מרשם
     הפטורים/המכרזים, raw mr.gov.il rows by publication), and the random
     button draws from OUR dataset. Without audit.bat: byte-for-byte the
     old behaviour (client-side merge, registers off, a hint explains).
   - Tests: `tests/cmp.mjs` (fallback mode, all green, untouched) +
     **`tests/cmp_audit.mjs`** (new): builds a tiny db with the real
     build_sqlite, runs the real audit_server, asserts the green column,
     the register columns, and the file-only-contract card.
**Folder cleanup 2026-08-25 (before her big commit), via `clean-up-2.bat`
(moves to _old_delete_me, never deletes):** FIELDS.md (superseded by the
.xlsx), tidy-up.bat (job done), tests/trail2.mjs (early draft of
test_budget.mjs), site/data/contracts/contracts.json (the old 2,455-row
experiment), the stray root report copy, portal-registers.zip (its JSONs
already live in the export folders), and the 456 MB extracted פלט
פטורים .xls (its exact copy stays in the 24 MB zip beside it). .gitignore
now also excludes the artifact zips and both databases — before this,
full-records.zip & friends would have been COMMITTED. Kept on disk:
full-records.zip (build input) and publications-register.zip (the archived
data.gov.il snapshot for the merge-time diff).

5. Wire the merge into refresh-data.yml (the reserved commented slot),
   restore the `budgetkey-` cache there, and apply the deferred
   `git pull --rebase` hardening to its commit step. CI-memory caveat:
   the in-memory merge of full BudgetKey (~1.5 GB JSON) may not fit a
   7 GB private-repo runner — measure, or make the merge per-section,
   before wiring.

Also queued: browser last-mile for reports gone from the whole internet;
merge-time diff of the data.gov.il snapshot vs the portal export (parse the
DD.MM.YYYY dates properly — newest_date() compares strings); report the
BudgetKey paid-column bug to הסדנא לידע ציבורי.

**Standing rules (Mercy's, non-negotiable):**

- **Files the running workflows use are FROZEN — new capability goes in NEW
  files.** (Origin-B drafts once touched pipeline files; all were reverted.)
- **Collect raw, keep sources separate.** The merge is a separate,
  re-runnable computation; raw is kept forever, so schema choices are
  reversible. No BudgetKey row ever stands in for a ministry file during
  COLLECTION — accepted last resort at MERGE time only, labelled, for
  reports gone from the whole internet.
- `.github/workflows` is write-protected via the device bridge → every
  workflow change ships as an installer: `install-*.bat` at the root +
  `tools/install-*.ps1` (ps1 saved UTF-8-BOM when it carries Hebrew; the
  YAML heredoc it writes must have NO BOM).
- refresh-data.yml's final `git push` fails if main moves during a run —
  push nothing while it runs. Workflows that commit nothing (all the
  collectors) can run anytime.

**How Mercy works (earned over many sessions):**

- She spots real problems fast and is usually right about the cause. When
  she says something is fundamentally wrong, stop patching and re-examine
  the model. Her questions found the ss:Index bug, the 3×-sum duplicate
  trap, and the full-reload waste; she rejected the static-shard workaround
  with "what is the correct way to do it?" — answer THAT question first,
  don't optimize for zero-cost cleverness.
- Never show a partial answer as if complete; a partial list is worse than
  a count, because the name someone is looking for is exactly the one cut.
- Verify against live data before claiming a fix (selftest.html for the
  site). WebFetch caches ~15 min — cache-bust with `?fresh=N`.
- Read-only probes only. An endpoint that MUTATES her data is never a probe.
- She runs .bat files happily, edits in Notepad, has NO node on PATH — keep
  setups zero-install and explain plainly. She is the product mind: present
  options, let her drive.
- Claude commits files via SendUserFile + device_commit_files. Her Chrome
  extension is NOT connected; she pastes logs and screenshots quickly.
  TODO.md tracks the roadmap. Claude CAN reach her public workers.dev relay
  for live schema probes (`/b64/<base64url>`; WebFetch URL ceiling ~248
  chars — keep probe SQL tiny).

## THE CONTRACTS DATABASE — CURRENT STATE (2026-08-25)

**Built at full scale, file+registers (BudgetKey pending):** 513,326
contracts (unique orders; 535,179 is the row count) from 52 sections of
.full.json + both mr.gov.il registers, 2m43s. 6.72M field-fills from the
files, 74,328 from the tenders register, 65,702 from exemptions. Currencies:
ILS 504,666 / USD 4,311 / EUR 2,013 / GBP 457 / CHF 236 — 8,660 non-ILS,
the מטבע field earns its keep. The .full.json inputs exist ONLY as the
refresh workflow's `full-records` artifact (repo is private → download from
the latest green run; 37.7 MB zip → 541 MB).

**Register-join reality: only 7% of ALL contracts carry a publication
number** (35,930) — the 54% measured on education was its NEWEST report;
whole ministries (בריאות, רווחה, בתי הסוהר, מנהל המחקר החקלאי…) never fill
the column, and the join cannot invent what a ministry never recorded. Of
those WITH a number, 62% join (22,456). announced filled 2,872 ·
starts_date 7,104.

**The schema constitution is `FIELDS.xlsx` (repo root, v2).** One row per
concept × the five sources (each source's own column name + measured fill),
explanation, recommendation, and Mercy's yellow החלטה column. It supersedes
FIELDS.md. Her rulings (2026-08-24/25): מספר הליך keep · הסברים והערות keep
· מטבע חשבונית DROP (measured: never differs from מטבע) · everything else
as recommended ("maybe drop more later"). Dropped along the way: שם אתר
(duplicate of the org name), the קבוצת רכש code (description kept), שם הסל
(20 real rows in 24,572), the השגות deadline (proceduralia).

**Corrected register measurements (post-ss:Index fix — replace ANYTHING
measured earlier):** נושאים 81% exemptions / 89% tenders (real topic tags,
KEPT) · תאריך תחילת/סיום התקשרות 57%/57% in exemptions — a real second
source for the contract period · מטבע 69% clean (USD 6,008 · EUR 2,465 ·
GBP 298) · היקף כספי 53%, all numeric · ח"פ ספק 62% · מספר הליך 18%
exemptions / 100% tenders · tender winners a real 98/24,572 — winners come
from the ministry files, not the register.

**`tools/build_dataset.py` implements FIELDS.xlsx v2** (still deliberately
unwired from workflows). Key mechanics:

- File columns resolved LOOSELY, cached per spelling (`_FILE_MATCHERS` /
  `file_view`) — ministries disagree on spellings across years; exact keys
  are a trap. מטבע is exact-match so מטבע חשבונית can't leak in.
- The registers are sources `ex`/`tn`, indexed by publication number,
  joined per contract through candidates: the file's מספר פניית פרסום
  first (SPLIT on non-digits — ~1 cell in 350 carries several numbers,
  comma-separated, and canon_id would weld them; "0" means none), then
  BudgetKey's tender_key. A multi-row publication prefers the row whose
  ח"פ matches the contract's. Register-only fields: announced (היקף כספי),
  procedure_id, approver, decision, publication_status,
  published/updated_date, documents_ref (a bare id, NOT a url — the site
  builds the link), topics, starts_date.
- `--budgetkey` accepts one JSON or the build/raw DIRECTORY. Output is
  sharded site/data/contracts/<sec>.json + index.json (section = code[:4],
  parse_report's own cut). LOUD refusals: a register that joins zero
  contracts, or a BudgetKey input that fills nothing, kills the build.
- `tests/test_merge.py`: 67 assertions on live-verified fixtures — pub
  651623 really is the מילגם tender (מכרז פומבי 7/7.2020, matching the
  file's purpose text) and 569574 the קריץ איגור exemption.

**The database is SQLite; D1 serves the public copy; updates are
INCREMENTAL.** Settled with Mercy in three exchanges: "are we gonna keep it
in Cloudflare?" → she rejected static-shard workarounds ("what is the
correct way?") → she caught the full-reload waste ("we only need to update
what's relevant") → and set "the audit is just for myself; compare.html is
only expected to work locally". So `tools/build_sqlite.py` makes TWO
databases from one build:

- **contracts.db (full, 469.9 MB)** — every field + per-field provenance +
  a sha256 fingerprint per contract. Stays local / artifact; compare.html
  reads it. `--delta-against last-month.db` prints new/changed/gone — ALL
  a monthly D1 update writes. The full 513K write happens once, at
  bootstrap (~1.7M rows incl. allocations).
- **contracts-public.db (234.6 MB)** via `--public` — NO provenance, no
  fingerprints; `sources`+`notes` kept (a reader is entitled to know which
  sources fed a contract). 13 low-cardinality text columns
  dictionary-encoded into one `strings` table (1,177 distinct strings
  replace all the repeated Hebrew; was 306 MB flat). A `contracts_v` VIEW
  undoes the encoding so worker queries read plain text (0.19 ms).
- Measured query speed on the real 513K: order_id lookup 0.1 ms; every
  מילגם contract by ח"פ (94 contracts, ₪4.3B) 0.5 ms. With an index, size
  is irrelevant to specific lookups.
- D1 facts (verified 2026-08-25): free = 500 MB/db, 5 GB/account, 5M row
  reads/day, 100K row writes/day. Paid $5/mo = 10 GB/db, 25B reads/mo,
  50M writes/mo. The public copy fits free today; BudgetKey's payments[]
  history may push it — next levers if needed: compact provenance is
  already out, reports table can live outside D1.
- gzip math: contracts.db → 74 MB; the JSON shards compress ~17:1. The
  756 MB contracts-out JSON is the build's intermediate, not a serving
  form — nothing hosts it.

## COLLECTION — WHAT RUNS ON ITS OWN, AND THE LESSONS (2026-08-23→25)

**Three workflows, all resumable, none collide** (only refresh-data
commits; installers at the repo root create them):

| workflow | when | what | output |
|---|---|---|---|
| refresh data | 1st monthly + manual | ministry reports: fetch (+wayback), parse, tests | commits site/data/paid + collection lists; `full-records` artifact |
| collect portal registers | 12th monthly + manual | mr.gov.il export zips → JSON (parser-version self-healing) | `portal-registers` artifact |
| collect budgetkey | 25th monthly + manual | contract_spending per section → build/raw | `budgetkey-raw` artifact, cache `budgetkey-` |

**Collection state (inventory 2026-08-24):** 1,734 report files, 552 MB,
77 publishers, 535,179 parsed rows. Remaining holes: ~444 wayback-untried
urls + ~170 real failures (most retryable; browser last-mile later), and
the BudgetKey side pending Mercy's first run. failed.json / unreachable.json
/ manifest.json are copied into site/data/collection/ every run. Repeated
budget-limited runs CONVERGE: manifest+cache skip everything already held,
so each run only chases what's missing.

**Origin B is fully automatic.** מינהל הרכש publishes the register exports
MONTHLY as dated zips on a news page
(mr.gov.il/ilgstorefront/he/news/details/230920201036) that answers a plain
server fetch. fetch_portal_registers re-reads the page every run (the
?context= token rotates — links are never remembered), converts via
parse_portal_export, skips collected months unless PARSER_VERSION bumped.
Proven live: CI output matches Mercy's manual export exactly. The
data.gov.il register copy is FROZEN at 2021-01-31 — pulled complete once,
retired to a merge-time faithful-copy diff; its workflow stays dormant.
Local copies on her disk: Tenders-07082026/ + Exemptions-07082026/ with
mr-tenders.json / mr-exemptions.json.gz (parser v2), gitignored.

**Format lessons (each cost a real bug):**

- Files are classified by BYTES, never extension: PK=xlsx, D0CF11E0=OLE2
  .xls (xlrd reads those — ministries used .xls into ~2020); a rejection
  prints the actual first bytes.
- The portal export lies twice: .xls extension over SpreadsheetML 2003 XML,
  and declaration utf-16 over utf-8+BOM bytes. parse_portal_export
  byte-patches a temp copy and STREAMS (456 MB).
- **The ss:Index rule:** SpreadsheetML OMITS empty cells; the next cell
  carries ss:Index="N" naming its true column. Ignoring it shifts every
  row with an empty middle cell LEFT — that put topic categories in the
  currency column, and Mercy's "was it ever not-shekel?" question exposed
  it. Cells are placed at declared positions; PARSER_VERSION=2; the
  manifest stores the parser version so old conversions are redone, never
  trusted.
- Register dates are DD.MM.YYYY with DOTS — a regex expecting slashes
  silently finds nothing.

**The wayback route and the blocks (run 1 + run 2, 2026-08-24):**

- web.archive.org recovers gov.il/foi.gov.il history:
  `https://web.archive.org/web/2id_/<url>`. Recovered files are stamped
  via:"wayback"+snapshot; a snapshot is final, fetched once; a good local
  copy is NEVER replaced by an older snapshot when its live url dies
  (keep-the-copy guard). Many "failures" are DEAD TWINS — the same report
  indexed under several addresses; failed.json marks them `covered_by`.
- The archive throttles steady clients and gov.il blanket-403'd the runner
  after three heavy sweeps in 48h — blocks are runner-targeted and
  TEMPORARY (the relay still fetched gov.il fine). Machinery answers:
  30s wayback timeout, direct downloads before any archive attempt,
  `--deadline-minutes 240` clean stop (step timeout-minutes 300), circuit
  breaker WB_REFUSALS_LIMIT=15 consecutive connection-level failures rests
  the archive for the run (a clean 404 is an ANSWER and resets it).
- **THE LESSON: space runs out.** At most one heavy run per day; better,
  let the monthly schedule drain the backlog. The manifest makes patience
  free. Do not conclude "blocked forever" from one run.

## COLLECTION PIPELINE — GITHUB ACTIONS (2026-08-23). Read before touching tools/

HOW SURE ANY OF THIS IS: lines marked **measured** were read from a live
source on the date given, and the query or file is named so you can repeat it.
Everything else is inference from a small sample — usually ONE ministry-quarter
(education 2025 Q1) — and should be treated as a working assumption, not a fact.
Today four of my confident conclusions were wrong; assume more are. If something
here contradicts what you observe, believe what you observe and fix this file.

Mercy set the frame and it governs everything below:

> "I want to have the dataset separated until we have everything. no picking
>  what we keep and what dont"

So the monthly job COLLECTS. It does not combine. `build_dataset.py` still
exists and its 35 tests still run, but nothing calls it — there is a comment in
`refresh-data.yml` where the step used to be. Do not wire it back in without
her, and do not judge the merge on a fraction of the data.

### FOUR THINGS RETRACTED TODAY — all were me deciding what mattered too early

1. **"The report URL is static except the date."** WRONG, and I built a whole
   calendar-walking design on it before checking. Education really is
   `.../BlobFolder/.../education_1_2025/he/education_1_2025.xlsx` and swapping
   the date really does work — Mercy verified that by hand. It does not
   generalise. Real URLs pulled from the API on 2026-08-23:
   ```
   .../BlobFolder/dynamiccollectorresultitem/answer1_143/he/חופש מידע רבעוןראשון 2019 - לפרסום (1).xlsx
   .../BlobFolder/dynamiccollectorresultitem/health_1/he/רבעון 4 - 2020.xlsx
   .../BlobFolder/dynamiccollectorresultitem/tourism_201/he/repository-of-answers_ministry-of-tourism_tourism_201.xlsx
   ```
   `health_1` looks like an item id rather than Q1, and `tourism_201` does not
   read as a year; filenames are free Hebrew text with spaces. This is three
   URLs out of a 300-row sample from one query, so the exact mix of forms is
   unknown — what it does establish is that the dated form is NOT universal, so
   addresses cannot be assumed derivable and have to be looked up. `walk_quarters()` / `probe_forward()` in `fetch_reports.py`
   still earn their place — they found education Q2 2025, which BudgetKey's
   index does not know about — but they are a supplement, never the source.

2. **`newest_per_publisher()` kept one report per ministry and discarded the
   rest** — 26 URLs found, 5 downloaded. The reasoning was that the payment
   column is cumulative so the newest answers the same question. Wrong twice:
   education's Q2 2025 file is 295 KB against Q1's 663 KB, so a LATER report can
   list FEWER contracts; and one snapshot cannot give a per-year figure, which
   needs the series. Now every reachable report is downloaded.

3. **`parse_report.py` threw away every row whose payment column was zero** —
   the `if paid <= 0: continue` sat ABOVE the code writing the full record.
   924 of education's 3,488 rows, gone with their ח"פ, full purpose and
   publication number. Fixed: `0020.full.json` went 2,557 → 3,481 records, and
   the merged count 2,455 → 3,342.
   **measured 2026-08-23, education 2025 Q1:** those rows are not blanks. The
   file has NO blank cells in either money column — 2,112 numbers and 747
   explicit `0.00` in the cumulative column, 1,576 and 1,912 in the period
   column, zero empties in both. The ministry writes 0 when it means 0. So a
   dropped row was not a silence we were tidying away, it was the ministry
   asserting "nothing was paid on this contract" — a fact, and one we were
   deleting. (Checked on ONE file; other ministries may not be as disciplined.)

4. **`fetch_budgetkey.py` selected 21 columns** — the ones today's merge happens
   to read, chosen during COLLECTION, before anyone had looked at the table, and
   not reversible without re-downloading a million rows. Now `SELECT *` minus
   `volume_per_year` / `executed_per_year` (rule 7), and it prints by name any
   column it left behind.

Also fixed: reports were parsed in ALPHABETICAL order by a shell loop, so an
older report could land last and roll a cumulative figure BACKWARDS — a wrong
number, not a missing one. `tools/parse_all.py` now sorts by the report's own
(year, period), oldest first, and passes `--source-url`, which the shell loop
never did (that is why `sources` was empty).

### WHY GITHUB ACTIONS AND NOT THE RELAY — every alternative measured

Mercy asked this directly and deserved a real answer. Tested 2026-08-23:

| route | result |
|---|---|
| this container → `next.obudget.org` | `Tunnel connection failed: 403` |
| container `curl` → `workers.dev` | connection refused (000) |
| WebFetch → relay, section-filtered `DISTINCT` (343 chars) | `PROXY_REJECTED 403` — URL too long, ceiling ~248 |
| WebFetch → relay, unfiltered `DISTINCT` (fits) | `Read timeout` |
| WebFetch → relay, **no DISTINCT + LIMIT** | **works, instant** |
| this desktop | no `device_bash` — files only, no shell |
| GitHub Actions | plain internet, no ceiling, no timeout |

So: `DISTINCT` over the ~4M-row report table is slower than the fetch timeout,
and the queries short enough to pass the URL ceiling are the ones that cannot
filter. GitHub Actions is not a preference — it is the only route of the ones above
that worked. There may be others nobody tried.
Non-DISTINCT probes through the relay ARE fast — use them for spot checks.

### WORKER v8 — `/preset/reports?sec=0020`

The old `reports` preset asked for `DISTINCT ON (publisher)` across the whole
table and **times out** (verified). Replaced with a section-filtered version,
and `digits()` strips anything non-numeric before it reaches SQL — that route is
open to the internet.

### MEASURED 2026-08-23 (do not re-derive)

- **measured** `quarterly_contract_spending_reports`: `min("report-year")`=2015,
  `max`=2026. So twelve years appear in the index; the workflow currently asks
  for five (2022–2026). Whether every year in between is well populated is
  untested.
- **measured** Sections are not ministries. `0001..0099` is a brute-force sweep
  of budget code prefixes. Three sections produced five publishers: 0020 → 1,
  0024 → 4, 0015 → nothing. The 0015 result is only for years 2022–2026; whether
  defence publishes under another section, or earlier, is untested.
- **measured** Discovery rows are not URLs: 88 rows for section 0024 were 11
  distinct URLs (rows are per url+publisher+year+period).
- **measured, one ministry-quarter** (education 2025 Q1):
  `0020.json` 111 KB / 2,557 orders ≈ 43 B per order;
  `0020.full.json` 4.0 MB / 3,488 rows ≈ 1.2 KB per row.
  **EXTRAPOLATED, not measured:** at those rates 945,088 distinct orders would be
  roughly 40 MB lean and ~1.2 GB full. One ministry is a thin basis — education
  may be unusually wordy or unusually terse. Re-check against the inventory once
  more ministries are in, and do not plan storage on this alone.
- A report with no publisher recorded produced `unknown_1_2024.xlsx`; a second
  nameless one would have overwritten it. Filenames now carry a URL fingerprint.

### WHERE THE DATA LIVES — superseded 2026-08-25

The 2026-08-23 static-files-vs-D1 deliberation is settled — see "THE
CONTRACTS DATABASE — CURRENT STATE" near the top (SQLite → D1, incremental
updates, audit db local). Still-true residue worth keeping:

- The per-section paid/<sec>.json files stay as the budget page's data —
  free, CDN-cached, no meter. `.full.json` never goes to the browser.
- GitHub: recommended max file 1 MB, enforced at 100 MB — why .full.json
  (241 MB/run) lives as an artifact, never in git.
- Actions cache: 10 GB per repo, entries evicted after 7 days unused.
- The repo is PRIVATE, so the public-repo 60-day workflow auto-disable does
  not apply — but artifact downloads need Mercy's login.

### STILL OPEN

- `contracts_data` is not collected (BudgetKey's orphan table: dotted budget
  codes, **no `order_id`** — can only contribute start_year/end_year,
  matched heuristically). Look at its shape before writing anything.
- `compare.html` still searches `contract_spending` first, so a file-only
  contract cannot be found in it — fixed by the queued overhaul (local
  audit server over the built db; see the sequence at the top).
- `worker.js` line ~66: `const BUILD_KEY = "rebuild"` in plain text gates
  `?reset=1`, which wipes the vote index. Private repo, but still a live word.
- Report the BudgetKey payment-column parsing bug to הסדנא לידע ציבורי.

## The vision (updated 2026-08-21, after extensive work with Mercy)

Mercy is building a bilingual (Hebrew RTL + English) transparency website
that makes the Israeli state LEGIBLE to ordinary citizens — money, laws,
votes, courts, people — with the connections between them as the real
product. Not a data dump: an explanation machine.

Core beliefs (hers, learned through iteration — respect them):
- **People over process.** "What an MK brought to the table" (bills proposed,
  even rejected) matters more than their votes. Accountability = outcomes
  (what changed under a minister, what a שאילתה answer SAID), not process
  metrics (how late the answer was).
- **The public shouldn't need to care about procedural chaos.** Bill
  name-histories, splits, legal spaghetti — that's lawyers' and politicians'
  jobs. Hide proceduralia; surface meaning.
- **Understanding, not instruction.** The laws pages exist so citizens grasp
  the overall state of an industry/topic — what's allowed, how it came to be,
  by whom — NEVER personal legal advice. Say so explicitly on the page.
- **The state's own documents are the source of truth** — link to official
  PDFs (fs.knesset.gov.il, court downloads), never re-host. We organize and
  explain; the state authenticates.
- **Explanation is the unique value.** Glossaries, "how a law is born",
  דברי הסבר surfaced, curated datasets (בג"ץ strikes) — editorial layers no
  official source offers.
- Minimal at first sight, depth one click away; one interaction language
  (rows expand down, search filters, every control always meaningful, honest
  empty/error states, freshness visible).

Big rocks (feature roadmap, Mercy-prioritized 2026-08-21):
1. **MK portfolio pages** — per politician: bills proposed (passed AND
   rejected — the rejected ones tell the story), their votes, positions held
   (KNS_PersonToPosition), and for ministers: what their ministry's budget
   did under them (connect to BudgetKey by ministry + term dates).
   Data confirmed: KNS_BillInitiator (+Ordinal: first = lead sponsor).
2. **Laws registry by topic** — KNS_IsraelLaw + classifications (topics like
   מקרקעין/תשתיות) + validity (תקף/בוטל) + IsBasicLaw + responsible ministry;
   linked via KNS_LawBinding to the bills/votes that made each law, and to
   the official PDF. "The state of the law in an industry, and how it got
   that way."
3. **The "why" layer** — surface דברי הסבר (explanatory notes, in the bill
   PDFs / documents table) so every law can answer "מה הייתה הנמקה".
4. **שאילתות as content** — the questions MKs ask ministers and the answers
   (the substance, not the latency).

Mercy has some tech experience: can follow clear steps, edits files in
Notepad; keep setups simple, explain plainly. She is the product mind —
present options, let her drive; she iterates fast on live pages.

## Architecture & files (2026-08-21, refactored)

Shared code layout (no build step; load order per page: config.js →
inline PAGE/PAGE_STR script → common.js → page script):
- `style.css` — design tokens (light+dark) + all shared components.
  Page-specific CSS stays in a small <style> block in each page.
- `common.js` — COMMON_STR + t()/applyLang()/toggleLang() (pages set
  window.PAGE, window.PAGE_STR, window.onLangChange for re-renders);
  buildChrome() injects header+nav into empty <header class="site"> and
  <nav class="tabs"> shells (PAGE picks the active tab); esc, isoDaysAgo,
  dateOf/fmtDate (handles ISO, /Date(ms)/, DD/MM/YYYY), PROXY,
  viaRelay(url, body?) (POST if body; 204→null), preset(name, params),
  fetchJson (direct, for CORS-open APIs), friendly(e), debug(msg).
- Adding a page: copy the shell, set PAGE/PAGE_STR/onLangChange, add a tab
  entry in common.js buildChrome().
- **votes.html is SPLIT (2026-08-22, Mercy's call — the single file had reached
  1,600 lines and was hard for both of us to edit):**
  `votes.html` layout shell only · `votes.css` page styling ·
  `votes.strings.js` (window.PAGE + PAGE_STR — all wording) ·
  `votes.data.js` (APIs, archive, index client, and `state`) ·
  `votes.search.js` (matching, plain + advanced search, paging, filter passes) ·
  `votes.view.js` (all HTML rendering, small interactions, and the init block
  at the bottom) · `votes.bills.js` (the whole second tab).
  Load order in the shell: config → strings → common → data → search → bills →
  view. They're plain scripts sharing one global scope, so cross-file calls just
  work; only the init block at the end of votes.view.js runs on load.
  NOTE: the page-size constant was renamed PAGE → ROWS_PER_PAGE, because
  `window.PAGE` (the nav tab id) was being shadowed by it.
  Same split is the obvious next step for index.html if it grows.
- `qa.html` — self-test page (PAGE="qa", not in the nav): runs live checks
  against every data source from Mercy's browser and prints a green/red report.
  It's the fastest way to ask "is the relay/dataset healthy?" — tell her to
  open it and screenshot rather than guessing.
- ~~`site/` is a DUPLICATE of the top-level files~~ **OBSOLETE 2026-08-22.**
  The duplicate is gone; `site/` IS the website and the only copy. See
  "FOLDER LAYOUT" near the top. Do not mirror anything anywhere.

## Older architecture notes (2026-08-20)

- `index.html` — budget/spending page (phase 1, WORKS live)
- `votes.html` — Knesset votes & bills (phase 2, partially works — see below)
- `config.js` — holds `window.PROXY_URL` (Mercy's Cloudflare Worker relay)
- `worker.js` — relay source; deployed by Mercy on Cloudflare (free plan).
  Allowlist inside it: knesset.gov.il, www.knesset.gov.il, next.obudget.org.
  If a new data host is needed, update the allowlist AND Mercy must re-paste
  the code in the Cloudflare dashboard editor and Deploy.
- Design system: dataviz skill tokens (light+dark, series blue #2a78d6/#3987e5);
  status green/red only for for/against/passed semantics, always with labels.
- Testing pattern: Playwright + mocked API routes (test_site.mjs,
  test_votes.mjs in the cloud workspace, executablePath /opt/pw-browsers/chromium).
  Claude's sandbox CANNOT reach gov APIs directly (egress blocked/robots) —
  layout is tested with mocks; live-data testing is done by Mercy in her browser.

## Data source conclusions

- **BudgetKey (next.obudget.org/api/query?query=SQL)** (2026-08-20):
  works, open CORS, no key. Table `raw_budget`: year, code, title,
  net_allocated / net_revised / net_executed. Codes: '00' root, 4-char =
  ministry/section, +2 chars per level down.
  **CORRECTED 2026-08-22 — this bullet was incomplete on both counts:**
  `raw_budget` has ~60 columns, not 5, and the code space holds TWO trees plus
  revenue (see "THE BUDGET DATA" section below). Values come back in WHOLE ₪
  (2025 total = 682799662000), so index.html's autoScale() resolves to ×1 —
  the ×1000 branch is a fallback for small subtrees, don't rely on it. Table
  `contract_spending`: supplier_name (jsonb-ish), purpose, publisher_name,
  min_year, max_year, volume, executed. Search with `supplier_name::text ILIKE`.
  Verified live by Mercy: data loads and looks right.
  FAILURE MODE (2026-08-21, seen live): when their Postgres is saturated the
  API returns HTTP 200 with {"success":false,"error":"…connection slots…"}.
  bk() in index.html now throws UPSTREAM:: on success:false → page shows a
  "temporarily overloaded" message instead of silent zeros. Transient.
- **Knesset OData ParliamentInfo.svc** (2026-08-20): works THROUGH THE RELAY
  (no CORS headers; blocks datacenter/bot fetches — Claude's sandbox and
  WebFetch get 4xx, Cloudflare Workers get through). KNS_Bill + KNS_Status
  verified live by Mercy: current, updates within days.
- **Knesset OData Votes.svc — CONFIRMED FROZEN** (2026-08-20, verified via
  relay): max vote_id 34525, vote_date 2021-07-13, Knesset 24. Header table
  `View_vote_rslts_hdr_Approved` fields verified: vote_id, knesset_num,
  session_id, sess_item_dscr, vote_item_dscr, vote_date, vote_time,
  is_accepted, total_for/against/abstain, session_num, reason.
  Per-member table is `vote_rslts_kmmbr_shadow` (NOT ..._shpn — that 404s!),
  fields verified: vote_id, kmmbr_id (zero-padded string "000000405"),
  kmmbr_name, vote_result (1=for 2=against), knesset_num, faction_id,
  faction_name. Useful for HISTORY (Knesset ~16–24), never for current votes.
- **Knesset WebSiteApi — the modern API, FULLY CRACKED** (2026-08-20, all
  verified live via relay). Base `https://knesset.gov.il/WebSiteApi/knessetapi/`:
  - POST `Votes/GetVotesHeaders` body `{"SearchType":1,"FromDate":"YYYY-MM-DD",
    "ToDate":"YYYY-MM-DD"}` → `{Table:[{VoteId, VoteProtocolNo, VoteDate,
    VoteDateStr, VoteTimeStr, VoteType, ItemTitle, KnessetId, SessionId}]}`.
    CURRENT data (verified votes from 2026-07-28).
  - POST `Votes/GetVotesHeaders` body `{"SearchType":2,"KnessetNum":25,
    "MkId":<id>}` → same shape, that MK's votes.
  - GET `Votes/GetVoteDetails/{voteId}` → `{VoteHeader:[{...Decision,
    ChairmanName, IsForAccepted, AcceptedText, FK_ItemID (= legislation
    ItemId!), SessionNumber, FK_Knesset}], VoteCounters:[{Title,
    countOfResult, ColorName}], VoteDetails:[{MkName, FactionName,
    VoteResultId (7=בעד), Title}]}`.
  - GET `Votes/GetVotesCmbData` → `{Knessets:[...], MKS:[{Id, Name,
    KnessetId, faction_id}]}` (MK directory, Knessets 16–25).
  - GET `MKs/GetMksDropdown?languageKey=he` → [{ID, Name, IsCurrent}].
  - POST `BillsLegislation/GetTableResults` body like `{"KnessetIDs":"25",
    "PageNumber":1,"RowsPerPage":10,"Sort":"d","Subject":""}` →
    `{lgsBillResults:[{ItemId, Name, Status, CommitteeName,...}], lawSteps,
    TotalResults}`.
  - GET `LegislationItem/GetLegislationBillItem?ItemId=<id>` → bill detail
    incl. sessionAndDocs.Sessions (VoteId/VoteSessionId often null).
  - Responses are Hebrew-only. 204 = empty search, NOT an error.
  - LESSON (recorded per the rule): the earlier conclusion "Votes controller
    is stub scaffolding" was WRONG — a 405-on-GET plus 204-on-empty-POST is
    how a real POST search endpoint looks; "GetMkVotes → 'value'" was the
    default route Get(id) answering, not the action. Confirm with a real
    payload before declaring an endpoint dead.
  - HTML pages (main.knesset.gov.il, /apps/*) are behind Radware bot
    protection ("kramericaindustries" challenge, status 247) — unreachable
    from relay/cloud; API endpoints pass fine. Frontend discovery must go
    through Mercy's browser (F12 → Network → Copy as cURL — she's good at it).
- **data.gov.il `votes-knesset` (resource 419be3b0-…) is NOT Knesset votes**
  (2026-08-20, verified): it's ELECTION results per polling station. Dead end
  for plenum votes; maybe useful someday for an elections page.
- **WebFetch quirk** (2026-08-20): mangles URLs whose query contains an
  encoded URL (?url=https%3A…) — always use the relay's /b64/<base64url>
  path form for probing. Claude's sandbox curl cannot reach workers.dev.
- **Vote duplicates are real**: each הסתייגות (reservation) on a bill gets its
  own plenum vote — same bill title appears dozens of times in one day.
  UI should eventually group votes by bill/sitting.
- **Supreme Court — WORKS via relay, no cookies needed** (2026-08-21):
  supremedecisions.court.gov.il, no bot protection. POST /Home/SearchVerdicts
  with the big JSON body (template captured; encoded in worker PRESETS.verdicts)
  → {"data":[…]} ~50 records/batch. Record fields: Id, CaseId, VerdictsDtString
  (DD/MM/YYYY), CaseNum, CaseDesc ('בג"ץ 7209-06-26'), CaseName (parties),
  Type (פסק-דין/החלטה), TypeCode, Pages, Technical (bool — false = substantive!),
  Path, PathForWeb, FileName, DocName (.docx), MadorDesc, InyanId, VerdictDesc.
  Document URL: /Home/Download?path={PathForWeb}&fileName={FileName}&type=2.
  GET lookups (no body): /Home/GetJudges?lan=1 → [{text,value,other}],
  GetInyans?lan=1, GetTypeCourts, GetMadors?lan=1, GetLastInyanim, GetQuotes.
  Also exists: GetHtmlPage (HTML view of a verdict — params not yet captured).
  Body dates: ISO with time. lan:1=Hebrew. Pagination beyond 50: not yet
  explored. History resources: HUJI ISCD (iscd.huji.ac.il), HF
  LevMuchnik/SupremeCourtOfIsrael (751k docs, ~2022 snapshot).
- **Snapshot store (worker v6)** (2026-08-21): the worker keeps our own
  dataset in Cloudflare KV (binding name `DATA`, namespace our-money-data;
  Mercy creates+binds it in the dashboard — worker.js header has the steps).
  GET /data/{budget|votes|bills|verdicts} → {t, stale?, data}. Cache-through:
  fresh KV → serve; stale/missing → rebuild from upstream, store, serve;
  upstream down + stale copy exists → serve stale (resilience). Cron
  `0 */6 * * *` refreshes all. TTLs: budget 12h, others 6h. 501 if DATA
  binding missing (pages then fall back to live). common.js `dataset(name)`
  unwraps the envelope + shows an "updated at" footer note; pages are
  snapshot-first with live fallback (court: text search always live;
  index: year-change + supplier search live; votes: drilldowns + MK search
  live). Verdicts snapshot = last 90 days, capped at 50 by the upstream
  batch size (pagination still unexplored).
- **Relay presets (worker v5)** (2026-08-21): the WebFetch proxy REJECTS long
  URLs (~>300 chars), so /postb64/ with big bodies fails — that's why the
  worker has /preset/<name>?params: it builds big upstream bodies itself.
  Existing: /preset/verdicts?from=YYYY-MM-DD&to=…[&q=text][&judge=id][&lan=1],
  /preset/votes?from=…&to=…[&type=1]. Add future canned queries as presets;
  site pages should call presets too (simplest client code).
- **CORRECTION to an earlier conclusion** (2026-08-21): the WebSiteApi `Votes`
  controller is NOT a scaffold stub. It's real and is the current votes API:
  POST /WebSiteApi/knessetapi/Votes/GetVotesHeaders with JSON like
  {"SearchType":1,"FromDate":"2026-08-20","ToDate":"2026-08-20"} (dates
  YYYY-MM-DD; empty result → 204 No Content, which I misread as a stub).
  Vote detail: the app GETs a URL ending in /<voteId> (e.g. 46699) — exact
  path prefix still unverified (/Votes/<id> returned 405 on GET; likely a
  different action name — capture pending). Other actions seen in DevTools:
  GetVotesCmbData, GetAllVotesDates. Old-style page (jquery) at
  main.knesset.gov.il/Activity/plenum/Votes/pages/default.aspx hosts this UI.

## FOLDER LAYOUT — REORGANISED 2026-08-22. The site/ duplicate is GONE.

```
NewsWebsite\
├─ site\            THE website, the only copy. Upload this folder to hosting.
│   ├─ index.html votes.html court.html config.js
│   ├─ shared\      style.css, common.js
│   ├─ budget\      budget.css/.strings.js/.data.js/.view.js
│   ├─ votes\       votes.css/.strings.js/.data.js/.search.js/.bills.js/.view.js
│   └─ tools\       qa.html, build.html, selftest.html, selftest.js
├─ worker\worker.js
├─ tests\test_budget.mjs, test_links.mjs
└─ README.md TODO.md CLAUDE.md
```

- **The old "edit the top level, mirror into site/" rule is DEAD.** There is one
  copy now. Any earlier note telling you to mirror files is obsolete.
- Path rules: pages at site root use `shared/…`, `budget/…`, `votes/…` and a
  bare `config.js`. Pages in `tools/` use `../shared/…`, `../votes/…`,
  `../config.js` AND must set `window.BASE = "../"` before common.js loads —
  buildChrome() prefixes the nav links with it, otherwise the tabs 404.
- `tests/test_links.mjs` loads all six pages, fails on any 404 and on any nav
  link that doesn't resolve. **Run it after touching the layout.** It found
  nothing on the move itself (18/18) but that's the point of having it.
- Claude on this device can WRITE files but has no delete/move tool, so the old
  flat copies could not be removed from here. `tidy-up.bat` was written at the
  folder root; it MOVES them into `_old_delete_me\` (never deletes). If that
  folder is still there in a later chat, ask Mercy whether she ran it.

## THE CONTRACT → BUDGET LINE JOIN (verified live 2026-08-22)

`contracts_data.budget_code` looks like **`04.52.02.13`**. To reach raw_budget:
**strip the dots and prefix `00`** → `0004520213` (a 10-char תקנה).
Its 8-char parent `00045202` = "המשרד לשיווק בחברתי" — which matches that same
contract row's `purchasing_ministry`, so the mapping is confirmed end to end,
not guessed. The naive readings both FAIL: `04520213` does not exist in
raw_budget at any year, and neither does `0452021300`.

Why it matters: this is the join that turns the tree from a picture into a
trail — click any budget line, see who was actually paid out of it. 779,202
contracts carry it. Do not lose this note; it took three probes to find.

CAUTION when building on it: contract years are dirty at the edges
(min 1899, max 9999), a code that exists in one year may not exist in another
(the sample above lives in 2018, not 2025), and `volume` vs `executed` is
promised vs actually paid — show both, never just one.

### USE contract_spending, NOT contracts_data (settled live 2026-08-22)

Both tables describe the same procurement reports. We use **`contract_spending`**
(1,036,112 rows). Mercy caught the reason: "I don't want to guess how much was
paid each year."

`contracts_data` columns: `budget_code, end_date, end_year, executed,
executed_per_year, is_active, item_url, order_date, purchasing_method,
purchasing_ministry, purpose, start_year, supplier_entity_id,
supplier_entity_kind, supplier_entity_name, volume, volume_per_year`.

- **`volume_per_year` is `volume ÷ number of years`** — verified 416,356.2 / 4
  = 104,089.05. A flat average wearing the name of a measurement. We shipped it
  for one round; do not bring it back.
- **`start_date` is 100% NULL in contract_spending**, `end_date` 32%. So
  contracts_data is the only place with a contract *period*
  (`start_year`/`end_year`, 99.6% filled) — but there is **no join key** between
  the two tables (`item_url` is an opaque hash, contracts_data has no
  `order_id`). We chose the real money over the real dates and label the years
  column `דווח בשנים` / "Reported in".

`contract_spending` gives, all verified live:

- **`payments[]` — the real per-year money.** One entry per published quarterly
  report: `{year, period, executed, volume, date, title, url}`. `executed` is
  **cumulative to that date** (checked across six contracts; it only climbs
  within a run). `url` links to the ministry's own .xlsx.
- **`exemption_reason`** — an ARRAY, empty for tendered contracts, carrying the
  regulation verbatim for exempt ones: `תקנה 3(1) - התקשרות ששווייה אינה עולה
  על 50,000 ש"ח`. `purchase_method` is also an array and also names a
  regulation (`תקנה 1ב - מכרז פומבי רגיל`, `תקנה 14ב - מכרז מרכזי`).
  **An earlier note here said we do not have the regulation. That was wrong** —
  it was absent from contracts_data, and I generalised from one table.
- **`budget_code` is ALREADY the budget's own 10-digit code** (`0008510313`).
  `budget_code LIKE '<code>%'` is the entire join — no dotted translation, and
  it catches every descendant line for free.

### WHERE THE CONTRACT DATA COMES FROM, AND HOW FAR TO TRUST IT (2026-08-22)

**Chain of custody.** Each ministry publishes a quarterly procurement report —
an .xlsx on foi.gov.il or gov.il, titled like `דוח התקשרויות רבעון 1 שנת 2020-
רשות האכיפה`. The obligation comes from a government procedure of 15 Dec 2015,
on top of חוק חובת המכרזים ותקנותיו. BudgetKey (next.obudget.org), run by
**הסדנא לידע ציבורי**, scrapes those files into
`quarterly_contract_spending_reports` (one row per contract per report, with
`report-url`, `report-year`, `report-period`, `revision`), then groups them by
contract into `contract_spending` (the `payments[]` array IS those report rows).
`contracts_data` is a further-processed view of the same material.
**So both contract tables trace to the same origin: the ministries' own
quarterly reports.** They are NOT independent sources, and agreement between
them is not corroboration. `raw_budget` is a different source entirely — the
state budget from the Ministry of Finance — so contracts and budget lines
genuinely are two witnesses.

**Trust.** The publisher itself documented the quality problems in a 2016
position paper, and every one of them is still visible in the data today:
suppliers keyed by internal codes rather than registration numbers, placeholder
values like `1111`/`9999` where a reference number belongs (this is where our
junk years come from), and thousands of records filed as `אחר` or blank against
a closed statutory list of methods. Counted live 2026-08-22 over 1,036,112 rows:
`אחר` 69,605 + blank 18,248 = **8.5% with no real purchasing method**.
`פטור ממכרז` is **521,840 = 50.4%** of all contracts. Every row does carry a
`budget_code` (0 nulls), so nothing is orphaned from the tree.

**Cross-reference, actually run.** Budget line `51.07` / `005107`:

|                     | contracts | volume         | executed       |
|---------------------|-----------|----------------|----------------|
| `contracts_data`    | 2,609     | 5,403,754,088  | 1,673,398,970  |
| `contract_spending` | 2,775     | 5,466,965,003  | 1,691,964,934  |

**They do not match.** `contract_spending` holds 166 more contracts (+6.4%),
₪63.2m more volume (+1.17%) and ₪18.6m more executed (+1.11%). `contracts_data`
is the narrower, more filtered view. Neither is wrong; they are two crops of
one source. Never present a figure from one as confirming the other.

**Per CONTRACT, though, they agree exactly.** Supplier 512738634
(א. שמיים קבלנות): `contracts_data.supplier_entity_id` → 164 rows,
`contract_spending.entity_id` → 164 rows, and the five contracts checked
field-by-field matched to the agora, including an oddity both carry
(`שינויים והתאמות בינוי`, volume 512,309.20, executed 512,**314.92** — paid
₪5.72 more than the contract was worth). So `contracts_data.executed` looks
like `contract_spending.executed` copied through. The row-count gap is about
which contracts each view keeps, not about different money for the same one.
**Match on `entity_id`, not `company_id`** — `company_id` is filled on only
782,252 of 1,036,112 rows (75.5%) and quietly returns a fraction of a
supplier's contracts.

### THE PER-YEAR NUMBERS DO NOT ALWAYS SUM TO THE CONTRACT TOTAL

Four contracts of the same supplier, per-year figures derived by `paidInYear`
against the contract's own `executed`:

| contract | per-year figures | sum | `executed` |
|---|---|---|---|
| שינויים והתאמות בינוי | 2017: 421,200 · 2018: 91,114.92 | 512,314.92 | 512,314.92 ✓ |
| רמת גן — מדור בטיחות אש | 2017: 259,999.74 · 2018: 93,802.68 | 353,802.42 | 353,802.42 ✓ |
| הצבת דלת מקשרת | 2017: 4,377.72 · 2018–20: 0 | 4,377.72 | 4,377.72 ✓ |
| פינוי פסולת קצא״א | 2016: 0 · 2017: 206,419.64 · **2018: —** · 2019: 0 | 206,419.64 | **87,688.04 ✗** |

The last one was **restated downward mid-life**: volume 249,803.80 → 304,381.61
→ 104,988.54, and executed peaked at 287,081.10 in 2018 Q2 before the Q3 report
re-filed the whole contract at 87,688.04. Our 2018 cell correctly shows a dash
(the difference is negative), but that means the years no longer add up to the
total, and the total itself is the LAST report's figure, not the peak.

**Rule for the contractors deep-dive page: never total the per-year column and
present it as what a supplier was paid.** Use the contract's own `executed` for
totals, and the per-year figures only as per-year figures. If a page ever shows
both, it has to say why they differ.

### ONE ORDER, SEVERAL ROWS — NEVER SUM THEM (2026-08-23)

Mercy searched order **4501119831** and got three identical-looking rows, only
one of which matched our ministry file. All three are ONE contract —
"עריכת מרכז שמירה ואבטחה", אגוד הייעל, ordered 2015-11-04:

| budget_code | volume | executed | min_year |
|---|---|---|---|
| 0020400312 | 13,326.3 | 7,359.3 | 2015 |
| 0020400312 | 13,326.3 | 7,359.3 | **null** |
| 0020600138 | 13,440.2 | **0.0** | 2015 |

Three separate things are visible in those three rows:
1. **The charge moved between budget codes.** BudgetKey keeps a row per code.
2. **One code appears twice**, and the twin has no dates or years at all — the
   `min_year IS NOT NULL` filter on the budget page already drops it.
3. **The parser bug again**: the ministry's current file records ₪7,359.3 paid
   under 0020600138, where BudgetKey has 0. The payment survives in BudgetKey
   only under the OLD code.

**Summing those rows gives ₪40,092.8 for a ₪13,400 contract — 3× the truth.**
Across the table, `count(1) − count(distinct order_id)` = **91,024** surplus
rows (8.8% of 1,036,112). Whether each is a legitimate multi-code split or a
straight duplicate cannot be told apart cheaply — the
`count(distinct (order_id, budget_code))` version times out.

RULE for the contractors page and any total: **aggregate by order, not by row**,
and where an order spans codes decide deliberately whether that is one contract
(it is) or several (it is not).

compare.html now warns in the status line when one order returns several rows,
and when the ministry file has no entry for `order:code` it falls back to the
order alone and SAYS the code differs (`בקובץ ההזמנה רשומה תחת תקנה …`) rather
than matching silently. `tests/cmp.mjs` drives the real three-row case.

### DEDUPLICATION: THE KEY IS RELIABLE, THE PROBLEM IS SNAPSHOT vs PILE (2026-08-23)

Mercy: "the biggest problem is how to remove the duplicates — ideally we'd use
הזמנת רכש, but we established we don't always have that number." **We do.**
Measured, not assumed:

- `contract_spending`: **0 rows** with a null or empty `order_id`, out of
  1,036,112 → **945,088 distinct orders**.
- the education .xlsx: **3,488 of 3,488 rows** carry `הזמנת רכש` (100%).

The order number is missing only from `contracts_data` (no such column) and
data.gov.il — and neither is the payment spine. So the key is fine.

**The real problem is that one order legitimately has several allocations, and
BudgetKey also keeps stale ones.** Two cases that look identical and are not:

*A genuine split* — the ministry's OWN current file lists order 4501798654
twice, under 20670205 (₪351,391,340.8) and 20670211 (₪3,915,400.05). Different
amounts, both current. **These must be summed.** 110 of the file's 3,342 orders
are like this, always across two different תקנות.

*A code move* — order 4501119831 appears in BudgetKey under 0020400312 (twice)
and 0020600138, at ₪13,326.3 and ₪13,440.2. The ministry's current file lists
it **once**, under 20600138. The other code is where the charge used to sit.
**These must not be summed** — it would double a ₪13,400 contract.

Nothing in a single row distinguishes the two. What distinguishes them is
WHERE the rows come from:

> **The ministry file is a SNAPSHOT — self-consistent, one row per allocation
> that exists as of that quarter. `contract_spending` is a PILE — every
> allocation ever reported, including codes long since abandoned.**

So the dedup rule is structural, not a heuristic:

1. **Spine = `order_id`.** One contract, one order number.
2. **Allocations = the (order, code) rows of the NEWEST ministry report.**
   Sum within an order; that is the contract's real size.
3. A BudgetKey (order, code) row absent from the newest file is **historical** —
   keep it, label it, never add it to a total.
4. Exact twins (same order, same code, same amounts) collapse to one; where one
   twin has no dates and the other has them, keep the dated one.
5. Where we have no file for that ministry yet, BudgetKey is all we have — so
   totals for those sections carry a known upper-bound error and must say so.

This is the strongest argument yet for collecting the files: without a
snapshot there is no principled way to tell a live allocation from a dead one.

### data.gov.il HAS NO ORDER NUMBER — it is not part of the dedup (2026-08-23)

Asked directly: does the register carry `הזמנת רכש` too? **No — neither dataset
does**, so it can never be keyed or deduplicated by order.

`exemptions` (165,705 records, 23 fields): `מספר פרסום · שם המשרד · שם יחידה
מפרסמת · סוג הליך · מספר הליך · שם הליך · לינק לטקסטים · תקנה · סטטוס · מהות
החלטה · גורם מאשר · תאריך פרסום · תאריך עדכון · תאריך אחרון להגשת השגות · שעה
אחרונה · שם ספק · מספר חפ ספק · היקף כספי · מטבע · תאריך תחילה · תאריך סיום ·
נושאים`

`tenders` (14,205 records, 18 fields): the same shape plus `שם הסל` and
`שם ספק זוכה`.

**No order number. No budget code. No amount paid.** Its only join keys are
`מספר פרסום` and the supplier's `מספר חפ ספק`.

**Join coverage is TWICE as good from the ministry file as from BudgetKey:**
- BudgetKey `tender_key` → 247,141 of 1,036,112 contracts = **23.9%**
- the education .xlsx `מספר פניית פרסום` → 1,884 of 3,488 = **54.0%**
  (10 of those carry several numbers, comma-separated — parse accordingly)

And ~180k publication records against 945k orders means most contracts will
never have one: publication is required only above thresholds and for certain
procedure types. 54% is close to the ceiling, not a gap to close.

**So its role in the combined dataset is NOT payments and NOT identity — it is
AUTHORISATION.** Who approved it, under which regulation, when it was
announced, the objection deadline, and a link to the texts. Plus the one
comparison nothing else supports: **announced amount (`היקף כספי`) vs contracted
volume vs actually paid** — three numbers from two independent origins.

### THE MERGE SPEC — column by column, not row by row (settled 2026-08-23)

I proposed "BudgetKey is the spine, the file overrides it". **Mercy rejected it,
correctly:** "if we have a contract in the file and not in BudgetKey we'll
ignore it? or the other way around? we can't just take this row from here and
that row from there — we need to go column by column and complete them as best
we can, starting of course with the order_id."

A spine model silently drops whatever the spine lacks. The model is:

1. **UNION of orders.** Any `order_id` present in ANY payment source is a
   contract. Neither source gets to decide the population.
2. **Every FIELD resolved on its own**, in that field's own order of
   trustworthiness, and stamped with which source won.
3. **Allocations hang off the order** (see the dedup section): the newest
   ministry report decides which (order, code) pairs are live.

Per-field precedence, with the reason each order is what it is:

| field | order | why |
|---|---|---|
| ספק | cs → ours → qr → ex | BudgetKey normalises spelling variants to one `entity_id`; a supplier page is impossible without that |
| מספר ח״פ | **ours** → cs → qr → ex | the file is 100% filled, BudgetKey's `company_id` only 75.5% |
| קוד ספק | ours → cs | |
| סוג גוף | cs → cd | only BudgetKey resolves it |
| משרד | cs → ours → qr → ex | |
| יחידה רוכשת | ours → cs → qr → ex | |
| תקנה תקציבית | cs → ours → qr | BudgetKey's is already 10-digit |
| שם התקנה | cs → qr | the budget line's name |
| שם פריט התחייבות | ours | a DIFFERENT thing from שם התקנה — do not merge the two, an earlier version wrongly did |
| מטרה | **ours** → cs → qr | BudgetKey truncates; the file has the full text |
| אופן רכישה / תקנת הפטור | ours → cs → qr → ex | |
| היקף · שולם | **ours** → cs → qr → cd | BudgetKey drops the payment column on newer reports |
| שולם בתקופת הדוח · סכומי אופציה | ours | the file alone has them |
| תחילת התקשרות | **cd** → ex → cs | `contract_spending.start_date` is 100% NULL |
| סיום התקשרות | ours → cd → cs → ex | |
| מספר פרסום | ours → cs → ex | the file links at 54%, `tender_key` at 24% |
| אישור, גורם מאשר, לינק לטקסטים | ex | only data.gov.il |

Mercy on data.gov.il: *"it will only be used when both possible and needed to
complete missing data from our other sources."* Hence it is last in every row
where anything else can answer.

**IMPLEMENTED 2026-08-25 in `build_dataset.py`** — this table, with the
registers appended as sources `ex`/`tn` where FIELDS.xlsx names them, and
new register-only rows (announced, approver, decision, statuses, dates,
topics, procedure_id, documents_ref). The spec's older live rendering, the
green המאגר המאוחד column in `tools/compare.html`, predates the build —
the queued overhaul makes compare.html read the BUILT db instead of
re-deriving.

**KNOWN GAP:** compare.html searches `contract_spending` first, so a contract
that exists ONLY in a ministry file cannot currently be found. The union is
specified but not yet implemented in the tool — the build script must not
inherit that shortcut.

### THE BUILD SPEC — Mercy's eight rules, and the schema (2026-08-23)

Her words, and what each one means in code:

1. **Collect all the relevant files.** 82 publishers, EVERY report each —
   "newest report each" was wrong, see COLLECTION PIPELINE (2026-08-23).
2. **One combined database, relevant data only.**
3. **Decide which data points we care about** — the schema below.
4. **Fill every cell that any source can fill.** Empty only when nothing has it.
5. **0 and empty are different — and a 0 must never win over a number.**
   Implemented as the zero rule: for money, zeros are held back and used only
   if no source anywhere reports a figure. משרד החינוך's file says
   ₪235,298,429 where BudgetKey says 0; the number wins.
6. **One format per kind.** `2015-11-04` · `2015-11-04 00:00:00` · `04.11.2015`
   · `20151104` all become **`2015-11-04`**. A bare `2015` stays a year.
7. **NO computed averages.** `volume_per_year` / `executed_per_year` are the
   lifetime total divided by the number of years. They never enter the
   dataset. If we have no report for a year, that year is EMPTY.
8. **Missing is not zero.** Never substitute a default. The tool words them
   apart: `אין נתון באף מקור` vs `0 — כך דווח בכל המקורות`.

**SCHEMA — store reports, not years.** The question "a column per year, or its
own dataset?" resolves to neither: keep what was actually reported.

    contract                       keyed by order_id (945,088 of them)
      identity   supplier · ח״פ · entity_id · kind · purpose · method ·
                 exemption regulation · publication number   ← merged per field
      allocations[]                one per LIVE budget_code
                 code · volume · paid · source · report vintage
      reports[]                    one per published report, AS REPORTED
                 year · period · volume · paid_cumulative · url · source
      provenance                   which source won each field

A per-year COLUMN would force us to answer "how much in 2023?" for every
contract — and we proved that is a derivation (difference of two cumulative
figures) which is often unanswerable: reporting gaps, restatements, and the
zero problem. Storing the reports as reported loses nothing, and "paid during
year Y" is computed at display time under the agreed rules, returning EMPTY
when it cannot be computed. That is rule 7 applied to the schema itself.

A wide year-by-year CSV can still be exported for humans — clearly labelled as
derived, with empty cells left empty.

**CADENCE — monthly.** Not quarterly. Evidence:
- reports are quarterly, but published with a lag: the Q4-2024 education report
  carries `report-date` 2025-04-07, about three months after the quarter closed
- **reports get REVISED** — `revision` runs 0 to 2 across the table, so a report
  we already parsed can change underneath us
- 82 publishers do not publish in step

Quarterly checking would align with the publication rhythm and miss both the
late publishers and every revision. Monthly is cheap if the job compares the
report URL and its size/ETag first and only re-downloads what changed. Plus a
manual trigger for when we want it now.

### tools/build_dataset.py — the merge, in code

The eight rules server-side; fixtures are contracts verified live (מילגם
4502539235, אגוד הייעל 4501119831), real values, no invented numbers.
CURRENT STATE (schema, registers, 67 tests, full-scale numbers) is in
"THE CONTRACTS DATABASE" near the top — this section keeps only the rules
the code carries.

Output per contract: merged fields · `provenance` (which source won each
field) · `allocations` (live budget codes, per the ministry's snapshot) ·
`historical_allocations` (codes BudgetKey still carries that the file has
dropped) · `reports` (as reported, one per quarter).

**A BUG THE REAL DATA CAUGHT, again.** `_reports()` first deduplicated on
(year, period, **url**) — and the same report is published at BOTH foi.gov.il
and gov.il, so every quarter was counted twice. Keyed on (year, period) alone
now, keeping the larger cumulative figure where a period repeats, since the
source carries `revision` 0..2 and the later revision is the bigger one.

RULE: **the url is not part of a report's identity.** Two addresses, one report.

### gov.il ANSWERED — the collector exists (2026-08-23)

Mercy deployed the worker; two calls settled it:

| url | result |
|---|---|
| `www.gov.il/BlobFolder/…/education_1_2025.xlsx` | **200 · 679,714 bytes** — the exact size of the file on her disk |
| `www.gov.il/BlobFolder/…/health_3_2024.xlsx` | **200 · 1,802,611 bytes** |
| `www.gov.il/he/departments/ministry_of_education` | **403** · a 5,679-byte HTML wall |
| `foi.gov.il/sites/default/files/EngagementReports_18_4.xlsx` | **403** · a 5,682-byte HTML wall |

**gov.il's BlobFolder serves files to a server. gov.il's PAGES and ALL of
foi.gov.il do not** — and that second 403 nearly went unnoticed, because I
tested one host and generalised. Again.

**Reports MOVED HOSTS over time.** foi.gov.il holds the older archive,
BlobFolder the recent ones — משרד הבריאות is on foi.gov.il for 2018 and on
gov.il from 2022 onward. Since we want each ministry's NEWEST report, and the
paid column is cumulative over the contract's whole life, the reachable copy
is the one we need. The archive being blocked costs us history, not the
current picture.

URL SHAPES DIFFER between ministries: education and health use
`<slug>_<quarter>_<year>`, the foi.gov.il archive uses `EngagementReports_18_4`
and Hebrew filenames. `filename_for()` matches the first and falls back to
publisher+quarter+year for the rest.

`/preset/reports` (DISTINCT ON over ~4M rows) **times out**. Discovery is
therefore per budget section, which is indexed and returns instantly:

    SELECT DISTINCT "report-url", publisher, "report-year", "report-period"
    FROM quarterly_contract_spending_reports
    WHERE budget_code LIKE '<section>%' AND "report-year" = '<year>'

`tools/fetch_reports.py` — discovery, download, wayback recovery.
(~~One report per ministry~~ — RETRACTED, see retraction #2 above: EVERY
reachable report is downloaded; the paid column restates, and a later
report can list fewer contracts.) It refuses to save anything that is not
a real spreadsheet: bytes decide (PK=xlsx, OLE2=.xls accepted since
2026-08-24), a block page written to disk with an .xlsx name would be
parsed as an empty ministry. Only files whose size changed are
re-downloaded; foi.gov.il-only urls go through the wayback route.

A TEST CAUGHT A DESIGN FLAW before it shipped: the skip check recomputed the
filename instead of reading it from the manifest, so any change to the naming
rule would have made all 82 files look missing and re-downloaded the lot. It
trusts `manifest[url].file` now.

`.github/workflows/refresh-data.yml` — **monthly** (03:17 UTC on the 1st)
plus a manual trigger: fetch (wayback input, --deadline-minutes 240) →
parse → tests → commit only if something changed. The merge step is the
reserved commented slot (wiring day). Tests gate the commit.

The reports themselves live in the Actions cache, not the repo: they are build
inputs, and 82 spreadsheets a quarter do not belong in git history.

### THE TWO TRAPS IN `payments[]` — both live, both cost real money if ignored

1. **The same report is published twice** (foi.gov.il and gov.il), identical
   year+period. Not deduped, every quarter counts twice.
2. **From 2024 on, `executed` is widely reported as 0** beside a volume that is
   still there. A contract reading 144,719,601 in 2024 Q2 does not read 0 in Q3
   — the field stopped being filled. **Never read that as a refund.** The page
   refuses to answer instead, and prints a dash.

**RESOLVED — AND IT IS A BUDGETKEY PARSING BUG, NOT A REPORTING FAILURE
(2026-08-22).** Mercy found ₪235,298,429.36 in משרד החינוך's published report
where our page showed ₪0. We opened the file itself
(`repository-of-answers_ministry-of-education_education_1_2025.xlsx`, 3,488
contracts) and compared it row by row with BudgetKey:

| order | file `ערך ההזמנה` | BudgetKey `volume` | file `ב. חשבוניות מצטבר` | BudgetKey `executed` |
|---|---|---|---|---|
| 4502539235 | 409,961,432.74 | 409,961,432.74 ✓ | 235,298,429.36 | **0.0** |
| 4502375451 | 625,220,980.61 | 625,220,980.61 ✓ | 502,853,054.58 | **0.0** |
| 4502377462 | 654,547,036.04 | 654,547,036.04 ✓ | 424,342,513.76 | **0.0** |
| 4501798654 | 351,391,340.80 | 351,391,340.8 ✓ | 343,414,685.15 | **0.0** |

The volume matches to the agora every time. The paid figure is zero every time.
BudgetKey reads the file, maps the order-value column correctly, and does not
map the paid column at all. `report_error` is null — nothing is flagged.

The paid column's header is **`ב. חשבוניות מצטבר + מע"מ והצמדות במט"מ`**
(note the malformed `במט"מ`, seemingly for `במט"ח`), and there is a second,
even more useful column, **`ביצוע חשבוניות  לתקופת הדוח' במטבע מקומי`** —
paid DURING the report period, with a double space in the header and a stray
apostrophe. Header text that irregular is the likely reason a name-matching
parser misses them. The values themselves are clean numbers (int/float, no
stray formatting) — the data is fine; the mapping is not.

**Scale, in this single file:** 2,564 of 3,488 contracts (73.5%) carry a paid
figure, totalling **₪7,816,429,435** against ₪11,458,065,356 of volume. All of
it reads as zero through BudgetKey. Compare with the site-wide figure we
measured earlier — a non-zero `executed` on only 14% of contracts last reported
in 2025. That gap is now explained.

**Therefore: the earlier claim that "the government stopped reporting what it
paid" is WRONG and must not go on the site.** The ministries are reporting. The
pipeline we read is dropping it. Two consequences already in the code: an
all-zero series prints a dash, never `0 ₪` (`anyPaid` / `totalPaid`), and the
caption counts the rows we cannot answer for.

### THE OVERLAY — our own copy of the paid figures (built 2026-08-22)

Mercy's call: start with משרד החינוך, automate later. How it works:

    ministry .xlsx  →  tools/parse_report.py  →  site/data/paid/<section>.json
                                                 { sources: [url…],
                                                   orders: { "<order_id>:<10-digit code>": [paid, volume] } }

- **Sharded by BUDGET SECTION, not by ministry.** The education file carries 7
  rows under section 0054, so one report can span sections. The page loads by
  section, so the files on disk follow the tree. The parser MERGES into whatever
  is already there, so re-running it for another ministry is safe.
- **Key is `order_id:code`, not `order_id` alone** — one order appears more than
  once under different budget codes (4501798654 has two rows, ₪351m and ₪3.9m).
- `attachReportedPaid()` in budget.data.js fills a row ONLY when BudgetKey's own
  `executed` is not positive. **It never overwrites a figure BudgetKey has.**
- Any figure that came from a ministry file is marked with a `*`
  (`.fromreport`), the שולם סה״כ popover explains why, and the contract's
  פרטים popover carries a `מקור הסכום: הדוח שפרסם המשרד` line. A number from a
  different source must never look like the others.
- A missing section file is normal, not an error — most sections have none yet.

**TWO OUTPUT SHAPES, and the reason (2026-08-23).** Mercy: "the file has 30
columns… why are we only taking 2? I want to compare everything relevant."
Right — the overlay stored `[paid, volume]`, so the ministry column in the
comparison tool read `אין שדה כזה` for almost every row while the file itself
held 31 columns. The parser now writes both:

| file | contents | who loads it | size (חינוך) |
|---|---|---|---|
| `<section>.json` | `[paid, volume]` per contract | the budget page | 111 KB (32 KB gz) |
| `<section>.full.json` | EVERY column, under the ministry's own Hebrew field names | tools/compare.html | 3.0 MB (224 KB gz) |

A visitor must never download 3MB to see one number, and an auditor must never
be shown a subset I chose. Hence two shapes from one build.

**Field names are kept exactly as the ministry spelled them** — `ב. חשבוניות
מצטבר + מע"מ והצמדות במט"מ`, typo included. Renaming them would hide the very
thing someone checking us wants to see. compare.html maps them onto its rows
through the `X` table; the raw block prints them verbatim.

The file fills rows nothing else can: `שולם בתקופת הדוח` (paid during the
quarter, not cumulative), `סכום אופציה מצטבר`, `סכום התקשרות מצטבר`,
`קוד ספק`, and the supplier's `מספר ח"פ`. It also carries `מספר פניית פרסום` —
the publication number — which is the bridge to data.gov.il from the primary
document rather than through BudgetKey's `tender_key`.

**Where the .xlsx files live: `reports/`, NOT `site/`.** Anything under `site/`
is published; the raw reports are build inputs, not web content. Keep them so
the JSON can be rebuilt if the parser improves. Name them `<slug>_<q>_<year>.xlsx`.

**Where to GET a report:** our own page already links it — open a ministry,
click פרטים on any contract, and the `הדוח שפורסם ב-…` link IS the file
(`lastReport(r).url`). Otherwise SOME gov.il URLs follow a pattern:
`…/dynamiccollectorresultitem/<slug>_<q>_<year>/he/repository-of-answers_<ministry>_<slug>_<q>_<year>.xlsx`
— e.g. `health_3_2024`, `finance_3_2024d`, `education_1_2025`, and bumping the
quarter/year there does find a newer one. **CORRECTED 2026-08-23: most do not.**
`…/dynamiccollectorresultitem/health_1/he/רבעון 4 - 2020.xlsx` and
`…/answer1_143/he/חופש מידע רבעוןראשון 2019 - לפרסום (1).xlsx` are real; there
`health_1` is an item id and the filename is free text. Do not treat the dated
form as the rule — see COLLECTION PIPELINE. Older reports sit on foi.gov.il
with Hebrew filenames instead. NOTE the report a contract links is
whatever report last mentioned THAT contract — not necessarily the ministry's
newest. For a full picture always take the newest report the ministry has.

**To add a ministry:** put its .xlsx files in `reports/` and run

    python3 tools/parse_all.py --reports reports --out site/data/paid

which parses them OLDEST FIRST and passes each file's source url. Calling
`parse_report.py` directly in a shell loop is what let an older report overwrite
a newer cumulative figure — see COLLECTION PIPELINE (2026-08-23).

The parser matches headers LOOSELY (`"חשבוניות" in h and "מצטבר" in h`) because
the real headers carry typos, double spaces and stray apostrophes — matching
them exactly is what broke BudgetKey. It fails loudly if a column is missing
rather than writing zeros.

One quarterly file is the ministry's WHOLE contract book — the education file
lists 3,488 contracts with orders created 2015 through 2025 — and the paid
column is cumulative. So **one recent file per ministry ≈ complete lifetime
paid**, and there are only 82 publishers in the entire dataset.

### THE SOURCE HIERARCHY, AND WHO WINS A DISAGREEMENT (2026-08-22)

Mercy asked how many sources we have and which to believe. **Five tables, but
only two independent origins for contracts.**

ORIGIN A — the ministries' quarterly procurement reports (.xlsx, gov.il/foi.gov.il)
  1. the .xlsx itself — the primary document
  2. `quarterly_contract_spending_reports` — BudgetKey's row-per-contract-per-report copy
  3. `contract_spending` (1,036,112) — (2) grouped per contract
  4. `contracts_data` (779,202) — a narrower crop of (3)

ORIGIN B — the tender/exemption publication system (מינהל הרכש)
  5. the mr.gov.il monthly exports — THE live source since 2026-08-24:
     exemptions 239,549 / tenders 24,572, publication notices, `היקף כספי`,
     NO payments. (data.gov.il's copy of the same register is FROZEN at
     2021-01 — retired to a merge-time faithful-copy diff.)

Plus, for the budget itself: `raw_budget` (Ministry of Finance) and OECD/CBS
for the debt stock. Those are separate origins again.

What each one uniquely holds — none is strictly best:
- **.xlsx**: the paid column BudgetKey drops; the supplier's ח״פ.
- **quarterly_…**: `report-url`, `report-date`, `revision` — the provenance.
- **contract_spending**: `payments[]` history, entity resolution
  (`entity_id/kind/name`), `exemption_reason`, budget_code already 10-digit.
- **contracts_data**: `start_year`/`end_year` — the CONTRACT PERIOD, which
  contract_spending does not have at all (its `start_date` is 100% NULL).
  It also invents `volume_per_year`; never use those.
- **the registers (mr.gov.il)**: approving body, decision, announced
  amount, procedure id, doc reference, topics, contract start dates.

**IS THERE A SHARED INDEX? (probed live 2026-08-22 — yes, two of them)**

| source | order_id | budget code | publication no. | supplier ח״פ |
|---|---|---|---|---|
| the .xlsx | ✓ `הזמנת רכש` | ✓ `תקנה תקציבית` | ✓ `מספר פניית פרסום` | ✓ `מספר ח"פ` |
| `quarterly_…` | ✓ | ✓ | – | ✓ `company_id` |
| `contract_spending` | ✓ **100%** (1,036,112/1,036,112) | ✓ 10-digit | ✓ `tender_key` | `company_id` 75.5%, `entity_id` |
| `contracts_data` | ✗ **none** | ✓ dotted | ✗ | ✓ `supplier_entity_id` |
| the registers (mr.gov.il / data.gov.il) | ✗ | ✗ | ✓ `מספר פרסום` | ✓ `מספר חפ ספק` |

1. **`order_id` + `budget_code` joins the whole Origin-A chain**, .xlsx included.
   `order_id` is present on every single contract_spending row. This is the key
   `data/paid/*.json` uses, and it is solid.
2. **`tender_key` bridges Origin A to Origin B.** It is JSON, not text:
   `["569574", "exemptions", "none"]` — publication number, then the name of
   the data.gov.il dataset it points into. Verified end to end: publication
   569574 resolves in data.gov.il `exemptions` to משרד הבינוי והשיכון / כבישים /
   תקנה 5א(ב)(1) / קריץ איגור / ח״פ 303739957 / ₪222,177.66 / 08.09.2015.
   The .xlsx carries the same number as `מספר פניית פרסום` (651623 on the
   מילגם row), so the register can be reached from the primary document too.
   NOTE it is a JSON column — `tender_key > ''` throws
   `invalid input syntax for type json`.
3. **`contracts_data` is the orphan.** No order_id, no publication number, and
   `item_url` is an opaque hash. It can only be matched heuristically (budget
   line + identical volume), which is what `tools/compare.html` does — and
   says so on screen. Treat anything it contributes as lower confidence.

**THE RULES, in order:**

R1. Prefer the source closest to the origin. But know what that buys: the
    .xlsx is authoritative about **what the ministry reported**, not about
    what is true. It carries its own junk — `9999` placeholders, 8.5% of rows
    with no real purchasing method.
R2. **Agreement between BudgetKey tables is NOT corroboration.** 1–4 are one
    document processed four ways. Only A vs B vs raw_budget are separate
    witnesses. Never present one as confirming another.
R3. Prefer the number a reader can go and look at. This is why a
    ministry-sourced figure is marked `*` and פרטים links the report file.
R4. Prefer the NEWER report — the paid column is cumulative and contracts get
    restated downward. `data/paid/*.json` therefore records its vintage
    (`"reports": {"education": "2025Q1"}`).
R5. ~~When we cannot decide, show nothing.~~ **OVERRULED BY MERCY, 2026-08-22:**
    "we should try and give the public the most accurate data… and we need to
    also highlight that data is missing from important files, this is
    unacceptable in my opinion." She is right. A neutral `—` hides the finding:
    ₪7.8bn unreported in one ministry's file is not a gap in our data, it is
    the story. So: show the best available figure, labelled with its source;
    where nothing was reported say **`לא דווח`** in words, not a dash; and
    total the unreported money per budget line so the size of the hole is
    visible. Never present uncertainty as if it were absence.

**OPEN TENSION, be honest about it.** The code today is conservative:
`attachReportedPaid` fills in only where BudgetKey's `executed` is not
positive, and never overwrites. By R1+R4 the newest primary document should
arguably win outright. The vintage is now recorded so that choice can be made
deliberately rather than by accident — but it has NOT been made.

### tools/compare.html — THE TOOL FOR CHECKING ME (2026-08-22)

Mercy: "I want to see, check and compare the end result to the sources myself
because I don't trust you." Correct instinct, and the site needs it anyway.

`site/tools/compare.html` takes an order id, a supplier or a word from the
purpose and shows, for each matching contract, a **FIELD-BY-FIELD MATRIX**:
rows are facts (ספק · ח״פ · סוג גוף · משרד · יחידה רוכשת · תקנה · שם התקנה ·
מטרה · אופן רכישה · תקנת הפטור · היקף · שולם · תאריכים · שנים · מספר פרסום ·
מספר הזמנה), columns are the five sources — `contract_spending`,
`contracts_data`, the newest published report, our own .xlsx-derived file, and
**data.gov.il's publication register**, reached through `tender_key`. Every
source is fetched with `SELECT *`; rows where sources disagree are flagged.

Mercy asked for this explicitly: "I don't want to see just the spending, I want
to see all the columns of each source." The first version compared one number
and was not what she needed.

**tender_key routes to TWO registers, not one (2026-08-22).** Its second
element names the dataset: `["569574","exemptions","none"]`. Hard-coding the
exemptions resource id meant every TENDERED contract was looked up in the wrong
table and came back empty. Resource ids:
- `exemptions` → `65c8fced-c50c-400e-94fb-ef1a208c43e5` (165,705 rows)
- `tenders` → `7038b3e6-a74d-442e-b16b-466c8196124a` (דוח מכרזים)

And only **247,141 of 1,036,112 contracts (23.9%)** carry a link at all —
`tender_key` is `[]` for the rest, including the first six education contracts
checked. So an empty data.gov.il column is usually the true answer. Counting it
needs `jsonb_array_length`, not `json_array_length` (the column is jsonb and
the json_ variant does not exist for it).

The cell vocabulary is deliberately four-way and is explained on the page:
`ריק` (field exists, empty) · `אין שדה כזה` (source does not carry it) ·
`לא נמצא` (contract absent from that source) · `0 ₪` (the source really wrote
zero). Three MORE states were added after Mercy reported the page "keeps
saying אין קובץ / לא נמצא": `אין קישור` (this contract was never linked to a
publication register), `לא נמצא במרשם` (it was linked, but the record is not
there), and `אין קובץ לסעיף NNNN` (we simply have not downloaded that
ministry's report yet — coverage, not failure). Collapsing "we have not got it"
into "not found" makes a half-built dataset look like a broken one. **This page shows what the source says, uninterpreted** — the budget
page turns an all-zero series into "לא דווח", and this one must not, or it
could never be used to check the budget page.

Two collapsed sections underneath: every raw field of every source verbatim,
and every published report with its URL. Both are lazy.

It queries BudgetKey live from the browser — it is not reading a summary I
prepared. `tests/cmp.mjs` drives it against the מילגם contract.

**THE SEARCH BUG, and the rule it taught (2026-08-22).** The first version
answered "לא נמצאו התקשרויות" for everything. Cause: `ORDER BY volume DESC` on
a text search. There is no index on `purpose` or `supplier_name`, so Postgres
had to scan AND SORT all 1,036,112 rows before `LIMIT` could apply — it timed
out, and a timeout surfaced as "nothing found". Dropping the ORDER BY lets the
scan stop at the 8th match and it returns instantly.

RULE: on this dataset, an unindexed `ILIKE` is fine with `LIMIT` and fatal with
`ORDER BY` or `count()` — both force the whole table. Say "the first found",
never imply a ranking that was not computed.

**THE SECOND BUG, same page, worse (2026-08-22).** After the search was fixed
it reported "8 התקשרויות" above a completely blank screen. Cause: `show()`
awaited every source for every result before drawing anything, and the whole
list was `for (const row of found) await show(row)`. One slow query — the
report table ordered by the unindexed `"report-date"` — and nothing was ever
drawn. The status line said it had found 8, which made it look like a render
bug rather than a stall.

Now: the card is drawn from the row already in hand, each source fills its own
line as it answers (`בודק…` until then), every lookup has a timeout that prints
its failure IN the row, and the raw report list is lazy — fetched only when the
reader opens the details, so the expensive query is off the drawing path
entirely. Verified: with contracts_data hung dead, the card still renders in
**216ms**. `tests/cmp.mjs` holds that case open permanently.

RULE: **never await more than one source before drawing something.** A page
that knows enough to say "8 found" knows enough to show 8 cards.

The page carries a `BUILD` stamp in its footer for exactly the reason it was
needed here — Mercy was looking at a cached copy with no random buttons while I
was describing the new one.

**BUDGETKEY CACHES BY QUERY TEXT — a "random" query with fixed SQL is not
random (2026-08-22).** `TABLESAMPLE SYSTEM (1)` with no seed produces identical
SQL on every click, so the API returned the same cached row every time and the
random button looked broken. Fix: `REPEATABLE (${seed})` with a fresh random
seed, which changes both the pages sampled and the cache key. Verified live —
seed 7 → 4500029352, seed 4242 → 4500631384. `tests/cmp.mjs` echoes the seed
back as the order id and fails if four clicks do not produce distinct seeds.

RULE: anything meant to vary between calls must vary its QUERY TEXT, or the
cache will quietly make it constant.

Two buttons avoid the dead end entirely:
- **התקשרות אקראית** — `TABLESAMPLE SYSTEM (1) WHERE volume > 1000000`, which
  reads a random slice of pages instead of scanning. `ORDER BY random()` would
  scan the table; TABLESAMPLE does not.
- **אקראית מהחינוך** — picks an order id out of our own `data/paid/*.json`,
  then looks it up LIVE in BudgetKey. The file supplies only the id; every
  figure still comes from the live source, or the tool would be marking its
  own homework.

### NEVER TEST FROM file:// — AND serve.bat EXISTS SO YOU DON'T (2026-08-22)

Mercy opened `site/index.html` from disk and saw dashes everywhere. The page
LOOKS fine that way — the tree and charts come from next.obudget.org over the
network — but anything the page reads from its own folder (`data/paid/*.json`)
is blocked by the browser on `file://`, silently. `paidcheck.html` diagnosed it
in one click; before that page existed there was nothing to see.

`serve.bat` at the repo root (double-click). Mercy has **no node on PATH**, so
it tries node → python → py → `tools/serve.ps1` (PowerShell + HttpListener,
which ships with Windows and needs no admin rights for a localhost prefix).
Zero installs either way. Serves `site/` on :8080, logs every 404, refuses paths outside
`site/`, and sends `Cache-Control: no-store` so a saved file shows immediately.

### SIZE WAS NEVER THE CONSTRAINT (2026-08-22, real numbers 2026-08-25)

The dataset was built at scale — the measured sizes live in "THE CONTRACTS
DATABASE" at the top (contracts.db 470 MB / public 234.6 MB / gzip ~17:1).
What this section correctly predicted, still true:
1. **Supply is the whole problem** — 82 publishers, refreshed quarterly.
2. **Format variance** — headers carry typos, double spaces, stray
   apostrophes, and vary by ministry and year; only LOOSE matching survives.
3. **raw_budget is still BudgetKey's.** The .xlsx files carry no budget
   tree, so the tree, the flows and the debt block stay on the live API.

### THE RELAY'S 403 ON gov.il WAS OUR OWN ALLOWLIST (2026-08-22)

I reported "gov.il blocks the relay" — wrong, and Mercy caught it. worker.js
line 47 `ALLOWED()` lists knesset.gov.il, court.gov.il, next.obudget.org and
data.gov.il. **`www.gov.il` is not on it**, so line 631 answers
`Host not allowed` with status 403. The far end never saw the request.
(The other 403, `CONNECT tunnel failed` from curl, IS real and is this
sandbox's own egress proxy — that one cannot be changed from here.)

Adding `host === "www.gov.il"` would let the worker fetch the report files,
which is the path to a scheduled refresh. It does NOT let Claude read them
here: WebFetch renders every response as text and .xlsx is a binary zip. Files
still arrive through the device bridge.

RULE: a 403 says someone refused. Check WHO before reporting a blocker.

Worth doing: report it to הסדנא לידע ציבורי, and consider ingesting the .xlsx
files ourselves — `ביצוע חשבוניות לתקופת הדוח` would give real per-period
figures with no differencing at all, which is strictly better than what we
derive today. Note the sandbox and the relay are BOTH blocked from gov.il blob
URLs (403); the files have to arrive through the device bridge.

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

## TITLES & HEBREW REGISTER (2026-08-22) — settled with Mercy, don't churn it

Three layers, three jobs. Never let one repeat another's words:
- **Site** (header, every page): `הכסף שלנו`
- **Page** (`PAGE_STR.tagline`, per page, rendered by common.js and now styled as
  a real centred headline in style.css): `תקציב המדינה — מה קורה לכסף שלנו`
- **Blocks** (h2): `מאיפה הכסף מגיע, ומה החוב עולה לנו` · `לאן הולך הכסף`
- Chart subhead inside block 1 is `לאורך השנים` — it names what the CHART adds
  (time), not what the block is about.

RULE that produced this: a page title must not be a block title promoted, and
must not list the sections. Mercy first proposed
`תקציב המדינה — לאן הולך הכסף שלנו`, which is word-for-word block 2 and covers
only half the page. The page will grow more blocks; a title that enumerates them
goes stale on the next one.

**HEBREW REGISTER — verified against the Academy of the Hebrew Language:**
`לאן` is the STANDARD form; `לאיפה` is spoken register only. (Mercy's intuition
was the reverse — she read `לאן` as friendlier-but-less-professional. It is
both correct and everyday.) `מאיפה` is colloquial by the same rule, but we KEEP
it: its correct alternatives (`מאין`, `מניין`) read archaic on a site whose
whole promise is plain language; `מהיכן` is the middle option if ever needed.
Source: https://hebrew-academy.org.il/איפה-והיכן-לאן-ומניין/

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

## VERIFIED BY MERCY 2026-08-22 — the two open checks came back GOOD

- **Bank of Israel SDMX WORKS.** She ran the PS dataflow and got CSV. It gives
  **MONTHLY series through 2026-07** — this closes the "BudgetKey is annual"
  gap. Series seen: MOF_ED_NO_CREDIT_M_N (expenditure), I_TAX_TOT_M (tax
  collection) + _CSYTD cumulative variants, MOF_DEFD_NO_CREDIT_M_N (deficit),
  MOF_DEFD_NO_CREDIT_R_GDP_Q_N (deficit % GDP), TAX_TOT_R_GDP_A, OZAR_* .
  Columns: SERIES_CODE, TIME_PERIOD, OBS_VALUE, UNIT_MEASURE (ILS/PT),
  UNIT_MULT (6 = millions, 3 = thousands — READ IT, it varies by series).
  Her call used startPeriod=2020; earlier history not yet tested.
  Worker allowlist still needs `edge.boi.gov.il` before pages can call it.
- **data.gov.il CKAN WORKS** (68 hits for "תקציב"). Most useful: משרד האוצר
  quarterly **אומדן ביצוע** XLSX, one dataset per quarter 2017→2025-06;
  שינויי תקציב per year 2005–2013; משרד החינוך שקיפות תקציבית per authority/
  school (2016, XLS); עיריית באר-שבע publishes its own budget as CSV/JSON.
  API form: data.gov.il/api/3/action/package_search?q=…&rows=25 — already on
  the worker allowlist, and it answers through the relay.
  NOTE: robots blocks WebFetch on data.gov.il/api — use the relay's /b64/.
  A search for "שכר" returns only 6 datasets, none of them public-sector pay.

**PROBING TRICK (2026-08-22).** WebFetch is robots-blocked on
next.obudget.org/api AND data.gov.il/api, but the relay's /b64/<base64url>
path works for both. HARD LIMIT: the WebFetch proxy 403s on relay URLs longer
than ~248 chars — 247 passed, 250 failed. Keep probe SQL tiny (`select * from
<table> limit 1` then ask for the keys) or add a preset to the worker.

## Search on votes.html — what was wrong and the rule it taught (2026-08-21)

Mercy hit "בודק את תוצאות ההצבעות…" forever on advanced search
(הוגשה על ידי = בנימין נתניהו + סוג = פרטית). Three causes, all now fixed:
1. **A pending check over work never dispatched.** The page asked "do ALL
   advGroups still lack _passed/_bill?" but only sent the first 120 for
   checking → with >120 groups the spinner could never end. Worse,
   ensureBillInfo(g, 0) returned early WITHOUT setting _bill, so votes with no
   bill behind them (motions, no-confidence) stayed "unchecked" forever.
   RULE: background work must be bounded, counted, and always settle — the
   pending test must be over exactly the set that was dispatched.
2. **The type filter was asked of the wrong table.** Deciding "is this vote on
   a private bill?" per vote cost 1 detail + 3 OData calls × 120 = ~480
   parallel requests through the relay. Now: when a person is named, we fetch
   THEIR bills once (KNS_BillInitiator → KNS_Bill with SubTypeID) and filter
   there; per-vote lookups only happen when no person was named.
3. **The question was asked backwards.** "Bills proposed by X" was answered by
   text-matching X's bill names against *votes in the last year* (the silent
   default range). Netanyahu's private bills are from the 1990s → zero, always.
   Now the person's bills ARE the answer: when no vote matches, the page lists
   the bills with their status and offers a jump to the bills tab.
   RULE: start from the entity the user asked about, not from the feed we
   happen to have loaded.

Also now: plain law search walks back through older 120-day windows (up to ~3
years) instead of only filtering what's in memory; matching is word-order blind
and ignores punctuation/הת­שפ״X-year suffixes (normTxt/billCore/textMatch);
the effective date range is always shown, and a capped run says so.
Tested with mocked relay routes (test_votes.mjs pattern, Playwright).

## selftest.html — THE TOOL TO USE BEFORE SAYING "FIXED" (2026-08-22)

Mercy asked for a testing tool because every bug that reached her had passed
tests built on MOCK data. `selftest.html` + `selftest.js` load the REAL page
markup and the REAL scripts, drive the actual functions (doSearch / advSearch /
currentList) against LIVE data, and POST the report to the worker at
`/qa/report`. **Claude can then read it directly** — no screenshots, no copying:
    WebFetch https://our-money.idannhhb.workers.dev/qa/report?fresh=<n>
(the ?fresh= is mandatory — WebFetch caches a URL for ~15 minutes and a stale
report already fooled me once). `selftest.html?mk=שם` tests any MK.
Scenarios cover: feed, index presence, law-name search (results + speed +
order + reach), TYPE-ONLY search, result filter, initiator search (found bills,
nothing shown unverified, checking stops when the page is full), the proposers
rule, and MK-name search. `test_selftest.mjs` runs the tool itself in Playwright
against the fake upstream, so the tool is tested too.
GOTCHA found while building it: a second `<footer>`/`#debug` on a page made
common.js `renderFreshness()` throw inside `dataset()`, which silently emptied
the persons directory. renderFreshness is now guarded — a decoration must never
be able to break the data it decorates.

## The expanded vote panel — Mercy's layout (2026-08-22), keep this order

1. **הוגשה על ידי** — first line, always (up to 4 names; more = a count + toggle)
2. **כנסת · ישיבה · N הצבעות** on ONE line, with a button that reveals the
   individual reservation votes. Only the decisive vote shows by default —
   "most users are not gonna care" about 30 instances of the same bill.
3. the decision text (ההחלטה: …)
4. who voted what, by faction
5. **מסמכים רשמיים** — last line

The result badge and the tallies were being printed TWICE (row + panel); the
panel's copy is gone. `groupDetailHtml()` owns this order; `detailHtml()` now
returns only the decision + the faction breakdown. Asserted in both
test_index.mjs (panel starts with proposers, no duplicate badge) and
selftest.html (same checks against live data).

## Mercy's display rule for proposers (2026-08-22) — do not "improve" it

Up to FOUR initiators: list the names. More than four: say **how many**, with a
click to open the full list. NEVER show some names and hide the rest — she was
shown "משה גפני, איתן ברושי… ועוד 15" while searching for אכרם חסון, who was
inside the hidden 15, and reasonably concluded the result was wrong. A partial
list is worse than a count, because the name you're looking for is exactly the
one that gets cut. `initiatorsHtml()` in votes.view.js; same rule in the bills
tab and in the "his bills" fallback list.

## Priority she set (2026-08-22): law-NAME search matters more than advanced search

Law-name search is the index path: one request per year block, in parallel with
the MK-directory lookup (they used to be serial — that was a wasted round trip
on every search). Measured 111ms to first rows in the mocked harness.
The initiator search is the slow, inexact one; the fix is queued below, not done.

## THE REAL FIX STILL PENDING: store the BILL ID on every index row (worker v8)

Today "bills proposed by X" = X's bill NAMES → text-search vote titles →
open each candidate to see which bill it really is. Three chained trips plus one
request per row: that's the 30 seconds, and the text step is a guess.
With a bill-id column it becomes: X's bill ids (cached) → ask the index for rows
whose bill id is in that set. One request, exact, no name matching, no checking.
Cost: archive ids are free (sess_item_id, already in the rows we fetch — needs a
re-sweep); modern ids need one GetVoteDetails per vote (~10k, one time, batched
via build.html or the cron). Mercy deferred it — raise it again when she asks
for the advanced search to be fast.

## Three fixes Mercy had to demand twice (2026-08-22) — read before touching search

1. **Never render a row that hasn't passed the active filters yet.** My first
   "verification" hid a wrong row only AFTER its check came back, and rows past
   the 300-cap were never checked at all — so a bill by גדעון סער sat in a
   search for someone else's bills. Now `checked(g, a)` gates the list:
   an unchecked candidate is simply not in `currentList()`. Filtering that
   corrects itself later is not filtering.
2. **Sort by a real date, never by comparing date TEXT.** The sources return
   `2023-03-15`, `15/03/2023` AND `/Date(…)/`. Comparing those as strings sorts
   by day-of-month — that's what put a 2023 vote above a 2026 one. `voteTime()`
   in votes.data.js runs everything through dateOf() first; the same for the
   grouping key (`voteDay()`). test_votes.mjs feeds the mock API mixed formats
   on purpose and asserts descending order — verified that it fails on the old
   comparator.
3c. **A filter by סוג alone returned nothing, always (2026-08-22).** `checkOne`
   fetched the vote's details only for the initiator/result filters — but the
   bill id lives in those details, so with only the type filter set, `_bill`
   was always the empty placeholder and no vote could ever match "פרטית".
   Deterministic, not flaky. Caught by selftest.html's type-only scenario,
   which is exactly why that tool exists.
3b. **A cap must never be applied before a filter.** `/search/votes` collected
   up to `limit` matching lines and THEN applied the date range — so a dated
   search could return nothing while matches existed just past the cap. The
   range is now applied inside the scan, and year files outside it aren't even
   read. Same class of bug as #1: decide first, then cut.
3. **Check only as far as the page needs.** Every check costs one request, so
   `fillPage()` walks candidates in batches of 12 and STOPS once the current
   page has enough qualifying rows (~80 requests for a 40-row page instead of
   300). Paging continues from `state.advCursor`. The test counts the actual
   requests, so a regression here fails loudly.

## THE ARCHIVE VOTE→BILL LINK EXISTS (2026-08-22) — verified live via the relay

Mercy asked whether we simply don't know who proposed a law before July 2021.
We do, and now the site proves it per vote:
- `View_vote_rslts_hdr_Approved` carries **`sess_item_id`** (and `vote_item_id`).
  The earlier note that its fields were only the ones listed was incomplete.
- `sess_item_id` = `KNS_PlmSessionItem.ItemID`, which also gives `ItemTypeID`
  (`KNS_ItemType`: 1 שאילתה · **2 הצעת חוק** · 3 אי אמון · 4 הצעה לסדר ·
  5 ישיבת מליאה · 12 ישיבת ועדה · 6000-6003 misc).
- When the item is a bill, that SAME id is `KNS_Bill.BillID`. Verified:
  item 88733 → "חוק התכנית להבראת כלכלת ישראל…", Knesset 16, ממשלתית.
  (KNS_BillInitiator was empty for it — correct: government bills have no MK
  initiators, don't read that as a broken join.)
- votes.data.js `oldItemId(v)` fetches it once per archive vote
  (`$filter=vote_id eq N&$select=sess_item_id`) and caches it on the row, so
  pre-2021 votes get exact initiator verification AND an "הוגשה על ידי" line.
- NEXT: store sess_item_id as a column in the index (worker v8) and this costs
  zero requests; needs an archive re-sweep, and compaction's dedupe must then
  keep the NEWER line (today it keeps the first).

**The initiator match is VERIFIED, not guessed (2026-08-22).** Mercy searched
"הוגשה על ידי מיכל מרים וולדיגר · פרטית" and got a vote whose expanded panel
said "הוגשה על ידי: הממשלה" — her private bill and a government bill shared
almost the same name, and the title heuristic couldn't tell them apart. Now the
name match only produces CANDIDATES: each one's GetVoteDetails header carries
FK_ItemID (= BillID), which is checked against the person's own bill ids
(`state.adv.initIds`). `g._initOk` = true (keep) / false (dropped for good) /
null (archive vote — our index has no bill id for those, so it's shown with a
"התאמה לפי שם בלבד" chip). RULE: a text match is a candidate, never an answer,
when an id-level join exists.

## THE VOTE INDEX — our own copy of every vote (worker v7, 2026-08-21)

Mercy's push ("I want to filter through everything, not the latest news") ended
the window-walking era. The worker now harvests EVERY plenum vote 2003→today
into KV and the page searches our copy.

- Storage: one KV key per year, plain TSV text (NOT JSON — the free plan gives
  10ms CPU per request; String.indexOf over a megabyte costs ~1ms, JSON.parse
  of the same costs ~10ms and would 1102). Line format:
  `id ⇥ date ⇥ time ⇥ src(m|a) ⇥ passed(1|0|-) ⇥ for ⇥ against ⇥ abstain ⇥ protocol ⇥ title`
- Build: `/build/votes` does ONE step per call (≤1 upstream request — the free
  plan allows 50 subrequests and 10ms CPU per invocation, so a single big build
  is impossible). Phases: modern (45-day windows from 2021-07-14) → archive
  (Votes.svc `$orderby=vote_id&$skip=N&$top=400`) → compact (merge each year's
  parts into one key: ~130 keys → ~24, because search reads every key it spans
  and the free plan allows 100k reads/day). Cursor lives in `vi:meta`; the
  build is resumable and idempotent-ish. `build.html` drives it (~130 steps,
  paced 1.2s for KV's 1-write-per-second-per-key rule); cron also advances it
  20 steps per firing, so it finishes even if she closes the tab.
- Freshness: cron writes the last 60 days into `vi:live` (overwritten); search
  merges and the client dedupes by vote id.
- Search: `/search/votes?qs=a|b&from=&to=&y0=&y1=&limit=` — phrases OR-ed,
  words inside a phrase AND-ed (order-free), Hebrew quotes stripped. The page
  fans out by 6-year blocks × 8-phrase chunks so no request scans too much.
- Client: `idxMeta()` / `idxSearch()` / `groupsFromIndex()` in votes.html.
  **Everything degrades gracefully**: no index → the old window-walking path.
  Archive rows carry their result, so ✔/✘ is free for 2003–2021; modern votes
  still need one GetVoteDetails each (that's why the result/type filters still
  check in batches of 300 — but now with a "check more" button, no hard cap).
- Measured on synthetic data: ~71 bytes/row (real titles are longer, expect
  ~110–140) → 55k votes ≈ 6–8 MB of the free plan's 1 GB.
- **BUG FOUND ON THE FIRST REAL BUILD (2026-08-21)**: Votes.svc IGNORES $top
  above its own page size (~250 rows) and returns `odata.nextLink` instead. The
  build read "fewer rows than requested" as "end of data" and stopped after ONE
  archive page — Mercy's first index had 10,017 rows and years 2003 + 2021-2026,
  with 2004–2020 missing. Fix: advance $skip by the rows ACTUALLY returned and
  stop only on an empty page. RULE: never infer "last page" from a short page
  on an OData service; only an empty page (or a missing nextLink) means the end.
  `/build/votes?resume=archive` re-sweeps the archive keeping everything else;
  duplicate lines are harmless (search dedupes by vote id).
- **Archive page size is 100** (not the 400 we ask for), confirmed live: the
  first real full build produced 34,861 rows covering 2003–2026 in ~250 steps.
- **TWO LESSONS FROM DEBUGGING THE FIRST BUILD (2026-08-21) — both mine, both
  expensive:** (1) WebFetch CACHES a URL for ~15 minutes. I read
  /data/votesmeta, got a stale copy, and concluded Mercy's archive sweep had
  failed when it had actually succeeded. Always add a cache-busting param
  (?fresh=<n>) when checking live state, and never tell her something is broken
  on the strength of one cached read. (2) I then "probed" the fix by calling
  /build/votes?resume=archive on her LIVE worker — which restarted her
  completed sweep. Probing endpoints that MUTATE her data is not probing.
  Read-only checks only, unless she asked for the change.
  Fallout handled by `/build/votes?finish=1`: skips to the compaction pass,
  which now also dedupes lines by vote id, so a restarted or repeated sweep
  costs nothing permanent.
- Tests: `wtest.mjs` runs the REAL worker in Node against a fake Knesset with an
  in-memory KV (build → search assertions); `test_index.mjs` puts that worker
  behind votes.html in Playwright; `test_votes.mjs` covers the no-index
  fallback. GOTCHA: installFakeUpstream() replaces globalThis.fetch — the
  harness must keep `realFetch` or its own localhost calls get faked too.

## Design decisions (Mercy-driven, 2026-08-21)

- Votes page = TWO SUB-TABS ("הצבעות במליאה" / "הצעות חוק בתהליך"), because
  votes (events: who voted, passed/failed, person, dates) and bills
  (documents: status, committee, journey) are different things with different
  filters. We tried one view + a mode dropdown first — it produced an endless
  stream of meaningless filter combinations. Don't merge them again.
- Interaction language: rows expand DOWNWARD (accordion), search filters the
  same list in place, one search button total (advanced panel = extra filter
  fields, no second button). Minimal info per row (name + date + ✔/✘);
  depth one click away. Person names auto-detect (word-order blind — the
  Knesset directory is surname-first); multi-match opens the advanced panel
  with pick-chips.
- Bills tab: stage dropdown = הכל / עלו להצבעה / לא הגיעו להצבעה shortcuts +
  every official KNS_Status; date range filters LastUpdatedDate (OData
  datetime'...' literals); "עוד" pages via $skip.

## Process conclusions

Moved into "How Mercy works" in START HERE (2026-08-25). One detail kept
here: the pages' footer shows a ⚠ debug line with the exact failing
request — ask her for it when something on the site breaks.
