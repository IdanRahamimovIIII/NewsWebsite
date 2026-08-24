#!/usr/bin/env python3
"""
test_fetch.py — the collection side, with the network replaced by fakes.

These are the two failures the first real run showed us, written down so they
cannot come back:
  1. discovery asked 2026,2025 and found education only — health and defence
     publish older reports and were invisible
  2. build_dataset ran with no BudgetKey source at all and reported success

    python3 tests/test_fetch.py
"""
import datetime, json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import fetch_reports as R
import fetch_budgetkey as K
import build_dataset as B

PASS = FAIL = 0

def ok(name, cond, info=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  ✔ " + name)
    else:
        FAIL += 1; print("  ✘ " + name + ("  → " + str(info) if info else ""))


# ------------------------------------------------- discovery asks once, widely

print("\ndiscovery (one query per section, every year at once):")
CALLS = []
def fake_bk(sql, rows=0):
    CALLS.append(sql)
    if "'0020'" in sql or "LIKE '0020%'" in sql:
        return [{"url": "https://www.gov.il/BlobFolder/x/education_1_2025/he/education_1_2025.xlsx",
                 "publisher": "משרד החינוך",
                 "year": "2025", "period": "1"}]
    if "LIKE '0024%'" in sql:
        return [{"url": "https://www.gov.il/BlobFolder/y/health_3_2024/he/health_3_2024.xlsx",
                 "publisher": "משרד הבריאות",
                 "year": "2024", "period": "3"}]
    return []

R.bk, _real_bk = fake_bk, R.bk
found = R.discover(["0020", "0024"], ["2026", "2025", "2024", "2023", "2022"], log=lambda *a: None)
ok("one query per section, not one per section-year", len(CALLS) == 2, len(CALLS))
ok("every year travels in the same query",
   "'2026', '2025', '2024', '2023', '2022'" in CALLS[0], CALLS[0][-90:])
ok("a 2024-only ministry is now visible", len(found) == 2, sorted(found))
R.bk = _real_bk


# ---------------------------------------------------------- newest per ministry

print("\nthe section list comes from the budget, not from guessing:")
def fake_budget(sql, rows=0):
    if "raw_budget" in sql and "year = 2026" in sql:
        return []                                   # not published yet
    if "raw_budget" in sql:
        return [{"code": "0020", "title": "משרד החינוך"},
                {"code": "0000", "title": "הכנסות המדינה"},   # not a spending section
                {"code": "C221", "title": "the functional tree"},
                {"code": "0024", "title": "משרד הבריאות"}]
    return []
R.bk, _rb = fake_budget, R.bk
secs = R.sections_from_budget(log=lambda *a: None, year=2026)
ok("it falls back a year when the newest is not published",
   set(secs) == {"0020", "0024"}, sorted(secs))
ok("0000 is excluded — it is revenue, not a spending section", "0000" not in secs)
ok("the C functional tree is excluded", not any(s.startswith("C") for s in secs))
ok("names come with the codes", secs["0020"] == "משרד החינוך", secs)
def dead(sql, rows=0):
    raise RuntimeError("budgetkey down")
R.bk = dead
fb = R.sections_from_budget(log=lambda *a: None, year=2026)
ok("if the list cannot be read we still sweep, not stop", len(fb) == 99, len(fb))
R.bk = _rb


print("\nnewest per ministry:")
best, blocked = R.newest_per_publisher({
    "https://www.gov.il/a/health_1_2023/f.xlsx": {"publisher": "בריאות", "year": "2023", "period": "1"},
    "https://www.gov.il/a/health_3_2024/f.xlsx": {"publisher": "בריאות", "year": "2024", "period": "3"},
    "https://foi.gov.il/old.xlsx": {"publisher": "רק-חסום", "year": "2025", "period": "2"},
}, log=lambda *a: None)
ok("the later quarter wins", list(best)[0].endswith("health_3_2024/f.xlsx"), list(best))
ok("a ministry only on the blocked host is reported, not silently dropped",
   "רק-חסום" in blocked, blocked)


# ------------------------------------------------- probing past BudgetKey's lag

print("\nprobing for a quarter newer than BudgetKey knows:")
ok("Q4 rolls into Q1 of the next year", R.next_quarter(2025, 4) == (2026, 1))
ok("Q1 becomes Q2", R.next_quarter(2025, 1) == (2025, 2))
URL = "https://www.gov.il/BlobFolder/x/education_1_2025/he/education_1_2025.xlsx"
ok("both copies of the name are swapped",
   R.bump_url(URL, 2025, 1, 2025, 3) ==
   "https://www.gov.il/BlobFolder/x/education_3_2025/he/education_3_2025.xlsx")
ok("a url that does not carry the pattern is left alone",
   R.bump_url("https://foi.gov.il/דוח.xlsx", 2025, 1, 2025, 3) is None)

PUBLISHED = {"education_2_2025", "education_3_2025"}   # Q4 and later do not exist
def fake_head(u, timeout=60):
    return 663714 if any(s in u for s in PUBLISHED) else None
R.head, _real_head = fake_head, R.head
ahead = R.probe_forward(URL, {"publisher": "חינוך", "year": "2025", "period": "1"},
                        log=lambda *a: None, today=datetime.date(2026, 8, 23))
ok("EVERY newer quarter is collected, not just the newest",
   len(ahead) == 2, sorted(ahead))
ok("Q2 is one of them", any("education_2_2025" in u for u in ahead), sorted(ahead))
ok("Q3 is the other", any("education_3_2025" in u for u in ahead), sorted(ahead))
u2 = [u for u in ahead if "education_3_2025" in u][0]
ok("and the metadata says so",
   (ahead[u2]["year"], ahead[u2]["period"]) == ("2025", "3"), ahead[u2])
ok("the file name follows the url",
   R.filename_for(u2, ahead[u2]) == "education_3_2025.xlsx",
   R.filename_for(u2, ahead[u2]))

def block_page(u, timeout=60):
    return 5682                                        # gov.il's 403 wall
R.head = block_page
ok("a 5,682-byte block page is not mistaken for a report",
   R.probe_forward(URL, {"publisher": "x", "year": "2025", "period": "1"},
                   log=lambda *a: None, today=datetime.date(2026, 8, 23)) == {})
R.head = _real_head


# ------------------------------------------------------ paging the budget tree

print("\nthe catalogue walk, with BudgetKey unplugged:")
PUBLISHED_Q = {"education_%d_%d" % (p, y)
               for y, p in [(2023, 3), (2023, 4), (2024, 1), (2024, 2), (2024, 3),
                            (2024, 4), (2025, 1), (2025, 2)]}
SEED = "https://www.gov.il/BlobFolder/x/education_1_2025/he/education_1_2025.xlsx"
def no_network(*a, **k):
    raise AssertionError("the catalogue path must never call BudgetKey")
_bk = R.bk
R.bk = no_network
R.head = lambda u, timeout=60: 663714 if any(s in u for s in PUBLISHED_Q) else None
walked = R.walk_quarters(SEED, "2025", "1", log=lambda *a: None,
                         today=datetime.date(2026, 8, 23))
ok("it walks backward into the archive as well as forward",
   len(walked) == len(PUBLISHED_Q), sorted(os.path.basename(u) for u in walked))
ok("the seed quarter itself is included", SEED in walked)
ok("it reaches the oldest published quarter",
   any("education_3_2023" in u for u in walked))
ok("it stops where publishing stops",
   not any("education_3_2025" in u for u in walked))
cat = R.from_catalogue([{"publisher": "חינוך", "url": SEED,
                         "year": "2025", "period": "1"}],
                       log=lambda *a: None, today=datetime.date(2026, 8, 23))
ok("every walked report carries its ministry",
   all(m["publisher"] == "חינוך" for m in cat.values()), len(cat))
R.bk = _bk
R.head = _real_head


print("\ncollection keeps every report, not one per ministry:")
FOUND = {
    "https://www.gov.il/BlobFolder/a/education_1_2025/f.xlsx":
        {"publisher": "חינוך", "year": "2025", "period": "1"},
    "https://www.gov.il/BlobFolder/a/education_2_2025/f.xlsx":
        {"publisher": "חינוך", "year": "2025", "period": "2"},
    "https://foi.gov.il/דוח-ישן.xlsx":
        {"publisher": "רק-חסום", "year": "2019", "period": "1"},
}
_d, _h, _dl = R.discover, R.head, R.download
R.discover = lambda *a, **k: dict(FOUND)
R.head = lambda u, timeout=60: 700000 if u in FOUND else None
grabbed = []
def fake_download(u, p, timeout=300):
    grabbed.append(os.path.basename(p))
    return 700000, p
R.download = fake_download
with tempfile.TemporaryDirectory() as d:
    res = R.run(d, os.path.join(d, "m.json"), ["0020"], ["2025"], log=lambda *a: None)
ok("both quarters of the same ministry are kept", len(grabbed) == 2, grabbed)
ok("the older quarter is not discarded for the newer",
   any("education_1_2025" in g for g in grabbed), grabbed)
ok("a url on the blocked host is not attempted",
   not any("ישן" in g for g in grabbed), grabbed)
ok("the unreachable ministry is still reported", "רק-חסום" in res["blocked"], res)
R.discover, R.head, R.download = _d, _h, _dl


print("\npaging contract_spending by budget code:")
# 0020 holds 1,500 rows: more than one page, so it must split
SERVER_CAP = 800                               # the API will not exceed this
UNIVERSE = {"002010%04d" % i: i for i in range(1500)}
SEEN = []

def fake_k(sql, rows=K.PAGE, timeout=0):
    SEEN.append(sql)
    if sql.startswith("SELECT * FROM"):
        row = {c: None for c in K.WANT}
        row["some_column_nobody_asked_for"] = None      # collect it anyway
        row["volume_per_year"] = None                   # except this one
        return [row]
    if "LIKE '" in sql:
        prefix = sql.split("LIKE '")[1].split("%")[0]
        hits = sorted(k for k in UNIVERSE if k.startswith(prefix))
    else:                                      # the exact-code query at a split
        code = sql.split("budget_code = '")[1].split("'")[0]
        hits = sorted(k for k in UNIVERSE if k == code)
    if sql.startswith("SELECT count("):
        return [{"n": len(hits)}]
    out = [{"order_id": "45%08d" % UNIVERSE[h], "budget_code": h} for h in hits]
    if "order_id IS NULL" in sql:
        return []
    if "(order_id, budget_code) > (" in sql:
        cursor = tuple(sql.split("(order_id, budget_code) > ('")[1]
                       .split("')")[0].split("', '"))
        out = [r for r in out if (r["order_id"], r["budget_code"]) > cursor]
    out.sort(key=lambda r: (r["order_id"], r["budget_code"]))
    return out[:min(rows, SERVER_CAP)]

K.bk, _real_k = fake_k, K.bk
K.CAP[0] = None
cols, missing = K.columns(log=lambda *a: None)
ok("every column the merge reads exists in the table", missing == [], missing)
ok("a column no one has asked for yet is collected anyway",
   "some_column_nobody_asked_for" in cols)
ok("the computed averages are the one thing left behind (rule 7)",
   not any(c in K.NEVER_READ for c in cols))
rows, stats = [], {"queries": 0}
SEEN.clear()
K.by_code("0020", cols, rows, stats, log=lambda *a: None)
got = {r["budget_code"] for r in rows}
ok("a bucket bigger than the cap comes back whole", len(got) == 1500, len(got))
ok("no row is read twice", len(rows) == 1500, len(rows))
ok("it counts before it fetches",
   SEEN[0].startswith("SELECT count("), SEEN[0][:40])
ok("it learns the real ceiling instead of guessing", K.CAP[0] == SERVER_CAP, K.CAP[0])
ok("it pages in order rather than descending the code tree",
   not any("LIKE '00200%'" in s for s in SEEN))
ok("the whole walk stays cheap", stats["queries"] <= 6, stats["queries"])
K.bk = _real_k
K.CAP[0] = None


# ------------------------------------- a build with no second source is a failure

print("\na one-sided merge must not pass as a build:")
with tempfile.TemporaryDirectory() as d:
    fdir = os.path.join(d, "paid"); os.makedirs(fdir)
    with open(os.path.join(fdir, "0020.full.json"), "w", encoding="utf-8") as fh:
        json.dump({"orders": {"4502539235:0020670205": {
            "הזמנת רכש": "4502539235",
            "תקנה תקציבית": "20670205",
            "שם הספק": "מילגם",
            "מספר ח\"פ": "510982325"}}}, fh)      # a field only the file has
    only_file = B.build(fdir, None, os.path.join(d, "o1"))
    ok("with no BudgetKey file at all, nothing claims a bk source",
       not any("bk" in (c.get("sources") or []) for c in only_file))
    bkp = os.path.join(d, "bk.json")
    with open(bkp, "w", encoding="utf-8") as fh:
        json.dump([{"order_id": "4502539235", "budget_code": "0020670205",
                    "entity_name": "מילגם בע\"מ",
                    "entity_kind": "company", "payments": []}], fh)
    both = B.build(fdir, bkp, os.path.join(d, "o2"))
    ok("with one, the BudgetKey-only field arrives",
       both[0]["entity_kind"] == "company", both[0].get("entity_kind"))
    ok("and the contract records both sources",
       set(both[0]["sources"]) == {"bk", "file"}, both[0]["sources"])

print("\nurls the ministries actually use (the 1,190-failure bug):")
REAL = [
    "https://www.gov.il/BlobFolder/dynamiccollectorresultitem/health_1/he/רבעון 4 - 2020.xlsx",
    "https://www.gov.il/BlobFolder/dynamiccollectorresultitem/answer1_140/he/"
    "הסנגוריה הציבורית - תשלום בפועל רבעון 1 לשנת 2018 - לפרסום (3).xlsx",
    "https://www.gov.il/BlobFolder/dynamiccollectorresultitem/justice0242/he/"
    "‏‏הסיוע המשפטי - תשלום בממשקים לעורכי הדין ברבעון 2 לשנת 2024.xlsx",
]
enc = [R.encode_url(u) for u in REAL]
ok("a hebrew filename with spaces becomes ascii", all(e.isascii() for e in enc))
ok("no spaces survive", not any(" " in e for e in enc))
ok("invisible RTL marks are encoded",
   "‏" not in enc[2] and "%E2%80%8F" in enc[2], enc[2][:80])
ok("encoding twice changes nothing",
   all(R.encode_url(e) == e for e in enc))
PLAIN = "https://www.gov.il/BlobFolder/x/education_1_2025/he/education_1_2025.xlsx"
ok("an already-plain url is left exactly alone", R.encode_url(PLAIN) == PLAIN)
import urllib.request as _ur
try:
    for e in enc:
        _ur.Request(e)
    made = True
except Exception:
    made = False
ok("urllib will accept every one of them", made)



print("\nthe bytes decide what a file is (the 16 rejected .xls reports):")
PK   = b"PK\x03\x04" + b"\0" * 6000
OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 6000
HTML = b"<!DOCTYPE html><html>" + b" " * 6000
ok("a PK header is an xlsx", R.classify(PK) == "xlsx")
ok("an OLE2 header is an xls — a real report, not a block page",
   R.classify(OLE2) == "xls")
ok("HTML is neither", R.classify(HTML) is None)
ok("a tiny file is rejected whatever its header", R.classify(b"PK") is None)
with tempfile.TemporaryDirectory() as d:
    n, path = R._save(OLE2, os.path.join(d, "report.xlsx"))
    ok("an OLE2 file is saved with an .xls name, not a lying .xlsx",
       path.endswith("report.xls"), path)
    ok("and it is really on disk", os.path.getsize(path) == len(OLE2))
    try:
        R._save(HTML, os.path.join(d, "wall.xlsx"))
        rejected = None
    except Exception as e:
        rejected = str(e)
    ok("a block page is rejected AND the error shows the actual bytes",
       rejected and "DOCTYPE" in rejected, rejected)

print("\nthe wayback fallback:")
HEB = "https://foi.gov.il/sites/default/files/\u05e8\u05d1\u05e2\u05d5\u05df 4 - 2020.xlsx"
w = R.wayback_url(HEB)
ok("the wayback url wraps the ENCODED original",
   w.startswith("https://web.archive.org/web/2id_/https://foi.gov.il/") and " " not in w, w)

FOUND_WB = {
    "https://www.gov.il/BlobFolder/a/dead_1_2019/f.xlsx":
        {"publisher": "\u05d7\u05d5\u05e5", "year": "2019", "period": "1"},
    "https://foi.gov.il/sites/default/files/old.xlsx":
        {"publisher": "\u05e8\u05d5\u05d4\u05f4\u05de", "year": "2016", "period": "2", "wayback_only": True},
    "https://www.gov.il/BlobFolder/a/alive_2_2019/f.xlsx":
        {"publisher": "\u05d7\u05d5\u05e5", "year": "2019", "period": "2"},
}
_d2, _h2, _w2 = R.download, R.head, R.wayback_fetch
direct_tried, wb_tried = [], []
def dl2(u, p, timeout=300):
    direct_tried.append(u)
    if "dead" in u:
        raise RuntimeError("HTTP Error 404: Not Found")
    return 700000, p
def wb2(u, p, timeout=120):
    wb_tried.append(u)
    if "old.xlsx" in u:
        return 600000, p[:-1], "20180101000000"      # becomes .xls
    raise RuntimeError("no snapshot")
R.download, R.head, R.wayback_fetch = dl2, (lambda u, timeout=60: None), wb2
with tempfile.TemporaryDirectory() as d:
    man = {}
    res = R._download_all(dict(FOUND_WB), {}, d, man, os.path.join(d, "m.json"),
                          None, lambda *a: None, wayback=True)
ok("a url the host refuses outright is never tried directly",
   not any("foi.gov.il" in u for u in direct_tried), direct_tried)
ok("both it and the dead url go through the archive", len(wb_tried) == 2, wb_tried)
recovered = man.get("https://foi.gov.il/sites/default/files/old.xlsx") or {}
ok("a recovered file is stamped via=wayback — an archived number must say so",
   recovered.get("via") == "wayback" and recovered.get("snapshot") == "20180101000000",
   recovered)
ok("the failure that even wayback missed records BOTH errors",
   res["failed"] == 1, res)
R.download, R.head, R.wayback_fetch = _d2, _h2, _w2

print("\na dead twin of a report we hold is noise, not a hole:")
FOUND_TWIN = {
    "https://www.gov.il/old-host/finance_3_2018/f.xlsx":
        {"publisher": "\u05d0\u05d5\u05e6\u05e8", "year": "2018", "period": "3"},
    "https://www.gov.il/new-host/finance_3_2018/f.xlsx":
        {"publisher": "\u05d0\u05d5\u05e6\u05e8", "year": "2018", "period": "3"},
}
def dl3(u, p, timeout=300):
    if "old-host" in u:
        raise RuntimeError("HTTP Error 404: Not Found")
    return 700000, p
R.download, R.head = dl3, (lambda u, timeout=60: None)
with tempfile.TemporaryDirectory() as d:
    man = {}
    res = R._download_all(dict(FOUND_TWIN), {}, d, man, os.path.join(d, "m.json"),
                          None, lambda *a: None, wayback=False)
    with open(os.path.join(d, "failed.json"), encoding="utf-8") as fh:
        fj = json.load(fh)
ok("the dead twin is marked covered_by the file that downloaded",
   list(fj.values())[0].get("covered_by", "").startswith("finance_3_2018"),
   fj)
ok("and the run counts it", res.get("covered") == 1, res)
R.download, R.head = _d2, _h2

print("\nan archived snapshot is final — never fetched twice:")
def dl4(u, p, timeout=300):
    raise AssertionError("a wayback-sourced file must not be re-downloaded")
R.download = dl4
R.head = lambda u, timeout=60: None
R.wayback_fetch = dl4
with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, "old.xls"), "wb") as fh:
        fh.write(b"\xd0\xcf\x11\xe0" + b"\0" * 6000)
    man = {"https://foi.gov.il/x/old.xlsx":
           {"file": "old.xls", "bytes": 6004, "publisher": "x",
            "year": "2016", "period": "2", "via": "wayback", "snapshot": "2018"}}
    res = R._download_all(
        {"https://foi.gov.il/x/old.xlsx":
         {"publisher": "x", "year": "2016", "period": "2", "wayback_only": True}},
        {}, d, man, os.path.join(d, "m.json"), None, lambda *a: None, wayback=True)
