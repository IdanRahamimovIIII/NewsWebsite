#!/usr/bin/env python3
r"""
upload_to_d1.py — upload contracts-public.db into Cloudflare D1, in PARTS,
each one VERIFIED by counting rows through the API before moving on.
Run by double-clicking contractors\upload-to-d1.bat.

LIVES IN shared\ (since 2026-09-08): shared\ is the folder every pipeline
chat connects, and this module's dump/import/verify machinery is used by
both uploads of the contractors dataset — the full one (upload-to-d1.bat)
and the small ctr_-tables one (upload_contractors.py), plus its test.

WHY NOT WRANGLER: Cloudflare's CLI needs Node and this machine has none.
The REST import flow is what wrangler uses underneath anyway:
init (md5 etag) → PUT the SQL to a one-time url → ingest → poll.

WHY PARTS, WHY VERIFY (learned 2026-08-26, the hard way): the first
version sent ONE 1.2 GB file and trusted the poll answer "Not currently
importing anything." as completion — but that answer is the same for
"finished" and for "failed and rolled back", and the import HAD failed:
the tables did not exist. A single giant file is also all-or-nothing.
So now: the dump is split at ~60 MB boundaries, each part is imported
and then CHECKED — the API is asked to COUNT the rows and the count must
match what the dump manifest says that part should have reached. A part
that verifies is recorded in a state file; re-running skips it. Trust
nothing the API says about success; trust the row counts.

CONFIG: d1-config.json at the project root (gitignored — it holds the
token). Created as a template on first run:
  account_id  — dash.cloudflare.com, right side of the account home
  database_id — Storage & Databases → D1 → the database → its UUID
  api_token   — profile → API Tokens → Custom token, Account · D1 · Edit
"""
import hashlib, json, os, sqlite3, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "d1-config.json")            # pipeline\d1-config.json (gitignored)
# the db lives in contractors\out\ since the 2026-09-08 by-DATASET reorg;
# the old pipeline\out\ home is honoured until apply-dataset-reorg.bat moves it
_DB_NEW = os.path.join(ROOT, "contractors", "out", "contracts-public.db")
_DB_OLD = os.path.join(ROOT, "out", "contracts-public.db")
DB = _DB_OLD if (os.path.exists(_DB_OLD) and not os.path.exists(_DB_NEW)) else _DB_NEW
OUT = os.path.join(ROOT, "build", "d1")

MAX_STMT = 60_000        # bytes per INSERT — D1 rejects overlong statements
PART_MAX = 60_000_000    # bytes per upload part — was 120 MB until the first
                         # AUTOMATED full upload (2026-09-09): part-001 died
                         # in D1's storage layer ("storage operation exceeded
                         # timeout which caused object to be reset"). Halved:
                         # ~50 parts instead of 26, each comfortably inside
                         # D1's timeouts and cheap to retry when D1 wobbles
FTS_PART_MAX = 30_000_000  # FTS5 inserts cost far more CPU per byte than
                           # plain rows (the index is built as they land) —
                           # smaller parts keep each import under D1's CPU
                           # limit, the same lesson the indexes taught
TABLES_LAST = ("index", "view")


def config():
    # CI (PIPELINE v2): the three values arrive as repo secrets via env —
    # no config file ever exists on a runner
    env = {k: os.environ.get(v) for k, v in
           (("account_id", "CF_ACCOUNT_ID"), ("database_id", "CF_DATABASE_ID"),
            ("api_token", "CF_API_TOKEN"))}
    if all(env.values()):
        return env
    if not os.path.exists(CONFIG):
        with open(CONFIG, "w", encoding="utf-8") as fh:
            json.dump({"account_id": "PASTE-FROM-DASHBOARD",
                       "database_id": "PASTE-FROM-D1-PAGE",
                       "api_token": "PASTE-FROM-API-TOKENS"}, fh, indent=1)
        sys.exit("created %s — fill in the three values (the header of "
                 "shared/upload_to_d1.py says where each lives) and run again."
                 % os.path.basename(CONFIG))
    with open(CONFIG, encoding="utf-8") as fh:
        c = json.load(fh)
    if any("PASTE" in str(v) for v in c.values()):
        sys.exit("%s still has placeholder values." % os.path.basename(CONFIG))
    return c


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        r = repr(v)
        if r in ("inf", "-inf", "nan"):        # not valid SQL — and not data
            return "NULL"
        return r
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    raise SystemExit("unexpected %s in the public db" % type(v))


