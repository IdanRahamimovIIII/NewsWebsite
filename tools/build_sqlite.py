#!/usr/bin/env python3
"""
build_sqlite.py — turn the built dataset (site/data/contracts/<sec>.json,
build_dataset.py's output) into ONE SQLite database: contracts.db.

WHY SQLITE (Mercy, 2026-08-25: "what is the correct way to do it?")
  The JSON shards are the database's SOURCE, not its serving form. SQLite is
  a real SQL database in a single file — indexes, queries, no server — and
  it is exactly what Cloudflare D1 runs, so this file IS the thing the
  worker will query. Field names stop repeating half a million times, which
  is where the JSON's weight came from.

THE MONTHLY DELTA (her point, same day: "why would we write all 513K
lines? we only need to update what's relevant")
  Every contract row carries a FINGERPRINT — a hash of its full record.
  Next month's build compares fingerprints against this file and writes
  only new / changed / gone rows to D1. The full write happens once, at
  bootstrap. Same principle as the whole pipeline: never redo what did not
  change.

WHAT GOES WHERE
  contracts    — one row per contract, every scalar field of FIELDS.xlsx v2,
                 plus sources/provenance/notes as compact JSON text (compare
                 .html must show which source won each field — rule R3).
  allocations  — (order_id, budget_code) rows, live and historical labelled.
  reports      — the payments[] history, one row per (order_id, year, period).

THE REGISTERS RIDE ALONG (full db only, 2026-08-25)
  --exemptions/--tenders embed the raw mr.gov.il register rows as a
  `registers` table indexed by publication number, so the local audit
  server (compare.html's backend) answers everything from ONE file instead
  of re-parsing 140 MB of JSON on every start. The PUBLIC copy never
  carries it — the registers are an input, not part of the served dataset.

usage:
  build_sqlite.py --contracts site/data/contracts --out contracts.db \
                  [--exemptions ex.json --tenders tn.json] [--public pub.db]
"""
import argparse, hashlib, json, os, sqlite3, sys

# the scalar columns, in FIELDS.xlsx order — build_dataset.py's field names
SCALARS = [
    "supplier", "entity_id", "entity_kind", "company_id", "supplier_code",
    "ministry", "unit", "purchase_group", "budget_code", "budget_title",
    "item_title", "purpose", "method", "exemption", "procedure_id",
    "volume", "announced", "paid", "paid_in_period", "currency",
    "option_sum", "option_cumulative", "option_exercised", "option_request",
    "continuation_date", "continuation_sum", "continuation_reason",
    "continuation_request", "total_cumulative",
    "ordered_date", "starts_date", "ends_date",
    "approver", "decision", "publication_status", "published_date",
    "updated_date", "documents_ref", "topics",
    "first_year", "last_year", "sensitive", "active", "publication",
]
NUMERIC = {"volume", "announced", "paid", "paid_in_period", "option_sum",
           "option_cumulative", "continuation_sum", "total_cumulative",
           "first_year", "last_year"}

SCHEMA = """
CREATE TABLE contracts (
  order_id TEXT PRIMARY KEY,
  section  TEXT NOT NULL,
  %s,
  sources    TEXT,   -- json list, e.g. ["file","tn"]
  provenance TEXT,   -- json {field: source} — which source won each field
  notes      TEXT,   -- json, BudgetKey's free texts when present
  fingerprint TEXT NOT NULL
);
CREATE TABLE allocations (
  order_id TEXT NOT NULL,
  budget_code TEXT NOT NULL,
  volume REAL, paid REAL,
  source TEXT NOT NULL,
  historical INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reports (
  order_id TEXT NOT NULL,
  year TEXT, period TEXT,
  volume REAL, paid_cumulative REAL, url TEXT
);
""" % ",\n  ".join(
    "%s %s" % (c, "REAL" if c in NUMERIC else "TEXT") for c in SCALARS)

INDEXES = """
CREATE INDEX ix_contracts_section     ON contracts(section);
CREATE INDEX ix_contracts_company     ON contracts(company_id);
CREATE INDEX ix_contracts_supplier    ON contracts(supplier);
CREATE INDEX ix_contracts_entity      ON contracts(entity_id);
CREATE INDEX ix_contracts_publication ON contracts(publication);
CREATE INDEX ix_contracts_budget_code ON contracts(budget_code);
CREATE INDEX ix_allocations_order     ON allocations(order_id);
CREATE INDEX ix_allocations_code      ON allocations(budget_code);
CREATE INDEX ix_reports_order         ON reports(order_id);
"""


