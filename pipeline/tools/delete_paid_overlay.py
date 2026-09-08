#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
delete_paid_overlay.py — ONE-SHOT: remove the paid overlay, everywhere.

The overlay (KV keys pub:paid/* + the code that wrote and read them) was a
bridge from 2026-08-22, when BudgetKey's ingest read the ministries' paid
column as zero. Since 2026-09-08 the budget page reads the contracts
database on D1 (/contracts), verified live — so the bridge comes down
(pipeline\\CLAUDE.md, section "TEMPORARY"; Mercy approved 2026-09-08).

What it does, after showing the plan and asking:
  1. deletes every KV key under pub:paid/ (the 52 sections + the index),
     then reads each one back to prove it is gone — never trusting status
     words (the D1 lesson of 2026-08-26)
  2. deletes the local files whose only purpose was the overlay:
       pipeline\\publish-paid.bat            the publisher's launcher
       pipeline\\tools\\publish_paid.py      the publisher
       pipeline\\tests\\test_publish.py      its tests
       pipeline\\audit\\paidcheck.html       the overlay's audit page
       pipeline\\audit\\check_paid.mjs       its test
         (fixtures-paid.json STAYS — cmp.mjs and cmp_audit.mjs still feed
          compare.html's ministry-file column from it)
       site\\config.js                       the OLD copy — config.js lives in
                                            site\\shared\\ since 2026-09-08
       site\\HANDOFF-cloudflare-data.md      checklist complete 2026-09-08

DELIBERATELY NOT deleted: pipeline\\paid\\. The original plan listed it,
but the documents earn their keep three ways that have nothing to do with
the overlay: the .full.json parsed beside them feed the DATABASE build,
parse_all.py merges into last month's documents so a report that became
unreachable keeps its figures, and inventory.py's never-shrink guard
counts them. The reason is written down in pipeline\\CLAUDE.md.

Afterwards: commit the deletions (they are tracked in git; the workflow
change was committed with this script) and run
setup\\install-workflows.bat if you have not already.

usage: delete_paid_overlay.py   (pipeline\\delete-paid-overlay.bat runs it)
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))          # pipeline\tools
PIPE = os.path.dirname(HERE)                               # pipeline
ROOT = os.path.dirname(PIPE)                               # NewsWebsite
sys.path.insert(0, os.path.join(PIPE, "shared"))
import cf_kv  # noqa: E402

CONFIG = os.path.join(PIPE, "d1-config.json")
PREFIX = "pub:paid/"

FILES = [
    os.path.join(PIPE, "publish-paid.bat"),
    os.path.join(PIPE, "tools", "publish_paid.py"),
    os.path.join(PIPE, "tests", "test_publish.py"),
    os.path.join(PIPE, "audit", "paidcheck.html"),
    os.path.join(PIPE, "audit", "check_paid.mjs"),
    os.path.join(ROOT, "site", "config.js"),
    os.path.join(ROOT, "site", "HANDOFF-cloudflare-data.md"),
]


def main():
    cred = cf_kv.credentials(CONFIG)
    if not cred:
        sys.exit("no Cloudflare credentials — expected %s (the same file the D1 upload uses)" % CONFIG)
    ns = cf_kv.namespace_id(cred)
    keys = cf_kv.list_keys(cred, ns, PREFIX)
    have = [f for f in FILES if os.path.exists(f)]

    print("THE PLAN")
    print("  Cloudflare KV: delete %d keys under %s" % (len(keys), PREFIX))
    for k in keys[:6]:
        print("    " + k)
    if len(keys) > 6:
        print("    … and %d more" % (len(keys) - 6))
    print("  files to delete:")
    for f in have:
        print("    " + os.path.relpath(f, ROOT))
    missing = [f for f in FILES if f not in have]
    for f in missing:
        print("  (already gone: %s)" % os.path.relpath(f, ROOT))
    if not keys and not have:
        print("nothing to do — the overlay is already gone.")
        return

    answer = input("\ntype YES to delete all of the above: ").strip()
    if answer != "YES":
        sys.exit("nothing was deleted.")

    if keys:
        cf_kv.bulk_delete(cred, ns, keys)
        # read each key back: gone means None, and KV can lag a moment
        still = []
        for k in keys:
            got = cf_kv.read_back(cred, ns, k)
            for _ in range(5):
                if got is None:
                    break
                time.sleep(2)
                got = cf_kv.read_back(cred, ns, k)
            if got is not None:
                still.append(k)
        if still:
            sys.exit("STILL IN KV after delete (try re-running): %s" % ", ".join(still[:5]))
        print("  KV: all %d keys deleted and read back as gone." % len(keys))
        relay = cf_kv.relay_url(PIPE)
        if relay:
            status, _, _ = cf_kv.relay_get(relay + "/data/paid/index")
            print("  relay answers /data/paid/index with HTTP %d%s" % (
                status, "" if status == 404 else
                " — the edge cache holds a copy for up to an hour; that is the cache, not a failure"))

    for f in have:
        os.remove(f)
        print("  deleted %s" % os.path.relpath(f, ROOT))

    print("\nDONE. Now commit the deletions (they are tracked in git),")
    print("and delete this script + its .bat — their job is over:")
    print("  pipeline\\tools\\delete_paid_overlay.py")
    print("  pipeline\\delete-paid-overlay.bat")


if __name__ == "__main__":
    main()
