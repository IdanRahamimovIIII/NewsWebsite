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
import argparse, datetime, hashlib, json, os, re, sys, time
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


DISCOVER_ROWS = 3000


def discover(sections, years, log=print):
    """{url: {publisher, year, period}} — every report URL BudgetKey knows for
       those sections and years. Per section because DISTINCT ON over the whole
       ~4M-row table times out; but ALL the years in ONE query per section,
       because a query per (section, year) is 99x5 round trips to answer 99
       questions."""
    found = {}
    inlist = ", ".join("'%s'" % y for y in years)
    for sec in sections:
        sql = ('SELECT DISTINCT "report-url" AS url, publisher, '
               '"report-year" AS year, "report-period" AS period '
               'FROM quarterly_contract_spending_reports '
               "WHERE budget_code LIKE '%s%%' AND \"report-year\" IN (%s) "
               'AND "report-url" IS NOT NULL' % (sec, inlist))
        try:
            rows = bk(sql, DISCOVER_ROWS)
        except Exception as e:                     # one section must not stop the rest
            log("  discover %s failed: %s" % (sec, e))
            continue
        if len(rows) >= DISCOVER_ROWS:
            log("  ! %s filled the page (%d rows) — there may be more we did not see"
                % (sec, len(rows)))
        added = 0
        for r in rows:
            u = (r.get("url") or "").strip()
            if u and u not in found:
                found[u] = {"publisher": r.get("publisher"),
                            "year": r.get("year"), "period": r.get("period")}
                added += 1
        if rows:
            # rows are per (url, publisher, year, period): 88 rows was 11 urls
            log("  %s → %d rows, %d new urls (running total %d)"
                % (sec, len(rows), added, len(found)))
        else:
            log("  %s → nothing. No section by that number publishes a report."
                % sec)
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
    # The first run produced "unknown_1_2024.xlsx" from a report with no
    # publisher recorded. A second nameless publisher would land on that exact
    # filename and overwrite it — one ministry silently replacing another. The
    # url's own fingerprint makes the name unique without making it opaque.
    tag = hashlib.sha1(url.encode("utf-8")).hexdigest()[:6]
    return "%s_%s_%s_%s.xlsx" % (pub.strip("-") or "unknown",
                                 meta.get("period") or "x",
                                 meta.get("year") or "0000", tag)


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


REAL_XLSX_MIN = 20000        # gov.il's block page is ~5.7 KB; a report is ~600 KB+


def next_quarter(year, period):
    return (year + 1, 1) if period >= 4 else (year, period + 1)


def prev_quarter(year, period):
    return (year - 1, 4) if period <= 1 else (year, period - 1)


# ---------------------------------------------------------------- the catalogue

def load_catalogue(path):
    """One known-good report URL per publisher, checked into the repo.

       Mercy's point, and she is right: the address is static except for the
       quarter and the year. Asking BudgetKey every month which reports exist
       makes a monthly job depend on a third party's index — the same index we
       already caught lagging four quarters behind משרד החינוך. With one real
       URL per ministry we can walk the calendar ourselves, in both directions,
       and never call BudgetKey at all.

       The catalogue is a plain file you can read and edit. When a ministry
       changes its naming, the fix is one line in it."""
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    return doc.get("publishers") or []


