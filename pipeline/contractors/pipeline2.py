#!/usr/bin/env python3
r"""pipeline2.py — the fully automatic monthly chain (build-and-update.yml).
Each piece is a subcommand so the workflow stays thin and a failed step
re-runs alone. Design: NOTES.md, "PIPELINE v2".

  fetch-inputs --dest DIR      pull everything a build needs from the
                               raw-archive Release (newest revision of each
                               report + fetcher-style manifest, BudgetKey
                               snapshot, newest register conversions).
  build --inputs DIR --work DIR [--scrub] [--baseline DB]
                               parse -> streaming merge (bounded memory) ->
                               full db -> public db with STABLE string ids
                               (seeded from the baseline) -> ctr_* tables.
                               --scrub (workflow-only) frees each stage's
                               disk once past it.
  update-d1 --db PUB --baseline OLD|-   apply the DELTA to D1 through the
                               verified REST flow, then full-replace the
                               small ctr_* tables. '-' = FULL upload (the
                               self-sufficient first run).
  rotate-baseline --db PUB     gzip + rotate db-current(.-previous).sqlite.gz
                               on the Release.
  check-credentials            prove the three CF_* values against D1 in
                               seconds (read-only) — the workflow runs it
                               FIRST so a bad secret costs a minute, not the
                               40-minute build. Locally: check-credentials.bat.

STRING IDS MUST BE STABLE across builds: the public db dictionary-encodes
Hebrew columns as integers into `strings`. A renumbering would make every
row "change" and turn the delta into the whole database — public_copy() is
seeded with the baseline's strings and only APPENDS.
"""
import argparse, glob, gzip, json, os, shutil, sqlite3, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "shared"))
import archive as ARC                     # noqa: E402
import build_dataset as BD                # noqa: E402
import build_sqlite as BS                 # noqa: E402
import build_contractors as BC            # noqa: E402
import upload_to_d1 as U                  # noqa: E402
# parse_all (-> parse_report -> openpyxl/xlrd) is imported inside build():
# the ONLY third-party dependency — every other subcommand must run on bare
# Python (Mercy's zero-install rule).

MANIFEST = os.path.join(HERE, "archive", "manifest.json")


