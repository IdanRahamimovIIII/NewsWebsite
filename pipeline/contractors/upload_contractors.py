#!/usr/bin/env python3
r"""
upload_contractors.py — send ONLY the contractors tables (ctr_* + the FTS
index) into the D1 database, without re-uploading the 1.3 GB of contract
rows D1 already holds. Run by contractors\upload-to-d1-contractors.bat after
build-contractors.bat.

It is the same REST machinery as the full uploader (shared\upload_to_d1.py
— init → PUT → ingest → poll → VERIFY BY ROW COUNTS; every lesson that code
carries applies here) with two differences:
  - the dump keeps only tables named ctr_* (DROP-then-CREATE per table, so a
    re-run replaces them cleanly and never touches the big tables);
  - its memory lives in build\d1\ctr\ (its own manifest + state), so it
    cannot confuse the full uploader's memory in build\d1\.

NOTE for a full re-upload day: nothing special to do — the full dump now
carries the ctr_* tables and the FTS index too (upload_to_d1.py learned
FTS5's shadow-table rule), so upload-to-d1.bat alone ships everything.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # pipeline\
sys.path.insert(0, os.path.join(ROOT, "tools"))      # oldest fallback
sys.path.insert(0, os.path.join(ROOT, "database"))   # fallback (forwarders)
sys.path.insert(0, os.path.join(ROOT, "shared"))     # the real home
import upload_to_d1 as U                          # noqa: E402

DB = U.DB                  # contractors\out\contracts-public.db (old home honoured)
OUT = os.path.join(ROOT, "build", "d1", "ctr")


def main():
    cfg = U.config()
    if not os.path.exists(DB):
        sys.exit("no contracts-public.db — run contractors\\build-database.bat, "
                 "then build-contractors.bat, then this.")

    man_path = os.path.join(OUT, "manifest.json")
    state_path = os.path.join(OUT, "state.json")
    meta = None
    if os.path.exists(man_path):
        with open(man_path) as fh:
            meta = json.load(fh)
        if meta.get("db_size") != os.path.getsize(DB) or \
           abs(meta.get("db_mtime", 0) - os.path.getmtime(DB)) > 1:
            meta = None                  # the database changed — fresh dump
    if meta is None:
        print("dumping the ctr_* tables…")
        meta = U.dump(DB, OUT, only="ctr_")
        if not meta["parts"] or not any(p["counts"] for p in meta["parts"]):
            sys.exit("the db has no ctr_* tables — run "
                     "contractors\\build-contractors.bat first.")
        with open(state_path, "w") as fh:
            json.dump({"done": []}, fh)
    state = {"done": []}
    if os.path.exists(state_path):
        with open(state_path) as fh:
            state = json.load(fh)

    parts = meta["parts"]
    print("uploading in %d parts, each verified by row counts:" % len(parts))
    for i, part in enumerate(parts):
        if part["file"] in state["done"]:
            print("  = %s already verified" % part["file"])
            continue
        print("  ▸ %s (%d of %d)" % (part["file"], i + 1, len(parts)))
        U.import_part(cfg, OUT, part, meta)
        if not U.verify(cfg, part, log=print):
            sys.exit("row counts do not match after %s — run this again "
                     "(verified parts are skipped); twice at the same part "
                     "= tell Claude, attach build\\d1\\ctr\\last-poll.json."
                     % part["file"])
        state["done"].append(part["file"])
        with open(state_path, "w") as fh:
            json.dump(state, fh)

    # the search index must actually SEARCH — a count alone would pass with
    # a broken FTS build. One MATCH through the API proves D1 runs it.
    print("\nproving the search index answers a real query…")
    j = U.api(cfg, "query", {"sql":
        "SELECT COUNT(*) AS n FROM ctr_fts WHERE ctr_fts MATCH '\"משרד\"'"},
        timeout=300, attempts=8, soft=True)
    try:
        n = j["result"][0]["results"][0]["n"]
        print("  ctr_fts MATCH works (%s hits for a common word)."
              % format(n, ","))
    except (KeyError, IndexError, TypeError):
        sys.exit("ctr_fts is there but MATCH failed — the answer was:\n%s\n"
                 "Tell Claude (this would mean D1 refused FTS5)."
                 % json.dumps(j)[:600])

    print("\nDONE — the contractors tables are live in D1. The worker's "
          "/contractors/* endpoints can serve them (add &fresh=1 on the "
          "first check — the edge cache holds answers for 6h).")


if __name__ == "__main__":
    main()
