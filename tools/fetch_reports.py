#!/usr/bin/env python3
"""
fetch_reports.py — find the ministries' quarterly procurement reports and
download the ones that changed.

WHAT WE PROVED BEFORE WRITING THIS (2026-08-23, through the worker):
  • https://www.gov.il/BlobFolder/…/education_1_2025.xlsx → 200, 679,714 bytes
  • https://www.gov.il/BlobFolder/…/health_3_2024.xlsx    → 200, 1,802,611 bytes
    Two ministries, same shape. The spreadsheets ARE served to a server.
  • https://www.gov.il/he/departments/…      → 403, a 5,679-byte HTML wall
  • https://foi.gov.il/sites/default/files/… → 403, a 5,682-byte HTML wall
    So: gov.il's BLOBFOLDER serves files. gov.il's PAGES and ALL of foi.gov.il
    are behind bot protection. Reports moved hosts over time — foi.gov.il holds
    the older archive, BlobFolder the recent ones (health: foi for 2018, gov.il
    from 2022 on). Since we want each ministry's NEWEST report, that is the
    reachable one. Never scrape a page: BudgetKey stores every report URL.
  • DISTINCT ON over quarterly_contract_spending_reports TIMES OUT (~4M rows).
    Discovery therefore goes section by section, which is indexed and fast.

Downloads only what changed: a report already in the manifest with the same
Content-Length is skipped. Ministries also REVISE reports (the source carries
revision 0..2), so this checks monthly rather than quarterly.

usage:
  fetch_reports.py --out reports --manifest reports/manifest.json
  fetch_reports.py --out reports --sections 0020,0024 --years 2025,2024
"""
import argparse, json, os, re, sys, time
import urllib.parse, urllib.request

API = "https://next.obudget.org/api/query"
UA = {"User-Agent": "our-money/1.0 (+https://github.com/) python-urllib"}

# every budget section that can hold contracts; discovery walks these
DEFAULT_SECTIONS = ["%04d" % n for n in range(1, 100)]


