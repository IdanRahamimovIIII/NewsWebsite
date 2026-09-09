#!/usr/bin/env python3
r"""
test_pipeline2.py — phase 2's rules on fixtures, no network:

  1. the STREAMING merge produces byte-identical section files to
     build_dataset.build() — same rules, only where rows wait differs;
  2. string ids are STABLE across rebuilds when seeded from the baseline
     (old ids unchanged, new values appended) — the delta's precondition;
  3. the DELTA: emitted SQL parts, applied to a copy of the old db, turn it
     into EXACTLY the new db (order-hashes + strings agree), and the final
     part's counts are the new db's counts (what U.verify will demand);
  4. drifted string ids are refused loudly (never a silent wrong delta);
  5. materialize_reports extracts the NEWEST revision of each file and
     writes a parse_all-compatible manifest.

Run:  python3 contractors/test_pipeline2.py   (from pipeline\)
"""
import json, os, shutil, sqlite3, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "shared"))
sys.path.insert(0, HERE)
import archive as A            # noqa: E402
import build_dataset as BD     # noqa: E402
import build_sqlite as BS      # noqa: E402
import pipeline2 as P2         # noqa: E402
import upload_to_d1 as U       # noqa: E402

quiet = lambda *a, **k: None
npass = nfail = 0
def ok(name, cond, extra=""):
    global npass, nfail
    if cond:
        npass += 1; print("  ✔ " + name)
    else:
        nfail += 1; print("  ✘ " + name + ("  → %r" % (extra,) if extra != "" else ""))

tmp = tempfile.mkdtemp(prefix="p2-test-")
j = lambda *p: os.path.join(tmp, *p)

# ---- fixture sources: two ministries' .full.json + bk raw + a register ----
def write_full(path, orders):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"sources": ["https://gov.il/x.xlsx"], "orders": orders},
                  fh, ensure_ascii=False)

os.makedirs(j("full"))
write_full(j("full", "0020.full.json"), {
    "4500000001:0020600101": {"הזמנת רכש": "4500000001",
        "תקנה תקציבית": "20600101", "שם הספק": "קייטרינג הדגל",
        "מספר ח\"פ": "512000001", "ערך ההזמנה כולל מע\"מ": 1000000,
        "ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ": 400000,
        "מטרת התקשרות": "הזנה"},
    # an order whose live code sits in ANOTHER section than its bk rows
    "4500000002:0024000107": {"הזמנת רכש": "4500000002",
        "תקנה תקציבית": "24000107", "שם הספק": "הסעות הדרום",
        "מספר ח\"פ": "512000002", "ערך ההזמנה כולל מע\"מ": 500000,
        "ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ": 0,
        "מטרת התקשרות": "הסעות"}})
os.makedirs(j("raw"))
with open(j("raw", "0020.json"), "w", encoding="utf-8") as fh:
    json.dump([{"order_id": "4500000001", "budget_code": "0020600101",
                "supplier_name": "קייטרינג הדגל", "entity_id": "512000001",
                "entity_kind": "company", "purpose": "הזנה",
                "purchase_method": ["תקנה 1ב - מכרז פומבי רגיל"],
                "exemption_reason": [], "volume": 1000000.0, "executed": 0.0,
                "payments": [{"year": "2024", "period": "4", "executed": 0.0,
                              "volume": 1000000.0, "url": "https://f/a.xlsx"}],
                "tender_key": []},
               {"order_id": "4500000003", "budget_code": "0020600102",
                "supplier_name": "ספק שלישי", "entity_id": "512000003",
                "entity_kind": "company", "purpose": "ניקיון",
                "purchase_method": ["פטור ממכרז"],
                "exemption_reason": ["תקנה 3(1)"], "volume": 77000.0,
                "executed": 12000.0, "payments": [], "tender_key": []}],
              fh, ensure_ascii=False)
ex_path = j("mr-exemptions.json")
with open(ex_path, "w", encoding="utf-8") as fh:
    json.dump({"columns": ["מספר פרסום", "שם המשרד", "תקנה", "שם ספק",
                           "מספר חפ ספק", "היקף כספי"],
               "rows": [["651623", "משרד החינוך", "תקנה 3(1)",
                         "קייטרינג הדגל", "512000001", "990000"]]},
              fh, ensure_ascii=False)

