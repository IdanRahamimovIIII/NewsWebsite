#!/usr/bin/env python3
"""
test_merge.py — the eight rules, against contracts verified live on 2026-08-22/23.

Every fixture value here was read from the real sources during that session.
No invented numbers: a fixture kinder than reality is how we shipped a "per
year" column that was really a lifetime total divided by four.

    python3 tests/test_merge.py
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import build_dataset as B

PASS = FAIL = 0

def ok(name, cond, info=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  ✔ " + name)
    else:
        FAIL += 1; print("  ✘ " + name + ("  → " + str(info) if info else ""))

# ---------------------------------------------------------------- real rows

# מילגם בע"מ, order 4502539235 — BudgetKey stores the volume to the agora and
# the payment as 0.0; the ministry's own file has ₪235,298,429.36.
BK_MILGAM = {
    "order_id": "4502539235", "budget_code": "0020670205",
    "supplier_name": "מילגם בע\"מ", "entity_name": "מילגם בע\"מ",
    "entity_kind": "company", "company_id": None,
    "publisher_name": "משרד החינוך", "purchasing_unit": None,
    "purpose": "מ7/7.2020 הזנה בניצנים תשפה",       # truncated in BudgetKey
    "purchase_method": ["תקנה 1ב - מכרז פומבי רגיל"],
    "exemption_reason": [], "budget_title": "הוצאות תפעול",
    "volume": 409961432.74, "executed": 0.0,          # <- the zero
    "order_date": "2024-12-04", "end_date": None, "tender_key": [],
    "payments": [
        {"year": "2024", "period": "4", "executed": 0.0,
         "volume": 409961432.74, "url": "https://foi.gov.il/a.xlsx"},
        {"year": "2024", "period": "4", "executed": 0.0,
         "volume": 409961432.74, "url": "https://gov.il/a.xlsx"},   # same report, twice
        {"year": "2025", "period": "1", "executed": 0.0,
         "volume": 409961432.74, "url": "https://foi.gov.il/b.xlsx"},
    ],
}
FILE_MILGAM = {
    "שם חברה": "משרד החינוך", "שם אתר": "מטה משרד החינוך",
    "תקנה תקציבית": "20670205", "שם פריט התחייבות": "הזנה בתכנית מסגרות",
    "הזמנת רכש": "4502539235",
    "מטרת התקשרות": "מ7/7.2020 מתן שירותיים מנהלתיים להפעלת תוכנית הזנה ואורח חיים בריא - הזנה בניצנים תשפה",
    "תאריך יצירת ההזמנה": "2024-12-04 00:00:00",       # <- a different date shape
    "סיום תקופת תוקף": "2025-08-31 00:00:00",
    "קוד ספק": "40223381", "שם הספק": "מילגם בע\"מ",
    "מספר ח\"פ": "510982325",                           # <- BudgetKey has none
    "ערך ההזמנה כולל מע\"מ": 409961432.74,
    "ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ": 235298429.36,
    "ביצוע חשבוניות לתקופת הדוח' במטבע מקומי": 235298429.36,
    "אופן רכישה מקור": "תקנה 1ב - מכרז פומבי רגיל",
    "מספר פניית פרסום": "651623",
}

# אגוד הייעל, order 4501119831 — three BudgetKey rows: the charge moved between
# budget codes, and one code is duplicated with no dates at all.
BK_IGUD = [
    {"order_id": "4501119831", "budget_code": "0020400312", "volume": 13326.3,
     "executed": 7359.3, "min_year": 2015, "entity_name": "אגוד הייעל (1985) בע\"מ",
     "purpose": "עריכת מרכז שמירה ואבטחה", "payments": [], "tender_key": []},
    {"order_id": "4501119831", "budget_code": "0020400312", "volume": 13326.3,
     "executed": 7359.3, "min_year": None, "entity_name": "אגוד הייעל (1985) בע\"מ",
     "purpose": "עריכת מרכז שמירה ואבטחה", "payments": [], "tender_key": []},
    {"order_id": "4501119831", "budget_code": "0020600138", "volume": 13440.2,
     "executed": 0.0, "min_year": 2015, "entity_name": "אגוד הייעל (1985) בע\"מ",
     "purpose": "עריכת מרכז שמירה ואבטחה", "payments": [], "tender_key": []},
]
FILE_IGUD = [{
    "הזמנת רכש": "4501119831", "תקנה תקציבית": "20600138",
    "שם הספק": "אגוד הייעל (1985) בע\"מ", "מספר ח\"פ": "511060212",
    "ערך ההזמנה כולל מע\"מ": 13440.2,
    "ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ": 7359.3,
}]

print("\ncanonical forms (rule 6):")
ok("2015-11-04 00:00:00 → 2015-11-04", B.canon_date("2015-11-04 00:00:00") == "2015-11-04")
ok("04.11.2015 → 2015-11-04", B.canon_date("04.11.2015") == "2015-11-04")
ok("20151104 → 2015-11-04", B.canon_date("20151104") == "2015-11-04")
ok("a bare year stays a year", B.canon_date("2015") == "2015")
ok("8-digit budget code → 10", B.canon_code("20670205") == "0020670205")
ok("dotted budget code → 10", B.canon_code("20.67.02.05") == "0020670205")
ok("₪409,961,432.74 → float", B.canon_num("409,961,432.74") == 409961432.74)

print("\nrule 8 — missing is not zero:")
ok("empty string is None, not 0.0", B.canon_num("") is None)
ok("None is None, not 0.0", B.canon_num(None) is None)
ok("a real zero is 0.0", B.canon_num(0) == 0.0)

print("\nrule 5 — a zero never beats a number:")
m = B.merge_contract("4502539235", [BK_MILGAM], [FILE_MILGAM])
ok("paid takes the file's figure, not BudgetKey's 0", m["paid"] == 235298429.36, m["paid"])
ok("…and says where it came from", m["provenance"]["paid"] == "file",
   m["provenance"].get("paid"))
z = B.merge_contract("X", [{"order_id": "X", "executed": 0.0, "payments": []}],
                     [{"הזמנת רכש": "X", "ב. חשבוניות מצטבר + מע\"מ והצמדות במט\"מ": 0}])
ok("when EVERY source says 0, the answer is 0", z["paid"] == 0.0, z["paid"])
ok("…and that is marked as all-zero", z["provenance"]["paid"] == "all-zero")
n = B.merge_contract("Y", [{"order_id": "Y", "payments": []}], [{"הזמנת רכש": "Y"}])
ok("when NO source has it, the answer is None", n["paid"] is None, n["paid"])

print("\nrule 4 — every field from wherever it can be filled:")
ok("ח״פ comes from the file", m["company_id"] == "510982325")
ok("supplier name comes from BudgetKey", m["provenance"]["supplier"] == "bk")
ok("…on the SAME contract", m["provenance"]["company_id"] == "file")
ok("the full purpose beats the truncated one",
   m["purpose"].startswith("מ7/7.2020 מתן שירותיים"), m["purpose"][:40])
ok("entity_kind, which only BudgetKey has", m["entity_kind"] == "company")
ok("publication number from the file", m["publication"] == "651623")
ok("dates arrive canonical", m["ordered_date"] == "2024-12-04", m["ordered_date"])
ok("…including the end date", m["ends_date"] == "2025-08-31", m["ends_date"])

print("\nrule 7 — no computed averages, ever:")
ok("the per-year columns are on the forbidden list",
   "executed_per_year" in B.NEVER_READ and "volume_per_year" in B.NEVER_READ)
ok("no merged field reads one",
   not any(k in B.NEVER_READ for _, _, order in B.FIELDS for _, k in order))
ok("reports are stored as reported, not as years",
   isinstance(m["reports"], list) and set(m["reports"][0]) ==
   {"year", "period", "volume", "paid_cumulative", "url"})
ok("the duplicate report is collapsed", len(m["reports"]) == 2, m["reports"])

print("\nallocations — one order, several codes:")
g = B.merge_contract("4501119831", BK_IGUD, FILE_IGUD)
ok("the file decides which code is live",
   [a["budget_code"] for a in g["allocations"]] == ["0020600138"], g["allocations"])
ok("the abandoned code is kept, not deleted",
   any(a["budget_code"] == "0020400312" for a in g["historical_allocations"]))
ok("…and is NOT in the live allocations",
   all(a["budget_code"] != "0020400312" for a in g["allocations"]))
live_total = sum(a["volume"] or 0 for a in g["allocations"])
ok("summing live allocations gives the contract, not 3x it",
   abs(live_total - 13440.2) < 0.01, live_total)
ok("the payment survives from the file, where BudgetKey has 0",
   g["paid"] == 7359.3, g["paid"])

print("\nunion — no source decides the population:")
with tempfile.TemporaryDirectory() as d:
    fdir = os.path.join(d, "paid"); os.makedirs(fdir)
    with open(os.path.join(fdir, "0020.full.json"), "w", encoding="utf-8") as fh:
        json.dump({"orders": {"4502539235:0020670205": FILE_MILGAM,
                              "9999999999:0020600138": {"הזמנת רכש": "9999999999",
                                  "שם הספק": "ספק שרק בקובץ", "תקנה תקציבית": "20600138"}}}, fh)
    bkp = os.path.join(d, "bk.json")
    with open(bkp, "w", encoding="utf-8") as fh:
        json.dump([BK_MILGAM, {"order_id": "8888888888", "budget_code": "0024010101",
                               "entity_name": "ספק שרק ב-BudgetKey", "payments": []}], fh)
    built = B.build(fdir, bkp, os.path.join(d, "out"))
    ids = {c["order_id"] for c in built}
    ok("a contract only in the file is kept", "9999999999" in ids)
    ok("a contract only in BudgetKey is kept", "8888888888" in ids)
    ok("one in both appears once", sum(1 for c in built if c["order_id"] == "4502539235") == 1)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
