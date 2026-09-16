# pipeline\workflows\ — SOURCE of the GitHub automations

Change procedure: `..\shared\CLAUDE.md`. Paths inside are repo-root relative.

| file | schedule | does | commits |
|---|---|---|---|
| `refresh-data.yml` | 1st 03:17 UTC + manual | refill cache from archive → fetch ministry reports (+wayback) → archive → parse → `pipeline/paid` → tests | `pipeline/paid`, `pipeline/collection`, archive manifest |
| `collect-portal-registers.yml` | 12th 04:43 UTC + manual | mr.gov.il export zips → JSON; dated zip to archive | no |
| `collect-budgetkey.yml` | 25th 03:37 UTC + manual | contract_spending per section; rotates budgetkey-latest/previous | no |
| `build-and-update.yml` | 3rd 02:23 UTC + manual | BUILD → UPLOAD: archive → merge → dbs → D1 delta (count-verified) → rotate baseline (see contractors NOTES) | no |

Retired to `_old_delete_me\` (recoverable from git history):
`bootstrap-archive.yml` (one-time cache→archive bootstrap, done) and
`collect-publications.yml` (data.gov.il register frozen 2021-01-31; the
collected zip lives in `contractors\inputs\`, the script stays).

Secrets: `CF_*` ×3 (API token with D1 + Workers KV Storage: Edit, account
id, D1 database id). Optional variable `RELAY_URL`. Collectors need
`permissions: contents: write` (release API).