ok("it is skipped as unchanged", res["skipped"] == 1 and res["failed"] == 0, res)
R.download, R.head, R.wayback_fetch = _d2, _h2, _w2

print("\na file we hold is kept when its url dies:")
def dl5(u, p, timeout=300):
    raise RuntimeError("HTTP Error 404: Not Found")
def wb5(u, p, timeout=120):
    raise AssertionError("must not fetch an older snapshot over a good copy")
R.download, R.head, R.wayback_fetch = dl5, (lambda u, timeout=60: None), wb5
with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, "held_1_2019.xlsx"), "wb") as fh:
        fh.write(b"PK" + b"\0" * 6000)
    man = {"https://www.gov.il/a/held_1_2019/f.xlsx":
           {"file": "held_1_2019.xlsx", "bytes": 6002, "publisher": "x",
            "year": "2019", "period": "1"}}
    res = R._download_all(
        {"https://www.gov.il/a/held_1_2019/f.xlsx":
         {"publisher": "x", "year": "2019", "period": "1"}},
        {}, d, man, os.path.join(d, "m.json"), None, lambda *a: None, wayback=True)
ok("kept, not failed, not re-fetched from the archive",
   res["skipped"] == 1 and res["failed"] == 0, res)
R.download, R.head, R.wayback_fetch = _d2, _h2, _w2

