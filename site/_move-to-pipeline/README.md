# _move-to-pipeline — not part of the site any more

Everything in this folder is DATA or a data COLLECTOR. Mercy's rule
(2026-09-06): the site folder holds page code only; every figure and image a
page shows comes from a public API or from Cloudflare. So this folder is
parked here only until Mercy moves it into `pipeline\` — nothing in `site\`
reads it.

What is here (after `cleanup-old-layout.bat` has run — it does the moving):

- `data\paid\` — the ministry-report overlay, one JSON per budget section +
  `index.json`. The budget page used to read these as `data/paid/*.json`; it
  now asks the relay for `/data/paid/index` and `/data/paid/<section>`.
- `data\collection\`, `data\inventory.txt` — collector output used by the
  audit pages in `pipeline\audit\`. No page reads them.
- `photos\mk\` — the MK portraits (`<MkId>.jpg`), `index.json`
  (`{MkId: filename}`) and `misses.json`. The MK page used to read these
  from its own folder; it now asks the relay for `/data/mkphotos` and
  `/photos/mk/<file>`.
- `get-photos.bat` + `fetch_photos.py` — the portrait collector. It writes
  `photos\mk\` next to itself, wherever it lives.

What the relay has to serve, exactly, is in `site\HANDOFF-cloudflare-data.md`.
