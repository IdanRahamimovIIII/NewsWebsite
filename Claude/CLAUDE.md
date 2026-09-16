# CLAUDE.md — NewsWebsite (always loaded: keep it GENERIC)

הכסף שלנו / Our Money: a Hebrew-first (RTL) + English site that makes the
Israeli state legible — money, laws, votes, courts, people. An explanation
machine, not a data dump: pique curiosity, hold no opinions, link the
state's own documents (never re-host them).

## Where knowledge lives — each fact in ONE file
This folder = rules for every chat. Nothing about a specific zone, page,
dataset or status goes here. Layers, read top-down, never repeat upward:

| work | connect | read |
|---|---|---|
| one page | `site\<name>_page\` + `site\shared\` | `site\shared\CLAUDE.md` → the page's `NOTES.md` |
| cross-page (nav, tokens, layout) | `site\` | `site\shared\CLAUDE.md` |
| data (collection, merge, D1, photos, audit, workflows) | `pipeline\shared\` + ONE dataset folder | `pipeline\shared\CLAUDE.md` → that folder's `NOTES.md` |
| the Cloudflare relay | `worker\` | `worker\CLAUDE.md` |

Interfaces between zones are written on both sides, one line each (the
detail lives with the side that owns the code). Change one → change both.
The roadmap lives in each notes file's "Open" section.

## Notes rules (every notes file)
- Distilled current knowledge, not a log: no dates on settled facts, no
  play-by-play, no version history (git has it). Wrong line → fix or delete
  in the same chat.
- KEEP FILES SMALL — tokens are Mercy's real constraint. New lesson ≤3
  lines. Before adding, check the higher layer doesn't already say it.
- Mercy's rulings are marked (Mercy); don't "improve" them without her.

## Standing rules (Mercy's)
- Nothing is frozen, but change a thing together with everything that runs
  it, and it's done only after a green run / live check.
- The site keeps NO data: pages read public APIs or Cloudflare via the relay.
- Never show a partial list as complete — show all, or give the count.
- Verify against live data before claiming a fix. Read-only probes only;
  never call a mutating endpoint.
- A 403 or a mass "no": check WHO refused and read one raw answer first.
- A test fixture must be no more generous than the real source (arm every
  trap the live data has), or the test is a rubber stamp.

## How Mercy works
- Usually right about the cause. "Fundamentally wrong" → stop patching,
  re-examine the model. Answer "what is the correct way?" first.
- Product mind: present options, she decides. Plain explanations.
- Windows, runs .bat files, edits in Notepad, NO node on PATH → zero-install.
- Chrome extension not connected: she pastes logs/screenshots, and does
  DevTools captures (F12 → Network → Copy as cURL) for bot-protected sites.

## Environment facts
- Claude writes via SendUserFile + device_commit_files. The bridge can't
  move/delete → ship a .bat that MOVES (never deletes) and says what it did.
- Claude runs node/Playwright in the cloud workspace
  (`/opt/pw-browsers/chromium`); the cloud can't reach gov APIs or
  workers.dev directly.
- Live probes: WebFetch on Mercy's relay `/b64/<base64url-of-upstream-url>`.
  URL ceiling ~248 chars (keep SQL tiny or add a worker preset). WebFetch
  caches ~15 min → add `?fresh=N`. Robots blocks WebFetch on
  next.obudget.org/api and data.gov.il/api; a WAF 403s SQL-looking relay URLs
  to WebFetch (the browser works). WebFetch mangles `?url=https%3A…`.
