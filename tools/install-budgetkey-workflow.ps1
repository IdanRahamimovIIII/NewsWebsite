# =====================================================================
#  install-budgetkey-workflow.ps1 - creates
#  .github\workflows\collect-budgetkey.yml
#
#  Its own installer, its own workflow, its own files - like every
#  collector since Mercy's rule of 2026-08-24. It shares nothing with the
#  monthly refresh and never commits, so it cannot collide with anything.
#  Run it by double-clicking install-budgetkey-workflow.bat.
#
#  This file is pure ASCII; the YAML it writes must have NO BOM.
# =====================================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root ".github\workflows"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$enc  = New-Object System.Text.UTF8Encoding $false

$yml = @'
# Collects the BudgetKey side of the contracts dataset, RAW and WHOLE:
# every contract_spending row for every budget section, every column except
# the two rule-7 computed averages. This is the merge's second input -
# supplier identity resolution (entity_id), the payments[] history for
# ministries whose files we do not hold, entity kinds, tender_key.
#
# Section by section into build/raw/<section>.json, cached between runs, so
# the collection is RESUMABLE: a section already on disk is skipped, a
# failed section is named and retried next run, and a 4-hour budget stops
# the run cleanly long before GitHub's 6-hour kill.
#
# Kept SEPARATE per Mercy's rule - nothing is combined here. Commits
# NOTHING to git; results land as the budgetkey-raw artifact.
#
# NOTE FOR MERGE-WIRING DAY: the refresh workflow will need this cache
# (restore-keys: budgetkey-) so build_dataset.py can read build/raw.
name: collect budgetkey

on:
  schedule:
    - cron: "37 3 25 * *"     # the 25th monthly - fresh before the 1st's merge
  workflow_dispatch:          # and on demand

permissions:
  contents: read              # it never writes back to the repository

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"

      - name: restore what was already collected
        uses: actions/cache@v5
        with:
          path: build/raw
          key: budgetkey-${{ github.run_id }}
          restore-keys: budgetkey-

      # no network in these tests - they gate the pull, not depend on it
      - name: the collector's own tests first
        run: python3 tests/test_budgetkey_all.py

      - name: collect every section, resumably
        timeout-minutes: 300
        run: |
          python3 tools/fetch_budgetkey_all.py \
            --out build/raw \
            --deadline-minutes 240

      # ~1.5 GB of JSON belongs in a download, not in git history
      - name: keep the raw pull as a downloadable artifact
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: budgetkey-raw
          path: build/raw/*.json
          retention-days: 90
          if-no-files-found: warn

'@
$p = Join-Path $dir "collect-budgetkey.yml"
[System.IO.File]::WriteAllText($p, $yml, $enc)

Write-Host ""
Write-Host ("  created: " + $p) -ForegroundColor Green
Write-Host ("  (" + (Get-Item $p).Length + " bytes)")
Write-Host ""
Write-Host "  Next: commit it in GitHub Desktop and push, then run it from"
Write-Host "  the Actions tab -> 'collect budgetkey'. If it ends with failed"
Write-Host "  or remaining sections, just run it again - it continues."
Write-Host ""
