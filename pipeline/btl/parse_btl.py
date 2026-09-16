#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""parse_btl.py — parse the 5 unemployment tables (chapter 15) into one snapshot.

Reads raw\\latest\\O15*.XLS (fetched by fetch_btl.py), applies every trap in
NOTES.md, and with --publish writes KV pub:btl-unemployment -> served as
/data/btl-unemployment. Needs xlrd (pip install xlrd) — the workflow installs
it; this is the CI-run step, not a Mercy-run step.

Layout every file shares (verified against the live files):
  title rows -> merged header rows -> annual rows (year in col 0, data from
  col 3; col 2 may hold a footnote marker) -> for the last years: monthly rows
  (Roman numeral in col 1) under a year context set by the last annual row or
  a bare-year row like [2026] -> footnote rows (small int in col 0 + text).
".." = no data. Constant-price columns are kept in the snapshot but the site
displays current prices only (Mercy). 15.2's 1991-93 rows carry a
suspected-wrong flag (unresolvable source bug, shown to readers).
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent
LATEST = ROOT / "raw" / "latest"

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6,
         "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}

BANDS = ["total", "upto_half", "half_to_3q", "3q_to_full", "above_avg"]
SPECS = {
    "O1501.XLS": {
        "key": "payments", "table": "15.1",
        "title": "תשלומי גמלאות אבטלה (אלפי ש\"ח)",
        "cols": ["total", "benefits", "external",
                 "total_const", "benefits_const", "external_const"],
    },
    "O1502.XLS": {
        "key": "by_wage", "table": "15.2",
        "title": "מקבלי דמי אבטלה לפי רמת השכר ערב האבטלה",
        "cols": BANDS,
        # unresolvable source bug: rows duplicate 15.4's group values;
        # PDF twin is no help. Shown to readers as suspected-wrong (Mercy).
        "suspect_years": [1991, 1992, 1993],
    },
    "O1503.XLS": {
        "key": "daily_avg", "table": "15.3",
        "title": "דמי אבטלה ממוצעים ליום (ש\"ח, ממוצע משוקלל)",
        "cols": (BANDS + [b + "_const" for b in BANDS]
                 + [b + "_pct_avg_wage" for b in BANDS]),
    },
    "O1504.XLS": {
        "key": "by_group", "table": "15.4",
        "title": "מקבלי דמי אבטלה לפי קבוצות",
        "cols": ["total", "women", "men", "olim", "under_35",
                 "soldiers", "training"],
    },
    "O1505.xls": {
        "key": "grants", "table": "15.5",
        "title": "מענק לחיילים משוחררים שעבדו בעבודה מועדפת",
        "cols": ["recipients", "grant", "payments",
                 "grant_const", "payments_const", "grant_pct_avg_wage"],
    },
}

# hand-verified values that must never drift — a wrong parse fails here,
# loudly, before anything is published
ANCHORS = [
    ("payments", 2010, "benefits", 2425976),
    ("by_wage", 2024, "total", 102189),
    ("by_group", 1994, "total", 61173),
    ("daily_avg", 1993, "total", 51.2),
    ("grants", 1994, "recipients", 10749),
]


def norm(v):
    """cell -> int/float/str/None. '..' and '' are None; floats that are whole
    numbers become ints (xlrd reads every number as float)."""
    if isinstance(v, str):
        s = v.strip()
        if s in ("", "..", "-"):
            return None
        try:
            f = float(s.replace(",", ""))
            return int(f) if f == int(f) else f
        except ValueError:
            return s
    if isinstance(v, float):
        return int(v) if v == int(v) else v
    return v


