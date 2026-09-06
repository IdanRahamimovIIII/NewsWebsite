# HANDOFF — the site's data moves to Cloudflare (2026-09-06)

For the next `pipeline\` + `worker\` chat. Written by the site chat that
reorganised `site\` on 2026-09-06. Delete this file once every item is done
and the rule is recorded in `pipeline\CLAUDE.md` / the worker's notes.

## Mercy's rule (2026-09-06)

**Everything a page shows comes from a public API or from Cloudflare.** The
site folder holds page code only — no JSON, no photos, no pipeline output.
Everything data-related that used to live under `site\` was gathered into
`site\_move-to-pipeline\` for Mercy to move into `pipeline\`:

```
_move-to-pipeline\
├─ README.md
├─ data\paid\<section>.json + index.json   the ministry-report overlay (52 docs, 20 MB)
├─ data\collection\ + data\inventory.txt   collector output (audit only — no page reads these)
├─ photos\mk\<MkId>.jpg + index.json + misses.json   the MK portraits (130 files, ~3 MB)
└─ get-photos.bat + fetch_photos.py        the photo collector (writes photos\mk\ next to itself)
```

The pages were ALREADY switched to the relay (below). Until the worker
serves these routes, the budget page shows dashes for the paid overlay
(with a debug line in the footer) and the MK page shows initials avatars.
Nothing else breaks.

## What the pages now ask the relay for — exact contract

Envelope everywhere: the existing KV snapshot shape `{t, stale?, data}`.
A missing route may answer 404 or 501 — the pages treat both as "not
published yet", quietly.

### 1. Paid overlay (budget page, `budget_page\budget.data.js`)

| Request | `data` must be |
|---|---|
| `GET /data/paid/index` | `{ "sections": ["0000","0002",…] }` — the old `data\paid\index.json` verbatim |
| `GET /data/paid/<section>` | `{ "sources": [url…], "reports": {…}, "orders": { "<order_id>:<10-digit code>": [paid, volume] } }` — the old `data\paid\<section>.json` verbatim |

Sizes: most docs < 1 MB, the largest (`0024`) is 2.4 MB — under KV's 25 MB
value limit, so KV keys `paid:index`, `paid:<section>` work; D1 `contracts_v`
(`/contract?id=`, `/supplier?hp=` — "coming" per site CLAUDE.md) would be the
better long-term home, but the page only needs the two GETs above.

The pipeline step that today writes `site\data\paid\` must instead upload
those documents (wrangler `kv key put`, or the worker's write route with the
existing token) — and STOP writing into `site\`.

### 2. MK photos (`mk_page\mk.data.js`)

| Request | Answer |
|---|---|
| `GET /data/mkphotos` | envelope, `data` = `{ "<MkId>": "<value>" }` where value is either an absolute image URL or a bare filename |
| `GET /photos/mk/<filename>` | the image bytes (`image/jpeg`), long `Cache-Control` — only needed when the manifest carries bare filenames |

Simplest: keep the manifest as it is (`{"<MkId>": "<MkId>.jpg"}`), put the
files in R2 (or KV, ~20 KB each) and have the worker serve `/photos/mk/*`
from there. Or upload them to any public bucket and put absolute URLs in the
manifest — then `/photos/mk/*` is not needed at all.

`fetch_photos.py` now writes `photos\mk\` next to itself and finds
`config.js` by looking in a few sensible places (its own folder, the parent,
`..\site\`, `..\..\site\`) — adjust `CONFIG_CANDIDATES` at the top once it
has a permanent home.

### 3. The tests already encode the contract

`site\budget_page\test_budget.mjs` mocks `/data/paid/index` and
`/data/paid/0020`; `site\mk_page\test_mk.mjs` mocks `/data/mkphotos` and
`/photos/mk/800.jpg`. If the worker answers in those shapes the pages are
right by construction.

## Checklist (updated 2026-09-06 by the pipeline chat)

- [x] pipeline: paid documents → KV, nothing written into `site\` — `pipeline\tools\publish_paid.py` + `publish-paid.bat`; `refresh-data.yml` parses into `pipeline\paid`, commits `pipeline\paid` + `pipeline\collection`, publishes with the secrets `CF_API_TOKEN` + `CF_ACCOUNT_ID` (Mercy: install the workflow, add the secrets, run once)
- [ ] pipeline: photo collector lives in `pipeline\`, output → R2/KV (next step)
- [x] worker: `/data/paid/index`, `/data/paid/<section>` — worker v7 `servePublished` (Mercy: paste worker.js + Deploy)
- [ ] worker: `/data/mkphotos`, `/photos/mk/<file>` (or absolute URLs) — `/data/mkphotos` can reuse `servePublished`; the images need R2
- [ ] `_move-to-pipeline\` gone from `site\`; `site\data\` and `site\photos\` never come back — `data\paid` → `pipeline\paid`, `data\collection` + `inventory.txt` → `pipeline\collection` (Mercy moves them by hand); photos pending
- [ ] Mercy runs `publish-paid.bat`, then opens `budget_page\` → משרד החינוך → a contract with a "from the ministry's report" figure shows (`pipeline\audit\paidcheck.html` checks the same route); `mk_page\` faces pending
- [x] record the contract in `pipeline\CLAUDE.md` (done: "WHAT THIS ZONE HANDS TO THE OTHERS"); delete this file once the photo items are done too
