# NOTES — /api/ (agent data-access page)

Static docs page for AI agents + a bilingual human intro routing lost
visitors to the content pages. No JS, no strings files, not in the nav, not
in the bake — plain HTML edited directly. In sitemap.xml; linked from
llms.txt / llms-full.txt (site root — keep all three in sync with this page).

Documented surface (Mercy's ruling): /data/* snapshots (incl. /data/mkcards
+ the worker's /mk/roster.txt, both as real links — agents only open linked URLs), /contracts
/contract /supplier, /search/votes, /preset/*. NOT documented: /b64/
passthrough (invites third-party traffic through the worker), /contractors/*
(page not shipped), anything mutating. Changing a documented route in
worker.js → update this page + llms-full.txt (interface note in
worker\CLAUDE.md).

Base URL = api.ourmoneyil.com — the ONLY worker address ever written
anywhere: pages, docs, tests, notes (Mercy).
/search/votes docs carry the modern-rows caveat (src "m" → passed null,
0 counts); don't remove it while the index lacks modern outcomes.

## Open
- Response shapes verified live 2026-09-18 (verdicts, search/votes,
  contracts, preset/votes). /preset/votes returned rows outside the asked
  from/to range — upstream quirk, not re-checked; look before promising
  exact range semantics.
- When contractors ships: add /contractors/* here if Mercy approves.