def walk_quarters(url, year, period, log=print, today=None, back=40, misses_allowed=4):
    """{url: meta} — every quarter that really exists, walking the calendar
       forward to today and backward through the archive from one known URL."""
    found, today = {}, (today or datetime.date.today())
    limit = (today.year, (today.month - 1) // 3 + 1)
    base = (int(year), int(period))

    size = head(url)
    if size and size >= REAL_XLSX_MIN:
        found[url] = {"year": str(base[0]), "period": str(base[1])}

    for step, stop in ((next_quarter, lambda yp: yp > limit),
                       (prev_quarter, lambda yp: yp[0] < limit[0] - back // 4)):
        y, p, misses = base[0], base[1], 0
        while True:
            y, p = step(y, p)
            if stop((y, p)):
                break
            guess = bump_url(url, base[0], base[1], y, p)
            if not guess:
                break
            size = head(guess)
            if size and size >= REAL_XLSX_MIN:
                found[guess] = {"year": str(y), "period": str(p)}
                misses = 0
                log("    + Q%d %d (%d KB)" % (p, y, size // 1024))
            else:
                misses += 1
                if misses >= misses_allowed:
                    break
            time.sleep(0.3)
    return found


def from_catalogue(entries, log=print, today=None):
    """{url: meta} for every report every catalogued publisher has published."""
    found = {}
    for e in entries:
        pub = e.get("publisher") or "?"
        url, year, period = e.get("url"), e.get("year"), e.get("period")
        if not (url and year and period):
            log("  ! %s has no seed url — skipped" % pub)
            continue
        log("  %s" % pub)
        got = walk_quarters(url, year, period, log=log, today=today)
        for u, m in got.items():
            found.setdefault(u, dict(m, publisher=pub))
        log("    %d reports" % len(got))
    return found


def bump_url(url, year, period, new_year, new_period):
    """gov.il names a report <slug>_<quarter>_<year> and repeats it in the path.
       Swapping both numbers is a real address — Mercy checked this by hand
       before we relied on it."""
    old, new = "_%d_%d" % (period, year), "_%d_%d" % (new_period, new_year)
    return url.replace(old, new) if old in url else None


def probe_forward(url, meta, log=print, today=None):
    """{url: meta} for EVERY quarter published after the newest one BudgetKey
       has indexed — not just the newest of them.

       BudgetKey's index lags: for משרד החינוך it stopped at Q1 2025 while the
       ministry has gone on publishing. This asks, it does not assume: a quarter
       counts only if the file is really there and is really a file."""
    out = {}
    try:
        year, period = int(meta.get("year")), int(meta.get("period"))
    except (TypeError, ValueError):
        return out
    if "/BlobFolder/" not in url:            # only gov.il names files this way
        return out
    today = today or datetime.date.today()
    limit = (today.year, (today.month - 1) // 3 + 1)
    misses = 0
    while True:
        year, period = next_quarter(year, period)
        if (year, period) > limit:
            break
        guess = bump_url(url, int(meta["year"]), int(meta["period"]), year, period)
        if not guess:
            break
        size = head(guess)
        if size and size >= REAL_XLSX_MIN:
            out[guess] = dict(meta, year=str(year), period=str(period))
            misses = 0
            log("    + %s Q%d %d is published too (%d KB)"
                % (meta.get("publisher") or "?", period, year, size // 1024))
        else:
            misses += 1
            if misses >= 4:                  # a year of silence: stop guessing
                break
        time.sleep(0.3)
    return out


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


def run(out_dir, manifest_path, sections, years, limit=None, log=print, catalogue=None):
    os.makedirs(out_dir, exist_ok=True)
    manifest = {}
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)

    if catalogue:
        # THE MONTHLY PATH. No BudgetKey, no third-party index: one seed URL per
        # ministry, and the calendar walked from it in both directions.
        entries = load_catalogue(catalogue)
        log("walking the calendar for %d catalogued publishers…" % len(entries))
        found = from_catalogue(entries, log=log)
        blocked = {}
        log("%d reports to fetch in total" % len(found))
        return _download_all(found, blocked, out_dir, manifest, manifest_path, limit, log)

    log("discovering reports for %d sections × %d years…" % (len(sections), len(years)))
    all_found = discover(sections, years, log=log)
    log("%d distinct report urls" % len(all_found))

    # EVERY report we can reach, not one per ministry.
    # This used to keep only the newest report per publisher, on the reasoning
    # that its payment column is cumulative so it answers the same question.
    # That reasoning is wrong twice over: education's Q2 2025 file is 295 KB
    # against Q1's 663 KB, so a later report can list FEWER contracts than an
    # earlier one; and a single snapshot cannot say what was paid in a given
    # year, which needs the whole series. Collecting is not the place to decide
    # what matters.
    found = {u: m for u, m in all_found.items() if reachable(u)}
    newest, blocked = newest_per_publisher(all_found, log=log)
    log("%d reports reachable, %d ministries unreachable" % (len(found), len(blocked)))

    # BudgetKey's index lags behind the ministries: walk forward from each
    # ministry's newest indexed report and collect every quarter published since.
    log("checking for quarters published since BudgetKey last looked…")
    for url, meta in sorted(newest.items()):
        for u2, m2 in probe_forward(url, meta, log=log).items():
            found.setdefault(u2, m2)
    log("%d reports to fetch in total" % len(found))
    return _download_all(found, blocked, out_dir, manifest, manifest_path, limit, log)


def _download_all(found, blocked, out_dir, manifest, manifest_path, limit, log):
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
    # five years back, not two: the newest report a ministry has published can
    # be years old, and newest_per_publisher only ever takes the latest one it
    # is shown. Asking 2026,2025 alone found education and NOTHING for health
    # or defence, whose latest indexed reports are older than that.
    ap.add_argument("--years", default="2026,2025,2024,2023,2022")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--catalogue", help="the checked-in list of seed urls. "
                    "With this, BudgetKey is never contacted.")
    ap.add_argument("--seed", help="ONE-OFF: ask BudgetKey which reports exist "
                    "and write a catalogue to this path, then stop.")
    a = ap.parse_args()
    secs = [s.strip() for s in a.sections.split(",") if s.strip()] or DEFAULT_SECTIONS
    yrs = [y.strip() for y in a.years.split(",") if y.strip()]
    # both go straight into SQL, and on GitHub they come from a text box
    bad = [v for v in secs + yrs if not v.isdigit()]
    if bad:
        sys.exit("sections and years must be digits only, got: %s" % ", ".join(bad))

    if a.seed:
        # The only thing we ever need BudgetKey for: the first real URL per
        # ministry. Run this by hand when a ministry is added; after that the
        # catalogue is the source and the calendar does the rest.
        found = discover(secs, yrs, log=print)
        newest, blocked = newest_per_publisher(found, log=print)
        pubs = []
        for url, meta in sorted(newest.items()):
            pubs.append({"publisher": meta.get("publisher"), "url": url,
                         "year": meta.get("year"), "period": meta.get("period")})
        for pub, url in sorted(blocked.items()):
            pubs.append({"publisher": pub, "url": url, "year": None, "period": None,
                         "note": "host refuses a server — needs a url we can reach"})
        os.makedirs(os.path.dirname(a.seed) or ".", exist_ok=True)
        with open(a.seed, "w", encoding="utf-8") as fh:
            json.dump({"publishers": pubs}, fh, ensure_ascii=False, indent=1)
        print("wrote %d publishers to %s" % (len(pubs), a.seed))
        sys.exit(0 if pubs else 1)

    res = run(a.out, a.manifest or os.path.join(a.out, "manifest.json"),
              secs, yrs, a.limit, catalogue=a.catalogue)
    sys.exit(1 if res["found"] == 0 else 0)