# =====================================================================
# fetch-inputs — the archive → a build's input directories
# =====================================================================
def materialize_reports(manifest_path, dest, rel=None, bundle_dir=None,
                        only_missing=False, log=print):
    """Extract the NEWEST revision of every archived report into dest/, and
       write a fetcher-style manifest.json beside them so parse_all keeps
       its oldest-first (year, period) ordering. Old revisions stay in the
       archive for history — a build always works from the latest word."""
    man = ARC.load_manifest(manifest_path)
    os.makedirs(dest, exist_ok=True)
    # newest revision per original file name (ties: larger archived date,
    # then key order — deterministic either way)
    newest = {}
    for key, rec in man["files"].items():
        name = key.split("__", 1)[1]
        cur = newest.get(name)
        if cur is None or rec.get("archived", "") > cur[1].get("archived", ""):
            newest[name] = (key, rec)
    by_bundle = {}
    for name, (key, rec) in newest.items():
        by_bundle.setdefault(rec["bundle"], []).append((key, name))
    bundle_dir = bundle_dir or tempfile.mkdtemp(prefix="bundles-")
    for bundle, items in sorted(by_bundle.items()):
        local = os.path.join(bundle_dir, bundle)
        if not os.path.exists(local):
            if rel is None or not rel.download(bundle, local):
                sys.exit("bundle %s is in the manifest but not on the "
                         "release — the archive is inconsistent." % bundle)
        with zipfile.ZipFile(local) as z:
            for key, name in items:
                target = os.path.join(dest, name)
                if only_missing and os.path.exists(target):
                    continue
                with z.open(key) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
    fetch_man = {}
    for name, (key, rec) in newest.items():
        size = rec.get("size")
        if size is None:              # an entry without one would make the
            p = os.path.join(dest, name)   # fetcher's changed-size check
            if os.path.exists(p):          # re-download the whole archive
                size = os.path.getsize(p)
        fetch_man[rec.get("url") or ("archive://" + key)] = {
            "file": name, "size": size,
            "year": rec.get("year"), "period": rec.get("period"),
            "publisher": rec.get("publisher"), "via": rec.get("via")}
    with open(os.path.join(dest, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(fetch_man, fh, ensure_ascii=False)
    log("reports: %d files (newest revision each) from %d bundle(s)"
        % (len(newest), len(by_bundle)))
    return len(newest)


def fetch_inputs(dest, log=print):
    rel = ARC.Release().ensure()
    assets = rel.assets()
    reports = os.path.join(dest, "reports")
    n = materialize_reports(MANIFEST, reports, rel=rel, log=log)
    if n == 0:
        sys.exit("the archive holds ZERO report files — run the collect "
                 "ministry reports workflow (its archive step fills it) "
                 "before building.")

    # BudgetKey: the rotating snapshot; the hand-uploaded legacy zip as
    # fallback for the first runs
    raw = os.path.join(dest, "raw")
    os.makedirs(raw, exist_ok=True)
    bk = next((n2 for n2 in ("budgetkey-latest.zip", "budgetkey-raw.zip")
               if n2 in assets), None)
    if not bk:
        sys.exit("no BudgetKey snapshot on the release (budgetkey-latest.zip "
                 "or the legacy budgetkey-raw.zip) — run collect budgetkey, "
                 "or upload the legacy zip.")
    zp = os.path.join(dest, bk)
    rel.download(bk, zp)
    with zipfile.ZipFile(zp) as z:
        z.extractall(raw)
    # the legacy zip may nest its JSONs one level down — flatten
    for p in glob.glob(os.path.join(raw, "**", "*.json"), recursive=True):
        flat = os.path.join(raw, os.path.basename(p))
        if p != flat and not os.path.exists(flat):
            shutil.move(p, flat)
    log("budgetkey: %s → %d section files"
        % (bk, len(glob.glob(os.path.join(raw, "*.json")))))

    # the LEGACY parsed rows (Mercy's hand-uploaded full-records.zip):
    # every report's rows as parsed while everything was still reachable.
    # The build seeds its parse output from these, so a build is COMPLETE
    # even while the report archive is still catching up on the fetch
    # backlog — without it, a partial archive would mean a database with
    # LESS ministry-file data than what is already live in D1.
    if "full-records.zip" in assets:
        rel.download("full-records.zip", os.path.join(dest, "full-records.zip"))
        log("legacy full-records.zip: fetched (parse seed)")

    # registers: newest dated portal snapshot, else the legacy conversions
    reg = os.path.join(dest, "registers")
    os.makedirs(reg, exist_ok=True)
    portal = sorted(n2 for n2 in assets if n2.endswith("portal-registers.tar.gz"))
    if portal:
        tarball = os.path.join(dest, portal[-1])
        rel.download(portal[-1], tarball)
        import tarfile
        with tarfile.open(tarball) as t:
            t.extractall(reg)
        log("registers: %s" % portal[-1])
    else:
        for name in ("mr-exemptions.json.gz", "mr-exemptions.json",
                     "mr-tenders.json.gz", "mr-tenders.json"):
            if name in assets:
                rel.download(name, os.path.join(reg, name))
    ex = _find_register(reg, "exemptions")
    tn = _find_register(reg, "tenders")
    if not ex or not tn:
        sys.exit("register conversions not found (mr-exemptions / mr-tenders)"
                 " — run collect portal registers, or upload the legacy "
                 "mr-*.json files onto the release.")
    log("registers ready: %s · %s" % (os.path.basename(ex), os.path.basename(tn)))
    return {"reports": reports, "raw": raw, "ex": ex, "tn": tn}


def _find_register(reg_dir, kind):
    hits = (glob.glob(os.path.join(reg_dir, "**", "*%s*.json" % kind),
                      recursive=True) +
            glob.glob(os.path.join(reg_dir, "**", "*%s*.json.gz" % kind,),
                      recursive=True))
    if not hits:
        return None
    p = max(hits, key=os.path.getmtime)
    if p.endswith(".gz"):
        out = p[:-3]
        with gzip.open(p, "rb") as i, open(out, "wb") as o:
            shutil.copyfileobj(i, o)
        return out
    return p


def restore_reports(dest, log=print):
    """Refill pipeline/reports from the archive (newest revision of every
       file the cache no longer holds) and MERGE the provenance into the
       fetcher's manifest — existing (cache) entries win. Run before the
       fetch: an evicted cache then stops meaning re-downloads, blocked
       hosts, and the never-shrink guard tripping on a publisher that
       simply failed to re-fetch in time."""
    man = ARC.load_manifest(MANIFEST)
    if not man["files"]:
        log("archive empty — nothing to restore (first runs).")
        return 0
    os.makedirs(dest, exist_ok=True)
    existing = {}
    man_path = os.path.join(dest, "manifest.json")
    if os.path.exists(man_path):
        with open(man_path, encoding="utf-8") as fh:
            existing = json.load(fh)
    before = len([n for n in os.listdir(dest)
                  if n.lower().endswith((".xlsx", ".xls"))])
    tmpdir = tempfile.mkdtemp(prefix="restore-")
    materialize_reports(MANIFEST, tmpdir, rel=ARC.Release().ensure(),
                        only_missing=False, log=log)
    restored = 0
    for name in os.listdir(tmpdir):
        if name == "manifest.json":
            continue
        target = os.path.join(dest, name)
        if not os.path.exists(target):
            shutil.move(os.path.join(tmpdir, name), target)
            restored += 1
    with open(os.path.join(tmpdir, "manifest.json"), encoding="utf-8") as fh:
        arch_man = json.load(fh)
    merged = dict(arch_man)
    merged.update(existing)              # the cache's own entries win
    with open(man_path, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False)
    shutil.rmtree(tmpdir, ignore_errors=True)
    log("restored %d report file(s) from the archive (cache already held %d)"
        % (restored, before))
    return restored


# =====================================================================
# the STREAMING merge — build_dataset.build(), with bounded memory
# =====================================================================
def stream_build(files_dir, bk_path, out_dir, ex_path=None, tn_path=None,
                 log=print):
    """Byte-identical output to build_dataset.build(), but the row piles are
       SPILLED to a temp sqlite instead of held as dicts, and each merged
       contract is written straight to its section file — full BudgetKey
       (~1.5 GB of JSON) never sits in RAM at once. merge_contract and every
       rule stay build_dataset's own; this only changes WHERE rows wait."""
    spill_path = tempfile.mktemp(suffix=".spill.db")
    db = sqlite3.connect(spill_path)
    db.executescript("""
      CREATE TABLE rows (order_id TEXT NOT NULL, src TEXT NOT NULL,
                         row TEXT NOT NULL);
      CREATE INDEX ix ON rows(order_id);
    """)
    js = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))

    # the ministry files' rows, per order (same reading as load_files)
    if files_dir and os.path.isdir(files_dir):
        for name in sorted(os.listdir(files_dir)):
            if not name.endswith(".full.json"):
                continue
            with open(os.path.join(files_dir, name), encoding="utf-8") as fh:
                doc = json.load(fh)
            db.executemany(
                "INSERT INTO rows VALUES (?, 'file', ?)",
                ((key.split(":")[0], js(rec))
                 for key, rec in (doc.get("orders") or {}).items()))
            db.commit()

    # BudgetKey's rows, per order (same reading as load_budgetkey)
    if bk_path:
        paths = ([os.path.join(bk_path, n) for n in sorted(os.listdir(bk_path))
                  if n.endswith(".json") and n != "status.json"]
                 if os.path.isdir(bk_path) else [bk_path])
        for p in paths:
            with open(p, encoding="utf-8") as fh:
                rows = json.load(fh)
            batch = []
            for r in (rows.get("rows") if isinstance(rows, dict) else rows):
                oid = BD.canon_id(r.get("order_id"))
                if oid:
                    batch.append((oid, js(r)))
            db.executemany("INSERT INTO rows VALUES (?, 'bk', ?)", batch)
            db.commit()

    ex_index = BD.load_register(ex_path, log=log)
    tn_index = BD.load_register(tn_path, log=log)

    os.makedirs(out_dir, exist_ok=True)
    writers, counts = {}, {}
    only_file = only_bk = total = 0
    from collections import defaultdict
    filled = defaultdict(int)
    joined = 0

    for (oid,) in db.execute(
            "SELECT DISTINCT order_id FROM rows ORDER BY order_id"):
        fr = [json.loads(r) for (r,) in db.execute(
            "SELECT row FROM rows WHERE order_id=? AND src='file'", (oid,))]
        br = [json.loads(r) for (r,) in db.execute(
            "SELECT row FROM rows WHERE order_id=? AND src='bk'", (oid,))]
        c = BD.merge_contract(oid, br, fr, ex_index, tn_index)
        sec = BD._section_of(c)
        w = writers.get(sec)
        if w is None:
            w = writers[sec] = open(os.path.join(out_dir, sec + ".json"),
                                    "w", encoding="utf-8")
            w.write('{"contracts":[')
            counts[sec] = 0
        if counts[sec]:
            w.write(",")
        w.write(js(c))
        counts[sec] += 1
        total += 1
        only_file += 1 if (fr and not br) else 0
        only_bk += 1 if (br and not fr) else 0
        for v in (c.get("provenance") or {}).values():
            filled[v] += 1
        joined += 1 if ("ex" in c["sources"] or "tn" in c["sources"]) else 0

    for w in writers.values():
        w.write("]}")
        w.close()
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"sections": sorted(writers), "contracts": total},
                  fh, ensure_ascii=False)
    db.close()
    os.unlink(spill_path)
    log("contracts: %d  (file only: %d · BudgetKey only: %d · both: %d)"
        % (total, only_file, only_bk, total - only_file - only_bk))
    log("fields filled by source: %s"
        % ", ".join("%s %d" % kv for kv in sorted(filled.items())))
    if ex_index is not None or tn_index is not None:
        log("register joined: %d of %d contracts" % (joined, total))
    log("written: %s (%d sections)" % (out_dir, len(writers)))
    return total


