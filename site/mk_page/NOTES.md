# NOTES.md — the MK portfolio page (site\mk_page\)

Everything settled about THIS page, by topic (a version history is at the
end). Shared front-end rules: `site\CLAUDE.md`; upstream API facts:
`site\SOURCES.md`. Same keep-it-current rule as CLAUDE.md: when a rule or a
measurement here changes, change it HERE, don't append a diary entry.

## 1. Files and the shared contract

Load order: `../shared/config.js` → `mk.strings.js` → `../shared/common.js` →
`mk.data.js` → `mk.view.js`. Each file has one job:

- `index.html` — the shell: search card, `#profile` (`#phead`, `#ptiles`,
  `#positions`, `#bills`, `#mkknessets` + `#mkvotes`), `#dirCard` → `#dir`.
- `mk.strings.js` — every word, he/en, grouped like the page, same key order
  in both. A tail group keeps keys no longer in index.html (secBio, the hint
  lines) so a cached older HTML never shows a raw key.
- `mk.data.js` — everything fetched, nothing drawn; nine numbered sections
  with a TOC in the header. `mk.view.js` — everything drawn, eight sections;
  the version stamp is in its init block. `mk.css` — ordered like the page
  (`.tiles` is still on `#ptiles` in index.html: a plain block now).
- `test_mk.mjs` — Playwright against a mocked Knesset, 113 asserts (§9).

**THIS FOLDER IS THE WHOLE PAGE (Mercy's rule, 2026-09-06; + shared\,
2026-09-08 — shared\ holds config.js too, so page + shared is the whole
set, tests included).** To change the
page a chat needs this folder and nothing else. Everything shown comes from a
public API or from Cloudflare via the relay; nothing is read from disk. The
three files outside the folder are READ-ONLY from here:

- `../shared/config.js` — `window.PROXY_URL`, the relay address.
- `../shared/style.css` — design tokens + shared components (`.card`, `.hint`,
  `.loading`, `.error`, the topbar). Page styling goes in `mk.css`.
- `../shared/common.js` — plain globals, no modules: `t(key)` (page string,
  else common string, else the key) · `applyLang()` / `toggleLang()` + `lang`
  ("he"|"en"); the page sets `window.PAGE`, `window.PAGE_STR = {he, en}` and
  `window.onLangChange` · `buildChrome()` fills `<header class="topbar">`
  (brand, nav tabs, language button `#langbtn`) and prepends
  `<p class="tagline" data-i18n="tagline">` to `.wrap` when the string exists ·
  `esc(s)` · `isoDaysAgo(n)` · `dateOf(v)` / `fmtDate(v, "long"?)` · `PROXY`
  (relay base, no trailing slash) · `viaRelay(url, body?)` (relay GET/POST of
  a government URL, 204→null) · `preset(name, params)` · `dataset(name)` (relay
  KV snapshot, unwraps `{t, data}`, shows "data updated" in the footer) ·
  `fetchJson(url)` · `friendly(err)` · `debug(msg)` (writes into `#debug`).
  Common strings: title, navBudget, navVotes, navMk, navCourt, loading,
  searchBtn, empty, credit, err, updatedAt, errCors, errProxy.
- Links to other pages are `../<name>_page/` (budget, votes, mk, court); the
  nav is built by common.js.

If a change needs something NEW from common.js or style.css, say so and ask
for `../shared/` — never copy code from there into this folder.

## 2. Standing rules for this folder

- **Bump `PAGE_VER` (mk.view.js, init) on EVERY change.** The footer stamp is
  how a stale cached copy is told apart from the new one. Scheme: `26.09a` …
  `26.09z`, then `26.09aa`.
- **A JS change must not REQUIRE a same-day HTML change.** Scripts load
  without a version query, so a browser can pair new JS with a cached old
  HTML (seen live twice: raw "dirBills" keys on cards; a crash on a missing
  `#searchCard` froze card clicks). Guard lookups (the search card is found
  via `#mkq.closest(".card")`), keep strings an old HTML might reference.
  The real fix, `?v=` on the script tags, is a shared convention — Mercy
  decides.
- **Nothing from upstream is ever markup.** CMS fields are entity-decoded to
  plain text first (bioText), then escaped like everything else; the free-text
  `Content` HTML of GetMkDetailsContent is never injected.
