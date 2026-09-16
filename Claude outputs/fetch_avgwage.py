#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_avgwage.py — the legal average wage (שכר ממוצע לפי חוק) from BTL.

Scrapes the נתונים כלליים page: current values + the 1999→ history table,
per section 1/2 of the law x benefits/contributions. Tiny dataset, big story
(the legislative freezes). Zero-install: stdlib only.

  python fetch_avgwage.py            fetch + parse only (green-run check)
  python fetch_avgwage.py --publish  ...then write to Cloudflare KV:
      pub:avgwage             the parsed snapshot -> served as /data/avgwage
      raw:avgwage:<date>      the raw page, archived WHEN CONTENT CHANGED
      raw:avgwage:index       {sha256, dates[]} - change detection lives in KV,
                              not on any disk (Mercy: raw archive in Cloudflare,
                              not on the PC). Stateless: safe from CI.

Publishing uses shared\\cf_kv.py (env CF_API_TOKEN/CF_ACCOUNT_ID in CI,
pipeline\\d1-config.json on Mercy's machine).
"""
import hashlib
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

PAGE = ("https://www.btl.gov.il/Mediniyut/GeneralData/Pages/"
        "%D7%A9%D7%9B%D7%A8%20%D7%9E%D7%9E%D7%95%D7%A6%D7%A2.aspx")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "raw" / "latest"          # transient working copies only (gitignored)

DATE_RE = re.compile(r"^\d{1,2}\.\d{2}\.\d{4}$")
NUM_RE = re.compile(r"^-?\d{1,3}(,\d{3})*(\.\d+)?$")
CURRENT_RE = re.compile(r"החל מ-?\s*(\d{1,2}\.\d{2}\.\d{4})")


def fetch_html() -> bytes:
    req = urllib.request.Request(PAGE, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def to_iso(d: str) -> str:
    dd, mm, yy = d.split(".")
    return "%s-%02d-%02d" % (yy, int(mm), int(dd))


def parse(html: str) -> dict:
    # SharePoint markup is messy: strip scripts/tags/entities/zero-widths,
    # then read rows as  <date> <8 numeric-or-"--" tokens>  (validated in-browser
    # against the live page: 29 rows, 1999->2026).
    text = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&#160;", " ")
    text = re.sub(r"[​‎‏﻿]", "", text)
    toks = text.split()

    def val(t):          # wage cells are whole shekels; "--" = no change published
        return None if t == "--" else int(t.replace(",", ""))

    def pct(t):
        return None if t == "--" else float(t.replace(",", ""))

    rows, i = [], 0
    while i < len(toks):
        if DATE_RE.match(toks[i]):
            vals = []
            j = i + 1
            while j < len(toks) and len(vals) < 8 and (NUM_RE.match(toks[j]) or toks[j] == "--"):
                vals.append(toks[j])
                j += 1
            if len(vals) == 8:
                rows.append({
                    "from": to_iso(toks[i]),
                    "s1_benefits": val(vals[0]), "s1_benefits_pct": pct(vals[1]),
                    "s1_contributions": val(vals[2]), "s1_contributions_pct": pct(vals[3]),
                    "s2_benefits": val(vals[4]), "s2_benefits_pct": pct(vals[5]),
                    "s2_contributions": val(vals[6]), "s2_contributions_pct": pct(vals[7]),
                })
                i = j
                continue
        i += 1

    m = CURRENT_RE.search(text)

    # sanity gates — a redesigned page must FAIL, never publish garbage
    if len(rows) < 20:
        raise RuntimeError("only %d rows parsed — page layout changed?" % len(rows))
    for r in rows:
        for k in ("s1_benefits", "s1_contributions", "s2_benefits", "s2_contributions"):
            if r[k] is not None and not (1000 <= r[k] <= 100000):
                raise RuntimeError("row %s: %s=%r out of sane range" % (r["from"], k, r[k]))
    rows.sort(key=lambda r: r["from"], reverse=True)
    if int(rows[0]["from"][:4]) < 2026:
        raise RuntimeError("newest row is %s — expected current data" % rows[0]["from"])
    if m and to_iso(m.group(1)) != rows[0]["from"]:
        raise RuntimeError("current-block date %s != newest row %s" % (m.group(1), rows[0]["from"]))

    return {
        "source": PAGE,
        "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        # what the fields mean, once, for every consumer (Hebrew labels)
        "labels": {
            "s1": "לפי סעיף 1 לחוק הביטוח הלאומי",
            "s2": "לפי סעיף 2 לחוק (בניכוי חודשי שכר חריגים)",
            "benefits": "לצורך קצבאות",
            "contributions": "לצורך דמי ביטוח",
        },
        "current": rows[0],
        "history": rows,
    }


def publish(data: dict, html: bytes) -> int:
    sys.path.insert(0, str(ROOT.parent / "shared"))
    import cf_kv
    cred = cf_kv.credentials(str(ROOT.parent / "d1-config.json"))
    if not cred:
        print("FAIL publish: no Cloudflare credentials (env CF_API_TOKEN/CF_ACCOUNT_ID"
              " or pipeline\\d1-config.json)")
        return 1
    ns = cf_kv.namespace_id(cred)

    # raw archive lives in KV, change-detected against KV (no local state)
    sha = hashlib.sha256(html).hexdigest()
    got = cf_kv.read_back(cred, ns, "raw:avgwage:index")
    index = json.loads(got.decode("utf-8")) if got else {"sha256": None, "dates": []}
    today = date.today().isoformat()
    items = []
    if index["sha256"] != sha:
        index["sha256"] = sha
        if today not in index["dates"]:
            index["dates"].append(today)
        items += [("raw:avgwage:" + today, html),
                  ("raw:avgwage:index", json.dumps(index))]
        print("     page changed — archiving raw:avgwage:%s (%d bytes)" % (today, len(html)))
    else:
        print("     page unchanged since last publish — raw archive already current")

    value = cf_kv.envelope(data)
    items.append(("pub:avgwage", value))
    cf_kv.bulk_put(cred, ns, items)
    bad = cf_kv.verify(cred, ns, items)
    if bad:
        print("FAIL publish read-back:", "; ".join(bad))
        return 1
    print("OK   published %d key(s) incl. pub:avgwage (%d bytes) — read back and matched"
          % (len(items), len(value)))
    relay = cf_kv.relay_url(str(ROOT.parent)) or ""
    if relay:  # informational probe; a just-published key can hide behind 1h edge cache
        status, body, _ = cf_kv.relay_get(relay + "/data/avgwage")
        print("     relay check GET /data/avgwage -> HTTP %d, %d bytes%s"
              % (status, len(body),
                 "" if status == 200 else "  (edge caches ~1h — recheck later, do not panic)"))
    return 0


def main() -> int:
    html = fetch_html()
    if b"\x00" in html[:200] or len(html) < 20000:
        print("FAIL: response does not look like the page (%d bytes)" % len(html))
        return 1
    WORK.mkdir(parents=True, exist_ok=True)          # working copies, not an archive
    (WORK / "avgwage.html").write_bytes(html)
    data = parse(html.decode("utf-8", "replace"))
    (WORK / "avgwage.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    cur = data["current"]
    print("OK   parsed %d rows; current from %s: s1 %s/%s  s2 %s/%s"
          % (len(data["history"]), cur["from"],
             cur["s1_benefits"], cur["s1_contributions"],
             cur["s2_benefits"], cur["s2_contributions"]))
    if "--publish" in sys.argv:
        return publish(data, html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