print("1. streaming merge == in-memory merge:")
BD.build(j("full"), j("raw"), j("out-mem"), ex_path, None, log=quiet)
P2.stream_build(j("full"), j("raw"), j("out-stream"), ex_path, None, log=quiet)
same = sorted(os.listdir(j("out-mem"))) == sorted(os.listdir(j("out-stream")))
ok("same section files", same,
   (sorted(os.listdir(j("out-mem"))), sorted(os.listdir(j("out-stream")))))
for name in sorted(os.listdir(j("out-mem"))):
    if name == "index.json":
        a_ = json.load(open(j("out-mem", name)))
        b_ = json.load(open(j("out-stream", name)))
        ok("index.json agrees", a_ == b_, (a_, b_))
        continue
    a_ = json.load(open(j("out-mem", name), encoding="utf-8"))
    b_ = json.load(open(j("out-stream", name), encoding="utf-8"))
    ok("%s identical" % name, a_ == b_)

print("2. stable string ids across rebuilds:")
BS.build(j("out-mem"), j("v1-full.db"), log=quiet)
BS.public_copy(j("v1-full.db"), j("v1.db"), log=quiet)
v1 = dict(sqlite3.connect(j("v1.db")).execute("SELECT v, id FROM strings"))
# v2: a NEW ministry appears (new dictionary values) + one contract changes
write_full(j("full", "0030.full.json"), {
    "4500000009:0030100001": {"הזמנת רכש": "4500000009",
        "שם חברה": "משרד חדש לגמרי",     # a NEW dictionary value (ministry)
        "תקנה תקציבית": "30100001", "שם הספק": "ספק חדש לגמרי",
        "מספר ח\"פ": "512000009", "ערך ההזמנה כולל מע\"מ": 250000,
        "ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ": 100,
        "מטרת התקשרות": "אחזקה"}})
doc = json.load(open(j("full", "0020.full.json"), encoding="utf-8"))
doc["orders"]["4500000001:0020600101"]["ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ"] = 555000
write_full(j("full", "0020.full.json"), doc["orders"])
P2.stream_build(j("full"), j("raw"), j("out-v2"), ex_path, None, log=quiet)
BS.build(j("out-v2"), j("v2-full.db"), log=quiet)
BS.public_copy(j("v2-full.db"), j("v2.db"), log=quiet, strings_from=j("v1.db"))
v2 = dict(sqlite3.connect(j("v2.db")).execute("SELECT v, id FROM strings"))
ok("every v1 string keeps its id", all(v2.get(v) == i for v, i in v1.items()),
   {v: (i, v2.get(v)) for v, i in v1.items() if v2.get(v) != i})
ok("new strings appended with NEW ids",
   len(v2) > len(v1) and min(i for v, i in v2.items() if v not in v1) >
   max(v1.values()))

print("3. the delta turns old into new:")
delta = P2.diff_public(j("v1.db"), j("v2.db"), log=quiet)
ok("delta sees the change and the addition",
   "4500000001" in delta["changed"] and "4500000009" in delta["new"] and
   not delta["gone"], delta)
meta = P2.emit_delta_sql(j("v2.db"), delta, j("delta"), log=quiet)
shutil.copy(j("v1.db"), j("applied.db"))
adb = sqlite3.connect(j("applied.db"))
for part in meta["parts"]:
    adb.executescript(open(j("delta", part["file"]), encoding="utf-8").read())
adb.commit(); adb.close()
ha, hb = P2._order_hashes(j("applied.db")), P2._order_hashes(j("v2.db"))
ok("applied old db == new db (order hashes)", ha == hb,
   {k: (ha.get(k), hb.get(k)) for k in set(ha) | set(hb) if ha.get(k) != hb.get(k)})
sa = dict(sqlite3.connect(j("applied.db")).execute("SELECT id, v FROM strings"))
sb = dict(sqlite3.connect(j("v2.db")).execute("SELECT id, v FROM strings"))
ok("applied strings == new strings", sa == sb)
fin = meta["parts"][-1]["counts"]
ndb = sqlite3.connect(j("v2.db"))
ok("final part demands the NEW db's exact counts (what U.verify checks)",
   all(fin[t] == ndb.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
       for t in ("contracts", "allocations", "reports", "strings")), fin)