- **Never guess image URLs.** No manifest → initials avatars; no 404 spam at
  the Knesset or at our host.
- **A mis-bucketed bill must be visible, never hidden:** the exact status text
  is printed on every bill row. Register dirt is printed as the state wrote it
  (a stage literally named "… - פונצ בננה" stays).
- **Don't ship half an inference** (coalition/opposition, §10).
- **Pre-K16 (before 2003) is outside every window on this site**: votes
  directory, former-minister tier, the archive's end.
- **Cache directory-sized requests as PROMISES** (`ensureCmb`, `ensurePersons`,
  `buildDirectory`; `state.cmb` / `state.persons` / `state._dir` still hold
  the plain results) — the second caller joins the first request. Two concurrent
  `buildDirectory()` calls once raced: the later one saw everyone already on
  the page, built an EMPTY block and overwrote the directory.
- Never "0" on a card: zero laws passed and an unknowable count both mean no
  line at all.

## 3. Sources — what was measured, and what lies

Everything goes through the relay: `viaRelay(<government URL>)`. OData base
`PARL = https://knesset.gov.il/Odata/ParliamentInfo.svc/`; `od()` adds
`$format=json` and unwraps both v3 flavors.

**KNS_PersonToPosition** (verified live 2026-08-25 via the relay's `/b64`
probe): PositionID, KnessetNum,
StartDate/FinishDate, GovMinistryID/Name, DutyDesc, FactionID/Name,
GovernmentNum, CommitteeID/Name, IsCurrent; rows reach back to Knesset 2
(1951). Role label = DutyDesc, else **KNS_Position**.Description (gendered
rows, a few hundred, paged). The register spells יושב–ראש with an en dash on
some rows and a hyphen on others. Rows stay open-ended for people long gone —
an open row is NOT proof of serving. Bulk sizes (2026-09-06): `KnessetNum eq
25` = 554 rows (6 pages); `GovMinistryID ne null and KnessetNum ge 16 and
KnessetNum lt 25` = 1,024 rows (11 pages). `$count` works.

**The register is dirty in two measured ways** (PersonID 965, 2026-08-25):
(a) the same office under TWO gendered position codes — 45 and 39 are both
"ראש הממשלה", same dates, both IsCurrent; (b) one continuous term split into
rows wherever GovernmentNum changed mid-Knesset (K23 PM: 16.3→17.5.2020 +
17.5.2020→6.4.2021), and per Knesset (Netanyahu is ten PM rows). Real short
stints with real gaps (3-day housing-ministry hand-offs) are the state's own
record, not noise.

**KNS_Person**: FirstName/LastName lookups work (both word orders needed);
GenderID 251 = זכר, 250 = נקבה (measured 2026-09-06; unused today).

**KNS_BillInitiator** caps every page at 100 rows whatever `$top` says — page
with `$skip`. IsInitiator / Ordinal 1 = lead sponsor. `$count` with a
navigation path in the filter works and is NOT capped (Israel Katz: 244;
`$inlinecount=allpages` works too): `KNS_BillInitiator()/$count?$filter=
PersonID eq N and (KNS_Bill/StatusID eq 118 …)` ≈ 0.5–0.7 s via the relay,
cross-checked bill-by-bill (965: 6 of 31). **The OData firewall answers 473
"access denied" to `any()`/`all()` lambdas** (with and without the space,
2026-09-06) — navigation paths in $filter/$expand/$select all work. Don't
retry the lambdas.

**KNS_Bill**: BillID, Name, SubTypeID/Desc, StatusID, KnessetNum,
LastUpdatedDate. **KNS_Status** (also in the relay's `/data/bills` snapshot as
`statuses`): the summarizer garbled some Hebrew, so bucket rules match
patterns, not ids. Today only 118 "התקבלה בקריאה שלישית" is "passed".

**KNS_DocumentBill** (2026-09-07): one row per file — GroupTypeDesc = the
stage (הצעת חוק לדיון מוקדם · לקריאה הראשונה · לקריאה השנייה והשלישית · חוק -
פרסום ברשומות · חוק - נוסח לא רשמי · חומר רקע · קטע מדברי הכנסת),
ApplicationDesc = PDF/DOC (lies now and then: "PPT" for a .pdf — the file's
extension wins), FilePath = a public file on fs.knesset.gov.il (200
application/pdf; a .doc with SPACES in the name also 200). Paths carry a
doubled slash after the host and spaces — `docUrl()` normalizes.
**main.knesset.gov.il HTML pages are NOT linkable**: LawBill.aspx / Vote.aspx
answer the relay with a script-challenge page (relay code 247) — files only.

