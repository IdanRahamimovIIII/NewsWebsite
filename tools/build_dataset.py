#!/usr/bin/env python3
"""
build_dataset.py — merge every source into one record per contract.

THE RULES (Mercy, 2026-08-23). Each is enforced here, and each has a test:
  3. only the fields we care about        → FIELDS below
  4. fill every cell some source can fill → per-field precedence, in order
  5. 0 and empty differ, and a 0 must     → ZERO RULE: for money, a zero is
     never beat a real number               held back and used only if nothing
                                            anywhere reports a figure
  6. one format per kind                  → canon_date / canon_num / canon_text
  7. NO computed averages                 → *_per_year is never read
  8. missing is not zero                  → MISSING stays None, never 0

Union on order_id: a contract present in ANY source is a contract. No source
gets to decide the population.

usage:
  build_dataset.py --files site/data/paid --budgetkey bk.json --out site/data/contracts
"""
import argparse, json, os, re, sys, unicodedata
from collections import defaultdict

# ---------------------------------------------------------------- normalising

def canon_text(v):
    if v is None:
        return None
    s = unicodedata.normalize("NFKC", str(v))
    s = re.sub(r"\s+", " ", s).strip()
    return s or None

_DATE_PATTERNS = (
    (re.compile(r"^(\d{4})[-./](\d{1,2})[-./](\d{1,2})"), (1, 2, 3)),
    (re.compile(r"^(\d{1,2})[-./](\d{1,2})[-./](\d{4})"), (3, 2, 1)),
    (re.compile(r"^(\d{4})(\d{2})(\d{2})$"),              (1, 2, 3)),
)

def canon_date(v):
    """2015-11-04 · 2015-11-04 00:00:00 · 04.11.2015 · 20151104 → 2015-11-04.
       A bare year stays a year: it is a year, not a date, and padding it to
       January 1st would invent precision the source never had."""
    s = canon_text(v)
    if not s:
        return None
    for rx, (y, m, d) in _DATE_PATTERNS:
        hit = rx.match(s)
        if hit:
            return "%s-%02d-%02d" % (hit.group(y), int(hit.group(m)), int(hit.group(d)))
    if re.fullmatch(r"(19|20)\d{2}", s):
        return s
    return s

