# pipeline\workflows\ — the SOURCE of the GitHub automations

These six files ARE the workflows. GitHub only runs workflows it finds at
`.github\workflows\` in the repository root, so a byte-identical copy lives
there — but that copy is generated, never edited by hand (the device bridge
cannot write under `.github\` anyway).

| file | schedule | what it does | commits? |
|---|---|---|---|
| `refresh-data.yml` | 1st of the month 03:17 UTC + manual | fetch the ministries' quarterly reports (+ wayback), parse into `pipeline/paid`, run the tests (the publish-to-KV step was deleted 2026-09-08 with the paid overlay) | yes — `pipeline/paid` (the lean documents, kept in git so the parser merges into last month's) + `pipeline/collection` (inventory + failure lists); never `site/` since 2026-09-06 |
| `collect-portal-registers.yml` | 12th 04:43 UTC + manual | mr.gov.il tender/exemption export zips → JSON | no (artifact) |
| `collect-budgetkey.yml` | 25th 03:37 UTC + manual | BudgetKey `contract_spending` per section → `pipeline/build/raw` | no (artifact) |
| `collect-publications.yml` | manual only (the data.gov.il register is frozen at 2021-01-31) | Origin B's history from data.gov.il, ~180k records | no (artifact) |
| `bootstrap-archive.yml` | manual one-shot, re-runnable | harvests whatever the reports cache holds into the raw archive (v2 phase 1) | yes — the archive manifest |
| `build-and-update.yml` | manual until its first green run (schedule for the 3rd monthly is ready, commented) | v2 phase 2: prove the CF_* credentials FIRST (seconds, read-only) → archive → parse → streaming merge → databases → delta to D1 (or the full first upload) → rotate the baseline | no (release assets) |

**To change a workflow:** edit the file here → double-click
`pipeline\setup\install-workflows.bat` (copies changed files into
`.github\workflows\`, strips a stray BOM) → commit BOTH folders → push →
the change is done when the next run is green. `refresh-data.yml`'s final
`git push` fails if main moves during its run, so push nothing while it runs;
the collectors commit nothing and can run any time.

**Paths inside the files are relative to the repository root** (the runner's
checkout), hence `pipeline/contractors/…` (the collection scripts live in the
contractors dataset folder since 2026-09-08), `pipeline/tests/…`, `pipeline/build/…`,
`pipeline/reports`, `pipeline/paid`, `pipeline/collection`.

**Secrets the workflows use** (GitHub → repo Settings → Secrets and variables
→ Actions): `CF_API_TOKEN` — a Cloudflare API token with *Workers KV
Storage: Edit* (the D1 token with that permission added is fine);
`CF_ACCOUNT_ID` — the account id (the same one in `pipeline\d1-config.json`).
Optional repo *variable* `RELAY_URL` = the worker address, so the publish
step can report whether the worker serves the dataset. Each workflow with a cache has an "adopt
the old layout" step: a cache saved before 2026-09-05 unpacks at the old
root-level path, and that step moves it once instead of re-downloading.

Until 2026-09-06 these lived as PowerShell here-strings inside three
`install-*.ps1` scripts; the plain files replaced them so Claude can read the
automations from the pipeline zone without opening `.github\`.

## PIPELINE v2 (design + status: `../contractors/NOTES.md`, PIPELINE v2)

**Phase 1 (2026-09-08, LIVE):** all three collectors feed THE PERMANENT RAW
ARCHIVE (the `raw-archive` GitHub Release): refresh-data REFILLS an evicted
reports cache from the archive before fetching (eviction now costs nothing),
then archives every fetched file forever (content-addressed, revisions kept,
manifest committed to `contractors/archive/`); portal-registers uploads a
dated snapshot; budgetkey rotates latest/previous. `bootstrap-archive.yml`
was the one-shot harvest; re-running it is harmless.

**Phase 2 — `build-and-update.yml`** (first full run in flight 2026-09-09):
its FIRST step proves the three `CF_*` repo secrets against D1 in seconds
(read-only — a bad secret must never again cost the 40-minute build; the
same check runs locally via `contractors\check-credentials.bat`). Then:
archive → parse → streaming merge → databases → DELTA to D1 (or the full
first upload) → baseline rotation. On its first green: uncomment its
schedule in the same commit.