**KNS_Faction**: FactionID, Name, KnessetNum, Start/FinishDate, IsCurrent — NO
coalition flag (2026-08-25). The register knows only סיעות (parliamentary
groups), never parties: a list can carry several parties (יהדות התורה =
אגודת ישראל + דגל התורה), a סיעה can split mid-term (עוצמה יהודית left
הציונות הדתית in 2022). Hence the label "סיעה", taught by a tooltip.

**Votes API** `https://knesset.gov.il/WebSiteApi/knessetapi/Votes/`:
`GetVotesCmbData` (GET, the biggest payload on the page) = MKS [{Id, Name
(surname first), KnessetId, faction_id}] for K16–25 with duplicate rows,
`Factions` [{ID, FactionName, KnessetId}] (16 in K25; strings carry a trailing
space — the official "הליכוד " — and "בראשות <leader>" suffixes; Shas's
registered name is 14 words), `Knessets` [{KnessetId, KnessetStart,
KnessetEnd}]. `GetVotesHeaders` POST {SearchType:2, KnessetNum, MkId} = one
member's record. `GetVoteDetails/{id}` = VoteHeader (IsForAccepted, Decision,
FK_Knesset, SessionNumber, **FK_ItemID = the BillID for a bill vote**,
verified 2202055 ↔ the same Name in KNS_Bill), VoteCounters, VoteDetails
(MkName, Title = how each member voted).

