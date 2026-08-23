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
    return 700000
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

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
