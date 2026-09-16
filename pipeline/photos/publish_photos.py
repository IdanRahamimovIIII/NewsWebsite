#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_photos.py — puts the Knesset members' portraits (photos\\mk\\) into
Cloudflare KV, where the relay serves them to the MK page.

WHY (Mercy: photos are SELF-HOSTED; the site keeps
no data, everything a page shows comes from an API or from Cloudflare).
get-photos.bat collects the official portraits from the Knesset; this
publishes them. KV, not R2 (settled): 120 files × ~20 KB today,
~22 MB if every past member is ever collected — KV is already bound to the
worker and the token already writes to it; a bucket, a binding and a
permission would be infrastructure for 3 MB of files.

WHAT THE PAGE EXPECTS (site\\mk_page\\mk.data.js, since 2026-09-06):
  GET <relay>/data/mkphotos  → {t, data: {"<MkId>": "<filename>"}}
  GET <relay>/photos/mk/<filename> → the image bytes

WHAT THIS WRITES:
  pub:mkphotos                     the manifest, in the relay's envelope
  photo:mk/<MkId>-<hash8>.jpg      the bytes (binary, via the bulk API base64)

CONTENT-HASHED FILENAMES: the stored name carries the first 8 hex chars of
the file's md5, and the manifest points at it. So the worker can send
`Cache-Control: immutable, max-age=1 year` and a browser never has to ask
twice for a face — yet after `get-photos.bat --refresh` a changed portrait
gets a NEW name, the manifest changes, and every visitor sees it at once.
Unchanged photos are never re-uploaded (the key is already there); names
no manifest points at any more are deleted, so KV never accumulates.

TRUST CONTENT, NOT STATUS WORDS: the manifest and every image written this
run are read back and compared byte for byte; then the relay is asked for
/data/mkphotos and one image, the way a browser would.