**MKs API** `…/knessetapi/MKs/`: `GetMksDropdown?languageKey=he` (1 GET) =
{ID, Name, IsCurrent}. `GetMkDetailsContent?mkId=N&languageKey=he` = the
personal background: DateOfBirth is a STRING like `כ"ח בתשרי תש"י ,
21/10/1949` (dateOf() can't read it; `yearIn()` takes the last 4-digit run),
PlaceOfBirth "תל-אביב, ישראל", Education/etc. with "&#x0D;", "&amp;",
"&quot;" entities, "\n" breaks and "- " bullets (bioText / bioClause), plus a
free-text `Content` HTML that is never used. `GetMkdetailsHeader?mkId=N&
languageKey=he` = MkImage (the official portrait on fs.knesset.gov.il; 200
image/jpeg, 125KB through the relay — the "fs. answers 474" note elsewhere
does not apply to globaldocs images via the worker), BannerImage, Position,
Faction, Email, socials — used by the photo collector (`get-photos.bat` →
`fetch_photos.py`, `publish-photos.bat`), not by the page. No other API names
the photo: KNS_Person has no photo field, GetMkDetailsContent none. `SpList/GetMKImages` (POST) checks
Origin/Referer and answers literal `null` to the relay — a 200 that lies.
`/mk/images/members/{id}.jpg` 404s cleanly.

**The relay's own routes**: `dataset("persons")` = {PersonID: "יאיר לפיד"}
(the persons snapshot; misses a few); `dataset("bills").statuses`;
`GET <PROXY>/data/mkphotos` → `{t, data:{"<MkId>": "<URL or filename>"}}`, a
bare filename meaning `<PROXY>/photos/mk/<file>` (filenames carry a content
hash, `1132-a1b2c3d4.jpg`, served immutable for a year — the page never needs
to know). Collector/publisher/images live in `pipeline\photos\` (its
NOTES.md has the contract). No manifest (404/501/error) → avatars.

## 4. Names — bridging the two id spaces

Votes: MkId per Knesset (K16–25). Bills/positions: OData PersonID. The bridge
is the name, word-order-blind: `nameKey()` = sorted words ("לפיד יאיר" and
"יאיר לפיד" meet). Display prefers the persons-table form ("יאיר לפיד");
sorting uses the cmb form (surname first).

- **Exact word-set match first; else the tolerant pass** (`looseMatch`):
  apostrophes/quotes ignored; every word of the SHORTER name must be found in
  the longer one, each word used once, at least one exact (a 3+-letter word
  may otherwise match as a prefix: בני ~ בנימין). Without "used once / one
  exact" the first live run took "אליסף אליעזר" for "אלי כהן" — hence the
  fixture "בניה גנצר" must NOT be taken for "גנץ בני".
- **Namesakes**: when several PersonIDs answer (two אלי כהן, two ישראל כץ),
  the one with rows in THIS Knesset wins — otherwise their bills get summed
  (they were, quietly, in v26.09b: "כץ ישראל" = 468 + 3260 counted together).
- The 6 K25 names the snapshot spells differently: גנץ בני=בנימין גנץ ·
  סטרוק אורית=אורית מלכה סטרוק · פינדרוס יצחק זאב=יצחק פינדרוס · מלקו צגה
  צגנש=צגה מלקו · סגלוביץ=סגלוביץ' · כהן אלי אליהו=אלי כהן (30083, not the
  1980s one, 755). All 151 resolve, one PersonID each.
- **`fallbackPersonIds(name)`** = KNS_Person by FirstName/LastName, both word
  orders, for anyone the snapshot misses (fixture: "רגב מירי", cmb-only, found
  by the REVERSED order). Runs BEFORE ranking in the directory and, in
  `openPerson`, before BOTH loads — positions used to be asked with an empty
  id list while bills got the fallback.
- The same member's own line in a vote breakdown is matched the same way
  (annotateOne).

## 5. Positions — the register, tidied and weighed

- **`tidyPositions()`** (the profile timeline and per-person cache): collapse
  rows that render identically (same office, same span), then stitch
  same-office spans that touch (≤1 day) or overlap. Deliberately does NOT
  stitch across Knessets — the timeline shows the register's rows. Real gaps
  are kept. Bulk rows for the directory are NOT tidied.
- **`roleRank()`** (the exact wording is the register's): ראש הממשלה 100 ·
  ראש הממשלה החלופי 92 · ממלא מקום/סגן ראש הממשלה 90 · יושב-ראש הכנסת 85 ·
  שר… 80 · ראש האופוזיציה 75 · סגן/סגנית שר 60 · ממלא מקום/מ"מ שר 58 ·
  יו"ר ועדה 50 · יו"ר סיעה 40 · סגן יו"ר הכנסת 35 · חבר ועדה 10 · else 5.
  Exact match for PM, so ראש הממשלה החלופי never counts as PM.
- **`plainRole`** = a faction-membership row or the bare "חבר/ת הכנסת" row —
  not a role of substance. **`currentRole(rows)`** = the heaviest open-ended
  role of substance, or "" — one answer to "what are they today", shared by
  the cards and the hero. **`posCtx(r)`** adds the committee / faction name
  to generic roles ("חבר ועדה · ועדת הפנים").
- **`positionsForMany(pids)`**: OR-filter of 6 PersonIDs per query, 3 chunks
  in flight, cached per PersonID (asked = answered, even when empty); a
  screenful of cards (~24 people) is 4 queries, ~1 s. `bulkPositions(filter)`
  = `$count`, then all pages 4 in flight, roles resolved.
- Timeline order (`ongoingFirst`): every open-ended row on top, heaviest
  first, then the past newest-first. `POS_PREVIEW = 4`, "show all" for the
  rest.

## 6. The directory grid (the page's home screen)

151 members of K25 (leavers included), "like a profile on social media":
portrait (96px, 76 on phones) · name · role (blue) · party · years · laws
passed · a "why" line when a search matched by role/party. One continuous
alphabetical-within-rank grid, no party grouping, no dividers.

**Where each line comes from, cheapest first:** party = cmb `Factions` +
`faction_id` (free; `factionShort()` trims the trailing space, drops "בראשות
<leader>", shows ש"ס); years = first cmb Knesset's start (free), refined to
the register's earliest StartDate once positions land (cmb only reaches K16 —
Edelstein reads 1996 after refinement); role = `cardRole()`; laws =
`countBills()` — one `$count` per member (§3), its passed StatusIDs computed
from the statuses list with `billBucket()` so the card agrees with the
profile's עברו pile. The party line carries the סיעה tooltip. Bidi checked: "2022–2026"
reads right in both languages, no dir= hacks.

**The importance order** (`dirRank` / `dirOrder`, Mercy 2026-09-06):
(1) serving in the Knesset now · (2) tier: PM 10 → alternate/deputy PM 9 →
Speaker 8 → opposition leader 7 → minister 6 → deputy minister 5 → committee
chair 4 → former minister 3 (most recent ministry first, `lastMin`) → everyone
else 0 · (3) leavers by the year they left · (4) name (cmb form).
**serving** = GetMksDropdown IsCurrent OR an open-ended "חבר הכנסת" row in
this Knesset. Tier rows = the open-ended rows of this Knesset; a minister row
= GovMinistryName present and not סגן/ממלא מקום (the PM's rows count — office
is checked before ministry). **Measured 2026-09-06: 9 sitting ministers
(Smotrich, Sa'ar, Regev, Kisch, Silman, Zohar, Amsalem, H. Katz, E. Cohen)
sort after all 120 serving members, per rule 1.** Flagged to Mercy; "serving
in government counts as serving" is one line in dirRank().
Inputs, both bulk at load (~17 requests, sorted in ~2–3 s — "loading" then
sorted, nothing jumps): every register row of the current Knesset (`e.k25`)
+ every ministry row since K16 (`e.minRows`).

**Card role** (`cardRole`): `currentRole()` of the full history, else of this
Knesset's bulk rows (so the line is there at first paint); **a sitting member
with no role of substance today reads "חבר/ת הכנסת"** — the current role
always outranks a historical one (Alon Schuster read "סגן שר במשרד הביטחון ·
2022" next to "2019–היום"; the past role lives in the timeline); a leaver
shows the last role of substance with its years. **Card years** (`cardYears`):
"2013–היום" only for someone the votes directory lists in the current Knesset
(`e.serving`); else ends at the last FinishDate, else `lastK`.

**Cost control:** role and laws are asked ONLY for cards that scroll into view
(IntersectionObserver, 300px ahead; `dirWant()` pools asks for 120 ms →
positions batched, counts 4 in flight). First paint asks for 36 of 151. Indices into `state._dir` are
append-only, so `refreshDirCard` and the laws queue work for appended cards.

**Infinite scroll** (`loadNextKnesset`, a `#dirmore` sentinel observed 600px
ahead): one bulk query per earlier Knesset (`KnessetNum eq k`, ~550 rows),
24 → 16; members already on the page are skipped (by name key). The tail
after the current Knesset is re-sorted IN PLACE on every append (`tailOrder`:
lastK ↓ → tier ↓ → lastMin ↓ → name; in a past block the tier comes from
roles held at any point DURING that Knesset and nobody is "serving"; lastK
falls back to the Knesset's end year when the register has no rows). In
place on purpose: the array's identity is what `buildDirectory()` resolved
to. Past K16 the sentinel says the archive ends. The sentinel hides while
searching.

**Cards added by a search** (`makeEntry`): someone the grid doesn't hold is
fetched by name and slotted in by their last votes-directory Knesset (at the
end if none); they stay after the search clears (`buildBlock` skips keys
already shown).

## 7. Search — words, not substrings

Typing filters the cards in place (250 ms debounce, seq-guarded); no results
list. Name, party or role; an empty result says "לא נמצא…" in place; clearing
brings everything back; Enter / the button opens a lone remaining card;
`openByName` with several namesakes filters the grid to them.

- **`entryHit(e, words)`**: every query word must be a WHOLE word of ONE text
  — the name, one role (`posCtx`), or one faction name — allowing a Hebrew
  clitic prefix on the text's word (`HEB_PREFIXES`: ה ו ב ל מ ש כ and stacks);
  only the LAST query word (the one being typed) may also be a prefix.
  Dashes split words and quotes are dropped (`tokensOf`: - – — ־ · , ( ) /
  and ״ " ׳ ') — the register's "יושב–ראש" meets a typed "יושב-ראש" (Ohana,
  the sitting Speaker, was missed until this). Substrings were wrong: Ohana
  matched "ראש ממשלה" through "הליכוד בהנהגת בנימין נתניהו לראשות הממשלה"
  ("ראש" inside "לראשות").
- **Order of reasons** (the "why" on the card): a role of substance (latest
  first, with years) → the card's own party (reason hidden) → an official
  faction name from a row (shown, with years) → a plain row ("חבר הכנסת" for
  "חבר כנסת"). A name match shows no reason. The reason is hidden when the
  card already says it (its own role or party).
- **What it reaches** without a new request: the current Knesset's members
  with ALL their rows, every ministry row since K16 for everyone the directory
  knows ("שר החוץ" finds every foreign minister since 2003, with years), and
  whoever the scroll has appended. NOT reached: committee roles in earlier
  Knessets for people not yet scrolled to; a PM from 2006 turns up once the
  scroll reaches his Knesset or by name (`findCandidates` fetches by name from
  both directories, cap 30 — a faction can be that many).
- Anything that matches stays (the deputy PM for "ראש הממשלה" included) and
  the card says why. An "exact role first" mode (v26.09y) was too narrow and
  looked hard-coded — reverted.

## 8. The portfolio (one person)

**Opening**: `openPerson(entry)` takes the directory's own entry ({name, key,
cmb, personIds}); resets state, PUSHES `?name=` unless the address already
names them (a link arrival, a popstate); a `popstate` listener shows whoever
the address names (nobody → the grid); the page's "→ חזרה לרשימה" calls
`history.back()` when there is an entry to undo (Forward re-opens the person),
else shows the grid. `openByName()` is the one door for `?name=` arrivals
(the votes page and the old `mk.html` forwarder link that way) and popstate.
While a portfolio is open the search card (page title included) and the
site tagline are hidden.
A newer selection cancels older loads (`state.seq`).

