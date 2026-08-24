# =====================================================================
#  install-publications-workflow.ps1 - creates
#  .github\workflows\collect-publications.yml
#
#  A SEPARATE workflow on purpose (Mercy, 2026-08-24: "don't update the
#  files we are using for the current workflow - create new files").
#  It shares nothing with refresh-data.yml: its own script
#  (tools/fetch_publications.py), its own tests (tests/test_publications.py),
#  and it never commits or pushes - so it can never collide with a running
#  refresh. Run it by double-clicking install-publications-workflow.bat.
#
#  This file is pure ASCII, so Windows PowerShell 5.1 reads it correctly
#  with or without a BOM. The YAML it writes must have NO BOM.
# =====================================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root ".github\workflows"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$enc  = New-Object System.Text.UTF8Encoding $false

$yml = @'
# Collects ORIGIN B whole: the tender/exemption publication register on
# data.gov.il (minhal harechesh hamemshalti) - who approved an engagement,
# under which regulation, the announced amount, the objection deadline, and
# a link to the decision texts. The only independent second witness for
# contracts; nothing here exists in the ministries' quarterly reports.
#
# MEASURED 2026-08-24: the register on data.gov.il was "manually updated"
# through 2021-01-31 and its counts have not moved since we first measured
# them. This collects Origin B's HISTORY (~180k records, ~20 requests).
# The live continuation is the procurement portal (mr.gov.il / gov.il
# tenders), an Angular app - not collected yet, needs a DevTools capture.
#
# DELIBERATELY SEPARATE from refresh-data.yml: shares none of its files,
# commits NOTHING to git (the register lands as a downloadable artifact),
# so it can run at any time without touching the monthly pipeline.
name: collect publications register

on:
  workflow_dispatch:            # manual only - the register is frozen anyway

permissions:
  contents: read                # it never writes back to the repository

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"

      # no network in these tests - they gate the pull, not depend on it
      - name: the collector's own tests first
        run: python3 tests/test_publications.py

      # every field of every record, paged by what the server actually
      # returns; fails loudly if a resource comes back short
      - name: pull the whole register
        run: python3 tools/fetch_publications.py --out build/publications

      # ~100 MB of JSON belongs in a download, not in git history.
      # Artifacts are kept 90 days - re-run the workflow to regenerate,
      # and decide later where the permanent copy lives.
      - name: keep the register as a downloadable artifact
        uses: actions/upload-artifact@v7
        with:
          name: publications-register
          path: build/publications/*.json
          retention-days: 90
          if-no-files-found: error

'@
$p = Join-Path $dir "collect-publications.yml"
[System.IO.File]::WriteAllText($p, $yml, $enc)

$yml2 = @'
# Collects Origin B from the procurement portal ITSELF - the monthly export
# files (Tenders-DDMMYYYY.zip / Exemptions-DDMMYYYY.zip) that minhal
# harechesh publishes on its news page. Found 2026-08-24 when Mercy exported
# them by hand; the page answers a plain server fetch, no session needed,
# so this can run unattended. These files SUPERSEDE the data.gov.il register
# (frozen at 2021-01): measured 07.08.2026 content is tenders 24,572 rows
# 2009-2026 and exemptions 239,549 rows 2005-2026.
#
# The download links carry a rotating ?context= token, so every run re-reads
# the page and follows whatever dated links it carries today. A month
# already collected (same date in the manifest, cached between runs) is
# skipped. Commits NOTHING to git - results land as an artifact - so its
# schedule can never collide with the monthly refresh push.
name: collect portal registers

on:
  schedule:
    - cron: "43 4 12 * *"     # the portal updates around the 7th-8th; the
                              # 12th leaves slack, 04:43 UTC off the hour
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

      # keeps the manifest + converted JSON between runs, so an unchanged
      # month costs one page read and nothing else
      - name: restore what was already collected
        uses: actions/cache@v5
        with:
          path: build/portal
          key: portal-${{ github.run_id }}
          restore-keys: portal-

      # no network in these tests - they gate the pull, not depend on it
      - name: the collector's own tests first
        run: python3 tests/test_portal.py

      - name: read the news page and collect whatever is new
        run: python3 tools/fetch_portal_registers.py --out build/portal

      # ~150 MB of JSON belongs in a download, not in git history
      - name: keep the registers as a downloadable artifact
        uses: actions/upload-artifact@v7
        with:
          name: portal-registers
          path: |
            build/portal/*.json
          retention-days: 90
          if-no-files-found: error

'@
$p2 = Join-Path $dir "collect-portal-registers.yml"
[System.IO.File]::WriteAllText($p2, $yml2, $enc)

Write-Host ""
foreach ($f in @($p, $p2)) {
  Write-Host ("  created: " + $f) -ForegroundColor Green
  Write-Host ("  (" + (Get-Item $f).Length + " bytes)")
}
Write-Host ""
Write-Host "  Next: commit both in GitHub Desktop and push, then run them from"
Write-Host "  the Actions tab ('collect portal registers' is the important one;"
Write-Host "  'collect publications register' is the frozen data.gov.il copy,"
Write-Host "  kept as a cross-check)."
Write-Host "  (If the monthly refresh is still running, push AFTER it ends -"
Write-Host "  its final push fails if anything lands on main before it.)"
Write-Host ""
