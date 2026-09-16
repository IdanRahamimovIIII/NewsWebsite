#!/usr/bin/env python3
"""build_database.py — the whole database build, one command, on Mercy's
own computer. Run by double-clicking contractors\build-database.bat.
(CI uses pipeline2.py build instead — same pieces, streaming merge.)

The databases come out at 1-2 GB — too big for the device bridge and
pointless in git — so the build is reproducible LOCALLY from
contractors\inputs\:

  full-records.zip                  the .full.json artifact (refresh data)
  */mr-exemptions.json(.gz)         the registers, converted
  */mr-tenders.json(.gz)
  budgetkey-raw.zip                 optional — without it the build says
                                    loudly that the BudgetKey side is missing

Outputs: contractors\out\contracts-public.db (the D1 upload, ctr_* tables
included). The FULL db (provenance + fingerprints + embedded registers) is
a build INTERMEDIATE at build\contracts-full.db — audit.bat reads it,
clean-up.bat deletes it. Stdlib + the project's own tools; nothing to install.
"""
import glob, gzip, json, os, shutil, sys, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "shared"))
import build_dataset
import build_sqlite

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUTS = os.path.join("contractors", "inputs")   # the zips and export folders
OUT = os.path.join("contractors", "out")         # the one output, contracts-public.db
FULL_DB = os.path.join("build", "contracts-full.db")   # intermediate; audit reads it


def newest(patterns):
    """Newest file in contractors\inputs\ matching any pattern."""
    hits = []
    for p in patterns:
        hits += glob.glob(os.path.join(ROOT, INPUTS, p))
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
        sys.exit("no full records: put full-records.zip in "
                 "pipeline\\contractors\\inputs "
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
    print("\nwriting the full database (intermediate) %s…" % full_db)
    build_sqlite.build(os.path.join("build", "contracts"), full_db,
                       log=lambda *a: None)
    build_sqlite.embed_registers(full_db, ex, tn)
    print("deriving the public copy…")
    build_sqlite.public_copy(full_db, public_db)

    # ---- the contractors page's precomputed tables ----
    # part of every full build so a rebuild never loses them; can also run
    # alone via build-contractors.bat. Definitions: NOTES.md here.
    print("\nprecomputing the contractors page tables "
          "(build_contractors.py)…")
    import build_contractors
    build_contractors.build(public_db)

    print("\ndone:")
    print("  %-30s %6.1f MB   <- contractors\\upload-to-d1.bat sends this"
          % (public_db, os.path.getsize(public_db) / 1e6))
    print("  %-30s %6.1f MB   <- audit.bat reads this; clean-up.bat deletes it"
          % (full_db, os.path.getsize(full_db) / 1e6))


if __name__ == "__main__":
    main()
