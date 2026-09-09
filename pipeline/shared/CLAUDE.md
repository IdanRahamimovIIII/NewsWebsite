# CLAUDE.md — the pipeline's core notes (pipeline\shared\)

**ALWAYS CONNECT THIS FOLDER** to any pipeline chat, plus the DATASET
folder the problem lives in (the map below says which). This file is the
part every pipeline chat needs; each dataset folder carries its own
NOTES.md with the deep story. `pipeline\CLAUDE.md` is just a pointer here.
(Split out of the one big pipeline\CLAUDE.md on 2026-09-08, at Mercy's
request — "organize everything by datasets": a folder with all the
relevant files to a dataset, plus this shared folder she always gives.)

## THE RULE THAT GOVERNS THESE FILES

Keep them honest and CURRENT. Whenever work in a chat proves a conclusion
wrong, outdated, or incomplete — update or delete it in the same chat, and
date the change. A wrong "conclusion" is worse than none. This is distilled
knowledge, not a log: once a story is settled, keep the conclusion and the
lesson, drop the play-by-play. (Full history in git.)

**Standing rules (Mercy's, non-negotiable):**

- **Nothing is frozen — "everything can be changed if needed" (Mercy,
  2026-09-05), superseding the old FROZEN rule.** What replaces it: a file the
  running workflows use changes TOGETHER with the workflow (same chat, same
  commit: edit `workflows\*.yml`, run `setup\install-workflows.bat`), and the change counts as done only
  after a green run. The old rule's origin still stands as a lesson —
  Origin-B drafts once touched pipeline files without the workflow following,
  and all were reverted.
- **Collect raw, keep sources separate.** The merge is a separate,
  re-runnable computation; raw is kept forever, so schema choices are
  reversible. No BudgetKey row ever stands in for a ministry file during
  COLLECTION — accepted last resort at MERGE time only, labelled, for
  reports gone from the whole internet.
- **The workflows' SOURCE is `pipeline\workflows\*.yml`** (since 2026-09-06 —
  Mercy: a pipeline chat must see what is in `.github`). `.github\workflows\`
  at the repo root is GitHub's required location and a generated COPY: the
  device bridge cannot write there, so `pipeline\setup\install-workflows.bat`
  copies changed files across (stripping a stray BOM). Edit the source → run
  the installer → commit BOTH → push → green run = done.
- refresh-data.yml's final `git push` fails if main moves during a run —
  push nothing while it runs. Workflows that commit nothing (all the
  collectors) can run anytime.

**How Mercy works (earned over many sessions):**

- She spots real problems fast and is usually right about the cause. When
  she says something is fundamentally wrong, stop patching and re-examine
  the model. Her questions found the ss:Index bug, the 3×-sum duplicate
  trap, and the full-reload waste; she rejected the static-shard workaround
  with "what is the correct way to do it?" — answer THAT question first,
  don't optimize for zero-cost cleverness.
- Never show a partial answer as if complete; a partial list is worse than
  a count, because the name someone is looking for is exactly the one cut.
- Verify against live data before claiming a fix (selftest.html for the
  site). WebFetch caches ~15 min — cache-bust with `?fresh=N`.
- Read-only probes only. An endpoint that MUTATES her data is never a probe.
- She runs .bat files happily, edits in Notepad, has NO node on PATH — keep
  setups zero-install and explain plainly. She is the product mind: present
  options, let her drive.
- Claude commits files via SendUserFile + device_commit_files (the bridge
  cannot DELETE — a removed file becomes a stub plus a cleanup .bat for
  Mercy to run). Her Chrome extension is NOT connected; she pastes logs
  and screenshots quickly. TODO.md tracks the roadmap. Claude CAN reach
  her public workers.dev relay for live schema probes (`/b64/<base64url>`;
  WebFetch URL ceiling ~248 chars — keep probe SQL tiny).

(The block above is the canonical text from the root CLAUDE.md, repeated
here because a zone session never sees the root — if it changes, change it
in all four places: root, `site\`, `worker\`, and THIS file.)

## THE MAP — organized BY DATASET (Mercy's ruling, 2026-09-08)

"Organize everything by datasets" — each dataset's folder holds ALL its
files (scripts, .bats, notes, inputs, outputs), like `photos\`. Connect
`shared\` + the ONE folder on the left; its NOTES.md is the deep story.

| the dataset / problem | connect | what lives there |
|---|---|---|
| THE CONTRACTORS DATASET — collection of the raw sources (ministry reports, BudgetKey, the registers), the raw ARCHIVE + automated monthly build (pipeline v2), the merge → build → D1 upload/verify, AND the page's precomputed tables + search | `contractors\` (+ `workflows\` when schedules/steps change) | fetch_* · parse_* · inventory.py · archive.py · pipeline2.py · build_dataset.py · build_database.py · build_contractors.py · upload_contractors.py · verify_d1.py · seven .bats · four tests · `inputs\` · `archive\manifest.json` · `out\contracts-public.db` · NOTES.md |
| THE MK PORTRAITS dataset | `photos\` | its own .bats, scripts, images, NOTES.md |
| CHECKING the built dataset (compare.html) | `audit\` | the whole audit kit + FIELDS.xlsx, NOTES.md |
| the GitHub automations | `workflows\` + `setup\` | the six .yml (THE SOURCE) + installer |
| the Cloudflare Worker's endpoints (SERVES the datasets) | the `worker\` zone (sibling of pipeline\) | worker.js + its CLAUDE.md |
| the website's pages | the `site\` zone | per-page folders + site\CLAUDE.md |

Cross-dataset folders that stay at the pipeline root: `paid\` + `collection\`
(the collection workflow's committed outputs — paid\ is the collection's
permanent memory and the never-shrink guard's baseline; no page reads it) ·
`tests\` (test_merge.py is run BY PATH by refresh-data.yml) · `build\` (the
rebuildable work area; `build\d1\` + `build\d1\ctr\` manifests/state are
the uploaders' memory — clean-up.bat spares them) · `d1-config.json`
(gitignored — Cloudflare ids + token).

**This folder (`shared\`) holds the code every dataset builds on** — which
is why connecting `shared\` + ONE dataset folder is enough, tests included:

- `cf_kv.py` — THE Cloudflare KV client (credentials, namespace by title,
  bulk put/delete, read-back verify). Every KV publisher imports it
  (photos\publish_photos.py today).
- `build_sqlite.py` — the database schema + builder (full db, public copy,
  dictionary encoding, contracts_v, delta). Imported by the contractors
  build and by the fixture-building tests of contractors\, audit\, worker\.
- `upload_to_d1.py` — the D1 dump/import/verify machinery behind both of
  the contractors dataset's uploads.

Legacy note (all 2026-09-08, one day, three steps): the database scripts
moved tools\→database\, then the by-DATASET ruling folded database\ into
contractors\ with `inputs\` + `out\` (apply-dataset-reorg.bat, run), and
finally the COLLECTION scripts moved tools\→contractors\ TOGETHER with
the four workflows' paths. Old paths in older notes mean the new places.
`tools\` still holds the old copies until the new workflows are installed
and GREEN — then `remove-tools-folder.bat` (one-shot) deletes it.

## WHAT THE PIPELINE HANDS TO THE OTHER ZONES (keep the other side in sync)

- **To the site, through Cloudflare (the site keeps NO data — Mercy's
  rule):** the D1 CONTRACTS DATABASE, served by the worker's `/contracts`
  family (v8, live 2026-09-08 — the paid overlay is deleted), and since
  2026-09-08 the CONTRACTORS PAGE tables (ctr_* + FTS) served by the
  worker's `/contractors/*` family (v9) — see `contractors\NOTES.md`.
- **To the MK page:** KV `pub:mkphotos` + `photo:mk/*` written by
  `photos\publish_photos.py`; worker serves `/data/mkphotos` +
  `/photos/mk/<file>` (immutable, hash-named). See `photos\NOTES.md`.
- **To the worker (D1):** tables `strings`, `allocations`, `reports`,
  `contracts` + view `contracts_v` + 10 indexes (uploaded by
  `contractors\upload-to-d1.bat`), plus `ctr_years/ctr_top/ctr_ex/ctr_sup`
  + `ctr_fts` (by `contractors\upload-to-d1-contractors.bat`). Column list =
  FIELDS.xlsx v2 as built by `build_sqlite.py --public`. Change a schema →
  tell `worker\CLAUDE.md`.
- **From the worker:** the relay's `/b64/<base64url>` path is how Claude
  probes BudgetKey live (URL ceiling ~248 chars; no DISTINCT over big
  tables; non-DISTINCT + LIMIT is instant).

## WHERE THE PIPELINE STANDS (2026-09-09)

DONE: collection runs monthly on its own (three collector workflows) and
every raw file lands in THE PERMANENT RAW ARCHIVE (pipeline v2 phase 1 —
live and self-feeding: 1,766 report files, 590 MB, 76 publishers); the
three-source merged database is built and uploaded to D1 (986,942
contracts); the worker serves it (v8) and the budget page reads it; the
contractors page's aggregates are precomputed and served (v9). All of it:
`contractors\NOTES.md`. The page itself still reads BudgetKey until its
swap session.

IN FLIGHT (2026-09-09): pipeline v2 PHASE 2 — build-and-update.yml, the
fully automatic archive→merge→build→D1 chain — is built, tested, and its
first full run (987,090 contracts) is running. On its green: uncomment its
schedule (same commit), then phase 3 retires paid\ + the manual monthly
loop. Old "item 5" is SUPERSEDED by this. Details + the first run's three
coded lessons: `contractors\NOTES.md`, PIPELINE v2 STATUS.

Also queued: the contractors front-end swap (a budget_page session — see
`contractors\NOTES.md`, WHAT COMES NEXT); browser last-mile for reports gone
from the whole internet; merge-time diff of the data.gov.il snapshot vs the
portal export (parse DD.MM.YYYY dates properly); report the BudgetKey
paid-column bug to הסדנא לידע ציבורי; worker v10 (bill ids in the vote
index — `worker\CLAUDE.md`); the deferred `git pull --rebase` hardening of
refresh-data's commit step.
