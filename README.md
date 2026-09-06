# הכסף שלנו / Our Money — Israeli Budget Transparency

A bilingual (Hebrew/English) website that shows where Israel's state budget goes,
using live open data. Version 1 covers **government spending**; laws & votes and
Supreme Court rulings are next (see TODO.md).

## How to open it

Just double-click **`site\index.html`** — it opens in your browser. That's it.
The page fetches live data over the internet from the BudgetKey open database,
so you need to be online.

## Where things live

```
NewsWebsite\
├─ site\            ← THE WEBSITE. This is the only copy. Upload this folder.
│   ├─ index.html      the budget page
│   ├─ votes.html      Knesset votes & legislation
│   ├─ mk.html         MK portfolio pages
│   ├─ court.html      Supreme Court rulings
│   ├─ config.js       your one setting: the relay address
│   ├─ shared\         style.css + common.js — used by every page
│   ├─ budget\ votes\ mk\   everything each page needs (+ its NOTES.md for Claude)
│   ├─ tools\          qa.html, build.html, selftest.html — for you, not visitors
│   ├─ tests\          the automated page checks (Claude runs them; harmless if uploaded)
│   ├─ get-photos.bat + fetch_photos.py   downloads the MK photos into photos\
│   ├─ data\  photos\  files the automations write — never edit by hand
│   └─ CLAUDE.md, SOURCES.md   Claude's notes for page work
├─ pipeline\        ← THE DATA FACTORY: everything behind the contracts database
│   ├─ build-database.bat  upload-to-d1.bat  verify-d1.bat  audit.bat  clean-up.bat
│   │                   your double-click actions (each explains itself when it opens)
│   ├─ tools\          the Python those .bat files and the automations run
│   ├─ audit\          compare.html + paidcheck.html — the audit tool (open via audit.bat)
│   ├─ tests\          the pipeline's automated checks
│   ├─ workflows\      the four GitHub automations — THE source; .github\ holds a copy
│   ├─ setup\          install-workflows.bat — copies workflows\ into .github\workflows\
│   ├─ build\          work area — everything in it can be rebuilt; clean-up.bat empties it
│   ├─ reports\        ministry report files fetched one by one
│   ├─ inputs\         the source files: the three zips + Tenders-…\ Exemptions-…\
│   │                   "Files" below says which of these must never be deleted
│   ├─ out\            contracts.db + contracts-public.db (built by build-database.bat)
│   ├─ d1-config.json  your Cloudflare ids + token (never committed)
│   ├─ FIELDS.xlsx     the schema constitution — the build follows this file
│   └─ CLAUDE.md       Claude's notes for data work
├─ worker\          worker.js — the code you paste into Cloudflare (+ CLAUDE.md)
├─ scripts\         serve.bat (local preview of the site) + its two helper scripts
└─ README.md, TODO.md, CLAUDE.md
```

**Why the folder is split into zones (2026-09-05).** Working with Claude
costs tokens per file it has to read. The folder is now arranged so that a
chat about the pages connects only `site\`, a chat about the data connects
`pipeline\`, and a chat about the relay connects `worker\` — each has its own
CLAUDE.md with everything it needs. The root CLAUDE.md is just the map.
`reorganize.bat` did the moves (it moves, never deletes, and tidies itself
away when done); the GitHub automations were re-installed the same day with
the new paths.

**There is no second copy any more.** The old layout kept the same files at the
top level *and* inside `site\`, and it was easy to edit one and deploy the
other. Now `site\` is simply the website — edit it, upload it, done.

If the numbers don't load, open the browser console (F12) — a warning line
starting with `[our-money]` will say what failed. Tell Claude and we'll fix it.

## What's on the page

- Total state spending for the selected year (original vs revised vs actually spent)
- **Two views of the same money**, switchable above the chart:
  **לפי משרד** — the official structure of the budget law, ministry by ministry;
  **לפי תחום** — the same spending grouped by purpose (defence, social services,
  infrastructure), which answers "what does the state spend on" rather than
  "which office signs the cheque"
- Click any bar to drill down — now all the way to the **תקנה תקציבית**, the
  smallest line in the budget (about 5,800 of them in 2025)
- Contract & supplier search — who receives government money (search in Hebrew)
- Plain-language explainer of the budget terms
- Language toggle (עברית / English), automatic light & dark mode

## Where the data comes from

- **BudgetKey (מפתח התקציב)** — https://next.obudget.org — an open database of
  Israeli fiscal data by the Public Knowledge Workshop (הסדנא לידע ציבורי),
  built from official Ministry of Finance files. The site queries it directly
  from your browser; nothing is stored anywhere else.
- Amounts are **net**, in shekels. The source stores values in thousands of ₪;
  the site detects and converts this automatically.

## One-time setup for the Knesset data (votes.html)

The budget page works with no setup. The votes & legislation page needs one
extra piece: the Knesset's servers don't let websites on other addresses read
their data directly (a browser rule called CORS). The fix is a tiny free
"relay" that fetches the data for your site. Setup, once, ~5 minutes:

1. Create a free account at https://dash.cloudflare.com
2. In the menu: **Workers & Pages → Create → Create Worker** → keep the
   "Hello World" template → **Deploy**
3. Click **Edit code**, delete everything, paste the contents of `worker.js`
   (it's in this folder), then **Deploy** again
4. Copy your worker's address — it looks like
   `https://something.yourname.workers.dev`
