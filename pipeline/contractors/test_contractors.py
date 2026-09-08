#!/usr/bin/env python3
r"""
test_contractors.py — build_contractors.py against a tiny REAL public db
(made with the real build_sqlite.py, so the dictionary encoding and the
schema are the genuine article). Every fixture exists to pin one of the
page's honesty rules — see contractors\NOTES.md, DEFINITIONS.

Run:  python3 contractors/test_contractors.py   (from pipeline\)
"""
import json, os, sqlite3, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools"))     # oldest fallback
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "database"))  # fallback (forwarders)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "shared"))    # the real home
import build_sqlite            # noqa: E402
sys.path.insert(0, HERE)
import build_contractors       # noqa: E402

quiet = lambda *a, **k: None

C = lambda **kw: dict({"sources": ["bk"]}, **kw)
FIX = {"0020": {"contracts": [
    # the big exempt one — must top 2024 in both lenses
    C(order_id="A1", supplier="קייטרינג הדגל בע\"מ", entity_id="512000001",
      entity_kind="חברה", ministry="משרד החינוך", purpose="הזנה בגני ילדים",
      method="תקנה 3(29) - פטור ממכרז",
      exemption="תקנה 3(29) - ספק יחיד",
      volume=40e6, paid=30e6, first_year=2019, last_year=2026),
    # same entity_id, different spelling — must merge into ONE sid, and its
    # name must come from the LARGER contract (A1)
    C(order_id="A2", supplier="קיטרינג הדגל", entity_id="512000001",
      entity_kind="חברה", ministry="משרד הבריאות", purpose="הזנה בבתי חולים",
      method="מכרז פומבי", volume=7e6, paid=None, first_year=2024, last_year=2025),
    # tendered — in the all lens, out of the exempt lens
    C(order_id="B1", supplier="הסעות הדרום בע\"מ", entity_id="512000002",
      entity_kind="חברה", ministry="משרד החינוך", purpose="הסעות תלמידים",
      method="תקנה 1ב - מכרז פומבי רגיל",
      volume=30e6, paid=25e6, first_year=2020, last_year=2027),
    # JUNK MIN YEAR — in force "since 1899" — excluded from every ranking
    C(order_id="J1", supplier="ספק עתיק", entity_id="512000003",
      ministry="משרד החינוך", purpose="שירות מסתורי", method="פטור ממכרז",
      volume=999e6, paid=1e6, first_year=1899, last_year=2030),
    # junk MAX year — open-ended, still in force, KEPT
    C(order_id="K1", supplier="ספק נצחי", entity_id="512000004",
      ministry="משרד האוצר", purpose="אחזקת מערכות", method="פטור ממכרז",
      exemption="תקנה 3(1) - עד 50,000 שח",
      volume=5e6, paid=None, first_year=2023, last_year=9999),
    # exempt by method but citation WITHOUT the word תקנה — counted in the
    # exempt lens, EXCLUDED from the citations ranking (junk in the field)
    C(order_id="X1", supplier="ספק בלי תקנה", entity_id="512000005",
      ministry="משרד האוצר", purpose="ייעוץ", method="פטור ממכרז",
      exemption="הזמנה 4501111111",
      volume=3e6, paid=None, first_year=2024, last_year=2024),
    # no entity_id — sid falls back to the exact supplier NAME
    C(order_id="N1", supplier="עמותת שם בלבד", entity_kind=None,
      ministry="משרד הרווחה", purpose="שירותי רווחה", method="מכרז פומבי",
      volume=2e6, paid=None, first_year=2024, last_year=2025,
      sources=["file"]),
    # no years at all — never in force anywhere
    C(order_id="Z1", supplier="ספק בלי שנים", entity_id="512000006",
      ministry="משרד החינוך", purpose="לא ידוע", method="מכרז פומבי",
      volume=800e6, paid=None, first_year=None, last_year=None),
]}}

tmp = tempfile.mkdtemp(prefix="ctr-test-")
cdir = os.path.join(tmp, "contracts")
os.makedirs(cdir)
with open(os.path.join(cdir, "0020.json"), "w", encoding="utf-8") as fh:
    json.dump(FIX["0020"], fh, ensure_ascii=False)
full = os.path.join(tmp, "full.db")
pub = os.path.join(tmp, "public.db")
build_sqlite.build(cdir, full, log=quiet)
build_sqlite.public_copy(full, pub, log=quiet)
build_contractors.build(pub, year_from=2015, log=quiet)

db = sqlite3.connect(pub)
one = lambda q, *a: db.execute(q, a).fetchone()
allr = lambda q, *a: db.execute(q, a).fetchall()

npass = nfail = 0
def ok(name, cond, extra=""):
    global npass, nfail
    if cond:
        npass += 1; print("  ✔ " + name)
    else:
        nfail += 1; print("  ✘ " + name + ("  → %r" % (extra,) if extra != "" else ""))

