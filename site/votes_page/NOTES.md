# NOTES — votes & bills page (site\votes_page\)

Files beyond the standard split: `votes.search.js` (matching, plain +
advanced search, paging, filter passes) · `votes.bills.js` (second tab).
Load order: config → strings → common → data → search → bills → view.
`ROWS_PER_PAGE` (not `PAGE` — it shadowed `window.PAGE`). The vote INDEX
(build, TSV format, `/search/votes`) is the worker's; this page's client is
`idxMeta()` / `idxSearch()` / `groupsFromIndex()` in votes.data.js.
Tests `test_votes.mjs` / `test_index.mjs` / `test_selftest.mjs` live in
Claude's cloud workspace (mocked Knesset). MK links: `../mk_page/?name=…`.

## selftest.html — use before saying "fixed"
Loads the REAL page files, drives doSearch / advSearch / currentList against
LIVE data, POSTs the report to `/qa/report`; Claude reads it with WebFetch
`<relay>/qa/report?fresh=<n>`. `selftest.html?mk=שם` tests any MK. Covers:
feed, index, law-name search (results, speed, order, reach), type-only,
result filter, initiator search, proposers rule, MK-name search. Exists
because every bug that reached Mercy had passed mock tests.

## Design (Mercy)
- TWO sub-tabs, "הצבעות במליאה" / "הצעות חוק בתהליך": votes are events, bills
  are documents; one view + mode dropdown made meaningless filter combos.
  Don't merge them.
- Row = name + date + ✔/✘. Person names auto-detected (word-order blind);
  several matches open the advanced panel with pick-chips.
- Expanded vote panel, this order (`groupDetailHtml()`): 1 הוגשה על ידי ·
  2 כנסת · ישיבה · N הצבעות on one line + button revealing the reservation
  votes (only the decisive vote by default) · 3 ההחלטה · 4 who voted what,
  by faction · 5 מסמכים רשמיים. Badge and tallies appear once (row only).
- Proposers: ≤4 → names; more → the COUNT with a click for the full list.
  Never some names + "ועוד 15" (`initiatorsHtml()`; same in bills tab and
  the "his bills" list).
- Law-NAME search matters more than advanced search: index path, one request
  per year block, in parallel with the MK-directory lookup. Matching is
  word-order blind, ignores punctuation and התשפ״X suffixes
  (normTxt/billCore/textMatch); plain search walks back 120-day windows up to
  ~3 years; the effective range is always shown; a capped run says so.
- Bills tab: stage dropdown = הכל / עלו להצבעה / לא הגיעו להצבעה + every
  KNS_Status; date range on LastUpdatedDate; "עוד" pages via $skip.

## Search rules (each one was a real bug)
- Start from the entity asked about: "bills proposed by X" = X's bills
  (KNS_BillInitiator → KNS_Bill with SubTypeID), fetched once; if no vote
  matches, list those bills with status + a jump to the bills tab.
- A text match is a CANDIDATE when an id join exists: each candidate's
  GetVoteDetails FK_ItemID is checked against `state.adv.initIds`.
  `g._initOk` true keep / false drop / null = archive vote (chip "התאמה לפי
  שם בלבד") — unless `oldItemId(v)` fetched its `sess_item_id` (cached).
- `checked(g, a)` gates `currentList()`: an unchecked candidate is not shown.
- The type filter needs the details too (the bill id lives there) — a
  type-only search once matched nothing, ever.
- Check only as far as the page needs: `fillPage()` checks batches of 12 and
  stops when the page is full; continues from `state.advCursor`. The test
  counts requests. The pending test is over exactly what was dispatched,
  and a vote with no bill still settles `_bill`.
- Sorting/grouping via `voteTime()` / `voteDay()` (dateOf first); the test
  feeds mixed date formats.

## Open
- Worker v10: bill id on every index row (archive: `sess_item_id`, needs a
  re-sweep and compaction keeping the NEWER line; modern: one
  GetVoteDetails per vote, ~10k, batched) → initiator search = one exact
  request, no name matching (today ~30 s).
- Modern vote RESULTS into the index (~20k GetVoteDetails, cron harvest) →
  result/type filters without per-search checking.
- Participation on every vote ("5 מצביעים מתוך 120", sum of VoteCounters).
- Bill detail pages: initiators, history, text (LegislationItem), official PDF.
- Old-archive per-MK records before 2021; harvest the frozen archive into
  our own storage.
- Email the Knesset open-data team about the empty votes dataset on data.gov.il.
