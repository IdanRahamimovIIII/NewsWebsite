# NOTES — mkcards (pipeline\mkcards\)

The `/data/mkcards` snapshot: one card of baked facts per MK since 2003
(everyone in the votes directory, K16 → today: ~504, ~150 of them current
Knesset). The pages worker renders `/mk/<id>-…/` from it; the MK page can
read the same counts instead of its live `$count`s.

| file | role |
|---|---|
| `build-mkcards.bat` → `build_mkcards.py` | collect via relay → build → gates → publish KV `pub:mkcards` + `pub:mkbills/<MkId>` (one per MK), read back, check the public relay. `--no-publish` builds `out\mkcards.json` only; `--limit N` dev slice (publishing refused) |
| `test_mkcards.py` | fake relay+world, every live trap armed; `python3 mkcards/test_mkcards.py` from `pipeline\` |

Uses `..\shared\cf_kv.py`, `..\d1-config.json` (local) / CF_API_TOKEN +
CF_ACCOUNT_ID (CI: `workflows\update-mkcards.yml`, monthly), relay URL from
`site\shared\config.js`. Pre-2003 (K1–15) is out: no MkIds in the votes
directory, and the MK page can't open them.

## Contract (consumers: pages Worker template; later `site\mk\`)
`pub:mkcards` → `/data/mkcards`, relay envelope `{t, data}`. data:
- `knesset` (latest) · `stats` {count, all, avgProposed, avgPassed — the
  "6 of 31" yardstick, current Knesset only} · `members` keyed by **MkId as
  string** (the `/mk/<id>` id). Current Knesset = `knessets` includes it.
- member: `id`, `pids` (OData PersonIDs, namesakes resolved), `he`/`en`
  (display names), `slugHe`/`slugEn` (URL tails: name, spaces→hyphens,
  quotes dropped), `photo` (file for `/photos/mk/<file>`, null = initials),
  `current` (serving now), `role` (heaviest open role of substance, "" ok;
  always "" outside the current Knesset — the register leaves rows open),
  `faction` (short form), `since`/`until` (years; until null while serving),
  `knessets` [ints], `bills` {proposed, passed} or null (null = hide the
  line, never "0"; counted FROM the bill list), `positions` (≤4 highlights: {role, y0, y1, k, now};
  `now` never true outside the current Knesset).

`pub:mkbills/<MkId>` → `/data/mkbills/<MkId>`, `{t, data:[{n name, s status
text ("" = unknown StatusID), k Knesset, b passed|rejected|pending|stale}]}`,
newest first, deduped by BillID — the page's loadBills list (lead + co-signed),
uncapped. Fetch failed → no count AND no list (never half). ~150k rows/run.

Consumers: worker `pages.js` (MK pages, `/mk/` list, `/mk/roster.txt`) ·
documented on site `api\` + llms files → a shape change updates them.
Register gap: K25 has NO committee-chair rows in KNS_PersonToPosition
(checked: רוטמן = MK + faction rows only) — chairs can't come from here.

## Rules
- Name/role/bill logic is PORTED from `site\mk\mk.data.js` (nameKey,
  looseMatch, roleRank, tidyPositions, billBucket, factionShort). Change the
  page's rule → change here + tests. Namesakes: the PersonID with rows in
  the Knessets THIS MkId served in wins (two אלי כהן, K16 vs K25).
- Builder-only second pass (the 8 misses since 2003): `norm_name` (hyphens,
  parentheses, all quote marks) → KNS_Person by LastName at every split,
  first name spaces-blind → `nickname_match` (רפאל~רפי: surname equal,
  first 2 letters) accepted only if exactly ONE has own-Knesset rows.
- Gates refuse to publish (full lists printed, never partial-as-complete):
  unresolved PersonID, one PersonID claimed by two MkIds (namesakes
  merged), missing English name, >5 bill-count failures, <120 members of
  the current Knesset, any `--limit` run.
- `$count` always filtered (the service refuses bare counts; the WAF 473s
  lambdas — navigation paths only). Pages cap at 100 rows whatever `$top`.

## Open
- Point the MK page's directory cards at the snapshot (frees ~300 live
  requests) — phase 4, with the entity-URL links.
