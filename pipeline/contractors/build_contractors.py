#!/usr/bin/env python3
r"""
build_contractors.py — precompute THE CONTRACTORS PAGE's aggregates into
contractors\out\contracts-public.db, so the page can leave BudgetKey live
queries behind. Run by double-clicking build-contractors.bat (adds the
tables to the ALREADY-BUILT public db); build_database.py in this folder
also calls this at the end of every full build, so a rebuild never loses
the tables.

WHY PRECOMPUTE (the ruling in contractors\NOTES.md, 2026-09-08):
  D1 bills every row READ. "Top suppliers of 2024" as a live query is a full
  scan of ~1M rows per page view, per visitor. But the aggregates change AT
  MOST QUARTERLY (when ministry reports are published) — so they are computed
  ONCE here, at build time, and the worker serves dumb, indexed, tiny tables.

WHAT IT WRITES (all table names prefixed ctr_ so they are recognizably this
job's; a re-run replaces them cleanly):

  ctr_years   one row per year: contracts in force, distinct suppliers, total
              volume, the exempt slice, and the top-10 suppliers' volume —
              the page's three headline tiles from ONE tiny read.
  ctr_top     top 25 suppliers per (year, lens), lens ∈ {all, exempt}.
  ctr_ex      top 25 exemption citations per year (page shows 10).
  ctr_sup     one row per supplier: facts + per-ministry rollup (JSON) +
              year-by-year in-force series (JSON) + the order_ids of the 25
              largest contracts (JSON) — a profile is ONE indexed read, plus
              25 primary-key reads for the contract rows.
  ctr_fts     FTS5 over supplier name + purpose → the free-text search that
              was always "the day it moves". Carries order_id back.

THE DEFINITIONS ARE THE PAGE'S HONESTY RULES — they moved here verbatim from
site\budget_page\ (contractors\NOTES.md keeps the full list with reasons):
  - "in force in year Y" = first_year <= Y <= last_year AND first_year > 1990
    (junk years live at both edges; a junk MIN would put a contract in force
    since 1899 so it is excluded; a junk MAX means open-ended and is KEPT).
  - every contract counts IN FULL in every year it is in force — the tiles,
    the rankings and the profile chart all share this one definition.
  - "פטור ממכרז" is counted by the record's own words: the method field
    contains the phrase. No cleaner taxonomy without a ruling from Mercy.
  - the exemptions ranking requires BOTH: the method records פטור ממכרז AND
    the citation (the exemption field) contains "תקנה". Combos stay verbatim.
  - paid summed over only-unknowns is unknown (NULL), never 0 — SQLite's
    SUM() already does this; nothing here coalesces paid to zero.
  - supplier identity = entity_id where present, else the exact supplier
    name (sid = COALESCE(entity_id, supplier)); rows with neither are
    excluded from supplier rankings — they must never clump into one giant.
  - rankings order by VOLUME, the number the reader sees.

Stdlib only. Needs a python whose sqlite has FTS5 (the official installer's
does; the script checks and says so if not).
"""
import argparse, datetime, json, os, sqlite3, sys

YEAR_FROM = 2015          # the page's year picker starts here
TOP_SUPPLIERS = 25        # per (year, lens) — all the page shows
TOP_EXEMPTIONS = 25       # kept per year; the page shows 10
TOP_CONTRACTS = 25        # per supplier profile
EXEMPT_PHRASE = "פטור ממכרז"
CITATION_WORD = "תקנה"