def fingerprint(contract):
    """Stable across runs: the whole record, keys sorted, floats as json
       writes them. If ANYTHING about the contract changes, this changes."""
    blob = json.dumps(contract, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _js(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":")) if v else None


def build(contracts_dir, out_path, log=print):
    if os.path.exists(out_path):
        os.unlink(out_path)                      # a build is a build, whole
    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)

    sections = [n for n in sorted(os.listdir(contracts_dir))
                if n.endswith(".json") and n != "index.json"]
    if not sections:
        sys.exit("no section files in %s — run build_dataset.py first"
                 % contracts_dir)

    ins_c = ("INSERT INTO contracts (order_id, section, %s, sources, "
             "provenance, notes, fingerprint) VALUES (%s)"
             % (", ".join(SCALARS), ", ".join("?" * (len(SCALARS) + 6))))
    n_c = n_a = n_r = 0
    for name in sections:
        sec = name[:-5]
        with open(os.path.join(contracts_dir, name), encoding="utf-8") as fh:
            doc = json.load(fh)
        rows_c, rows_a, rows_r = [], [], []
        for c in doc["contracts"]:
            # booleans as SQLite integers, everything else as it came
            vals = [c.get(k) for k in SCALARS]
            vals = [int(v) if isinstance(v, bool) else v for v in vals]
            rows_c.append([c["order_id"], sec] + vals +
                          [_js(c.get("sources")), _js(c.get("provenance")),
                           _js(c.get("notes")), fingerprint(c)])
            for a in c.get("allocations") or []:
                rows_a.append((c["order_id"], a.get("budget_code"),
                               a.get("volume"), a.get("paid"),
                               a.get("source"), 0))
            for a in c.get("historical_allocations") or []:
                rows_a.append((c["order_id"], a.get("budget_code"),
                               a.get("volume"), a.get("paid"),
                               a.get("source"), 1))
            for r in c.get("reports") or []:
                rows_r.append((c["order_id"], r.get("year"), r.get("period"),
                               r.get("volume"), r.get("paid_cumulative"),
                               r.get("url")))
        db.executemany(ins_c, rows_c)
        db.executemany("INSERT INTO allocations VALUES (?,?,?,?,?,?)", rows_a)
        db.executemany("INSERT INTO reports VALUES (?,?,?,?,?,?)", rows_r)
        db.commit()
        n_c += len(rows_c); n_a += len(rows_a); n_r += len(rows_r)
        log("  %s: %d contracts" % (sec, len(rows_c)))

    log("indexing…")
    db.executescript(INDEXES)
    db.execute("ANALYZE")
    db.commit()
    db.execute("VACUUM")
    db.close()
    size = os.path.getsize(out_path) / 1e6
    log("contracts.db: %d contracts · %d allocations · %d report rows · %.1f MB"
        % (n_c, n_a, n_r, size))
    return {"contracts": n_c, "allocations": n_a, "reports": n_r, "mb": size}


def embed_registers(db_path, ex_path=None, tn_path=None, log=print):
    """Add the raw register rows to the FULL db: one row per register line,
       the portal's own column spellings kept inside a JSON blob, indexed by
       publication number. compare.html shows these verbatim — renaming or
       trimming would hide exactly what an auditor wants to see."""
    if not ex_path and not tn_path:
        return
    db = sqlite3.connect(db_path)
    db.executescript("""
      DROP TABLE IF EXISTS registers;
      CREATE TABLE registers (
        kind TEXT NOT NULL,          -- 'exemptions' | 'tenders'
        publication TEXT NOT NULL,
        row TEXT NOT NULL            -- json {column: value}, portal spellings
      );
    """)
    for kind, path in (("exemptions", ex_path), ("tenders", tn_path)):
        if not path:
            continue
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        cols = doc.get("columns") or []
        if "מספר פרסום" not in cols:
            sys.exit("%s has no מספר פרסום column — not a register conversion" % path)
        ipub = cols.index("מספר פרסום")
        rows = [(kind, r[ipub],
                 json.dumps({c: v for c, v in zip(cols, r) if v != ""},
                            ensure_ascii=False, separators=(",", ":")))
                for r in doc.get("rows") or [] if ipub < len(r) and r[ipub]]
        db.executemany("INSERT INTO registers VALUES (?,?,?)", rows)
        log("  registers: %s %d rows" % (kind, len(rows)))
    db.execute("CREATE INDEX ix_registers_pub ON registers(publication)")
    db.commit()
    db.close()


