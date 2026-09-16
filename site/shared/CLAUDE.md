# CLAUDE.md — front-end core (site\shared\)

Connected with every page folder. Holds what ALL pages share; a page's own
rulings live in its `NOTES.md`. Upstream APIs used by several pages:
`SOURCES.md` here (read only when touching an upstream call).

## Rules
- A page folder is the whole page: `<name>_page\` + `shared\` is the complete
  set, tests included. From a page chat, `shared\` is READ-ONLY — if a page
  needs something new from common.js/style.css, say so; never copy shared
  code into a page folder.
- Page styling in the page's own `.css`; shared components in `style.css`.
- Nothing from upstream is ever markup: decode entities to text, then `esc()`.
- Never parse a date as text: every sort/group goes through `dateOf()`
  (sources mix `2023-03-15`, `15/03/2023`, `/Date(ms)/`).
- Background work is bounded, counted and always settles; a cap is applied
  AFTER filters; never render a row that hasn't passed the active filters.
- Scripts load without `?v=` → new JS can meet cached old HTML: guard DOM
  lookups, keep strings old HTML may reference. `?v=` on script tags is an
  open shared convention (Mercy decides).
- A decoration must never break the data it decorates (guard it).

## Product & design (Mercy)
- People over process; hide proceduralia, surface meaning. Laws pages give
  understanding, never legal advice — say so on the page.
- No opinions on the page: choose which facts stand together, phrase
  headers as the reader's questions, let the reader judge. Colour is
  opinion: status green/red only for for/against/passed, always labelled.
- Minimal at first sight, depth one click away: rows expand DOWN, search
  filters the same list in place, one search button, honest empty/error
  states, freshness visible. Explanations in popovers anchored to a
  question button (not hover-only — phones).
- No number hard-coded in prose: fill sentences from loaded data.
- Tokens: dataviz skill palette (light+dark, series blue #2a78d6/#3987e5).
- Titles, three layers that never repeat each other: site `הכסף שלנו` ·
  page tagline (`PAGE_STR.tagline`; not a block title promoted, doesn't list
  sections) · block h2. Hebrew: `לאן` is standard (not `לאיפה`); keep
  `מאיפה` (alternatives read archaic; `מהיכן` if ever needed).

## Layout
```
site\  index/votes/mk/court.html = forwarders to *_page\ (keep old links)
├─ shared\       style.css · common.js · config.js (window.PROXY_URL)
├─ budget_page\  index.html (budget) + contractors.html; budget.* contractors.*; test_budget/test_contractors.mjs
├─ votes_page\   votes.{css,strings,data,search,bills,view}.js; selftest.html/.js
├─ mk_page\      mk.{css,strings,data,view}.js; test_mk.mjs
├─ court_page\   index.html (still one file — split when it outgrows it)
├─ tools\        qa.html (relay/dataset health) · build.html (vote-index harvest)
└─ tests\        test_links.mjs (layout guard)
```
- Split pages: `index.html` shell · `<p>.css` · `<p>.strings.js`
  (window.PAGE + PAGE_STR, every word, he/en same key order) · `<p>.data.js`
  (fetch, `state`, nothing drawn) · `<p>.view.js` (DOM; init block at the
  bottom). Plain scripts, one global scope. Load order: `../shared/config.js`
  → strings → `../shared/common.js` → data → view.
- Every page/tool sits one level below `site\`: `../shared/…`, own files by
  bare name; links `../<name>_page/` (`?name=` survives forwarders).
  `buildChrome()` defaults `BASE` to `"../"` (a deeper page sets `window.BASE`).
- Adding a page: new `<name>_page\` from a shell, PAGE/PAGE_STR/onLangChange,
  a NOTES.md, a tab in `buildChrome()`, the page in `tests/test_links.mjs`.
- Never test from `file://`: `scripts\serve.bat` (node → python → py →
  PowerShell; `:8080`, no-store, logs 404s) → `http://localhost:8080/budget_page/`.

## common.js (plain globals)
Page sets `window.PAGE` (nav tab id), `window.PAGE_STR = {he:{…}, en:{…}}`,
`window.onLangChange`. Gives: `t(key)` (page string → common string → key) ·
`lang` "he"|"en", `applyLang()`, `toggleLang()` · `buildChrome()` on load
fills `<header class="topbar">` (brand, tabs, `#langbtn`) + tagline if
defined · `esc(s)` · `isoDaysAgo(n)` · `dateOf(v)` / `fmtDate(v,"long"?)` ·
`PROXY` (no trailing slash) · `viaRelay(url, body?)` (GET/POST via relay,
204→null) · `preset(name, params)` · `dataset(name)` (KV snapshot, unwraps
`{t,data}`, footer freshness) · `fetchJson(url)` · `friendly(err)` ·
`debug(msg)` (→ `#debug`). Common strings: title, navBudget, navVotes, navMk,
navCourt, loading, searchBtn, empty, credit, err, updatedAt, errCors, errProxy.
Change this surface → update this block.

## Relay routes the pages call (owner: `worker\CLAUDE.md`)
`/b64/<b64url>` · `/postb64/<b64>` · `/preset/{verdicts|votes|reports}` ·
`/data/{budget|votes|bills|verdicts|persons|votesmeta|billinfo/<id>}`
(`{t, stale?, data}`; 501 → page falls back to live) · `/data/mkphotos` +
`/photos/mk/<file>` · `/search/votes` · `/contracts` `/contract` `/supplier`
(D1) · `/contractors/*` (D1, not yet used) · `/qa/report`. A new upstream
host = worker allowlist change + Mercy redeploys.

## Tests
Claude runs them in the cloud: `node site/tests/test_links.mjs` after any
layout change (404s, dead nav links, forwarders); page Playwright tests
serve `site\` against mocked upstreams. A live page breaks → ask Mercy for
the footer ⚠ debug line. From a page+shared chat that's
enough; otherwise write stand-ins in scratch, never in the folder. Mocks
prove logic; Mercy's live page proves integration (`tools\qa.html`).

## Open (cross-page)
- Laws registry by topic: KNS_IsraelLaw + classifications + validity +
  IsBasicLaw + ministry, via KNS_LawBinding to bills/votes/PDF; דברי הסבר
  per law; בג"ץ struck-down laws (curated, ~20 full + partial) as a badge.
- Events timeline (elections, governments, wars, COVID, budget laws) reused
  by budget history + portfolios; ministers timeline (KNS_PersonToPosition).
- Ideas: rebellion detector (votes vs faction majority) · "השבוע במדינה"
  digest · per-topic/MK RSS/JSON feeds · alerts · year-over-year compare ·
  share cards · unify the search bars (Mercy explores).
- Elections page someday: data.gov.il `votes-knesset` = results per polling station.