5. Open `config.js` (in this folder) with Notepad and put that address between
   the quotes: `window.PROXY_URL = "https://something.yourname.workers.dev";`
6. Refresh votes.html — the Knesset data should load

The relay only forwards requests to the government data sites listed inside
`worker.js` — it can't be misused as a general proxy. Cloudflare's free plan
allows 100,000 requests per day, far more than you'll need.

## Your own dataset (snapshots) — one-time setup, ~5 minutes, free

The site keeps its own copy of the core data in your Cloudflare account and
refreshes it automatically a few times a day. Visitors read YOUR copy — fast,
and it keeps working even when a government server is down. To turn it on:

1. Paste the current `worker.js` into your worker (Edit code → Deploy), if
   you haven't already.
2. In the Cloudflare menu: **Storage & databases → KV** → **Create namespace**
   → name it `our-money-data` → Create.
3. Go to your worker → **Settings → Bindings** → **Add** → **KV namespace** →
   Variable name: `DATA` → select `our-money-data` → Save (Deploy if asked).
4. Still in the worker → **Settings → Triggers** → **Cron Triggers** → **Add** →
   expression: `0 */6 * * *` (= every 6 hours) → Save.

That's it. The first visitor after setup fills the store automatically; the
schedule keeps it fresh. Each page shows "הנתונים עודכנו…" in the footer when
it's reading from your dataset. If a government source breaks, the site
serves the last good copy instead of failing.

## The vote archive (all votes since 2003) — one-time build, ~2 minutes

The Knesset's API can only answer "which votes happened between two dates", so
searching the whole history through it is painfully slow. Instead the site keeps
its own copy of **every plenum vote from 2003 until today** in your Cloudflare
store, and searches that. Roughly 55,000 votes ≈ 7 MB — the free plan allows
1 GB, so it costs nothing.

1. Paste the current `worker.js` into your worker (Edit code → Deploy).
2. Open `build.html` from this folder in your browser and press **התחלת הבנייה**.
   It collects the votes step by step and shows progress; it can be stopped and
   resumed at any time. Leave the tab open until it says הושלם ✔.
3. That's it. The 6-hourly schedule keeps it up to date by itself.

Until this is built the site still works — searches just fall back to asking the
Knesset window by window, which is slower and reaches about three years back.

## Putting it online (free)

Any of these takes ~10 minutes, no server needed. In every case the thing you
upload is the **`site` folder**, not the whole project folder.

1. **Netlify Drop**: go to https://app.netlify.com/drop and drag `site` in.
2. **Cloudflare Pages**: similar, at https://pages.cloudflare.com.
3. **GitHub Pages**: create a GitHub account → new repository → upload the
   contents of `site` → Settings → Pages → deploy from main branch. You get
   `https://yourname.github.io/reponame/`.

## Files

