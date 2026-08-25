#!/usr/bin/env python3
"""
build_dataset.py — merge every source into one record per contract.

THE RULES (Mercy, 2026-08-23). Each is enforced here, and each has a test:
  3. only the fields we care about        → FIELDS below, which is FIELDS.xlsx
                                            (repo root) turned into code. That
                                            file is the schema's constitution:
                                            a לשמור row is here, a להשמיט row
                                            is not. Approved 2026-08-25.
  4. fill every cell some source can fill → per-field precedence, in order
  5. 0 and empty differ, and a 0 must     → ZERO RULE: for money, a zero is
     never beat a real number               held back and used only if nothing
                                            anywhere reports a figure
  6. one format per kind                  → canon_date / canon_num / canon_text
  7. NO computed averages                 → *_per_year is never read
  8. missing is not zero                  → MISSING stays None, never 0

THE SOURCES
  file — the ministry's own quarterly report (site/data/paid/<sec>.full.json;
         in git those exist only as the workflow's full-records artifact)
  bk   — BudgetKey contract_spending, raw per-section pulls (build/raw)
  ex   — the exemptions register, mr.gov.il's own monthly export
  tn   — the tenders register, same origin
  The registers have NO order number (measured 2026-08-23) — they can never
  create a contract, only decorate one, joined through the publication number.

Union on order_id: a contract present in ANY payment source is a contract.
No source gets to decide the population.

usage:
  build_dataset.py --files site/data/paid --budgetkey build/raw \
                   --exemptions exemptions.json --tenders tenders.json \
                   --out site/data/contracts
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

def canon_year(v):
    """שנות דיווח come dirty at the edges (1899, 9999 — measured). A year
       outside a sane reporting range is noise, not history."""
    n = canon_num(v)
    if n is None:
        return None
    y = int(n)
    return y if 1990 <= y <= 2036 else None

def canon_flag(v):
    """BudgetKey's booleans arrive as bools, or as their string costumes."""
    if isinstance(v, bool):
        return v
    s = (canon_text(v) or "").lower()
    if s in ("true", "t", "1", "yes"):
        return True
    if s in ("false", "f", "0", "no"):
        return False
    return None

# ------------------------------------------------- the ministry file's columns
#
# The .full.json records keep each ministry's OWN spellings (normalised
# whitespace only) — and ministries disagree with each other and with
# themselves across years, so exact-string keys are a trap. Each spelling is
# resolved ONCE (cached) through these matchers, the same loose-matching idea
# parse_report.py uses. Order matters: the specific before the general.
#
# Deliberately ABSENT, per FIELDS.xlsx (Mercy, 2026-08-25):
#   שם אתר         — duplicates the organisation name        (להשמיט)
#   מטבע חשבונית   — measured: never differs from מטבע       (להשמיט)
#   קבוצת רכש      — the raw code; only its description stays (להשמיט)

X_SUPPLIER = "@supplier";      X_HP = "@hp";           X_CODE = "@code"
X_MINISTRY = "@ministry";      X_UNIT = "@unit";       X_GROUP = "@group"
X_ITEM = "@item";              X_PURPOSE = "@purpose"; X_METHOD = "@method"
X_EXEMPT = "@exempt";          X_VOLUME = "@volume";   X_PAID = "@paid"
X_PERIOD = "@period";          X_ORDERED = "@ordered"; X_ENDS = "@ends"
X_PUB = "@pub";                X_ORDER = "@order";     X_SUPCODE = "@supcode"
X_CURRENCY = "@currency"
X_OPT_SUM = "@opt_sum";        X_OPT_CUM = "@opt_cum"
X_OPT_DATE = "@opt_date";      X_OPT_REQ = "@opt_req"
X_CONT_DATE = "@cont_date";    X_CONT_SUM = "@cont_sum"
X_CONT_REASON = "@cont_reason"; X_CONT_REQ = "@cont_req"
X_TOTAL_CUM = "@total_cum"

