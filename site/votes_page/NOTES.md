# NOTES.md — the votes & bills page (site\votes_page\)

Everything settled about THIS page. Shared front-end rules are in
`site\CLAUDE.md`; the vote INDEX that lives in the worker (build, TSV format,
search endpoint) is documented in `worker\CLAUDE.md` — this file covers the
client side (`idxMeta()` / `idxSearch()` / `groupsFromIndex()` in
votes.data.js) and everything Mercy ruled about search and display. Same
keep-it-current rule as CLAUDE.md.

Files (load order: ../config → strings → ../shared/common → data → search →
bills → view): `index.html` shell · `votes.css` · `votes.strings.js` ·
`votes.data.js` (APIs, archive, index client, `state`) · `votes.search.js`
(matching, plain + advanced search, paging, filter passes) · `votes.bills.js`
(second tab) · `votes.view.js` (rendering + init). `selftest.html` +
`selftest.js` (in this folder since 2026-09-06) is this page's live self-test:
it loads the page's real files and runs them against live data. Tests:
`test_votes.mjs` / `test_index.mjs` / `test_selftest.mjs` live in Claude's
cloud workspace (mocked Knesset). Links to an MK are `../mk_page/?name=…`.

## THIS FOLDER IS THE WHOLE PAGE (Mercy's rule, 2026-09-06)

To change this page, a chat needs THIS folder and nothing else. Everything
the page shows comes from a public API or from Cloudflare (via the relay);
nothing is read from disk. The only files outside this folder the page
touches are three shared ones it must NOT edit from here:

- `../config.js` — `window.PROXY_URL`, the relay address. Read-only.
- `../shared/style.css` — design tokens + shared components. Read-only;
  page styling goes in this folder's own `.css`.
- `../shared/common.js` — loaded AFTER this page's strings file and BEFORE
  its data file. What it gives us (plain globals, no modules):
  `t(key)` (page string, else common string, else the key) ·
  `applyLang()` / `toggleLang()` + `lang` ("he"|"en"); the page sets
  `window.PAGE` (nav tab id), `window.PAGE_STR = {he:{…}, en:{…}}` and
  `window.onLangChange` · `buildChrome()` runs on load and fills
  `<header class="topbar">` (brand, nav tabs, language button) and adds the
  tagline when `PAGE_STR.*.tagline` exists · `esc(s)` · `isoDaysAgo(n)` ·
  `dateOf(v)` / `fmtDate(v, "long"?)` · `PROXY` (relay base, no trailing
  slash) · `viaRelay(url, body?)` (relay GET/POST of a government URL,
  204→null) · `preset(name, params)` · `dataset(name)` (relay KV snapshot,
  unwraps `{t, data}` and shows "data updated" in the footer) ·
  `fetchJson(url)` · `friendly(err)` · `debug(msg)` (writes into `#debug`).
  Common strings available through `t()`: title, navBudget, navVotes, navMk,
  navCourt, loading, searchBtn, empty, credit, err, updatedAt, errCors,
  errProxy.
- Links to other pages are `../<name>_page/` (budget_page, votes_page,
  mk_page, court_page); the nav itself is built by common.js.

If a change needs something NEW from common.js or style.css, say so and ask
for `../shared/` — don't copy code from there into this folder.


## Search on votes.html — what was wrong and the rule it taught (2026-08-21)

Mercy hit "בודק את תוצאות ההצבעות…" forever on advanced search
(הוגשה על ידי = בנימין נתניהו + סוג = פרטית). Three causes, all now fixed:
1. **A pending check over work never dispatched.** The page asked "do ALL
   advGroups still lack _passed/_bill?" but only sent the first 120 for
   checking → with >120 groups the spinner could never end. Worse,
   ensureBillInfo(g, 0) returned early WITHOUT setting _bill, so votes with no
   bill behind them (motions, no-confidence) stayed "unchecked" forever.
   RULE: background work must be bounded, counted, and always settle — the
   pending test must be over exactly the set that was dispatched.
2. **The type filter was asked of the wrong table.** Deciding "is this vote on
   a private bill?" per vote cost 1 detail + 3 OData calls × 120 = ~480
   parallel requests through the relay. Now: when a person is named, we fetch
   THEIR bills once (KNS_BillInitiator → KNS_Bill with SubTypeID) and filter
   there; per-vote lookups only happen when no person was named.
3. **The question was asked backwards.** "Bills proposed by X" was answered by
   text-matching X's bill names against *votes in the last year* (the silent
   default range). Netanyahu's private bills are from the 1990s → zero, always.
   Now the person's bills ARE the answer: when no vote matches, the page lists
   the bills with their status and offers a jump to the bills tab.
   RULE: start from the entity the user asked about, not from the feed we
   happen to have loaded.

