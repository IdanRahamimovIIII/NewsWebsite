# NOTES — MK portraits (pipeline\photos\)

This folder is the whole job. Done; nothing scheduled.

| file | role |
|---|---|
| `get-photos.bat` → `fetch_photos.py` | Knesset API via relay → `mk\<MkId>.jpg`, `mk\index.json` ({MkId: file}), `mk\misses.json` (never re-asked). `--refresh` re-downloads + rechecks misses; `--all` adds past members (~30 min). Pillow → 512 px JPEG (~20 KB) |
| `publish-photos.bat` → `publish_photos.py` | KV `pub:mkphotos` (manifest, relay envelope) + `photo:mk/<MkId>-<hash8>.<ext>`; uploads only new/changed, deletes dropped names, reads all back, checks the relay |
| `test_photos.py` | fake-KV tests; `python3 photos/test_photos.py` from `pipeline\` |
| `ForMercy.txt` | Mercy's own reminder of which .bat does what |
| `mk\` | images gitignored (KV = durable copy); index.json + misses.json tracked |

State: 1,093 portraits (120 current + 973 past), ~27 MB, all published and
read back. No portrait anywhere for ids 312, 454, 513, 560, 573, 694, 762,
775, 856 (page shows initials). After each election: get-photos.bat (current
only) → publish-photos.bat. KV is the durable copy; mk\ is rebuildable.

Uses `..\shared\cf_kv.py`, `..\d1-config.json` (token with Workers KV Storage:
Edit), `site\config.js` (relay URL). Page side: `site\mk_page\mk.data.js` `photoOf()`.

## Contract (routes: `worker\CLAUDE.md`)
- Manifest `{MkId: "<MkId>-<md5 8>.<ext>"}` → a new portrait = a new name,
  so files can be immutable. Page: no manifest → initials.
- KV not R2: ~1,100 members, ~20 KB each. Changing store touches only
  publish_photos.py + worker servePhoto.

## Lessons
- URL from `MKs/GetMkdetailsHeader?mkId=N` → `MkImage`; past members:
  `LobbyImage` (MkImage null). `SpList/GetMKImages` checks Origin/Referer and
  returns literal `null` — a 200 that lies. A mass "no photo" once came from
  reading only MkImage — look at one raw answer first.
- Accept images by MAGIC BYTES, never extension (collector + publisher).
- 0.8 s between members; list missing members IN FULL at run end.
- Strip config.js comments before reading (example address inside); a naive
  `//` stripper eats `https://`.