_FILE_MATCHERS = [
    # the specific first — every one of these contains a more general phrase
    (X_PERIOD,      lambda h: "חשבוניות" in h and "לתקופת" in h),
    (X_PAID,        lambda h: "חשבוניות" in h and "מצטבר" in h),
    (X_OPT_CUM,     lambda h: "סכום אופציה" in h and "מצטבר" in h),
    (X_OPT_SUM,     lambda h: "סכום אופציה" in h),
    (X_OPT_DATE,    lambda h: "תאריך מימוש אופציה" in h),
    (X_OPT_REQ,     lambda h: "פניית מימוש" in h),
    (X_CONT_DATE,   lambda h: "תאריך התקשרות המשך" in h),
    (X_CONT_SUM,    lambda h: "סכום התקשרות המשך" in h),
    (X_CONT_REASON, lambda h: "סיבת התקשרות המשך" in h),
    (X_CONT_REQ,    lambda h: "פניית התקשרות המשך" in h),
    (X_TOTAL_CUM,   lambda h: "סכום התקשרות מצטבר" in h),
    (X_GROUP,       lambda h: "תיאור קבוצת רכש" in h),
    (X_PUB,         lambda h: "פניית פרסום" in h),
    (X_SUPPLIER,    lambda h: h == "שם הספק"),
    (X_HP,          lambda h: 'ח"פ' in h),
    (X_CODE,        lambda h: "תקנה תקציבית" in h),
    (X_MINISTRY,    lambda h: h == "שם חברה"),
    (X_UNIT,        lambda h: "ארגון רכש" in h),
    (X_ITEM,        lambda h: "פריט התחייבות" in h),
    (X_PURPOSE,     lambda h: "מטרת התקשרות" in h or "מטרת ההתקשרות" in h),
    (X_METHOD,      lambda h: "אופן רכישה" in h),
    (X_EXEMPT,      lambda h: "סיבת פטור" in h),
    (X_VOLUME,      lambda h: "ערך ההזמנה" in h),
    (X_ORDERED,     lambda h: "יצירת ההזמנה" in h),
    (X_ENDS,        lambda h: "סיום תקופת תוקף" in h),
    (X_ORDER,       lambda h: "הזמנת רכש" in h),
    (X_SUPCODE,     lambda h: h == "קוד ספק"),
    (X_CURRENCY,    lambda h: h == "מטבע"),
]

_spelling_cache = {}

def _file_tag(spelling):
    if spelling not in _spelling_cache:
        tag = None
        for t, test in _FILE_MATCHERS:
            if test(spelling):
                tag = t
                break
        _spelling_cache[spelling] = tag
    return _spelling_cache[spelling]

def file_view(row):
    """{@tag: value} for one ministry row — its own spellings resolved."""
    out = {}
    for k, v in row.items():
        tag = _file_tag(k)
        if tag is not None and tag not in out:
            out[tag] = v
    return out

# ------------------------------------------------- the registers' columns
# One export format, spellings stable (they are mr.gov.il's own) — exact keys.

R_PUB = "מספר פרסום"

# ---------------------------------------------------------------- the schema

TEXT, DATE, MONEY, CODE, IDNUM, YEAR, FLAG = \
    "text", "date", "money", "code", "id", "year", "flag"

