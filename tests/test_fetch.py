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
u2, m2 = R.probe_newer(URL, {"publisher": "חינוך", "year": "2025", "period": "1"},
                       log=lambda *a: None, today=datetime.date(2026, 8, 23))
ok("we end on the newest quarter that really exists", "education_3_2025" in u2, u2)
ok("and the metadata says so", (m2["year"], m2["period"]) == ("2025", "3"), m2)
ok("the file name follows the url", R.filename_for(u2, m2) == "education_3_2025.xlsx",
   R.filename_for(u2, m2))

def block_page(u, timeout=60):
    return 5682                                        # gov.il's 403 wall
R.head = block_page
u3, _ = R.probe_newer(URL, {"publisher": "x", "year": "2025", "period": "1"},
                      log=lambda *a: None, today=datetime.date(2026, 8, 23))
ok("a 5,682-byte block page is not mistaken for a report", u3 == URL, u3)
R.head = _real_head


# ------------------------------------------------------ paging the budget tree

print("\npaging contract_spending by budget code:")
# 0020 holds 1,500 rows: more than one page, so it must split
UNIVERSE = {"002010%04d" % i: i for i in range(1500)}
def fake_k(sql, rows=K.PAGE, timeout=0):
    if sql.startswith("SELECT * FROM"):
        return [{c: None for c in K.WANT}]
    if "LIKE '" not in sql:                    # the exact-code query at a split
        return []
    prefix = sql.split("LIKE '")[1].split("%")[0]
    hits = sorted(k for k in UNIVERSE if k.startswith(prefix))
    return [{"order_id": "45%08d" % UNIVERSE[h], "budget_code": h} for h in hits][:rows]
K.bk, _real_k = fake_k, K.bk
cols, missing = K.columns(log=lambda *a: None)
ok("every column the merge reads exists in the table", missing == [], missing)
ok("the forbidden per-year columns are not selected",
   not any(c in K.NEVER_READ for c in cols))
rows, stats = [], {"queries": 0}
K.by_code("0020", cols, rows, stats, log=lambda *a: None)
got = {r["budget_code"] for r in rows}
ok("a bucket bigger than one page is split, not truncated", len(got) == 1500, len(got))
ok("splitting cost more than one query", stats["queries"] > 1, stats["queries"])
K.bk = _real_k


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