def _scrub(log, *paths):
    """Free a FINISHED stage's disk now (dirs or files; missing is fine).
       Only with build --scrub (workflow-only): the CI runner's ~14 GB
       cannot hold every stage at once. A local build keeps everything."""
    freed = 0
    for p in paths:
        if not p or not os.path.exists(p):
            continue
        if os.path.isdir(p):
            freed += sum(os.path.getsize(os.path.join(r, f))
                         for r, _, fs in os.walk(p) for f in fs)
            shutil.rmtree(p, ignore_errors=True)
        else:
            freed += os.path.getsize(p)
            os.unlink(p)
    if freed:
        log("scrubbed %.1f GB of finished-stage files" % (freed / 1e9))


def build(inputs, work, baseline=None, scrub=False, log=print):
    """parse → streaming merge → full db → public db (stable strings) →
       ctr_* tables. `baseline` = the previous public db (string-id seed).
       `scrub` deletes each stage's inputs once the chain is past them —
       the CI runner's disk cannot hold every stage at once (see _scrub)."""
    parsed = os.path.join(work, "parsed")
    os.makedirs(parsed, exist_ok=True)
    legacy = os.path.join(inputs, "full-records.zip")
    if os.path.exists(legacy):
        n = 0
        with zipfile.ZipFile(legacy) as z:
            for zi in z.namelist():
                if zi.endswith(".full.json"):
                    with z.open(zi) as src, open(os.path.join(
                            parsed, os.path.basename(zi)), "wb") as out:
                        shutil.copyfileobj(src, out)
                    n += 1
        log("seeded the parse with %d legacy .full.json documents (the "
            "archive's reports re-parse OVER them in vintage order; a "
            "ministry only the seed covers keeps its legacy figures)." % n)
    reports = os.path.join(inputs, "reports")
    log("parsing the reports, oldest first…")
    import parse_all as PA         # the one third-party import (openpyxl) —
    files = PA.ordered(reports, os.path.join(reports, "manifest.json"), log=log)
    if not files:
        sys.exit("no reports to parse — fetch-inputs first.")
    import parse_report
    failed = 0
    for path, url, name, _ in files:
        try:
            parse_report.main(path, parsed, url)
        except SystemExit as e:
            failed += 1
            log("  parse failed: %s: %s" % (name, e))
        except Exception as e:                      # noqa: BLE001
            failed += 1
            log("  parse failed: %s: %s: %s" % (name, type(e).__name__, e))
    log("parsed %d, failed %d" % (len(files) - failed, failed))
    if scrub:                     # the reports + the legacy seed are parsed
        _scrub(log, reports, legacy)

    ex = _find_register(os.path.join(inputs, "registers"), "exemptions")
    tn = _find_register(os.path.join(inputs, "registers"), "tenders")
    contracts = os.path.join(work, "contracts")
    stream_build(parsed, os.path.join(inputs, "raw"), contracts, ex, tn, log=log)
    if scrub:                     # merged — the parse output, the BudgetKey
        _scrub(log, parsed, os.path.join(inputs, "raw"),   # JSONs and the
               *glob.glob(os.path.join(inputs, "*.zip")),  # downloaded
               *glob.glob(os.path.join(inputs, "*.tar.gz")))  # archives go

    full_db = os.path.join(work, "contracts-full.db")
    public_db = os.path.join(work, "contracts-public.db")
    log("building the databases…")
    BS.build(contracts, full_db, log=lambda *a: None)
    BS.embed_registers(full_db, ex, tn, log=log)
    if scrub:                     # in the full db now — free the section
        _scrub(log, contracts, os.path.join(inputs, "registers"))  # JSONs
    BS.public_copy(full_db, public_db, log=log, strings_from=baseline)
    BC.build(public_db, log=log)
    return public_db