def parse_file(path: Path, spec: dict) -> dict:
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_index(0)
    ncols = len(spec["cols"])
    annual, monthly, notes = [], [], []
    price_base, year_ctx = None, None

    for r in range(sheet.nrows):
        row = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
        c0, c1 = norm(row[0]) if row else None, norm(row[1]) if len(row) > 1 else None

        # base year of the constant-price block, read from the header —
        # it moves every edition, never hardcode (NOTES)
        if price_base is None:
            for cell in row:
                if isinstance(cell, str):
                    m = re.search(r"מחירי\s*(\d{4})", cell)
                    if m:
                        price_base = int(m.group(1))
                        break

        vals = [norm(v) for v in row[3:3 + ncols]]
        vals += [None] * (ncols - len(vals))

        if isinstance(c0, int) and c0 < 100 and isinstance(c1, str) and len(c1) > 8:
            notes.append(c1.strip())                       # footnote row
        elif isinstance(c0, int) and 1900 < c0 < 2100:
            year_ctx = c0
            if any(v is not None for v in vals):           # annual data row
                annual.append({"year": c0, **dict(zip(spec["cols"], vals))})
            # else: bare-year row like [2026] — context only
        elif c0 is None and isinstance(c1, str) and c1.strip() in ROMAN:
            if year_ctx is None:
                raise RuntimeError("%s row %d: month with no year context" % (path.name, r))
            monthly.append({"year": year_ctx, "month": ROMAN[c1.strip()],
                            **dict(zip(spec["cols"], vals))})

    out = {"table": spec["table"], "file": path.name, "title": spec["title"],
           "columns": spec["cols"], "annual": annual, "monthly": monthly,
           "notes": notes}
    if price_base:
        out["price_base"] = price_base
    if "suspect_years" in spec:
        out["suspect_years"] = spec["suspect_years"]
        out["suspect_note"] = ("ערכי 1991–1993 חשודים כשגויים במקור "
                               "(זהים לנתוני טבלה 15.4); גם ב-PDF הרשמי.")
    return out


def sanity(tables: dict) -> None:
    for key, t in tables.items():
        if len(t["annual"]) < (15 if key == "payments" else 25):
            raise RuntimeError("%s: only %d annual rows — layout changed?"
                               % (key, len(t["annual"])))
        latest = max(r["year"] for r in t["annual"] + t["monthly"])
        if latest < 2025:
            raise RuntimeError("%s: newest year %d — stale or misparsed" % (key, latest))
        if not t["monthly"]:
            raise RuntimeError("%s: no monthly rows parsed" % key)
    for key, year, col, want in ANCHORS:
        rows = [r for r in tables[key]["annual"] if r["year"] == year]
        got = rows[0].get(col) if rows else None
        if got != want:
            raise RuntimeError("anchor failed: %s %d %s = %r, expected %r"
                               % (key, year, col, got, want))


def publish(data: dict) -> int:
    sys.path.insert(0, str(ROOT.parent / "shared"))
    import cf_kv
    cred = cf_kv.credentials(str(ROOT.parent / "d1-config.json"))
    if not cred:
        print("FAIL publish: no Cloudflare credentials")
        return 1
    ns = cf_kv.namespace_id(cred)
    value = cf_kv.envelope(data)
    cf_kv.bulk_put(cred, ns, [("pub:btl-unemployment", value)])
    bad = cf_kv.verify(cred, ns, [("pub:btl-unemployment", value)])
    if bad:
        print("FAIL publish read-back:", "; ".join(bad))
        return 1
    print("OK   published pub:btl-unemployment (%d bytes) — read back and matched"
          % len(value))
    relay = cf_kv.relay_url(str(ROOT.parent)) or ""
    if relay:
        status, body, _ = cf_kv.relay_get(relay + "/data/btl-unemployment")
        print("     relay check -> HTTP %d, %d bytes%s" % (status, len(body),
              "" if status == 200 else "  (edge caches ~1h — recheck later)"))
    return 0


def main() -> int:
    tables = {}
    for name, spec in SPECS.items():
        path = LATEST / name
        if not path.exists():
            print("FAIL: %s missing — run fetch_btl.py first" % path)
            return 1
        t = parse_file(path, spec)
        tables[spec["key"]] = t
        print("OK   %s (%s): %d annual + %d monthly rows, %d notes"
              % (t["table"], name, len(t["annual"]), len(t["monthly"]), len(t["notes"])))
    sanity(tables)
    print("OK   sanity: counts, freshness, %d hand-verified anchors" % len(ANCHORS))
    data = {
        "source": "https://www.btl.gov.il/Publications/quarterly/unemployment/Pages/default.aspx",
        "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tables": tables,
    }
    (LATEST / "btl-unemployment.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    if "--publish" in sys.argv:
        return publish(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
