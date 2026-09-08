#!/usr/bin/env python3
"""
test_merge.py — the eight rules, against contracts verified live on 2026-08-22/23,
plus the FIELDS.xlsx v2 schema and the register join (added 2026-08-25 — every
register fixture read out of the real mr.gov.il conversions on Mercy's disk).

Every fixture value here was read from the real sources during those sessions.
No invented numbers: a fixture kinder than reality is how we shipped a "per
year" column that was really a lifetime total divided by four.

    python3 tests/test_merge.py
"""
import json, os, sys, tempfile

# build_dataset lives in contractors\ since the 2026-09-08 by-DATASET reorg
# (tools\ keeps the collection scripts the workflows run); the older paths
# stay as fallbacks for a checkout from before the moves.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "database"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "contractors"))
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
    # the FIELDS.xlsx v2 columns, as the education 2025Q1 report spells them
    "תאור של ארגון רכש": "מטה כללי משרד החינוך",
    "תיאור קבוצת רכש": "אגף ביטחון ובטיחות",
    "קבוצת רכש": "E41",                                 # the raw code — dropped
    "מטבע": "ILS",
    "מטבע חשבונית": "ILS",                              # measured duplicate — dropped
    "סכום התקשרות מצטבר במטבע מקומי": 409961432.74,
}

# publication 651623 in the TENDERS register (mr.gov.il, read 2026-08-25) —
# the same מ7/7.2020 the file's purpose text names. The registers' spellings,
# exactly as parse_portal_export writes them.
TN_651623 = {
    "מספר פרסום": "651623", "שם המשרד": "משרד החינוך",
    "שם יחידה מפרסמת": "משרד החינוך", "סוג הליך": "מכרז פומבי",
    "מספר הליך": "7/7.2020",
    "שם הליך": "מתן שירותים מנהליים להפעלת תכניות הזנה ואורח חיים בריא של משרד החינוך",
    "סטטוס": "בעדכון", "תאריך פרסום": "13.07.2020", "תאריך עדכון": "09.08.2020",
}