Inside `site\` — the website itself:

- `index.html` — the budget page (government spending). Just the page layout;
  the work is split into `site\budget\`, one file per job:
    - `budget.strings.js` — **every word the page says**, Hebrew and English
    - `budget.data.js` — the queries, and the map of how budget codes work
      (read the comment at the top before changing any query)
    - `budget.view.js` — draws the tree, the tiles and the search results
    - `budget.css` — this page's own styling
- `votes.html` — the Knesset votes & legislation page, split the same way into
  `site\votes\`, so you never have to scroll through everything to change one
  thing:
    - `votes.strings.js` — **every word the page says**, Hebrew and English.
      Change wording here without touching any logic.
    - `votes.data.js` — talks to the Knesset APIs and to our vote archive
    - `votes.search.js` — decides *which* votes to show
    - `votes.view.js` — draws them
    - `votes.bills.js` — the second tab (bills in the legislative process)
    - `votes.css` — this page's own styling
- `court.html` — the Supreme Court page (fresh rulings, needs the relay)
- `config.js` — one setting: the address of your data relay (see above)
- `shared\style.css` — the shared look of all pages (colors, cards, tables…)
- `shared\common.js` — shared code: languages, the header & tabs, the relay

Inside `site\tools\` — pages for you, not for visitors:

- `qa.html` — checks every data source live and shows a green/red report you
  can screenshot for Claude
- `build.html` — builds the vote archive in your Cloudflare store (see above);
  needed once, then only if you ever want to rebuild it
- `selftest.html` — **the check-it-yourself page.** Open it, press הרצת הבדיקות,
  and it runs the real searches against the real data and shows what passed or
  failed. It also sends the report to your Worker, so Claude can read exactly
  what broke without you copying anything. Add `?mk=שם` to test a specific MK

The double-click actions — the five data ones live in `pipeline\` (each runs
a script from `pipeline\tools\`), `serve.bat` in `scripts\`, `get-photos.bat`
in `site\`; every one explains itself when it opens:

- `pipeline\build-database.bat` — rebuilds `pipeline\out\contracts.db` and
  `pipeline\out\contracts-public.db` from the source files in `pipeline\inputs\` (the zips
  and export folders). Run it after new data arrives; it takes a while.
- `pipeline\upload-to-d1.bat` — sends `pipeline\out\contracts-public.db` to Cloudflare D1 in
  verified parts. Safe to re-run any time: finished parts are skipped, and a
  rebuilt database triggers a fresh upload automatically.
- `pipeline\verify-d1.bat` — proves the data in D1 really matches the local database,
  content and all. Run it after every upload, or whenever in doubt.
- `pipeline\audit.bat` — starts the local audit server and opens
  `pipeline\audit\compare.html` on it, reading the FULL database (the audit
  is for you only, never online; the page is no longer part of the website).
- `scripts\serve.bat` — serves `site\` on your machine for local testing.
- `site\get-photos.bat` — downloads the MK photos into `site\photos\`.
- `pipeline\setup\install-workflows.bat` — copies `pipeline\workflows\*.yml`
  into `.github\workflows\` (GitHub only reads them there). Run it after any
  change to a workflow file, then commit both folders. It replaced the three
  old `install-*` scripts on 2026-09-06.
- `pipeline\clean-up.bat` — deletes the rebuildable files (everything in `pipeline\build\`
  except the small upload-memory files, plus caches) when disk space runs
  low. It lists what it will remove and waits for a key.
- `reorganize.bat` (root) — the one-time move into the zone layout (2026-09-05/06).
  Moves only, never deletes; when everything checks out it moves itself
  into `_old_delete_me\`, so if you no longer see it, it ran.

The data files — what they are and whether they can be lost. Since
2026-09-05 the built databases live in `pipeline\out\` and the source files
in `pipeline\inputs\` (both ignored by git):

- `pipeline\out\contracts.db` — the FULL database (every field + provenance), used only by
  the local audit. Rebuildable, but slowly — keep it.
- `pipeline\out\contracts-public.db` — the public copy; this is exactly what lives in D1.
  Rebuilt by `build-database.bat`.
- `pipeline\inputs\full-records.zip` — **the only copy of the collected ministry reports.
  Never delete.** (The online copy in GitHub Actions expires after a while.)
- `pipeline\inputs\budgetkey-raw.zip` — the BudgetKey download the build reads. Keep it;
  re-collecting takes hours of GitHub Actions time.
- `pipeline\inputs\publications-register.zip` — the frozen data.gov.il snapshot (ends
  2021-01-31, can never be downloaded again). **Never delete.**
- `pipeline\inputs\Tenders-07082026\`, `pipeline\inputs\Exemptions-07082026\` — your manual portal exports
  from 2026-08-07 with their parsed JSONs. That date's export can't be
  re-downloaded — **never delete.**
- `pipeline\reports\` — ministry report files fetched one by one.
- `pipeline\build\` — the work area: everything inside is remade by
  `build-database.bat` (only `build\d1\manifest.json` + `state.json` matter
  between runs — they are how the uploader remembers what's already in D1).
- `pipeline\d1-config.json` — your Cloudflare ids and token. Stays on this computer,
  never committed.
- `pipeline\FIELDS.xlsx` — the schema constitution: every field, every source, and
  your decisions column. The build follows this file.

And the rest:

- `worker\worker.js` — the relay code you paste into Cloudflare
- `pipeline\tools\` — the Python scripts the .bat files and the automations
  run; each starts with a comment explaining itself and the lessons learned
  the hard way
- `scripts\` — `serve.bat` + `serve.mjs`/`serve.ps1`, kept outside `site\` so
  they are not uploaded with it
- `site\tests\test_budget.mjs` — runs the real budget page against a fake
  budget containing the same traps as the real one, and asserts the chart
  shows ministries only
- `site\tests\test_mk.mjs` — the same for the MK portfolio page
- `site\tests\test_links.mjs` — loads every page and checks that every file
  it asks for exists and every nav link works. This is the guard on the
  folder layout: move a file without fixing a path and it fails immediately.
  All run with `node <file>` (needs Node + `npm i playwright`)
- `pipeline\tests\` — checks for the parsers, the merge, the audit tool and
  the fetchers (Python) plus `cmp_audit.mjs`; Claude runs the relevant one
  before saying "fixed"
- `pipeline\workflows\` — the monthly automations that collect data by
  themselves; its README has the schedule table. `.github\workflows\` is the
  copy GitHub reads — generated by `install-workflows.bat`, never edited
- `TODO.md` — the roadmap
- `CLAUDE.md` — the map for Claude: which folder to connect for which work.
  The detailed notes live in each zone: `site\CLAUDE.md` (+ a `NOTES.md`
  per page and `SOURCES.md`), `pipeline\CLAUDE.md`, `worker\CLAUDE.md`
- `README.md` — this file
