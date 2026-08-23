#!/usr/bin/env python3
"""
fetch_budgetkey.py — pull the contract_spending rows for a set of budget
sections, so build_dataset.py has a SECOND source to merge against.

WHY THIS EXISTS
  The first automated run built site/data/contracts/contracts.json and printed:

      contracts: 2455  (file only: 2455 · BudgetKey only: 0 · both: 0)

  Zero from BudgetKey. The merge was doing nothing — it was the ministry's own
  spreadsheet, reshaped. Rule 2 asks for a COMBINED database and rule 4 asks
  every cell to be filled from wherever it can be; neither is possible with one
  source in the room. entity_kind and budget_title exist only in BudgetKey, the
  full supplier resolution exists only in BudgetKey, and every contract that
  BudgetKey holds but the newest report does not was simply absent.

HOW IT PAGES
  The API caps how many rows it will return and gives no cursor. ORDER BY over
  a large unindexed slice times out (we learned that the hard way with
  DISTINCT ON over the report table). So this walks the budget code TREE:
  ask for '0020%'; if the answer comes back full it is probably truncated, so
  ask '00200%', '00201%' … and so on, one digit deeper each time. Buckets that
  fit are taken whole. Only at a complete 10-digit code — a slice small enough
  to sort — does it fall back to keyset paging on order_id.

  A full bucket might be exactly full rather than truncated. Splitting it
  anyway costs ten cheap queries and cannot lose a row; assuming it was
  complete could lose thousands. We split.

WHAT IT SELECTS
  Only the columns the merge actually reads, and it asks the table which
  columns exist first. A column we want that is missing is printed by name and
  loudly counted — never silently dropped, which is how a field goes quietly
  empty and nobody notices for a month.

usage:
  fetch_budgetkey.py --sections 0020,0024 --out reports/budgetkey.json
"""
import argparse, json, os, sys, time
import urllib.parse, urllib.request

API = "https://next.obudget.org/api/query"
UA = {"User-Agent": "our-money/1.0 (+https://github.com/) python-urllib"}
TABLE = "contract_spending"

# every column the merge reads, and nothing else
WANT = [
    "order_id", "budget_code", "budget_title", "publisher_name",
    "purchasing_unit", "supplier_name", "entity_name", "entity_kind",
    "company_id", "supplier_code", "purpose", "purchase_method",
    "exemption_reason", "volume", "executed", "order_date", "end_date",
    "tender_key", "payments", "min_year", "max_year",
]

# rule 7. These are lifetime totals divided by a year count. Reading one is
# how we once shipped a "paid this year" column that was an average.
NEVER_READ = {"volume_per_year", "executed_per_year"}

PAGE = 1000          # rows per request; a full page is treated as truncated
MAX_DEPTH = 10       # a budget code is 10 digits


def bk(sql, rows=PAGE, timeout=180):
    url = API + "?query=" + urllib.parse.quote(sql) + "&num_rows=%d" % rows
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        doc = json.load(r)
    if doc.get("success") is False:
        raise RuntimeError(doc.get("error", "budgetkey error"))
    return doc.get("rows") or []


def columns(log=print):
    """Ask the table what it has. Anything on WANT that is missing gets named."""
    probe = bk("SELECT * FROM %s LIMIT 1" % TABLE, rows=1)
    if not probe:
        raise RuntimeError("%s returned no rows at all — cannot read its shape" % TABLE)
    have = set(probe[0].keys())
    forbidden = [c for c in WANT if c in NEVER_READ]
    if forbidden:                       # a guard against our own future edits
        raise RuntimeError("rule 7: %s must never be selected" % ", ".join(forbidden))
    missing = [c for c in WANT if c not in have]
    for c in missing:
        log("  ! %s.%s does not exist — every field that reads it will be empty"
            % (TABLE, c))
    return [c for c in WANT if c in have], missing


def select(cols, where, extra=""):
    return "SELECT %s FROM %s WHERE %s %s" % (", ".join(cols), TABLE, where, extra)


def by_code(prefix, cols, out, stats, log=print, depth=None):
    """Everything under a budget-code prefix, splitting when the page fills."""
    depth = len(prefix) if depth is None else depth
    rows = bk(select(cols, "budget_code LIKE '%s%%'" % prefix))
    stats["queries"] += 1
    if len(rows) < PAGE:
        out.extend(rows)
        if rows:
            log("  %-11s %6d" % (prefix, len(rows)))
        return
    if depth >= MAX_DEPTH:
        keyset(prefix, cols, out, stats, log)
        return
    log("  %-11s full page — splitting" % prefix)
    # a code exactly equal to the prefix would fall between the children
    exact = bk(select(cols, "budget_code = '%s'" % prefix))
    stats["queries"] += 1
    out.extend(exact)
    for d in "0123456789":
        by_code(prefix + d, cols, out, stats, log, depth + 1)
        time.sleep(0.2)


def keyset(code, cols, out, stats, log=print):
    """One complete code with more rows than a page: small enough to sort."""
    last = ""
    while True:
        rows = bk(select(cols, "budget_code = '%s' AND order_id > '%s'" % (code, last),
                         "ORDER BY order_id"))
        stats["queries"] += 1
        if not rows:
            return
        out.extend(rows)
        log("  %-11s %6d (keyset from %s)" % (code, len(rows), last or "start"))
        nxt = rows[-1].get("order_id")
        if not nxt or nxt == last:
            log("  ! %s cannot page further — stopping to avoid a loop" % code)
            return
        last = nxt
        if len(rows) < PAGE:
            return


def run(sections, out_path, log=print):
    cols, missing = columns(log=log)
    log("selecting %d columns%s" % (len(cols),
        ", %d missing" % len(missing) if missing else ""))

    rows, stats = [], {"queries": 0}
    for sec in sections:
        before = len(rows)
        try:
            by_code(sec, cols, rows, stats, log=log)
        except Exception as e:
            log("  x section %s failed: %s" % (sec, e))
            continue
        log("section %s → %d rows" % (sec, len(rows) - before))

    seen, unique = set(), []
    for r in rows:                      # a split can re-read a boundary row
        k = (r.get("order_id"), r.get("budget_code"), r.get("volume"),
             r.get("executed"))
        if k in seen:
            continue
        seen.add(k)
        unique.append(r)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(unique, fh, ensure_ascii=False, separators=(",", ":"))
    orders = len({r.get("order_id") for r in unique if r.get("order_id")})
    log("%d rows · %d distinct orders · %d queries · %.1f MB → %s"
        % (len(unique), orders, stats["queries"],
           os.path.getsize(out_path) / 1e6, out_path))
    return {"rows": len(unique), "orders": orders, "missing": missing}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", default="",
                    help="comma separated, e.g. 0020,0024 (blank = 0001..0099)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    secs = [s.strip() for s in a.sections.split(",") if s.strip()] \
        or ["%04d" % n for n in range(1, 100)]
    # these go straight into SQL, and on GitHub they come from a text box
    bad = [s for s in secs if not s.isdigit()]
    if bad:
        sys.exit("budget sections must be digits only, got: %s" % ", ".join(bad))
    res = run(secs, a.out)
    sys.exit(1 if res["rows"] == 0 else 0)