class Parts:
    """Writes part-NNN.sql files, splitting only at statement boundaries,
       and records after each part how many rows of each table exist so
       far — the numbers the verifier will demand from D1."""
    def __init__(self, outdir):
        self.dir = outdir
        self.n = 0
        self.fh = None
        self.size = 0
        self.h = None
        self.counts = {}
        self.objects = []
        self.break_next = False
        self.manifest = []
        self._open()

    def _open(self):
        self.n += 1
        path = os.path.join(self.dir, "part-%03d.sql" % self.n)
        self.fh = open(path, "wb")
        self.size = 0
        self.h = hashlib.md5()

    def _close(self):
        self.fh.close()
        entry = {"file": "part-%03d.sql" % self.n,
                 "md5": self.h.hexdigest(),
                 "counts": dict(self.counts)}
        if self.objects:
            entry["objects"] = list(self.objects)
        self.manifest.append(entry)
        self.objects = []

    def stmt(self, text, table=None, rows=0, obj=None, cap=None):
        """obj = name of an index/view this statement creates. Such a
           statement gets a part OF ITS OWN (learned 2026-08-26, part-011:
           ten CREATE INDEXes over millions of rows in one import blew
           D1's CPU limit and the whole part was rolled back).
           cap = a smaller per-part byte limit (FTS inserts)."""
        b = text.encode("utf-8")
        if self.size and (self.break_next or obj or
                          self.size + len(b) > (cap or PART_MAX)):
            self._close()
            self._open()
        self.break_next = bool(obj)
        self.fh.write(b)
        self.h.update(b)
        self.size += len(b)
        if table:
            self.counts[table] = self.counts.get(table, 0) + rows
        if obj:
            self.objects.append(obj)

    def finish(self):
        self._close()
        return self.manifest


