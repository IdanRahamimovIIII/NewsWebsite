# NOTES.md — the MK portraits job (pipeline\photos\)

Everything settled about collecting and publishing the Knesset members'
official photos. Same keep-it-current rule as CLAUDE.md.

## THIS FOLDER IS THE WHOLE JOB (Mercy, 2026-09-06)

| file | role |
|---|---|
| `get-photos.bat` → `fetch_photos.py` | collect: asks the Knesset API (through the relay) for each current member's portrait, saves `mk\<MkId>.jpg`, writes `mk\index.json` ({MkId: filename}) and `mk\misses.json` (members with no portrait — never re-asked). `--refresh` re-downloads, `--all` includes past members (~1,100, a 30-minute polite stroll). With Pillow installed, photos are shrunk to 512 px JPEG (~20 KB; the page shows 72 px). |
| `publish-photos.bat` → `publish_photos.py` | publish: KV `pub:mkphotos` (the manifest, in the relay's envelope) + `photo:mk/<MkId>-<hash8>.<ext>` (the bytes). Uploads only new/changed portraits, deletes names no longer in the manifest, reads everything back, asks the relay for the manifest and one face. |
| `test_photos.py` | the publisher against a fake KV: envelope, base64 round-trip, unchanged-not-reuploaded, changed-gets-new-name + old-deleted, refusals (missing file, a block page saved as .jpg), dropped-key detection. **All green 2026-09-06.** `python3 photos/test_photos.py` from `pipeline\`. |
| `mk\` | the images (gitignored — rebuildable from the Knesset in half an hour; KV is the durable copy) + `index.json` and `misses.json` (tracked). **1,093 members — every current and past MK the Knesset has a portrait for — ~27 MB, collected and published 2026-09-06.** |
| `ForMercy.txt` | Mercy's own two-line reminder of which .bat does what. |

## STATUS (Mercy, 2026-09-06) — DONE

- **Collected:** 1,093 portraits (120 current + 973 past), all JPEG, web
  size. The Knesset has no portrait at all for 9 members — genuine misses,
  both `MkImage` and `LobbyImage` empty — and they stay in `misses.json`
  so they are never re-asked: ids 312, 454, 513, 560, 573, 694, 762, 775,
  856. The page shows initials for them. (`--refresh` re-checks them if the
  Knesset ever adds a photo.)
- **Published:** KV namespace `b223eb8c…`, 1,093 `photo:mk/*` keys + the
  manifest, one 27.6 MB bulk write, every key read back byte for byte; the
  relay answered `/data/mkphotos` (1,093 members) and one face as
  `image/jpeg`. The MK page needs nothing — it already reads the manifest.
- **Nothing is scheduled.** The job is by hand: after each election run
  `get-photos.bat` (current members only — new faces get added; past
  members are already here), then `publish-photos.bat`. Every later
  publish is quick: unchanged portraits are neither re-uploaded nor
  re-verified.
- **Leftover to delete:** `pipeline\photos\photos\mk\` — a stale copy of
  the first 120 portraits from before the folder move (the scripts read
  and write `pipeline\photos\mk\`, the one beside them). Nothing points at
  it; it is 3 MB of confusion. Delete the whole `pipeline\photos\photos\`
  folder.

Outside this folder: `..\shared\cf_kv.py` (the Cloudflare client), `..\d1-config.json`
(credentials: the D1 token with "Workers KV Storage: Edit"), `..\..\site\config.js`
(the relay address, comments stripped before reading — the header carries an
EXAMPLE address). The worker side is `worker.js` `servePublished` + `servePhoto`;
the page side is `site\mk_page\mk.data.js` (`photoOf()`).

## THE CONTRACT WITH THE PAGE (site\mk_page\NOTES.md says the same)

- `GET <relay>/data/mkphotos` → `{t, data: {"<MkId>": "<filename>"}}`; a bare
  filename means `<relay>/photos/mk/<filename>`; no manifest (404) → initials
  avatars. The page NEVER guesses an image URL — no 404 spam either way.
- `GET <relay>/photos/mk/<MkId>-<hash8>.jpg` → the bytes, `image/jpeg`,
  `Cache-Control: public, max-age=31536000, immutable`. The name carries the
  first 8 hex chars of the file's md5, so the bytes behind a name never
  change: browsers cache a face for a year, and a refreshed portrait shows
  everywhere at once because the MANIFEST changes. Anything not shaped
  `<digits>-<8 hex>.<jpg|png|gif|webp>` is a 400 — the route cannot be used
  to read other KV keys.

## WHY KV AND NOT R2 (settled 2026-09-06)

120 files × ~20 KB today, ~22 MB if every past member is ever collected.
KV is already bound to the worker (`DATA`, namespace titled `DATA`), the
token already writes to it, `cf_kv.py` already exists — R2 would add a
bucket, a binding and a token permission for 3 MB of files. KV's 25 MB
per-value cap is irrelevant at 20 KB an image; edge caching (`cacheTtl`
one day on the read, immutable on the response) keeps KV reads near zero.
If the collection ever grows past what KV should hold (it will not — the
Knesset has had ~1,100 members ever), the manifest indirection means the
page does not change: only `publish_photos.py` and `servePhoto` do.

## LESSONS (from the collector, 2026-08-25)

- The photo URL comes from `MKs/GetMkdetailsHeader?mkId=N` → `MkImage`
  (Mercy's DevTools capture). `SpList/GetMKImages` checks Origin/Referer
  and answers literal `null` to anyone else — a 200 that lies.
- **Past members keep their portrait in `LobbyImage`, not `MkImage`**
  (found 2026-09-06). For anyone with `IsCurrentMk: false` the header
  answers `MkImage: null` and `LobbyImage: https://fs.knesset.gov.il/globaldocs/MK/<id>/…jpeg`
  — verified on id 2 (Rafael Edri, Knessets 10–14) and id 500 (Eliyahu
  Mazur, Knesset 1). The collector now tries MkImage, then LobbyImage.
  The 2026-08-25 `--all` run read only MkImage, so `misses.json` filled
  with 982 false "no photo" entries — and misses are never re-asked, so
  the false ones were permanent. Reset to `[]` with the fix. Rule for the
  future: before trusting a mass "no", look at one raw answer.
- Images are accepted by MAGIC BYTES, never extension: a block page saved
  as `.jpg` would poison the folder silently. Same rule in the publisher.
- Politeness: 0.8 s between members; misses remembered so re-runs never
  re-ask. Missing members are listed IN FULL at the end of a run (the
  no-partial-lists rule).
- config.js is read with its comments stripped first — the setup comment
  contains an example address, and a naive trailing-`//` stripper eats the
  `//` inside `https://` itself (that exact bug produced a mysterious 404).