# field → (kind, [(source, key), …] in order of precedence).
# Sources: "file" (@tags above) · "bk" · "ex" · "tn". The order of each row
# follows the settled precedence table (CLAUDE.md 2026-08-23) with the
# registers appended where FIELDS.xlsx names them as a source.
FIELDS = [
    # BudgetKey first: it resolves spelling variants to one entity, which is
    # what makes a supplier page possible at all
    ("supplier",      TEXT,  [("bk", "entity_name"), ("bk", "supplier_name"),
                              ("file", X_SUPPLIER), ("ex", "שם ספק"),
                              ("tn", "שם ספק זוכה")]),
    ("entity_id",     TEXT,  [("bk", "entity_id")]),             # only BudgetKey
    ("entity_kind",   TEXT,  [("bk", "entity_kind")]),           # only BudgetKey
    # the file is 100% filled here, BudgetKey's company_id only 75.5%
    ("company_id",    IDNUM, [("file", X_HP), ("bk", "company_id"),
                              ("ex", "מספר חפ ספק"), ("tn", "מספר חפ ספק")]),
    ("supplier_code", IDNUM, [("file", X_SUPCODE), ("bk", "supplier_code")]),
    ("ministry",      TEXT,  [("bk", "publisher_name"), ("file", X_MINISTRY),
                              ("ex", "שם המשרד"), ("tn", "שם המשרד")]),
    ("unit",          TEXT,  [("file", X_UNIT), ("bk", "purchasing_unit"),
                              ("ex", "שם יחידה מפרסמת"), ("tn", "שם יחידה מפרסמת")]),
    ("purchase_group", TEXT, [("file", X_GROUP)]),               # only the file
    ("budget_code",   CODE,  [("bk", "budget_code"), ("file", X_CODE)]),
    ("budget_title",  TEXT,  [("bk", "budget_title")]),
    ("item_title",    TEXT,  [("file", X_ITEM)]),                # NOT budget_title
    # BudgetKey truncates the purpose; the file carries the full text. The
    # registers' שם הליך is a near-miss (the procedure's name) — last resort.
    ("purpose",       TEXT,  [("file", X_PURPOSE), ("bk", "purpose"),
                              ("ex", "שם הליך"), ("tn", "שם הליך")]),
    ("method",        TEXT,  [("file", X_METHOD), ("bk", "purchase_method"),
                              ("ex", "סוג הליך"), ("tn", "סוג הליך")]),
    # the register carries the regulation on EVERY row (100%) but is joined on
    # only ~half the contracts; the file's 27–69% still comes first per the
    # settled table (ours → cs → ex)
    ("exemption",     TEXT,  [("file", X_EXEMPT), ("bk", "exemption_reason"),
                              ("ex", "תקנה")]),
    ("procedure_id",  TEXT,  [("ex", "מספר הליך"), ("tn", "מספר הליך")]),
    # BudgetKey drops the payment column on newer reports — the file wins
    ("volume",        MONEY, [("file", X_VOLUME), ("bk", "volume")]),
    # the announced figure — number 3 of the three, only the register has it
    ("announced",     MONEY, [("ex", "היקף כספי")]),
    ("paid",          MONEY, [("file", X_PAID), ("bk", "executed")]),
    ("paid_in_period", MONEY, [("file", X_PERIOD)]),             # only the file
    # measured: not always ILS — 6,008 USD and 2,465 EUR publications
    ("currency",      TEXT,  [("file", X_CURRENCY), ("bk", "currency"),
                              ("ex", "מטבע")]),
    ("option_sum",    MONEY, [("file", X_OPT_SUM)]),
    ("option_cumulative", MONEY, [("file", X_OPT_CUM)]),
    ("option_exercised", DATE, [("file", X_OPT_DATE)]),
    ("option_request", IDNUM, [("file", X_OPT_REQ)]),
    ("continuation_date", DATE, [("file", X_CONT_DATE)]),
    ("continuation_sum", MONEY, [("file", X_CONT_SUM)]),
    ("continuation_reason", TEXT, [("file", X_CONT_REASON)]),
    ("continuation_request", IDNUM, [("file", X_CONT_REQ)]),
    ("total_cumulative", MONEY, [("file", X_TOTAL_CUM)]),
    ("ordered_date",  DATE,  [("file", X_ORDERED), ("bk", "order_date")]),
    # contract_spending.start_date is 100% NULL (measured) — it sits last as a
    # formality; the register is the real source, 57% after the parser fix
    ("starts_date",   DATE,  [("ex", "תאריך תחילת תקופת התקשרות"),
                              ("tn", "תאריך תחילת תקופת התקשרות"),
                              ("bk", "start_date")]),
    ("ends_date",     DATE,  [("file", X_ENDS), ("bk", "end_date"),
                              ("ex", "תאריך סיום תקופת התקשרות"),
                              ("tn", "תאריך סיום תקופת התקשרות")]),
    # authorisation — the registers' own territory, nothing else has these
    ("approver",      TEXT,  [("ex", "גורם מאשר")]),
    ("decision",      TEXT,  [("ex", "מהות החלטה")]),
    ("publication_status", TEXT, [("ex", "סטטוס"), ("tn", "סטטוס")]),
    ("published_date", DATE, [("ex", "תאריך פרסום"), ("tn", "תאריך פרסום")]),
    ("updated_date",  DATE,  [("ex", "תאריך עדכון"), ("tn", "תאריך עדכון")]),
    # after the ss:Index fix this is a bare document id, not a URL — stored as
    # found; the site builds the link at display time
    ("documents_ref", TEXT,  [("ex", "לינק לטקסטים")]),
    ("topics",        TEXT,  [("ex", "נושאים"), ("tn", "נושאים")]),
    ("first_year",    YEAR,  [("bk", "min_year")]),
    ("last_year",     YEAR,  [("bk", "max_year")]),
    ("sensitive",     FLAG,  [("bk", "sensitive_order")]),
    ("active",        FLAG,  [("bk", "contract_is_active")]),
]

KIND_FN = {TEXT: canon_text, DATE: canon_date, MONEY: canon_num,
           CODE: canon_code, IDNUM: canon_id, YEAR: canon_year,
           FLAG: canon_flag}

# BudgetKey free texts, kept whole under one roof (החלטת מרסי 24.08: לשמור)
BK_NOTES = ("explanation", "buyer_description", "manof_ref", "manof_excerpts")

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


