#!/usr/bin/env python3
"""
audit_server.py — the local backend of compare.html: Mercy's permanent tool
for checking the built dataset against the sources, by hand, forever.

WHY LOCAL (Mercy, 2026-08-25): "the audit is just for myself, we don't need
it on the website or in Cloudflare; compare.html is only expected to work
locally." So this serves pipeline/audit/ (compare.html) at
the root and mounts the website under /site/ (the pages need its shared
CSS, config.js and common.js), PLUS a few read-only /audit endpoints
answered from the FULL database — the one with provenance per field and
the raw register rows embedded. Since 2026-09-06 that file is a build
INTERMEDIATE, pipeline/build/contracts-full.db (the public copy in out/ is
derived from it and carries no provenance — it cannot feed an audit).
Nothing here is deployed anywhere; closing the window ends it.

THIS FOLDER IS THE WHOLE AUDIT (Mercy, 2026-09-06): audit.bat, this server,
compare.html and the test drivers live together here,
so a chat about checking the output needs pipeline/audit/ and nothing else.

Standard library only (http.server + sqlite3) — Mercy's machine has no
node; audit.bat finds python or says plainly what to install.

the ministry-report documents (2026-09-06 — the site keeps no data):
  /paid/index.json · /paid/<section>.json   from pipeline/paid/ (the 52 lean
                                            overlay docs the workflow publishes to KV)
  /paid/<section>.full.json                 from pipeline/build/full/ (every column,
                                            extracted from inputs/full-records.zip by
                                            build-database.bat — never published)
  compare.html's "הקובץ שהמשרד פרסם" column reads the .full.json; the lean docs
  reads the RELAY instead (its question is what the public site gets).

endpoints (all JSON, all read-only):
  /audit/status                     what db is loaded, how many contracts
  /audit/contract?id=<order_id>     the full built record, provenance included
  /audit/search?q=<text>            contracts by order id / supplier / ח"פ /
                                    purpose — searches the BUILT db, so a
                                    file-only contract is finally findable
                                    (the old compare.html gap)
  /audit/register?pub=<number>      raw register rows for one publication
  /audit/random                     one random contract (audit habit fuel)

usage:
  audit_server.py [--db ../build/contracts-full.db] [--site ../../site] [--audit .]
                  [--paid ../paid] [--full ../build/full] [--port 8081]
  (defaults are relative to pipeline/audit/, this script's own folder)
"""
import argparse, json, os, random, sqlite3, sys, urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler


def open_db(path):
    if not os.path.exists(path):
        sys.exit("no database at %s — run pipeline\\build-database.bat first "
                 "(it writes the full database there; clean-up.bat deletes it "
                 "again, it is rebuildable)." % path)
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True,
                         check_same_thread=False)
    db.row_factory = sqlite3.Row
    return db


def contract_of(db, order_id):
    row = db.execute("SELECT * FROM contracts WHERE order_id=?",
                     (order_id,)).fetchone()
    if row is None:
        return None
    c = dict(row)
    for k in ("sources", "provenance", "notes"):
        if c.get(k):
            c[k] = json.loads(c[k])
    c["allocations"] = [dict(r) for r in db.execute(
        "SELECT budget_code, volume, paid, source, historical "
        "FROM allocations WHERE order_id=?", (order_id,))]
    c["reports"] = [dict(r) for r in db.execute(
        "SELECT year, period, volume, paid_cumulative, url "
        "FROM reports WHERE order_id=? ORDER BY year, period", (order_id,))]
    return c


def registers_of(db, pub):
    try:
        rows = db.execute("SELECT kind, row FROM registers WHERE publication=?",
                          (pub,)).fetchall()
    except sqlite3.OperationalError:      # db built without --exemptions/--tenders
        return {"note": "registers not embedded in this db — rebuild with "
                        "--exemptions/--tenders", "rows": []}
    return {"rows": [{"kind": r["kind"], **json.loads(r["row"])} for r in rows]}


def search(db, q, limit=8):
    q = q.strip()
    if not q:
        return []
    if q.isdigit() and len(q) >= 6:
        hit = db.execute("SELECT order_id FROM contracts WHERE order_id=?",
                         (q,)).fetchone()
        return [hit["order_id"]] if hit else []
    like = "%" + q + "%"
    # supplier first (indexed prefix use is limited with a leading %, but
    # SQLite over 513K local rows answers a LIKE scan in well under a second
    # — this is a local audit tool, not a metered endpoint)
    rows = db.execute(
        "SELECT order_id FROM contracts WHERE supplier LIKE ? "
        "OR company_id = ? OR purpose LIKE ? LIMIT ?",
        (like, q, like, limit)).fetchall()
    return [r["order_id"] for r in rows]


