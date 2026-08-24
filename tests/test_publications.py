#!/usr/bin/env python3
"""
test_publications.py — the Origin-B collector, with the network replaced by
fakes. Deliberately its OWN file: fetch_publications.py runs in its OWN
workflow (collect-publications.yml), separate from the monthly refresh, so
its tests must not touch — or depend on — anything that pipeline uses.

    python3 tests/test_publications.py
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import fetch_publications as PB

PASS = FAIL = 0

def ok(name, cond, info=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  ✔ " + name)
    else:
        FAIL += 1; print("  ✘ " + name + ("  → " + str(info) if info else ""))


print("\nthe register is pulled whole:")
REG_TOTAL = 25000
SERVER_PAGE = 7000                    # the server caps below what we ask for
REG = [{"_id": i, "תאריך פרסום": "20%02d-01-31" % (i % 21)}
       for i in range(REG_TOTAL)]
calls = []
def fake_ckan(resource, offset, limit=PB.PAGE, timeout=0):
    calls.append(offset)
    return REG[offset:offset + SERVER_PAGE], REG_TOTAL
PB.ckan, _real = fake_ckan, PB.ckan
with tempfile.TemporaryDirectory() as d:
    res, short = PB.run(d, {"exemptions": "res-1"}, log=lambda *a: None)
    with open(os.path.join(d, "exemptions.json"), encoding="utf-8") as fh:
        doc = json.load(fh)
ok("every record arrives even though the server pages below our ask",
   doc["records_fetched"] == REG_TOTAL, doc["records_fetched"])
ok("it pages by what actually came back, not by what was requested",
   calls == [0, 7000, 14000, 21000], calls)
ok("a complete pull is not flagged short", short == [], short)
ok("the newest publication date is measured, not remembered",
   doc["newest_publication"] == "2020-01-31", doc["newest_publication"])
ok("every field of every record is kept, untouched",
   doc["records"][3] == REG[3], doc["records"][3])

print("\nan incomplete pull must fail loudly:")
def short_ckan(resource, offset, limit=PB.PAGE, timeout=0):
    if offset >= 14000:
        return [], REG_TOTAL           # the server stops early
    return REG[offset:offset + SERVER_PAGE], REG_TOTAL
PB.ckan = short_ckan
with tempfile.TemporaryDirectory() as d:
    res, short = PB.run(d, {"exemptions": "res-1"}, log=lambda *a: None)
ok("a short pull is flagged, never silently kept as if complete",
   short == ["exemptions"], short)
ok("what WAS fetched is still written, labelled with both counts",
   res["exemptions"]["records_fetched"] == 14000
   and res["exemptions"]["total_reported"] == REG_TOTAL, res.get("exemptions"))

print("\none resource failing must not lose the other:")
def half_dead(resource, offset, limit=PB.PAGE, timeout=0):
    if resource == "res-dead":
        raise RuntimeError("datastore down")
    return REG[offset:offset + SERVER_PAGE], REG_TOTAL
PB.ckan = half_dead
with tempfile.TemporaryDirectory() as d:
    res, short = PB.run(d, {"exemptions": "res-1", "tenders": "res-dead"},
                        log=lambda *a: None)
ok("the live resource is collected in full",
   res.get("exemptions", {}).get("records_fetched") == REG_TOTAL, res.keys())
ok("the dead one is counted as short", "tenders" in short, short)

print("\na page boundary that repeats a row does not double it:")
def overlap_ckan(resource, offset, limit=PB.PAGE, timeout=0):
    if offset == 0:
        return REG[0:SERVER_PAGE], REG_TOTAL
    return REG[offset - 1:offset - 1 + SERVER_PAGE], REG_TOTAL  # one-row overlap
PB.ckan = overlap_ckan
rows, total = PB.fetch("exemptions", "res-1", log=lambda *a: None)
ok("exact _id repeats collapse to one",
   len(rows) == len({r["_id"] for r in rows}), len(rows))
PB.ckan = _real

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
