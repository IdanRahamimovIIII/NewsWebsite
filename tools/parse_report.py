#!/usr/bin/env python3
"""
Turn one ministry's quarterly procurement report (.xlsx, as published on
gov.il) into the compact JSON the budget page reads.

WHY THIS EXISTS
---------------
BudgetKey ingests these same files but does not map the payment column: for
משרד החינוך's 2025 Q1 report it records the order value to the agora and the
amount paid as 0.00 — ₪7.8bn of payments reading as zero, with no parse error
flagged. Verified against four contracts, 2026-08-22. Until that is fixed
upstream we read the ministry's own file for the paid figure.

THE COLUMNS (headers are irregular — match loosely, never by exact string):
  ערך ההזמנה כולל מע"מ                        → volume
  ב. חשבוניות מצטבר + מע"מ והצמדות במט"מ      → paid, CUMULATIVE to the report
  ביצוע חשבוניות  לתקופת הדוח' במטבע מקומי    → paid during the report period
                                                (only ~45% filled — not used)
  הזמנת רכש                                   → order_id
  תקנה תקציבית                                → budget code, 8 digits, no '00'

usage: parse_report.py <file.xlsx> <out-dir> [--source-url URL]
"""
import json, os, re, sys, unicodedata
import openpyxl

def norm(s):
    s = unicodedata.normalize("NFKC", str(s or ""))
    return re.sub(r"[\s‏‎]+", " ", s).strip()

def num(v):
    if v in (None, ""): return 0.0
    try: return float(str(v).replace(",", "").replace("‏", ""))
    except ValueError: return 0.0

# loose matchers, in priority order — the headers carry typos ("במט\"מ" for
# "במט\"ח"), double spaces and stray apostrophes, so exact matching is a trap
WANT = {
    "order":  [lambda h: "הזמנת רכש" in h],
    "code":   [lambda h: "תקנה תקציבית" in h],
    "vol":    [lambda h: "ערך ההזמנה" in h],
    "paid":   [lambda h: "חשבוניות" in h and "מצטבר" in h],
    "period": [lambda h: "חשבוניות" in h and "לתקופת" in h],
    "supp":   [lambda h: h.strip() == "שם הספק"],
}

def find_cols(hdr):
    out = {}
    for key, tests in WANT.items():
        for i, h in enumerate(hdr):
            hh = norm(h)
            if any(t(hh) for t in tests):
                out[key] = i
                break
    missing = [k for k in ("order", "code", "vol", "paid") if k not in out]
    if missing:
        raise SystemExit("columns not found: %s\nheaders were: %s"
                         % (missing, [norm(h) for h in hdr]))
    return out

VINTAGE = re.compile(r"[_/]([a-z\-]+)_([1-4])_(20\d\d)")

def report_vintage(text):
    """education_1_2025 → ("education", "2025Q1"). The quarter and year are in
       every gov.il filename; nothing else in the file records them."""
    m = VINTAGE.search(str(text).lower())
    return (m.group(1), f"{m.group(3)}Q{m.group(2)}") if m else None

def main(src, outdir, source_url=""):
    """Writes ONE FILE PER BUDGET SECTION (the first 4 digits), merging into
       whatever is already there. A ministry's report is not confined to its
       own section — the education file carries 7 rows under 0054 — and the
       page loads by section, so the shape on disk has to follow the tree,
       not the ministry."""
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    by_section, full_by_section, rows, paid_rows, dupes = {}, {}, 0, 0, 0
    for sh in wb.sheetnames:
        ws = wb[sh]
        it = ws.iter_rows(values_only=True)
        hdr_raw = next(it)
        cols = find_cols(hdr_raw)
        for r in it:
            oid = norm(r[cols["order"]])
            if not oid: continue
            code = re.sub(r"\D", "", norm(r[cols["code"]]))
            if not code: continue
            code = "00" + code if len(code) == 8 else code
            key = oid + ":" + code
            paid, vol = num(r[cols["paid"]]), num(r[cols["vol"]])
            rows += 1
            if paid <= 0: continue
            paid_rows += 1
            sec = by_section.setdefault(code[:4], {})
            if key in sec:
                # one order can be split across rows; the report repeats the
                # cumulative figure, so take the largest rather than summing
                dupes += 1
                if paid <= sec[key][0]: continue
            sec[key] = [round(paid, 2), round(vol, 2)]

            # …and the WHOLE row, for the comparison tool. The lean file above
            # is what the budget page loads; this one is what an auditor needs.
            # Keys stay as the ministry spelled them — renaming them would hide
            # exactly the thing someone checking us wants to see.
            full = full_by_section.setdefault(code[:4], {})
            rec = {}
            for h, v in zip(hdr_raw, r):
                hk = norm(h)
                if not hk or v in (None, ""): continue
                if isinstance(v, (int, float)):
                    rec[hk] = round(float(v), 2)
                else:
                    txt = norm(v)
                    if txt and txt != "0.00" and txt != "0":
                        rec[hk] = txt
            full[key] = rec

    os.makedirs(outdir, exist_ok=True)
    for sec, orders in sorted(by_section.items()):
        path = os.path.join(outdir, sec + ".json")
        doc = {"sources": [], "orders": {}}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
        if source_url and source_url not in doc["sources"]:
            doc["sources"].append(source_url)
        # record WHICH report this came from. When BudgetKey and a file
        # disagree, the newer report is the one to believe — without the
        # vintage there is no way to tell which that is.
        v = report_vintage(source_url or src)
        if v:
            doc.setdefault("reports", {})[v[0]] = v[1]
        doc["orders"].update(orders)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {sec}.json  +{len(orders):>5}  total {len(doc['orders']):>5}")
    for sec, recs in sorted(full_by_section.items()):
        path = os.path.join(outdir, sec + ".full.json")
        doc = {"sources": [], "orders": {}}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
        if source_url and source_url not in doc["sources"]:
            doc["sources"].append(source_url)
        doc["orders"].update(recs)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {sec}.full.json  {len(doc['orders']):>5} רשומות מלאות")

    # a manifest, so the page can tell "this ministry has no file yet" (normal)
    # apart from "the data folder never got deployed" (a bug that otherwise
    # shows up as dashes everywhere and no error at all)
    secs = sorted(f[:-5] for f in os.listdir(outdir)
                  if f.endswith(".json") and f != "index.json"
                  and not f.endswith(".full.json"))
    with open(os.path.join(outdir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"sections": secs}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  index.json  sections: {', '.join(secs)}")
    print(f"{os.path.basename(src)}: rows {rows}, with a paid figure {paid_rows}, "
          f"repeated keys {dupes}")

if __name__ == "__main__":
    a = sys.argv[1:]
    url = ""
    if "--source-url" in a:
        i = a.index("--source-url"); url = a[i + 1]; a = a[:i] + a[i + 2:]
    main(a[0], a[1], url)
