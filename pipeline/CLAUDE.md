# CLAUDE.md — THE DATA PIPELINE (pipeline\)

This file is only a signpost since the 2026-09-08 by-DATASET reorg
(Mercy's scheme: "organize everything by datasets" — "if I need to change
something about the photos I will give you the photos folder … and a
shared folder that I will always give").

**The core notes live in `shared\CLAUDE.md`** — the standing rules, how
Mercy works, THE MAP of which folder to connect for which problem, the
zone interfaces, and where the pipeline stands. Read it first, always.

Each DATASET folder carries its own NOTES.md with the deep story:

- `contractors\NOTES.md`  — THE CONTRACTORS DATASET: collection of the
                            raw sources, the merged contracts database
                            (merge → build → D1), the page's precomputed
                            tables + search, with inputs\ and out\ inside
- `photos\NOTES.md`       — the MK portraits dataset
- `audit\NOTES.md`        — checking the built dataset (compare.html)
- `workflows\README.md`   — the six GitHub automations and their schedule

The sibling zones have their own CLAUDE.md: `site\` (the pages) and
`worker\` (the Cloudflare relay). The git history of THIS file holds the
pre-split pipeline story if it is ever needed.
