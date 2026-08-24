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
# Collects the ministries' quarterly procurement reports and parses them.
# It does NOT combine the sources - that step is deliberately not wired in
# until collection is finished. See CLAUDE.md, COLLECTION PIPELINE.
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
        description: "budget sections, comma separated (blank = the real list from raw_budget)"
        default: ""
      years:
        description: "report years to look in"
        default: "2026,2025,2024,2023,2022"
      wayback:
        description: "try the Wayback Machine for blocked and dead urls (yes/no)"
        default: "yes"

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
      # xlrd reads the OLD Excel format (.xls) some ministries used into ~2020;
      # xlwt exists only so the tests can build one to parse
      - run: pip install openpyxl xlrd xlwt

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
      # text. The dated form is not the rule, so addresses cannot be assumed
      # derivable - they have to be looked up, and BudgetKey's report index is
      # the only list of them we found a way to reach.
      # It is used HERE for addresses only. No BudgetKey DATA is collected.
      # --wayback: the alternative route, measured 2026-08-24. foi.gov.il
      # refuses every server (1,181 reports, 2015-2020) and some gov.il
      # addresses are dead (404/403) - but the Internet Archive crawled both
      # hosts for years and web.archive.org serves everyone. Every recovered
      # file is stamped via=wayback in the manifest, because a number from an
      # archived copy must never look like one read from the live server.
      # An archived snapshot never changes, so each url is recovered ONCE and
      # skipped forever after; only the still-missing ones are retried monthly.
      - name: ask where the reports are, and fetch the ones that changed
        run: |
          python3 tools/fetch_reports.py \
            --out reports \
            --manifest reports/manifest.json \
            --sections "${{ inputs.sections }}" \
            --years "${{ inputs.years || '2026,2025,2024,2023,2022' }}" \
            ${{ (inputs.wayback || 'yes') != 'no' && '--wayback' || '' }}

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
      # until collection is finished: every ministry that publishes (56 turned
      # up in 2022-2026), every quarter, every column each source carries. Merging a fraction of the
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

      # the failure lists are DATA, not logs. failed.json (per url: what went
      # wrong) and unreachable.json (the foi.gov.il hole) exist only in the
      # Actions cache, so nobody outside a run can read them - which is how 79
      # failures stayed a number in a report instead of 79 addresses someone
      # could check. Copy them into the repo beside the inventory. The manifest
      # comes too: it is the record of what was collected, and the cache it
      # lives in is evicted after 7 unused days.
      - name: keep the failure lists where they can be read
        run: |
          mkdir -p site/data/collection
          cp reports/failed.json      site/data/collection/ 2>/dev/null || true
          cp reports/unreachable.json site/data/collection/ 2>/dev/null || true
          cp reports/manifest.json    site/data/collection/ 2>/dev/null || true

      # the rules are not decoration  -  a refresh that breaks one must not ship
      - name: the eight rules must still hold
        run: |
          python3 tests/test_merge.py
          python3 tests/test_fetch.py

      # every column of every row, ~240 MB - too big for git, still yours to
      # download. Kept for 90 days by GitHub, then regenerated by the next run.
      - name: keep the full records as a downloadable artifact
        uses: actions/upload-artifact@v7
        with:
          name: full-records
          path: site/data/paid/*.full.json
          retention-days: 90
          if-no-files-found: warn

      - name: commit whatever changed
        run: |
          git config user.name  "our-money bot"
          git config user.email "bot@users.noreply.github.com"
          # the first full run committed 241 MB of .full.json before we knew
          # how big they get. Untrack them; .gitignore keeps them out from here.
          git rm --cached --ignore-unmatch -q site/data/paid/*.full.json || true
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
