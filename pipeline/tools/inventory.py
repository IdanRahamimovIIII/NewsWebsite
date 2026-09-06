#!/usr/bin/env python3
"""
inventory.py — what have we actually collected?

The combining step is off until collection is finished. This is how we tell
when that is: one page saying, per source, what is on disk and what is still
missing. No merging, no judgement about which source is right — counting only.

usage:
  inventory.py --reports reports --parsed site/data/paid --budgetkey build/raw
"""
import argparse, collections, json, os, re, sys


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

    # THE HOLE, stated. Reports we know exist and cannot download.
    miss_path = os.path.join(dirpath, "unreachable.json")
    if os.path.exists(miss_path):
        with open(miss_path, encoding="utf-8") as fh:
            missing = json.load(fh)
        out.append("")
        if not missing:
            out.append("  every report we found was reachable")
        else:
            out.append("  %d MORE REPORTS EXIST THAT WE CANNOT DOWNLOAD" % len(missing))
            out.append("  (the host refuses a server; a browser can still open them)")
            years = collections.Counter(m.get("year") or "?" for m in missing.values())
            out.append("    by year: %s" % ", ".join(
                "%s:%d" % (y, years[y]) for y in sorted(years)))
            who = collections.Counter(m.get("publisher") or "(none)"
                                      for m in missing.values())
            out.append("    worst affected:")
            for pub, n in who.most_common(10):
                out.append("      %-46s %d" % (pub[:46], n))
            got = len(files)
            out.append("    so we hold %d of %d known reports (%.0f%%)"
                       % (got, got + len(missing), 100.0 * got / (got + len(missing))))

    fail_path = os.path.join(dirpath, "failed.json")
    if os.path.exists(fail_path):
        with open(fail_path, encoding="utf-8") as fh:
            failed = json.load(fh)
        if failed:
            out.append("")
            out.append("  %d REPORTS FAILED TO DOWNLOAD" % len(failed))
            kinds = collections.Counter(f.get("error", "?").split(":")[0][:52]
                                        for f in failed.values())
            for k, n in kinds.most_common():
                out.append("    %5d  %s" % (n, k))
            who = collections.Counter(f.get("publisher") or "(none)"
                                      for f in failed.values())
            out.append("    worst affected:")
            for pub, n in who.most_common(8):
                out.append("      %-46s %d" % (pub[:46], n))

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


def totals(text):
    """(publishers, records) out of an inventory, new or previously written."""
    pub = re.search(r"^  (\d+) publishers:", text, re.M)
    rec = re.search(r"^  total\s+(\d+)\s", text, re.M)
    return (int(pub.group(1)) if pub else None,
            int(rec.group(1)) if rec else None)


def compare(previous, text, out):
    """Collection should only ever grow. A run that discovers less than the last
       one has usually lost its cache or half-failed a sweep — and the committed
       files would quietly shrink to a fraction with nothing saying so. Refuse.

       Growth is normal and silent; only a shrink is worth a line."""
    was_p, was_r = totals(previous)
    now_p, now_r = totals(text)
    if was_r is None or now_r is None:
        return True
    out.append("")
    out.append("AGAINST THE LAST RUN")
    out.append("  publishers %s -> %s" % (was_p, now_p))
    out.append("  records    %s -> %s" % (was_r, now_r))
    shrunk = (now_r < was_r) or (was_p is not None and now_p is not None and now_p < was_p)
    if shrunk:
        out.append("  ! THIS RUN FOUND LESS THAN THE LAST ONE.")
        out.append("  ! Most likely the report cache was evicted and only some")
        out.append("  ! years were re-collected. Not committing a smaller dataset.")
    return not shrunk


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default="reports")
    ap.add_argument("--parsed", default="site/data/paid")
    ap.add_argument("--budgetkey", default="build/raw")
    ap.add_argument("--out", help="also write this text to a file")
    ap.add_argument("--allow-shrink", action="store_true",
                    help="commit even if this run collected less than the last")
    a = ap.parse_args()

    previous = ""
    if a.out and os.path.exists(a.out):          # read BEFORE we overwrite it
        with open(a.out, encoding="utf-8") as fh:
            previous = fh.read()

    out = []
    reports(a.reports, out)
    parsed(a.parsed, out)
    budgetkey(a.budgetkey, out)
    text = "\n".join(out)
    grew = compare(previous, text, out) if previous else True
    text = "\n".join(out)
    print(text)
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    if not grew and not a.allow_shrink:
        sys.exit("collection shrank since the last run - stopping before commit")


if __name__ == "__main__":
    main()