print("ctr_years:")
y24 = one("SELECT n, suppliers, total, exempt_n, exempt_vol FROM ctr_years WHERE year=2024")
# in force 2024: A1, A2, B1, K1, X1, N1 (J1 junk-min excluded, Z1 no years)
ok("2024 counts contracts in force, junk-min and no-years excluded",
   y24 and y24[0] == 6, y24)
ok("distinct suppliers counted by sid", y24[1] == 5, y24)
ok("total volume sums in full", y24[2] == 40e6 + 7e6 + 30e6 + 5e6 + 3e6 + 2e6, y24)
ok("exempt slice counted by the record's own words (method)",
   y24[3] == 3 and y24[4] == 40e6 + 5e6 + 3e6, y24)
y19 = one("SELECT n FROM ctr_years WHERE year=2019")
ok("a contract counts in EVERY year it is in force (A1 alone in 2019)", y19[0] == 1, y19)
y30 = one("SELECT n FROM ctr_years WHERE year=%d" % (__import__("datetime").date.today().year))
ok("junk MAX (9999) keeps a contract in force today", y30 and y30[0] >= 1, y30)

print("ctr_top:")
top = allr("SELECT rank, sid, name, volume FROM ctr_top WHERE year=2024 AND lens='all' ORDER BY rank")
ok("ranked by volume, the merged sid first",
   top[0][1] == "512000001" and top[0][3] == 47e6, top[:3])
ok("two spellings of one entity_id merged into one row; name from the "
   "larger contract", top[0][2] == 'קייטרינג הדגל בע"מ', top[0])
ok("the junk-min giant (999m) is NOT in the ranking",
   not any(r[1] == "512000003" for r in top), top)
ok("a name-only supplier keeps its own sid",
   any(r[1] == "עמותת שם בלבד" for r in top), top)
ex_top = allr("SELECT sid, volume, paid FROM ctr_top WHERE year=2024 AND lens='exempt' ORDER BY rank")
ok("exempt lens holds only exempt contracts (A1 alone for sid 512000001 — "
   "40m, not 47m)", ex_top[0][0] == "512000001" and ex_top[0][1] == 40e6, ex_top)
ok("exempt lens excludes tendered suppliers",
   not any(r[0] == "512000002" for r in ex_top), ex_top)
ok("paid over only-unknowns is NULL, never 0",
   [r[2] for r in ex_top if r[0] == "512000004"] == [None], ex_top)

print("ctr_ex:")
ex = allr("SELECT citation, n, volume FROM ctr_ex WHERE year=2024 ORDER BY rank")
ok("citations ranked by volume, verbatim",
   ex and ex[0][0] == "תקנה 3(29) - ספק יחיד" and ex[0][2] == 40e6, ex)
ok("a 'citation' without תקנה is junk and excluded",
   not any("4501111111" in r[0] for r in ex), ex)
ok("exempt method with a real citation ranks (K1)",
   any(r[0] == "תקנה 3(1) - עד 50,000 שח" for r in ex), ex)

print("ctr_sup:")
sup = one("SELECT name, n, volume, paid, first_year, last_year, offices, series, top "
          "FROM ctr_sup WHERE sid='512000001'")
ok("facts: n=2, volume=47m, paid=30m (known part; unknown ignored)",
   sup[1] == 2 and sup[2] == 47e6 and sup[3] == 30e6, sup[:4])
ok("sane years: 2019..2026", sup[4] == 2019 and sup[5] == 2026, sup[4:6])
offices = json.loads(sup[6])
ok("per-ministry rollup, biggest first",
   [o["ministry"] for o in offices] == ["משרד החינוך", "משרד הבריאות"], offices)
series = json.loads(sup[7])
ok("series spans the in-force years",
   series[0][0] == 2019 and any(y == 2024 and v == 47e6 for y, v, n in series), series)
ok("top contracts by volume", json.loads(sup[8]) == ["A1", "A2"], sup[8])
eternal = one("SELECT paid, last_year FROM ctr_sup WHERE sid='512000004'")
ok("all-unknown paid stays NULL in the profile too; junk last_year not 'sane'",
   eternal[0] is None and eternal[1] is None, eternal)
noyears = one("SELECT n, series FROM ctr_sup WHERE sid='512000006'")
ok("a no-years contract still has a profile (facts), just an empty series",
   noyears[0] == 1 and json.loads(noyears[1]) == [], noyears)

print("ctr_fts:")
hit = allr("SELECT order_id FROM ctr_fts WHERE ctr_fts MATCH ? ORDER BY rank", '"הזנה"')
ok("Hebrew purpose search finds both feeding contracts",
   sorted(h[0] for h in hit) == ["A1", "A2"], hit)
hit2 = allr("SELECT order_id FROM ctr_fts WHERE ctr_fts MATCH ?", '"הסעות" "תלמידים"')
ok("supplier name + purpose are one searchable text", [h[0] for h in hit2] == ["B1"], hit2)

db.close()
import shutil; shutil.rmtree(tmp, ignore_errors=True)
print("\n%d passed, %d failed" % (npass, nfail))
sys.exit(1 if nfail else 0)