**The hero** (Mercy: "guide the eyes, pique curiosity, don't throw data"):
portrait 128px (104 on phones) · "<name> · <current role>" — one size, weight
and color tell them apart; the role only for someone in the current Knesset
per the votes directory (`inLatestKnesset`) · one story line: faction (the
taught term — the register's string, tooltip `factionTip`, two short
sentences, no underline) · `tenureLine`: "בכנסת מאז 1988 (38 שנה)" from the
register's earliest row, else the first cmb Knesset's start; "בכנסת 2013–2024"
for someone who left · the bills sentence "31 הצעות חוק — 6 הפכו לחוק" with
the four counts (zero pending/stale hidden), each count carrying its pile's
tooltip · the background as a small two-column table (`.biot`, 13px, label ·
value, only filled fields, bullets folded into comma runs, ", ישראל" dropped
from the birthplace). Tried and removed: PM spans in the story line, a
stacked bar, prose with gendered verbs (label-based facts need no gender).
Section titles are the reader's questions: מה עשו לאורך השנים? · מה ניסו
להעביר? · איך הצביעו?

**Positions**: §5. Each row: dates (a "מכהנ/ת" chip when open-ended and
IsCurrent) · role · ministry/committee/faction · Knesset number.

**Bills** (`loadBills`): KNS_BillInitiator paged per PersonID → KNS_Bill in
batches of 10 ids, 4 in flight → `billBucket(statusText)`: passed = התקבלה |
פורסמ…רשומות · rejected = נדח | הסרה | הוסר | נעצר | בוטל | מבוטל | נסגר ·
else undecided (מוזגה lands here, text shown), split by Knesset: THIS
Knesset = **בתהליך** (`pending`, blue dot), an earlier one = **לא הוכרעו**
(`stale`, gray — it died with its Knesset; "עדיין לא התקבלו" implied an active
attempt on 10-year-old bills). Every row's dot carries its pile name.
The section shows ONE pile at a time: four radio check-circles (`.fchip`,
role="radio", aria-checked) with counts and tooltips; `state.billPile` = עברו
by default, else the first non-empty pile; a name search (`.billq`, substring)
inside the pile; newest Knesset first, then last update; 20 rows then "עוד
{n}". Controls are built ONCE per person (`#bills` remembers `state.seq`) and
only `#billslist` re-renders — typing must not lose the caret. Lead sponsor
tag on Ordinal 1 / IsInitiator. A row opens to its **official documents**
(`billDocs`, grouped by stage, one link per format, cached per BillID, asked
only when opened; links open in a new tab, `rel="noopener"`, straight at the
Knesset — no relay in between).

