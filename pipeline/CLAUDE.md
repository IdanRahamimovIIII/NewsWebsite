# CLAUDE.md — THE DATA PIPELINE (pipeline\)

Notes from Claude to Claude (and Mercy) for chats about collecting, merging,
building and uploading the contracts database. This is the PIPELINE zone of
NewsWebsite; the website (`site\`) and the relay (`worker\`) have their own
CLAUDE.md. For pipeline work connect the `pipeline` folder — everything is
under it. **Paths in this file are relative to `pipeline\`** (`tools/…`,
`tests/…`, `build/…`, `reports/…`) unless they start with `site/`, which is
the zone beside this one.

## THE RULE THAT GOVERNS THIS FILE

Keep it honest and CURRENT. Whenever work in a chat proves a conclusion here
wrong, outdated, or incomplete — update or delete it in the same chat, and
date the change. A wrong "conclusion" is worse than none. This is distilled
knowledge, not a log: once a story is settled, keep the conclusion and the
lesson, drop the play-by-play. (Cleaned on this rule 2026-08-25; split into
per-zone files 2026-09-05, both at Mercy's request; full history in git.)

**Standing rules (Mercy's, non-negotiable):**

- **Nothing is frozen — "everything can be changed if needed" (Mercy,
  2026-09-05), superseding the old FROZEN rule.** What replaces it: a file the
  running workflows use changes TOGETHER with the workflow (same chat, same
  commit: edit `workflows\*.yml`, run `setup\install-workflows.bat`), and the change counts as done only
  after a green run. The old rule's origin still stands as a lesson —
  Origin-B drafts once touched pipeline files without the workflow following,
  and all were reverted.
- **Collect raw, keep sources separate.** The merge is a separate,
  re-runnable computation; raw is kept forever, so schema choices are
  reversible. No BudgetKey row ever stands in for a ministry file during
  COLLECTION — accepted last resort at MERGE time only, labelled, for
  reports gone from the whole internet.
- **The workflows' SOURCE is `pipeline\workflows\*.yml`** (since 2026-09-06 —
  Mercy: a pipeline chat must see what is in `.github`). `.github\workflows\`
  at the repo root is GitHub's required location and a generated COPY: the
  device bridge cannot write there, so `pipeline\setup\install-workflows.bat`
  copies changed files across (stripping a stray BOM). Edit the source → run
  the installer → commit BOTH → push → green run = done.
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


(The block above is the canonical text from the root CLAUDE.md, repeated here
because a zone session never sees the root — if it changes, change it in all
four files: root, site\, pipeline\, worker\.)

## LAYOUT CHANGE 2026-09-05 — read before trusting any path below

```
pipeline\
├─ CLAUDE.md        this file
├─ build-database.bat  upload-to-d1.bat  verify-d1.bat  publish-paid.bat  clean-up.bat
│                   Mercy's double-click actions — each runs tools\<script>.py
├─ tools\           the Python: fetch_* · parse_* · build_dataset · build_sqlite ·
│                   build_database · upload_to_d1 · verify_d1 · inventory · publish_paid
├─ paid\            THE MINISTRY DATASET: <section>.json × 52 + index.json (tracked in git;
│                   refresh-data.yml regenerates + commits monthly and publishes to KV;
│                   publish-paid.bat does the same from here). .full.json never here.
├─ collection\      the collector's records, committed by refresh-data.yml: inventory.txt
│                   (read back as the never-shrink guard) · manifest.json · failed.json ·
│                   unreachable.json. No page reads them.
├─ audit\           THE WHOLE AUDIT KIT (since 2026-09-06, its own NOTES.md): audit.bat ·
│                   audit_server.py · compare.html · paidcheck.html · cmp_audit.mjs · cmp.mjs ·
│                   check_paid.mjs · fixtures-paid.json — a chat about checking the output
│                   connects THIS folder only. FIELDS.xlsx (the schema constitution: every
│                   field × every source + Mercy's rulings) lives here too — Mercy moved it
│                   2026-09-06; no script reads it, build_dataset.py implements it.
├─ tests\           test_*.py (import from ../tools)
├─ workflows\       THE SOURCE of the four GitHub automations (+ README.md with the
│                   schedule table); .github\workflows at the repo root is a generated copy
├─ setup\           install-workflows.bat/.ps1 — copies workflows\*.yml into .github\workflows
├─ build\           the work area (rebuildable); build\d1\ manifest + state are the
│                   uploader's memory — clean-up.bat spares them. build\contracts-full.db =
│                   the FULL database (provenance, registers), a build INTERMEDIATE the
│                   audit reads and clean-up.bat deletes (since 2026-09-06)
├─ inputs\          full-records.zip · budgetkey-raw.zip · publications-register.zip ·
│                   Exemptions-07082026\ · Tenders-07082026\              (gitignored)
├─ out\             contracts-public.db — THE ONE OUTPUT, the D1 upload      (gitignored)
└─ d1-config.json   Cloudflare ids + API token                              (gitignored)
```

- Everything pipeline-related moved under `pipeline\` (Mercy: "nothing is
  frozen, everything can be changed if needed"). The four workflows were
  rewritten with `pipeline/…` paths, each with an "adopt the old cache"
  step so the 552 MB reports cache and the BudgetKey/portal caches are moved,
  not re-downloaded, on the first run after the move. Their source is
  `workflows\*.yml` in this folder — read those, never guess what `.github`
  holds; the three old `install-*.ps1` with YAML here-strings are gone.
- Older notes below that say "at the root", "in the project folder",
  `build/…`, `reports/…` mean the folders above. `.db` files → `out\`;
  zips and export folders → `inputs\`. `build_database.py` searches
  `inputs\` first and the old places second, so a stray copy still works.
- The launchers live HERE now (Mercy, 2026-09-06: "why should any of them be
  in the main folder") — older notes saying `build-database.bat (root)` etc.
  mean `pipeline\build-database.bat`; `audit.bat` is `pipeline\audit\audit.bat`.
- **ONE database output (Mercy, 2026-09-06 — "feed you less data", not disk
  space).** She deleted both `.db` files that day. `build-database.bat` now
  writes `out\contracts-public.db` only; the full database it derives that
  from (provenance per field, register rows) is `build\contracts-full.db`,
  an intermediate — rebuilt by every build, deleted by clean-up.bat, read by
  `audit\audit.bat`. Older notes saying `contracts.db` / `out\contracts.db`
  mean that file. Facts that survive the deletion: collection skips by its
  own manifest + Actions cache (never a db); the uploader's memory is
  `build\d1\state.json` + D1 row counts; the future monthly delta needs
  LAST month's full db or last month's `inputs\` zips at update time —
  keep one of them the month item 5 gets wired. `serve.bat` (+ serve.mjs/.ps1) lives in
  `scripts\` at the project root; `get-photos.bat` + `fetch_photos.py` live in
  `site\` (their notes: `site\CLAUDE.md`, `site\mk\NOTES.md`).
- The front-end Playwright tests live in `site\tests\`. **The audit is all
  in `audit\`** (page, server, .bat, its three tests, NOTES.md) — `audit_server.py`
  serves `audit\` at `/` and mounts the website at `/site/` (the pages load
  `/site/shared/…`, `/site/config.js`, `/site/data/paid/…`; `window.BASE`
  is `/site/` so the nav still reaches the pages). Older notes saying
  `site/tools/compare.html` or `tools/compare.html` mean `audit/compare.html`.
  The "without audit.bat" fallback mode still exists (tests/cmp.mjs drives
  it) but `serve.bat` no longer serves the page — audit.bat is the way in.
- Workflow changes: edit `workflows\<name>.yml`, run `setup\install-workflows.bat`
  (the bridge cannot write `.github\`), commit both, and it is done when the
  run is green.
- **refresh-data.yml v2026-09-06 (installed, awaiting its first green run):**
  parses into `pipeline/paid`, inventory + failure lists into
  `pipeline/collection`, publishes to KV (NOTE-and-skip without the
  secrets), commits `pipeline/paid` + `pipeline/collection` and removes
  `site/data` from the index for good. `paid\` stays TRACKED on purpose:
  `parse_all.py` merges into last month's documents, so a section whose
  report became unreachable keeps its figures — and the reports cache is
  evicted after 7 unused days with a monthly schedule, so that case is the
  normal one, not the exception (write this down as a known weakness: every
  monthly run re-downloads what the cache lost).

## WHAT THIS ZONE HANDS TO THE OTHERS (the interface — keep the other side in sync)

- **To the site, through Cloudflare (since 2026-09-06 — the site keeps NO
  data, Mercy's rule):** the ministry-report paid overlay is ITS OWN
  DATASET in KV, written by `tools/publish_paid.py` (monthly from
  refresh-data.yml with the repo secrets `CF_API_TOKEN` + `CF_ACCOUNT_ID`;
  by hand with `publish-paid.bat`, same d1-config.json token + "Workers KV
  Storage: Edit"). Keys `pub:paid/index` = `{t, data:{sections:[…]}}` and
  `pub:paid/<section>` = `{t, data:{sources:[url…], reports:{slug:"2025Q1"},
  orders:{"<order_id>:<10-digit code>":[paid, volume]}}}` — the old
  `paid\<section>.json` verbatim inside the relay's envelope. The worker
  serves them as `/data/paid/index` + `/data/paid/<section>`
  (`servePublished`, worker v7). The budget page reads exactly that
  (`site\budget_page\budget.data.js attachReportedPaid()`); `.full.json` is
  an Actions artifact + `inputs\full-records.zip`, never published. Why a
  separate dataset and not D1 (Mercy, 2026-09-06): the page needs a whole
  section in one document; D1 would meter thousands of rows per visit and
  only changes when the db is rebuilt by hand. The publisher reads every key
  back and compares (never trust status words), then asks the relay.
  `collection\` (inventory + failure lists) is committed to git under
  `pipeline\`, nothing under `site\` any more.
- **To the worker (D1):** tables `strings`, `allocations`, `reports`,
  `contracts` + view `contracts_v` + 10 indexes, uploaded by
  `upload-to-d1.bat`. The worker's future `/contract?id=` and
  `/supplier?hp=` endpoints read `contracts_v`. Column list = FIELDS.xlsx v2
  as built by `build_sqlite.py --public`. Change the schema → tell
  `worker\CLAUDE.md`.
- **From the worker:** the relay's `/b64/<base64url>` path is how Claude
  probes BudgetKey live (URL ceiling ~248 chars; no DISTINCT over big tables).

## WHERE THE PIPELINE STANDS — the sequence agreed with Mercy 2026-08-25

(Items 1–4 are DONE — see "THE CONTRACTS DATABASE — CURRENT STATE" below for
the build, the D1 upload and the verifier. Item 5 is the open one.)

**The immediate sequence, agreed with Mercy 2026-08-25:**

1. Mercy: commit+push; buy Workers Paid ($5/mo — her call: ONE bootstrap
   month, keep only if still needed at project end); run "collect
   budgetkey" in Actions, re-running until it reports nothing remaining;
   download the `budgetkey-raw` artifact into `_inputs\`.
2. Claude: rebuild the dataset with all three sources → `contracts.db`
   (full, audit) + `contracts-public.db` (D1 upload).
3. One-time D1 bootstrap + worker endpoints (`/contract?id=`,
   `/supplier?hp=`). CALLS RULES: D1 bills rows READ — every endpoint must
   hit an index (a full scan on 513K rows costs 513K reads), Cache API on
   the worker so repeats never reach D1, LIMIT on every list endpoint.
4. ~~compare.html overhaul~~ **DONE 2026-08-25 — the audit tool is built:**
   - **`build-database.bat`** (root) → `tools/build_database.py`: the whole
     build on HER machine, one double-click — finds `_inputs\full-records.zip`, the
     register JSONs (gunzips the .gz), `_inputs\budgetkey-raw.zip` when it exists
     (loud NOTE when it doesn't), and produces `contracts.db` (full: audit
     + registers embedded, ~765 MB — too big for the bridge, hence local
     build) and `contracts-public.db` in `_out\`. Needs python; the .bat
     says what to install if missing.
   - **`audit\audit.bat`** → `audit/audit_server.py` (both in `audit\` since
     2026-09-06): stdlib http.server + sqlite3, serves audit\ on :8081 plus
     read-only `/audit/*` endpoints (status · contract?id= · search?q= ·
     register?pub= · random) from the FULL db (`build\contracts-full.db`). CORS open so serve.bat-served pages can reach it too. GOTCHA
     fixed: http.server decodes the request line latin-1 — Hebrew query
     args need the latin-1→utf-8 round-trip.
   - **`audit/compare.html` BUILD 2026-08-25a**: probes /audit/status
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
   - Tests (in `audit\` since 2026-09-06): `cmp.mjs` (fallback mode) +
     **`cmp_audit.mjs`**: builds a tiny db with the real build_sqlite, runs
     the real audit_server, asserts the green column, the register columns,
     and the file-only-contract card — green after the move. cmp.mjs's
     file-column asserts print `false` since the site's `data/paid` moved
     out (pre-existing, see `audit\NOTES.md` KNOWN BREAKAGE).
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

## THE CONTRACTS DATABASE — CURRENT STATE (2026-08-25)

**THE THREE-SOURCE BUILD IS DONE (2026-08-25, on Mercy's machine via
build-database.bat).** "collect budgetkey" finished in ONE run (62
sections, 0 failed). Final numbers, all cross-checked:
- **986,942 contracts**: file-only 43,013 · BudgetKey-only 473,616 ·
  BOTH 470,313. Sanity: 43,013+470,313 = 513,326 — exactly the file-side
  build ✓; bk side = 943,929 distinct orders vs the 945,088 measured live
  (a ~1,159 gap — orders under codes outside the 62-section sweep;
  small, unexplored). 91.6% of file contracts matched a bk order.
- Fills: bk 14.42M · file 5.33M (down from 6.72M — bk now wins its
  precedence rows on shared contracts, as designed) · tn 970,087 · ex
  446,201 · all-zero 354,898. **Register joined: 230,554** (was 22,456
  file-only — tender_key unlocked it; consistent with the 23.9% measured
  coverage). 69 output sections.
- **Sizes: contracts.db 2,332 MB · contracts-public.db 1,344.9 MB.** The
  payments[] history did exactly what was predicted — the public copy
  BLEW PAST the free tier's 500 MB. The paid month ($5, 10 GB cap) she
  already bought carries it fine; if we ever want back under 500 MB the
  levers are moving the reports table out of D1 (~most of the growth)
  and normalizing more columns. Decide at wiring time, not before.
- Wiring-day upload: ~1.3 GB SQL import — wrangler `d1 execute --file`
  caps at 5 GB, fits; ~2.4M row-writes, nothing next to 50M/month.

**2026-08-26 — THE D1 UPLOADER IS BUILT (`upload-to-d1.bat` →
`tools/upload_to_d1.py`), wrangler-free** — her machine has no Node, so it
speaks D1's REST import flow directly (init with md5 etag → PUT the SQL to
the one-time upload_url → ingest → poll; the same flow wrangler uses).
Stdlib only. Config in `d1-config.json` at the root (the config stays at the root; the .db it uploads is `_out\contracts-public.db`) (account_id,
database_id, api_token with Account·D1·Edit) — GITIGNORED, template
auto-created on first run. The dump: DROP-then-CREATE per table (re-run
replaces cleanly), multi-row INSERTs capped at 60,000 BYTES per statement
(bytes, not chars — Hebrew is 2 bytes/char and the first draft measured
chars, giving 94 KB statements), loud error if any single row exceeds
80 KB (possible once bk manof_excerpts arrive — then it needs a chunked
insert). ROUND-TRIP VERIFIED on the 513K file+registers public db: dump →
reload → identical counts, view answers, all 10 indexes.
**FIRST LIVE RUN FAILED SILENTLY (2026-08-26), and the lesson is now
code:** the 1.2 GB single-file import "Processed 875 queries", the poll
then answered "Not currently importing anything." — which the script
took as done, but that answer is IDENTICAL for "finished" and "failed
and rolled back". It had failed: 0 tables, 12 KB storage, rows written
0 (fully transactional rollback — at least nothing was billed). RULE:
**never trust an import's status words; trust row counts.** v2 uploads
in ~120 MB parts split at statement boundaries, and after each part
queries D1 (`/query` endpoint, COUNT per table) against the dump
manifest's expected cumulative counts; a part that verifies is recorded
in build/d1/state.json and skipped on re-run (per-file atomicity makes
redoing a failed part safe); every poll answer is saved to
build/d1/last-poll.json so the NEXT failure shows its face. Part
mechanics round-trip-tested (2 parts on the 234 MB db, md5s, identical
counts). Root cause of the original failure: unknown until the per-part
run exposes it. Her one-time dashboard steps done: D1 db created, ids
in d1-config.json, token Account·D1·Edit.
**v3 (2026-08-26, second live lesson):** a run killed on OUR side (chat
ended mid-poll) leaves the import RUNNING on Cloudflare's side, and the
next init answers `"Currently processing a long-running import"` — there
is NO cancel call. v2 misread that as "duplicate file", appended a retry
comment and quit. Now `init_when_free()` waits (30s polls, up to 4h,
progress every 5 min), the poll loop treats the busy answer as
still-active, and `already_applied()` counts rows BEFORE uploading so a
part that landed during the orphaned import is skipped, not re-sent.
**v4 (same day, third lesson):** parts 1–10 (all rows but the last 38k
contracts) went in clean. Part-011 — last rows + TEN `CREATE INDEX`es +
the view in one import — died with "D1 DB exceeded its CPU time limit
and was reset". Every index/view now gets a part OF ITS OWN
(`Parts.stmt(obj=)`), the manifest records `objects` per part, and
`verify()` checks sqlite_master for them as well as row counts (a
count-only check would call an index part "done" before it ran). The
tail was rebuilt in place as part-011/012 (rows) + 013–023 (one object
each) without re-dumping; parts 1–10 untouched. Also: a `query` 400
"no such table" before a part is "not there yet", not an error (`api(
soft=True)`). If a single index still trips the CPU limit, next resort
is creating the indexes FIRST (in part-001) so they fill incrementally.
**STATUS 2026-08-26: UPLOAD COMPLETE.** Final check passed: strings
6,219 · allocations 1,058,220 · reports 2,924,853 · contracts 986,942,
all 10 indexes + contracts_v present. Re-running the .bat is safe (all
23 parts recorded in build\d1\state.json → skipped); a changed
contracts-public.db triggers a fresh dump and full re-upload.
**verify-d1.bat / tools/verify_d1.py (2026-09-05):** content check, not
just counts — compares D1 against the local db: the whole strings
table, every column of all rows for 40 random order_ids in contracts /
allocations / reports, and contracts_v output. Random ids each run.
Deliberately NOT a full checksum: that would scan ~5M remote rows and
eat the D1 daily read allowance; counts-at-upload + full strings + deep
samples instead (~200 indexed queries). Run it after every upload, or
any time D1 is doubted. If the local db was rebuilt after the last
upload it warns that mismatches mean "stale", not "corrupt".
**verifier v2 (2026-09-05, first live run):** v1 screamed 39/40 false
mismatches and crashed. Two comparison bugs, zero data problems: D1
answers in JSON, so REAL 819.0 comes back as int 819 (local SQLite
keeps the float) — numbers must compare as numbers with tolerance, not
as normalized strings; and sorting multi-row sets crashed on NULL vs
text in one column (`canon()` now rank-tags values so anything sorts).
Test harness lesson: the fake "remote" must JSON-round-trip its rows
and int-ify integral floats, or it hides exactly this class of bug.
**Folder cleanup v2 (2026-09-05, Mercy asked to DELETE this time):**
`clean-up.bat` at the root really deletes (lists + keypress first) the
rebuildables: build\raw, build\contracts, build\full,
build\mr-exemptions.json, build\d1-upload.sql, build\d1\part-*.sql
(manifest.json + state.json KEPT — they're the uploader's memory),
_old_delete_me\, tools\__pycache__ — ~9.6 GB. Never on the list:
contracts.db, contracts-public.db, the three zips (full-records is the
ONLY surviving copy — CI artifact expires; publications-register is the
frozen 2021 snapshot), Tenders/Exemptions-07082026 (that date is not
re-downloadable), d1-config.json (reports\ was on this list until Mercy
deleted its one hand-downloaded xlsx on 2026-09-06 — nothing read it). README.md now carries the
full what-each-file-is-for guide (tree + Files section) — keep it
current when adding files. Ask Mercy whether she ran clean-up.bat if
_old_delete_me\ still exists in a later chat.

**The earlier file+registers-only run, kept for the deltas it explains:**
513,326
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
green המאגר המאוחד column in `audit/compare.html`, predates the build —
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
   line + identical volume), which is what `audit/compare.html` does — and
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

### audit/compare.html — THE TOOL FOR CHECKING ME (2026-08-22)

Mercy: "I want to see, check and compare the end result to the sources myself
because I don't trust you." Correct instinct, and the site needs it anyway.

`audit/compare.html` takes an order id, a supplier or a word from the
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

### SIZE WAS NEVER THE CONSTRAINT (2026-08-22, real numbers 2026-08-25)

The dataset was built at scale — the measured sizes live in "THE CONTRACTS
DATABASE" at the top (contracts.db 470 MB / public 234.6 MB / gzip ~17:1).
What this section correctly predicted, still true:
1. **Supply is the whole problem** — 82 publishers, refreshed quarterly.
2. **Format variance** — headers carry typos, double spaces, stray
   apostrophes, and vary by ministry and year; only LOOSE matching survives.
3. **raw_budget is still BudgetKey's.** The .xlsx files carry no budget
   tree, so the tree, the flows and the debt block stay on the live API.
