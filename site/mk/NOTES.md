# NOTES — MK portfolio page (site\mk\)

`index.html`: search card, `#profile` (`#phead`, `#ptiles`, `#positions`,
`#bills`, `#mkknessets` + `#mkvotes`), `#dirCard` → `#dir`. `mk.data.js`
(nine numbered sections, TOC in header) · `mk.view.js` (eight sections,
`PAGE_VER` in init) · `mk.css` ordered like the page · `mk.strings.js` keeps
a tail group of keys no longer in index.html (cached old HTML).
Knesset API facts: `../shared/SOURCES.md`.

## Rules
- Bump `PAGE_VER` on EVERY change (`26.09a`…`26.09z`, `26.09aa`) — the
  footer stamp tells a stale cached copy apart. The search card is found via
  `#mkq.closest(".card")` (a missing `#searchCard` once froze clicks).
- CMS fields: entity-decoded (`bioText`/`bioClause`) then escaped;
  GetMkDetailsContent `Content` HTML never used. Birth year: `yearIn()` takes
  the last 4-digit run (dateOf can't read it).
- Never guess image URLs: `photoOf()` reads `/data/mkphotos`
  (`{t, data:{MkId: file}}`, file served at `/photos/mk/<file>`); no
  manifest (404/501/error) → initials.
- A mis-bucketed bill stays visible: exact status text on every row; register
  dirt printed as written.
- Don't ship half an inference (coalition/opposition).
- Pre-K16 (before 2003) is outside every window: votes directory,
  former-minister tier, the archive's end.
- Cache directory-sized requests as PROMISES (`ensureCmb`, `ensurePersons`,
  `buildDirectory`) — two concurrent `buildDirectory()` once raced and wrote
  an EMPTY directory.
- Never "0" on a card: zero laws and an unknowable count both mean no line.
- `od()` adds `$format=json`, unwraps both v3 flavours. `docUrl()` normalizes
  document paths; links open straight at the Knesset (`rel="noopener"`).

## Names — two id spaces
Votes use MkId per Knesset (K16–25); bills/positions use OData PersonID.
Bridge = the name, word-order-blind: `nameKey()` = sorted words. Display
prefers the persons form ("יאיר לפיד"); sorting uses cmb (surname first).
- Exact word-set match first, else `looseMatch`: quotes ignored; every word
  of the SHORTER name found in the longer, each used once, at least one exact
  (3+ letters may prefix-match: בני ~ בנימין). Fixture "בניה גנצר" must not
  be "גנץ בני".
- Namesakes (two אלי כהן, two ישראל כץ): the PersonID with rows in THIS
  Knesset wins — else their bills get summed.
- K25 spellings that differ: גנץ בני=בנימין גנץ · סטרוק אורית=אורית מלכה
  סטרוק · פינדרוס יצחק זאב=יצחק פינדרוס · מלקו צגה צגנש=צגה מלקו ·
  סגלוביץ=סגלוביץ' · כהן אלי אליהו=אלי כהן (30083, not 755). All 151 resolve.
- `fallbackPersonIds(name)` (KNS_Person, both orders) for snapshot misses —
  runs before ranking and before BOTH loads in `openPerson`.
- `dataset("persons")` = {PersonID: name} (misses a few);
  `dataset("bills").statuses`. Vote breakdown's own line: `annotateOne`.

## Positions
- `tidyPositions()`: collapse identical rows, stitch same-office spans that
  touch (≤1 day) or overlap; never across Knessets; real gaps kept. Bulk
  directory rows are not tidied.
- `roleRank()`: ראש הממשלה 100 (exact, so החלופי isn't PM) · ראש הממשלה
  החלופי 92 · ממלא מקום/סגן ראש הממשלה 90 · יושב-ראש הכנסת 85 · שר… 80 ·
  ראש האופוזיציה 75 · סגן/סגנית שר 60 · ממלא מקום/מ"מ שר 58 · יו"ר ועדה 50 ·
  יו"ר סיעה 40 · סגן יו"ר הכנסת 35 · חבר ועדה 10 · else 5.
- `plainRole` = faction membership or bare "חבר/ת הכנסת". `currentRole(rows)`
  = heaviest open-ended role of substance, or "" (cards + hero).
  `posCtx(r)` adds committee/faction to generic roles.
- `positionsForMany(pids)`: OR of 6 PersonIDs per query, 3 in flight, cached
  per PersonID (empty counts). `bulkPositions(filter)` = `$count`, then pages
  4 in flight.
- Timeline (`ongoingFirst`): open-ended rows on top, heaviest first, then
  past newest-first; `POS_PREVIEW = 4` + "show all".

## Directory grid (home screen)
K25's 151 members (leavers included) as profile cards: portrait (96px, 76 on
phones) · name · role (blue) · party · years · laws passed · a "why" line on
role/party search matches. One grid, alphabetical within rank, no grouping.
- Party = cmb Factions + faction_id (`factionShort()`: trim, drop "בראשות …",
  ש"ס), tooltip teaches "סיעה". Years = first cmb Knesset start, refined to
  the register's earliest StartDate. Role = `cardRole()`. Laws =
  `countBills()`, one `$count` per member with passed StatusIDs from
  `billBucket()` so the card agrees with the profile's עברו pile.
- Order (`dirRank`/`dirOrder`, Mercy): (1) serving now · (2) tier: PM 10 →
  alternate/deputy PM 9 → Speaker 8 → opposition leader 7 → minister 6 →
  deputy minister 5 → committee chair 4 → former minister 3 (latest ministry
  first, `lastMin`) → 0 · (3) leavers by year left · (4) name (cmb form).
  Serving = GetMksDropdown IsCurrent OR an open "חבר הכנסת" row this Knesset.
  Minister row = GovMinistryName and not סגן/ממלא מקום (office checked first).
  Known: 9 sitting ministers who left the Knesset sort after all 120 serving
  (flagged to Mercy; "government counts as serving" is one line in dirRank).
- Bulk at load (~17 requests, sorted in 2–3 s, nothing jumps): all K25
  register rows (`e.k25`) + every ministry row since K16 (`e.minRows`).
- `cardRole`: sitting member with no role of substance today reads
  "חבר/ת הכנסת" (current always outranks historical); a leaver shows the last
  role with years. `cardYears`: "–היום" only if `e.serving`; else last
  FinishDate, else `lastK`.
- Cost: role + laws only for cards scrolled into view (IntersectionObserver
  300px; `dirWant()` pools 120 ms). First paint asks 36 of 151. `state._dir`
  indices are append-only.
- Infinite scroll (`loadNextKnesset`, `#dirmore` 600px ahead): one bulk query
  per earlier Knesset, 24 → 16, skipping shown names; the tail re-sorted IN
  PLACE (`tailOrder`: lastK ↓ → tier during that Knesset ↓ → lastMin ↓ →
  name) because the array identity is what `buildDirectory()` resolved to.
  Past K16 the sentinel says the archive ends; hidden while searching.
- Search-added cards (`makeEntry`) slot in by last Knesset and stay.

## Search — words, not substrings
Filters cards in place (250 ms debounce, seq-guarded); "לא נמצא…" in place;
Enter opens a lone card; `openByName` with namesakes filters to them.
- `entryHit(e, words)`: every query word is a WHOLE word of ONE text (name,
  one role via `posCtx`, one faction), allowing a Hebrew clitic prefix on the
  text word (`HEB_PREFIXES` ה ו ב ל מ ש כ, stacked); only the last query word
  may be a prefix. `tokensOf` splits on - – — ־ · , ( ) / and drops ״ " ׳ '.
  (Substrings matched "ראש" inside "לראשות".)
- "Why" order: role of substance (latest, with years) → own party (hidden) →
  official faction name (shown) → plain row. Hidden when the card already
  says it; name matches show none.
- Reaches without a request: K25 members' rows, ministry rows since K16,
  appended Knessets; else `findCandidates` by name (cap 30). Everything that
  matches stays; "exact role first" was tried and reverted (too narrow).

## Portfolio (one person)
- `openPerson(entry)` resets state, pushes `?name=` (unless already there);
  `popstate` shows whoever the address names; "→ חזרה לרשימה" =
  `history.back()` when possible. `openByName()` = the door for `?name=`.
  Search card + tagline hidden while open. `state.seq` cancels older loads.
- Entity address `/mk/<MkId>-<slug>/` (worker `pages.js`, `worker\CLAUDE.md`):
  same shell, facts pre-baked, `window.MK_ENTITY` → `openByMkId` (directory
  entry by cmb Id, else by name); `atEntity` = no `?name=` push; language
  toggle swaps he/en address; Back to list → `/mk/`. Shell ids/classes are
  the worker's anchors — change them → run `worker/wtest_pages.mjs`.
- Hero (Mercy: guide the eyes, don't throw data): portrait 128px (104 phones)
  · "<name> · <current role>" (role only if `inLatestKnesset`) · faction
  (tooltip `factionTip`) · `tenureLine` ("בכנסת מאז 1988 (38 שנה)" /
  "בכנסת 2013–2024") · "31 הצעות חוק — 6 הפכו לחוק" with the counts (zero
  pending/stale hidden) · background as a small two-column table (`.biot`,
  filled fields only, ", ישראל" dropped). Removed on purpose: PM spans, a
  stacked bar, gendered prose. Section titles: מה עשו לאורך השנים? · מה ניסו
  להעביר? · איך הצביעו?
- Position row: dates (+ "מכהנ/ת" chip if open and IsCurrent) · role ·
  ministry/committee/faction · Knesset.
- Bills (`loadBills`): initiator pages per PersonID → KNS_Bill batches of 10,
  4 in flight → `billBucket(statusText)`: passed = התקבלה | פורסמ…רשומות ·
  rejected = נדח | הסרה | הוסר | נעצר | בוטל | מבוטל | נסגר · else undecided
  (מוזגה too), split: this Knesset = בתהליך (blue), earlier = לא הוכרעו (gray).
  One pile at a time: radio check-circles (`.fchip`, counts + tooltips),
  `state.billPile` = עברו else first non-empty; `.billq` substring search in the pile;
  newest Knesset, then last update; 20 rows + "עוד {n}". Controls built ONCE
  per person, only `#billslist` re-renders (caret). Lead-sponsor tag. A row
  opens its documents (`billDocs`, by stage, one link per format, cached,
  fetched on open).
- Votes: SearchType 2 per Knesset (chips, newest default, `votesByK`);
  reservation marathons folded (same bill + day → one row, latest vote
  decisive); subject search (`state.voteQ`) inside the Knesset; controls built
  once per person; 25 per page. `GetVoteDetails` per visible row (6 in
  flight, `_busy`; failure → `_passed = null`). Opened vote: Knesset ·
  sitting · tallies · decision · bill documents via FK_ItemID. Pre-K16:
  honest empty state.

## Test
`node site/mk/test_mk.mjs` (serves `site/` on :8933, mocks the relay),
113 asserts; fixtures commented in the file: two id spaces, duplicate cmb
rows, twin position codes, split PM term, a real gap, רגב מירי (cmb-only,
reversed), גנץ בני, בניה גנצר, a namesake with 99 laws, a leaver/former
minister, K20-only, persons-only, the "…לראשות הממשלה" row, en-dash Speaker,
a `$count` refusing unfiltered counts, dirty doc paths, CMS entities, the
photo manifest, the build race, Back/Forward, the caret.

## Open
- `/data/mkcards` is live (`pipeline\mkcards\NOTES.md`): directory cards
  read it + link to the entity URLs (phase 4).
- English entity page: the baked hero says "Roni Malkai", then the live
  profile redraws the Hebrew name (cards carry `en` — use it on toggle?).
- Coalition/opposition: a DevTools capture or a curated per-Knesset file.
- Tooltips are hover-only (tap-to-reveal if Mercy wants).
- Attendance score · ministry budget under a minister's term · שאילתות ·
  pre-2003 votes (frozen archive's per-member table).
- מפלגה instead of סיעה = one word in mk.strings.js (the data says סיעה).
