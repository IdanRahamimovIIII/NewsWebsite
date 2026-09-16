"""Fetch raw Excel tables of the BTL statistical bulletin (chapter 15 - unemployment).

Collection only - no parsing here. Zero-install: Python 3 stdlib.
raw\\latest\\ mirrors the site — latest copy only, no archive (Mercy:
raw-forever is a contracts-dataset rule). The manifest just reports change.
"""
import hashlib
import json
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = ("https://www.btl.gov.il/SiteCollectionDocuments/btl/Publications/"
        "Rivon%20Statisti/EXCELL/")
# O<chapter><table>: chapter 15 = unemployment. New chapters = new rows here.
FILES = ["O1501.XLS", "O1502.XLS", "O1503.XLS", "O1504.XLS", "O1505.xls"]
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

ROOT = Path(__file__).resolve().parent
LATEST = ROOT / "raw" / "latest"
MANIFEST = ROOT / "raw" / "manifest.json"


def fetch(name: str) -> bytes:
    req = urllib.request.Request(BASE + name, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> int:
    LATEST.mkdir(parents=True, exist_ok=True)
    manifest = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    today = date.today().isoformat()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    failed = changed = 0

    for name in FILES:
        try:
            data = fetch(name)
        except Exception as e:  # noqa: BLE001 - report and keep going per file
            print(f"FAIL {name}: {e}")
            manifest.setdefault(name, {})["last_error"] = f"{today} {e}"
            failed += 1
            continue
        # OLE2 magic = a real .xls; a WAF/error page must never replace good raw data
        if data[:4] != b"\xd0\xcf\x11\xe0":
            print(f"WARN {name}: response is not a .xls file - NOT saved")
            manifest.setdefault(name, {})["last_error"] = f"{today} not-ole2"
            failed += 1
            continue
        sha = hashlib.sha256(data).hexdigest()
        prev = manifest.get(name, {}).get("sha256")
        (LATEST / name).write_bytes(data)
        if sha != prev:
            changed += 1
        entry = manifest.get(name, {})
        entry.update({"url": BASE + name, "sha256": sha, "bytes": len(data),
                      "fetched": now})
        if sha != prev:
            entry["changed"] = today
        entry.pop("last_error", None)
        manifest[name] = entry
        note = "(new version)" if sha != prev else "(unchanged)"
        print(f"OK   {name}: {len(data):,} bytes {note}")

    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False),
                        encoding="utf-8")
    print(f"\n{changed} new/changed, {failed} failed. Files in raw\\latest\\")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