**Votes**: SearchType 2 per Knesset (chips, newest default, cached in
`votesByK`); reservation marathons folded — same bill, same day → one row,
the first (latest) vote decisive, same rule as the votes page; the count line
"{n} הצבעות במליאה בכנסת ה-{k}"; a subject search (`state.voteQ`, substring on
the group title) inside the chosen Knesset — count line, chips and box built
once per person (`#mkknessets` remembers `state.seq`), paging restarts on
every keystroke; 25 per page. `GetVoteDetails` per visible row gives ✔/✘,
counters and the member's own line (`annotateOne`, 6 in flight, `_busy` so a
re-render mid-flight never asks twice; on failure `_passed = null`, never
undefined). An opened vote shows Knesset · sitting · tallies · decision text ·
the bill's documents via FK_ItemID (non-bill items show nothing extra).
Pre-K16 members: honest empty state.

## 9. Testing

`node site/mk_page/test_mk.mjs` (needs `npm i playwright`; serves `site/`
on :8933, mocks the relay). **113 asserts** on a fake Knesset carrying every
trap above — the fixtures are commented in the file: two id spaces, duplicate
cmb rows, the twin position codes and the split PM term, a real gap, רגב
מירי (cmb-only, reversed order), גנץ בני (nickname), בניה גנצר (prefix
lookalike), the second משה כהן (namesake, 99 laws not to be counted), דני
עזב (leaver, former minister), משה לוי (K20 only), דוד ישן (persons table
only), the "…לראשות הממשלה" faction row, the en-dash Speaker row, a `$count`
route that REFUSES an unfiltered count, document paths with the dirt, CMS
entities, the photo manifest (waited for), the build race, Back/Forward, the
caret. Links guard: 21/21.