# publication 569574 in the EXEMPTIONS register (קריץ איגור — the tender_key
# example contract, re-read after the ss:Index fix)
EX_569574 = {
    "מספר פרסום": "569574", "שם המשרד": "משרד הבינוי והשיכון",
    "שם יחידה מפרסמת": "משרד הבינוי והשיכון",
    "סוג הליך": "התקשרות בפטור במכרז או בהליך תחרותי אחר",
    "שם הליך": "כבישים", "לינק לטקסטים": "569574",
    "תקנה": "תקנה 5א(ב)(1) - התקשרות עם מתכננים - בחירה ממאגר מתכננים",
    "סטטוס": "פורסם", "מהות החלטה": "התקשרות מאושרת",
    "גורם מאשר": "מכרזים משרדית",
    "תאריך פרסום": "08.09.2015", "תאריך עדכון": "08.09.2015",
    "שם ספק": "קריץ איגור", "מספר חפ ספק": "303739957",
    "היקף כספי": "222177.66", "מטבע": "ILS",
    "תאריך תחילת תקופת התקשרות": "30.07.2015",
    "תאריך סיום תקופת התקשרות": "30.12.2021",
    "נושאים": "שירותי בנייה ואחזקת מבנים",
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

print("\nthe FIELDS.xlsx v2 columns (approved 2026-08-25):")
ok("currency is read from מטבע — the exact column, not מטבע חשבונית",
   m["currency"] == "ILS" and m["provenance"]["currency"] == "file")
ok("the unit is תאור של ארגון רכש now, not שם אתר",
   m["unit"] == "מטה כללי משרד החינוך", m["unit"])
ok("שם אתר is not read by anything",
   B._file_tag("שם אתר") is None)
ok("מטבע חשבונית is not read by anything",
   B._file_tag("מטבע חשבונית") is None)
ok("the purchase group keeps the description, drops the code",
   m["purchase_group"] == "אגף ביטחון ובטיחות" and
   B._file_tag("קבוצת רכש") is None, m["purchase_group"])
ok("the cumulative total arrives", m["total_cumulative"] == 409961432.74)
ok("a spelling variant still lands: לתקופת הדוח without במטבע מקומי",
   B._file_tag("ביצוע חשבוניות לתקופת הדוח'") == B.X_PERIOD)
ok("rule 7 covers the whole schema: no field reads a per-year column",
   not any(k in B.NEVER_READ for _, _, order in B.FIELDS for _, k in order))

print("\nthe register join — פרסום 651623, the file's own bridge:")
tn_index = {"651623": [TN_651623]}
ex_index = {"569574": [EX_569574]}
r = B.merge_contract("4502539235", [BK_MILGAM], [FILE_MILGAM], ex_index, tn_index)
ok("the tenders register is found through the file's מספר פניית פרסום",
   "tn" in r["sources"], r["sources"])
ok("procedure id 7/7.2020 — only the register has it",
   r["procedure_id"] == "7/7.2020" and r["provenance"]["procedure_id"] == "tn")
ok("publication status arrives from the register",
   r["publication_status"] == "בעדכון")
ok("published date arrives canonical: 13.07.2020 → 2020-07-13",
   r["published_date"] == "2020-07-13", r["published_date"])
ok("the file's full purpose still beats the register's שם הליך",
   r["purpose"].startswith("מ7/7.2020 מתן שירותיים"), r["purpose"][:40])
ok("no exemptions row matched — and nothing pretends one did",
   "ex" not in r["sources"])

print("\nthe register join — פרסום 569574, an exemption with the works:")
bk_kritz = {"order_id": "7777", "tender_key": ['["569574","exemptions"]'],
            "payments": []}
k = B.merge_contract("7777", [bk_kritz], [], ex_index, tn_index)
ok("the exemptions register is reached through BudgetKey's tender_key",
   "ex" in k["sources"], k["sources"])
ok("the announced amount — number 3 of the three — arrives",
   k["announced"] == 222177.66 and k["provenance"]["announced"] == "ex")
ok("who approved it", k["approver"] == "מכרזים משרדית")
ok("what was decided", k["decision"] == "התקשרות מאושרת")
ok("the exemption regulation, full on every register row",
   k["exemption"].startswith("תקנה 5א(ב)(1)"), k["exemption"])
ok("the contract's start — only the register knows it",
   k["starts_date"] == "2015-07-30", k["starts_date"])
ok("…and the end", k["ends_date"] == "2021-12-30", k["ends_date"])
ok("topics arrive", k["topics"] == "שירותי בנייה ואחזקת מבנים")
ok("the supplier is filled from the register when nothing else has it",
   k["supplier"] == "קריץ איגור" and k["provenance"]["supplier"] == "ex")
ok("…and their ח\"פ", k["company_id"] == "303739957")
ok("the documents ref is kept as found — an id, not a url",
   k["documents_ref"] == "569574")

print("\nthe publication cell's traps:")
multi = dict(FILE_MILGAM); multi["מספר פניית פרסום"] = "649013, 651623"
r2 = B.merge_contract("4502539235", [], [multi], ex_index, tn_index)
ok("several comma-separated numbers are split, never welded together",
   r2["publication"] == "651623" and "tn" in r2["sources"], r2["publication"])
zero = dict(FILE_MILGAM); zero["מספר פניית פרסום"] = "0"
r3 = B.merge_contract("4502539235", [], [zero], ex_index, tn_index)
ok("'0' is the ministry's way of writing none — no join, no fake number",
   r3["publication"] is None and "tn" not in r3["sources"])

print("\none publication, several register rows:")
other = dict(EX_569574); other["שם ספק"] = "ספק אחר"; other["מספר חפ ספק"] = "999999999"
two_rows = {"569574": [other, EX_569574]}
f_hp = {"הזמנת רכש": "7777", "מספר ח\"פ": "303739957", "מספר פניית פרסום": "569574"}
p = B.merge_contract("7777", [], [f_hp], two_rows, None)
ok("the row about OUR supplier wins over the one that merely came first",
   p["supplier"] == "קריץ איגור", p["supplier"])

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
    # the registers, in parse_portal_export's own shape: columns + rows-as-arrays
    tnp = os.path.join(d, "tn.json")
    cols = sorted(set(TN_651623))
    with open(tnp, "w", encoding="utf-8") as fh:
        json.dump({"columns": cols,
                   "rows": [[TN_651623.get(c, "") for c in cols]]}, fh)
    built = B.build(fdir, bkp, os.path.join(d, "out"), None, tnp,
                    log=lambda *a: None)
    ids = {c["order_id"] for c in built}
    ok("a contract only in the file is kept", "9999999999" in ids)
    ok("a contract only in BudgetKey is kept", "8888888888" in ids)
    ok("one in both appears once", sum(1 for c in built if c["order_id"] == "4502539235") == 1)
    ok("the register rode along end-to-end",
       any("tn" in c["sources"] for c in built))
    secs = json.load(open(os.path.join(d, "out", "index.json"), encoding="utf-8"))
    ok("output is sharded by section, the cut parse_report makes",
       "0020" in secs["sections"] and secs["contracts"] == len(built), secs)
    sec20 = json.load(open(os.path.join(d, "out", "0020.json"), encoding="utf-8"))
    ok("the section file holds its own contracts",
       any(c["order_id"] == "4502539235" for c in sec20["contracts"]))

print("\na register that is not one fails loudly:")
with tempfile.TemporaryDirectory() as d:
    bad = os.path.join(d, "bad.json")
    with open(bad, "w", encoding="utf-8") as fh:
        json.dump({"columns": ["שם", "ערך"], "rows": []}, fh)
    try:
        B.load_register(bad, log=lambda *a: None)
        ok("a file with no מספר פרסום column is refused", False)
    except SystemExit:
        ok("a file with no מספר פרסום column is refused", True)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
