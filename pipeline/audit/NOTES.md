# NOTES — audit kit (pipeline\audit\)

This folder is the whole audit.

| file | role |
|---|---|
| `audit.bat` | starts `audit_server.py` on :8081, opens compare.html |
| `audit_server.py` | stdlib http.server + sqlite3: serves this folder at `/`, the site at `/site/`, read-only `/audit/*` from the FULL db, `/paid/*` |
| `compare.html` | one contract, every source side by side (BUILD stamp in footer — bump on every change) |
| `cmp_audit.mjs` | test with the real server + a tiny full db from real `build_sqlite.py` |
| `cmp.mjs` | test without server: client-side merge, random buttons, three-row trap, dead source |
| `fixtures-paid.json` | real records: מילגם 4502539235 + trap order 4501119831, lean + full |
| `FIELDS.xlsx` | the schema (v2) |

Reads (read-only): `..\build\contracts-full.db` (only it has provenance +
register rows; clean-up.bat deletes it, audit.bat says "run the build"),
`..\shared\build_sqlite.py`, `site\shared\` (style, common.js, config.js).
Tests: `node audit\cmp_audit.mjs` / `node audit\cmp.mjs` from `pipeline\`
(playwright + python3, Claude's cloud).

## compare.html rules
- Probes `/audit/status` (same origin, then :8081). `AUDIT === ""` = same
  origin → checks must be `!== null`. With server: green column = record AS
  STORED, search hits the built db first (file-only contracts findable),
  random draws from our dataset. Without: client-side merge, registers off.
- Never await more than one source before drawing: card from the row in
  hand, each source fills its line (`בודק…`), every lookup has a timeout that
  prints IN the row, raw report list is lazy.
- Unindexed `ILIKE` on BudgetKey: fine with LIMIT, fatal with ORDER BY or
  count() (1,036,112 rows → timeout reads as "nothing found"). Say "the first found".
- BudgetKey caches by query TEXT: `TABLESAMPLE SYSTEM (1) REPEATABLE (<fresh seed>)`.
- `tender_key` routes to TWO registers; only 23.9% carry one → an empty
  register column is usually true. jsonb → `jsonb_array_length`.
- Seven cell words: `ריק` · `אין שדה כזה` · `לא נמצא` · `0 ₪` · `אין קישור` ·
  `לא נמצא במרשם` · `אין קובץ לסעיף NNNN`. Show the source UNINTERPRETED
  (no "לא דווח" here, or it can't check the budget page).
- Warn when one order returns several BudgetKey rows (never sum) and when the
  ministry file has the order under a different תקנה.
- http.server decodes the request line latin-1 → `arg()` round-trips to utf-8.

## Paid documents
Local only (the relay has no paid overlay). The
"הקובץ שהמשרד פרסם" row needs `/paid/<sec>.full.json` from `..\build\full\`
(filled by build-database.bat from `inputs\full-records.zip`); lean docs
from `..\paid\`. Tests serve only the fixture (cmp.mjs) or pass it via
`--paid`/`--full` (cmp_audit.mjs).