def dump(db_path, outdir, log=print, only=None):
    """only=prefix — dump just the tables whose name starts with it (the
       contractors upload sends its ctr_* tables without re-sending the
       1.3 GB the database already holds). Default: everything."""
    os.makedirs(outdir, exist_ok=True)
    for old in os.listdir(outdir):
        os.unlink(os.path.join(outdir, old))
    db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    master = db.execute(
        "SELECT type, name, sql FROM sqlite_master "
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").fetchall()
    # FTS5 is a VIRTUAL table: creating it auto-creates its shadow tables
    # (<name>_data, _idx, _content, _docsize, _config), which sqlite_master
    # also lists. The dump must ship the CREATE VIRTUAL TABLE + the rows and
    # SKIP the shadows — importing a shadow table beside the virtual one
    # would collide with what CREATE VIRTUAL TABLE makes on D1's side.
    virtual = {name for t, name, create in master
               if t == "table" and
               create.lstrip().upper().startswith("CREATE VIRTUAL TABLE")}
    shadow = {name for t, name, create in master if t == "table" and
              any(name.startswith(v + "_") for v in virtual)}
    keep = lambda name: (name not in shadow and
                         (only is None or name.startswith(only)))
    parts = Parts(outdir)
    for t, name, create in master:
        if t != "table" or not keep(name):
            continue
        cap = FTS_PART_MAX if name in virtual else None
        parts.stmt('DROP TABLE IF EXISTS "%s";\n%s;\n' % (name, create),
                   table=name, rows=0, cap=cap)
        head = 'INSERT INTO "%s" VALUES ' % name
        batch, blen, brows, n = [], 0, 0, 0
        for row in db.execute('SELECT * FROM "%s"' % name):
            piece = "(" + ",".join(lit(v) for v in row) + ")"
            pb = len(piece.encode("utf-8"))
            if pb > 80_000:
                raise SystemExit("a single %s row is %d bytes of SQL (key "
                                 "%r) — needs a chunked insert; tell Claude"
                                 % (name, pb, row[0]))
            if batch and blen + pb > MAX_STMT:
                parts.stmt(head + ",\n".join(batch) + ";\n", name, brows,
                           cap=cap)
                batch, blen, brows = [], 0, 0
            batch.append(piece)
            blen += pb + 2
            brows += 1
            n += 1
        if batch:
            parts.stmt(head + ",\n".join(batch) + ";\n", name, brows, cap=cap)
        log("  %s: %s rows" % (name, format(n, ",")))
    for t, name, create in master:
        if t in TABLES_LAST and keep(name):
            parts.stmt(create + ";\n", obj=name)
    manifest = parts.finish()
    db.close()
    meta = {"db_size": os.path.getsize(db_path),
            "db_mtime": os.path.getmtime(db_path), "parts": manifest}
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    total = sum(os.path.getsize(os.path.join(outdir, p["file"]))
                for p in manifest)
    log("  %d parts, %.1f MB of SQL" % (len(manifest), total / 1e6))
    return meta


def api(cfg, path, body, timeout=120, attempts=1, soft=False):
    """One D1 API call. 5xx answers are retried `attempts` times — during
       and just after an import the database is busy and /query can answer
       500 for a while before it settles."""
    url = ("https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/%s"
           % (cfg["account_id"], cfg["database_id"], path))
    for i in range(attempts):
        req = urllib.request.Request(url, method="POST",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + cfg["api_token"]})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:800]
            if e.code >= 500 and i + 1 < attempts:
                print("    (Cloudflare answered %d — waiting and retrying, "
                      "%d/%d)" % (e.code, i + 1, attempts))
                time.sleep(20)
                continue
            if soft and e.code < 500:
                try:                     # e.g. "no such table" — the caller
                    return json.loads(detail)   # decides what that means
                except ValueError:
                    return {"success": False, "errors": [{"message": detail}]}
            sys.exit("Cloudflare answered HTTP %s on %s:\n%s"
                     % (e.code, path, detail))


def count_remote(cfg, table):
    j = api(cfg, "query", {"sql": 'SELECT COUNT(*) AS n FROM "%s"' % table},
            timeout=300, attempts=8, soft=True)
    # A 400 "no such table" is a real answer: the part that creates the
    # table has not been applied yet (learned 2026-08-26, part-006).
    try:
        return j["result"][0]["results"][0]["n"]
    except (KeyError, IndexError, TypeError):
        return None                      # table absent (or error) → not there


def put_file(url, path, log=print):
    size = os.path.getsize(path)
    log("    uploading %.1f MB…" % (size / 1e6))
    with open(path, "rb") as fh:
        req = urllib.request.Request(url, method="PUT", data=fh,
                                     headers={"Content-Length": str(size)})
        with urllib.request.urlopen(req, timeout=3600 * 4) as r:
            return (r.headers.get("ETag") or "").strip('"')


BUSY = "long-running import"


class PartFailed(Exception):
    """ONE attempt at importing a part failed on D1's side (the poll
       answered an error). import_part() decides whether to retry."""


# D1-side wobbles a retry can cure, each seen live or reported by
# Cloudflare as transient. NOT here: SQL errors, auth errors, "statement
# too long" — retrying those would just fail slowly, three times.
TRANSIENT = ("exceeded timeout", "object to be reset", "internal error",
             "network connection lost", "storage caused object")


def _transient(msg):
    m = str(msg).lower()
    return any(t in m for t in TRANSIENT)


