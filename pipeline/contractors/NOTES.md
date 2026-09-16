# NOTES — contractors dataset (pipeline\contractors\)

Collection, raw archive, merge → build → D1, the contractors page's
precomputed tables. Serving = `worker\`.

## Files
| file | role |
|---|---|
| `build_dataset.py` | THE MERGE (implements FIELDS.xlsx v2) |
| `build_database.py` + `build-database.bat` | local build: unpack `inputs\` → merge → both dbs → build_contractors last |
| `build_contractors.py` + `build-contractors.bat` | ctr_* tables + ctr_fts into `out\contracts-public.db`; prints SANITY — read it |
| `upload-to-d1.bat` (`..\shared\upload_to_d1.py`) | full D1 upload, count-verified parts; memory `..\build\d1\` |
| `upload_contractors.py` + `upload-to-d1-contractors.bat` | ctr_* + FTS only (minutes); memory `..\build\d1\ctr\`; ends with a real MATCH |
| `verify_d1.py` + `verify-d1.bat` | D1 content vs local db |
| `check-credentials.bat` | proves `..\d1-config.json` against D1, read-only, seconds |
| `clean-up.bat` | deletes rebuildables (~10 GB), lists first; spares inputs\, out\ |
| `archive.py` | raw-archive client: ensure-release · ingest-reports · upload-file · `--dry-run`; grow-only manifest; retries |
| `pipeline2.py` | build-and-update.yml chain: fetch-inputs · build · update-d1 · rotate-baseline · restore-reports · check-credentials. Bare Python except build() |
| `fetch_reports.py` | refresh-data: discover via BudgetKey report index, download, wayback |
| `parse_report.py` / `parse_all.py` | refresh-data: reports → `..\paid\<sec>.json` + `.full.json`, OLDEST FIRST |
| `inventory.py` | refresh-data: never-shrink guard |
| `fetch_budgetkey(_all).py` | collect-budgetkey.yml |
| `fetch_portal_registers.py` / `parse_portal_export.py` | collect-portal-registers.yml |
| `fetch_publications.py` | collect-publications.yml (dormant) |
| tests | test_contractors 25 · test_upload_dump 13 · test_archive 15 · test_pipeline2 23 · `..\tests\`: test_merge 67 (run BY PATH — don't move) + test_fetch = refresh-data's commit gate; test_portal, test_publications, test_budgetkey_all |
| `inputs\` | source zips + register exports (gitignored; README inside; legacy copies on the release). `publications-register.zip` + the 07082026 portal exports can't be downloaded again |
| `out\contracts-public.db` | THE OUTPUT (gitignored) |

## State — last verified upload; rewrite from phase 2's green log
- 986,942 contracts: file-only 43,013 · BudgetKey-only 473,616 · both 470,313.
  Phase-2 build (2026-09-09): 987,090.
- D1: strings 6,219 · allocations 1,058,220 · reports 2,924,853 · contracts
  986,942 · 10 indexes · contracts_v (ctr_* land with phase 2).
- contracts-full 2,332 MB · public 1,345 MB → D1 paid (10 GB/db; free 500 MB,
  5M reads/day). Levers: move `reports` out, normalize more.
- Only 7% of contracts carry a publication number; 62% of those join a register.

## Two databases (one build)
- `..\build\contracts-full.db`: every field + per-field provenance + sha256
  fingerprint + embedded register rows. Intermediate; audit reads it;
  fingerprints drive `build_sqlite --delta-against`.
- `out\contracts-public.db`: no provenance/fingerprints (`sources`+`notes`
  kept); 13 low-cardinality text columns dictionary-encoded into `strings`,
  `contracts_v` decodes. + ctr_* + ctr_fts.

## Build spec — Mercy's rules (FIELDS.xlsx v2)
1 every report of every publisher · 2 one combined db · 3 fields per FIELDS.xlsx
· 4 fill every cell any source can · 5 0 ≠ empty; a 0 never beats a number ·
6 one format per kind (`2015-11-04`; bare `2015` stays a year) · 7 NO computed
averages; a year without a report is EMPTY · 8 missing ≠ zero
(`אין נתון באף מקור` ≠ `0 — כך דווח בכל המקורות`).
Schema stores REPORTS, not years: contract (order_id) → merged fields +
`allocations[]` (LIVE codes) + `reports[]` (as published, paid cumulative) +
provenance. "Paid in year Y" is display-time and may be EMPTY. Reports come
late and get revised (rev 0..2); 82 publishers out of step → monthly cadence.

## Merge — column by column
UNION of orders; each field resolved by its own precedence, stamped with the
winner. ours=ministry file · cs=contract_spending · qr=quarterly reports ·
cd=contracts_data · ex/tn=registers.

| field | order | why |
|---|---|---|
| ספק | cs → ours → qr → ex | entity_id resolves spelling variants |
| מספר ח״פ | ours → cs → qr → ex | file 100%; bk 75.5% |
| מטרה | ours → cs → qr | bk truncates |
| היקף · שולם | ours → cs → qr → cd | bk drops paid on newer reports |
| תחילת התקשרות | cd → ex → cs | cs.start_date 100% NULL |
| מספר פרסום | ours → cs → ex | file 54%, tender_key 24% |
| אישור, גורם מאשר, לינק לטקסטים | ex | register only |

- Register join: file's מספר פניית פרסום (split on non-digits; "0" = none),
  then bk tender_key; multi-row publication prefers matching ח"פ.
- File columns match loosely per spelling (מטבע exact, so מטבע חשבונית can't leak).
- LOUD: a register joining zero contracts or a BudgetKey input filling nothing kills the build.
- Report identity = (year, period), never url (same report on two hosts).
- Dedup: ministry file = SNAPSHOT; cs = PILE (dead codes too). Live
  allocations = newest file's (order, code) rows, summed within order. bk row
  absent from newest file = HISTORICAL: kept, labelled, never totalled (3×
  trap, order 4501119831). No file → bk only, totals are an upper bound.

## BudgetKey facts (probed live — don't re-derive)
- Use `contract_spending` (payments[], regulation verbatim, order_id 100%,
  10-digit budget_code). `contracts_data`: no order_id, volume_per_year =
  volume÷years, dotted codes (strip dots, prefix `00`), totals differ — never
  corroboration; stays uncollected.
- Rows may be restated downward → totals use the contract's own executed.
  Several rows per order → aggregate by ORDER, never sum rows.
- Paid-column bug: bk writes executed=0 from ~2024 (malformed headers;
  ₪7.8bn in one education file). Ministries DO report; our merge fixes it.
  Never say "the government stopped reporting".
- Two independent origins only: A ministry quarterly .xlsx (bk = one doc
  processed four ways; xlsx junk: 9999 placeholders, 8.5% no real method),
  B mr.gov.il registers (authorisation, not payments). R1 closest to origin ·
  R2 bk-agrees-with-bk ≠ corroboration · R3 prefer a number a reader can check ·
  R4 newer report · R5 show best figure labelled by source, say `לא דווח`,
  total the unreported money.
- Relay: DISTINCT over the ~4M-row report table times out; non-DISTINCT +
  LIMIT instant. Collection runs in GitHub Actions (cloud can't reach
  BudgetKey). Discovery per section: `SELECT DISTINCT
  "report-url", publisher, "report-year", "report-period" FROM
  quarterly_contract_spending_reports WHERE budget_code LIKE '<sec>%' AND
  "report-year" = '<year>'`.

## D1 uploader — trust row counts, never status words
- REST import (init md5-etag → PUT → ingest → poll), stdlib only.
- Poll "Not currently importing anything." = done OR rolled back → every part
  count-verified vs the dump manifest; verified parts in `build\d1\state.json`
  skip on re-run; polls saved to `last-poll.json`.
- Parts ~30 MB (120 and 60 MB died in D1 storage: "exceeded timeout… reset").
  `import_part` retries transient errors 3×/90s; `import_verified` re-imports
  ≤3× when counts show rollback. Bad SQL/auth dies at once.
- Our-side kill leaves the import running (no cancel): `init_when_free` waits
  (30s polls, ≤4h); `already_applied` counts before uploading.
- Each CREATE INDEX/VIEW in its own part (ten in one blew CPU); `verify()`
  checks sqlite_master; 400 "no such table" before landing = not yet (`soft=True`).
- INSERTs ≤60,000 BYTES (Hebrew 2/char); loud error >80 KB/row.
- FTS5: dump ships CREATE VIRTUAL TABLE + INSERTs, skips shadow tables; FTS
  parts ≤30 MB; `dump(only="ctr_")` for the targeted upload.
- Any byte change in the public db → fresh dump + FULL re-upload.
- verify_d1: whole strings + every column of 40 random order_ids + contracts_v
  (~200 indexed queries). D1 returns REAL 819.0 as 819 → compare numbers with
  tolerance; NULL-vs-text sort needs rank-tagged canon(); test fakes must
  JSON-round-trip. Db rebuilt after upload → mismatches mean stale.

## Contractors page tables (served by worker v9; the page still reads BudgetKey)
Aggregates change ≤ quarterly → precomputed; D1 bills row READS.
- `ctr_years` per year: n in force · distinct suppliers · volume · exempt slice · top-10 volume.
- `ctr_top` top 25 suppliers per (year, lens ∈ all|exempt) · `ctr_ex` top 25 citations/year (page shows 10).
- `ctr_sup` one row/supplier: facts + `offices` json + `series` json + `top` json (25 order_ids).
- `ctr_fts` FTS5 over supplier + purpose, order_id UNINDEXED.
DEFINITIONS (change → build_contractors.py + test_contractors.py + here):
- In force in Y: first_year ≤ Y ≤ last_year AND first_year > 1990 (junk MAX
  kept as open-ended; junk MIN excluded). Display clamps to currentYear+20.
- A contract counts IN FULL in every year in force (tiles, rankings, chart).
- פטור ממכרז = method field contains the phrase (dirty field; cleaner taxonomy needs Mercy).
- Exemptions ranking needs exempt method AND citation containing "תקנה"; combos joined verbatim.
- Paid over only-unknowns = NULL, never 0.
- sid = COALESCE(entity_id, supplier) (entity_id NULL on ~¼ of bk rows + all file-only).
- Order by VOLUME; profile shows 25 largest + "מוצגות {n} מתוך {of}".
SANITY (BudgetKey live 2026-09-08): 2024 in force 93,530 · 210.4bn · exempt
66.7bn = 31.7% (41,180). Citations 3(16) ~30bn · 3(5) ~9.6bn · 3(1)
~4.5bn/~22k · 3(29) ~1.87bn/2,236. Large gap = a definition drifted — stop.
"מדוע פטור?" stays on BudgetKey (moving needs procurement_tenders text + a
`/contractors/pub?id=` endpoint).

## Collection
Mercy: "keep the dataset separated until we have everything. no picking what
we keep and what dont." Collection never combines.
- Archive manifest 2026-09-09: 1,766 report files, 590 MB, 76 publishers,
  2015–2026. Holes: ~444 wayback-untried urls + ~170 real failures (browser
  last-mile queued). `..\collection\*.json` committed each run — failure lists
  are DATA. restore-reports refills an evicted cache from the archive.
- Download EVERY reachable report (later ones can list fewer contracts);
  report URLs are NOT derivable (use BudgetKey's index; walk_quarters/
  probe_forward only supplement); keep paid=0 rows; `SELECT *` minus the two
  computed averages.
- Classify by BYTES (PK=xlsx, D0CF11E0=.xls via xlrd); refuse non-spreadsheets
  at save. Re-download only on size change (trust `manifest[url].file`).
  Filenames carry a URL fingerprint.
- gov.il BlobFolder serves servers; gov.il pages + all foi.gov.il 403 them.
  Wayback `web.archive.org/web/2id_/<url>` recovers (`via:"wayback"`, never
  replaces a good copy); many failures are DEAD TWINS (`covered_by`). Blocks
  are temporary: circuit breaker at 15 consecutive connection failures (404 =
  an answer), 30s timeouts, `--deadline-minutes 240`, ≤1 heavy run/day.
- Parse OLDEST FIRST by (year, period); always pass `--source-url`.
- Headers match LOOSELY (`"חשבוניות" in h and "מצטבר" in h`); missing column
  → fail loudly, never write zeros.
- lean `<sec>.json` + `.full.json` (every column, ministry spellings kept).
  Shard by BUDGET SECTION; key `order_id:code`.
- Portal export: ss:Index — empty cells omitted, next cell declares its column
  → place cells at declared positions; PARSER_VERSION forces reconversion.
  .xls name over SpreadsheetML; declared utf-16 is utf-8+BOM → byte-patch a
  temp copy, stream. Dates DD.MM.YYYY. Page `?context=` token rotates → re-read
  every run. data.gov.il register frozen at 2021-01-31.
- Measured: years 2015–2026 (workflow asks 2022–2026) · sections = code
  prefixes 0001..0099 · GitHub 100 MB/file · cache 10 GB, evicted after 7
  idle days · repo PRIVATE.

## Pipeline v2 — raw archive
Mercy's spec: all raw history in GitHub before any merge · D1 updates with no
manual step · a fixed source updates dataset + history, old revision kept.
- Storage: GitHub Release `raw-archive` (2 GB/asset, no expiry). In git:
  `archive\manifest.json` (hash, url, vintage, revisions; grow-only = guard
  baseline). Assets: `reports-<0..f>.zip` (`<hash16>__<name>`, bundle = first
  hex; revision = new entry) · `portal-YYYYMMDD-*.zip` forever ·
  `budgetkey-latest/previous.zip` · `db-current/previous.sqlite.gz` ·
  `legacy-*.zip`. FLAG: Mercy hasn't ruled on keeping only 2 budgetkey
  copies — ask before phase 3 retires anything.
- Phase 1 LIVE: collectors feed the archive; CF_* secrets proven.
- Phase 2 `build-and-update.yml`, first full run in flight. Job BUILD
  (check-credentials FIRST → fetch-inputs → parse → streaming merge → dbs →
  public db as 7-day artifact) → job UPLOAD (delta by fingerprints, or full →
  rotate baseline LAST). Upload failure → "Re-run failed jobs" (same db →
  same parts; landed parts skip). D1 keeps last month through failures.
- Lessons (all code + tests): release API 500s → `_with_retries` on every
  archive call (5xx/429/timeouts, 10s→240s; 404 never retried; download
  reopens file; 422 after retried POST replaced) · bad secrets → check first ·
  openpyxl import only inside build() · `materialize_reports` fills a missing
  manifest size (else full re-download) · runner disk full → `build --scrub`
  (workflow only), `VACUUM INTO` + swap, drop ~25 GB unused toolchains · D1
  part failures → uploader rules above.
- Phase 3 (after green): retire paid\ + its steps + the manual monthly loop;
  guard moves to the archive manifest.

## Open
- Phase 2 green → uncomment schedule (3rd monthly) same commit → rewrite
  State → phase 3 (ask Mercy about the 2 budgetkey copies first).
- Front-end swap is a site chat (`site\budget_page\` + `site\shared\`).
