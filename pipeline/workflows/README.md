# pipeline\workflows\ — the SOURCE of the GitHub automations

These four files ARE the workflows. GitHub only runs workflows it finds at
`.github\workflows\` in the repository root, so a byte-identical copy lives
there — but that copy is generated, never edited by hand (the device bridge
cannot write under `.github\` anyway).

| file | schedule | what it does | commits? |
|---|---|---|---|
| `refresh-data.yml` | 1st of the month 03:17 UTC + manual | fetch the ministries' quarterly reports (+ wayback), parse into `pipeline/paid`, run the tests, **publish the paid documents to Cloudflare KV** (`tools/publish_paid.py`; needs the repo secrets `CF_API_TOKEN` + `CF_ACCOUNT_ID`, otherwise a NOTE) | yes — `pipeline/paid` (the lean documents, kept in git so the parser merges into last month's) + `pipeline/collection` (inventory + failure lists); never `site/` since 2026-09-06 |
| `collect-portal-registers.yml` | 12th 04:43 UTC + manual | mr.gov.il tender/exemption export zips → JSON | no (artifact) |
| `collect-budgetkey.yml` | 25th 03:37 UTC + manual | BudgetKey `contract_spending` per section → `pipeline/build/raw` | no (artifact) |
| `collect-publications.yml` | manual only (the data.gov.il register is frozen at 2021-01-31) | Origin B's history from data.gov.il, ~180k records | no (artifact) |

**To change a workflow:** edit the file here → double-click
`pipeline\setup\install-workflows.bat` (copies changed files into
`.github\workflows\`, strips a stray BOM) → commit BOTH folders → push →
the change is done when the next run is green. `refresh-data.yml`'s final
`git push` fails if main moves during its run, so push nothing while it runs;
the collectors commit nothing and can run any time.

**Paths inside the files are relative to the repository root** (the runner's
checkout), hence `pipeline/tools/…`, `pipeline/tests/…`, `pipeline/build/…`,
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