def canon_num(v):
    """Money and counts. Returns a float, or None when there is no number —
       NEVER 0.0 as a stand-in for missing (rule 8)."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("‏", "").strip()
    s = re.sub(r"[^\d.\-]", "", s)
    if not s or s in ("-", "."):
        return None
    try:
        return float(s)
    except ValueError:
        return None

def canon_code(v):
    """Budget codes: 20670205 and 0020670205 and 20.67.02.05 are one line."""
    s = re.sub(r"\D", "", canon_text(v) or "")
    if not s:
        return None
    return s if len(s) == 10 else ("00" + s if len(s) == 8 else s)

def canon_id(v):
    """Company / order numbers: digits only, leading zeros kept."""
    s = re.sub(r"\D", "", canon_text(v) or "")
    return s or None

# ---------------------------------------------------------------- the schema

TEXT, DATE, MONEY, CODE, IDNUM = "text", "date", "money", "code", "id"

# the ministry file's own column names, exactly as the ministry spells them
X_SUPPLIER = "שם הספק"
X_HP       = 'מספר ח"פ'
X_CODE     = "תקנה תקציבית"
X_MINISTRY = "שם חברה"
X_UNIT     = "שם אתר"
X_ITEM     = "שם פריט התחייבות"
X_PURPOSE  = "מטרת התקשרות"
X_METHOD   = "אופן רכישה מקור"
X_EXEMPT   = "סיבת פטור"
X_VOLUME   = 'ערך ההזמנה כולל מע"מ'
X_PAID     = 'ב. חשבוניות מצטבר + מע"מ והצמדות במט"מ'
X_PERIOD   = "ביצוע חשבוניות לתקופת הדוח' במטבע מקומי"
X_ORDERED  = "תאריך יצירת ההזמנה"
X_ENDS     = "סיום תקופת תוקף"
X_PUB      = "מספר פניית פרסום"
X_ORDER    = "הזמנת רכש"
X_SUPCODE  = "קוד ספק"

# field → (kind, [(source, key-or-callable), …] in order of precedence)
# "file" = the ministry's own report · "bk" = BudgetKey contract_spending
FIELDS = [
    # BudgetKey first: it resolves spelling variants to one entity, which is
    # what makes a supplier page possible at all
    ("supplier",      TEXT,  [("bk", "entity_name"), ("bk", "supplier_name"),
                              ("file", X_SUPPLIER)]),
    # the file is 100% filled here, BudgetKey's company_id only 75.5%
    ("company_id",    IDNUM, [("file", X_HP), ("bk", "company_id")]),
    ("supplier_code", IDNUM, [("file", X_SUPCODE), ("bk", "supplier_code")]),
    ("entity_kind",   TEXT,  [("bk", "entity_kind")]),          # only BudgetKey
    ("ministry",      TEXT,  [("bk", "publisher_name"), ("file", X_MINISTRY)]),
    ("unit",          TEXT,  [("file", X_UNIT), ("bk", "purchasing_unit")]),
    ("budget_code",   CODE,  [("bk", "budget_code"), ("file", X_CODE)]),
    ("budget_title",  TEXT,  [("bk", "budget_title")]),
    ("item_title",    TEXT,  [("file", X_ITEM)]),               # NOT budget_title
    # BudgetKey truncates the purpose; the file carries the full text
    ("purpose",       TEXT,  [("file", X_PURPOSE), ("bk", "purpose")]),
    ("method",        TEXT,  [("file", X_METHOD), ("bk", "purchase_method")]),
    ("exemption",     TEXT,  [("file", X_EXEMPT), ("bk", "exemption_reason")]),
    # BudgetKey drops the payment column on newer reports — the file wins
    ("volume",        MONEY, [("file", X_VOLUME), ("bk", "volume")]),
    ("paid",          MONEY, [("file", X_PAID), ("bk", "executed")]),
    ("paid_in_period", MONEY, [("file", X_PERIOD)]),            # only the file
    ("ordered_date",  DATE,  [("file", X_ORDERED), ("bk", "order_date")]),
    ("ends_date",     DATE,  [("file", X_ENDS), ("bk", "end_date")]),
    ("publication",   IDNUM, [("file", X_PUB), ("bk", "_pub")]),
    ("order_id",      IDNUM, [("bk", "order_id"), ("file", X_ORDER)]),
]

KIND_FN = {TEXT: canon_text, DATE: canon_date, MONEY: canon_num,
           CODE: canon_code, IDNUM: canon_id}

# rule 7, stated so nobody re-adds them by accident
NEVER_READ = {"volume_per_year", "executed_per_year"}

# ---------------------------------------------------------------- the merge

def resolve(field, kind, order, sources):
    """Rule 4 + rule 5 + rule 6, in that order.

    Returns (value, source_name, saw_zero). `value` is None when nothing has
    it — never 0 as a stand-in (rule 8). For money a zero never wins while any
    source still offers a real number (rule 5): משרד החינוך's file reports
    ₪235,298,429 on a contract BudgetKey stores as 0."""
    fn = KIND_FN[kind]
    saw_zero = False
    for src_name, key in order:
        row = sources.get(src_name)
        if not row:
            continue
        if key in NEVER_READ:
            raise AssertionError("rule 7: %s must never be read" % key)
        raw = row.get(key)
        if isinstance(raw, list):
            raw = raw[0] if raw else None
        value = fn(raw)
        if value is None:
            continue
        if kind is MONEY and value == 0:
            saw_zero = True                      # held back, not chosen
            continue
        return value, src_name, saw_zero
    # every source that had anything said zero — that IS the answer
    if saw_zero:
        return 0.0, "all-zero", True
    return None, None, False


def merge_contract(order_id, bk_rows, file_rows):
    """One contract. bk_rows / file_rows are every row for this order_id,
       across budget codes."""
    bk_primary = bk_rows[0] if bk_rows else None
    file_primary = file_rows[0] if file_rows else None
    if bk_primary is not None:
        bk_primary = dict(bk_primary)
        bk_primary["_pub"] = _publication(bk_primary)

    out, prov = {}, {}
    for field, kind, order in FIELDS:
        value, src, _ = resolve(field, kind, order,
                                {"bk": bk_primary, "file": file_primary})
        out[field] = value
        prov[field] = src

    # allocations: the ministry's own newest report decides which budget codes
    # are live. Rows BudgetKey holds under codes the file no longer uses are
    # historical — kept, labelled, never added to a total.
    live = {canon_code(r.get(X_CODE)) for r in file_rows if canon_code(r.get(X_CODE))}
    allocations, historical = [], []
    seen = set()
    for r in file_rows:
        code = canon_code(r.get(X_CODE))
        if not code or code in seen:
            continue
        seen.add(code)
        allocations.append({"budget_code": code,
                            "volume": canon_num(r.get(X_VOLUME)),
                            "paid": canon_num(r.get(X_PAID)),
                            "source": "file"})
    for r in bk_rows:
        code = canon_code(r.get("budget_code"))
        if not code or code in seen:
            continue
        seen.add(code)
        entry = {"budget_code": code,
                 "volume": canon_num(r.get("volume")),
                 "paid": canon_num(r.get("executed")),
                 "source": "budgetkey"}
        (historical if live else allocations).append(entry)

    out["order_id"] = order_id
    out["allocations"] = allocations
    out["historical_allocations"] = historical
    out["reports"] = _reports(bk_rows)
    out["sources"] = sorted({s for s in prov.values() if s and s != "all-zero"})
    out["provenance"] = {k: v for k, v in prov.items() if v}
    return out


def _publication(bk_row):
    """tender_key is ["569574","exemptions",…] — publication number first."""
    tk = bk_row.get("tender_key")
    items = tk if isinstance(tk, list) else ([tk] if tk else [])
    for item in items:
        parsed = item
        if isinstance(item, str) and item.strip().startswith("["):
            try:
                parsed = json.loads(item)
            except ValueError:
                pass
        parts = parsed if isinstance(parsed, list) else [parsed]
        if parts and re.fullmatch(r"\d+", str(parts[0] or "")):
            return str(parts[0])
    return None


def _reports(bk_rows):
    """Rule 7 at the schema level: store what was REPORTED, per report. Any
       per-year figure is derived at display time and left empty when it
       cannot be computed — never averaged into existence."""
    by_period = {}
    for r in bk_rows:
        for p in (r.get("payments") or []):
            year, period = canon_text(p.get("year")), canon_text(p.get("period"))
            # KEY ON (year, period) ONLY. The same report is published at two
            # addresses — foi.gov.il and gov.il — so including the url in the
            # key keeps both and doubles the quarter. Where a period really does
            # appear twice with different figures it is a revision (the source
            # carries revision 0..2), and the larger cumulative one is the later.
            key = (year, period)
            entry = {"year": year, "period": period,
                     "volume": canon_num(p.get("volume")),
                     "paid_cumulative": canon_num(p.get("executed")),
                     "url": canon_text(p.get("url"))}
            prev = by_period.get(key)
            if prev is None or (entry["paid_cumulative"] or 0) > (prev["paid_cumulative"] or 0):
                by_period[key] = entry
    out = list(by_period.values())
    out.sort(key=lambda x: ((x["year"] or ""), (x["period"] or "9")))
    return out

# ---------------------------------------------------------------- driving it

def load_files(dirpath):
    """every <section>.full.json → {order_id: [row, …]}"""
    by_order = defaultdict(list)
    if not dirpath or not os.path.isdir(dirpath):
        return by_order
    for name in sorted(os.listdir(dirpath)):
        if not name.endswith(".full.json"):
            continue
        with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
            doc = json.load(fh)
        for key, rec in (doc.get("orders") or {}).items():
            by_order[key.split(":")[0]].append(rec)
    return by_order


def load_budgetkey(path):
    by_order = defaultdict(list)
    if not path:
        return by_order
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)
    for r in (rows.get("rows") if isinstance(rows, dict) else rows):
        oid = canon_id(r.get("order_id"))
        if oid:
            by_order[oid].append(r)
    return by_order


def build(files_dir, bk_path, out_dir):
    files = load_files(files_dir)
    bk = load_budgetkey(bk_path)
    every_order = sorted(set(files) | set(bk))       # UNION, not either side

    out = [merge_contract(o, bk.get(o, []), files.get(o, [])) for o in every_order]

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "contracts.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"contracts": out}, fh, ensure_ascii=False, separators=(",", ":"))

    only_file = sum(1 for o in every_order if o in files and o not in bk)
    only_bk = sum(1 for o in every_order if o in bk and o not in files)
    filled = defaultdict(int)
    for c in out:
        for k, v in (c.get("provenance") or {}).items():
            filled[v] += 1
    print("contracts: %d  (file only: %d · BudgetKey only: %d · both: %d)"
          % (len(out), only_file, only_bk, len(out) - only_file - only_bk))
    print("fields filled by source: %s"
          % ", ".join("%s %d" % kv for kv in sorted(filled.items())))
    print("written: %s" % path)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", help="dir of <section>.full.json")
    ap.add_argument("--budgetkey", help="json of contract_spending rows")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    build(a.files, a.budgetkey, a.out)
