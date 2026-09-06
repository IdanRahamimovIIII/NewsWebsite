# NOTES.md — the MK portfolio page (site\mk_page\)

Everything settled about THIS page. Shared front-end rules are in
`site\CLAUDE.md`; upstream API facts in `site\SOURCES.md`. Same
keep-it-current rule as CLAUDE.md.

Files (load order: ../config → mk.strings → ../shared/common → mk.data →
mk.view): `index.html` shell · `mk.css` · `mk.strings.js` · `mk.data.js` ·
`mk.view.js` · `test_mk.mjs` (Playwright, mocked Knesset — to RUN it Claude
also needs `../config.js` and `../shared/`).
Photos (since 2026-09-06): the page reads the manifest from the relay,
`GET <PROXY>/data/mkphotos` → `{t, data:{"<MkId>": "<URL or filename>"}}`,
a bare filename meaning `<PROXY>/photos/mk/<file>`; no manifest → initials
avatars. The collector (`get-photos.bat` → `fetch_photos.py`) and the images
are pipeline territory now (`site\_move-to-pipeline\` until Mercy moves it;
contract in `site\HANDOFF-cloudflare-data.md`). Arriving with `?name=` opens
that MK (the votes page and the old `mk.html` forwarder link that way).

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


## THE MK PORTFOLIO PAGE (2026-08-25) — BIG ROCK 1 v1

Built in one session, Mercy's scope call: bills + positions + votes, full
history, new nav tab + name links (attendance, ministry-budget-under-term
and שאילתות deferred to v2). New files only, per the standing rule:
`site/mk.html` + `site/mk/` (strings/data/view/css, the votes.html split
convention) + `site/tests/test_mk.mjs`. Touched: common.js (fourth tab "חברי
הכנסת"), votes.view.js (every MK name → `mk.html?name=…` via mkLink(),
initiators + faction breakdowns + a "לתיק" chip on the MK-record line),
votes.strings.js (mkProfile), votes.css (.mklink), test_links (mk.html in
PAGES). No worker change — everything rides the generic relay + existing
/data/persons and /data/bills snapshots.

- **Two id spaces, bridged by name.** Votes: GetVotesCmbData MkId per
  Knesset (16–25). Bills/positions: OData PersonID. Names disagree on word
  order ("לפיד יאיר" vs "יאיר לפיד") → nameKey() = sorted words; candidates
  merged across both directories; display prefers the persons form. Fallback
  when the persons snapshot misses someone: KNS_Person by FirstName/LastName
  both orders.
- **measured 2026-08-25, via the relay /b64 probe:** KNS_PersonToPosition
  fields verified live (PositionID, KnessetNum, StartDate/FinishDate,
  GovMinistryID/Name, DutyDesc, FactionID/Name, GovernmentNum,
  CommitteeID/Name, IsCurrent) — rows reach back to Knesset 2 (1951). Role
  label = DutyDesc, else KNS_Position.Description (gendered rows, ~few
  hundred, paged). KNS_Status list also probed (the summarizer garbled some
  Hebrew, so bucket rules were written against patterns, not exact ids).
- **The positions register is DIRTY in two measured ways (PersonID 965,
  2026-08-25, found live by Mercy on the first real profile):** (a) the same
  office sits under TWO gendered position codes — PositionID 45 and 39 are
  both "ראש הממשלה", same dates, both IsCurrent — and (b) one continuous
  term is split into rows wherever GovernmentNum changed mid-Knesset
  (K23 PM: 16.3→17.5.2020 + 17.5.2020→6.4.2021). tidyPositions() collapses
  rows that render identically, then stitches same-office spans that touch
  (≤1 day) or overlap. Real short stints with real gaps (his 3-day housing-
  ministry hand-offs) are KEPT — that is the state's own record, not noise.
- **Bill piles are pattern-matched on the status TEXT and the exact status
  is printed on every row** — a mis-bucketed bill is visible, never hidden.
  passed: התקבלה | פורסמ…רשומות · rejected: נדח | הסרה | הוסר | נעצר | בוטל |
  מבוטל | נסגר · else in-process/other (מוזגה lands there, text shown).
- Voting record: SearchType:2 per Knesset (chips, newest default, cached),
  reservation-marathon grouping same as votes.html, GetVoteDetails per
  visible row gives ✔/✘ + counters + the person's own line (matched
  word-order-blind). Pre-2003 (pre-K16): honest empty state; the frozen
  archive's per-member table is the v2 route.
- KNS_BillInitiator still caps pages at 100 whatever $top says — paged with
  $skip here too. IsInitiator/Ordinal 1 → "יוזמ/ת ראשי/ת" tag.
- **Search v2 (same day, Mercy's five asks):** live as-you-type (250ms
  debounce, seq-guarded, two-phase render: cheap signals draw instantly,
  position lines fill in), ranked by her rule — serving now → last-Knesset
  recency → roleRank() of heaviest-ever role → role count. Position line:
  current role, else last role + years, and ever-PM overrides with
  "ראש הממשלה <year spans>" (exact role match, so ראש הממשלה החלופי does NOT
  count as PM). Candidate positions come batched (OR-filter, 6 pids/query)
  into a per-person cache the profile reuses. MKs/GetMksDropdown (1 GET,
  cached) supplies IsCurrent. GetMkDetailsContent?mkId= works and carries
  bio (birth, education, profession) — unused so far, a v2 freebie.
- **THE PHOTO ROUTE — solved by Mercy's DevTools capture (2026-08-25):**
  GET `MKs/GetMkdetailsHeader?mkId=N&languageKey=he` → MkImage = the
  official portrait URL on fs.knesset.gov.il (plus Position, Faction,
  Email, socials, BannerImage). BOTH the API and the image answer through
  the relay (image verified: 200, image/jpeg, 125KB — the "fs. answers 474"
  note does not apply to globaldocs images via the worker). The site's other
  route, `SpList/GetMKImages` (POST), checks Origin/Referer and answers
  literal `null` to the relay — a 200 that lies; don't waste time on it.
  `GetMkDetailsContent?mkId=N` carries the personal background (birth,
  education, military service, profession, languages) — now a portfolio
  card, only filled fields, and the free-text `Content` HTML is NOT
  injected (unsanitized upstream HTML stays out of our DOM).
- **Photos are SELF-HOSTED (Mercy's call, 2026-08-25):** no reachable API
  names the photo URL (KNS_Person has no photo field, GetMkDetailsContent
  none, /mk/images/members/{id}.jpg 404s cleanly), `site\get-photos.bat` →
  `site/fetch_photos.py` (stdlib only) collects the current members' photos
  into site/photos/mk/ — fully hands-free: per member it asks
  GetMkdetailsHeader for MkImage and downloads it through the relay
  (0.8s politeness pause — a full historical run is a ~30min one-time
  stroll; --all for past members, --refresh to update). misses.json
  remembers members with no portrait so re-runs never re-ask about them.
  With Pillow installed the script shrinks photos to 512px JPEG (~5x
  smaller; the site shows 72px max) and diets previously collected
  originals too; without Pillow it keeps originals and says so. Files are
  accepted by MAGIC BYTES, never extension. Mercy's first run: ~120
  current members, 14.3 MB pre-shrink, config-comment parser bug found
  and fixed (strip /* */ comments before reading PROXY_URL — the header
  comment carries an EXAMPLE address, and a naive trailing-// stripper
  eats the // inside https:// itself).
  The page reads site/photos/mk/index.json ({MkId: filename}) — no manifest
  = initials avatars, and the page NEVER guesses image URLs (no 404 spam
  in either direction). Missing members are listed in FULL at the end of a
  run, per the no-partial-lists rule.
- **Coalition/opposition: no official dataset.** KNS_Faction = FactionID,
  Name, KnessetNum, Start/FinishDate, IsCurrent — no coalition flag
  (probed 2026-08-25). Routes: DevTools capture of the current list, or a
  curated per-Knesset faction→coalition file (like the בג"ץ-strikes idea).
  Ministers/deputies imply coalition, but PARTIAL inference on the page
  would mislead — don't ship it half.
- `site/tests/test_mk.mjs`: 40 asserts on a mocked Knesset with the real traps
  (two id spaces, duplicate cmb rows, reservation folding, bucket edge
  "להסרה מסדר היום" — that one caught a real regex miss — and the register
  dirt above). All green + links
  guard 21/21. NOT yet verified against live data — Mercy opens mk.html.
