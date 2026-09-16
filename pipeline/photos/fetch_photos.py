#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Collect the official Knesset member photos onto our own disk — hands-free.
get-photos.bat runs this; run it again after each election.

Where the photos are: GET MKs/GetMkdetailsHeader?mkId=N → `MkImage`
(current members) else `LobbyImage` (past members) on fs.knesset.gov.il;
both answer through our relay. (SpList/GetMKImages checks Origin/Referer
and answers a literal `null` — don't bother.) A genuine miss is one where
BOTH fields are empty or the image does not download. More lessons:
NOTES.md here.

Output: mk/<MkId>.<ext> + mk/index.json, next to this script
        ({"<MkId>": "<filename>"} — the page shows photos ONLY for ids in
        the manifest). The site keeps no photos of its own: after this
        script run publish-photos.bat, which puts everything into KV.

Zero-install: standard library only. If Pillow is ALSO installed
(`pip install pillow`), photos are shrunk to web size (512px, JPEG) — the
site never shows them larger than 72px, so this cuts the folder ~5x with no
visible difference. Without Pillow the originals are kept as-is.

Politeness (this is somebody else's server): ~0.8s pause between members,
skip everything already collected, and remember members known to have no
photo (misses.json) so re-runs don't re-ask about them. A full historical
run (~1,100 people) is a one-time ~30-minute stroll, not a hammering.

  --refresh   re-download photos we already have + re-check known misses
  --all       everyone in the MK directory, not just current members
"""
import json, re, sys, time, urllib.request, urllib.parse
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent            # pipeline\photos\
OUT = HERE / "mk"
# the relay address is read from the site's config.js: pipeline\photos\ →
# pipeline\ → NewsWebsite\ → site\shared\config.js (the other candidates are for
# a copy of this script sitting somewhere else)
CONFIG_CANDIDATES = [HERE.parent.parent / "site" / "shared" / "config.js",
                     HERE / "config.js", HERE.parent / "config.js",
                     HERE.parent / "site" / "shared" / "config.js"]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
KAPI = "https://knesset.gov.il/WebSiteApi/knessetapi/MKs/"

# image files are recognised by BYTES, never by extension (project rule —
# a block page saved with a .jpg name poisons the folder silently)
MAGIC = [(b"\xff\xd8\xff", "jpg"), (b"\x89PNG", "png"),
         (b"GIF8", "gif"), (b"RIFF", "webp")]


def sniff(data):
    for magic, ext in MAGIC:
        if data[:len(magic)] == magic:
            return ext
    return None


def try_pillow():
    try:
        from PIL import Image
        return Image
    except ImportError:
        return None


MAX_SIDE = 512     # the site shows at most 72px — 512 keeps retina headroom
JPEG_Q = 82


def shrink(data, Image):
    """re-encode to a small web JPEG; None = keep the original (already small,
    or not something Pillow understands)."""
    import io
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        if im.mode == "P":
            im = im.convert("RGBA")
        if im.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        if max(w, h) > MAX_SIDE:
            r = MAX_SIDE / float(max(w, h))
            resample = getattr(Image, "Resampling", Image).LANCZOS
            im = im.resize((max(1, round(w * r)), max(1, round(h * r))), resample)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=JPEG_Q, optimize=True)
        b = out.getvalue()
        return b if len(b) < len(data) else None
    except Exception:
        return None


def normalize_existing(index, Image):
    """one-time diet for photos collected before the shrink step existed"""
    changed = 0
    for key, fname in list(index.items()):
        p = OUT / fname
        if not p.exists():
            continue
        data = p.read_bytes()
        if len(data) <= 70_000:
            continue
        small = shrink(data, Image)
        if not small:
            continue
        new = key + ".jpg"
        (OUT / new).write_bytes(small)
        if new != fname:
            try:
                p.unlink()
            except OSError:
                pass
            index[key] = new
        changed += 1
    return changed


def proxy_url():
    found = next((c for c in CONFIG_CANDIDATES if c.exists()), None)
    if not found:
        sys.exit("could not find the site's config.js (looked in: %s)"
                 % ", ".join(str(c) for c in CONFIG_CANDIDATES))
    cfg = found.read_text(encoding="utf-8")
    # the file's setup COMMENT contains an example address ("our-money.mercy…")
    # — strip comments first, or the example is found before the real setting
    # (that exact mistake produced a mysterious 404 on the first live run)
    cfg = re.sub(r"/\*.*?\*/", "", cfg, flags=re.S)          # block comments
    cfg = re.sub(r"(?m)^\s*//[^\n]*", "", cfg)               # whole-line // only —
    # a trailing-comment regex would eat the // inside "https://" itself
    m = re.search(r'PROXY_URL\s*=\s*"([^"]+)"', cfg)
    if not m:
        sys.exit("could not find PROXY_URL in " + str(found))
    return m.group(1).rstrip("/")


# where the portrait URL lives in a GetMkdetailsHeader answer, in order of
# preference: current members fill MkImage; past members have MkImage null
# and the portrait in LobbyImage (see the docstring)
IMAGE_FIELDS = ("MkImage", "LobbyImage")


def image_url(hdr):
    """the portrait URL from a GetMkdetailsHeader answer, or None"""
    if not isinstance(hdr, dict):
        return None
    for field in IMAGE_FIELDS:
        v = hdr.get(field)
        if isinstance(v, str) and v.strip().lower().startswith("http"):
            return v.strip()
    return None


def relay(proxy, url, timeout=30):
    """fetch an address through the relay (the proven route to knesset.gov.il)"""
    req = urllib.request.Request(proxy + "/?url=" + urllib.parse.quote(url, safe=""),
                                 headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        # say WHO refused and what they said — a bare status number hides the culprit
        detail = ""
        try:
            detail = e.read(300).decode("utf-8", "replace").strip()
        except Exception:
            pass
        raise RuntimeError("HTTP %d from the relay at %s%s"
                           % (e.code, proxy, (" — " + detail) if detail else ""))


def main():
    refresh = "--refresh" in sys.argv
    everyone = "--all" in sys.argv
    proxy = proxy_url()

    print("reading the member list...")
    try:
        listing = json.loads(relay(proxy, KAPI + "GetMksDropdown?languageKey=he"))
    except Exception as e:
        sys.exit("could not read the MK list through the relay: %s" % e)
    people = [(int(m["ID"]), m.get("Name", "")) for m in listing
              if everyone or m.get("IsCurrent")]
    print("members to collect: %d%s" % (len(people), "" if everyone else " (current Knesset)"))

    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    misses_path = OUT / "misses.json"
    misses = set(json.loads(misses_path.read_text(encoding="utf-8"))) if misses_path.exists() else set()

    Image = try_pillow()
    if Image:
        n = normalize_existing(index, Image)
        # ALWAYS say what happened — a silent no-op looks like a broken run
        print("photo shrinker: Pillow found — " +
              ("%d photos shrunk to web size" % n if n else "everything is already web size"))
    else:
        print("note: Pillow not installed — photos are kept at full size.")
        print("      `pip install pillow` and re-run to shrink the folder ~5x.")

    todo = sum(1 for i, _ in people
               if refresh or (str(i) not in index and str(i) not in misses))
    if todo > 200:
        print("about %d members to fetch — at a polite pace that is roughly %d minutes."
              % (todo, max(1, todo * 2 // 90)))
        print("feel free to stop (Ctrl+C) and re-run later: it continues where it left off.")

    saved, kept, missing = 0, 0, []
    for mk_id, name in people:
        key = str(mk_id)
        if not refresh and key in index and (OUT / index[key]).exists():
            kept += 1
            continue
        if not refresh and key in misses:
            missing.append("%s (%s)" % (name, key))
            continue
        img_url = None
        try:
            hdr = json.loads(relay(proxy, KAPI + "GetMkdetailsHeader?mkId=%d&languageKey=he" % mk_id))
            img_url = image_url(hdr)          # MkImage, else LobbyImage (past members)
        except Exception:
            pass
        data = None
        if img_url:
            try:
                data = relay(proxy, img_url)
            except Exception:
                data = None
        if not data or not sniff(data) or len(data) < 1500:
            missing.append("%s (%s)" % (name, key))
            misses.add(key)
            time.sleep(0.8)      # a "no" costs the server the same as a "yes"
            continue
        small = shrink(data, Image) if Image else None
        fname = key + (".jpg" if small else "." + sniff(data))
        (OUT / fname).write_bytes(small or data)
        index[key] = fname
        misses.discard(key)
        saved += 1
        print("  + %s -> %s" % (name, fname))
        # politeness: this is somebody else's server. ~0.8s per member keeps a
        # full historical run around half an hour — a stroll, not a hammering
        time.sleep(0.8)

    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=0),
                          encoding="utf-8")
    misses_path.write_text(json.dumps(sorted(misses)), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.iterdir() if f.is_file())
    print()
    print("done: %d downloaded, %d already had, %d in the manifest — folder: %.1f MB"
          % (saved, kept, len(index), total / 1048576))
    if missing:
        # the full list, never a sample — the missing face is exactly the one
        # someone will go looking for
        print("no photo found for %d members:" % len(missing))
        for m in missing:
            print("  - " + m)
        print("(the Knesset simply has no portrait for some members — re-running")
        print(" later can fill in the rest; the site shows initials meanwhile)")
    print()
    print("mk\\index.json is up to date. Now run publish-photos.bat to put the faces")
    print("on Cloudflare — the MK page reads them from there.")
    print("after an election: run me again, then publish-photos.bat — new members get added.")


if __name__ == "__main__":
    main()
