#!/usr/bin/env python3
"""
test_portal.py — the portal-register collector, network replaced by fakes.
Its own file, like everything Origin B: nothing here touches the monthly
refresh pipeline's files.

    python3 tests/test_portal.py
"""
import io, json, os, sys, tempfile, zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import fetch_portal_registers as FP
import parse_portal_export as PX

PASS = FAIL = 0

def ok(name, cond, info=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  ✔ " + name)
    else:
        FAIL += 1; print("  ✘ " + name + ("  → " + str(info) if info else ""))


print("\nlinks are read from the page, never remembered:")
PAGE = """
<a href="/ilgstorefront/medias/Tenders-07082026.zip?context=abcDEF123=-_">tenders</a>
<a href="/ilgstorefront/medias/Exemptions-07082026.zip?context=zzz999">exemptions</a>
<a href="/ilgstorefront/medias/Exemptions-07072026.zip?context=old111">last month</a>
"""
links = FP.find_links(PAGE)
ok("both kinds found", set(links) == {"tenders", "exemptions"}, links.keys())
ok("the date is read from the filename, DDMMYYYY → ISO",
   links["tenders"][1] == "2026-08-07", links["tenders"])
ok("when two dates appear, the newer wins",
   links["exemptions"][1] == "2026-08-07", links["exemptions"])
ok("the url keeps the page's own context token",
   links["tenders"][0].endswith("?context=abcDEF123=-_"), links["tenders"][0])
ok("a changed page with no links is a loud stop, not an empty success",
   FP.find_links("<html>redesigned</html>") == {})


print("\nthe whole pipeline, zip to JSON:")
XML = ('﻿<?xml version="1.0" encoding="utf-16"?>'
       '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">'
       '<Worksheet><Table>'
       '<Row><Cell><Data>מספר פרסום</Data></Cell><Cell><Data>שם ספק</Data></Cell>'
       '<Cell><Data>תאריך פרסום</Data></Cell></Row>'
       '<Row><Cell><Data>569574</Data></Cell><Cell><Data>קריץ איגור</Data></Cell>'
       '<Cell><Data>08.09.2015</Data></Cell></Row>'
       '<Row><Cell><Data>600001</Data></Cell><Cell><Data>מילגם</Data></Cell>'
       '<Cell><Data>15.03.2026</Data></Cell></Row>'
       '</Table></Worksheet></Workbook>')

def make_zip(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("פלט פטורים_B.xls", XML.encode("utf-8"))

fetched = []
def fake_text(url, timeout=0):
    fetched.append(url)
    return PAGE
def fake_zip(url, timeout=0):
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    make_zip(tmp.name)
    return tmp.name
FP.fetch_text, _t = fake_text, FP.fetch_text
FP.download_zip, _z = fake_zip, FP.download_zip

with tempfile.TemporaryDirectory() as d:
    man, failed = FP.run(d, log=lambda *a: None)
    ok("nothing failed", failed == [], failed)
    ok("both registers collected", set(man) == {"tenders", "exemptions"}, man.keys())
    with open(os.path.join(d, "exemptions-2026-08-07.json"), encoding="utf-8") as fh:
        doc = json.load(fh)
    ok("the converted JSON carries the portal's own column spellings",
       doc["columns"] == ["מספר פרסום", "שם ספק", "תאריך פרסום"], doc["columns"])
    ok("rows survive intact", doc["rows"][0] == ["569574", "קריץ איגור", "08.09.2015"],
       doc["rows"][:1])
    ok("the dotted date is read: newest פרסום measured",
       doc["counts"]["newest_publication"] == "2026-03-15",
       doc["counts"]["newest_publication"])

    # second run, same page: nothing should be downloaded again
    calls_before = len(fetched)
    def no_zip(url, timeout=0):
        raise AssertionError("an already-collected month must not be re-downloaded")
    FP.download_zip = no_zip
    man2, failed2 = FP.run(d, log=lambda *a: None)
    ok("an already-collected month is skipped", failed2 == [] and
       man2["tenders"]["date"] == "2026-08-07", man2.get("tenders"))

FP.fetch_text, FP.download_zip = _t, _z

print("\nss:Index — omitted cells must not shift what follows:")
XML_IDX = ('\ufeff<?xml version="1.0" encoding="utf-16"?>'
           '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
           'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
           '<Worksheet><Table>'
           '<Row><Cell><Data>א</Data></Cell><Cell><Data>ב</Data></Cell>'
           '<Cell><Data>ג</Data></Cell><Cell><Data>ד</Data></Cell></Row>'
           '<Row><Cell><Data>1</Data></Cell>'
           '<Cell ss:Index="4"><Data>ILS</Data></Cell></Row>'
           '</Table></Worksheet></Workbook>')
with tempfile.TemporaryDirectory() as d:
    src = os.path.join(d, "r.xls")
    with open(src, "w", encoding="utf-8") as fh:
        fh.write(XML_IDX)
    out = os.path.join(d, "out.json")
    PX.convert(src, out, log=lambda *a: None)
    doc = json.load(open(out, encoding="utf-8"))
ok("the indexed cell lands in ITS column, the gap stays empty",
   doc["rows"][0] == ["1", "", "", "ILS"], doc["rows"][0])

print("\na bumped parser version forces re-conversion of an old month:")
FP.fetch_text, FP.download_zip = fake_text, fake_zip
with tempfile.TemporaryDirectory() as d:
    man, failed = FP.run(d, log=lambda *a: None)
    # sabotage: pretend the collection was made by parser v1
    mp = os.path.join(d, "manifest.json")
    m = json.load(open(mp, encoding="utf-8"))
    for k in m: m[k]["parser"] = 1
    json.dump(m, open(mp, "w", encoding="utf-8"))
    zips = []
    def counting_zip(url, timeout=0):
        zips.append(url)
        return fake_zip(url)
    FP.download_zip = counting_zip
    man2, failed2 = FP.run(d, log=lambda *a: None)
ok("both months were re-downloaded and re-converted",
   len(zips) == 2 and failed2 == [], (len(zips), failed2))
ok("the manifest now records the current parser",
   all(v.get("parser") == PX.PARSER_VERSION for v in man2.values()), man2)
FP.fetch_text, FP.download_zip = _t, _z

print("\na zip that is not what it claims fails loudly:")
def bad_zip(url, timeout=0):
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    with zipfile.ZipFile(tmp.name, "w") as z:
        z.writestr("readme.txt", "no spreadsheet here")
    return tmp.name
FP.fetch_text, FP.download_zip = fake_text, bad_zip
with tempfile.TemporaryDirectory() as d:
    man, failed = FP.run(d, log=lambda *a: None)
ok("both flagged as failed, none silently empty",
   set(failed) == {"tenders", "exemptions"}, failed)
FP.fetch_text, FP.download_zip = _t, _z

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