To RUN it from a chat with only this folder, write stand-ins for
`../shared/config.js` and `../shared/` from the contract in §1 (in the chat's
scratch space, never here). A green run with stand-ins proves the page's own
logic, not the integration — Mercy opens the page against the real relay for
that.

## 10. Not built — the v2 list

- **`/data/mkcards`** — a per-member relay snapshot (role, laws passed, a
  Knesset-average yardstick for "6 of 31 became law") would make the whole
  card free and give the hero its yardstick. Pipeline work, not this folder.
- **Coalition/opposition** — no official dataset (§3). Routes: a DevTools
  capture of the current list, or a curated per-Knesset faction→coalition
  file. Ministers imply coalition but partial inference would mislead.
- **Cache-busting `?v=`** on the script tags — a shared convention.
- Tooltips are hover-only; on phones the term is focusable but the text
  doesn't show — tap-to-reveal if Mercy wants it.
- Attendance, ministry-budget-under-term, שאילתות (deferred since v1);
  pre-2003 voting from the frozen archive's per-member table.
- GetMkDetailsContent bio (birth, education, profession) is shown; the gender
  field (KNS_Person GenderID) is a GET away should prose return.
- מפלגה instead of סיעה: a one-word change in mk.strings.js — the data says
  סיעה (§3).

## 11. Version history (one line each; details are in the sections above)

- **v1 (2026-08-25)** bills + positions + votes, full history, new nav tab;
  search v2 (live, ranked); the photo route via GetMkdetailsHeader.
- **26.09a** photos from the relay manifest; directories cached as promises;
  PersonID fallback before both loads; one GetVoteDetails per group.
- **26.09b** the directory as profile cards (party · years · role · bills).
- **26.09c** the importance order; bulk register at load; names bridged
  properly (all 151).
- **26.09d/e** laws passed instead of bills count; zero → no line.
- **26.09f/g** Back works (pushState + popstate); current roles first in the
  timeline; header a column; the search card found via `#mkq` (cache lesson).
- **26.09h/i** role by the name; CMS entities decoded; סיעה taught by tooltip;
  hint lines gone; positions preview 4.
- **26.09j–n** the hero: one breath; PM spans dropped; facts as pills, then a
  small table; stacked bar dropped; undecided split into בתהליך / לא הוכרעו.
- **26.09o/p/q** bills as one list with check-circles → one pile at a time
  (radio); a name search; a subject search in votes.
- **26.09r** official documents behind bills and votes.
- **26.09t/u/v** earlier Knessets by infinite scroll; the buildDirectory race
  fixed (promise); tail by last year in office; no dividers; the current
  role always outranks a historical one.
- **26.09w/x** search by role or party; the search filters the grid in place.
- **26.09y/z** exact-role-first tried and reverted; words not substrings.
- **26.09aa (2026-09-07)** housekeeping, no behaviour change: mk.data.js and
  mk.view.js reordered into numbered sections; dead code removed (the old
  results-list ranking `rankCandidates/enrichCheap/enrichPositions/
  positionLine/pmSpans`, `renderBio`, `#pick`, `#bioCard`, 20 unused
  strings, the old `.mkcard/.bucket/.biorow/.dirk/.term` CSS); mk.css
  ordered like the page; NOTES.md rewritten by topic. 113 asserts green.
