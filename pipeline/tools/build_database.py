#!/usr/bin/env python3
"""
build_database.py — the whole database build, one command, on Mercy's own
computer. Run by double-clicking build-database.bat at the project root.

WHY THIS EXISTS: the databases come out at 1–2 GB — too big for the device
bridge and pointless in git — so the build has to be reproducible LOCALLY
from the inputs in pipeline\inputs\ (2026-09-05 layout; the old locations
are still searched as a fallback, so an old copy keeps working):

  pipeline\inputs\full-records.zip        the .full.json artifact (Actions → refresh data)
  pipeline\inputs\*\mr-exemptions.json(.gz) the registers, converted (inside the
  pipeline\inputs\*\mr-tenders.json         Exemptions-*/ and Tenders-*/ export folders)
  pipeline\inputs\budgetkey-raw.zip       OPTIONAL until collected (Actions → collect
  or build/raw/                    budgetkey) — without it the build says loudly
                                   that the BudgetKey side is missing

and produce ONE output (Mercy, 2026-09-06: one file to manage, not two):

  pipeline\out\contracts-public.db     the D1 upload: no audit, dictionary-encoded.

The FULL database (every field + provenance per field + fingerprints + the
register rows embedded) is still written — the public copy is DERIVED from
it (build_sqlite.public_copy ATTACHes it), and audit.bat reads it — but it
is a build INTERMEDIATE, not an output:

  pipeline\build\contracts-full.db     rebuildable; clean-up.bat deletes it;
                                       audit.bat says "run the build" when it is gone.

Standard library + the project's own tools. Nothing to install.
"""
import glob, gzip, json, os, shutil, sys, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dataset
import build_sqlite

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUTS = "inputs"      # pipeline\inputs\ — the zips and the export folders
OUT = "out"            # pipeline\out\ — the one output, contracts-public.db
FULL_DB = os.path.join("build", "contracts-full.db")   # intermediate; audit reads it


def newest(patterns):
    """Newest file matching any pattern, looked for in pipeline\inputs\ first and
    then at the project root (the pre-2026-09-05 location)."""
    hits = []
    for p in patterns:
        hits += glob.glob(os.path.join(ROOT, INPUTS, p))
        hits += glob.glob(os.path.join(ROOT, p))
    return max(hits, key=os.path.getmtime) if hits else None


def ready_register(kind):
    """Find the register JSON wherever it lives; gunzip a .gz beside it."""
    plain = newest(["mr-%s.json" % kind, "*/mr-%s.json" % kind])
    gz = newest(["mr-%s.json.gz" % kind, "*/mr-%s.json.gz" % kind])
    if plain and (not gz or os.path.getmtime(plain) >= os.path.getmtime(gz)):
        return plain
    if gz:
        out = os.path.join(ROOT, "build", "mr-%s.json" % kind)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        print("  unpacking %s…" % os.path.basename(gz))
        with gzip.open(gz, "rb") as i, open(out, "wb") as o:
            shutil.copyfileobj(i, o)
        return out
    return None


def main():
    os.chdir(ROOT)

    # ---- the ministry files (full records) ----
    zp = newest(["full-records.zip"])
    full_dir = os.path.join("build", "full")
    if zp:
        print("unpacking %s…" % os.path.basename(zp))
        shutil.rmtree(full_dir, ignore_errors=True)
        os.makedirs(full_dir)
        with zipfile.ZipFile(zp) as z:
            z.extractall(full_dir)
    if not os.path.isdir(full_dir) or not any(
            n.endswith(".full.json") for n in os.listdir(full_dir)):
        sys.exit("no full records: put full-records.zip in pipeline\inputs "
                 "(GitHub → Actions → the latest green 'refresh data' run → "
                 "Artifacts → full-records) and run this again.")

    # ---- the registers ----
    ex = ready_register("exemptions")
    tn = ready_register("tenders")
    if not ex or not tn:
        sys.exit("register JSON not found (mr-exemptions / mr-tenders). They "
                 "are produced by 'collect portal registers' (artifact "
                 "portal-registers) or by parse_portal_export.py from the "
                 "portal export folders.")

    # ---- BudgetKey, optional until Mercy's collection run is done ----
    bk_zip = newest(["budgetkey-raw.zip"])
    bk_dir = os.path.join("build", "raw")
    if bk_zip:
        print("unpacking %s…" % os.path.basename(bk_zip))
        shutil.rmtree(bk_dir, ignore_errors=True)
        os.makedirs(bk_dir)
        with zipfile.ZipFile(bk_zip) as z:
            z.extractall(bk_dir)
    has_bk = os.path.isdir(bk_dir) and any(
        n.endswith(".json") and n != "status.json" for n in os.listdir(bk_dir))
    if not has_bk:
        print("\nNOTE: no BudgetKey input (budgetkey-raw.zip / build\\raw) — "
              "building from the files and the registers only. Supplier "
              "identity, the reports[] history and every bk field stay "
              "empty until 'collect budgetkey' runs and its artifact lands "
              "here.\n")

    # ---- build ----
    print("merging every source (a few minutes at full scale)…")
    build_dataset.build(full_dir, bk_dir if has_bk else None,
                        os.path.join("build", "contracts"), ex, tn)

    os.makedirs(OUT, exist_ok=True)
    full_db = FULL_DB
    public_db = os.path.join(OUT, "contracts-public.db")
    # an out\contracts.db from before 2026-09-06 is the same thing under its
    # old name — say so once, so nobody wonders which of the two is current
    old = os.path.join(OUT, "contracts.db")
    if os.path.exists(old):
        print("NOTE: %s is the OLD full database (pre-2026-09-06 layout). The "
              "build now writes it to %s; delete the old one.\n" % (old, full_db))
    print("\nwriting the full database (intermediate) %s…" % full_db)
    build_sqlite.build(os.path.join("build", "contracts"), full_db,
                       log=lambda *a: None)
    build_sqlite.embed_registers(full_db, ex, tn)
    print("deriving the public copy…")
    build_sqlite.public_copy(full_db, public_db)

    print("\ndone:")
    print("  %-30s %6.1f MB   <- upload-to-d1.bat sends this"
          % (public_db, os.path.getsize(public_db) / 1e6))
    print("  %-30s %6.1f MB   <- audit.bat reads this; clean-up.bat deletes it"
          % (full_db, os.path.getsize(full_db) / 1e6))


if __name__ == "__main__":
    main()