def http_json(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def bk(sql, rows=200):
    url = API + "?query=" + urllib.parse.quote(sql) + "&num_rows=%d" % rows
    doc = http_json(url)
    if doc.get("success") is False:
        raise RuntimeError(doc.get("error", "budgetkey error"))
    return doc.get("rows") or []


def discover(sections, years, log=print):
    """{url: {publisher, year, period}} — every report URL BudgetKey knows for
       those sections and years. Per section because DISTINCT ON times out."""
    found = {}
    for sec in sections:
        for year in years:
            sql = ('SELECT DISTINCT "report-url" AS url, publisher, '
                   '"report-year" AS year, "report-period" AS period '
                   'FROM quarterly_contract_spending_reports '
                   "WHERE budget_code LIKE '%s%%' AND \"report-year\" = '%s' "
                   'AND "report-url" IS NOT NULL' % (sec, year))
            try:
                rows = bk(sql, 400)
            except Exception as e:                 # one section must not stop the rest
                log("  discover %s/%s failed: %s" % (sec, year, e))
                continue
            for r in rows:
                u = (r.get("url") or "").strip()
                if u and u not in found:
                    found[u] = {"publisher": r.get("publisher"),
                                "year": r.get("year"), "period": r.get("period")}
            if rows:
                log("  %s %s → %d urls (running total %d)" % (sec, year, len(rows), len(found)))
    return found


BLOCKED_HOSTS = ("foi.gov.il",)

def reachable(url):
    """foi.gov.il answers 403 to a server, files included — verified. A URL
       there is not a failure to retry, it is a ministry we cannot reach."""
    return not any(h in url for h in BLOCKED_HOSTS)


def newest_per_publisher(found, log=print):
    """One report per ministry: the latest (year, period) we can actually
       fetch. Downloading every report ever published would be hundreds of
       files to answer a question the newest one already answers — its paid
       column is cumulative over the contract's whole life."""
    best, unreachable = {}, {}
    for url, meta in found.items():
        pub = meta.get("publisher") or "?"
        rank = (int(meta.get("year") or 0), int(meta.get("period") or 0))
        target = best if reachable(url) else unreachable
        if pub not in target or rank > target[pub][0]:
            target[pub] = (rank, url, meta)
    only_blocked = {p: v for p, v in unreachable.items() if p not in best}
    if only_blocked:
        log("  %d ministries publish ONLY on a host that refuses us:" % len(only_blocked))
        for p in sorted(only_blocked):
            log("    · %s — needs downloading by hand" % p)
    return ({url: meta for _, url, meta in best.values()},
            {p: v[1] for p, v in only_blocked.items()})


def filename_for(url, meta):
    """A name that says what it is. gov.il URLs already carry
       <slug>_<quarter>_<year>; foi.gov.il ones are Hebrew, so fall back to
       the publisher and the report's own year/period."""
    m = re.search(r"/([a-z\-]+_[1-4]_20\d\d[a-z]?)/", url.lower())
    if m:
        return m.group(1) + ".xlsx"
    pub = re.sub(r"[^\w֐-׿]+", "-", (meta.get("publisher") or "unknown"))[:40]
    return "%s_%s_%s.xlsx" % (pub.strip("-"), meta.get("period") or "x",
                              meta.get("year") or "0000")


def head(url, timeout=60):
    """Size without downloading. Some hosts refuse HEAD; a Range GET of one
       byte gets the same answer everywhere."""
    req = urllib.request.Request(url, headers=dict(UA, Range="bytes=0-0"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            cr = r.headers.get("Content-Range") or ""
            if "/" in cr:
                return int(cr.rsplit("/", 1)[1])
            return int(r.headers.get("Content-Length") or 0)
    except Exception:
        return None


def download(url, path, timeout=300):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if len(data) < 5000:
        raise RuntimeError("suspiciously small (%d bytes) — probably a block page" % len(data))
    if data[:2] != b"PK":
        raise RuntimeError("not an xlsx (no PK header) — probably an HTML block page")
    with open(path, "wb") as fh:
        fh.write(data)
    return len(data)


def run(out_dir, manifest_path, sections, years, limit=None, log=print):
    os.makedirs(out_dir, exist_ok=True)
    manifest = {}
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)

    log("discovering reports for %d sections × %d years…" % (len(sections), len(years)))
    all_found = discover(sections, years, log=log)
    log("%d distinct report urls" % len(all_found))
    found, blocked = newest_per_publisher(all_found, log=log)
    log("%d ministries reachable, %d not" % (len(found), len(blocked)))

    got = skipped = failed = 0
    for i, (url, meta) in enumerate(sorted(found.items())):
        if limit and got >= limit:
            break
        prev = manifest.get(url) or {}
        # trust the manifest's own filename over recomputing it: if the naming
        # rule ever changes, recomputing would make every file look missing and
        # re-download all 82 for nothing
        name = prev.get("file") or filename_for(url, meta)
        path = os.path.join(out_dir, name)
        size = head(url)
        if size and prev.get("bytes") == size and os.path.exists(path):
            skipped += 1
            continue                              # unchanged since last run
        try:
            n = download(url, path)
            manifest[url] = {"file": name, "bytes": n, "publisher": meta.get("publisher"),
                             "year": meta.get("year"), "period": meta.get("period")}
            got += 1
            log("  ↓ %s  (%d KB)" % (name, n // 1024))
        except Exception as e:
            failed += 1
            log("  ✘ %s — %s" % (name, e))
        time.sleep(0.5)                           # be a polite guest

    if manifest_path:
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
    log("downloaded %d · unchanged %d · failed %d · unreachable ministries %d"
        % (got, skipped, failed, len(blocked)))
    return {"downloaded": got, "skipped": skipped, "failed": failed,
            "found": len(found), "blocked": blocked}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest")
    ap.add_argument("--sections", default="")
    ap.add_argument("--years", default="2026,2025,2024")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    secs = [s.strip() for s in a.sections.split(",") if s.strip()] or DEFAULT_SECTIONS
    yrs = [y.strip() for y in a.years.split(",") if y.strip()]
    res = run(a.out, a.manifest or os.path.join(a.out, "manifest.json"), secs, yrs, a.limit)
    sys.exit(1 if res["found"] == 0 else 0)