# the public copy DICTIONARY-ENCODES these: low-cardinality Hebrew text that
# repeats across hundreds of thousands of rows ("משרד החינוך" tens of
# thousands of times). Each becomes an integer into ONE strings table.
# D1 bills storage AND rows read — smaller rows serve both (Mercy,
# 2026-08-25: "still try to optimize storage and calls").
DICT_COLS = ["ministry", "unit", "purchase_group", "budget_title", "method",
             "exemption", "currency", "entity_kind", "approver", "decision",
             "publication_status", "topics", "continuation_reason"]


def public_copy(full_db, out_path, log=print):
    """The D1 version: same data, NO audit. Provenance and fingerprints are
       for Mercy's own verification (compare.html, which runs locally against
       the full db) and for the monthly delta — the website needs neither
       (settled 2026-08-25: 'the audit is just for myself'). sources stays:
       a reader is entitled to know which sources fed a contract.

       The `contracts_v` VIEW undoes the dictionary encoding, so worker
       queries can read plain text columns and pay nothing for it."""
    if os.path.exists(out_path):
        os.unlink(out_path)
    db = sqlite3.connect(out_path)
    db.execute("ATTACH DATABASE ? AS full", (full_db,))
    db.executescript("""
      CREATE TABLE strings (id INTEGER PRIMARY KEY, v TEXT NOT NULL UNIQUE);
      CREATE TABLE allocations AS SELECT * FROM full.allocations;
      CREATE TABLE reports AS SELECT * FROM full.reports;
    """)
    db.execute("INSERT INTO strings (v) SELECT DISTINCT x FROM (%s) WHERE x "
               "IS NOT NULL" % " UNION SELECT ".join(
                   ("SELECT %s AS x FROM full.contracts" if i == 0 else
                    "%s FROM full.contracts") % c
                   for i, c in enumerate(DICT_COLS)))
    sel = []
    for c in SCALARS:
        sel.append("(SELECT s.id FROM strings s WHERE s.v = f.%s) AS %s"
                   % (c, c) if c in DICT_COLS else "f.%s" % c)
    db.execute("CREATE TABLE contracts AS SELECT f.order_id, f.section, %s, "
               "f.sources, f.notes FROM full.contracts f" % ", ".join(sel))
    db.execute("CREATE VIEW contracts_v AS SELECT %s FROM contracts c" %
               ", ".join("(SELECT v FROM strings WHERE id = c.%s) AS %s"
                         % (c, c) if c in DICT_COLS else "c.%s" % c
                         for c in ["order_id", "section"] + SCALARS +
                                  ["sources", "notes"]))
    db.executescript(INDEXES)
    db.executescript("""
      CREATE UNIQUE INDEX ix_contracts_order ON contracts(order_id);
      ANALYZE;
    """)
    db.commit()
    db.execute("DETACH DATABASE full")
    db.execute("VACUUM")
    db.close()
    size = os.path.getsize(out_path) / 1e6
    log("public copy (no audit, %d columns dictionary-encoded): %.1f MB"
        % (len(DICT_COLS), size))
    return size


def delta(old_db, new_db, log=print):
    """{new: [...], changed: [...], gone: [...]} of order_ids — what a
       monthly D1 update actually needs to write. Fingerprints do the work."""
    def prints(path):
        db = sqlite3.connect(path)
        out = dict(db.execute("SELECT order_id, fingerprint FROM contracts"))
        db.close()
        return out
    old, new = prints(old_db), prints(new_db)
    d = {"new": sorted(k for k in new if k not in old),
         "changed": sorted(k for k in new if k in old and old[k] != new[k]),
         "gone": sorted(k for k in old if k not in new)}
    log("delta: %d new · %d changed · %d gone (of %d)"
        % (len(d["new"]), len(d["changed"]), len(d["gone"]), len(new)))
    return d


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--contracts", required=True,
                    help="build_dataset.py's output dir")
    ap.add_argument("--out", required=True, help="the .db to write")
    ap.add_argument("--delta-against",
                    help="last month's .db — print what an update would write")
    ap.add_argument("--public",
                    help="also write the no-audit copy for D1 to this path")
    ap.add_argument("--exemptions",
                    help="embed the exemptions register into the FULL db")
    ap.add_argument("--tenders",
                    help="embed the tenders register into the FULL db")
    a = ap.parse_args()
    build(a.contracts, a.out)
    embed_registers(a.out, a.exemptions, a.tenders)
    if a.public:
        # public_copy copies named tables only — registers never leak into it
        public_copy(a.out, a.public)
    if a.delta_against:
        delta(a.delta_against, a.out)
