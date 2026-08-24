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

# Fallback only. The real list comes from raw_budget — see sections_from_budget.
# "0001".."0099" was a guess at what exists, and a guess is how we ended up
# asking 99 questions to find 63 answers while still missing nothing useful.
FALLBACK_SECTIONS = ["%04d" % n for n in range(1, 100)]


def sections_from_budget(log=print, year=None):
    """The budget's OWN list of four-digit sections, with their names.

       Mercy's question: "isn't this imply we can just call for a table of all
       the sections?" Yes. raw_budget is the same table the budget page reads,
       and its four-character codes ARE the sections. Asking it costs one fast
       query and replaces a hundred guesses with the real list — and it tells us
       what each section is called, which a guessed number never could.

       Note what is NOT in it: 4521, 5520, 6200, 6210, 6220, 6230, all of which
       turned up in the parsed files on 2026-08-23. They are not sections we
       failed to sweep; they are budget codes in the ministries' own
       spreadsheets that do not exist in the national budget. See flag_unknown."""
    year = year or datetime.date.today().year
    for y in range(year, year - 4, -1):
        try:
            rows = bk("SELECT code, title FROM raw_budget "
                      "WHERE year = %d AND length(code) = 4" % y, 400)
        except Exception as e:
            log("  section list for %d failed: %s" % (y, e))
            continue
        secs = {}
        for r in rows:
            c = str(r.get("code") or "")
            if len(c) == 4 and c.isdigit() and c != "0000":
                secs[c] = r.get("title")
        if secs:
            log("  %d budget sections, from raw_budget %d" % (len(secs), y))
            return secs
    log("  ! could not read the section list — falling back to 0001..0099")
    return {c: None for c in FALLBACK_SECTIONS}


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
    found, empty = {}, []
    inlist = ", ".join("'%s'" % y for y in years)
    queue = list(sections)
    while queue:
        sec = queue.pop(0)
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
        # A full page is probably a truncated one. Splitting costs ten cheap
        # queries and cannot lose a url; assuming it was complete can lose a
        # ministry, and nothing in the output would say so.
        if len(rows) >= DISCOVER_ROWS and len(sec) < 10:
            log("  %s filled the page (%d rows) — splitting" % (sec, len(rows)))
            queue[:0] = [sec + d for d in "0123456789"]
            continue
        if len(rows) >= DISCOVER_ROWS:
            log("  ! %s filled the page (%d rows) and cannot be split further"
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
            empty.append(sec)
    if empty:
        log("  no reports at all under: %s" % " ".join(empty))
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


def encode_url(url):
    """Percent-encode the path and query.

       THE 1,190-FAILURE BUG (2026-08-23). The ministries name their files in
       Hebrew, with spaces, apostrophes, brackets and invisible RTL marks:
         .../he/רבעון 4 - 2020.xlsx
         .../he/הסנגוריה הציבורית - תשלום בפועל רבעון 1 לשנת 2018 - לפרסום (3).xlsx
       Handed to urllib as-is, those die with "URL can't contain control
       characters (found at least ' ')" or "'ascii' codec can't encode". Out of
       1,816 reports the first full run downloaded 626 and failed on 1,190 —
       roughly two thirds of the archive — and every one of those failures was
       ours, not the government's.

       It also silently biased everything downstream: the ministries that
       survived were the ones whose filenames happened to be plain ASCII, so a
       ministry looked like it had stopped reporting when really its Hebrew
       filenames were unfetchable.

       quote() with '%' in safe is idempotent, so an already-encoded url passes
       through unchanged."""
    p = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((
        p.scheme, p.netloc,
        urllib.parse.quote(p.path, safe="/%!$&'()*+,;=:@~"),
        urllib.parse.quote(p.query, safe="/%!$&'()*+,;=:@?~"),
        p.fragment))


def head(url, timeout=60):
    """Size without downloading. Some hosts refuse HEAD; a Range GET of one
       byte gets the same answer everywhere."""
    req = urllib.request.Request(encode_url(url), headers=dict(UA, Range="bytes=0-0"))
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


def classify(data):
    """\"xlsx\", \"xls\" or None — decided by the bytes, not the extension.

       THE 16 \"not an xlsx\" FAILURES (run of 2026-08-24): the check demanded a
       PK header, but Excel's OLD format (.xls, OLE2, used by ministries into
       ~2020 — משרד החוץ, תיאום הפעולות בשטחים) starts D0 CF 11 E0 instead. A
       legitimate government report was being rejected as a block page, and the
       error message even asserted it was probably HTML. When rejecting, say
       what the bytes actually were, so nobody has to guess again."""
    if len(data) < 5000:
        return None
    if data[:2] == b"PK":
        return "xlsx"
    if data[:4] == b"\xd0\xcf\x11\xe0":
        return "xls"
    return None


def _reject(data):
    head = data[:24]
    try:
        shown = head.decode("utf-8", "replace").strip() or head.hex()
    except Exception:
        shown = head.hex()
    return RuntimeError("not a spreadsheet (%d bytes, starts %r)"
                        % (len(data), shown))


def _save(data, path):
    """Write, fixing the extension to match the actual format. Returns
       (bytes, final_path). parse_all reads both .xlsx and .xls, and openpyxl
       cannot open an OLE2 file handed to it with an .xlsx name."""
    kind = classify(data)
    if kind is None:
        raise _reject(data)
    if kind == "xls" and path.lower().endswith(".xlsx"):
        path = path[:-5] + ".xls"
    with open(path, "wb") as fh:
        fh.write(data)
    return len(data), path


def download(url, path, timeout=300):
    req = urllib.request.Request(encode_url(url), headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return _save(data, path)


WAYBACK = "https://web.archive.org/web/2id_/"


def wayback_url(url):
    """The Internet Archive's copy of a url, as raw original bytes.
       \"2id_\" = the snapshot closest to timestamp 2… (i.e. the latest one),
       id_ = identity: the archived bytes, no banner injected."""
    return WAYBACK + encode_url(url)


def wayback_fetch(url, path, timeout=120):
    """The alternative route. foi.gov.il refuses a server and some gov.il
       addresses are simply gone (404) — but the Wayback Machine crawled both
       hosts for years, and web.archive.org serves everyone. A recovered file
       is stamped via=\"wayback\" in the manifest: a number from an archived
       copy must never look like one read from the government's own server."""
    req = urllib.request.Request(wayback_url(url), headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
        final = r.geturl()          # …/web/<timestamp>id_/<url> after redirect
    m = re.search(r"/web/(\d{4,14})", final or "")
    n, path = _save(data, path)
    return n, path, (m.group(1) if m else "?")


def run(out_dir, manifest_path, sections, years, limit=None, log=print,
        catalogue=None, wayback=False):
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
        return _download_all(found, blocked, out_dir, manifest, manifest_path,
                             limit, log, wayback=wayback)

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

    # WRITE DOWN WHAT WE COULD NOT REACH.
    # This line used to be the whole story of the gap, and it was silent about
    # the size of it: newest_per_publisher only names a ministry with NO
    # reachable report at all. A ministry with a 2024 file on gov.il and twenty
    # 2016-2019 files on foi.gov.il lost the twenty and nothing said so — which
    # is exactly "a partial answer shown as if it were complete".
    # Now every skipped url is recorded next to the reports, so the inventory
    # can say how big the hole is instead of implying there isn't one.
    skipped = {u: m for u, m in all_found.items() if not reachable(u)}
    if skipped:
        log("%d reports exist that we CANNOT download (host refuses a server)"
            % len(skipped))
        by_year = {}
        for m in skipped.values():
            by_year[m.get("year") or "?"] = by_year.get(m.get("year") or "?", 0) + 1
        log("  by year: %s" % ", ".join("%s:%d" % kv for kv in sorted(by_year.items())))
    with open(os.path.join(out_dir, "unreachable.json"), "w", encoding="utf-8") as fh:
        json.dump(skipped, fh, ensure_ascii=False, indent=1)

    # THE ALTERNATIVE ROUTE to those 1,181: the Wayback Machine crawled
    # foi.gov.il for years, and web.archive.org serves everyone. Try each
    # blocked url through the archive instead of writing the years off.
    if wayback and skipped:
        log("trying the %d blocked urls through the Wayback Machine…" % len(skipped))
        for u, m in skipped.items():
            found.setdefault(u, dict(m, wayback_only=True))

    # BudgetKey's index lags behind the ministries: walk forward from each
    # ministry's newest indexed report and collect every quarter published since.
    log("checking for quarters published since BudgetKey last looked…")
    for url, meta in sorted(newest.items()):
        for u2, m2 in probe_forward(url, meta, log=log).items():
            found.setdefault(u2, m2)
    log("%d reports to fetch in total" % len(found))
    return _download_all(found, blocked, out_dir, manifest, manifest_path,
                         limit, log, wayback=wayback)


def _download_all(found, blocked, out_dir, manifest, manifest_path, limit, log,
                  wayback=False):
    got = skipped = failed = 0
    failures = {}
    for i, (url, meta) in enumerate(sorted(found.items())):
        if limit and got >= limit:
            break
        prev = manifest.get(url) or {}
        # trust the manifest's own filename over recomputing it: if the naming
        # rule ever changes, recomputing would make every file look missing and
        # re-download all 82 for nothing
        name = prev.get("file") or filename_for(url, meta)
        path = os.path.join(out_dir, name)
        archive_only = bool(meta.get("wayback_only"))

        # an archived snapshot never changes, and the live host refuses us
        # anyway — once a wayback copy is on disk, it is final
        if prev.get("via") == "wayback" and prev.get("file") and \
                os.path.exists(os.path.join(out_dir, prev["file"])):
            skipped += 1
            continue
        if not archive_only:
            size = head(url)
            if size and prev.get("bytes") == size and os.path.exists(path):
                skipped += 1
                continue                          # unchanged since last run

        err = None
        if not archive_only:
            try:
                n, real_path = download(url, path)
            except Exception as e:
                err = str(e)[:200]
                # the url died AFTER we already downloaded its file: keep the
                # copy we have. Falling through to wayback here could replace
                # a good file with an OLDER snapshot of it.
                if prev.get("bytes") and os.path.exists(path):
                    skipped += 1
                    log("  = %s — url now fails (%s), keeping the copy we hold"
                        % (name, err))
                    time.sleep(0.5)
                    continue
            else:
                name = os.path.basename(real_path)
                manifest[url] = {"file": name, "bytes": n,
                                 "publisher": meta.get("publisher"),
                                 "year": meta.get("year"), "period": meta.get("period")}
                got += 1
                log("  ↓ %s  (%d KB)" % (name, n // 1024))
                time.sleep(0.5)                   # be a polite guest
                continue

        # THE SECOND CHANCE: the Wayback Machine. Tried for every direct
        # failure and for every url on a host that refuses servers outright.
        wb_err = None
        if wayback:
            try:
                n, real_path, snap = wayback_fetch(url, path)
                name = os.path.basename(real_path)
                manifest[url] = {"file": name, "bytes": n,
                                 "publisher": meta.get("publisher"),
                                 "year": meta.get("year"), "period": meta.get("period"),
                                 "via": "wayback", "snapshot": snap}
                got += 1
                log("  ⚑ %s  (%d KB, Wayback Machine %s)" % (name, n // 1024, snap[:8]))
                time.sleep(1.5)                   # the archive is a public good
                continue
            except Exception as e:
                wb_err = str(e)[:200]

        failed += 1
        failures[url] = {"file": name, "publisher": meta.get("publisher"),
                         "year": meta.get("year"), "period": meta.get("period"),
                         "error": err or "host refuses a server"}
        if wb_err is not None:
            failures[url]["wayback"] = wb_err
        log("  ✘ %s — %s%s" % (name, err or "host refuses a server",
                               (" · wayback: " + wb_err) if wb_err else ""))
        time.sleep(0.5)

    # A DEAD ADDRESS IS NOT ALWAYS A MISSING REPORT. BudgetKey indexes the
    # same report under several urls (foi.gov.il + gov.il, old and new hosts),
    # and in the 2026-08-24 run a large share of the 79 "failures" were dead
    # twins of files that downloaded fine under another address. Say which,
    # so the failure list shows the real hole and not the noise.
    have = {}
    for m in manifest.values():
        have[(m.get("publisher"), str(m.get("year")), str(m.get("period")))] = m.get("file")
    covered = 0
    for f in failures.values():
        twin = have.get((f.get("publisher"), str(f.get("year")), str(f.get("period"))))
        if twin:
            f["covered_by"] = twin
            covered += 1

    if manifest_path:
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
    # a failure that only ever appears in a scrolling log is a hole nobody sees
    with open(os.path.join(out_dir, "failed.json"), "w", encoding="utf-8") as fh:
        json.dump(failures, fh, ensure_ascii=False, indent=1)
    log("downloaded %d · unchanged %d · failed %d · unreachable ministries %d"
        % (got, skipped, failed, len(blocked)))
    if failed:
        kinds = {}
        for f in failures.values():
            k = f["error"].split(":")[0][:48]
            kinds[k] = kinds.get(k, 0) + 1
        log("failures by kind:")
        for k, n in sorted(kinds.items(), key=lambda x: -x[1]):
            log("  %5d  %s" % (n, k))
        if covered:
            log("%d of the %d failed urls are duplicate addresses of reports "
                "already on disk (marked covered_by in failed.json)"
                % (covered, failed))
    return {"downloaded": got, "skipped": skipped, "failed": failed,
            "found": len(found), "blocked": blocked, "covered": covered}


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
    ap.add_argument("--wayback", action="store_true",
                    help="when a url fails or its host refuses servers, try "
                         "the Wayback Machine's copy (recovered files are "
                         "stamped via=wayback in the manifest)")
    a = ap.parse_args()
    secs = [s.strip() for s in a.sections.split(",") if s.strip()]
    if not secs:
        secs = sorted(sections_from_budget())
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
              secs, yrs, a.limit, catalogue=a.catalogue, wayback=a.wayback)
    sys.exit(1 if res["found"] == 0 else 0)
