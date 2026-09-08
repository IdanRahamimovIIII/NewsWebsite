# CLAUDE.md — THE RELAY (worker\worker.js)

Notes from Claude to Claude (and Mercy) for chats about the Cloudflare Worker.
This is the RELAY zone of NewsWebsite; the pages (`site\`) and the data
pipeline (`pipeline\`) have their own CLAUDE.md.

Deployment: Mercy pastes worker.js into the Cloudflare dashboard editor and
clicks Deploy — every change here needs that step, say so. KV binding `DATA`
(namespace our-money-data), cron `0 */6 * * *`. Free plan limits that shape
everything: 10ms CPU per request, 50 subrequests per invocation, KV
1 write/second/key, 100k reads/day. Paid ($5/mo, bought 2026-08-25 for the
D1 bootstrap) lifts CPU; the code still assumes free-plan discipline.

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

## WHAT THE OTHER ZONES EXPECT FROM THIS ONE (the interface — keep the other side in sync)

Routes the pages call (documented for the pages in `site\CLAUDE.md`):
`/b64/<base64url>` GET passthrough to an ALLOWED host · `/postb64/<b64>` POST
with body · `/preset/<name>?params` — `verdicts`, `votes`, `reports?sec=` ·
`/data/{budget|votes|bills|verdicts|persons}` + `/data/billinfo/<id>` from KV,
envelope `{t, stale?, data}`, 501 when DATA is unbound · `/data/votesmeta` ·
any `/data/<name>` that is not a built-in DATASET is answered from the KV
key `pub:<name>` as-is (`servePublished`, worker v7) — missing key → 404
`{"error":"not published: …"}`, `cacheTtl` 3600 on the KV read,
`Cache-Control: max-age=3600`. (The paid overlay rode this 2026-09-06 →
2026-09-08; its `pub:paid/*` keys are deleted — the budget page reads the
D1 `/contracts` family now.) **`/data/mkphotos` +
`/photos/mk/<MkId>-<hash8>.jpg` (v7, same day)**: the MK portrait manifest
(`pub:mkphotos`, through servePublished) and the bytes (`photo:mk/*`, binary
KV values, `servePhoto`: name must be `<digits>-<8 hex>.<ext>` else 400,
`Content-Type` by extension, `Cache-Control: max-age=31536000, immutable`
— the name carries a content hash; KV read `cacheTtl` one day). Written by
`pipeline\photos\publish_photos.py`; contract in `pipeline\photos\NOTES.md`.
**`/contracts?code=` + `/contract?id=` + `/supplier?hp=` (v8, 2026-09-08 —
the D1 contracts database; see the v8 section below; the budget page reads
`/contracts`)** ·
**`/contractors/{summary,top,exemptions,supplier,search}` (v9, 2026-09-08 —
the contractors page's precomputed tables; see the v9 section below; the
page still reads BudgetKey until its swap session)** ·
`/search/votes?qs=&from=&to=&y0=&y1=&limit=` · `/build/votes[?resume=archive|finish=1]`
· `/qa/report` (POST from selftest.html, GET by Claude with `?fresh=N`).
`ALLOWED()` (worker.js ~line 49, read 2026-09-05): knesset.gov.il and
*.knesset.gov.il (incl. fs. for photos), court.gov.il and *.court.gov.il,
next.obudget.org, data.gov.il, www.gov.il, gov.il, foi.gov.il (the ministry
report files — added after the 403 lesson below). NOT on it: edge.boi.gov.il
(Bank of Israel SDMX), api.cbs.gov.il — adding a host is a deliberate change
plus a re-deploy by Mercy.

## THE CLOUDFLARE ACCOUNT — WHAT EXISTS AND WHY (2026-09-08, from Mercy's dashboard)

Two workers, one KV namespace, one D1 database. The split is deliberate —
the SITE and the DATA change for different reasons and deploy separately:

| resource | name | role |
|---|---|---|
| Worker | **our-money** | THE RELAY + data API — this zone's worker.js. Its workers.dev URL is baked into `site\shared\config.js`, so RENAMING IT BREAKS EVERY DEPLOYED PAGE — don't. Bindings: `DATA` (the KV namespace), `CONTRACTS` (the D1 database). Cron `0 */6 * * *`. |
| Worker | **our-money-site** | serves the WEBSITE (the deployed copy of `site\`). No bindings, no data — page code only, per Mercy's rule. |
| KV namespace | titled **DATA** | one namespace, key FAMILIES keep it legible: `ds:<name>` (worker-built snapshots) · `pub:<name>` (pipeline-published datasets — today `pub:mkphotos`) · `photo:mk/<file>` (portrait bytes) · `vi:<year>` + `vi:meta` + `vi:live` (the vote index) · `bi:<id>` (bill info) · `qa:last`. `pub:paid/*` was deleted 2026-09-08 with the overlay. |
| D1 database | (id in `pipeline\d1-config.json`) | the contracts database — 986,942 merged contracts, uploaded by `upload-to-d1.bat`, served by this worker's `/contracts` family. |

Naming rules going forward (Mercy, 2026-09-08 — "as this project grows the
naming gets confusing"): a NEW resource is named `our-money-<what it is>`
and gets a row in this table in the same chat that creates it. Existing
names stay: renaming the relay worker changes its URL (config.js, every
open tab), a D1 database cannot be renamed, and the KV namespace's title
is referenced by the pipeline's publishers (`cf_kv.py` NAMESPACE_TITLES) —
none of them is worth the churn. One relay worker stays ONE on purpose:
the pages carry a single PROXY base URL, Mercy deploys by pasting a single
file, and splitting the API would double both. The site worker is separate
because it is not an API at all.

Queued for this zone: **worker v10** — store the bill id (`sess_item_id` /
FK_ItemID) on every vote-index row so "bills proposed by X" becomes one exact
request (the client side of that story is in `site\votes\NOTES.md`, "THE REAL
FIX STILL PENDING"). (Was queued as "v9" until 2026-09-08; v9 became the
contractors endpoints.)

## WORKER v9 — THE CONTRACTORS PAGE'S ENDPOINTS (2026-09-08, awaiting Mercy's deploy)

The pipeline precomputes the contractors page's aggregates at build time
(`pipeline\contractors\build_contractors.py` → D1 tables `ctr_years`,
`ctr_top`, `ctr_ex`, `ctr_sup` + the FTS5 index `ctr_fts`, uploaded by
`pipeline\contractors\upload-to-d1-contractors.bat`). Five read-only routes
serve them; NOTHING aggregates live, and the definitions (in-force years,
the junk-year rule, פטור ממכרז by the record's own words, sid =
COALESCE(entity_id, supplier)) are the BUILD's job — the contract is
`pipeline\contractors\NOTES.md`; this worker must not re-derive a number.

- **`/contractors/summary[?year=]`** — ctr_years, ALL years by default
  (~a dozen rows): the page's three tiles, and a year switch costs nothing
  (the old BudgetKey year switch was ~4s of live aggregation).
- **`/contractors/top?year=&lens=all|exempt`** — 25 rows off the PK.
- **`/contractors/exemptions?year=[&n=10]`** — the regulations ranking
  (build keeps 25/year, page shows 10).
- **`/contractors/supplier?sid=`** — the WHOLE profile in one response
  (facts + byOffice + series + the 25 largest contracts as full display
  rows + `of` for "מוצגות X מתוך Y"): one ctr_sup read + 25 PK reads on
  contracts_v. sid may be an entity_id or an exact Hebrew supplier name.
- **`/contractors/search?q=`** — FTS5 MATCH over supplier name + purpose,
  25 hits joined back to contracts_v by order_id. The user's text is never
  passed to MATCH raw (FTS5 has its own query syntax): syntax characters
  dropped, each word quoted, up to 6 words AND-ed.

Same discipline as v8: every query hits an index or the FTS, the Cache API
fronts everything (6h, `&fresh=1` bypasses), LIMIT everywhere, missing
binding → 501. No new bindings — the same `CONTRACTS` D1 database. A 502
mentioning "no such table: ctr_years" means the tables were never uploaded
(run the two contractors .bats). The "מדוע פטור?" register-text popover has
NO endpoint here on purpose — our db lacks BudgetKey's description/reason
texts, so the page keeps reading BudgetKey live for that one popover
(accepted interim; `pipeline\contractors\NOTES.md`, open question 1).

Tests: `worker\wtest_contractors.mjs` (like wtest_d1.mjs: real
build_sqlite.py + build_contractors.py fixtures, fake D1 over node:sqlite,
the real worker.fetch — 27 asserts, green 2026-09-08; run in Claude's cloud,
node --experimental-sqlite). The front-end swap to these endpoints is a
budget_page session's job, not this zone's.

## WORKER v8 — THE D1 CONTRACTS ENDPOINTS (deployed + verified live 2026-09-08)

The pipeline's database (tables `strings`, `allocations`, `reports`,
`contracts`, view `contracts_v`, 10 indexes — 986,942 contracts, uploaded
2026-08-26, verified 2026-09-05) is served by three read-only routes:

- **`/contracts?code=<budget line>[&year=YYYY][&n=25]`** — the budget page's
  route: contracts whose LIVE allocation sits under the code prefix
  (historical allocations deliberately do not resurrect a moved charge),
  filtered to the year (contracts with no known years EXCLUDED — Mercy's
  rule), volume DESC, n+1 fetched so `more` is honest, each row carrying its
  `reports[]` and its parsed `sources`. The prefix join is a RANGE
  (`budget_code >= code AND < code || 'A'` — codes are digits, 'A' > '9'),
  never a LIKE, so it always rides ix_allocations_code.
- **`/contract?id=<order_id>`** — one contract in full: every contracts_v
  column + all allocations (historical labelled) + all reports.
- **`/supplier?hp=<ח"פ>[&n=50]`** — by `company_id`, with a COUNT so a cut
  list is never passed off as complete.

RULES (agreed 2026-08-25, now code): every query hits an index — there is NO
free-text route, and none should be added without FTS (an infix LIKE bills
~1M reads per call; the site's text search stays on BudgetKey live). The
Cache API fronts all three (6h, `&fresh=1` bypasses — re-upload day). LIMIT
everywhere. Missing binding → 501, same convention as the KV routes.

Setup was step D in worker.js — the D1 database is bound as variable
**`CONTRACTS`** (done 2026-09-08, first live answer verified the same day:
the מילגם contract with the ministry file's paid figure). Tests: `worker\wtest_d1.mjs` (run
by Claude in the cloud — node + python3; builds a real tiny db with
build_sqlite.py and drives the real worker.fetch). Also in v8: the
`/data/budget` snapshot stores the administrative sections only
(`code LIKE '00%' AND length(code)=4 AND code <> '0000'`) — the old mixed
query is gone from the worker; the page keeps its client-side filter as a
belt-and-braces.

Claude probes the live worker READ-ONLY via WebFetch (URL ceiling ~248 chars,
cache ~15 min → add `?fresh=N`). Never call a mutating route as a probe —
`/build/votes?resume=archive` once restarted Mercy's finished sweep.

Also open: `const BUILD_KEY = "rebuild"` (~line 66) gates `?reset=1`, which
wipes the vote index, in plain text. Private repo, but still a live word.

## WORKER v8 — `/preset/reports?sec=0020` (2026-08-23)

The old `reports` preset asked for `DISTINCT ON (publisher)` across the whole
table and **times out** (verified). Replaced with a section-filtered version,
and `digits()` strips anything non-numeric before it reaches SQL — that route is
open to the internet.

## SNAPSHOT STORE (worker v6) AND PRESETS (worker v5) — 2026-08-21

- **Snapshot store (worker v6)** (2026-08-21): the worker keeps our own
  dataset in Cloudflare KV (binding name `DATA`; the namespace is ALSO titled
  `DATA` in Mercy's account — not `our-money-data` as the header suggests,
  found 2026-09-06 by the first publish; the pipeline's publisher tries both;
  Mercy creates+binds it in the dashboard — worker.js header has the steps).
  GET /data/{budget|votes|bills|verdicts} → {t, stale?, data}. Cache-through:
  fresh KV → serve; stale/missing → rebuild from upstream, store, serve;
  upstream down + stale copy exists → serve stale (resilience). Cron
  `0 */6 * * *` refreshes all. TTLs: budget 12h, others 6h. 501 if DATA
  binding missing (pages then fall back to live). common.js `dataset(name)`
  unwraps the envelope + shows an "updated at" footer note; pages are
  snapshot-first with live fallback (court: text search always live;
  index: year-change + supplier search live; votes: drilldowns + MK search
  live). Verdicts snapshot = last 90 days, capped at 50 by the upstream
  batch size (pagination still unexplored).
- **Relay presets (worker v5)** (2026-08-21): the WebFetch proxy REJECTS long
  URLs (~>300 chars), so /postb64/ with big bodies fails — that's why the
  worker has /preset/<name>?params: it builds big upstream bodies itself.
  Existing: /preset/verdicts?from=YYYY-MM-DD&to=…[&q=text][&judge=id][&lan=1],
  /preset/votes?from=…&to=…[&type=1]. Add future canned queries as presets;
  site pages should call presets too (simplest client code).

## THE RELAY'S 403 ON gov.il WAS OUR OWN ALLOWLIST (2026-08-22)

I reported "gov.il blocks the relay" — wrong, and Mercy caught it. worker.js
line 47 `ALLOWED()` lists knesset.gov.il, court.gov.il, next.obudget.org and
data.gov.il. **`www.gov.il` is not on it**, so line 631 answers
`Host not allowed` with status 403. The far end never saw the request.
(The other 403, `CONNECT tunnel failed` from curl, IS real and is this
sandbox's own egress proxy — that one cannot be changed from here.)

Adding `host === "www.gov.il"` would let the worker fetch the report files,
which is the path to a scheduled refresh. It does NOT let Claude read them
here: WebFetch renders every response as text and .xlsx is a binary zip. Files
still arrive through the device bridge.

RULE: a 403 says someone refused. Check WHO before reporting a blocker.

Worth doing: report it to הסדנא לידע ציבורי, and consider ingesting the .xlsx
files ourselves — `ביצוע חשבוניות לתקופת הדוח` would give real per-period
figures with no differencing at all, which is strictly better than what we
derive today. Note the sandbox and the relay are BOTH blocked from gov.il blob
URLs (403); the files have to arrive through the device bridge.

## THE VOTE INDEX — our own copy of every vote (worker v7, 2026-08-21)

Mercy's push ("I want to filter through everything, not the latest news") ended
the window-walking era. The worker now harvests EVERY plenum vote 2003→today
into KV and the page searches our copy.

- Storage: one KV key per year, plain TSV text (NOT JSON — the free plan gives
  10ms CPU per request; String.indexOf over a megabyte costs ~1ms, JSON.parse
  of the same costs ~10ms and would 1102). Line format:
  `id ⇥ date ⇥ time ⇥ src(m|a) ⇥ passed(1|0|-) ⇥ for ⇥ against ⇥ abstain ⇥ protocol ⇥ title`
- Build: `/build/votes` does ONE step per call (≤1 upstream request — the free
  plan allows 50 subrequests and 10ms CPU per invocation, so a single big build
  is impossible). Phases: modern (45-day windows from 2021-07-14) → archive
  (Votes.svc `$orderby=vote_id&$skip=N&$top=400`) → compact (merge each year's
  parts into one key: ~130 keys → ~24, because search reads every key it spans
  and the free plan allows 100k reads/day). Cursor lives in `vi:meta`; the
  build is resumable and idempotent-ish. `build.html` drives it (~130 steps,
  paced 1.2s for KV's 1-write-per-second-per-key rule); cron also advances it
  20 steps per firing, so it finishes even if she closes the tab.
- Freshness: cron writes the last 60 days into `vi:live` (overwritten); search
  merges and the client dedupes by vote id.
- Search: `/search/votes?qs=a|b&from=&to=&y0=&y1=&limit=` — phrases OR-ed,
  words inside a phrase AND-ed (order-free), Hebrew quotes stripped. The page
  fans out by 6-year blocks × 8-phrase chunks so no request scans too much.
- Client: `idxMeta()` / `idxSearch()` / `groupsFromIndex()` in votes.html.
  **Everything degrades gracefully**: no index → the old window-walking path.
  Archive rows carry their result, so ✔/✘ is free for 2003–2021; modern votes
  still need one GetVoteDetails each (that's why the result/type filters still
  check in batches of 300 — but now with a "check more" button, no hard cap).
- Measured on synthetic data: ~71 bytes/row (real titles are longer, expect
  ~110–140) → 55k votes ≈ 6–8 MB of the free plan's 1 GB.
- **BUG FOUND ON THE FIRST REAL BUILD (2026-08-21)**: Votes.svc IGNORES $top
  above its own page size (~250 rows) and returns `odata.nextLink` instead. The
  build read "fewer rows than requested" as "end of data" and stopped after ONE
  archive page — Mercy's first index had 10,017 rows and years 2003 + 2021-2026,
  with 2004–2020 missing. Fix: advance $skip by the rows ACTUALLY returned and
  stop only on an empty page. RULE: never infer "last page" from a short page
  on an OData service; only an empty page (or a missing nextLink) means the end.
  `/build/votes?resume=archive` re-sweeps the archive keeping everything else;
  duplicate lines are harmless (search dedupes by vote id).
- **Archive page size is 100** (not the 400 we ask for), confirmed live: the
  first real full build produced 34,861 rows covering 2003–2026 in ~250 steps.
- **TWO LESSONS FROM DEBUGGING THE FIRST BUILD (2026-08-21) — both mine, both
  expensive:** (1) WebFetch CACHES a URL for ~15 minutes. I read
  /data/votesmeta, got a stale copy, and concluded Mercy's archive sweep had
  failed when it had actually succeeded. Always add a cache-busting param
  (?fresh=<n>) when checking live state, and never tell her something is broken
  on the strength of one cached read. (2) I then "probed" the fix by calling
  /build/votes?resume=archive on her LIVE worker — which restarted her
  completed sweep. Probing endpoints that MUTATE her data is not probing.
  Read-only checks only, unless she asked for the change.
  Fallout handled by `/build/votes?finish=1`: skips to the compaction pass,
  which now also dedupes lines by vote id, so a restarted or repeated sweep
  costs nothing permanent.
- Tests: `wtest.mjs` runs the REAL worker in Node against a fake Knesset with an
  in-memory KV (build → search assertions); `test_index.mjs` puts that worker
  behind votes.html in Playwright; `test_votes.mjs` covers the no-index
  fallback. GOTCHA: installFakeUpstream() replaces globalThis.fetch — the
  harness must keep `realFetch` or its own localhost calls get faked too.