# =====================================================================
# update-d1 — the delta, applied and verified
# =====================================================================
BIG = ("contracts", "allocations", "reports")


def _order_hashes(db_path):
    """order_id → one hash over the contract's rows in all three tables.
       Two dbs agree on an order iff these agree (strings are compared
       decoded, so id assignment can never fake a change)."""
    import hashlib
    db = sqlite3.connect(db_path)
    out = {}
    q = ("SELECT c.order_id, "
         "  (SELECT group_concat(v, char(31)) FROM ("
         "     SELECT quote(a.budget_code)||quote(a.volume)||quote(a.paid)||"
         "            quote(a.source)||quote(a.historical) AS v"
         "     FROM allocations a WHERE a.order_id = c.order_id"
         "     ORDER BY v)), "
         "  (SELECT group_concat(v, char(31)) FROM ("
         "     SELECT quote(r.year)||quote(r.period)||quote(r.volume)||"
         "            quote(r.paid_cumulative)||quote(r.url) AS v"
         "     FROM reports r WHERE r.order_id = c.order_id ORDER BY v)), "
         "  %s FROM contracts_v c"
         % "||char(30)||".join("quote(c.%s)" % col for col in
                               ["section"] + BS.SCALARS + ["sources", "notes"]))
    for row in db.execute(q):
        blob = "\x1e".join("" if v is None else str(v) for v in row[1:])
        out[row[0]] = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]
    db.close()
    return out


