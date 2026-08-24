#!/usr/bin/env python3
"""
fetch_portal_registers.py — collect Origin B automatically, from the
procurement portal's own monthly export files.

HOW THIS WAS FOUND (2026-08-24): Mercy exported the register by hand from
mr.gov.il, and the trail led to a news page —
  https://mr.gov.il/ilgstorefront/he/news/details/230920201036
— where מינהל הרכש publishes the export files MONTHLY as dated zips
(Tenders-DDMMYYYY.zip, Exemptions-DDMMYYYY.zip). The page answers a plain
server fetch with no session, so no browser and no DevTools capture is
needed: read the page, follow whatever dated links it carries today.

The download links carry a ?context= token that looks rotatable, so the
links are ALWAYS re-read from the page — never remembered.

Measured content (07.08.2026 files): tenders 24,572 rows 2009→2026,
exemptions 239,549 rows 2005→2026, both as SpreadsheetML that lies about
its encoding — parse_portal_export.py handles that part.

Kept SEPARATE (Mercy's rule): this collects and converts; nothing is
combined with the ministry reports or BudgetKey.

usage:
  fetch_portal_registers.py --out build/portal
"""
import argparse, json, os, re, sys, tempfile, time, zipfile
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_portal_export

NEWS = "https://mr.gov.il/ilgstorefront/he/news/details/230920201036"
UA = {"User-Agent": "our-money/1.0 (+https://github.com/) python-urllib"}

# the medias path with the dated name; the context token is whatever the page
# says today. Group 1 = kind, group 2 = DDMMYYYY.
LINK = re.compile(
    r"/ilgstorefront/medias/(Tenders|Exemptions)-(\d{8})\.zip\?context=[A-Za-z0-9_=%-]+")


def fetch_text(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def find_links(page):
    """{kind: (full_url, ddmmyyyy)} — the newest dated link per kind, though
       the page has only ever shown one of each."""
    out = {}
    for m in LINK.finditer(page):
        kind, date = m.group(1).lower(), m.group(2)
        url = "https://mr.gov.il" + m.group(0)
        iso = date[4:] + "-" + date[2:4] + "-" + date[:2]
        if kind not in out or iso > out[kind][1]:
            out[kind] = (url, iso)
    return out


def download_zip(url, timeout=600):
    req = urllib.request.Request(url, headers=UA)
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        while True:
            b = r.read(1 << 22)
            if not b:
                break
            tmp.write(b)
    tmp.close()
    return tmp.name


def run(outdir, log=print):
    os.makedirs(outdir, exist_ok=True)
    man_path = os.path.join(outdir, "manifest.json")
    manifest = {}
    if os.path.exists(man_path):
        with open(man_path, encoding="utf-8") as fh:
            manifest = json.load(fh)

    log("reading the portal's publications page…")
    page = fetch_text(NEWS)
    links = find_links(page)
    if not links:
        # the page moved or was redesigned — that is a finding, not a shrug
        raise SystemExit("no export links found on %s — the page has changed; "
                         "open it in a browser and see where the files went" % NEWS)
    log("  found: " + " · ".join("%s (%s)" % (k, d) for k, (u, d) in sorted(links.items())))

    failed = []
    for kind, (url, iso) in sorted(links.items()):
        out_json = os.path.join(outdir, "%s-%s.json" % (kind, iso))
        prev = manifest.get(kind)
        if prev and prev.get("date") == iso and os.path.exists(
                os.path.join(outdir, prev.get("json", ""))):
            log("  = %s %s already collected" % (kind, iso))
            continue
        try:
            log("  ↓ %s %s…" % (kind, iso))
            zpath = download_zip(url)
            try:
                with zipfile.ZipFile(zpath) as z:
                    names = [n for n in z.namelist() if n.lower().endswith(".xls")]
                    if len(names) != 1:
                        raise RuntimeError("expected one .xls in the zip, found %s"
                                           % (names or z.namelist()))
                    with tempfile.TemporaryDirectory() as d:
                        xls = z.extract(names[0], d)
                        res = parse_portal_export.convert(xls, out_json, log=log)
            finally:
                os.unlink(zpath)
            manifest[kind] = {"date": iso, "json": os.path.basename(out_json),
                              "rows": res["rows"], "columns": len(res["columns"]),
                              "newest_publication": res["newest"], "source_url": url}
        except Exception as e:
            failed.append(kind)
            log("  ✘ %s — %s" % (kind, str(e)[:200]))
        time.sleep(1.0)

    with open(man_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    for kind, m in sorted(manifest.items()):
        log("%s: %s · %d rows · newest פרסום %s"
            % (kind, m["date"], m["rows"], m["newest_publication"]))
    return manifest, failed


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    manifest, failed = run(a.out)
    sys.exit(1 if failed or not manifest else 0)