DDL = """
DROP TABLE IF EXISTS ctr_years;
DROP TABLE IF EXISTS ctr_top;
DROP TABLE IF EXISTS ctr_ex;
DROP TABLE IF EXISTS ctr_sup;
CREATE TABLE ctr_years (
  year INTEGER PRIMARY KEY,
  n INTEGER NOT NULL,            -- contracts in force
  suppliers INTEGER NOT NULL,    -- distinct sids
  total REAL,                    -- sum volume
  exempt_n INTEGER NOT NULL,
  exempt_vol REAL,
  top10_vol REAL                 -- the 10 largest suppliers' combined volume
);
CREATE TABLE ctr_top (
  year INTEGER NOT NULL,
  lens TEXT NOT NULL,            -- 'all' | 'exempt'
  rank INTEGER NOT NULL,         -- 1..25 by volume
  sid TEXT NOT NULL,
  name TEXT,
  kind TEXT,
  n INTEGER NOT NULL,
  volume REAL,
  paid REAL,                     -- NULL when no source reported paid at all
  PRIMARY KEY (year, lens, rank)
);
CREATE TABLE ctr_ex (
  year INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  citation TEXT NOT NULL,        -- verbatim, combos joined as reported
  n INTEGER NOT NULL,
  volume REAL,
  PRIMARY KEY (year, rank)
);
CREATE TABLE ctr_sup (
  sid TEXT PRIMARY KEY,
  name TEXT,
  kind TEXT,
  n INTEGER NOT NULL,
  volume REAL,
  paid REAL,
  first_year INTEGER,            -- earliest SANE year (> 1990)
  last_year INTEGER,             -- latest sane year (<= build year + 20)
  offices TEXT NOT NULL,         -- json [{ministry,n,volume,paid}] by volume desc
  series TEXT NOT NULL,          -- json [[year,volume,n]] — in-force per year
  top TEXT NOT NULL              -- json [order_id × 25] — the largest contracts
);
"""


def check_fts5(db):
    try:
        db.execute("CREATE VIRTUAL TABLE temp.fts5check USING fts5(x)")
        db.execute("DROP TABLE temp.fts5check")
        return True
    except sqlite3.OperationalError:
        return False