def diff_public(old_db, new_db, log=print):
    old, new = _order_hashes(old_db), _order_hashes(new_db)
    d = {"new": sorted(k for k in new if k not in old),
         "changed": sorted(k for k in new if k in old and old[k] != new[k]),
         "gone": sorted(k for k in old if k not in new)}
    # strings: the stable-id rule means old ids must appear UNCHANGED in new
    o = sqlite3.connect(old_db); n = sqlite3.connect(new_db)
    olds = dict(o.execute("SELECT id, v FROM strings"))
    news = dict(n.execute("SELECT id, v FROM strings"))
    for i, v in olds.items():
        if news.get(i) != v:
            sys.exit("STRING ID DRIFT: id %r was %r, now %r — the public db "
                     "was built without seeding strings from the baseline. "
                     "Refusing to delta; a full upload would be needed."
                     % (i, v, news.get(i)))
    d["new_strings"] = sorted((i, v) for i, v in news.items() if i not in olds)
    o.close(); n.close()
    log("delta: %d new · %d changed · %d gone · %d new strings (of %d contracts)"
        % (len(d["new"]), len(d["changed"]), len(d["gone"]),
           len(d["new_strings"]), len(new)))
    return d


def emit_delta_sql(new_db, delta, outdir, log=print):
    """part-*.sql via the uploader's own Parts: deletes first, then inserts,
       then the ctr_* full replacement rides separately. Row-count targets =
       the NEW db's counts, recorded on the FINAL part so U.verify checks
       the end state."""
    os.makedirs(outdir, exist_ok=True)
    for old in os.listdir(outdir):
        os.unlink(os.path.join(outdir, old))
    db = sqlite3.connect("file:%s?mode=ro" % new_db, uri=True)
    parts = U.Parts(outdir)
    touched = delta["new"] + delta["changed"]
    goneish = delta["changed"] + delta["gone"]
    CH = 400                     # ids per DELETE statement
    for t in BIG:
        for i in range(0, len(goneish), CH):
            ids = goneish[i:i + CH]
            parts.stmt("DELETE FROM \"%s\" WHERE order_id IN (%s);\n"
                       % (t, ",".join(U.lit(x) for x in ids)))
    for i, v in delta["new_strings"]:
        parts.stmt("INSERT INTO strings (id, v) VALUES (%s, %s);\n"
                   % (U.lit(i), U.lit(v)))
    for t in BIG:
        head = 'INSERT INTO "%s" VALUES ' % t
        batch, blen = [], 0
        for i in range(0, len(touched), CH):
            ids = touched[i:i + CH]
            for row in db.execute(
                    'SELECT * FROM "%s" WHERE order_id IN (%s)'
                    % (t, ",".join(U.lit(x) for x in ids))):
                piece = "(" + ",".join(U.lit(v) for v in row) + ")"
                pb = len(piece.encode("utf-8"))
                if batch and blen + pb > U.MAX_STMT:
                    parts.stmt(head + ",\n".join(batch) + ";\n")
                    batch, blen = [], 0
                batch.append(piece)
                blen += pb + 2
        if batch:
            parts.stmt(head + ",\n".join(batch) + ";\n")
    # the FINAL part carries the end-state counts — U.verify() then demands
    # exactly the new db's row counts from D1 after everything applied
    for t in BIG + ("strings",):
        n = db.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
        parts.counts[t] = n
    db.close()
    meta = {"db_size": os.path.getsize(new_db),
            "db_mtime": os.path.getmtime(new_db), "parts": parts.finish()}
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    log("delta SQL: %d part(s)" % len(meta["parts"]))
    return meta


