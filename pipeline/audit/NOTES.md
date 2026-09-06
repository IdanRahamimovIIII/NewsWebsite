# NOTES.md — the audit kit (pipeline\audit\)

Everything settled about CHECKING the built dataset. Same keep-it-current
rule as CLAUDE.md: when a chat proves a line here wrong, fix it in that chat.

## THIS FOLDER IS THE WHOLE AUDIT (Mercy, 2026-09-06)

To work on the audit, a chat needs THIS folder and nothing else. What is
here and what each file is for:

| file | role |
|---|---|
| `audit.bat` | Mercy's double-click: starts `audit_server.py` on :8081 and opens compare.html |
| `audit_server.py` | stdlib http.server + sqlite3. Serves this folder at `/`, mounts the website at `/site/`, answers read-only `/audit/*` from the FULL database |
| `compare.html` | THE TOOL: one contract, every source side by side, field by field (BUILD stamp in the footer) |
| `paidcheck.html` | did the ministry-report overlay reach the site (per section ✔/✘) |
| `cmp_audit.mjs` | test, audit mode: builds a tiny full db with the real `build_sqlite.py`, runs the real server, asserts the green column, the register columns, the file-only card. **All green 2026-09-06.** |
| `cmp.mjs` | test, fallback mode (no audit server): the client-side merge, the random buttons, the three-row trap, the dead-source render |
| `fixtures-paid.json` | the paid documents the three tests use (real records, lean + full shape) |
| `check_paid.mjs` | drives paidcheck.html against a mocked relay, asserts its verdict, saves paidcheck.png |

Outside this folder the audit touches, read-only: `..\build\contracts-full.db`
(the database it audits), `..\tools\build_sqlite.py` (cmp_audit builds its
fixture db with it), and the site zone `..\..\site\` (config.js, shared\).
Tests: `node audit\cmp_audit.mjs` / `node audit\cmp.mjs` from `pipeline\`
(playwright + python3; Claude runs them in its container, Mercy has no node).

## WHICH DATABASE, AND WHY (2026-09-06)

`build-database.bat` produces ONE output, `out\contracts-public.db` — the
D1 upload — and along the way writes `build\contracts-full.db`, the full
database the public copy is derived from. **The audit reads the FULL one**:
only it carries provenance per field (which source won) and the embedded
mr.gov.il register rows; the public copy has neither, on purpose (D1 must
not carry the audit). The full db is a build intermediate: `clean-up.bat`
deletes it, the next build recreates it, and `audit.bat` says "run the
build" when it is gone. (Until 2026-09-06 it was `out\contracts.db`, an
output in its own right; Mercy deleted both databases that day and asked
for one output — the audit lost nothing, only its file moved.)

## HOW compare.html WORKS — the rules it taught (2026-08-22 → 25)

- Probes `/audit/status` (same origin, then :8081). `AUDIT === ""` means
  same-origin — every check must be `!== null`, because `""` is falsy.
  With the server: the green column is the record AS STORED (values +
  provenance labels straight from the db), search goes through the built
  db first — file-only contracts are findable — and the random button
  draws from OUR dataset. Without it: byte-for-byte the old client-side
  merge, registers off, a hint explains.
- **Never await more than one source before drawing something.** The card
  is drawn from the row in hand; each source fills its own line as it
  answers (`בודק…` until then); every lookup has a timeout that prints its
  failure IN the row; the raw report list is lazy. A page that knows enough
  to say "8 found" knows enough to show 8 cards (verified: dead source,
  card in ~200 ms — `cmp.mjs` holds that case open).
- **An unindexed `ILIKE` on BudgetKey is fine with `LIMIT` and fatal with
  `ORDER BY` or `count()`** — both force the whole 1,036,112-row table and
  a timeout surfaces as "nothing found". Say "the first found", never imply
  a ranking that was not computed.
- **BudgetKey caches by query TEXT.** `TABLESAMPLE SYSTEM (1)` needs
  `REPEATABLE (<fresh seed>)` or every click returns the same row; the
  test echoes the seed as the order id and fails if four clicks repeat.
- `tender_key` routes to TWO registers (`["569574","exemptions","none"]`);
  only 23.9% of contracts carry one, so an empty register column is
  usually the true answer. jsonb → `jsonb_array_length`.
- The cell vocabulary is seven-way and explained on the page: `ריק` ·
  `אין שדה כזה` · `לא נמצא` · `0 ₪` · `אין קישור` · `לא נמצא במרשם` ·
  `אין קובץ לסעיף NNNN`. Collapsing "we have not got it" into "not found"
  makes a half-built dataset look broken. **This page shows what the
  source says, uninterpreted** — the budget page turns an all-zero series
  into "לא דווח"; this one must not, or it could never check the budget page.
- Status line warns when one order returns several BudgetKey rows (never
  sum them — 3× trap), and when the ministry file has the order under a
  different תקנה it says so instead of matching silently.
- http.server decodes the request line latin-1 — Hebrew query args need
  the latin-1→utf-8 round-trip (`arg()` in audit_server.py).
- The BUILD stamp exists because Mercy was once looking at a cached copy
  while a new one was being described. Bump it on every change.

## THE PAID DOCUMENTS — WHERE THE AUDIT READS THEM (settled 2026-09-06)

The site keeps no data, so `/site/data/paid/…` is gone for good. Two pages,
two questions, two sources:

- **compare.html — "הקובץ שהמשרד פרסם"** shows EVERY column of the ministry's
  row, so it needs the `.full.json` (never published: ~240 MB). audit_server
  serves it at `/paid/<section>.full.json` from `..\build\full\` — which
  `build-database.bat` fills by extracting `inputs\full-records.zip`. Lean
  docs (`/paid/<section>.json`, `/paid/index.json`) come from `..\paid\`,
  and when a lean doc is missing locally the page asks the relay
  (`<PROXY>/data/paid/<section>`, envelope unwrapped) — the random-from-our-
  files button works either way. Cell text when the full file is absent:
  `אין קובץ לסעיף NNNN` (+ a note naming build\full and the build).
- **paidcheck.html** asks ONLY the relay — its question is "what does the
  budget page get", so a local copy would be marking our own homework. It
  distinguishes 404 `Unknown dataset` (old worker, not deployed) from 404
  `not published` (new worker, KV empty → run `publish-paid.bat`).
- The tests are hermetic: `fixtures-paid.json` holds the real מילגם record
  (4502539235, verified live 2026-08-22) and the three-row-trap order
  4501119831, in lean and full shape. `cmp.mjs` serves them at `/paid/`
  from the fixture ONLY (never this machine's real files — so "section 0024
  is not downloaded" means the same everywhere); `check_paid.mjs` mocks the
  relay with them; `cmp_audit.mjs` hands them to the real server via
  `--paid`/`--full`. All three green 2026-09-06 (cmp.mjs: every file-column
  assert back to true; the count of empty cells in that column is 13).
