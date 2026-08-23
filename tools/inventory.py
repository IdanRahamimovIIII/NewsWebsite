#!/usr/bin/env python3
"""
inventory.py — what have we actually collected?

The combining step is off until collection is finished. This is how we tell
when that is: one page saying, per source, what is on disk and what is still
missing. No merging, no judgement about which source is right — counting only.

usage:
  inventory.py --reports reports --parsed site/data/paid --budgetkey build/raw
"""
import argparse, collections, json, os


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.0f %s" % (n, unit) if unit != "GB" else "%.1f GB" % n
        n /= 1024.0


def reports(dirpath, out):
    out.append("MINISTRY REPORTS  (%s)" % dirpath)
    manifest_path = os.path.join(dirpath, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    if not os.path.isdir(dirpath):
        out.append("  nothing collected yet")
        return

    files = [f for f in sorted(os.listdir(dirpath)) if f.lower().endswith(".xlsx")]
    total = sum(os.path.getsize(os.path.join(dirpath, f)) for f in files)
    out.append("  %d files, %s on disk" % (len(files), human(total)))

    by_pub = collections.defaultdict(list)
    for meta in manifest.values():
        by_pub[meta.get("publisher") or "(no publisher recorded)"].append(
            (meta.get("year") or "?", meta.get("period") or "?"))
    out.append("  %d publishers:" % len(by_pub))
    for pub in sorted(by_pub):
        qs = sorted(set(by_pub[pub]))
        out.append("    %-46s %2d reports  %s" % (
            pub[:46], len(qs), ", ".join("%sQ%s" % q for q in qs)))

    on_disk = {m.get("file") for m in manifest.values()}
    orphans = [f for f in files if f not in on_disk]
    if orphans:
        out.append("  %d files on disk with no manifest entry (older runs):" % len(orphans))
        for f in orphans:
            out.append("    %s" % f)


def parsed(dirpath, out):
    out.append("")
    out.append("PARSED REPORTS  (%s)" % dirpath)
    if not os.path.isdir(dirpath):
        out.append("  nothing parsed yet")
        return
    rows = []
    for name in sorted(os.listdir(dirpath)):
        if not name.endswith(".full.json"):
            continue
        path = os.path.join(dirpath, name)
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        rows.append((name[:-10], len(doc.get("orders") or {}),
                     len(doc.get("sources") or []), os.path.getsize(path)))
    if not rows:
        out.append("  no .full.json files")
        return
    out.append("  %-8s %10s %9s %10s" % ("section", "records", "reports", "size"))
    for sec, n, srcs, size in rows:
        # raw_budget's four-digit sections all begin 00 (the rest of the tree is
        # the C… functional codes). Anything else here is a budget code in a
        # ministry's spreadsheet that is not in the national budget — real rows
        # under a code nobody can look up. Flag it; never quietly drop it.
        odd = "" if sec.startswith("00") else "   <- not a budget section"
        out.append("  %-8s %10d %9d %10s%s" % (sec, n, srcs, human(size), odd))
    out.append("  %-8s %10d %9s %10s" % ("total", sum(r[1] for r in rows), "",
                                         human(sum(r[3] for r in rows))))
    strange = [(s, n) for s, n, _, _ in rows if not s.startswith("00")]
    if strange:
        out.append("")
        out.append("  %d codes are not sections of the national budget: %s"
                   % (len(strange), ", ".join("%s (%d records)" % x for x in strange)))
        out.append("  These came from the ministries' own files. Not an error on")
        out.append("  our side and not to be discarded - but nobody can look them up.")


def budgetkey(dirpath, out):
    out.append("")
    out.append("BUDGETKEY  (%s)" % dirpath)
    if not os.path.isdir(dirpath):
        out.append("  nothing collected yet")
        return
    found = False
    for name in sorted(os.listdir(dirpath)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(dirpath, name)
        with open(path, encoding="utf-8") as fh:
            rows = json.load(fh)
        rows = rows.get("rows") if isinstance(rows, dict) else rows
        cols = len(rows[0]) if rows else 0
        out.append("  %-28s %9d rows  %3d columns  %10s"
                   % (name[:-5], len(rows), cols, human(os.path.getsize(path))))
        found = True
    if not found:
        out.append("  no .json files")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default="reports")
    ap.add_argument("--parsed", default="site/data/paid")
    ap.add_argument("--budgetkey", default="build/raw")
    ap.add_argument("--out", help="also write this text to a file")
    a = ap.parse_args()

    out = []
    reports(a.reports, out)
    parsed(a.parsed, out)
    budgetkey(a.budgetkey, out)
    text = "\n".join(out)
    print(text)
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")


if __name__ == "__main__":
    main()
