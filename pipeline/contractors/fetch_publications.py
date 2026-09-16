#!/usr/bin/env python3
"""
fetch_publications.py — collect the SECOND ORIGIN whole: the tender/exemption
publication register on data.gov.il.

WHAT THIS IS
  Origin A (the ministries' quarterly reports) says what was PAID. This is
  Origin B — the publication system behind חוק חובת המכרזים: who approved an
  engagement, under which regulation, the announced amount (היקף כספי), the
  objection deadline, and a link to the decision texts. It is the only
  independent second witness we have for contracts; nothing here exists in
  the quarterly reports.

  Two resources, both under מינהל הרכש הממשלתי on data.gov.il:
    exemptions  65c8fced-…  דוח התקשרויות בפטור והליכים תחרותיים  (~165,705)
    tenders     7038b3e6-…  דוח מכרזים                            (~14,205)

FRESHNESS — measured, do not assume this register is live: frozen at
  2021-01-31 (counts unmoved since first measured). It is the REGISTER'S
  HISTORY; the live continuation is the portal (fetch_portal_registers).
  The newest תאריך פרסום is printed every run, so staleness is measured,
  not remembered.

RULES (Mercy's): nothing is combined — this is collected whole,
  every field, and stored SEPARATE from the reports and from BudgetKey.
  The register is small enough (~180k records, ~20 requests) that every run
  re-pulls all of it; no cache, no diffing, no chance of a stale copy.

usage:
  fetch_publications.py --out build/publications
"""
import argparse, json, os, sys, time
import urllib.parse, urllib.request

API = "https://data.gov.il/api/3/action/datastore_search"
UA = {"User-Agent": "our-money/1.0 (+https://github.com/) python-urllib"}

RESOURCES = {
    "exemptions": "65c8fced-c50c-400e-94fb-ef1a208c43e5",
    "tenders":    "7038b3e6-a74d-442e-b16b-466c8196124a",
}

PAGE = 10000        # what we ask for; the server may cap lower — we page by
                    # what actually came back, never by what was requested


def ckan(resource, offset, limit=PAGE, timeout=180):
    q = urllib.parse.urlencode({"resource_id": resource,
                                "offset": offset, "limit": limit})
    req = urllib.request.Request(API + "?" + q, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        doc = json.load(r)
    if not doc.get("success"):
        raise RuntimeError(str(doc.get("error"))[:200])
    res = doc.get("result") or {}
    return res.get("records") or [], int(res.get("total") or 0)


def fetch(name, resource, log=print):
    """Every record, paged by the rows the server ACTUALLY returned — the
       lesson of the vote index build: never infer 'last page' from a short
       page size you requested; only an empty page means the end."""
    rows, offset, total = [], 0, 0
    while True:
        recs, total = ckan(resource, offset)
        if not recs:
            break
        rows.extend(recs)
        offset += len(recs)
        log("  %-10s %6d / %d" % (name, offset, total))
        if total and offset >= total:
            break
        time.sleep(0.5)

    # a page boundary can repeat a row if the dataset moves mid-pull;
    # _id is CKAN's own row id, so exact repeats collapse honestly
    seen, unique = set(), []
    for r in rows:
        k = r.get("_id")
        if k is not None and k in seen:
            continue
        seen.add(k)
        unique.append(r)
    return unique, total


def newest_date(rows):
    """The newest תאריך פרסום in the pull — the freshness measurement."""
    best = ""
    for r in rows:
        v = str(r.get("תאריך פרסום") or "")
        if v > best:
            best = v
    return best


def run(outdir, resources=None, log=print):
    resources = resources or RESOURCES
    os.makedirs(outdir, exist_ok=True)
    results, short = {}, []
    for name, rid in sorted(resources.items()):
        try:
            rows, total = fetch(name, rid, log=log)
        except Exception as e:
            log("  x %s failed: %s" % (name, e))
            short.append(name)
            continue
        path = os.path.join(outdir, name + ".json")
        doc = {"resource": rid, "total_reported": total,
               "records_fetched": len(rows), "newest_publication": newest_date(rows),
               "records": rows}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
        log("%s: %d records (register says %d) · newest תאריך פרסום %s · %.1f MB"
            % (name, len(rows), total, doc["newest_publication"] or "?",
               os.path.getsize(path) / 1e6))
        if total and len(rows) < total:
            log("  ! %s came back SHORT: %d of %d — not a complete pull"
                % (name, len(rows), total))
            short.append(name)
        results[name] = doc
    return results, short


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    results, short = run(a.out)
    # an incomplete register must fail LOUDLY — a partial pull that exits 0
    # would sit in the inventory looking like the whole thing
    sys.exit(1 if short or not results else 0)