Also now: plain law search walks back through older 120-day windows (up to ~3
years) instead of only filtering what's in memory; matching is word-order blind
and ignores punctuation/הת­שפ״X-year suffixes (normTxt/billCore/textMatch);
the effective date range is always shown, and a capped run says so.
Tested with mocked relay routes (test_votes.mjs pattern, Playwright).

## selftest.html — THE TOOL TO USE BEFORE SAYING "FIXED" (2026-08-22)

Mercy asked for a testing tool because every bug that reached her had passed
tests built on MOCK data. `selftest.html` + `selftest.js` load the REAL page
markup and the REAL scripts, drive the actual functions (doSearch / advSearch /
currentList) against LIVE data, and POST the report to the worker at
`/qa/report`. **Claude can then read it directly** — no screenshots, no copying:
    WebFetch https://our-money.idannhhb.workers.dev/qa/report?fresh=<n>
(the ?fresh= is mandatory — WebFetch caches a URL for ~15 minutes and a stale
report already fooled me once). `selftest.html?mk=שם` tests any MK.
Scenarios cover: feed, index presence, law-name search (results + speed +
order + reach), TYPE-ONLY search, result filter, initiator search (found bills,
nothing shown unverified, checking stops when the page is full), the proposers
rule, and MK-name search. `test_selftest.mjs` runs the tool itself in Playwright
against the fake upstream, so the tool is tested too.
GOTCHA found while building it: a second `<footer>`/`#debug` on a page made
common.js `renderFreshness()` throw inside `dataset()`, which silently emptied
the persons directory. renderFreshness is now guarded — a decoration must never
be able to break the data it decorates.

## The expanded vote panel — Mercy's layout (2026-08-22), keep this order

1. **הוגשה על ידי** — first line, always (up to 4 names; more = a count + toggle)
2. **כנסת · ישיבה · N הצבעות** on ONE line, with a button that reveals the
   individual reservation votes. Only the decisive vote shows by default —
   "most users are not gonna care" about 30 instances of the same bill.
3. the decision text (ההחלטה: …)
4. who voted what, by faction
5. **מסמכים רשמיים** — last line

The result badge and the tallies were being printed TWICE (row + panel); the
panel's copy is gone. `groupDetailHtml()` owns this order; `detailHtml()` now
returns only the decision + the faction breakdown. Asserted in both
test_index.mjs (panel starts with proposers, no duplicate badge) and
selftest.html (same checks against live data).

## Mercy's display rule for proposers (2026-08-22) — do not "improve" it

Up to FOUR initiators: list the names. More than four: say **how many**, with a
click to open the full list. NEVER show some names and hide the rest — she was
shown "משה גפני, איתן ברושי… ועוד 15" while searching for אכרם חסון, who was
inside the hidden 15, and reasonably concluded the result was wrong. A partial
list is worse than a count, because the name you're looking for is exactly the
one that gets cut. `initiatorsHtml()` in votes.view.js; same rule in the bills
tab and in the "his bills" fallback list.

## Priority she set (2026-08-22): law-NAME search matters more than advanced search

Law-name search is the index path: one request per year block, in parallel with
the MK-directory lookup (they used to be serial — that was a wasted round trip
on every search). Measured 111ms to first rows in the mocked harness.
The initiator search is the slow, inexact one; the fix is queued below, not done.

## THE REAL FIX STILL PENDING: store the BILL ID on every index row (worker v8)

Today "bills proposed by X" = X's bill NAMES → text-search vote titles →
open each candidate to see which bill it really is. Three chained trips plus one
request per row: that's the 30 seconds, and the text step is a guess.
With a bill-id column it becomes: X's bill ids (cached) → ask the index for rows
whose bill id is in that set. One request, exact, no name matching, no checking.
Cost: archive ids are free (sess_item_id, already in the rows we fetch — needs a
re-sweep); modern ids need one GetVoteDetails per vote (~10k, one time, batched
via build.html or the cron). Mercy deferred it — raise it again when she asks
for the advanced search to be fast.

## Three fixes Mercy had to demand twice (2026-08-22) — read before touching search

1. **Never render a row that hasn't passed the active filters yet.** My first
   "verification" hid a wrong row only AFTER its check came back, and rows past
   the 300-cap were never checked at all — so a bill by גדעון סער sat in a
   search for someone else's bills. Now `checked(g, a)` gates the list:
   an unchecked candidate is simply not in `currentList()`. Filtering that
   corrects itself later is not filtering.
