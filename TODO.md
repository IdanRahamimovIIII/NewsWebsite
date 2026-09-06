# Israel Government Transparency Website — TODO

Goal: make Israeli government data (spending, laws, votes, court rulings)
understandable and accessible to the average citizen.
Language: Hebrew first (RTL) + English. Live data from official/open APIs.

## NEXT UP (2026-08-22): the budget page — the heart of the project
Mercy is moving to index.html. It is the reason the site exists; the votes page
is at a good stopping point. Open questions to raise with her there: the
plain-language glossary per budget item (her idea #1), the history chart with
governments/ministers annotated (#4), and whether index.html should get the same
file split votes.html got (it is still one ~24k file).

**Data scoping done 2026-08-22** — full map of what BudgetKey actually holds is
in CLAUDE.md ("THE BUDGET DATA"); briefing page:
https://claude.ai/code/artifact/ae4671eb-5cc4-4e4b-a774-134bf219b512
**Mercy has NOT picked a direction yet — she said "wait with it".** Don't start
rewriting index.html until she does. The candidates, in the order I'd rank them:

- [x] **BUG FIXED 2026-08-22: the ministry chart showed two trees + revenue.**
      `length(code)=4` returned 61 real sections AND 37 'Cxxx' functional nodes
      AND '0000' הכנסות המדינה (₪755.9bn, ranked #1 — bigger than the hero
      total). Now `code LIKE '00%' AND length(code)=4 AND code <> '0000'`, and
      the old mixed SNAPSHOT is filtered client-side too (`cleanAdmin()`), so
      the fix needed no worker redeploy. Count tile fixed and made view-aware
- [x] Second view added: the C1–C7 functional tree — where money goes BY PURPOSE
      (ביטחון / שירותים חברתיים / תשתיות…). Segmented switch above the chart.
      C8 (הכנסות) is excluded from a spending view; the card says so out loud
- [x] Tree opens one level further — `leaf` is now 10 chars, so the תקנה level
      (5,772 rows in 2025) is reachable. Verified live: 00206101 opens to
      "שעות תקן במוסדות רשמיים", "סייעות טיפוליות וסייעות השילוב"…
- [x] index.html split: shell + budget.css + budget.strings.js + budget.data.js
      + budget.view.js (load order: config → strings → common → data → view)
- [x] `test_budget.mjs` — Playwright + a fake budget that contains the same
      traps as the real one (both trees, '0000', a 10-char leaf). 27 assertions
- [x] Folder reorganised (2026-08-22): the website is now entirely in `site\`
      (shared/ budget/ votes/ tools/), with `worker\` and `tests\` beside it.
      **The top-level/site duplicate is gone** — no more mirroring, no more
      stale deploys. `tests/test_links.mjs` added to guard the paths (18/18)
- [ ] **Mercy: run `tidy-up.bat` once** — it moves the old flat copies into
      `_old_delete_me\`, then you check the site still opens and delete that
      folder. (Claude can write files on the device but not delete or move them)
- [x] **The four flows built into index.html (2026-08-22)** — מסים ואגרות ·
      חוב חדש · ריבית · החזר קרן החוב, above the tree. Stacked-column chart
      (money in, red = borrowed, plan year hatched), interest-as-%-of-tax line
      (actuals only), a data-generated paragraph, and a newest-first table.
      Explanations live in an anchored POPOVER opened from a question under each
      number — never inline, never hover-only. Default year = the last year with
      real execution, and every tile shows budget vs actual. 44 tests pass
- [ ] **Mercy: open `site\index.html` and check it live** (both views, drill to
      the bottom, switch year, switch language) — and `site\votes.html` too,
      since its file paths changed in the move
- [ ] Worker v9 (OPTIONAL, needs a redeploy): make the budget snapshot store the
      two trees separately instead of the mixed length-4 query, so the page
      doesn't have to filter it. Page works fine without this
- [x] Revenue: DONE as the four flows (see above). Still open if wanted: the
      full revenue tree by tax type from `income_items_data`, 3 levels deep
- [ ] Anatomy of a section from columns we already fetch: salaries vs transfers
      vs procurement, תקנים budgeted/filled, הרשאה להתחייב (future commitments)
- [ ] `budget_changes` (19,127 transfers 2005–2026, with the written
      justification) — explains the gap between מקורי and מעודכן that the page
      already draws but never accounts for
- [ ] `activities` (414 social services: description + budget codes +
      beneficiaries/year + suppliers) — official head start on the glossary
      idea, and enables cost-per-beneficiary
- [ ] History chart (idea #4) — confirmed to be ONE query per code, 30 years.
      Needs the curated events/ministers timeline to annotate, and must label
      2020 as תקציב המשכי (no approved budget; revenue reads 0)

Three checks only Mercy can run (each unlocks a section, none is blocking):
- [ ] Bank of Israel SDMX: does `edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/
      dataflow/BOI.STATISTICS/PS/1.0/?format=csv&startPeriod=2020` return a file?
      (deficit + national debt depend on it; also needs a worker allowlist entry)
- [ ] gov.il budget-execution collector: F12 → Network → Copy as cURL on the
      request that lists the files (the only route to MONTHLY execution data —
      BudgetKey is annual)
- [ ] data.gov.il CKAN: `data.gov.il/api/3/action/package_search?q=תקציב&rows=50`
      (robots rules blocked verification from the cloud)

## Phase 1 — Government Spending
- [x] Explore data sources: Budget Key (obudget.org) API, data.gov.il CKAN API
- [x] Build bilingual site showing the state budget: where the money goes, by ministry
- [x] Spending search: look up any supplier / contract
- [x] Test with live data, verify Hebrew RTL + English layouts
- [x] Open the site locally and review the design — works with live data!
- [ ] Put the site online (free hosting: GitHub Pages / Netlify / Cloudflare Pages)
- [ ] More spending data: support grants (תמיכות), budget transfers, tenders

## Phase 2 — Knesset: Laws & Votes (current)
- [x] Connect to the official Knesset OData API (knesset.gov.il/Odata)
- [x] Set up the free Cloudflare relay (the Knesset APIs block direct browser access)
- [x] Discover the modern votes API (old one froze in 2021!) — full map in CLAUDE.md
- [x] Bills recently updated in legislation + their status (votes.html)
- [x] Rebuild on current data: votes since 2021, grouped reservation votes (votes.html)
- [x] Per-vote breakdown: who voted for/against/abstained, by faction (votes.html)
- [x] MK voting record search on the modern API (votes.html)
- [ ] Mercy: verify the rebuilt votes.html live in the browser
- [ ] Historical votes (2003–2021) from the old OData Votes.svc (table names in CLAUDE.md)
- [ ] Bill detail pages: initiators, full history, link to bill text (LegislationItem API)
- [ ] Link votes ↔ bills (GetVoteDetails returns FK_ItemID = the bill's ItemId)
- [x] MK profile pages v1 (2026-08-25, see BIG ROCK 1 below) — attendance still open
- [ ] Participation count shown prominently on every vote — e.g. "התקבל חוק — 5 מצביעים מתוך 120"
      (Mercy's request 2026-08-20; data already in GetVoteDetails: sum of VoteCounters)
- [ ] Attendance score per MK — how often they participate in plenum votes
      (Mercy's request 2026-08-20; compute from SearchType 2 results vs. total votes in period)
- [ ] Email the Knesset open-data team: ask them to fill the empty votes dataset on data.gov.il
- [x] Supreme Court phase 3 v1 — court.html: fresh rulings feed with type/technical filters,
      free-text search, links to official documents (2026-08-21)
- [x] Our own dataset: worker v6 snapshots (budget/votes/bills/verdicts) in Cloudflare KV,
      cron refresh every 6h, pages read snapshot-first with live fallback (2026-08-21)
- [x] Budget v2: deep in-place tree drilldown — expand any section layer by layer down to
      program level, with %-of-parent labels (Mercy's ideas #2+#3, 2026-08-21)
- [x] Votes page: one row per law showing the decisive vote (reservations folded, marked
      "מכרעת" in the panel), side-by-side layout — list + who-voted panel (2026-08-21)
- [ ] Budget v2 next: glossary — plain-language explanation per budget item (Mercy's idea #1;
      our first original dataset, Claude drafts + Mercy edits)
- [ ] Budget v2 next: history chart per section across years, annotated with finance ministers,
      governments, elections, events (Mercy's idea #4)
- [x] Old votes archive (pre-13.7.2021) wired into advanced date search — queried live from
      the frozen Votes.svc via the relay, with per-member breakdowns (2026-08-21)
- [x] BIG ROCK 1 v1 SHIPPED (2026-08-25): MK portfolio pages — `mk.html` + `site/mk/`,
      fourth nav tab. Per person: positions held (KNS_PersonToPosition, back to 1951),
      bills in three piles (passed / rejected / in process, exact status shown on
      every row), voting record per Knesset with how THEY voted, directory of the
      current Knesset, `?name=` deep links; MK names on votes.html now link here.
      Tests: tests/test_mk.mjs (23 asserts, mocked APIs) + test_links updated.
- [x] Portfolio search v2 (2026-08-25, Mercy's five): live as-you-type ranked search
      (serving now → recency → weight of heaviest role → role count), position line
      per result (current role, or last role + years, ever-PM shows "ראש הממשלה"
      + year spans), avatars everywhere (initials until the photo URL pattern is
      captured — PHOTO_URL in mk.data.js, one line, Mercy's F12), portfolio header
      photo. 35 asserts green.
- [ ] Mercy: run `get-photos.bat` — fully automatic now (her DevTools capture
      revealed GetMkdetailsHeader carries each member's MkImage URL, verified
      through the relay). Downloads all current members into site/photos/mk/;
      the site starts showing faces by itself. `--all` collects past members,
      `--refresh` re-downloads. Re-run after each election
- [x] Personal-background card on the portfolio (2026-08-25, Mercy spotted the
      data): birth, birthplace, aliyah, residence, education, military/national
      service, profession, languages — from GetMkDetailsContent, only filled
      fields shown, free-text Content deliberately NOT injected
- [ ] Coalition/opposition per person, now + history — NO official dataset exists
      (KNS_Faction has no coalition flag, probed 2026-08-25). Needs either a
      DevTools capture of the current coalition list, or our own curated
      faction→coalition dataset per Knesset (Claude drafts, Mercy checks)
- [ ] BIG ROCK 1 v2: ministry budget under their term (BudgetKey by section + term
      dates), attendance score, pre-2003 votes via the frozen archive per-member table
- [ ] BIG ROCK 2: Laws registry by topic — KNS_IsraelLaw + classifications + validity +
      Basic Laws + link each law to the bills/votes/people that made it + official PDF
- [ ] BIG ROCK 3: the "why" layer — surface דברי הסבר (official explanatory notes) per law
- [ ] BIG ROCK 4 (demoted to portfolio tab per Claude's advice, 2026-08-21): שאילתות —
      an MK's questions to the government shown on their portfolio page
- [x] Votes search fixes (2026-08-21): the endless "בודק את תוצאות ההצבעות" spinner
      killed; "הוגשה על ידי" now answers from the person's own bills (the type filter
      applied there, not per vote); law search walks back ~3 years instead of filtering
      only what's loaded; word-order-blind matching; effective date range always shown
- [ ] Mercy: verify the fixed search live (initiator, type, dates, plain law search)
- [x] Worker v7: OUR OWN VOTE INDEX — every plenum vote 2003→today in KV, one file
      per year; /search/votes covers all history at once. No more hidden 1-year
      default, no 150-vote ceiling. Build it once via build.html (2026-08-21)
- [x] Index built live: 34,861 votes, 2003–2026 (2026-08-21)
- [x] "הוגשה על ידי" verified against the real bill id (FK_ItemID), not just the
      bill's name — wrong-bill matches are dropped (2026-08-22)
- [x] votes.html split into shell + css + strings + data + search + view + bills (2026-08-22)
- [x] Only checked rows are shown; results sorted by real dates; checking stops
      when the page is full (2026-08-22, all three reported by Mercy)
- [x] Archive votes CAN be verified: View_vote_rslts_hdr_Approved.sess_item_id =
      KNS_PlmSessionItem.ItemID = KNS_Bill.BillID for bill items. Pre-2021 votes now
      get exact initiator verification and an "הוגשה על ידי" line (2026-08-22)
- [x] Worker: the date range is applied during the search scan, not after the cap
      (a dated search could come back empty while matches existed) (2026-08-22)
- [x] Proposers display: up to 4 names listed, more than 4 = a count + click to open
      the full list (Mercy's rule, 2026-08-22)
- [x] KNS_BillInitiator pages at 100 rows — we were seeing only an MK's first 100
      bills. Now paged with $skip (2026-08-22)
- [x] Law-name search: index lookup and MK directory now run in parallel (2026-08-22)
- [x] Search by סוג alone returned nothing, always — the vote details (which name
      the bill) were only fetched for the other filters (2026-08-22)
- [x] selftest.html: runs the real searches on the real data, reports pass/fail, and
      posts the report to the worker so Claude can read it (2026-08-22)
- [x] Vote panel reorganised to Mercy's layout: proposers first, כנסת·ישיבה·N votes
      on one line with the instances behind a button, documents last, and the
      duplicated result badge removed (2026-08-22)
- [ ] **Worker v8 — bill id on every index row.** Makes "הוגשה על ידי" one exact
      request instead of name-matching + per-row checking (the 30-second path).
      Archive ids are free (sess_item_id); modern ids need ~10k one-time lookups.
      Deferred by Mercy 2026-08-22 — law-name search matters more and is already fast
- [ ] Fill modern vote RESULTS into the index (one GetVoteDetails per vote, ~20k) so
      the תוצאת ההצבעה / סוג filters need no per-search checking at all — cron could
      harvest a few hundred per firing and store them into the index lines
- [ ] Reliable vote↔bill join: outside an expanded row it's title text-matching today
      (FK_ItemID is exact but costs one GetVoteDetails per vote)

## Claude's proposals (2026-08-21)

- [ ] Curated events timeline — our own small dataset: elections, governments, wars, COVID,
      budget laws. One file, reused everywhere: annotates budget history charts AND MK
      portfolios ("did things improve under them" needs context to be fair)
- [ ] Ministers & positions timeline — harvest KNS_PersonToPosition once per term:
      who held which ministry when. Infrastructure for portfolios + budget annotations
- [ ] Rebellion detector — compute from votes: MKs who voted against their faction's
      majority. Surfaces the interesting 5% of votes automatically; pure people-over-process
- [ ] "השבוע במדינה" weekly digest — auto-summary from our own datasets: laws passed,
      notable rulings, big new contracts. Shareable; gives people a reason to return
- [ ] Per-topic / per-MK feeds (RSS/JSON from our snapshots) — "follow" without user
      accounts, keeping our zero-accounts security posture
- [ ] Bill rows: add initiators ("הוגשה ע"י…") and official PDF link (fs.knesset.gov.il, hotlink)
- [ ] Resilience: one-time harvest of the frozen votes archive into our own KV/static files,
      in case the Knesset ever shuts the old service (it's frozen data — collect once, keep forever)
- [ ] Old-archive person search (per-MK records before 2021, via vote_rslts_kmmbr_shadow)
- [ ] Mark laws struck down or limited by בג"ץ (Mercy's request 2026-08-21).
      No official dataset links court strikes to laws — this will be a CURATED list we build
      by hand (~20 full strikes in history + partial ones), our own original dataset:
      law name/id → ruling case number, date, what was struck, link to the verdict.
      Show as a badge on the law in search results + votes page.
- [ ] Court page next: pagination past 50, judge filter (GetJudges lookup ready),
      read rulings inside the site (GetHtmlPage endpoint — params not yet captured),
      פסיקה נבחרת (selected rulings) filter

## Phase 3 — Supreme Court
- [ ] Investigate the judiciary decisions site (no clean API — needs scraping)
- [ ] Recent rulings, summarized in plain language

## Later ideas
- [ ] Email/Telegram alerts: "a bill you follow reached a vote"
- [ ] Plain-language explainers for each budget section
- [ ] Compare budgets year over year
- [ ] Share cards for social media (make findings go viral)

## Data sources reference
- Budget Key API: https://next.obudget.org (Public Knowledge Workshop / הסדנא לידע ציבורי)
  — 118 public tables; the budget-relevant ones are mapped in CLAUDE.md
- Official open data portal: https://data.gov.il (CKAN API)
- Knesset OData: https://knesset.gov.il/Odata/ParliamentInfo.svc
- knesset-data docs: https://github.com/hasadna/knesset-data
- OECD COFOG (verified working, no key): sdmx.oecd.org/public/rest/data/
  OECD.SDD.NAD,DSD_NASEC10@DF_TABLE11,1.1/A.ISR...........
- Bank of Israel SDMX (untested): edge.boi.gov.il — dataflow BOI.STATISTICS:PS
- CBS APIs (untested, needs User-Agent): apis.cbs.gov.il/series/ (time series),
  api.cbs.gov.il/index/data/price (CPI, for real-terms figures)
- MoF budget booklets / דברי הסבר (PDF, fetchable):
  gov.il/BlobFolder/dynamiccollectorresultitem/{ministry}-proposal-{year}/he/…
- MoF budget execution, תקנה level, monthly+annual XLSX (listing needs a
  DevTools capture): gov.il/he/Departments/DynamicCollectors/budget-execution-estimate
