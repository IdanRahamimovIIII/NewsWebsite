# NOTES.md — the Supreme Court page (site\court_page\)

Everything settled about THIS page. Shared front-end rules are in
`site\CLAUDE.md`; the court API facts (supremedecisions.court.gov.il, the
`verdicts` preset, record fields, document URL) in `site\SOURCES.md`. Same
keep-it-current rule as CLAUDE.md.

Files: `index.html` only — shell, page CSS (`<style>` block), strings
(`window.PAGE = "court"`, `PAGE_STR`) and the script are all inline, in that
order around `../config.js` and `../shared/common.js`. It is the one page
not yet split into `.css/.strings.js/.data.js/.view.js`; do that the day it
outgrows one file (the votes page's split is the pattern), not before.
Data: `preset("verdicts", {…})` through the relay (`/preset/verdicts`), or
the `/data/verdicts` snapshot; documents link to the court's own download
URL — never re-hosted. No Playwright test yet; `tools\qa.html` checks the
verdicts snapshot live.

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