print("4. drifted string ids are refused:")
drift = sqlite3.connect(j("drift.db"))
sqlite3.connect(j("v2.db")).backup(drift)
drift.execute("UPDATE strings SET v = v || ' (drift)' WHERE id = (SELECT MIN(id) FROM strings)")
drift.commit(); drift.close()
try:
    P2.diff_public(j("v1.db"), j("drift.db"), log=quiet)
    ok("drift refused", False)
except SystemExit as e:
    ok("drift refused loudly", "STRING ID DRIFT" in str(e), str(e))

print("5. materialize_reports takes the newest revision:")
os.makedirs(j("bundles2"), exist_ok=True)
man_p = j("arch", "manifest.json")
os.makedirs(j("arch"))
def bundle_add(bundle, key, content):
    with zipfile.ZipFile(j("bundles2", bundle), "a") as z:
        z.writestr(key, content)
man = {"files": {
    "aaaa000000000001__edu_1_2025.xlsx": {"bundle": "reports-a.zip",
        "archived": "2026-08-01", "url": "https://g/edu.xlsx",
        "year": 2025, "period": 1, "publisher": "חינוך"},
    "bbbb000000000002__edu_1_2025.xlsx": {"bundle": "reports-b.zip",
        "archived": "2026-09-01", "url": "https://g/edu.xlsx",
        "year": 2025, "period": 1, "publisher": "חינוך"},   # the REVISION
    "cccc000000000003__health_3_2024.xls": {"bundle": "reports-c.zip",
        "archived": "2026-08-01", "url": "https://g/h.xls",
        "year": 2024, "period": 3, "publisher": "בריאות"}}}
json.dump(man, open(man_p, "w", encoding="utf-8"), ensure_ascii=False)
bundle_add("reports-a.zip", "aaaa000000000001__edu_1_2025.xlsx", b"OLD")
bundle_add("reports-b.zip", "bbbb000000000002__edu_1_2025.xlsx", b"NEW-FIXED")
bundle_add("reports-c.zip", "cccc000000000003__health_3_2024.xls", b"H")
n = P2.materialize_reports(man_p, j("mat"), rel=None,
                           bundle_dir=j("bundles2"), log=quiet)
ok("one file per NAME (newest revision), not per revision", n == 2)
ok("the newest revision's bytes won",
   open(j("mat", "edu_1_2025.xlsx"), "rb").read() == b"NEW-FIXED")
fm = json.load(open(j("mat", "manifest.json"), encoding="utf-8"))
ok("a parse_all-compatible manifest is written beside them",
   fm["https://g/edu.xlsx"]["file"] == "edu_1_2025.xlsx" and
   fm["https://g/edu.xlsx"]["year"] == 2025, fm)


print("6. restore-reports refills an evicted cache without clobbering:")
class _StubRel:
    def ensure(self): return self
    def download(self, name, out):
        src = os.path.join(tmp, "bundles2", name)
        if not os.path.exists(src): return False
        shutil.copy(src, out); return True
P2.ARC.Release = lambda: _StubRel()
P2.MANIFEST = man_p
cache = os.path.join(tmp, "cache"); os.makedirs(cache)
with open(os.path.join(cache, "edu_1_2025.xlsx"), "wb") as fh:
    fh.write(b"FRESH-FROM-THIS-RUN")        # the cache's own newer copy
with open(os.path.join(cache, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump({"https://g/edu.xlsx": {"file": "edu_1_2025.xlsx",
                                      "size": 19, "via": "cache"}}, fh)
n = P2.restore_reports(cache, log=quiet)
ok("only the MISSING file is restored", n == 1 and
   os.path.exists(os.path.join(cache, "health_3_2024.xls")))
ok("an existing cache file is never clobbered",
   open(os.path.join(cache, "edu_1_2025.xlsx"), "rb").read() == b"FRESH-FROM-THIS-RUN")
cm = json.load(open(os.path.join(cache, "manifest.json"), encoding="utf-8"))
ok("manifest merged, cache entries win + archive provenance added",
   cm["https://g/edu.xlsx"]["via"] == "cache" and
   cm["https://g/h.xls"]["file"] == "health_3_2024.xls" and
   cm["https://g/h.xls"]["size"] is not None, cm)

shutil.rmtree(tmp, ignore_errors=True)
print("\n%d passed, %d failed" % (npass, nfail))
sys.exit(1 if nfail else 0)