def init_when_free(cfg, etag, log=print, max_wait=4 * 3600):
    """Ask for an upload slot; if D1 says another import is still running
       (learned 2026-08-26: a previous run's part, killed mid-poll on our
       side, keeps running on theirs — and there is no cancel call), WAIT
       for it instead of giving up. Returns the init answer's result."""
    waited = 0
    while True:
        j = api(cfg, "import", {"action": "init", "etag": etag}, attempts=4)
        res = j.get("result") or {}
        if not j.get("success"):
            sys.exit("init refused: %s" % json.dumps(j)[:800])
        err = str(res.get("error") or "")
        if BUSY not in err:
            return res
        if waited == 0:
            log("    D1 is still busy with an earlier import (probably the "
                "last run's part). No way to cancel it — waiting for it to "
                "finish or time out. Leave this window open.")
        if waited >= max_wait:
            sys.exit("D1 has been busy for %d hours — stop and tell Claude."
                     % (max_wait // 3600))
        time.sleep(30)
        waited += 30
        if waited % 300 == 0:
            log("    …still busy after %d min" % (waited // 60))


def exists_remote(cfg, name):
    j = api(cfg, "query", {"sql": "SELECT COUNT(*) AS n FROM sqlite_master "
                                  "WHERE name = '%s'" % name},
            timeout=300, attempts=8, soft=True)
    try:
        return j["result"][0]["results"][0]["n"] == 1
    except (KeyError, IndexError, TypeError):
        return False


def verify(cfg, part, log=None):
    """True when D1 holds exactly what the manifest says this part should
       have reached: every table's row count AND every index/view the
       part creates. log=None checks quietly (the pre-upload skip);
       otherwise each check is printed."""
    ok = True
    for table, expect in sorted(part["counts"].items()):
        got = count_remote(cfg, table)
        if log:
            log("    %s %s: %s of %s" % ("✔" if got == expect else "✘", table,
                "—" if got is None else format(got, ","), format(expect, ",")))
        ok = ok and got == expect
    for name in part.get("objects", []):
        there = exists_remote(cfg, name)
        if log:
            log("    %s %s %s" % ("✔" if there else "✘", name,
                                   "exists" if there else "MISSING"))
        ok = ok and there
    return ok


def already_applied(cfg, part, log=print):
    """A part that already verifies was applied by an earlier run that we
       never got to record. Skip the upload."""
    if not verify(cfg, part):
        return False
    log("    (already in D1 from an earlier run — not uploading it again)")
    return True


def import_part(cfg, outdir, part, meta, log=print, attempts=3):
    """Import one part, retrying a D1-SIDE failure (2026-09-09, the first
       automated full upload: part-001 died on 'D1 DB storage operation
       exceeded timeout which caused object to be reset' — Cloudflare's
       storage layer, not our SQL — and one wobble killed a 40-minute
       run). A failed import ROLLS BACK (the v1 lesson), so re-importing
       the same part is safe, and already_applied() still counts first in
       case it landed after all. A network drop mid-upload/poll gets the
       same retry; a NON-transient error (bad SQL, auth) dies at once."""
    for i in range(attempts):
        try:
            return _import_once(cfg, outdir, part, meta, log)
        except PartFailed as e:
            if not _transient(e) or i + 1 >= attempts:
                sys.exit(str(e))
            log("    D1 failed the import transiently — waiting 90s, then "
                "retrying the part (attempt %d of %d):\n    %s"
                % (i + 2, attempts, e))
        except (TimeoutError, urllib.error.URLError) as e:
            if i + 1 >= attempts:
                sys.exit("network trouble importing %s, three times over: %s"
                         % (part["file"], e))
            log("    network trouble (%s) — waiting 90s, then retrying the "
                "part (attempt %d of %d)" % (e, i + 2, attempts))
        time.sleep(90)


def _import_once(cfg, outdir, part, meta, log=print):
    path = os.path.join(outdir, part["file"])
    etag = part["md5"]
    res = init_when_free(cfg, etag, log)
    if already_applied(cfg, part, log):
        return
    if not res.get("upload_url") or not res.get("filename"):
        # A leftover from an aborted attempt: the file is already in the
        # upload store, so init hands back no slot — and no filename to
        # ingest by (learned 2026-08-26: ingest with filename=null is a
        # 400). Make the part NEW again — one harmless SQL comment changes
        # the checksum — and take the full path.
        log("    (already uploaded once — refreshing the part and re-uploading)")
        with open(path, "ab") as fh:
            fh.write(("\n-- retry %d\n" % int(time.time())).encode())
        h = hashlib.md5()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 22), b""):
                h.update(chunk)
        part["md5"] = etag = h.hexdigest()
        with open(os.path.join(outdir, "manifest.json"), "w") as fh:
            json.dump(meta, fh, indent=1)
        res = init_when_free(cfg, etag, log)
        if not res.get("upload_url") or not res.get("filename"):
            sys.exit("init still gave no upload slot: %s" % json.dumps(res)[:800])
    remote = put_file(res["upload_url"], path, log)
    if remote and remote != etag:
        sys.exit("upload checksum mismatch — run again.")
    j = api(cfg, "import", {"action": "ingest", "etag": etag,
                            "filename": res["filename"]}, attempts=4)
    bookmark = (j.get("result") or {}).get("at_bookmark")
    last = None
    while True:
        time.sleep(4)
        j = api(cfg, "import", {"action": "poll",
                                "current_bookmark": bookmark}, attempts=5)
        res = j.get("result") or {}
        with open(os.path.join(outdir, "last-poll.json"), "w") as fh:
            json.dump(j, fh, ensure_ascii=False, indent=1)
        seen = res.get("messages") or []
        for m in seen[seen.index(last) + 1 if last in seen else 0:]:
            log("    " + str(m))
        if seen:
            last = seen[-1]
        # THE LESSON OF 2026-08-26, twice over: `result.success` only means
        # the POLL request succeeded. The import's real state is
        # `result.status` — keep waiting while it is "active"; anything
        # else is decided below. Walking away early is how v1 declared a
        # rolled-back import "done" and v2 queried a locked database.
        err = res.get("error") or j.get("error")
        status = res.get("status")
        if err and "Not currently importing" in str(err):
            return                       # ended between polls — VERIFY next
        if err and BUSY in str(err):
            continue                     # still running — keep polling
        if err or status == "error":
            raise PartFailed(
                "D1 reported an import error on %s:\n%s\n(the full answer "
                "is in %s)" % (part["file"], err or json.dumps(res)[:600],
                               os.path.join(outdir, "last-poll.json")))
        if status == "complete":
            return                       # says complete — VERIFY anyway


def main():
    cfg = config()
    if not os.path.exists(DB):
        sys.exit("no contracts-public.db — run contractors\\build-database.bat first.")

    man_path = os.path.join(OUT, "manifest.json")
    state_path = os.path.join(OUT, "state.json")
    meta = None
    if os.path.exists(man_path):
        with open(man_path) as fh:
            meta = json.load(fh)
        if meta.get("db_size") != os.path.getsize(DB) or \
           abs(meta.get("db_mtime", 0) - os.path.getmtime(DB)) > 1:
            meta = None                  # the database changed — fresh dump
    if meta is None:
        print("preparing the SQL dump (a few minutes)…")
        meta = dump(DB, OUT)
        with open(state_path, "w") as fh:
            json.dump({"done": []}, fh)
    state = {"done": []}
    if os.path.exists(state_path):
        with open(state_path) as fh:
            state = json.load(fh)

    parts = meta["parts"]
    print("uploading in %d parts, each verified by row counts:" % len(parts))
    for i, part in enumerate(parts):
        if part["file"] in state["done"]:
            print("  = %s already verified" % part["file"])
            continue
        print("  ▸ %s (%d of %d)" % (part["file"], i + 1, len(parts)))
        import_part(cfg, OUT, part, meta)
        if not verify(cfg, part, log=print):
            sys.exit("row counts do not match after %s — the import did not "
                     "fully apply. Run this again (verified parts are "
                     "skipped); if it fails at the same part twice, tell "
                     "Claude and attach build\\d1\\last-poll.json."
                     % part["file"])
        state["done"].append(part["file"])
        with open(state_path, "w") as fh:
            json.dump(state, fh)

    print("\nall parts verified. Final check of everything in D1:")
    final = dict(parts[-1])
    final["objects"] = [o for p in parts for o in p.get("objects", [])]
    if verify(cfg, final, log=print):
        print("\nDONE — the dataset is live in D1.")
    else:
        sys.exit("something is missing — run again.")


if __name__ == "__main__":
    main()
