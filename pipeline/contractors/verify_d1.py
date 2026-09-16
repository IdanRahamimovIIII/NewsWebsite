#!/usr/bin/env python3
"""
verify_d1.py — prove the data in Cloudflare D1 MATCHES contracts-public.db,
not just that the row counts do. Run by double-clicking verify-d1.bat.

WHY: the upload was verified by row counts and by the
indexes/view existing — that proves the SHAPE. It cannot prove the
CONTENT: a corrupted value, mangled Hebrew, or a shifted column would
pass a count check invisibly. So this compares real rows, both sides:

  1. the whole `strings` table (it is small — every single row);
  2. for contracts / allocations / reports: SAMPLE_IDS random order_ids,
     ALL rows for each, EVERY column, local vs D1;
  3. `contracts_v` for a few sampled ids — the view computes correctly.

WHY SAMPLES AND NOT A FULL CHECKSUM: checksumming everything would scan
all ~5M rows remotely, which eats the D1 daily read allowance in one go.
Counts (already matched at upload) + full strings + deep random samples
give content confidence at ~200 cheap indexed queries instead.

Uses the same d1-config.json and API helper as the uploader.
"""
import json, os, random, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "shared"))
from upload_to_d1 import DB, OUT, api, config

SAMPLE_IDS = 40      # random order_ids checked per big table
VIEW_IDS = 8         # of those, how many are also checked through the view


def remote_rows(cfg, sql, params):
    j = api(cfg, "query", {"sql": sql, "params": params},
            timeout=300, attempts=5)
    if not j.get("success"):
        sys.exit("query failed: %s" % json.dumps(j)[:400])
    return j["result"][0]["results"]


def canon(v):
    """A sortable stand-in for any value, IDENTICAL for both sides.
       Two lessons from the first live run:
       - D1 answers in JSON, which turns REAL 819.0 into int 819, while
         local SQLite keeps the float — ints and floats must canonicalize
         to the SAME thing or every numeric column 'differs';
       - NULL and text in the same column across rows made sorted()
         crash — so the rank number makes any two values orderable."""
    if v is None:
        return (0, "")
    if isinstance(v, (int, float)):
        return (1, "%.12g" % v)
    return (2, v)


def same(a, b):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-9 * max(1.0, abs(a))
    return a == b


def compare_sets(name, cols, local, remote):
    """Order-independent: rows for one order_id have no defined order.
       Both sides are sorted by the same canonical key, then compared
       column by column on the RAW values."""
    if len(local) != len(remote):
        return "%s: %d rows locally, %d in D1" % (name, len(local), len(remote))
    key = lambda r: tuple(canon(r[c]) for c in cols)
    for lr, rr in zip(sorted(local, key=key), sorted(remote, key=key)):
        for c in cols:
            if not same(lr[c], rr[c]):
                return ("%s column %s: local %r != D1 %r"
                        % (name, c, lr[c], rr[c]))
    return None


def main():
    cfg = config()
    if not os.path.exists(DB):
        sys.exit("no contracts-public.db here — nothing to compare against.")
    man = os.path.join(OUT, "manifest.json")
    if os.path.exists(man):
        with open(man) as fh:
            meta = json.load(fh)
        if meta.get("db_size") != os.path.getsize(DB):
            print("WARNING: contracts-public.db changed since the upload —")
            print("mismatches below would mean 'D1 is stale', not 'corrupt'.")
            print()
    db = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    db.row_factory = sqlite3.Row
    bad = []

    print("1. strings — every row:")
    cols = [c[1] for c in db.execute("PRAGMA table_info(strings)")]
    local = [dict(r) for r in db.execute("SELECT * FROM strings")]
    remote, page = [], 0
    while True:
        chunk = remote_rows(cfg, "SELECT * FROM strings ORDER BY id "
                                 "LIMIT 1000 OFFSET ?", [page * 1000])
        remote += chunk
        page += 1
        if len(chunk) < 1000:
            break
    err = compare_sets("strings", cols, local, remote)
    print("   %s %d rows compared%s" % ("✘" if err else "✔", len(local),
                                        " — " + err if err else ""))
    if err:
        bad.append(err)

    ids = [r[0] for r in db.execute(
        "SELECT order_id FROM contracts ORDER BY random() LIMIT ?",
        (SAMPLE_IDS,))]
    for table in ("contracts", "allocations", "reports"):
        print("2. %s — all rows of %d random order_ids:" % (table, len(ids)))
        cols = [c[1] for c in db.execute("PRAGMA table_info(%s)" % table)]
        checked = worst = 0
        for oid in ids:
            local = [dict(r) for r in db.execute(
                "SELECT * FROM %s WHERE order_id = ?" % table, (oid,))]
            remote = remote_rows(cfg,
                "SELECT * FROM %s WHERE order_id = ?" % table, [oid])
            err = compare_sets("%s[%s]" % (table, oid), cols, local, remote)
            checked += len(local)
            if err:
                bad.append(err)
                worst += 1
        print("   %s %d rows compared, %d order_ids differ"
              % ("✘" if worst else "✔", checked, worst))

    print("3. contracts_v — the view, for %d of those ids:" % VIEW_IDS)
    cols = [c[1] for c in db.execute("PRAGMA table_info(contracts_v)")]
    worst = 0
    for oid in ids[:VIEW_IDS]:
        local = [dict(r) for r in db.execute(
            "SELECT * FROM contracts_v WHERE order_id = ?", (oid,))]
        remote = remote_rows(cfg,
            "SELECT * FROM contracts_v WHERE order_id = ?", [oid])
        err = compare_sets("contracts_v[%s]" % oid, cols, local, remote)
        if err:
            bad.append(err)
            worst += 1
    print("   %s %d ids checked through the view, %d differ"
          % ("✘" if worst else "✔", VIEW_IDS, worst))

    db.close()
    if bad:
        print("\nDIFFERENCES FOUND:")
        for b in bad[:20]:
            print("  ✘ " + b)
        sys.exit("\nD1 does not match the local database — tell Claude, "
                 "and paste the lines above.")
    print("\nALL CONTENT CHECKS PASSED — D1 matches contracts-public.db.")
    print("(different random ids are drawn each run; run it a few times "
          "for extra confidence)")


if __name__ == "__main__":
    main()
