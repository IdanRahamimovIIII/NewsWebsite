#!/usr/bin/env python3
r"""
archive.py — THE PERMANENT RAW ARCHIVE (pipeline v2, phase 1).

Every raw source file ever collected lives forever on ONE GitHub Release
(tag `raw-archive`): 2 GB per asset, no expiry, no git bloat. The table of
contents — which files exist, their hashes, urls, vintages, revisions — is
`contractors\archive\manifest.json`, committed to git. A REVISED report is
a NEW entry beside its old revision; nothing is ever overwritten, so the
history keeps what a ministry claimed before it fixed the numbers.
The full design + phases: NOTES.md, "PIPELINE v2".

Runs inside the GitHub workflows (GITHUB_TOKEN + GITHUB_REPOSITORY are
provided there). Stdlib only.

commands:
  ensure-release                         create the raw-archive release if missing
  ingest-reports --reports DIR           hash every .xlsx/.xls in DIR; NEW hashes are
      [--manifest F] [--fetch-manifest F]  added to their bundle (reports-<0..f>.zip,
      [--dry-run]                          by first hex char), changed bundles
                                           re-uploaded, the git manifest updated.
                                           Provenance (url/year/period/publisher)
                                           comes from the fetcher's manifest.json.
  upload-file --path X [--name N]        upload one asset. --dated prefixes YYYYMMDD-;
      [--dated | --rotate]                 --rotate keeps N + N with '-previous'
                                           (the budgetkey / db window pattern).
  download --name N --out PATH           fetch one asset (the build side, phase 2).

THE GUARD: the manifest may only GROW. ingest refuses to write a manifest
with fewer files or fewer total revisions than the committed one — a
shrinking archive means OUR machinery broke, and a red run beats quietly
losing history (same philosophy as inventory.py's never-shrink guard).
"""
import argparse, datetime, hashlib, json, os, sys, tempfile, zipfile
import urllib.error, urllib.parse, urllib.request

TAG = "raw-archive"
API = "https://api.github.com"
BUNDLES = 16                      # reports-0.zip … reports-f.zip
HERE = os.path.dirname(os.path.abspath(__file__))
DEF_MANIFEST = os.path.join(HERE, "archive", "manifest.json")


# ---------------------------------------------------------------- GitHub API
def _need_env():
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not tok or not repo:
        sys.exit("GITHUB_TOKEN and GITHUB_REPOSITORY must be set (they are, "
                 "inside a workflow run — this tool is meant to run there).")
    return tok, repo