def apply_sql_parts(outdir, meta, log=print):
    cfg = U.config()
    state_path = os.path.join(outdir, "state.json")
    state = {"done": []}
    if os.path.exists(state_path):
        with open(state_path) as fh:
            state = json.load(fh)
    for i, part in enumerate(meta["parts"]):
        if part["file"] in state["done"]:
            log("  = %s already verified" % part["file"])
            continue
        log("  ▸ %s (%d of %d)" % (part["file"], i + 1, len(meta["parts"])))
        U.import_verified(cfg, outdir, part, meta, log=log)
        state["done"].append(part["file"])
        with open(state_path, "w") as fh:
            json.dump(state, fh)


def update_d1(public_db, baseline, work, log=print):
    if baseline and baseline != "-" and os.path.exists(baseline):
        delta = diff_public(baseline, public_db, log=log)
        old_n = len(_order_hashes(baseline))
        if delta["gone"] and len(delta["gone"]) > max(1000, old_n // 20) \
                and os.environ.get("ALLOW_SHRINK") != "1":
            sys.exit("REFUSING the delta: %d contracts would DISAPPEAR from "
                     "D1 (>5%% of %d). A source probably broke this month. "
                     "Investigate; a deliberate shrink re-runs with "
                     "ALLOW_SHRINK=1." % (len(delta["gone"]), old_n))
        if not (delta["new"] or delta["changed"] or delta["gone"]
                or delta["new_strings"]):
            log("nothing changed — D1 already matches.")
        else:
            out = os.path.join(work, "d1-delta")
            meta = emit_delta_sql(public_db, delta, out, log=log)
            apply_sql_parts(out, meta, log=log)
    else:
        log("NO BASELINE — full upload (the self-sufficient first run).")
        out = os.path.join(work, "d1-full")
        os.makedirs(out, exist_ok=True)
        meta = U.dump(public_db, out, log=log)
        with open(os.path.join(out, "manifest.json"), "w") as fh:
            json.dump({"db_size": os.path.getsize(public_db),
                       "db_mtime": os.path.getmtime(public_db),
                       "parts": meta["parts"]}, fh, indent=1)
        apply_sql_parts(out, meta, log=log)
        return                       # the full dump already carried ctr_*
    # the small precomputed tables are replaced whole every month
    out = os.path.join(work, "d1-ctr")
    meta = U.dump(public_db, out, log=log, only="ctr_")
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump({"db_size": os.path.getsize(public_db),
                   "db_mtime": os.path.getmtime(public_db),
                   "parts": meta["parts"]}, fh, indent=1)
    apply_sql_parts(out, meta, log=log)


def check_credentials(log=print):
    """Prove account id + database id + token against D1, read-only, in
       seconds. A wrong value answers here, not 40 minutes into a build."""
    cfg = U.config()
    j = U.api(cfg, "query", {"sql": "SELECT 1"}, timeout=60, attempts=3,
              soft=True)
    if j and j.get("success"):
        log("credentials OK — account, database and token all answer.")
        return True
    msgs = "; ".join(str(e.get("message", "?"))
                     for e in (j or {}).get("errors", [])) or "no answer"
    sys.exit("D1 REFUSED the credentials (%s).\n"
             "Fix the three repo secrets — CF_ACCOUNT_ID / CF_DATABASE_ID / "
             "CF_API_TOKEN — to exactly the values in pipeline\\d1-config.json "
             "(the token needs Account - D1 - Edit). Prove the local values "
             "first with contractors\\check-credentials.bat." % msgs)


def rotate_baseline(public_db, log=print):
    gz = public_db + ".gz"
    with open(public_db, "rb") as i, gzip.open(gz, "wb", compresslevel=6) as o:
        shutil.copyfileobj(i, o)
    ARC.Release().ensure().rotate(gz, "db-current.sqlite.gz")
    log("baseline rotated: db-current.sqlite.gz (+ -previous kept one month)")


def get_baseline(dest, log=print):
    """Download db-current.sqlite.gz → a .db path, or None if absent."""
    gz = os.path.join(dest, "db-current.sqlite.gz")
    if not ARC.Release().ensure().download("db-current.sqlite.gz", gz):
        log("no baseline on the release — first run.")
        return None
    out = os.path.join(dest, "baseline.db")
    with gzip.open(gz, "rb") as i, open(out, "wb") as o:
        shutil.copyfileobj(i, o)
    return out


# =====================================================================
def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("fetch-inputs"); p.add_argument("--dest", required=True)
    p = sp.add_parser("build")
    p.add_argument("--inputs", required=True)
    p.add_argument("--work", required=True)
    p.add_argument("--baseline", help="previous public db (string-id seed); "
                                      "omit or '-' on the first run")
    p.add_argument("--scrub", action="store_true",
                   help="delete each stage's files once the chain is past "
                        "them (the CI runner's small disk); a local build "
                        "should NOT pass this")
    p = sp.add_parser("update-d1")
    p.add_argument("--db", required=True)
    p.add_argument("--baseline", required=True, help="'-' = full upload")
    p.add_argument("--work", required=True)
    p = sp.add_parser("rotate-baseline"); p.add_argument("--db", required=True)
    p = sp.add_parser("get-baseline"); p.add_argument("--dest", required=True)
    p = sp.add_parser("restore-reports"); p.add_argument("--dest", required=True)
    sp.add_parser("check-credentials")
    a = ap.parse_args()

    if a.cmd == "fetch-inputs":
        fetch_inputs(a.dest)
    elif a.cmd == "build":
        base = None if (not a.baseline or a.baseline == "-") else a.baseline
        build(a.inputs, a.work, baseline=base, scrub=a.scrub)
    elif a.cmd == "update-d1":
        update_d1(a.db, a.baseline, a.work)
    elif a.cmd == "rotate-baseline":
        rotate_baseline(a.db)
    elif a.cmd == "get-baseline":
        p2 = get_baseline(a.dest)
        print(p2 or "-")
    elif a.cmd == "restore-reports":
        restore_reports(a.dest)
    elif a.cmd == "check-credentials":
        check_credentials()


if __name__ == "__main__":
    main()
