# NOTES.md — THE CONTRACTORS DATASET (pipeline\contractors\)

Everything about the contracts/contractors data product lives HERE, by
Mercy's ruling (2026-09-08: "organize everything by datasets"): the merge of
the sources into one database, the build, the D1 upload and its verifier,
the contractors PAGE's precomputed tables, and the data itself (`inputs\` +
`out\`). Same keep-it-current rule as every notes file: when a chat proves a
line here wrong, fix it in that chat, and date the change.
A chat about this dataset connects `contractors\` + `shared\`.
(Also HERE since the same day: the COLLECTION scripts — the workflows run
them by path, `pipeline/contractors/…`; see the COLLECTION section below.
What is NOT here: the worker endpoints that SERVE this dataset — `worker\`.)

## THE FILES

| file | role |
|---|---|
| `build_dataset.py` | THE MERGE: ministry files + BudgetKey + the mr.gov.il registers → one deduplicated record per order, field by field (implements FIELDS.xlsx v2). Deliberately unwired from workflows — open item 5 |
| `build_database.py` + `build-database.bat` | the whole build, one double-click: unpack `inputs\` → merge → both dbs → `build_contractors.py` last (so a rebuild never loses the ctr_* tables) |
| `build_contractors.py` + `build-contractors.bat` | precompute the PAGE's ctr_* tables + the FTS search index into `out\contracts-public.db`; runnable alone on an existing db. Prints SANITY numbers — read them |
| `..\shared\upload_to_d1.py` via `upload-to-d1.bat` | the FULL D1 upload, in row-count-verified parts (memory: `..\build\d1\`) |
| `upload_contractors.py` + `upload-to-d1-contractors.bat` | send ONLY the ctr_* tables + index to D1 — minutes, not the 1.3 GB (memory: `..\build\d1\ctr\`) |
| `verify_d1.py` + `verify-d1.bat` | content check of D1 vs the local db (whole strings table + deep random samples) |
| `clean-up.bat` | really DELETES the rebuildables (~10 GB), lists first; never touches `inputs\`/`out\` |
| `archive.py` | PIPELINE v2: the permanent raw archive client (release assets, grow-only manifest, transient-trouble retries) |
| `pipeline2.py` | PIPELINE v2 phase 2: the automated monthly chain run by build-and-update.yml (fetch-inputs · build · update-d1 · rotate-baseline · restore-reports · check-credentials). Bare-Python except build() |
| `check-credentials.bat` | proves `..\d1-config.json` against D1 in seconds — read-only, no local db needed (unlike verify-d1.bat) |
| `test_contractors.py` · `test_upload_dump.py` · `test_archive.py` · `test_pipeline2.py` | the page-table definitions (25 asserts) · the dump→reload round-trip incl. FTS5 (9) · the archive's rules + retries (15) · phase 2's rules (23) |
| `inputs\` | the source zips + register exports (gitignored; its README says what each file is — full-records.zip is THE ONLY COPY, never delete) |
| `out\contracts-public.db` | THE OUTPUT — the D1 upload, ctr_* tables included (gitignored) |

Shared infrastructure this dataset leans on (in `shared\`, always
connected): `build_sqlite.py` (schema + builder — the tests build their
fixture dbs with the REAL schema) and `upload_to_d1.py` (dump/import/verify
machinery). The merge test is `..\tests\test_merge.py` (67 asserts — run by
refresh-data.yml, so its PATH must not move). `..\audit\` checks the built
data; `..\build\` is the rebuildable work area; config `..\d1-config.json`.

## CURRENT STATE (built 2026-08-25; uploaded 2026-08-26; verified 2026-09-05)

(2026-09-09: phase 2's first run is REPLACING this upload — see STATUS in
PIPELINE v2 below. Its build measured 987,090 contracts. Once that run is
green, the numbers here describe last month and this section should be
rewritten from the run's log.)

- **986,942 contracts**: file-only 43,013 · BudgetKey-only 473,616 · BOTH
  470,313 (91.6% of file contracts matched a bk order; bk side 943,929
  distinct orders vs 945,088 measured live — small unexplored gap).
- Fills: bk 14.42M · file 5.33M · tn 970,087 · ex 446,201 · all-zero
  354,898. Register joined: 230,554. 69 output sections.
- **Sizes: contracts-full 2,332 MB · contracts-public 1,344.9 MB** — past
  D1's free tier; the paid plan ($5/mo, 10 GB) carries it. Levers if ever
  needed: move the reports table out of D1, normalize more columns.
- D1 holds: strings 6,219 · allocations 1,058,220 · reports 2,924,853 ·
  contracts 986,942 · 10 indexes · contracts_v — plus the ctr_* tables
  once their upload runs.
- Register-join reality: only 7% of ALL contracts carry a publication
  number (whole ministries never fill it); of those with one, 62% join.

## THE TWO DATABASES, AND WHY (settled with Mercy 2026-08-25)

She rejected static-shard workarounds ("what is the correct way to do
it?"), caught the full-reload waste ("we only need to update what's
relevant"), and set "the audit is just for myself". So ONE build makes two:

- **`..\build\contracts-full.db`** — every field + per-field provenance + a
  sha256 fingerprint per contract + the raw register rows embedded. A build
  INTERMEDIATE (clean-up.bat deletes, audit.bat reads). Fingerprints power
  the monthly delta: build_sqlite `--delta-against last-month.db` prints
  exactly what a monthly D1 update would write.
- **`out\contracts-public.db`** — no provenance/fingerprints
  (`sources`+`notes` kept: a reader is entitled to know which sources fed a
  contract). 13 low-cardinality Hebrew text columns dictionary-encoded into
  one `strings` table; the `contracts_v` VIEW undoes it so worker queries
  read plain text for free. Also carries the ctr_* tables + ctr_fts.
- With an index, size is irrelevant to lookups (order_id 0.1 ms at scale).
  D1 facts (2026-08-25): free = 500 MB/db, 5M row reads/day; paid $5/mo =
  10 GB/db, 25B reads/mo, 50M writes/mo.

## THE D1 UPLOADER — the lessons, all now code (2026-08-26, three live failures)

REST import flow (init md5-etag → PUT → ingest → poll), stdlib only — her
machine has no Node. RULE THAT GOVERNS IT: **never trust an import's status
words; trust row counts.**

- v1 sent one 1.2 GB file; the poll's "Not currently importing anything."
  is IDENTICAL for "finished" and "failed and rolled back" — it HAD failed
  (0 tables). Now: ~120 MB parts split at statement boundaries, each part
  COUNT-verified against the dump manifest before moving on; verified parts
  recorded in `build\d1\state.json`, skipped on re-run; every poll answer
  saved to `build\d1\last-poll.json`.
- v3: a run killed on OUR side leaves the import RUNNING on Cloudflare's
  (no cancel call). `init_when_free()` waits (30s polls, up to 4h);
  `already_applied()` counts BEFORE uploading so an orphan-landed part is
  skipped, not re-sent.
- v4: ten CREATE INDEXes in one part blew D1's CPU limit and rolled back.
  Every index/view gets a part OF ITS OWN; `verify()` checks sqlite_master
  for objects, not just counts. A 400 "no such table" before a part lands
  is "not there yet", not an error (`api(soft=True)`).
- INSERTs capped at 60,000 BYTES (bytes, not chars — Hebrew is 2/char);
  loud error past 80 KB/row.
- **FTS5 (2026-09-08):** the dump ships a virtual table as CREATE VIRTUAL
  TABLE + row INSERTs and SKIPS its shadow tables (importing them beside
  the virtual one would collide); FTS parts capped at 30 MB (index-building
  costs far more CPU per byte — the index lesson again). `dump(only="ctr_")`
  is the targeted dump `upload_contractors.py` uses.
- Re-running upload-to-d1.bat is safe (verified parts skip); a CHANGED
  contracts-public.db (any byte) triggers a fresh dump + FULL re-upload —
  for just the ctr_* tables use upload-to-d1-contractors.bat instead. Its
  last step proves the search index with a real MATCH through the API.

**verify_d1.py** (2026-09-05): content, not counts — whole strings table +
every column of all rows for 40 random order_ids + contracts_v output (~200
indexed queries; a full checksum would eat the daily read allowance).
Lessons: D1 answers JSON so REAL 819.0 comes back int 819 — compare numbers
as numbers with tolerance; NULL-vs-text sorting needs rank-tagged canon();
a test's fake remote must JSON-round-trip its rows or it hides exactly this
bug class. A local db rebuilt after the last upload means mismatches read
"stale", not "corrupt".

## THE BUILD SPEC — Mercy's eight rules (2026-08-23)

1. Collect all the relevant files (every report of every publisher).
2. One combined database, relevant data only.
3. Decide which data points we care about — `audit\FIELDS.xlsx` (v2, the
   schema constitution: every concept × five sources + her yellow החלטה
   column; build_dataset.py implements it, no script reads the xlsx).
4. Fill every cell that any source can fill; empty only when nothing has it.
5. **0 and empty are different — a 0 must never win over a number** (money
   zeros are held back unless NO source reports a figure).
6. One format per kind (dates → `2015-11-04`; a bare `2015` stays a year).
7. **NO computed averages** — volume/executed_per_year never enter the
   dataset. A year without a report is EMPTY.
8. **Missing is not zero.** `אין נתון באף מקור` ≠ `0 — כך דווח בכל המקורות`.

**SCHEMA — store reports, not years**: contract (keyed by order_id) →
merged identity fields + `allocations[]` (one per LIVE budget code) +
`reports[]` (as published, paid cumulative) + provenance. "Paid during
year Y" is a DISPLAY-time derivation that may honestly return EMPTY —
rule 7 applied to the schema. CADENCE monthly: reports publish late, get
REVISED (revision 0..2), and 82 publishers are out of step.

## THE MERGE — column by column, not row by row (Mercy's model, 2026-08-23)

"We can't just take this row from here and that row from there — we need to
go column by column and complete them as best we can, starting of course
with the order_id." So: UNION of orders (any source's order_id is a
contract) · every FIELD resolved on its own precedence, stamped with which
source won · allocations hang off the order. Precedence highlights (ours=
the ministry file, cs=contract_spending, qr=quarterly reports,
cd=contracts_data, ex/tn=registers):

| field | order | why |
|---|---|---|
| ספק | cs → ours → qr → ex | entity_id resolves spelling variants |
| מספר ח״פ | **ours** → cs → qr → ex | file 100% filled; bk company_id 75.5% |
| מטרה | **ours** → cs → qr | bk truncates; the file has the full text |
| היקף · שולם | **ours** → cs → qr → cd | bk drops the payment column on newer reports |
| תחילת התקשרות | **cd** → ex → cs | cs.start_date is 100% NULL |
| מספר פרסום | ours → cs → ex | file links at 54%, tender_key at 24% |
| אישור, גורם מאשר, לינק לטקסטים | ex | only the register |

Registers join per contract through candidates: the file's מספר פניית פרסום
first (SPLIT on non-digits; "0" means none), then bk's tender_key; a
multi-row publication prefers the matching ח"פ. File columns resolve
LOOSELY per spelling (exact keys are a trap; מטבע is exact so מטבע חשבונית
can't leak in). LOUD refusals: a register that joins zero contracts, or a
BudgetKey input that fills nothing, kills the build. Report identity is
(year, period) — NEVER the url (the same report is published on two hosts).

**DEDUP — snapshot vs pile.** The ministry file is a SNAPSHOT (one row per
allocation that exists as of that quarter); contract_spending is a PILE
(every allocation ever reported, dead codes included). Spine = order_id;
live allocations = the newest ministry file's (order, code) rows, summed
within an order (a genuine split must be summed); a bk row absent from the
newest file is HISTORICAL — kept, labelled, never totalled (a code move
must not be summed: the 3× trap on order 4501119831). No file yet → bk is
all we have; those totals carry a known upper-bound error.

## BUDGETKEY — what live probing established (2026-08-22/23, keep forever)

- **Use `contract_spending`, not `contracts_data`** — payments[] history,
  regulation verbatim, order_id on 100% of rows, budget_code already
  10-digit (`LIKE '<code>%'` is the whole join to raw_budget).
  contracts_data has no order_id and its volume_per_year is volume÷years
  wearing a measurement's name. The two do NOT match in totals — same
  origin, two crops; never present one as confirming the other.
- contracts_data.budget_code is dotted: strip dots, prefix `00`.
- Per-year figures don't always sum to the total — contracts get RESTATED
  downward mid-life. Totals use the contract's own executed.
- One order, several rows — never sum rows; aggregate by ORDER.
- **The bk paid-column bug:** ministries DO report paid; bk's parser misses
  the malformed headers and writes executed=0 from ~2024 on (₪7.8bn in one
  education file). Our merge fixes it (the file outranks bk on payment).
  Never claim "the government stopped reporting". Report to הסדנא (queued).
- **Source hierarchy:** two independent origins only — A: the ministries'
  quarterly .xlsx (bk's tables are ONE document processed four ways); B:
  the mr.gov.il registers (authorisation, not payments; most contracts
  never get a publication). R1 prefer closest to origin (the .xlsx has its
  own junk: 9999 placeholders, 8.5% no real method) · R2 bk-agrees-with-bk
  is not corroboration · R3 prefer the number a reader can go look at ·
  R4 prefer the NEWER report · R5 (Mercy's override) show the best
  available figure labelled with its source, say `לא דווח` in words, and
  total the unreported money so the hole is visible.

## THE PAGE'S PRECOMPUTED TABLES (2026-09-08 — the move off BudgetKey live)

The contractors page (`site\budget_page\contractors.html`) used to read
BudgetKey LIVE for its tiles, rankings, search and profiles — the worker
had no endpoints, and D1's economics forbade live aggregation (D1 bills
rows READ; "top suppliers of 2024" live = a ~1M-row scan per visitor).
The aggregates change AT MOST QUARTERLY, so they are precomputed at build
time and served dumb (worker v9: `/contractors/summary · top · exemptions ·
supplier · search`; tests `worker\wtest_contractors.mjs`, 27 asserts).

- **ctr_years** — per year: n in force · distinct suppliers · total volume
  · exempt slice · top-10 volume. The three tiles; a year switch is free.
- **ctr_top** — top 25 suppliers per (year, lens), lens ∈ {all, exempt}.
- **ctr_ex** — top 25 exemption citations per year (page shows 10).
- **ctr_sup** — one profile row per supplier: facts + `offices` (json
  per-ministry rollup) + `series` (json in-force per year) + `top` (json,
  25 largest contracts' order_ids). A profile = 1 read + 25 PK reads.
- **ctr_fts** — FTS5 over supplier name + purpose, order_id UNINDEXED.

**THE DEFINITIONS — the page's honesty rules, enforced IN THE BUILD**
(change one → change build_contractors.py + test_contractors.py + here):

- "In force in year Y" = first_year <= Y <= last_year AND first_year > 1990
  (junk years live at both edges: a junk MAX is an open-ended contract and
  is KEPT; a junk MIN would be "in force since 1899" and is excluded from
  every ranking and tile). Display still clamps to currentYear+20.
- Every contract counts IN FULL in every year it is in force — tiles,
  rankings and the profile chart share this one definition.
- "פטור ממכרז" is counted by the record's own words: the method field
  contains the phrase (the field is dirty; any cleaner taxonomy needs a
  ruling from Mercy first).
- The exemptions ranking requires BOTH: exempt method AND a citation
  containing "תקנה" (junk exists). Combos shown joined verbatim.
- Paid summed over only-unknowns is unknown (NULL), never 0.
- Supplier identity: sid = COALESCE(entity_id, supplier name) — entity_id
  is NULL on ~a quarter of bk rows and all file-only contracts; the two
  must never clump into one NULL giant.
- Rankings order by VOLUME; top 25 / top 10 shown; a profile shows the 25
  largest and says "מוצגות {n} מתוך {of}".

**SANITY (verified live at BudgetKey 2026-09-08):** 2024 in force 93,530 ·
total 210.4bn · exempt 66.7bn = 31.7% (41,180). Top citations: 3(16) ~30bn
· 3(5) ~9.6bn · 3(1) ~4.5bn/~22k · 3(29) ~1.87bn/2,236.
build-contractors.bat prints ours beside these — a LARGE gap means a
definition drifted: stop and tell Claude.

**Open-question answers (2026-09-08):** the "מדוע פטור?" popover keeps
reading BudgetKey live (our db lacks their long description/reason texts —
the mr export has no reason column; accepted interim — moving it means
ingesting procurement_tenders text first, then a `/contractors/pub?id=`
endpoint). Freshness rides the build: every full build refreshes the
tables; wiring the merge into CI (item 5) carries them for free.

## COLLECTION — where the raw sources come from (moved here 2026-09-08)

The scripts that COLLECT this dataset's raw sources — fetch_* · parse_* ·
inventory.py, IN THIS FOLDER since Mercy's by-DATASET ruling ("collection
is part of the contractors dataset"). The GitHub workflows run them BY
PATH (`pipeline/contractors/…`), so remember the standing rule: one of
these scripts changes TOGETHER with `workflows\*.yml` (+ run
setup\install-workflows.bat), and counts as done only after a green run.
Connect `workflows\` too when schedules/steps change.

### THE FILES ↔ THE WORKFLOWS

| script | run by | what |
|---|---|---|
| `fetch_reports.py` | refresh-data.yml (collect ministry reports, 1st monthly) | discovery via BudgetKey's report index (addresses only, no data), download, wayback recovery |
| `parse_report.py` / `parse_all.py` | refresh-data.yml | every report → `..\paid\<sec>.json` (lean) + `.full.json` (every column, the full-records artifact) — OLDEST FIRST |
| `inventory.py` | refresh-data.yml | the never-shrink guard: refuses to commit a collection that shrank |
| `fetch_budgetkey.py` / `fetch_budgetkey_all.py` | collect-budgetkey.yml (25th monthly) | contract_spending per budget section → build/raw → `budgetkey-raw` artifact |
| `fetch_portal_registers.py` / `parse_portal_export.py` | collect-portal-registers.yml (12th monthly) | mr.gov.il export zips → JSON (parser-version self-healing) |

Collection tests in `..\tests\` (test_fetch, test_merge, test_portal, test_publications,
test_budgetkey_all); refresh-data.yml runs test_merge + test_fetch as its
commit gate. Schedules + workflow lessons: `..\workflows\README.md`.

Mercy's frame, which governs collection: **"I want to have the dataset
separated until we have everything. no picking what we keep and what
dont."** The monthly job COLLECTS; it does not combine (the merge step is
the reserved commented slot in refresh-data.yml — open item 5).

### COLLECTION STATE (archive manifest 2026-09-09)

1,766 report files, 590 MB, 76 publishers, 2015–2026, in the permanent raw
archive (all 16 bundles). Remaining holes: ~444 wayback-untried urls +
~170 real failures (most retryable; browser last-mile queued).
failed.json / unreachable.json / manifest.json are committed into
`..\collection\` every run — the failure lists are DATA, not logs.
Repeated budget-limited runs CONVERGE: manifest+cache skip everything
already held. The old cache-eviction weakness is RETIRED (2026-09-09):
restore-reports refills an evicted Actions cache from the archive before
fetching, so eviction costs nothing — no re-downloads, no blocked hosts,
and the never-shrink guard can't trip on a publisher that merely failed to
re-fetch in time (seen live: 78 → 77 publishers, red run). `..\paid\`
staying tracked in git remains the parse-side safety net until phase 3.

### LESSONS THAT ARE NOW CODE (each cost a real bug)

**Four early retractions (2026-08-23), all "deciding what mattered too
early":** report URLs are NOT derivable (the dated form is not universal —
addresses must be looked up in BudgetKey's index; walk_quarters()/
probe_forward() are a supplement that found education Q2-2025, never the
source) · EVERY reachable report is downloaded, not "newest per publisher"
(a later report can list FEWER contracts, and per-year needs the series) ·
rows with paid=0 are KEPT (the ministry writes 0 when it means 0 — a fact,
not a blank) · collection does `SELECT *` (minus the two computed
averages), never a column subset chosen before anyone looked.

**Fetching:**
- Files are classified by BYTES, never extension (PK=xlsx, D0CF11E0=OLE2
  .xls — xlrd reads those); a block page saved as .xlsx would parse as an
  empty ministry, so non-spreadsheets are refused at save time.
- Only files whose size changed are re-downloaded; the skip check trusts
  `manifest[url].file`, never a recomputed filename.
- gov.il's BlobFolder serves files to a server; gov.il PAGES and ALL of
  foi.gov.il 403 servers. Wayback (`web.archive.org/web/2id_/<url>`)
  recovers the history: recovered files stamped via:"wayback", a snapshot
  fetched once and never replacing a good local copy; many "failures" are
  DEAD TWINS (`covered_by` in failed.json). The archive throttles and
  gov.il blanket-403s after heavy sweeps — blocks are runner-targeted and
  TEMPORARY: circuit breaker (15 consecutive connection failures rests the
  archive; a clean 404 is an ANSWER), 30s timeouts, direct downloads first,
  `--deadline-minutes 240` clean stop so a killed job never eats hours of
  downloads. At most one heavy run per day; the manifest makes patience
  free — never conclude "blocked forever" from one run.
- A report with no publisher would have overwritten its twin — filenames
  carry a URL fingerprint.

**Parsing:**
- Reports parse OLDEST FIRST by the report's own (year, period) — an
  alphabetical shell loop once rolled a cumulative figure BACKWARDS — and
  every file passes `--source-url` (why `sources` was once empty).
- Headers match LOOSELY (`"חשבוניות" in h and "מצטבר" in h`): the real
  headers carry typos, double spaces, stray apostrophes — exact matching
  is precisely what broke BudgetKey's paid column. Fail loudly if a column
  is missing; never write zeros.
- Two output shapes per section: lean `<sec>.json` (what a page would
  load) and `.full.json` (EVERY column under the ministry's own spellings,
  typos included — renaming would hide what an auditor wants to see).
  Sharded by BUDGET SECTION, not ministry (one report can span sections);
  key is `order_id:code` (one order, several codes).
- **The ss:Index rule** (the portal export): SpreadsheetML omits empty
  cells and the next cell names its true column — ignoring it shifted rows
  LEFT and put topic categories in the currency column. Cells are placed
  at declared positions; PARSER_VERSION in the manifest forces old
  conversions to be redone, never trusted. The export also lies twice
  (.xls extension over SpreadsheetML XML; declared utf-16 over utf-8+BOM)
  — parse_portal_export byte-patches a temp copy and STREAMS it. Register
  dates are DD.MM.YYYY with DOTS.
- Origin B is fully automatic: מינהל הרכש publishes monthly dated zips on
  a news page whose ?context= token rotates — the page is re-read every
  run, links never remembered. The data.gov.il register copy is FROZEN at
  2021-01-31 (kept only for a merge-time diff; its workflow stays dormant).

**Why GitHub Actions and not the relay (measured 2026-08-23):** the
container cannot reach next.obudget.org or workers.dev; WebFetch through
the relay hits a ~248-char URL ceiling and DISTINCT over the ~4M-row report
table times out — the queries short enough to pass are the ones that cannot
filter. Actions is the only route that worked. Non-DISTINCT + LIMIT probes
through the relay ARE instant — use them for spot checks. Discovery is per
budget section (indexed): `SELECT DISTINCT "report-url", publisher,
"report-year", "report-period" FROM quarterly_contract_spending_reports
WHERE budget_code LIKE '<sec>%' AND "report-year" = '<year>'`.

**Measured, do not re-derive:** report years run 2015–2026 (the workflow
asks 2022–2026) · sections are budget-code prefixes, not ministries
(0001..0099 sweep) · discovery rows are per url+publisher+year+period, not
URLs · GitHub caps: 100 MB/file enforced (why .full.json is an artifact),
Actions cache 10 GB/repo evicted after 7 idle days · the repo is PRIVATE
(no 60-day auto-disable; artifact downloads need Mercy's login).

## PIPELINE v2 — THE RAW ARCHIVE REDESIGN (plan settled with Mercy 2026-09-08)

Mercy's verdict on the current process: "many problems which we fix with a
ductape." Her three requirements, which ARE the spec:
1. ALL historical raw data kept in GitHub, before any merge.
2. The dataset (D1) updates WITHOUT her doing anything manually.
3. When a source is FIXED (a revised report), both the dataset and the
   historical record update — and the old revision is kept.

THE PRINCIPLE THAT REPLACES THE DUCT TAPE: the raw data gets ONE permanent,
complete home, and everything else is a machine that recomputes from it.
What that retires, by design rather than deletion-on-faith: the evicting CI
cache as a source of truth, the 90-day artifacts, the one-copy zip on
Mercy's disk, paid\'s insurance role, and every manual .bat in the monthly
loop (the .bats stay for local rebuilds and the audit).

### STORAGE (decided 2026-09-08)

- **GitHub Releases**, tag `raw-archive`, one rolling release. Releases are
  file storage attached to the repo, NOT git: 2 GB per asset, no expiry, no
  clone bloat, downloadable by browser and by workflows. (Git itself blocks
  >100 MB files and keeps every version forever — that is why the raw data
  can never be committed.)
- **In git**: `contractors\archive\manifest.json` — the table of contents:
  every archived report file with hash, source url, vintage, revision list.
  Grow-only (the guard's new baseline: an archive may only grow).
- **Assets on the release**:
  - `reports-<0..f>.zip` — 16 bundles of ministry report files keyed by
    content hash (`<hash16>__<name>`), bundle = first hex char of the hash.
    A REVISED report is a NEW entry beside the old one — every revision of
    every primary document, forever. (Today a revision overwrites the old
    download; v2 keeps what the ministry claimed before the fix — a story
    in itself for a transparency site.)
  - `portal-YYYYMMDD-*.zip` — each monthly mr.gov.il export, dated, forever
    (primary Origin-B documents, ~25 MB/month).
  - `budgetkey-latest.zip` (+ `budgetkey-previous.zip`) — BudgetKey is a
    SECONDARY source (their scrape of the same reports) and changes
    wholesale monthly at ~180 MB, so only current+previous are kept.
    FLAG: Mercy has not explicitly ruled on this one — confirm before
    phase 3 retires anything.
  - `db-current.sqlite.gz` + `db-previous.sqlite.gz` — the TWO-database
    rolling window (Mercy: keep last month "until the next pull, to be
    safe"). Each verified monthly upload shifts the window; nothing older
    is kept — any past state is reconstructible from archive + old code.
  - `legacy-*.zip` — Mercy's hand-uploaded bootstrap files (see below).

### THE PHASES (each lands only on a green run; the old process keeps
working until its replacement is proven)

**PHASE 1 — the archive (after this, nothing can be lost anymore):**
- `contractors\archive.py` (stdlib): `ensure-release` · `ingest-reports`
  (hash new/changed files into bundles, update the manifest, upload changed
  bundles) · `upload-file` (dated or rotate-replace assets) · grow-only
  manifest guard · `--dry-run` for tests.
- Wire in: refresh-data.yml archives the reports right after fetching;
  collect-portal-registers uploads each new export zip; collect-budgetkey
  rotates budgetkey-latest/previous. Collectors gain
  `permissions: contents: write` for the release API.
- `bootstrap-archive.yml` (manual, re-runnable): creates the release and
  ingests whatever the reports cache still holds. URGENT: the cache is the
  only place the raw .xlsx exist and it evicts — run this FIRST.
- Mercy's one manual bootstrap: drag from `contractors\inputs\` onto the
  release page as `legacy-` assets: full-records.zip (the parsed full rows
  — for any report whose raw file already evicted, this is the only trace),
  budgetkey-raw.zip, the two portal export folders' files. Browser uploads
  up to 2 GB work.

**PHASE 2 — the automated monthly build (requirement 2):**
- One workflow chain: collect into the archive → parse FROM the archive
  (always complete) → merge PER-SECTION (the 1.5 GB in-memory merge may not
  fit a 7 GB runner — measure first) → build_sqlite + build_contractors →
  DELTA vs db-current by fingerprints (build_sqlite --delta-against exists,
  never wired) → apply only new/changed/gone rows to D1 via the REST flow
  (needs a delta-apply mode in shared\upload_to_d1.py: INSERT OR REPLACE /
  DELETE, verified by row counts as always) → on verification, rotate
  db-current/previous. Secrets: CF account/db/token as repo secrets.
- The old full-upload path stays as the recovery tool.

**PHASE 3 — retire the duct tape (only after phase 2 is green):**
- paid\ loses both jobs (the raw archive is a strictly better permanent
  record; the guard moves to the archive manifest) — retire it together
  with its workflow steps. The lean per-section docs the budget page once
  read are long unused.
- The artifact-download ritual, the "THE ONLY COPY never delete" zip fear,
  and the manual build/upload loop all end. Mercy's inputs\ zips become
  ordinary local copies.
- Item 5 of the old plan is superseded by phase 2.

### STATUS (2026-09-09)

- **PHASE 1 LIVE AND SELF-FEEDING.** Bootstrap + the first archiving
  refresh-data run are green; verified in the committed manifest: 1,766
  report files, 590 MB, 76 publishers, 2015–2026, spread over all 16
  bundles. The legacy assets are on the release; the CF_* repo secrets are
  set and PROVEN (check-credentials). Nothing can be lost anymore.
- **PHASE 2 BUILT; ITS FIRST FULL RUN IS IN FLIGHT** (started 2026-09-09).
  The build side is already proven on the runner: fetch-inputs → streaming
  merge → both dbs → dump all ran clean — **987,090 contracts** (the
  month's growth over 986,942), all ctr_* tables, 26 parts / 1,350 MB.
  What the in-flight run still has to prove is the upload itself.
  **WHEN IT GOES GREEN:** uncomment the schedule (3rd monthly) in
  build-and-update.yml in the same commit that records the green; the run
  also puts the ctr_* tables + ctr_fts live in D1 (the manual upload .bats
  become the recovery path), and PHASE 3 (retiring paid\ + the manual
  loop) unblocks. **IF IT WENT RED:** read the failed step's log — the
  build is deterministic, so re-running after a fix is always safe.
- The first run failed four times; each failure is now code + a test
  (test_archive.py 15 asserts, test_pipeline2.py 23 asserts, all green):
  1. **A bare HTTP 500 downloading a bundle killed fetch-inputs** —
     GitHub's release API hiccups and archive.py had no retry (the
     fetcher's patience lesson, unapplied). Now `_with_retries` in
     archive.py: 5xx/429/timeouts/drops retried with growing waits
     (10s→240s, ~8 min patience, loud death after); a clean 404 is an
     ANSWER, never retried; a download reopens its file per attempt (no
     truncated bundles); a double-landed upload (422 after a retried POST)
     is replaced cleanly. Wraps EVERY archive API call, so the collectors
     inherit it. (Skipping the fetch "since D1 has the data" was
     considered and rejected: D1 holds the OUTPUT; the merge needs the raw
     inputs — the delta already avoids re-sending what D1 has.)
  2. **Wrong CF_* secrets surfaced as a 401 only at upload time, 40
     minutes in** — now `check-credentials` (read-only SELECT 1 proving
     account + database + token in seconds) is build-and-update.yml's
     FIRST step, and `check-credentials.bat` proves the local
     d1-config.json values (verify-d1.bat can't serve that job: it needs
     out\contracts-public.db, which v2 builds on the runner, not on
     Mercy's disk).
  3. **check-credentials.bat then died locally on ModuleNotFoundError:
     openpyxl** — pipeline2's top-level import chain pulled in the
     spreadsheet parser. parse_all (the ONE third-party import) now loads
     inside build(); every other subcommand runs on bare Python (the
     zero-install rule). Found while testing: materialize_reports fills a
     missing manifest `size` from the extracted file — an entry without
     one would make the fetcher re-download the whole restored archive.
  4. **The public db's VACUUM died on `database or disk is full`** — the
     runner's ~14 GB held EVERY stage at once (downloaded inputs + parsed
     JSONs + section files + full db + public db) just as in-place VACUUM
     asked for a full temp copy + journal on top (~3x that db). Three
     fixes, layered: `build --scrub` (passed ONLY by the workflow —
     a local build keeps its intermediates) deletes each stage's files
     the moment the chain is past them; `build_sqlite._vacuum_close`
     compacts via `VACUUM INTO` + swap (~2x peak instead of ~3x, both
     dbs); and the workflow's new first step drops ~25 GB of preinstalled
     toolchains (dotnet / android / ghc / CodeQL) the job never uses.
- **FLAG still open for phase 3:** Mercy has not ruled on keeping only
  budgetkey-latest/previous — confirm before retiring anything.

## WHAT COMES NEXT

- **Close out phase 2** (this dataset, `contractors\` + `workflows\`):
  confirm the in-flight first run went green → uncomment the schedule →
  phase 3 (retire paid\ + its workflow steps + the manual monthly loop;
  get Mercy's budgetkey-retention ruling first). The green run is also the
  live proof of FTS5 on D1 — a real MATCH through the API.
- **The front-end swap** — a budget_page session (connect
  `site\budget_page\` + `site\shared\`): move `contractors.data.js` from
  BudgetKey SQL to the `/contractors/*` endpoints and move the Playwright
  mocks (test_contractors.mjs, 77 asserts) from SQL to worker routes. Read
  `site\budget_page\NOTES.md` first — the current queries are the exact
  spec. Until then the live page reads BudgetKey and nothing breaks.
- (Old "item 5" — wiring the merge into refresh-data.yml — is SUPERSEDED
  by phase 2: build-and-update.yml is that wiring, done properly.)
- `contracts_data` stays uncollected (no order_id). Look at its shape
  before writing anything.
