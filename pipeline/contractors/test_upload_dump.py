#!/usr/bin/env python3
r"""
test_upload_dump.py — the dump → reload round-trip, now that the public db
carries an FTS5 table. Proves (a) the FULL dump ships the virtual table and
skips its shadow tables, (b) the targeted only='ctr_' dump ships nothing
but the contractors tables, and (c) a reloaded copy answers MATCH — i.e.
the SQL we send D1 rebuilds a WORKING search index, not just row counts,
(d) the transient-failure triage retries D1-side wobbles only, and (e)
import_verified re-imports a part whose counts say it rolled back.

Run:  python3 contractors/test_upload_dump.py   (from pipeline\)
"""
import json, os, sqlite3, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))      # oldest fallback
sys.path.insert(0, os.path.join(ROOT, "database"))   # fallback (forwarders)
sys.path.insert(0, os.path.join(ROOT, "shared"))     # the real home
import build_sqlite            # noqa: E402
import upload_to_d1 as U       # noqa: E402
sys.path.insert(0, HERE)
import build_contractors       # noqa: E402

quiet = lambda *a, **k: None
npass = nfail = 0
def ok(name, cond, extra=""):
    global npass, nfail
    if cond:
        npass += 1; print("  ✔ " + name)
    else:
        nfail += 1; print("  ✘ " + name + ("  → %r" % (extra,) if extra != "" else ""))

FIX = {"contracts": [
    {"order_id": "A1", "supplier": "קייטרינג הדגל", "entity_id": "512000001",
     "ministry": "משרד החינוך", "purpose": "הזנה בגני ילדים",
     "method": "פטור ממכרז", "exemption": "תקנה 3(29)",
     "volume": 40e6, "paid": 30e6, "first_year": 2019, "last_year": 2026,
     "sources": ["bk"],
     "allocations": [{"budget_code": "0020600101", "volume": 40e6,
                      "paid": 30e6, "source": "bk"}],
     "reports": [{"year": "2024", "period": 4, "volume": 40e6,
                  "paid_cumulative": 18e6, "url": "https://x/a.xlsx"}]},
    {"order_id": "B1", "supplier": "הסעות הדרום", "entity_id": "512000002",
     "ministry": "משרד החינוך", "purpose": "הסעות תלמידים",
     "method": "מכרז פומבי", "volume": 30e6, "paid": 25e6,
     "first_year": 2020, "last_year": 2027, "sources": ["file"]},
]}

tmp = tempfile.mkdtemp(prefix="dump-test-")
cdir = os.path.join(tmp, "contracts"); os.makedirs(cdir)
with open(os.path.join(cdir, "0020.json"), "w", encoding="utf-8") as fh:
    json.dump(FIX, fh, ensure_ascii=False)
pub = os.path.join(tmp, "public.db")
build_sqlite.build(cdir, os.path.join(tmp, "full.db"), log=quiet)
build_sqlite.public_copy(os.path.join(tmp, "full.db"), pub, log=quiet)
build_contractors.build(pub, year_from=2019, log=quiet)


def reload_from(outdir):
    db = sqlite3.connect(":memory:")
    for part in sorted(n for n in os.listdir(outdir) if n.endswith(".sql")):
        with open(os.path.join(outdir, part), encoding="utf-8") as fh:
            db.executescript(fh.read())
    return db


print("full dump:")
full_out = os.path.join(tmp, "d1")
meta = U.dump(pub, full_out, log=quiet)
names = {t for p in meta["parts"] for t in p["counts"]}
ok("carries the big tables AND the ctr_ tables AND the fts",
   {"contracts", "strings", "ctr_years", "ctr_sup", "ctr_fts"} <= names, names)
ok("skips the fts SHADOW tables",
   not any(n.startswith("ctr_fts_") for n in names), names)
db2 = reload_from(full_out)
ok("reload: contracts intact",
   db2.execute("SELECT COUNT(*) FROM contracts").fetchone()[0] == 2)
ok("reload: the view answers",
   db2.execute("SELECT ministry FROM contracts_v WHERE order_id='A1'")
      .fetchone()[0] == "משרד החינוך")
ok("reload: MATCH works — the SQL rebuilds a WORKING search index",
   db2.execute("SELECT order_id FROM ctr_fts WHERE ctr_fts MATCH '\"הזנה\"'")
      .fetchone()[0] == "A1")
ok("reload: ctr_years intact",
   db2.execute("SELECT n FROM ctr_years WHERE year=2024").fetchone()[0] == 2)
db2.close()

print("targeted dump (only='ctr_'):")
ctr_out = os.path.join(tmp, "d1ctr")
meta2 = U.dump(pub, ctr_out, log=quiet, only="ctr_")
names2 = {t for p in meta2["parts"] for t in p["counts"]}
ok("ships ONLY ctr_ tables", names2 ==
   {"ctr_years", "ctr_top", "ctr_ex", "ctr_sup", "ctr_fts"}, names2)
db3 = reload_from(ctr_out)
ok("reload: search + profile there",
   db3.execute("SELECT COUNT(*) FROM ctr_sup").fetchone()[0] == 2 and
   db3.execute("SELECT order_id FROM ctr_fts WHERE ctr_fts MATCH '\"הסעות\"'")
      .fetchone()[0] == "B1")
sizes = sum(os.path.getsize(os.path.join(ctr_out, p["file"])) for p in meta2["parts"])
ok("targeted dump is small (no contract rows)", sizes < 100_000, sizes)
db3.close()

print("transient-failure triage (the 2026-09-09 storage-timeout lesson):")
ok("D1's storage-timeout death is RETRIED",
   U._transient("D1 DB storage operation exceeded timeout which caused "
                "object to be reset."))
ok("our own bad SQL / auth is NOT retried",
   not U._transient("near \"FROM\": syntax error at offset 12") and
   not U._transient("Authentication error [code: 10000]"))

print("a rolled-back import is re-imported (the 2026-09-10 lesson):")
# D1 reset mid-import, the poll answered "Not currently importing" (looks
# done), and the verify saw last month's live tables. import_verified must
# re-import instead of dying — the failed import rolled back, so it's safe.
_ip, _vf, _sl = U.import_part, U.verify, U.time.sleep
calls = {"import": 0, "verify": 0}
U.time.sleep = lambda s: None
U.import_part = lambda *a, **k: calls.__setitem__("import", calls["import"] + 1)
U.verify = lambda *a, **k: (calls.__setitem__("verify", calls["verify"] + 1)
                            or calls["verify"] >= 2)   # rolls back once
fakepart = {"file": "part-001.sql", "md5": "x", "counts": {}}
U.import_verified({}, tmp, fakepart, {}, log=quiet)
ok("one rollback → a second import, then verified done",
   calls == {"import": 2, "verify": 2}, calls)
U.verify = lambda *a, **k: False                       # never applies
calls["import"] = 0
try:
    U.import_verified({}, tmp, fakepart, {}, log=quiet, attempts=3)
    ok("persistent rollback dies loudly after 3 imports", False)
except SystemExit as e:
    ok("persistent rollback dies loudly after 3 imports",
       calls["import"] == 3 and "rolling this part back" in str(e), str(e))
U.import_part, U.verify, U.time.sleep = _ip, _vf, _sl

import shutil; shutil.rmtree(tmp, ignore_errors=True)
print("\n%d passed, %d failed" % (npass, nfail))
sys.exit(1 if nfail else 0)