2. **Sort by a real date, never by comparing date TEXT.** The sources return
   `2023-03-15`, `15/03/2023` AND `/Date(…)/`. Comparing those as strings sorts
   by day-of-month — that's what put a 2023 vote above a 2026 one. `voteTime()`
   in votes.data.js runs everything through dateOf() first; the same for the
   grouping key (`voteDay()`). test_votes.mjs feeds the mock API mixed formats
   on purpose and asserts descending order — verified that it fails on the old
   comparator.
3c. **A filter by סוג alone returned nothing, always (2026-08-22).** `checkOne`
   fetched the vote's details only for the initiator/result filters — but the
   bill id lives in those details, so with only the type filter set, `_bill`
   was always the empty placeholder and no vote could ever match "פרטית".
   Deterministic, not flaky. Caught by selftest.html's type-only scenario,
   which is exactly why that tool exists.
3b. **A cap must never be applied before a filter.** `/search/votes` collected
   up to `limit` matching lines and THEN applied the date range — so a dated
   search could return nothing while matches existed just past the cap. The
   range is now applied inside the scan, and year files outside it aren't even
   read. Same class of bug as #1: decide first, then cut.
3. **Check only as far as the page needs.** Every check costs one request, so
   `fillPage()` walks candidates in batches of 12 and STOPS once the current
   page has enough qualifying rows (~80 requests for a 40-row page instead of
   300). Paging continues from `state.advCursor`. The test counts the actual
   requests, so a regression here fails loudly.

## THE ARCHIVE VOTE→BILL LINK EXISTS (2026-08-22) — verified live via the relay

Mercy asked whether we simply don't know who proposed a law before July 2021.
We do, and now the site proves it per vote:
- `View_vote_rslts_hdr_Approved` carries **`sess_item_id`** (and `vote_item_id`).
  The earlier note that its fields were only the ones listed was incomplete.
- `sess_item_id` = `KNS_PlmSessionItem.ItemID`, which also gives `ItemTypeID`
  (`KNS_ItemType`: 1 שאילתה · **2 הצעת חוק** · 3 אי אמון · 4 הצעה לסדר ·
  5 ישיבת מליאה · 12 ישיבת ועדה · 6000-6003 misc).
- When the item is a bill, that SAME id is `KNS_Bill.BillID`. Verified:
  item 88733 → "חוק התכנית להבראת כלכלת ישראל…", Knesset 16, ממשלתית.
  (KNS_BillInitiator was empty for it — correct: government bills have no MK
  initiators, don't read that as a broken join.)
- votes.data.js `oldItemId(v)` fetches it once per archive vote
  (`$filter=vote_id eq N&$select=sess_item_id`) and caches it on the row, so
  pre-2021 votes get exact initiator verification AND an "הוגשה על ידי" line.
- NEXT: store sess_item_id as a column in the index (worker v8) and this costs
  zero requests; needs an archive re-sweep, and compaction's dedupe must then
  keep the NEWER line (today it keeps the first).

**The initiator match is VERIFIED, not guessed (2026-08-22).** Mercy searched
"הוגשה על ידי מיכל מרים וולדיגר · פרטית" and got a vote whose expanded panel
said "הוגשה על ידי: הממשלה" — her private bill and a government bill shared
almost the same name, and the title heuristic couldn't tell them apart. Now the
name match only produces CANDIDATES: each one's GetVoteDetails header carries
FK_ItemID (= BillID), which is checked against the person's own bill ids
(`state.adv.initIds`). `g._initOk` = true (keep) / false (dropped for good) /
null (archive vote — our index has no bill id for those, so it's shown with a
"התאמה לפי שם בלבד" chip). RULE: a text match is a candidate, never an answer,
when an id-level join exists.

## Design decisions (Mercy-driven, 2026-08-21)

- Votes page = TWO SUB-TABS ("הצבעות במליאה" / "הצעות חוק בתהליך"), because
  votes (events: who voted, passed/failed, person, dates) and bills
  (documents: status, committee, journey) are different things with different
  filters. We tried one view + a mode dropdown first — it produced an endless
  stream of meaningless filter combinations. Don't merge them again.
- Interaction language: rows expand DOWNWARD (accordion), search filters the
  same list in place, one search button total (advanced panel = extra filter
  fields, no second button). Minimal info per row (name + date + ✔/✘);
  depth one click away. Person names auto-detect (word-order blind — the
  Knesset directory is surname-first); multi-match opens the advanced panel
  with pick-chips.
- Bills tab: stage dropdown = הכל / עלו להצבעה / לא הגיעו להצבעה shortcuts +
  every official KNS_Status; date range filters LastUpdatedDate (OData
  datetime'...' literals); "עוד" pages via $skip.
