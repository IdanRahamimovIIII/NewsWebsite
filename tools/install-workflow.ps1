# =====================================================================
#  install-workflow.ps1 - creates the files under .github\workflows\
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
$enc  = New-Object System.Text.UTF8Encoding $false
$made = @()

$yml1 = @'
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
        description: "budget sections, comma separated (blank = all 99)"
        default: ""
      years:
        description: "report years to look in"
        default: "2026,2025,2024,2023,2022"

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: pip install openpyxl

      # the reports themselves are build inputs, not web content  -  they are
      # cached between runs rather than committed to the repo
      - name: restore the downloaded reports
        uses: actions/cache@v5
        with:
          path: reports
          key: reports-${{ github.run_id }}
          restore-keys: reports-

      # WHY BUDGETKEY IS STILL ASKED WHERE THE REPORTS ARE (2026-08-23):
      # we tried to drop it. The plan was one seed url per ministry plus the
      # calendar, since education's report is at
      #   .../BlobFolder/.../education_1_2025/he/education_1_2025.xlsx
      # and swapping the date works. It does not generalise. Real urls from
      # other ministries look like
      #   .../BlobFolder/dynamiccollectorresultitem/health_1/he/<hebrew> 4 - 2020.xlsx
      #   .../BlobFolder/dynamiccollectorresultitem/tourism_201/he/repository-of-answers_...xlsx
      # where health_1 is an item id, not a quarter, and the filename is free
      # text. There is no pattern to walk. The addresses have to be looked up,
      # and BudgetKey's report index is the only list of them we can reach.
      # It is used HERE for addresses only. No BudgetKey DATA is collected.
      - name: ask where the reports are, and fetch the ones that changed
        run: |
          python3 tools/fetch_reports.py \
            --out reports \
            --manifest reports/manifest.json \
            --sections "${{ inputs.sections }}" \
            --years "${{ inputs.years || '2026,2025,2024,2023,2022' }}"

      # oldest first, so the newest report has the last word on a cumulative
      # figure. An alphabetical shell loop got this right by luck and wrong by
      # the same luck.
      - name: parse every report into site/data/paid
        run: |
          python3 tools/parse_all.py \
            --reports reports \
            --out site/data/paid

      # WHERE THE COMBINING WOULD GO.
      # It is deliberately not here yet. Each source stays whole and separate
      # until collection is finished: 82 ministries, every quarter they have
      # published, every column each source carries. Merging a fraction of the
      # data teaches us to merge that fraction well, and the decisions are not
      # reversible without re-downloading everything.
      # build_dataset.py exists and its 35 tests run below. It is not wired in.

      - name: what have we collected so far
        run: |
          python3 tools/inventory.py \
            --reports reports \
            --parsed site/data/paid \
            --budgetkey build/raw \
            --out site/data/inventory.txt

      # the rules are not decoration  -  a refresh that breaks one must not ship
      - name: the eight rules must still hold
        run: |
          python3 tests/test_merge.py
          python3 tests/test_fetch.py

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
$p1 = Join-Path $dir "refresh-data.yml"
[System.IO.File]::WriteAllText($p1, $yml1, $enc)
$made += $p1


Write-Host ""
foreach ($f in $made) {
  Write-Host ("  created: " + $f) -ForegroundColor Green
  Write-Host ("  (" + (Get-Item $f).Length + " bytes)")
}
Write-Host ""
Write-Host "  Next: in GitHub Desktop you should see the files under"
Write-Host "  .github/workflows/ in the changes list. Commit them and push."
Write-Host ""
