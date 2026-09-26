#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""Deploy a worker's CODE ONLY — the same as pasting the file into the
Cloudflare dashboard and pressing Deploy (Mercy's way), from this machine.

    python worker/deploy_worker.py pages     → worker/pages.js  → our-money-pages
    python worker/deploy_worker.py relay     → worker/worker.js → our-money
    add --check to only compare the deployed code with the local file

Uses Cloudflare's "script content" endpoint: it replaces the code and keeps
EVERYTHING else — bindings (KV DATA, D1 CONTRACTS), the BUILD_KEY secret,
the cron, routes. Credentials: pipeline\d1-config.json (the token carries
"Workers Scripts: Edit", granted by Mercy). Mercy approves every deploy.
After the upload the deployed code is downloaded and compared byte for byte.
Standard library only.
"""
import json, sys, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "pipeline" / "shared"))
import cf_kv  # noqa: E402

WORKERS = {"pages": ("our-money-pages", "pages.js"), "relay": ("our-money", "worker.js")}


def deployed(cred, name):
    raw = cf_kv.api(cred, "GET", "/accounts/%s/workers/scripts/%s/content/v2" % (cred["account"], name), raw=True)
    txt = raw.decode("utf-8", "replace")
    if not txt.lstrip().startswith("--"):
        return txt
    # a multipart answer: the code is the biggest part, after its headers
    import re
    part = max(re.split(r"\r?\n--[^\r\n]+", txt), key=len)
    return re.split(r"\r?\n\r?\n", part, maxsplit=1)[-1]


def same(a, b):
    n = lambda s: s.replace("\r\n", "\n").strip()
    return n(a) == n(b)


def main(argv):
    if not argv or argv[0] not in WORKERS:
        sys.exit("usage: deploy_worker.py pages|relay [--check]")
    name, fname = WORKERS[argv[0]]
    code = (HERE / fname).read_text(encoding="utf-8")
    # Cloudflare runs exactly what GitHub's main holds (Mercy): refuse a file
    # with uncommitted changes or one that isn't pushed to origin/main
    import subprocess
    git = lambda *a: subprocess.run(["git", *a], cwd=HERE.parent, capture_output=True, text=True, encoding="utf-8")
    git("fetch", "-q", "origin", "main")
    if git("status", "--porcelain", "worker/" + fname).stdout.strip():
        sys.exit("worker/%s has uncommitted changes — commit and push first" % fname)
    on_main = git("show", "origin/main:worker/" + fname)
    if on_main.returncode or not same(on_main.stdout, code):
        sys.exit("worker/%s differs from GitHub (origin/main) — push first; Cloudflare must run what GitHub holds" % fname)
    cred = cf_kv.credentials(str(HERE.parent / "pipeline" / "d1-config.json"))
    if not cred:
        sys.exit("no Cloudflare credentials (pipeline\\d1-config.json)")
    live = deployed(cred, name)
    if "--check" in argv:
        print("%s: deployed code %s worker/%s" % (name, "MATCHES" if same(live, code) else "DIFFERS FROM", fname))
        return 0
    if same(live, code):
        print("%s already runs worker/%s — nothing to deploy" % (name, fname))
        return 0
    b = "----ourmoney" + uuid.uuid4().hex
    body = (
        "--%s\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n%s\r\n"
        "--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
        "Content-Type: application/javascript+module\r\n\r\n%s\r\n--%s--\r\n"
        % (b, json.dumps({"main_module": fname}), b, fname, fname, code, b)).encode("utf-8")
    cf_kv.api(cred, "PUT", "/accounts/%s/workers/scripts/%s/content" % (cred["account"], name),
              body=body, content_type="multipart/form-data; boundary=" + b)
    if not same(deployed(cred, name), code):
        sys.exit("%s: uploaded, but the deployed code does not match worker/%s — check the dashboard" % (name, fname))
    print("%s: deployed worker/%s and read it back — OK" % (name, fname))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
