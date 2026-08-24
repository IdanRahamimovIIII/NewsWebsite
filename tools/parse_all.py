#!/usr/bin/env python3
"""
parse_all.py — parse every downloaded report, OLDEST FIRST.

WHY THE ORDER MATTERS
  parse_report.py merges each file into <section>.json, and a later write wins.
  The workflow used to loop `for f in reports/*.xlsx`, which is ALPHABETICAL:
  education_1_2025.xlsx sorts before education_2_2025.xlsx by luck, and
  health_1_2026.xlsx sorts before health_3_2024.xlsx by the same luck going the
  other way. The payment column is cumulative, so letting an older report land
  last quietly rolls a contract's paid figure BACKWARDS — a wrong number, not a
  missing one, and nothing in the output would say so.

  Sorting by the report's own (year, period) makes the newest report the last
  word, which is what "the newer report is the one to believe" actually means.

  It also passes --source-url, which the shell loop never did: without it the
  parsed file records no source and no vintage, so the comparison tool cannot
  tell a reader WHICH published report a number came from.

usage:
  parse_all.py --reports reports --out site/data/paid
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_report


def ordered(reports_dir, manifest_path, log=print):
    """[(path, url), …] oldest report first."""
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)

    by_file = {}
    for url, meta in manifest.items():
        name = meta.get("file")
        if name:
            by_file[name] = (url, meta)

    items = []
    for name in sorted(os.listdir(reports_dir)):
        # .xls too: ministries published in Excel's OLD format into ~2020
        # (משרד החוץ, תיאום הפעולות בשטחים among others), and the fetcher now
        # keeps those instead of rejecting them as block pages
        if not name.lower().endswith((".xlsx", ".xls")):
            continue
        url, meta = by_file.get(name, ("", {}))
        try:
            rank = (int(meta.get("year") or 0), int(meta.get("period") or 0))
        except (TypeError, ValueError):
            rank = (0, 0)
        if rank == (0, 0) and name in by_file:
            log("  ? %s has no year/period in the manifest — parsing it first" % name)
        items.append((rank, name, os.path.join(reports_dir, name), url))
    items.sort()                      # oldest first; unknown vintage before all
    return [(path, url, name, rank) for rank, name, path, url in items]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest")
    a = ap.parse_args()
    manifest = a.manifest or os.path.join(a.reports, "manifest.json")

    if not os.path.isdir(a.reports):
        sys.exit("no reports directory at %s" % a.reports)
    files = ordered(a.reports, manifest)
    if not files:
        sys.exit("no .xlsx reports to parse in %s" % a.reports)

    print("parsing %d reports, oldest first:" % len(files))
    for _, _, name, rank in files:
        print("  %s  %s" % (("%d Q%d" % rank) if rank != (0, 0) else "  ?    ", name))

    failed = 0
    for path, url, name, _ in files:
        print("-- %s" % name)
        try:
            parse_report.main(path, a.out, url)
        except SystemExit as e:       # find_cols raises this, with the headers
            failed += 1
            print("  parse failed: %s" % e)
        except Exception as e:
            failed += 1
            print("  parse failed: %s: %s" % (type(e).__name__, e))
    print("parsed %d, failed %d" % (len(files) - failed, failed))
    # a ministry we cannot parse is a hole in the data, not a warning to scroll
    # past — but one bad file must not stop the other 81
    return 0


if __name__ == "__main__":
    sys.exit(main())
