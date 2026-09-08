#!/usr/bin/env python3
r"""
test_archive.py — the raw archive's rules, on fixtures (no GitHub calls:
everything runs --dry-run against a local bundle dir).

The rules pinned here ARE the design (NOTES.md, PIPELINE v2):
  - a file is archived once, keyed by CONTENT (same bytes twice = no-op);
  - a REVISED report (same name, new bytes) becomes a NEW entry BESIDE the
    old one — never an overwrite: the history keeps both revisions;
  - provenance (url/year/period/publisher) rides in from the fetcher's
    manifest;
  - bundles are stable (first hex char of the hash);
  - THE GUARD: the manifest may only grow — a run that would shrink it dies.

Run:  python3 contractors/test_archive.py   (from pipeline\)
"""
import json, os, shutil, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import archive as A

npass = nfail = 0
def ok(name, cond, extra=""):
    global npass, nfail
    if cond:
        npass += 1; print("  ✔ " + name)
    else:
        nfail += 1; print("  ✘ " + name + ("  → %r" % (extra,) if extra != "" else ""))

tmp = tempfile.mkdtemp(prefix="arch-test-")
reports = os.path.join(tmp, "reports"); os.makedirs(reports)
bundles = os.path.join(tmp, "bundles")
manifest = os.path.join(tmp, "archive", "manifest.json")

def put(name, content):
    with open(os.path.join(reports, name), "wb") as fh:
        fh.write(content)

put("education_1_2025.xlsx", b"PK-fake-education-q1-v1")
put("health_3_2024.xls", b"OLE2-fake-health")
with open(os.path.join(reports, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump({"https://gov.il/edu.xlsx": {"file": "education_1_2025.xlsx",
                                           "year": 2025, "period": 1,
                                           "publisher": "משרד החינוך"},
               "https://foi.gov.il/h.xls": {"file": "health_3_2024.xls",
                                            "year": 2024, "period": 3,
                                            "via": "wayback"}}, fh,
              ensure_ascii=False)

print("first ingest:")
r = A.ingest_reports(reports, manifest, os.path.join(reports, "manifest.json"),
                     dry_run=True, bundle_dir=bundles)
man = A.load_manifest(manifest)
ok("both files archived", r["new"] == 2 and len(man["files"]) == 2, man)
key_edu = [k for k in man["files"] if k.endswith("education_1_2025.xlsx")][0]
ok("provenance rides in from the fetcher's manifest",
   man["files"][key_edu]["url"] == "https://gov.il/edu.xlsx" and
   man["files"][key_edu]["publisher"] == "משרד החינוך", man["files"][key_edu])
ok("bundle = first hex char of the content hash",
   man["files"][key_edu]["bundle"] == "reports-%s.zip" % key_edu[0])
bpath = os.path.join(bundles, man["files"][key_edu]["bundle"])
with zipfile.ZipFile(bpath) as z:
    ok("the bytes are in the bundle under <hash16>__<name>",
       key_edu in z.namelist(), z.namelist())

print("second ingest, nothing changed:")
r2 = A.ingest_reports(reports, manifest, os.path.join(reports, "manifest.json"),
                      dry_run=True, bundle_dir=bundles)
ok("same bytes twice = no-op", r2["new"] == 0)

print("a REVISED report:")
put("education_1_2025.xlsx", b"PK-fake-education-q1-v2-FIXED-NUMBERS")
r3 = A.ingest_reports(reports, manifest, os.path.join(reports, "manifest.json"),
                      dry_run=True, bundle_dir=bundles)
man = A.load_manifest(manifest)
revs = [k for k in man["files"] if k.endswith("education_1_2025.xlsx")]
ok("the fix is archived as a NEW entry", r3["new"] == 1 and len(revs) == 2, revs)
ok("…and the OLD revision is still there (never overwritten)",
   key_edu in man["files"], sorted(man["files"]))
ok("manifest holds 3 files total", len(man["files"]) == 3)

print("THE GUARD:")
try:
    A.save_manifest(manifest, {"files": {}}, A.counts(man))
    ok("a shrinking manifest is refused", False)
except SystemExit as e:
    ok("a shrinking manifest is refused", "SHRINK" in str(e), str(e))
ok("…and the manifest on disk is untouched",
   A.counts(A.load_manifest(manifest)) == 3)

shutil.rmtree(tmp, ignore_errors=True)
print("\n%d passed, %d failed" % (npass, nfail))
sys.exit(1 if nfail else 0)