def _pub_candidates(file_rows, bk_rows):
    """Every publication number any row offers, file first (it links at 54%
       against tender_key's 24%). '0' is the ministry's way of writing none,
       and one file cell in ~350 carries SEVERAL numbers, comma-separated —
       split, never concatenated (canon_id would weld them into one)."""
    seen, out = set(), []
    for view in file_rows:
        for n in re.findall(r"\d+", str(view.get(X_PUB) or "")):
            if n != "0" and n not in seen:
                seen.add(n); out.append((n, "file"))
    for r in bk_rows:
        n = _publication(r)
        if n and n != "0" and n not in seen:
            seen.add(n); out.append((n, "bk"))
    return out


def _register_row(rows, company_id):
    """One publication can carry several register rows (21,786 do — one per
       supplier). Prefer the row about OUR supplier; otherwise the first."""
    if company_id:
        for r in rows:
            if canon_id(r.get("מספר חפ ספק")) == company_id:
                return r
    return rows[0]


def merge_contract(order_id, bk_rows, file_rows, ex_index=None, tn_index=None):
    """One contract. bk_rows / file_rows are every row for this order_id,
       across budget codes; ex_index / tn_index map a publication number to
       its register rows (each row a {column: value} dict)."""
    file_views = [file_view(r) for r in file_rows]
    bk_primary = bk_rows[0] if bk_rows else None
    file_primary = file_views[0] if file_views else None

    # the registers join through the publication number — resolved before the
    # fields, because register-sourced fields depend on it
    candidates = _pub_candidates(file_views, bk_rows)
    publication, pub_src = (candidates[0] if candidates else (None, None))
    ex_row = tn_row = None
    hp = canon_id(file_primary.get(X_HP)) if file_primary else None
    for n, src in candidates:
        if ex_row is None and ex_index and n in ex_index:
            ex_row = _register_row(ex_index[n], hp)
            publication, pub_src = n, src
        if tn_row is None and tn_index and n in tn_index:
            tn_row = _register_row(tn_index[n], hp)
            if ex_row is None:
                publication, pub_src = n, src
        if ex_row is not None and tn_row is not None:
            break

    sources = {"bk": bk_primary, "file": file_primary,
               "ex": ex_row, "tn": tn_row}
    out, prov = {}, {}
    for field, kind, order in FIELDS:
        value, src, _ = resolve(field, kind, order, sources)
        out[field] = value
        prov[field] = src

    # allocations: the ministry's own newest report decides which budget codes
    # are live. Rows BudgetKey holds under codes the file no longer uses are
    # historical — kept, labelled, never added to a total.
    live = {canon_code(v.get(X_CODE)) for v in file_views if canon_code(v.get(X_CODE))}
    allocations, historical = [], []
    seen = set()
    for v in file_views:
        code = canon_code(v.get(X_CODE))
        if not code or code in seen:
            continue
        seen.add(code)
        allocations.append({"budget_code": code,
                            "volume": canon_num(v.get(X_VOLUME)),
                            "paid": canon_num(v.get(X_PAID)),
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

    notes = {}
    for r in bk_rows:
        for k in BK_NOTES:
            if k in NEVER_READ:
                raise AssertionError("rule 7: %s must never be read" % k)
            t = canon_text(r.get(k))
            if t and k not in notes:
                notes[k] = t

    out["order_id"] = order_id
    out["publication"] = publication
    if publication:
        prov["publication"] = pub_src
    out["allocations"] = allocations
    out["historical_allocations"] = historical
    out["reports"] = _reports(bk_rows)
    if notes:
        out["notes"] = notes
        prov["notes"] = "bk"
    # a matched register row counts as a source even when every one of its
    # fields lost to a better one — the join itself is information
    joined = {s for s, row in (("ex", ex_row), ("tn", tn_row)) if row is not None}
    out["sources"] = sorted({s for s in prov.values() if s and s != "all-zero"}
                            | joined)
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
    """A single JSON of rows, or — the collect-budgetkey shape — a DIRECTORY
       of per-section pulls (build/raw/<sec>.json, each a bare list)."""
    by_order = defaultdict(list)
    if not path:
        return by_order
    if os.path.isdir(path):
        paths = [os.path.join(path, n) for n in sorted(os.listdir(path))
                 if n.endswith(".json") and n != "status.json"]
    else:
        paths = [path]
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            rows = json.load(fh)
        for r in (rows.get("rows") if isinstance(rows, dict) else rows):
            oid = canon_id(r.get("order_id"))
            if oid:
                by_order[oid].append(r)
    return by_order


def load_register(path, log=print):
    """An mr.gov.il register conversion ({columns, rows:[[…]]}, from
       parse_portal_export.py) → {publication: [{column: value}, …]}."""
    if not path:
        return None
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    cols = doc.get("columns") or []
    if R_PUB not in cols:
        sys.exit("%s has no '%s' column — not a register conversion "
                 "(columns were: %s)" % (path, R_PUB, cols[:6]))
    ipub = cols.index(R_PUB)
    index = defaultdict(list)
    for row in doc.get("rows") or []:
        pub = canon_id(row[ipub] if ipub < len(row) else None)
        if pub:
            index[pub].append({c: v for c, v in zip(cols, row) if v != ""})
    log("register %s: %d rows · %d publications"
        % (os.path.basename(path), len(doc.get("rows") or []), len(index)))
    return index


def _section_of(contract):
    """The first 4 digits of the (10-digit) code — the SAME cut parse_report
       makes, so a contract lands in the section file the site already loads
       its payment data from."""
    for a in contract.get("allocations") or []:
        if a.get("budget_code"):
            return a["budget_code"][:4]
    code = contract.get("budget_code")
    return code[:4] if code else "0000"


def build(files_dir, bk_path, out_dir, ex_path=None, tn_path=None, log=print):
    files = load_files(files_dir)
    bk = load_budgetkey(bk_path)
    ex_index = load_register(ex_path, log=log)
    tn_index = load_register(tn_path, log=log)
    every_order = sorted(set(files) | set(bk))       # UNION, not either side

    out = [merge_contract(o, bk.get(o, []), files.get(o, []), ex_index, tn_index)
           for o in every_order]

    # one file per budget section — the same shape the site already loads the
    # payment data in, and the only shape that keeps a full-scale build out of
    # one unmanageable file
    by_section = defaultdict(list)
    for c in out:
        by_section[_section_of(c)].append(c)
    os.makedirs(out_dir, exist_ok=True)
    for sec, contracts in sorted(by_section.items()):
        with open(os.path.join(out_dir, sec + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"contracts": contracts}, fh, ensure_ascii=False,
                      separators=(",", ":"))
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"sections": sorted(by_section),
                   "contracts": len(out)}, fh, ensure_ascii=False)

    only_file = sum(1 for o in every_order if o in files and o not in bk)
    only_bk = sum(1 for o in every_order if o in bk and o not in files)
    filled = defaultdict(int)
    for c in out:
        for k, v in (c.get("provenance") or {}).items():
            filled[v] += 1
    joined = sum(1 for c in out if "ex" in c["sources"] or "tn" in c["sources"])
    log("contracts: %d  (file only: %d · BudgetKey only: %d · both: %d)"
        % (len(out), only_file, only_bk, len(out) - only_file - only_bk))
    log("fields filled by source: %s"
        % ", ".join("%s %d" % kv for kv in sorted(filled.items())))
    if ex_index is not None or tn_index is not None:
        log("register joined: %d of %d contracts" % (joined, len(out)))
    log("written: %s (%d sections)" % (out_dir, len(by_section)))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", help="dir of <section>.full.json")
    ap.add_argument("--budgetkey",
                    help="contract_spending rows: one json, or build/raw dir")
    ap.add_argument("--exemptions", help="the exemptions register json")
    ap.add_argument("--tenders", help="the tenders register json")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = build(a.files, a.budgetkey, a.out, a.exemptions, a.tenders)
    # Asking for a source and getting nothing from it is not a smaller
    # dataset, it is a WRONG one — every field that source alone fills goes
    # quietly empty behind a green tick. Loud, or not at all.
    if a.budgetkey and not any("bk" in c["sources"] for c in out):
        sys.exit("no contract took a single field from BudgetKey — "
                 "the merge had only one source; refusing to call this a build")
    if a.exemptions and not any("ex" in c["sources"] for c in out):
        sys.exit("the exemptions register joined ZERO contracts — the "
                 "publication-number join is broken; refusing to call this a build")
    if a.tenders and not any("tn" in c["sources"] for c in out):
        sys.exit("the tenders register joined ZERO contracts — the "
                 "publication-number join is broken; refusing to call this a build")
    if not a.budgetkey:
        print("NOTE: built WITHOUT BudgetKey — supplier identity (entity_id), "
              "the reports[] history and every bk-only field are empty. "
              "Fine for a file+register trial; not the real dataset.")