def build(db_path, year_from=YEAR_FROM, log=print):
    if not os.path.exists(db_path):
        sys.exit("no %s — run contractors\\build-database.bat first." % db_path)
    db = sqlite3.connect(db_path)
    if not check_fts5(db):
        sys.exit("this python's sqlite has no FTS5 — install python from "
                 "python.org (its sqlite carries FTS5) and run again.")
    year_to = datetime.date.today().year
    sane_last = year_to + 20

    log("decoding the dictionary columns once…")
    # ministry/method/exemption/entity_kind are dictionary-encoded integers in
    # the public db; decode them ONCE into a temp table by joining strings —
    # going through the contracts_v view would run four subselects per row.
    db.executescript("""
      CREATE TEMP TABLE base AS
      SELECT c.order_id,
             COALESCE(c.entity_id, c.supplier) AS sid,
             c.supplier, c.purpose, c.volume, c.paid,
             c.first_year, c.last_year,
             (SELECT v FROM strings WHERE id = c.ministry)    AS ministry,
             (SELECT v FROM strings WHERE id = c.method)      AS method,
             (SELECT v FROM strings WHERE id = c.exemption)   AS exemption,
             (SELECT v FROM strings WHERE id = c.entity_kind) AS kind
      FROM contracts c;
      CREATE INDEX temp.ix_base_sid ON base(sid);
    """)
    n_all = db.execute("SELECT COUNT(*) FROM base").fetchone()[0]

    log("expanding to (year, contract) — every contract counts in full in "
        "every year it is in force…")
    db.execute("CREATE TEMP TABLE years (y INTEGER PRIMARY KEY)")
    db.executemany("INSERT INTO years VALUES (?)",
                   [(y,) for y in range(year_from, year_to + 1)])
    db.executescript("""
      CREATE TEMP TABLE inforce AS
      SELECT y.y AS year, b.*,
             (b.method LIKE '%""" + EXEMPT_PHRASE + """%') AS exempt
      FROM base b JOIN years y
        ON b.first_year IS NOT NULL AND b.last_year IS NOT NULL
       AND b.first_year > 1990
       AND b.first_year <= y.y AND b.last_year >= y.y;
      CREATE INDEX temp.ix_inforce_year ON inforce(year);
    """)

    log("supplier rollups per year…")
    # ONE canonical name+kind per sid, taken from the supplier's LARGEST
    # contract. The bare supplier/kind columns next to a SINGLE MAX() are
    # SQLite's documented bare-column-with-max behaviour — deliberate, and it
    # only holds with exactly one min/max in the query, so this table exists
    # precisely so no other query needs to repeat the trick.
    db.executescript("""
      CREATE TEMP TABLE supname AS
      SELECT sid, supplier AS name, kind, MAX(COALESCE(volume, 0)) AS _big
      FROM base WHERE sid IS NOT NULL GROUP BY sid;
      CREATE INDEX temp.ix_supname_sid ON supname(sid);
      CREATE TEMP TABLE supyear AS
      SELECT year, sid, COUNT(*) AS n, SUM(volume) AS volume, SUM(paid) AS paid
      FROM inforce WHERE sid IS NOT NULL GROUP BY year, sid;
      CREATE TEMP TABLE supyear_ex AS
      SELECT year, sid, COUNT(*) AS n, SUM(volume) AS volume, SUM(paid) AS paid
      FROM inforce WHERE sid IS NOT NULL AND exempt GROUP BY year, sid;
    """)

    db.executescript(DDL)

    log("ctr_years — the headline tiles…")
    db.execute("""
      INSERT INTO ctr_years (year, n, suppliers, total, exempt_n, exempt_vol, top10_vol)
      SELECT i.year, COUNT(*), COUNT(DISTINCT i.sid), SUM(i.volume),
             SUM(i.exempt), SUM(CASE WHEN i.exempt THEN i.volume END),
             (SELECT SUM(volume) FROM (
                SELECT volume FROM supyear s WHERE s.year = i.year
                ORDER BY volume DESC LIMIT 10))
      FROM inforce i GROUP BY i.year
    """)

    log("ctr_top — top %d suppliers per (year, lens)…" % TOP_SUPPLIERS)
    for lens, src in (("all", "supyear"), ("exempt", "supyear_ex")):
        db.execute("""
          INSERT INTO ctr_top (year, lens, rank, sid, name, kind, n, volume, paid)
          SELECT t.year, ?, t.rnk, t.sid, s.name, s.kind, t.n, t.volume, t.paid
          FROM (SELECT *, ROW_NUMBER() OVER (
                  PARTITION BY year ORDER BY volume DESC, sid) AS rnk FROM %s) t
          JOIN supname s ON s.sid = t.sid
          WHERE t.rnk <= ?""" % src, (lens, TOP_SUPPLIERS))

    log("ctr_ex — the exemption regulations by the money riding on them…")
    db.execute("""
      INSERT INTO ctr_ex (year, rank, citation, n, volume)
      SELECT year, rnk, exemption, n, volume FROM (
        SELECT year, exemption, COUNT(*) AS n, SUM(volume) AS volume,
               ROW_NUMBER() OVER (
                 PARTITION BY year ORDER BY SUM(volume) DESC, exemption) AS rnk
        FROM inforce
        WHERE exempt AND exemption LIKE '%%%s%%'
        GROUP BY year, exemption)
      WHERE rnk <= ?""" % CITATION_WORD, (TOP_EXEMPTIONS,))

    log("ctr_sup — one profile row per supplier…")
    facts = db.execute("""
      SELECT b.sid, s.name, s.kind, COUNT(*) AS n,
             SUM(b.volume) AS volume, SUM(b.paid) AS paid,
             MIN(CASE WHEN b.first_year > 1990 THEN b.first_year END),
             MAX(CASE WHEN b.last_year <= ? THEN b.last_year END)
      FROM base b JOIN supname s ON s.sid = b.sid
      GROUP BY b.sid""", (sane_last,)).fetchall()
    offices, series, tops = {}, {}, {}
    for sid, ministry, n, vol, paid in db.execute(
            "SELECT sid, ministry, COUNT(*), SUM(volume), SUM(paid) FROM base "
            "WHERE sid IS NOT NULL GROUP BY sid, ministry "
            "ORDER BY sid, SUM(volume) DESC"):
        offices.setdefault(sid, []).append(
            {"ministry": ministry, "n": n, "volume": vol, "paid": paid})
    for sid, year, vol, n in db.execute(
            "SELECT sid, year, volume, n FROM supyear ORDER BY sid, year"):
        series.setdefault(sid, []).append([year, vol, n])
    for sid, oid in db.execute(
            "SELECT sid, order_id FROM base WHERE sid IS NOT NULL "
            "ORDER BY sid, COALESCE(volume, 0) DESC, order_id"):
        lst = tops.setdefault(sid, [])
        if len(lst) < TOP_CONTRACTS:
            lst.append(oid)
    js = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    db.executemany(
        "INSERT INTO ctr_sup VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(sid, name, kind, n, vol, paid, fy, ly,
          js(offices.get(sid, [])), js(series.get(sid, [])), js(tops.get(sid, [])))
         for sid, name, kind, n, vol, paid, fy, ly in facts])

    log("ctr_fts — the free-text search index (name + purpose)…")
    db.executescript("""
      DROP TABLE IF EXISTS ctr_fts;
      CREATE VIRTUAL TABLE ctr_fts USING fts5(text, order_id UNINDEXED);
    """)
    db.execute("""
      INSERT INTO ctr_fts (text, order_id)
      SELECT TRIM(COALESCE(supplier, '') || ' ' || COALESCE(purpose, '')),
             order_id
      FROM base WHERE supplier IS NOT NULL OR purpose IS NOT NULL""")

    db.execute("ANALYZE")
    db.commit()

    # ---- the numbers, so a drifted definition is caught TODAY ----
    log("\nwhat was built (of %s contracts):" % format(n_all, ","))
    for y, n, sups, total, exn, exv, t10 in db.execute(
            "SELECT * FROM ctr_years ORDER BY year"):
        log("  %d: %s in force · %s suppliers · volume %.1fbn · "
            "exempt %.1fbn (%s%%) · top-10 %.1fbn"
            % (y, format(n, ","), format(sups, ","), (total or 0) / 1e9,
               (exv or 0) / 1e9,
               round(100.0 * (exv or 0) / total, 1) if total else "—",
               (t10 or 0) / 1e9))
    row = db.execute("SELECT n, total, exempt_n, exempt_vol FROM ctr_years "
                     "WHERE year = 2024").fetchone()
    if row:
        n, total, exn, exv = row
        log("\nSANITY vs BudgetKey live (verified 2026-09-08): 2024 there had "
            "93,530 in force · 210.4bn · exempt 66.7bn = 31.7%% (41,180). "
            "Ours: %s · %.1fbn · exempt %.1fbn = %s%% (%s). Our merged db "
            "need not match exactly — it merges more sources — but a LARGE "
            "gap means a definition drifted: stop and tell Claude."
            % (format(n, ","), (total or 0) / 1e9, (exv or 0) / 1e9,
               round(100.0 * (exv or 0) / total, 1) if total else "—",
               format(exn, ",")))
        top_ex = db.execute("SELECT citation, volume, n FROM ctr_ex WHERE "
                            "year = 2024 ORDER BY rank LIMIT 4").fetchall()
        log("top 2024 citations (live saw 3(16) ~30bn · 3(5) ~9.6bn · "
            "3(1) ~4.5bn · 3(29) ~1.87bn):")
        for c, v, n2 in top_ex:
            log("  %.2fbn over %s: %s" % ((v or 0) / 1e9, format(n2, ","),
                                          (c or "")[:70]))
    fts_n = db.execute("SELECT COUNT(*) FROM ctr_fts").fetchone()[0]
    sup_n = db.execute("SELECT COUNT(*) FROM ctr_sup").fetchone()[0]
    log("\nctr_sup: %s suppliers · ctr_fts: %s searchable contracts · db now "
        "%.1f MB" % (format(sup_n, ","), format(fts_n, ","),
                     os.path.getsize(db_path) / 1e6))
    db.close()
    return {"suppliers": sup_n, "fts": fts_n}


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    # the db lives HERE in contractors\out\ (by-DATASET reorg 2026-09-08);
    # pipeline\out\ is honoured until apply-dataset-reorg.bat moves it
    _new = os.path.join(here, "out", "contracts-public.db")
    _old = os.path.join(os.path.dirname(here), "out", "contracts-public.db")
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=_old if (os.path.exists(_old) and
                                             not os.path.exists(_new)) else _new)
    ap.add_argument("--year-from", type=int, default=YEAR_FROM)
    a = ap.parse_args()
    build(a.db, a.year_from)