print("\nthe time budget stops cleanly, and direct work goes first:")
import time as _time
def dl6(u, p, timeout=300):
    order6.append(("direct", u))
    return 700000, p
def wb6(u, p, timeout=30):
    order6.append(("wayback", u))
    return 600000, p, "20200101000000"
R.download, R.head, R.wayback_fetch = dl6, (lambda u, timeout=60: None), wb6
FOUND6 = {
    "https://foi.gov.il/a-archive.xlsx":
        {"publisher": "x", "year": "2016", "period": "1", "wayback_only": True},
    "https://www.gov.il/z-direct/f_1_2026.xlsx":
        {"publisher": "y", "year": "2026", "period": "1"},
}
order6 = []
with tempfile.TemporaryDirectory() as d:
    res = R._download_all(dict(FOUND6), {}, d, {}, os.path.join(d, "m.json"),
                          None, lambda *a: None, wayback=True)
ok("the direct url is fetched BEFORE the archive one, whatever the alphabet says",
   order6 and order6[0][0] == "direct", order6)
ok("with no deadline nothing stops early", res.get("stopped_early") is False, res)

order6 = []
with tempfile.TemporaryDirectory() as d:
    res = R._download_all(dict(FOUND6), {}, d, {}, os.path.join(d, "m.json"),
                          None, lambda *a: None, wayback=True,
                          deadline=_time.time() - 1)
    wrote = os.path.exists(os.path.join(d, "failed.json"))
