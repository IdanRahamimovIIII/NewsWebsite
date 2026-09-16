# CLAUDE.md — the relay (worker\worker.js)

Deploy: Mercy pastes worker.js into the Cloudflare dashboard → Deploy. Every
change needs that step — say so. Paid plan ($5/mo) but code keeps free-plan
discipline: 10ms CPU/request, 50 subrequests/invocation, KV 1 write/sec/key,
100k KV reads/day.
- `/build/votes` is MUTATING (`?resume=archive` once restarted a finished
  sweep) — never a probe. A 403 "Host not allowed" = our own `ALLOWED()`.

## Cloudflare resources
| resource | role |
|---|---|
| Worker `our-money` | this relay + data API. URL baked into `site\shared\config.js` → NEVER rename. Bindings `DATA` (KV), `CONTRACTS` (D1). Cron `0 */6 * * *` |
| Worker `our-money-site` | serves `site\`; no bindings, no data |
| KV namespace titled `DATA` | `ds:<name>` snapshots · `pub:<name>` pipeline-published · `photo:mk/<file>` · `vi:<year>` `vi:meta` `vi:live` vote index · `bi:<id>` bill info · `qa:last` |
| D1 (id in `pipeline\d1-config.json`) | contracts db, uploaded by the pipeline |

New resource → name `our-money-<what>` + a row here. Don't rename existing
ones. One relay worker on purpose (pages carry one PROXY URL; one file to paste).

## Routes (page side: `site\shared\CLAUDE.md` — keep in sync)
- `/b64/<base64url>` GET passthrough · `/postb64/<b64>` POST. `ALLOWED()`
  (~line 49): knesset.gov.il + subdomains (fs. for photos), court.gov.il +
  subdomains, next.obudget.org, data.gov.il, www.gov.il, gov.il, foi.gov.il.
  Not edge.boi.gov.il / api.cbs.gov.il — a new host = deliberate change + redeploy.
- `/preset/verdicts?from=&to=[&q=][&judge=][&lan=1]` · `/preset/votes?from=&to=[&type=1]`
  · `/preset/reports?sec=` (section-filtered; `digits()` sanitizes; whole-table
  DISTINCT ON times out). Presets exist because WebFetch rejects long URLs —
  add canned queries as presets.
- `/data/{budget|votes|bills|verdicts|persons}`, `/data/billinfo/<id>`,
  `/data/votesmeta` — KV snapshots, envelope `{t, stale?, data}`: fresh →
  serve; stale/missing → rebuild+store; upstream down → serve stale. TTL
  budget 12h, others 6h; cron refreshes. No DATA binding → 501 (pages fall
  back to live; site `common.js dataset(name)` unwraps). Budget snapshot = `code LIKE '00%' AND length(code)=4 AND
  code <> '0000'`. Verdicts = last 90 days, capped 50 (no pagination yet).
- Any other `/data/<name>` → KV `pub:<name>` as-is (servePublished): missing
  → 404 `{"error":"not published: …"}`; cacheTtl + max-age 3600.
- `/data/mkphotos` + `/photos/mk/<digits>-<8hex>.<jpg|png|gif|webp>`
  (servePhoto: other names → 400; type by extension; `max-age=31536000,
  immutable`; KV cacheTtl 1 day). Contract: `pipeline\photos\NOTES.md`.
- `/search/votes?qs=&from=&to=&y0=&y1=&limit=` · `/build/votes[?resume=archive|finish=1]`
  (MUTATING) · `/qa/report` (POST from selftest.html; Claude GETs with `?fresh=N`).

## v8 — D1 contracts (live)
- `/contracts?code=<budget line>[&year=][&n=25]` (budget page): contracts
  whose LIVE allocation is under the code prefix (historical allocations
  don't resurrect moved charges); year filter excludes contracts with no
  known years (Mercy); volume DESC; n+1 fetched so `more` is honest; rows
  carry `reports[]` + parsed `sources`. Prefix = RANGE `budget_code >= code
  AND < code||'A'`, never LIKE (rides ix_allocations_code).
- `/contract?id=<order_id>` — all contracts_v columns + all allocations
  (historical labelled) + reports.
- `/supplier?hp=<ח"פ>[&n=50]` — by company_id, with COUNT.
- Rules: every query hits an index; NO free-text route without FTS (infix
  LIKE ≈ 1M reads/call). Cache API 6h, `&fresh=1` bypasses. LIMIT everywhere.
  Missing binding → 501.

## v9 — contractors page tables (confirm deploy with Mercy)
Serves precomputed `ctr_*` + `ctr_fts`; NOTHING aggregates live — the
definitions belong to the build (`pipeline\contractors\NOTES.md`); never
re-derive a number here. Same discipline as v8, same CONTRACTS binding.
- `/contractors/summary[?year=]` — ctr_years (all years by default).
- `/contractors/top?year=&lens=all|exempt` — 25 rows.
- `/contractors/exemptions?year=[&n=10]` — build keeps 25/year.
- `/contractors/supplier?sid=` — whole profile: 1 ctr_sup read + 25 PK reads
  on contracts_v; sid = entity_id or exact Hebrew name; `of` for "מוצגות X מתוך Y".
- `/contractors/search?q=` — FTS5 MATCH, 25 hits. User text never raw into
  MATCH: syntax chars dropped, each word quoted, ≤6 words AND-ed.
- 502 "no such table: ctr_years" = tables never uploaded. "מדוע פטור?" popover
  has no endpoint on purpose (our db lacks those texts; page reads BudgetKey).

## Vote index (v7) — every plenum vote 2003→today in KV
- One TSV key per year (NOT JSON: indexOf over 1 MB ≈1ms, JSON.parse ≈10ms →
  1102). Line: `id⇥date⇥time⇥src(m|a)⇥passed(1|0|-)⇥for⇥against⇥abstain⇥protocol⇥title`.
- `/build/votes` = ONE upstream step per call; phases modern (45-day windows
  from 2021-07-14) → archive (Votes.svc `$orderby=vote_id&$skip=N`) →
  compact (merge parts per year, dedupe by vote id). Cursor in `vi:meta`;
  build.html drives it (1.2s pacing); cron advances 20 steps/firing;
  `?finish=1` skips to compaction. Built: 34,861 votes, 2003–2026.
- OData lesson: Votes.svc ignores $top above its page size (archive = 100)
  → advance $skip by rows RETURNED; only an EMPTY page means the end.
- Cron writes last 60 days to `vi:live`; client dedupes by vote id.
- Search: phrases OR-ed, words in a phrase AND-ed order-free, Hebrew quotes
  stripped; page fans out by 6-year blocks × 8-phrase chunks. Archive rows
  carry results; modern votes need GetVoteDetails (batches of 300 + "check more").
- Tests: wtest.mjs (real worker, fake Knesset, in-memory KV), test_index.mjs,
  test_votes.mjs. GOTCHA: installFakeUpstream replaces globalThis.fetch —
  keep `realFetch`. D1 tests: `wtest_d1.mjs`, `wtest_contractors.mjs` (27) —
  Claude runs in cloud: node --experimental-sqlite + python3, real
  build_sqlite/build_contractors fixtures, fake D1 over node:sqlite.

## Open
- v10: store bill id (`sess_item_id` / FK_ItemID) on each vote-index row →
  "bills proposed by X" becomes one exact request (`site\votes_page\NOTES.md`).
- `BUILD_KEY = "rebuild"` (~line 66) gates `?reset=1` (wipes the vote index)
  in plain text — keep repo private or move it to a secret.
- gov.il report .xlsx: WebFetch can't read binary; files arrive via the bridge.
