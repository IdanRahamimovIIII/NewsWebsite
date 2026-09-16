#!/usr/bin/env python3
"""fetch_budgetkey.py — pull the contract_spending rows for a set of
budget sections, so build_dataset.py has a second source to merge against
(entity resolution, budget_title, the payments[] history and every contract
the newest ministry report no longer lists exist only there).

HOW IT PAGES: the API caps rows per answer and gives no cursor; ORDER BY
over a large unindexed slice times out. So walk the budget-code TREE —
'0020%', and when an answer comes back full (possibly truncated) split one
digit deeper; splitting a bucket that was exactly full costs ten cheap
queries, assuming it was complete could lose thousands. Only a slice small
enough to sort falls back to keyset paging on (order_id, budget_code).

Collects EVERY column the table has (decide later, not at collection);
a wanted column missing upstream is named LOUDLY, never dropped quietly.

usage:
  fetch_budgetkey.py --sections 0020,0024 --out reports/budgetkey.json
"""
import argparse, json, os, sys, time
import urllib.parse, urllib.request

API = "https://next.obudget.org/api/query"
UA = {"User-Agent": "our-money/1.0 (+https://github.com/) python-urllib"}
TABLE = "contract_spending"

# the columns the MERGE reads (not the collection list — everything is
# collected); a column vanishing upstream is reported by name.
WANT = [
    "order_id", "budget_code", "budget_title", "publisher_name",
    "purchasing_unit", "supplier_name", "entity_name", "entity_kind",
    "company_id", "supplier_code", "purpose", "purchase_method",
    "exemption_reason", "volume", "executed", "order_date", "end_date",
    "tender_key", "payments", "min_year", "max_year",
]

# rule 7: lifetime totals divided by a year count — never a measurement.
NEVER_READ = {"volume_per_year", "executed_per_year"}

PAGE = 1000          # first guess at rows per request, until the API says otherwise
MAX_DEPTH = 10       # a budget code is 10 digits
KEYSET_MAX = 200000  # above this a slice is split by code instead of sorted


def bk(sql, rows=PAGE, timeout=180):
    url = API + "?query=" + urllib.parse.quote(sql) + "&num_rows=%d" % rows
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        doc = json.load(r)
    if doc.get("success") is False:
        raise RuntimeError(doc.get("error", "budgetkey error"))
    return doc.get("rows") or []


def columns(log=print):
    """EVERY column the table has, minus the two computed averages
       (rule 7). Collect the column, decide later — dropping one at
       collection is irreversible without re-downloading a million rows."""
    probe = bk("SELECT * FROM %s LIMIT 1" % TABLE, rows=1)
    if not probe:
        raise RuntimeError("%s returned no rows at all — cannot read its shape" % TABLE)
    have = list(probe[0].keys())
    dropped = [c for c in have if c in NEVER_READ]
    cols = [c for c in have if c not in NEVER_READ]
    if dropped:
        log("  not collecting %s — computed averages, rule 7" % ", ".join(dropped))
    missing = [c for c in WANT if c not in have]
    for c in missing:
        log("  ! %s.%s does not exist — every field that reads it will be empty"
            % (TABLE, c))
    log("  %s has %d columns; collecting %d" % (TABLE, len(have), len(cols)))
    return cols, missing


def select(cols, where, extra=""):
    return "SELECT %s FROM %s WHERE %s %s" % (", ".join(cols), TABLE, where, extra)


CAP = [None]        # how many rows the API will really hand over; learned once


def how_many(where, stats):
    """count(1) before fetching — a prefix count on budget_code is an index
       range (cheap), and knowing the size first saves throwaway pages."""
    stats["queries"] += 1
    rows = bk("SELECT count(1) AS n FROM %s WHERE %s" % (TABLE, where), rows=1)
    return int((rows[0] if rows else {}).get("n") or 0)


def by_code(prefix, cols, out, stats, log=print, depth=None):
    """Everything under a budget-code prefix. Count first; ask for exactly that
       many; split only when the API hands back fewer than exist."""
    depth = len(prefix) if depth is None else depth
    where = "budget_code LIKE '%s%%'" % prefix
    try:
        n = how_many(where, stats)
    except Exception as e:                  # if count is refused, fall back
        log("  %-11s count failed (%s) — paging blind" % (prefix, e))
        n = None
    if n == 0:
        return

    want = PAGE if n is None else n
    if CAP[0]:
        want = min(want, CAP[0])
    rows = bk(select(cols, where), rows=max(want, 1))
    stats["queries"] += 1

    complete = (n is not None and len(rows) >= n) or (n is None and len(rows) < PAGE)
    if complete:
        out.extend(rows)
        log("  %-11s %6d" % (prefix, len(rows)))
        return

    if n is not None and CAP[0] != len(rows):
        CAP[0] = len(rows)                  # now we know the ceiling
        log("  the API returns at most %d rows per query" % CAP[0])

    # too big for one query: paging in order beats splitting six digits
    # deep (ten counts per level); sorting is safe now the size is known
    if n is not None and n <= KEYSET_MAX:
        keyset(where, cols, out, stats, log, label=prefix, expected=n)
        return
    if depth >= MAX_DEPTH:
        keyset(where, cols, out, stats, log, label=prefix, expected=n)
        return
    log("  %-11s %d rows, too many to sort — splitting" % (prefix, n or -1))
    # a code exactly equal to the prefix would fall between the children
    stats["queries"] += 1
    out.extend(bk(select(cols, "budget_code = '%s'" % prefix)))
    for d in "0123456789":
        by_code(prefix + d, cols, out, stats, log, depth + 1)
        time.sleep(0.2)


def keyset(where, cols, out, stats, log=print, label="", expected=None):
    """Page a slice in order, carrying the last row read as the cursor.

       The cursor is (order_id, budget_code), not order_id alone: one order is
       charged to several budget codes, so a page boundary can fall inside a
       group of rows sharing an order_id and the rest would be stepped over.

       Rows with no order_id sort outside a tuple comparison, so they are
       fetched separately rather than quietly left behind — they cannot be
       merged onto a contract anyway, but we say so out loud."""
    page = CAP[0] or PAGE
    stats["queries"] += 1
    orphans = bk(select(cols, "%s AND order_id IS NULL" % where), rows=page)
    if orphans:
        log("  ! %s: %d rows carry no order_id — kept, but nothing can join them"
            % (label, len(orphans)))
        out.extend(orphans)

    last, total = None, 0
    while True:
        cond = where + " AND order_id IS NOT NULL"
        if last:
            cond += " AND (order_id, budget_code) > ('%s', '%s')" % last
        rows = bk(select(cols, cond, "ORDER BY order_id, budget_code"), rows=page)
        stats["queries"] += 1
        if not rows:
            break
        out.extend(rows)
        total += len(rows)
        nxt = (rows[-1].get("order_id") or "", rows[-1].get("budget_code") or "")
        if nxt == last:
            log("  ! %s cannot page past %s — stopping to avoid a loop" % (label, nxt))
            break
        last = nxt
        if len(rows) < page:
            break
    log("  %-11s %6d (paged)" % (label, total + len(orphans)))
    if expected is not None and total + len(orphans) < expected:
        log("  ! %s: counted %d, read %d — %d rows did not come back"
            % (label, expected, total + len(orphans), expected - total - len(orphans)))


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
