# NOTES — mkcards (pipeline\mkcards\)

The `/data/mkcards` snapshot: one card of baked facts per K25 MK — phase 1
of the entity-pages plan. The pages Worker (phase 2) renders `/mk/<id>-…/`
from it; the MK page can read the same counts instead of 151 live `$count`s.

| file | role |
|---|---|
| `build-mkcards.bat` → `build_mkcards.py` | collect via relay → build → gates → publish KV `pub:mkcards`, read back, check the public relay. `--no-publish` builds `out\mkcards.json` only; `--limit N` dev slice (publishing refused) |
| `test_mkcards.py` | fake relay+world, every live trap armed; `python3 mkcards/test_mkcards.py` from `pipeline\` |

Uses `..\shared\cf_kv.py`, `..\d1-config.json` (local) / CF_API_TOKEN +
CF_ACCOUNT_ID (CI: `workflows\update-mkcards.yml`, monthly), relay URL from
`site\shared\config.js`. Scope: K25's 151 (widen after live proof — plan).

## Contract (consumers: pages Worker template; later `site\mk\`)
`pub:mkcards` → `/data/mkcards`, relay envelope `{t, data}`. data:
- `knesset` (25) · `stats` {count, avgProposed, avgPassed — the "6 of 31"
  yardstick} · `members` keyed by **MkId as string** (the `/mk/<id>` id).
- member: `id`, `pids` (OData PersonIDs, namesakes resolved), `he`/`en`
  (display names), `slugHe`/`slugEn` (URL tails: name, spaces→hyphens,
  quotes dropped), `photo` (file for `/photos/mk/<file>`, null = initials),
  `current` (serving now), `role` (heaviest open role of substance, "" ok),
  `faction` (short form), `since`/`until` (years; until null while serving),
  `knessets` [ints], `bills` {proposed, passed} or null (null = hide the
  line, never "0"), `positions` (≤4 highlights: {role, y0, y1, k, now}).

## Rules
- Name/role/bill logic is PORTED from `site\mk\mk.data.js` (nameKey,
  looseMatch, namesakes-by-this-Knesset, roleRank, tidyPositions,
  billBucket, factionShort). Change the page's rule → change here + tests.
- Gates refuse to publish (full lists printed, never partial-as-complete):
  unresolved PersonID, missing English name, >5 bill-count failures,
  <120 members, any `--limit` run.
- `$count` always filtered (the service refuses bare counts; the WAF 473s
  lambdas — navigation paths only). Pages cap at 100 rows whatever `$top`.

## Open
- Live: 152 cards (120 serving). Monthly workflow installed — commit it +
  one green manual dispatch, then drop this line.
- Point the MK page's directory cards at the snapshot (frees ~300 live
  requests) — phase 4, with the entity-URL links.
