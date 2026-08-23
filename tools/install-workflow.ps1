# =====================================================================
#  install-workflow.ps1 - creates .github\workflows\refresh-data.yml
#
#  Windows Explorer refuses to create a folder whose name starts with a dot,
#  which makes ".github" oddly hard to make by hand. This does it for you.
#  Run it by double-clicking install-workflow.bat in the project root.
#
#  NOTE: this file is saved WITH a UTF-8 BOM on purpose. Windows PowerShell
#  5.1 reads a BOM-less .ps1 as the system ANSI codepage (1255 here), which
#  silently mangles any non-ASCII character in it. The YAML it writes, by
#  contrast, must have NO BOM - GitHub Actions will not parse a file that
#  starts with one. Two files, opposite rules.
# =====================================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root ".github\workflows"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$yml = @'
# Collects the ministries' quarterly procurement reports, parses them, and
# rebuilds the merged dataset.
#
# WHY MONTHLY AND NOT QUARTERLY (measured 2026-08-23):
#   - reports are quarterly but published LATE  -  the Q4-2024 education report
#     is dated 2025-04-07, three months after the quarter closed
#   - reports get REVISED: the source carries revision 0..2, so a report we
#     already parsed can change underneath us
#   - 82 publishers do not publish in step
#   Quarterly checking would match the publication rhythm and miss both the
#   stragglers and every revision. Monthly is cheap because fetch_reports.py
#   asks for each file's size first and only downloads what actually changed.
name: refresh data

on:
  schedule:
    - cron: "17 3 1 * *"        # 03:17 UTC on the 1st  -  off the hour, nobody's rush
  workflow_dispatch:            # and on demand, from the Actions tab
    inputs:
      sections:
        description: "budget sections, comma separated (blank = all)"
        default: ""
      years:
        description: "report years to look in"
        default: "2026,2025"

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install openpyxl

      # the reports themselves are build inputs, not web content  -  they are
      # cached between runs rather than committed to the repo
      - name: restore the downloaded reports
        uses: actions/cache@v4
        with:
          path: reports
          key: reports-${{ github.run_id }}
          restore-keys: reports-

      - name: fetch the reports that changed
        run: |
          python3 tools/fetch_reports.py \
            --out reports \
            --manifest reports/manifest.json \
            --sections "${{ inputs.sections }}" \
            --years "${{ inputs.years || '2026,2025' }}"

      - name: parse every report into site/data/paid
        run: |
          shopt -s nullglob
          for f in reports/*.xlsx; do
            echo "-- $f"
            python3 tools/parse_report.py "$f" site/data/paid || echo "  parse failed, continuing"
          done

      - name: build the merged dataset
        run: python3 tools/build_dataset.py --files site/data/paid --out site/data/contracts

      # the rules are not decoration  -  a refresh that breaks one must not ship
      - name: the eight rules must still hold
        run: python3 tests/test_merge.py

      - name: commit whatever changed
        run: |
          git config user.name  "our-money bot"
          git config user.email "bot@users.noreply.github.com"
          git add site/data
          if git diff --cached --quiet; then
            echo "nothing changed this month"
          else
            git commit -m "data: monthly refresh $(date -u +%Y-%m-%d)"
            git push
          fi

'@

$path = Join-Path $dir "refresh-data.yml"
[System.IO.File]::WriteAllText($path, $yml, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "  created: $path" -ForegroundColor Green
Write-Host "  ($((Get-Item $path).Length) bytes)"
Write-Host ""
Write-Host "  Next: in GitHub Desktop you should see .github/workflows/refresh-data.yml"
Write-Host "  in the changes list. Commit it and push."
Write-Host ""
