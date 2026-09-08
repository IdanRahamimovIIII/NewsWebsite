# CLAUDE.md — THE WEBSITE (site\)

Notes from Claude to Claude (and Mercy) for chats about the pages. This is
the FRONT-END zone of NewsWebsite; the data pipeline (`pipeline\`) and the
relay (`worker\`) have their own CLAUDE.md. For work on ONE page, connect
that page's `<name>_page\` folder plus `shared\` — together they are
everything the page needs, its Playwright test included (see "HOW THIS
FOLDER IS ORGANISED"). Connect all of `site\` only for cross-page work:
the shared header/nav, the design tokens, the layout.

## THE RULE THAT GOVERNS THIS FILE

Keep it honest and CURRENT. Whenever work in a chat proves a conclusion here
wrong, outdated, or incomplete — update or delete it in the same chat, and
date the change. A wrong "conclusion" is worse than none. This is distilled
knowledge, not a log: once a story is settled, keep the conclusion and the
lesson, drop the play-by-play. (Cleaned on this rule 2026-08-25; split into
per-zone files 2026-09-05, both at Mercy's request; full history in git.)

**Standing rules (Mercy's, non-negotiable):**

- **Nothing is frozen — "everything can be changed if needed" (Mercy,
  2026-09-05), superseding the old FROZEN rule.** What replaces it: a file the
  running workflows use changes TOGETHER with the workflow (same chat, same
  commit: edit `workflows\*.yml`, run `setup\install-workflows.bat`), and the change counts as done only
  after a green run. The old rule's origin still stands as a lesson —
  Origin-B drafts once touched pipeline files without the workflow following,
  and all were reverted.
- **Collect raw, keep sources separate.** The merge is a separate,
  re-runnable computation; raw is kept forever, so schema choices are
  reversible. No BudgetKey row ever stands in for a ministry file during
  COLLECTION — accepted last resort at MERGE time only, labelled, for
  reports gone from the whole internet.
- **The workflows' SOURCE is `pipeline\workflows\*.yml`** (since 2026-09-06 —
  Mercy: a pipeline chat must see what is in `.github`). `.github\workflows\`
  at the repo root is GitHub's required location and a generated COPY: the
  device bridge cannot write there, so `pipeline\setup\install-workflows.bat`
  copies changed files across (stripping a stray BOM). Edit the source → run
  the installer → commit BOTH → push → green run = done.
- refresh-data.yml's final `git push` fails if main moves during a run —
  push nothing while it runs. Workflows that commit nothing (all the
  collectors) can run anytime.

**How Mercy works (earned over many sessions):**

- She spots real problems fast and is usually right about the cause. When
  she says something is fundamentally wrong, stop patching and re-examine
  the model. Her questions found the ss:Index bug, the 3×-sum duplicate
  trap, and the full-reload waste; she rejected the static-shard workaround
  with "what is the correct way to do it?" — answer THAT question first,
  don't optimize for zero-cost cleverness.
- Never show a partial answer as if complete; a partial list is worse than
  a count, because the name someone is looking for is exactly the one cut.
- Verify against live data before claiming a fix (selftest.html for the
  site). WebFetch caches ~15 min — cache-bust with `?fresh=N`.
- Read-only probes only. An endpoint that MUTATES her data is never a probe.
- She runs .bat files happily, edits in Notepad, has NO node on PATH — keep
  setups zero-install and explain plainly. She is the product mind: present
  options, let her drive.
- Claude commits files via SendUserFile + device_commit_files. Her Chrome
  extension is NOT connected; she pastes logs and screenshots quickly.
  TODO.md tracks the roadmap. Claude CAN reach her public workers.dev relay
  for live schema probes (`/b64/<base64url>`; WebFetch URL ceiling ~248
  chars — keep probe SQL tiny).


(The block above is the canonical text from the root CLAUDE.md, repeated here
because a zone session never sees the root — if it changes, change it in all
four files: root, site\, pipeline\, worker\.)

## HOW THIS FOLDER IS ORGANISED (reorganised 2026-09-06, Mercy's two rules)

**Rule 1 — one folder per page, and the folder is the whole page.** Every
page is `<name>_page\index.html` plus its own css/strings/data/view files,
its NOTES.md and its Playwright test. To update a page, a chat gets THAT
folder plus `shared\` and nothing else (shared\ carries config.js since
2026-09-08, so the pair is also enough to RUN the page's test). The
`_page` suffix marks a folder as a page.
**Rule 2 — the site holds no data.** Everything a page shows comes from a
public API or from Cloudflare through the relay. No JSON, no photos, no
pipeline output under `site\`. (The 2026-09-06 move is complete: the
pipeline holds the data, the relay serves it; `_move-to-pipeline\` is an
empty leftover Mercy chose to keep, and `HANDOFF-cloudflare-data.md` was
deleted 2026-09-08 with its checklist done.)

```
site\
├─ CLAUDE.md          this file: shared front-end knowledge + the interfaces
├─ SOURCES.md         the upstream APIs (Knesset, BudgetKey, court, gov.il…)
├─ index.html  votes.html  mk.html  court.html   FORWARDERS to the *_page folders
│                     (keep old links alive; nothing to edit in them)
├─ shared\            style.css, common.js, config.js (window.PROXY_URL, the relay
│                     address) — used by every page. Connect it BESIDE a page folder:
│                     "<name>_page + shared" is the complete set for any page chat,
│                     running its Playwright test included (since 2026-09-08;
│                     config.js moved in from the site root that day)
├─ budget_page\       index.html + budget.css/.strings.js/.data.js/.view.js + NOTES.md + test_budget.mjs
├─ votes_page\        index.html + votes.css/.strings.js/.data.js/.search.js/.bills.js/.view.js
│                     + NOTES.md + selftest.html/.js (the page's live self-test)
├─ mk_page\           index.html + mk.css/.strings.js/.data.js/.view.js + NOTES.md + test_mk.mjs
├─ court_page\        index.html (still one file: css/strings/script inline) + NOTES.md
├─ tools\             qa.html (relay/dataset health), build.html (vote-index harvest driver)
├─ tests\             test_links.mjs — the layout guard (cross-page)
└─ _move-to-pipeline\ EMPTY — the 2026-09-06 parking lot, already moved into
                      pipeline\; Mercy keeps the empty folder
```

Page URLs are `…/budget_page/`, `…/votes_page/`, `…/mk_page/`,
`…/court_page/`; the site root (`index.html`) forwards to the budget page.
Cross-page links are `../<name>_page/` (`?name=` survives the forwarders).

**Read the page's NOTES.md before touching that page.** This file holds what
is shared; each page's decisions, bugs and Mercy's rulings live next to its
code. Each NOTES.md opens with the same block, "THIS FOLDER IS THE WHOLE
PAGE": what the page gets from `../shared/common.js` and `../shared/config.js`, so a
one-folder chat knows the interface without seeing the files. **If
common.js's public surface changes (a helper added, renamed, removed), update
that block in all four NOTES.md files in the same chat** — the same
repeat-it-everywhere rule as the canonical block above.

The audit page (`compare.html`) lives in `pipeline\audit\` (since
2026-09-06), served by `audit.bat`, which mounts this folder at `/site/`
for the shared CSS/JS (`/site/shared/…`). `paidcheck.html` was deleted with
the paid overlay (2026-09-08).

Tests: `node site/tests/test_links.mjs` after ANY layout change (loads every
page and tool, fails on a 404 or a dead nav link, and checks each forwarder
points at a page that exists); `budget_page/test_budget.mjs` /
`mk_page/test_mk.mjs` are the Playwright page tests against mocked upstreams
(they sit in their page's folder; they serve `site\` — found from their own
path — so they need only `../shared/` present to run).
Mercy has no node — Claude runs them in the cloud workspace
(`/opt/pw-browsers/chromium`).

## WHAT THE PAGES DEPEND ON OUTSIDE THIS FOLDER (the interface — keep the other side in sync)

- **The relay (`worker\worker.js`, deployed by Mercy on Cloudflare).**
  Address in `shared/config.js` (`window.PROXY_URL`). Routes the pages use:
  `/b64/<base64url-of-upstream-url>` GET passthrough · `/postb64/<b64>` POST
  with body · `/preset/<name>?params` (verdicts · votes · reports) ·
  `/data/{budget|votes|bills|verdicts|persons|billinfo/<id>}` KV snapshots,
  envelope `{t, stale?, data}` (501 if KV unbound → pages fall back to live)
  · `/data/votesmeta` · `/search/votes?qs=a|b&from=&to=&y0=&y1=&limit=`
  (TSV lines) · `/build/votes` (build.html only) · `/qa/report` (selftest
  POSTs, Claude GETs) · **`/contracts?code=…[&year=…][&n=…]` +
  `/contract?id=…` + `/supplier?hp=…` (worker v8, 2026-09-08) — the
  pipeline's merged contracts database on Cloudflare D1; the budget page
  reads `/contracts` for the who-was-paid table (its `/data/paid/*` overlay
  reads are gone — `budget_page\NOTES.md`, "THE CONTRACTS NOW COME FROM
  D1")**. Allowlist of upstream hosts lives in the worker —
  a new data host means a worker change AND a re-deploy by Mercy.
- **The pipeline's data, served by the relay (since 2026-09-06 — nothing is
  read from `site\` any more).** The contracts database (the `/contracts`
  family above, since 2026-09-08) and `/data/mkphotos` + `/photos/mk/<file>`
  (the MK portraits; until the worker serves them the MK page shows
  initials — by design, not a bug). The old `/data/paid/*` overlay keys are
  no longer read by any page and are queued for deletion
  (`pipeline\CLAUDE.md`, section "TEMPORARY").
- **Upstream APIs** — see `SOURCES.md` in this folder.

## The vision (updated 2026-08-21, after extensive work with Mercy)

Mercy is building a bilingual (Hebrew RTL + English) transparency website
that makes the Israeli state LEGIBLE to ordinary citizens — money, laws,
votes, courts, people — with the connections between them as the real
product. Not a data dump: an explanation machine.

Core beliefs (hers, learned through iteration — respect them):
- **People over process.** "What an MK brought to the table" (bills proposed,
  even rejected) matters more than their votes. Accountability = outcomes
  (what changed under a minister, what a שאילתה answer SAID), not process
  metrics (how late the answer was).
- **The public shouldn't need to care about procedural chaos.** Bill
  name-histories, splits, legal spaghetti — that's lawyers' and politicians'
  jobs. Hide proceduralia; surface meaning.
- **Understanding, not instruction.** The laws pages exist so citizens grasp
  the overall state of an industry/topic — what's allowed, how it came to be,
  by whom — NEVER personal legal advice. Say so explicitly on the page.
- **The state's own documents are the source of truth** — link to official
  PDFs (fs.knesset.gov.il, court downloads), never re-host. We organize and
  explain; the state authenticates.
- **Explanation is the unique value.** Glossaries, "how a law is born",
  דברי הסבר surfaced, curated datasets (בג"ץ strikes) — editorial layers no
  official source offers.
- Minimal at first sight, depth one click away; one interaction language
  (rows expand down, search filters, every control always meaningful, honest
  empty/error states, freshness visible).

Big rocks (feature roadmap, Mercy-prioritized 2026-08-21):
1. **MK portfolio pages** — per politician: bills proposed (passed AND
   rejected — the rejected ones tell the story), their votes, positions held
   (KNS_PersonToPosition), and for ministers: what their ministry's budget
   did under them (connect to BudgetKey by ministry + term dates).
   Data confirmed: KNS_BillInitiator (+Ordinal: first = lead sponsor).
2. **Laws registry by topic** — KNS_IsraelLaw + classifications (topics like
   מקרקעין/תשתיות) + validity (תקף/בוטל) + IsBasicLaw + responsible ministry;
   linked via KNS_LawBinding to the bills/votes that made each law, and to
   the official PDF. "The state of the law in an industry, and how it got
   that way."
3. **The "why" layer** — surface דברי הסבר (explanatory notes, in the bill
   PDFs / documents table) so every law can answer "מה הייתה הנמקה".
4. **שאילתות as content** — the questions MKs ask ministers and the answers
   (the substance, not the latency).

Mercy has some tech experience: can follow clear steps, edits files in
Notepad; keep setups simple, explain plainly. She is the product mind —
present options, let her drive; she iterates fast on live pages.

## Architecture & files (2026-08-21, refactored)

Shared code layout (no build step; load order per page: config.js →
inline PAGE/PAGE_STR script → common.js → page script):
- `style.css` — design tokens (light+dark) + all shared components.
  Page-specific CSS stays in a small <style> block in each page.
- `common.js` — COMMON_STR + t()/applyLang()/toggleLang() (pages set
  window.PAGE, window.PAGE_STR, window.onLangChange for re-renders);
  buildChrome() injects header+nav into empty <header class="site"> and
  <nav class="tabs"> shells (PAGE picks the active tab); esc, isoDaysAgo,
  dateOf/fmtDate (handles ISO, /Date(ms)/, DD/MM/YYYY), PROXY,
  viaRelay(url, body?) (POST if body; 204→null), preset(name, params),
  fetchJson (direct, for CORS-open APIs), friendly(e), debug(msg).
- Adding a page: make `<name>_page\` with `index.html` (copy a shell; paths
  are all `../shared/…`), set PAGE/PAGE_STR/onLangChange, write
  its NOTES.md (start from another page's opening block), add a tab entry in
  common.js buildChrome() (`"<name>_page/"`) and the page to
  `tests/test_links.mjs` PAGES.
- **The votes page is SPLIT (2026-08-22, Mercy's call — the single file had reached
  1,600 lines and was hard for both of us to edit):**
  `index.html` layout shell only · `votes.css` page styling ·
  `votes.strings.js` (window.PAGE + PAGE_STR — all wording) ·
  `votes.data.js` (APIs, archive, index client, and `state`) ·
  `votes.search.js` (matching, plain + advanced search, paging, filter passes) ·
  `votes.view.js` (all HTML rendering, small interactions, and the init block
  at the bottom) · `votes.bills.js` (the whole second tab).
  Load order in the shell: config → strings → common → data → search → bills →
  view. They're plain scripts sharing one global scope, so cross-file calls just
  work; only the init block at the end of votes.view.js runs on load.
  NOTE: the page-size constant was renamed PAGE → ROWS_PER_PAGE, because
  `window.PAGE` (the nav tab id) was being shadowed by it.
  The budget and MK pages follow the same split; court_page is still one file.
- `qa.html` — self-test page (PAGE="qa", not in the nav): runs live checks
  against every data source from Mercy's browser and prints a green/red report.
  It's the fastest way to ask "is the relay/dataset healthy?" — tell her to
  open it and screenshot rather than guessing.
- ~~`site/` is a DUPLICATE of the top-level files~~ **OBSOLETE 2026-08-22.**
  The duplicate is gone; `site/` IS the website and the only copy. See
  the tree at the top of this file. Do not mirror anything anywhere.

## Older architecture notes (2026-08-20)

- `budget_page\` — budget/spending page (phase 1, WORKS live)
- `votes_page\` — Knesset votes & bills (phase 2, partially works — see below)
- `shared/config.js` — holds `window.PROXY_URL` (Mercy's Cloudflare Worker relay)
- `worker.js` — relay source; deployed by Mercy on Cloudflare (free plan).
  Allowlist inside it: knesset.gov.il, www.knesset.gov.il, next.obudget.org.
  If a new data host is needed, update the allowlist AND Mercy must re-paste
  the code in the Cloudflare dashboard editor and Deploy.
- Design system: dataviz skill tokens (light+dark, series blue #2a78d6/#3987e5);
  status green/red only for for/against/passed semantics, always with labels.
- Testing pattern: Playwright + mocked API routes (test_site.mjs,
  test_votes.mjs in the cloud workspace, executablePath /opt/pw-browsers/chromium).
  Claude's sandbox CANNOT reach gov APIs directly (egress blocked/robots) —
  layout is tested with mocks; live-data testing is done by Mercy in her browser.

- **The old "edit the top level, mirror into site/" rule is DEAD.** There is one
  copy now. Any earlier note telling you to mirror files is obsolete.
## PATH RULES AND THE LAYOUT GUARD (2026-08-22, rewritten 2026-09-06)

- Path rules: every page and every tool sits one level below `site\`, so all
  of them use `../shared/config.js` and `../shared/…`, and their own files by bare
  name (`budget.css`, `votes.data.js`…). `buildChrome()` therefore defaults
  `BASE` to `"../"`; only a page nested deeper would set `window.BASE`
  before common.js loads. The old `window.BASE = "../"` lines in tools are gone.
- `site/tests/test_links.mjs` loads every page and tool, fails on any 404 and
  on any nav link that doesn't resolve (a folder link counts only if it has
  an index.html), and checks the four forwarders. **Run it after touching
  the layout.**

### NEVER TEST FROM file:// — AND serve.bat EXISTS SO YOU DON'T (2026-08-22)

Mercy opened the budget page from disk and saw dashes everywhere. The page
LOOKS fine that way — the tree and charts come from next.obudget.org over the
network — but anything the page read from its own folder (then
`data/paid/*.json`) was blocked by the browser on `file://`, silently.
`paidcheck.html` diagnosed it in one click. (Since 2026-09-06 nothing is read
from disk, so that particular failure is gone — but `file://` still breaks
relative links and the forwarders; keep serving.)

`scripts\serve.bat` (double-click; moved off the root 2026-09-06). Mercy has **no node on PATH**, so
it tries node → python → py → `tools/serve.ps1` (PowerShell + HttpListener,
which ships with Windows and needs no admin rights for a localhost prefix).
Zero installs either way. Serves `site/` on :8080, logs every 404, refuses paths outside
`site/`, and sends `Cache-Control: no-store` so a saved file shows immediately.
The pages are at `http://localhost:8080/budget_page/` etc. (the root forwards).

## TITLES & HEBREW REGISTER (2026-08-22) — settled with Mercy, don't churn it

Three layers, three jobs. Never let one repeat another's words:
- **Site** (header, every page): `הכסף שלנו`
- **Page** (`PAGE_STR.tagline`, per page, rendered by common.js and now styled as
  a real centred headline in style.css): `תקציב המדינה — מה קורה לכסף שלנו`
- **Blocks** (h2): `מאיפה הכסף מגיע, ומה החוב עולה לנו` · `לאן הולך הכסף`
- Chart subhead inside block 1 is `לאורך השנים` — it names what the CHART adds
  (time), not what the block is about.

RULE that produced this: a page title must not be a block title promoted, and
must not list the sections. Mercy first proposed
`תקציב המדינה — לאן הולך הכסף שלנו`, which is word-for-word block 2 and covers
only half the page. The page will grow more blocks; a title that enumerates them
goes stale on the next one.

**HEBREW REGISTER — verified against the Academy of the Hebrew Language:**
`לאן` is the STANDARD form; `לאיפה` is spoken register only. (Mercy's intuition
was the reverse — she read `לאן` as friendlier-but-less-professional. It is
both correct and everyday.) `מאיפה` is colloquial by the same rule, but we KEEP
it: its correct alternatives (`מאין`, `מניין`) read archaic on a site whose
whole promise is plain language; `מהיכן` is the middle option if ever needed.
Source: https://hebrew-academy.org.il/איפה-והיכן-לאן-ומניין/
