# pipeline\workflows\ — SOURCE of the GitHub automations

Change procedure: `..\shared\CLAUDE.md`. Paths inside are repo-root relative.

| file | schedule | does | commits |
|---|---|---|---|
| `refresh-data.yml` | 1st 03:17 UTC + manual | refill cache from archive → fetch ministry reports (+wayback) → archive → parse → `pipeline/paid` → tests | `pipeline/paid`, `pipeline/collection`, archive manifest |
| `collect-portal-registers.yml` | 12th 04:43 UTC + manual | mr.gov.il export zips → JSON; dated zip to archive | no |
| `collect-budgetkey.yml` | 25th 03:37 UTC + manual | contract_spending per section; rotates budgetkey-latest/previous | no |
| `collect-publications.yml` | manual (source frozen 2021-01-31) | data.gov.il register history, ~180k | no |
| `bootstrap-archive.yml` | manual, done | reports cache → archive | manifest |
| `build-and-update.yml` | manual until first green (3rd-monthly schedule commented) | BUILD → UPLOAD (see contractors NOTES) | no |

Secrets: `CF_*` ×3 (API token with D1 + Workers KV Storage: Edit, account
id, D1 database id). Optional variable `RELAY_URL`. Collectors need
`permissions: contents: write` (release API).