Credentials: pipeline\\d1-config.json (the D1 token with "Workers KV
Storage: Edit"), or env CF_API_TOKEN + CF_ACCOUNT_ID. Standard library.

usage:  publish_photos.py [--photos DIR] [--config FILE] [--namespace TITLE]
                          [--dry-run] [--verify-only]
"""
import argparse, hashlib, json, os, sys, time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))                  # pipeline\photos
ROOT = os.path.dirname(HERE)                                        # pipeline
sys.path.insert(0, os.path.join(ROOT, "shared"))
import cf_kv

log = cf_kv.log
PREFIX = "photo:mk/"
MANIFEST_KEY = "pub:mkphotos"
MAGIC = [(b"\xff\xd8\xff", "jpg"), (b"\x89PNG", "png"), (b"GIF8", "gif"), (b"RIFF", "webp")]


def sniff(data):
    for magic, ext in MAGIC:
        if data[:len(magic)] == magic:
            return ext
    return None


def load_photos(photos_dir):
    """index.json ({MkId: filename}) + the bytes of every file it names.
    Refuses a manifest entry whose file is missing or is not an image —
    a broken face on the site is worse than an initials avatar."""
    idx_path = os.path.join(photos_dir, "index.json")
    if not os.path.exists(idx_path):
        sys.exit("no index.json in %s — run get-photos.bat first (it collects the "
                 "portraits and writes the manifest there)." % photos_dir)
    with open(idx_path, encoding="utf-8") as fh:
        index = json.load(fh)
    if not index:
        sys.exit("index.json is empty — nothing to publish")
    photos, problems = {}, []
    for mk_id, fname in index.items():
        p = os.path.join(photos_dir, fname)
        if not os.path.exists(p):
            problems.append("%s → %s: file missing" % (mk_id, fname))
            continue
        data = open(p, "rb").read()
        ext = sniff(data)
        if not ext or len(data) < 1500:
            problems.append("%s → %s: not an image (%d bytes)" % (mk_id, fname, len(data)))
            continue
        photos[str(mk_id)] = (data, ext)
    if problems:
        sys.exit("index.json names %d entr%s that cannot be published:\n  %s\n"
                 "(re-run get-photos.bat --refresh, or remove them from index.json)"
                 % (len(problems), "y" if len(problems) == 1 else "ies", "\n  ".join(problems)))
    return photos


def plan(photos, t=None):
    """manifest {MkId: stored name} + [(key, bytes)] for every image"""
    manifest, images = {}, []
    for mk_id in sorted(photos, key=lambda k: int(k) if k.isdigit() else k):
        data, ext = photos[mk_id]
        name = "%s-%s.%s" % (mk_id, hashlib.md5(data).hexdigest()[:8], ext)
        manifest[mk_id] = name
        images.append((PREFIX + name, data))
    return manifest, images, (MANIFEST_KEY, cf_kv.envelope(manifest, t))


def relay_check(relay, manifest):
    """what a browser gets: the manifest, then one face through the worker"""
    out = []
    status, body, _ = cf_kv.relay_get(relay + "/data/mkphotos")
    if status != 200:
        text = body.decode("utf-8", "replace")
        hint = (" — the WORKER is the old one: paste worker.js into the dashboard and Deploy"
                if status == 404 and "Unknown dataset" in text else "")
        return False, ["/data/mkphotos → HTTP %d %s%s" % (status, text.strip()[:100], hint)]
    j = json.loads(body.decode("utf-8"))
    served = (j.get("data") or {})
    same = served == manifest
    out.append("/data/mkphotos → %d members%s" % (len(served), "" if same else " — DIFFERS from what was just written (stale edge cache? try again in a minute)"))
    mk_id = next(iter(manifest))
    status, body, ctype = cf_kv.relay_get(relay + "/photos/mk/" + manifest[mk_id])
    ok_img = status == 200 and bool(sniff(body))
    out.append("/photos/mk/%s → HTTP %d, %s, %d bytes%s" % (
        manifest[mk_id], status, ctype or "?", len(body),
        "" if ok_img else " — NOT an image (worker route missing? paste worker.js + Deploy)"))
    return same and ok_img, out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--photos", default=os.path.join(HERE, "mk"), help="folder with index.json + the images")
    ap.add_argument("--config", default=os.path.join(ROOT, "d1-config.json"))
    ap.add_argument("--namespace", default=None, help="KV namespace TITLE (default: %s, else the only one)"
                    % " / ".join(cf_kv.NAMESPACE_TITLES))
    ap.add_argument("--dry-run", action="store_true", help="show the plan, touch nothing")
    ap.add_argument("--verify-only", action="store_true", help="compare KV with the folder, write nothing")
    ap.add_argument("--relay", default=None, help="relay base url (default: site\\config.js)")
    a = ap.parse_args()

    photos = load_photos(a.photos)
    manifest, images, man_item = plan(photos)
    total = sum(len(d) for d, _ in photos.values())
    log("portraits: %d members · %.1f MB · manifest %d bytes"
        % (len(manifest), total / 1e6, len(man_item[1].encode("utf-8"))))
    if a.dry_run:
        for mk_id, name in list(manifest.items())[:5]:
            log("  %s → %s" % (mk_id, name))
        log("  … dry run — nothing written.")
        return

    cred = cf_kv.credentials(a.config)
    if not cred:
        sys.exit("no Cloudflare credentials: fill account_id + api_token in %s (the D1 token, "
                 "with 'Workers KV Storage: Edit'), or set CF_API_TOKEN + CF_ACCOUNT_ID." % a.config)
    log("credentials from %s · account %s…" % (cred["source"], cred["account"][:6]))
    try:
        ns = cf_kv.namespace_id(cred, a.namespace)
        log("KV namespace = %s" % ns)

        have = set(cf_kv.list_keys(cred, ns, PREFIX))
        wanted = {k for k, _ in images}
        new = [(k, v) for k, v in images if k not in have]
        stale = sorted(have - wanted)
        log("in KV already: %d · to upload: %d · stale (no longer in the manifest): %d"
            % (len(have & wanted), len(new), len(stale)))

        if not a.verify_only:
            if new:
                cf_kv.bulk_put(cred, ns, new)
            cf_kv.bulk_put(cred, ns, [man_item])
            if stale:
                cf_kv.bulk_delete(cred, ns, stale)
                log("  deleted %d stale image(s)." % len(stale))

        log("reading back the manifest and %d image(s)…" % len(new))
        bad = cf_kv.verify(cred, ns, [man_item] + new)
    except RuntimeError as e:
        sys.exit("\n" + str(e))
    if bad:
        for b in bad:
            log("  ✘ " + b)
        sys.exit("%d key(s) do not match what was sent — run again; if it persists the line above says which."
                 % len(bad))
    log("  ✔ manifest + %d image(s) match byte for byte; %d member(s) published."
        % (len(new), len(manifest)))

    relay = a.relay or cf_kv.relay_url(ROOT)
    if relay:
        ok, lines = relay_check(relay, manifest)
        for line in lines:
            log(("  ✔ " if ok else "  ✘ ") + line)
    else:
        log("  (relay address unknown — pass --relay to check the worker routes)")
    log("done. The MK page shows the faces once the worker serves /data/mkphotos and /photos/mk/.")


if __name__ == "__main__":
    main()
