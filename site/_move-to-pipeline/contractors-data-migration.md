# HANDLED 2026-09-08 — this plan moved to pipeline\contractors\

The problem this file described is solved; its content (definitions,
endpoint shapes, sanity numbers, open-question answers) now lives in
**`pipeline\contractors\NOTES.md`**, next to the code that implements it:

- `pipeline\contractors\build_contractors.py` precomputes the page's
  aggregates (ctr_* tables + an FTS5 search index) into
  `out\contracts-public.db`;
- `pipeline\contractors\upload-to-d1-contractors.bat` ships just those
  tables to D1;
- `worker\worker.js` v9 serves them: `/contractors/summary · top ·
  exemptions · supplier · search`.

STILL TO DO, in a budget_page session (NOT from here): swap
`site\budget_page\contractors.data.js` from BudgetKey SQL to the new
endpoints and move the Playwright mocks — see `pipeline\contractors\
NOTES.md`, "WHAT COMES NEXT".

This folder (`site\_move-to-pipeline\`) can be deleted.