def _api(url, method="GET", data=None, ctype="application/json", raw=False):
    tok, _ = _need_env()
    req = urllib.request.Request(url, method=method, data=data, headers={
        "Authorization": "Bearer " + tok,
        "Accept": "application/vnd.github+json",
        **({"Content-Type": ctype} if data is not None else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            body = r.read()
            return body if raw else (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        sys.exit("GitHub answered HTTP %s on %s:\n%s"
                 % (e.code, url, e.read().decode("utf-8", "replace")[:600]))


class Release:
    """The raw-archive release: ensure, list/upload/replace/download assets."""

    def __init__(self):
        _, self.repo = _need_env()
        self.rel = None

    def ensure(self):
        self.rel = _api("%s/repos/%s/releases/tags/%s" % (API, self.repo, TAG))
        if self.rel is None:
            self.rel = _api("%s/repos/%s/releases" % (API, self.repo), "POST",
                            json.dumps({"tag_name": TAG, "name": "the raw archive",
                                        "body": "Every raw source file ever collected, "
                                                "forever. Managed by contractors/archive.py — "
                                                "see contractors/NOTES.md, PIPELINE v2.",
                                        "make_latest": "false"}).encode())
            print("created release %s" % TAG)
        return self

    def assets(self):
        return {a["name"]: a for a in (self.rel or {}).get("assets", [])}

    def upload(self, path, name):
        old = self.assets().get(name)
        if old:                                   # replace = delete + upload
            _api("%s/repos/%s/releases/assets/%d" % (API, self.repo, old["id"]),
                 "DELETE")
        up = self.rel["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(name)
        with open(path, "rb") as fh:
            a = _api(up, "POST", fh.read(), "application/octet-stream")
        self.rel = _api("%s/repos/%s/releases/tags/%s" % (API, self.repo, TAG))
        print("  uploaded %s (%.1f MB)" % (name, os.path.getsize(path) / 1e6))
        return a

    def download(self, name, out):
        a = self.assets().get(name)
        if not a:
            return False
        # asset downloads need Accept: application/octet-stream
        tok, _ = _need_env()
        req = urllib.request.Request(a["url"], headers={
            "Authorization": "Bearer " + tok,
            "Accept": "application/octet-stream"})
        with urllib.request.urlopen(req, timeout=1800) as r, open(out, "wb") as fh:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
        return True

    def rotate(self, path, name):
        """name stays the current one; the old current becomes -previous
           (its old -previous is dropped). The two-database / budgetkey
           window Mercy asked for: current + previous, nothing older."""
        base, ext = os.path.splitext(name)
        prev = base + "-previous" + ext
        cur = self.assets().get(name)
        if cur:
            tmp = tempfile.mktemp(suffix=ext)
            self.download(name, tmp)
            self.upload(tmp, prev)
            os.unlink(tmp)
        self.upload(path, name)


# ---------------------------------------------------------------- manifest
def load_manifest(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return {"files": {}}          # key: "<hash16>__<name>" → revision record


def counts(man):
    return len(man["files"])


def save_manifest(path, man, old_n):
    if counts(man) < old_n:
        sys.exit("REFUSING to write the archive manifest: it would SHRINK "
                 "(%d → %d files). An archive only grows — something broke."
                 % (old_n, counts(man)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(man, fh, ensure_ascii=False, indent=0, sort_keys=True)
    print("manifest: %d archived files (+%d this run)"
          % (counts(man), counts(man) - old_n))


def sha16(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- ingest
def ingest_reports(reports_dir, manifest_path, fetch_manifest_path,
                   dry_run=False, bundle_dir=None):
    """Archive every report file not already archived (by content hash).
       bundle_dir: where bundle zips are (re)assembled — a scratch dir in CI;
       in --dry-run they are written there and NOT uploaded."""
    fetch_meta = {}
    if fetch_manifest_path and os.path.exists(fetch_manifest_path):
        with open(fetch_manifest_path, encoding="utf-8") as fh:
            for url, m in json.load(fh).items():
                if m.get("file"):
                    fetch_meta[m["file"]] = dict(m, url=url)

    man = load_manifest(manifest_path)
    old_n = counts(man)
    today = datetime.date.today().isoformat()
    new_by_bundle = {}
    for name in sorted(os.listdir(reports_dir)):
        if not name.lower().endswith((".xlsx", ".xls")):
            continue
        path = os.path.join(reports_dir, name)
        h = sha16(path)
        key = "%s__%s" % (h, name)
        if key in man["files"]:
            continue                              # this exact revision is archived
        meta = fetch_meta.get(name, {})
        bundle = "reports-%s.zip" % h[0]
        man["files"][key] = {
            "bundle": bundle, "size": os.path.getsize(path),
            "archived": today, "url": meta.get("url"),
            "year": meta.get("year"), "period": meta.get("period"),
            "publisher": meta.get("publisher"), "via": meta.get("via"),
        }
        new_by_bundle.setdefault(bundle, []).append((key, path))

    if not new_by_bundle:
        print("nothing new to archive (%d files already in)" % old_n)
        return {"new": 0, "bundles": []}

    rel = None if dry_run else Release().ensure()
    bundle_dir = bundle_dir or tempfile.mkdtemp(prefix="bundles-")
    os.makedirs(bundle_dir, exist_ok=True)
    for bundle, items in sorted(new_by_bundle.items()):
        local = os.path.join(bundle_dir, bundle)
        # start from the bundle as it exists on the release, so nothing is lost
        if not os.path.exists(local) and rel is not None:
            rel.download(bundle, local)
        with zipfile.ZipFile(local, "a", zipfile.ZIP_DEFLATED) as z:
            have = set(z.namelist())
            for key, path in items:
                if key not in have:
                    z.write(path, key)
        print("  %s: +%d file(s)" % (bundle, len(items)))
        if rel is not None:
            rel.upload(local, bundle)
    save_manifest(manifest_path, man, old_n)
    print("archived %d new file(s) into %d bundle(s)%s"
          % (sum(len(v) for v in new_by_bundle.values()), len(new_by_bundle),
             " [DRY RUN — nothing uploaded]" if dry_run else ""))
    return {"new": sum(len(v) for v in new_by_bundle.values()),
            "bundles": sorted(new_by_bundle)}


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("ensure-release")
    p = sp.add_parser("ingest-reports")
    p.add_argument("--reports", required=True)
    p.add_argument("--manifest", default=DEF_MANIFEST)
    p.add_argument("--fetch-manifest")
    p.add_argument("--bundle-dir")
    p.add_argument("--dry-run", action="store_true")
    p = sp.add_parser("upload-file")
    p.add_argument("--path", required=True)
    p.add_argument("--name")
    p.add_argument("--dated", action="store_true")
    p.add_argument("--rotate", action="store_true")
    p = sp.add_parser("download")
    p.add_argument("--name", required=True)
    p.add_argument("--out", required=True)
    a = ap.parse_args()

    if a.cmd == "ensure-release":
        Release().ensure()
        print("release %s is there." % TAG)
    elif a.cmd == "ingest-reports":
        fm = a.fetch_manifest or os.path.join(a.reports, "manifest.json")
        ingest_reports(a.reports, a.manifest, fm, a.dry_run, a.bundle_dir)
    elif a.cmd == "upload-file":
        name = a.name or os.path.basename(a.path)
        if a.dated:
            name = datetime.date.today().strftime("%Y%m%d-") + name
        rel = Release().ensure()
        if a.rotate:
            rel.rotate(a.path, name)
        else:
            rel.upload(a.path, name)
    elif a.cmd == "download":
        ok = Release().ensure().download(a.name, a.out)
        if not ok:
            sys.exit("no asset named %s on the %s release" % (a.name, TAG))
        print("downloaded %s → %s" % (a.name, a.out))


if __name__ == "__main__":
    main()
