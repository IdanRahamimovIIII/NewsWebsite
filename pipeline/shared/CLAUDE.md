# CLAUDE.md — pipeline core (pipeline\shared\)

Connect this folder + the ONE dataset folder the problem lives in.

## Pipeline rules (Mercy)
- A script a workflow runs changes WITH its workflow, same commit.
  Workflow source = `pipeline\workflows\*.yml`; `.github\workflows\` is a
  generated copy (the bridge can't write there) → `setup\install-workflows.bat`
  (strips BOM) → commit both → push → green run = done. Push nothing while
  refresh-data.yml runs (its push fails if main moves); collectors commit
  nothing, run anytime.
- Collect raw, keep sources separate; the merge is a separate re-runnable
  step. Raw is archived forever ONLY for the contracts dataset, whose
  ministry reports vanish from the internet (Mercy) — elsewhere the latest
  copy is enough. BudgetKey never stands in for a ministry file at
  collection — only at merge, labelled, for reports gone from the internet.
- FIELDS.xlsx v2 (`audit\`) is the schema constitution; no script reads it.

## Map — by dataset (each folder: scripts, .bats, tests, notes, data)
| problem | connect |
|---|---|
| contracts: collection, raw archive, merge → build → D1, contractors tables | `contractors\` (+ `workflows\` if steps change) |
| BTL data: legal avg wage, unemployment ch.15 → KV snapshots, monthly CI | `btl\` (+ `workflows\` if steps change) |
| MK portraits | `photos\` |
| checking the built dataset | `audit\` |
| GitHub automations | `workflows\` + `setup\` |

Root also: `paid\` + `collection\` (refresh-data's committed outputs; paid\ =
never-shrink baseline until phase 3; no page reads it) · `tests\`
(test_merge.py, run BY PATH by refresh-data.yml) · `build\` (rebuildable;
`build\d1\` + `build\d1\ctr\` = uploader memory, kept by clean-up.bat) ·
`d1-config.json` (Cloudflare ids + token).

This folder: `cf_kv.py` (THE KV client: credentials, namespace by title,
bulk put/delete, read-back verify) · `build_sqlite.py` (schema + builder:
full db, public copy, dictionary encoding, contracts_v, delta; used by tests
in contractors\, audit\, worker\) · `upload_to_d1.py` (D1 dump/import/verify).

## Interfaces (other side: `worker\CLAUDE.md`)
- D1: `strings`, `allocations`, `reports`, `contracts` + view `contracts_v` +
  10 indexes (upload-to-d1.bat); `ctr_years/ctr_top/ctr_ex/ctr_sup` +
  `ctr_fts` (upload-to-d1-contractors.bat). Columns via
  `build_sqlite.py --public`. Served by worker `/contracts` family (v8),
  `/contractors/*` (v9).
- KV: `pub:mkphotos` + `photo:mk/*` (photos\) → `/data/mkphotos`,
  `/photos/mk/<file>` · `pub:avgwage` + `pub:btl-unemployment` (btl\, monthly
  CI). Any `pub:<name>` is served as `/data/<name>`.

## Open (cross-dataset)
- Phase 2 → 3 of pipeline v2: `contractors\NOTES.md`.
- Browser last-mile for reports gone from the internet (~170 failures).
- data.gov.il register snapshot vs portal export diff (merge time).
- Report BudgetKey's paid-column bug to הסדנא לידע ציבורי.
- More spending data: תמיכות (supports), tenders.
- `/data/mkcards` snapshot for the MK page (role, laws passed, averages).
- `git pull --rebase` hardening of refresh-data's commit step.