class Handler(SimpleHTTPRequestHandler):
    db = None            # set in main()
    audit_dir = None     # pipeline/audit      — served at /
    site_dir = None      # the website         — served at /site/
    paid_dir = None      # pipeline/paid       — served at /paid/<section>.json
    full_dir = None      # pipeline/build/full — served at /paid/<section>.full.json

    def translate_path(self, path):
        """Four roots: /site/... maps into the website folder, /paid/... into
        the paid documents (lean from pipeline/paid, .full from build/full),
        everything else into pipeline/audit/. The stdlib mapping is reused so
        '..' can never escape any root."""
        p = urllib.parse.urlparse(path).path
        if p == "/site" or p.startswith("/site/"):
            self.directory, rel = self.site_dir, p[len("/site"):] or "/"
        elif p.startswith("/paid/"):
            name = p[len("/paid/"):]
            self.directory = self.full_dir if name.endswith(".full.json") else self.paid_dir
            rel = "/" + name
        else:
            self.directory, rel = self.audit_dir, p
        return SimpleHTTPRequestHandler.translate_path(self, rel)

    def log_message(self, fmt, *args):   # 404s matter, the rest is noise
        if args and str(args[1] if len(args) > 1 else "") == "404":
            sys.stderr.write("404  %s\n" % (args[0] if args else ""))

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # compare.html may be served by serve.bat on another port — let it in
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # a saved page must show its new self immediately (serve.bat's rule)
        if not self.path.startswith("/audit/"):
            self.send_header("Cache-Control", "no-store")
        SimpleHTTPRequestHandler.end_headers(self)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if not url.path.startswith("/audit/"):
            return SimpleHTTPRequestHandler.do_GET(self)
        qs = urllib.parse.parse_qs(url.query)

        def arg(k):
            v = (qs.get(k) or [""])[0]
            # http.server decodes the request line as latin-1; a client that
            # sent raw UTF-8 (curl does) arrives as mojibake — undo it.
            # Browsers %-encode, which parse_qs already decodes correctly.
            try:
                return v.encode("latin-1").decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                return v
        try:
            if url.path == "/audit/status":
                n = self.db.execute("SELECT COUNT(*) c FROM contracts").fetchone()["c"]
                has_reg = bool(self.db.execute(
                    "SELECT name FROM sqlite_master WHERE name='registers'").fetchone())
                return self._json({"ok": True, "contracts": n,
                                   "registers": has_reg, "db": Handler.db_path})
            if url.path == "/audit/contract":
                c = contract_of(self.db, arg("id"))
                return self._json({"contract": c} if c else
                                  {"contract": None, "note": "לא במאגר"},
                                  200 if c else 404)
            if url.path == "/audit/search":
                ids = search(self.db, arg("q"))
                return self._json({"ids": ids})
            if url.path == "/audit/register":
                return self._json(registers_of(self.db, arg("pub")))
            if url.path == "/audit/random":
                n = self.db.execute("SELECT COUNT(*) c FROM contracts").fetchone()["c"]
                row = self.db.execute(
                    "SELECT order_id FROM contracts LIMIT 1 OFFSET ?",
                    (random.randrange(max(n, 1)),)).fetchone()
                return self._json({"id": row["order_id"] if row else None})
            return self._json({"error": "unknown audit endpoint"}, 404)
        except Exception as e:
            return self._json({"error": str(e)}, 500)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))                    # pipeline\audit\
    ap.add_argument("--db", default=os.path.join(here, "..", "build", "contracts-full.db"))
    ap.add_argument("--site", default=os.path.join(here, "..", "..", "site"))
    ap.add_argument("--audit", default=here)
    ap.add_argument("--paid", default=os.path.join(here, "..", "paid"))
    ap.add_argument("--full", default=os.path.join(here, "..", "build", "full"))
    ap.add_argument("--port", type=int, default=8081)
    a = ap.parse_args()

    Handler.db = open_db(a.db)
    Handler.db_path = os.path.abspath(a.db)
    for label, d in (("site", a.site), ("audit", a.audit)):
        if not os.path.isdir(d):
            sys.exit("no %s directory at %s" % (label, os.path.abspath(d)))
    Handler.site_dir = os.path.abspath(a.site)
    Handler.audit_dir = os.path.abspath(a.audit)
    # the paid documents are optional: say what is missing, keep serving
    Handler.paid_dir = os.path.abspath(a.paid)
    Handler.full_dir = os.path.abspath(a.full)
    for label, d, hint in (("lean paid docs", Handler.paid_dir, "move them from site\\_move-to-pipeline\\data\\paid"),
                           ("full records", Handler.full_dir, "run build-database.bat (it extracts full-records.zip there)")):
        if not os.path.isdir(d):
            print("note: no %s at %s — %s" % (label, d, hint))

    n = Handler.db.execute("SELECT COUNT(*) c FROM contracts").fetchone()["c"]
    print("audit server: %s contracts from %s" % (format(n, ","), Handler.db_path))
    print("serving %s at /  and  %s at /site/" % (Handler.audit_dir, Handler.site_dir))
    print("open http://localhost:%d/compare.html" % a.port)
    HTTPServer(("127.0.0.1", a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