ok("a deadline already passed means nothing is attempted",
   order6 == [] and res["stopped_early"] is True, (order6, res))
ok("the failure lists are still written on an early stop", wrote)
ok("an early stop is not counted as failures", res["failed"] == 0, res)
R.download, R.head, R.wayback_fetch = _d2, _h2, _w2

print("\nparsing the old format (.xls):")
try:
    import xlwt
    HAVE_XLWT = True
except ImportError:
    HAVE_XLWT = False
if HAVE_XLWT:
    import parse_report as P
    with tempfile.TemporaryDirectory() as d:
        xls = os.path.join(d, "r.xls")
        wb = xlwt.Workbook()
        sh = wb.add_sheet("data")
        hdr = ["\u05d4\u05d6\u05de\u05e0\u05ea \u05e8\u05db\u05e9",
               "\u05ea\u05e7\u05e0\u05d4 \u05ea\u05e7\u05e6\u05d9\u05d1\u05d9\u05ea",
               "\u05e2\u05e8\u05da \u05d4\u05d4\u05d6\u05de\u05e0\u05d4",
               "\u05d1. \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05de\u05e6\u05d8\u05d1\u05e8"]
        for c, h in enumerate(hdr):
            sh.write(0, c, h)
        for c, v in enumerate(["4500000001", "20670205", 1000.5, 400.25]):
            sh.write(1, c, v)
        wb.save(xls)
        out = os.path.join(d, "out")
        P.main(xls, out, "https://example/he/x_1_2019/x_1_2019.xls")
        with open(os.path.join(out, "0020.json"), encoding="utf-8") as fh:
            doc = json.load(fh)
    ok("an .xls report parses end to end",
       doc["orders"].get("4500000001:0020670205") == [400.25, 1000.5], doc["orders"])
else:
    print("  (xlwt not installed — .xls round-trip not exercised here)")

print("\ncollection must never quietly shrink:")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import inventory as I
SMALL = "  56 publishers:\n  total        224741       230 MB\n"
BIG   = "  59 publishers:\n  total        257910       263 MB\n"
ok("it reads publishers and records back out", I.totals(BIG) == (59, 257910), I.totals(BIG))
ok("growing is fine", I.compare(SMALL, BIG, []) is True)
ok("fewer records is refused", I.compare(BIG, SMALL, []) is False)
ok("fewer publishers is refused too",
   I.compare("  59 publishers:\n  total        224741  x\n",
             "  56 publishers:\n  total        224741  x\n", []) is False)
ok("a first run, with nothing to compare to, is fine",
   I.compare("", BIG, []) is True)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
