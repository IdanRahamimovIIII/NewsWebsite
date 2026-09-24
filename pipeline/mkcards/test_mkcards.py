#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for build_mkcards.py — run from pipeline\\:  python3 mkcards/test_mkcards.py

No network, no Cloudflare: a fake relay serves a tiny world that ARMS EVERY
TRAP the live data has (project rule: a fixture more generous than the real
source is a rubber stamp):
  - two id spaces bridged by word-order-blind names
  - the K25 spellings that differ (גנץ בני=בנימין גנץ, extra-word names,
    an apostrophe) — and "בניה גנצר" must NOT ride on "גנץ בני"
  - namesakes (two אלי כהן): the PersonID with rows in THIS Knesset wins
  - a persons-snapshot miss resolved by KNS_Person, both word orders
  - the register's duplicate gendered PM rows + a term split mid-Knesset
  - a real gap that must be kept; nothing stitched across Knessets
  - the en-dash Speaker (יושב–ראש) and the deputy who must not outrank him
  - pages capped at 100 rows whatever $top says
  - $count refusing an unfiltered count
  - a missing photo, a missing English name, a leaver, zero bills
"""
import io, json, re, sys, unittest, urllib.parse
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_mkcards as B

B.PAUSE = 0  # no politeness needed toward a dict


# =====================================================================
# the fixture world
# =====================================================================
LATEST = 25

PERSONS = {          # PersonID → name, persons form ("יאיר לפיד")
    "100": "בנימין נתניהו",     # cmb spells him "נתניהו בנימין" (word order)
    "200": "בנימין גנץ",        # cmb spells him "גנץ בני" (loose match only)
    "201": "בניה גנצר",         # the trap: must NOT match "גנץ בני"
    "300": "אלי כהן",           # namesake A — rows in K25
    "301": "אלי כהן",           # namesake B — no K25 rows
    "400": "יצחק פינדרוס",      # cmb: "פינדרוס יצחק זאב" (extra word)
    # 500 "רות קלדרון" exists ONLY in KNS_Person (snapshot miss → fallback)
    "600": "אמיר אוחנה",        # the Speaker, en-dash role
    "700": "משה גפני",          # leaver fixture (until year)
}

# cmb MKS rows: Id = MkId (stable), KnessetId, faction_id
MKS = [
    {"Id": 771, "Name": "נתניהו בנימין", "KnessetId": 25, "faction_id": 1},
    {"Id": 771, "Name": "נתניהו בנימין", "KnessetId": 24, "faction_id": 1},
    {"Id": 771, "Name": "נתניהו בנימין", "KnessetId": 16, "faction_id": 1},
    {"Id": 802, "Name": "גנץ בני", "KnessetId": 25, "faction_id": 2},
    {"Id": 803, "Name": "כהן אלי", "KnessetId": 25, "faction_id": 1},
    {"Id": 804, "Name": "פינדרוס יצחק זאב", "KnessetId": 25, "faction_id": 3},
    {"Id": 805, "Name": "קלדרון רות", "KnessetId": 25, "faction_id": 2},
    {"Id": 806, "Name": "אוחנה אמיר", "KnessetId": 25, "faction_id": 1},
    {"Id": 807, "Name": "גפני משה", "KnessetId": 25, "faction_id": 3},
    {"Id": 807, "Name": "גפני משה", "KnessetId": 24, "faction_id": 3},
]

FACTIONS = [
    {"ID": 1, "FactionName": "הליכוד בראשות בנימין נתניהו"},
    {"ID": 2, "FactionName": "המחנה הממלכתי"},
    {"ID": 3, "FactionName": "התאחדות הספרדים שומרי תורה תנועתו של מרן הרב עובדיה יוסף זצ\"ל"},
]

KNESSETS = [
    {"KnessetId": 16, "KnessetStart": "2003-02-17T00:00:00", "KnessetEnd": "2006-04-17T00:00:00"},
    {"KnessetId": 24, "KnessetStart": "2021-04-06T00:00:00", "KnessetEnd": "2022-11-15T00:00:00"},
    {"KnessetId": 25, "KnessetStart": "2022-11-15T00:00:00", "KnessetEnd": None},
]

DROP_HE = [
    {"ID": 771, "Name": "נתניהו בנימין", "IsCurrent": True},
    {"ID": 802, "Name": "גנץ בני", "IsCurrent": True},
    {"ID": 803, "Name": "כהן אלי", "IsCurrent": True},
    {"ID": 804, "Name": "פינדרוס יצחק זאב", "IsCurrent": True},
    {"ID": 805, "Name": "קלדרון רות", "IsCurrent": True},
    {"ID": 806, "Name": "אוחנה אמיר", "IsCurrent": True},
    {"ID": 807, "Name": "גפני משה", "IsCurrent": False},   # left mid-Knesset
]

DROP_EN = [
    {"ID": 771, "Name": "Netanyahu, Benjamin", "IsCurrent": True},   # comma form — must flip
    {"ID": 802, "Name": "Benny Gantz", "IsCurrent": True},
    {"ID": 803, "Name": "Eli Cohen", "IsCurrent": True},
    {"ID": 804, "Name": "Yitzhak Pindrus", "IsCurrent": True},
    {"ID": 805, "Name": "Ruth Calderon", "IsCurrent": True},
    {"ID": 806, "Name": "Amir Ohana", "IsCurrent": True},
    {"ID": 807, "Name": "Moshe Gafni", "IsCurrent": False},
]

# register rows for K25 (the bulk query). PM listed TWICE under two gendered
# position codes, same dates, both current — the live duplicate.
POS_K25 = [
    {"PersonID": 100, "PositionID": 45, "KnessetNum": 25, "StartDate": "2022-12-29T00:00:00",
     "FinishDate": None, "GovMinistryName": "משרד ראש הממשלה", "DutyDesc": "ראש הממשלה",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 100, "PositionID": 39, "KnessetNum": 25, "StartDate": "2022-12-29T00:00:00",
     "FinishDate": None, "GovMinistryName": "משרד ראש הממשלה", "DutyDesc": "ראש הממשלה",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 100, "PositionID": 43, "KnessetNum": 25, "StartDate": "2022-11-15T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 200, "PositionID": 43, "KnessetNum": 25, "StartDate": "2022-11-15T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 300, "PositionID": 40, "KnessetNum": 25, "StartDate": "2022-12-29T00:00:00",
     "FinishDate": None, "GovMinistryName": "משרד החוץ", "DutyDesc": "שר החוץ",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 400, "PositionID": 43, "KnessetNum": 25, "StartDate": "2022-11-15T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 500, "PositionID": 43, "KnessetNum": 25, "StartDate": "2022-11-15T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    # the Speaker, register's en-dash spelling — and his deputy, who must not outrank him
    {"PersonID": 600, "PositionID": 30, "KnessetNum": 25, "StartDate": "2022-12-29T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "יושב–ראש הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 600, "PositionID": 31, "KnessetNum": 25, "StartDate": "2022-11-20T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "סגן יושב–ראש הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    # the leaver: his K25 membership row CLOSED (register leaves some rows
    # open for people long gone — closing this one is the honest fixture)
    {"PersonID": 700, "PositionID": 43, "KnessetNum": 25, "StartDate": "2022-11-15T00:00:00",
     "FinishDate": "2024-06-30T00:00:00", "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": False},
]

# full history (positions_for_many). Netanyahu K23: one term split into two
# rows where the GovernmentNum changed (must stitch), plus a REAL gap term
# in K16 (must stay separate). Gafni: an old committee chairmanship.
POS_ALL = POS_K25 + [
    {"PersonID": 100, "PositionID": 45, "KnessetNum": 23, "StartDate": "2020-03-16T00:00:00",
     "FinishDate": "2020-05-17T00:00:00", "GovMinistryName": "משרד ראש הממשלה",
     "DutyDesc": "ראש הממשלה", "CommitteeName": None, "FactionName": None, "IsCurrent": False},
    {"PersonID": 100, "PositionID": 45, "KnessetNum": 23, "StartDate": "2020-05-17T00:00:00",
     "FinishDate": "2021-04-06T00:00:00", "GovMinistryName": "משרד ראש הממשלה",
     "DutyDesc": "ראש הממשלה", "CommitteeName": None, "FactionName": None, "IsCurrent": False},
    {"PersonID": 100, "PositionID": 51, "KnessetNum": 16, "StartDate": "2003-02-28T00:00:00",
     "FinishDate": "2005-08-07T00:00:00", "GovMinistryName": "משרד האוצר",
     "DutyDesc": "שר האוצר", "CommitteeName": None, "FactionName": None, "IsCurrent": False},
    {"PersonID": 700, "PositionID": 61, "KnessetNum": 24, "StartDate": "2021-04-06T00:00:00",
     "FinishDate": "2022-11-15T00:00:00", "GovMinistryName": None, "DutyDesc": 'יו"ר ועדת הכספים',
     "CommitteeName": "ועדת הכספים", "FactionName": None, "IsCurrent": False},
]

STATUSES = [
    {"StatusID": 118, "Desc": "התקבלה בקריאה השלישית"},
    {"StatusID": 122, "Desc": "פורסמה ברשומות"},
    {"StatusID": 108, "Desc": "נדחתה בקריאה הטרומית"},
    {"StatusID": 150, "Desc": "מוזגה עם הצעת חוק אחרת"},
]
PASSED_IDS = {118, 122}

# bills per PersonID: (proposed, passed). PersonID 301 (the wrong אלי כהן)
# carries 99 laws — summing the namesakes is the classic bug.
BILLS = {100: (31, 6), 200: (12, 2), 300: (20, 5), 301: (99, 99),
         400: (7, 0), 500: (3, 1), 600: (15, 4), 700: (40, 9)}

PHOTOS = {"771": "771-abcd1234.jpg", "802": "802-ef567890.jpg", "803": "803-11112222.jpg",
          "804": "804-33334444.jpg", "806": "806-55556666.jpg", "807": "807-77778888.jpg"}
# 805 (קלדרון) has NO photo — the card must say null, never a guessed URL


# =====================================================================
# the fake relay: understands exactly the requests the collector may make,
# refuses what the live service refuses
# =====================================================================
class FakeWorld:
    def __init__(self):
        self.persons_published = True
        self.bills_published = True

    def fetch(self, url, timeout=45):
        if url.startswith("https://relay.test/?url="):
            return self.upstream(urllib.parse.unquote(url.split("?url=", 1)[1]))
        if url.startswith("https://relay.test/data/"):
            name = url.split("/data/", 1)[1].split("?")[0]
            return self.data_route(name)
        raise RuntimeError("HTTP 404 from " + url)

    def data_route(self, name):
        if name == "persons":
            if not self.persons_published:
                raise RuntimeError("HTTP 404 from /data/persons")
            return json.dumps({"t": 1, "data": PERSONS}, ensure_ascii=False).encode("utf-8")
        if name == "mkphotos":
            return json.dumps({"t": 1, "data": PHOTOS}).encode("utf-8")
        if name == "bills":
            if not self.bills_published:
                raise RuntimeError("HTTP 404 from /data/bills")
            return json.dumps({"t": 1, "data": {"statuses": STATUSES}}, ensure_ascii=False).encode("utf-8")
        raise RuntimeError("HTTP 404 from /data/" + name)

    # ---------------- upstream (knesset.gov.il through the relay) -------
    def upstream(self, url):
        if "GetMksDropdown" in url:
            lang = "en" if "languageKey=en" in url else "he"
            return json.dumps(DROP_EN if lang == "en" else DROP_HE, ensure_ascii=False).encode("utf-8")
        if "GetVotesCmbData" in url:
            return json.dumps({"MKS": MKS, "Factions": FACTIONS, "Knessets": KNESSETS},
                              ensure_ascii=False).encode("utf-8")
        if "/$count" in url:
            return self.count(url)
        if "KNS_Position()" in url:
            return self.od_page(url, [])          # DutyDesc is filled everywhere in the fixture
        if "KNS_PersonToPosition()" in url:
            flt = self.filter_of(url)
            if "KnessetNum eq 25" in flt:
                rows = POS_K25
            else:
                pids = {int(m) for m in re.findall(r"PersonID eq (\d+)", flt)}
                rows = [r for r in POS_ALL if r["PersonID"] in pids]
            return self.od_page(url, rows)
        if "KNS_Person()" in url:
            flt = self.filter_of(url)
            m = re.search(r"FirstName eq '([^']*)' and LastName eq '([^']*)'", flt)
            rows = []
            if m and (m.group(1), m.group(2)) == ("רות", "קלדרון"):
                rows = [{"PersonID": 500}]
            return self.od_page(url, rows)
        if "KNS_Status()" in url:
            return self.od_page(url, STATUSES)
        raise RuntimeError("HTTP 404 from upstream " + url[:100])

    def filter_of(self, url):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        return (q.get("$filter") or [""])[0]

    def od_page(self, url, rows):
        """THE LIVE CAP: at most 100 rows a page, whatever $top says"""
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        skip = int((q.get("$skip") or ["0"])[0])
        return json.dumps({"value": rows[skip:skip + 100]}, ensure_ascii=False).encode("utf-8")

    def count(self, url):
        flt = self.filter_of(url)
        if not flt:
            # the live service's answer to a bare $count
            raise RuntimeError("HTTP 400 from upstream — count needs a filter")
        if "KNS_PersonToPosition" in url:
            if "KnessetNum eq 25" in flt:
                return str(len(POS_K25)).encode()
            raise RuntimeError("HTTP 400 unexpected count filter " + flt)
        m = re.search(r"PersonID eq (\d+)", flt)
        pid = int(m.group(1))
        proposed, passed = BILLS.get(pid, (0, 0))
        if "KNS_Bill/StatusID" in flt:
            wanted = {int(x) for x in re.findall(r"StatusID eq (\d+)", flt)}
            if wanted != PASSED_IDS:
                raise RuntimeError("HTTP 400 wrong passed-status set: %s" % wanted)
            return str(passed).encode()
        return str(proposed).encode()


def build_world(fake=None):
    fake = fake or FakeWorld()
    relay = B.Relay("https://relay.test", fetch=fake.fetch)
    with redirect_stdout(io.StringIO()):
        world = B.collect(relay)
        data, problems = B.build(relay, world)
    return data, problems, relay


# =====================================================================
# the tests
# =====================================================================
class NameLogic(unittest.TestCase):
    def test_word_order_blind(self):
        self.assertEqual(B.name_key("לפיד יאיר"), B.name_key("יאיר לפיד"))

    def test_loose_match_spellings(self):
        self.assertTrue(B.loose_match("גנץ בני", "בנימין גנץ"))          # prefix בני~בנימין
        self.assertTrue(B.loose_match("פינדרוס יצחק זאב", "יצחק פינדרוס"))  # extra word
        self.assertTrue(B.loose_match("סגלוביץ אבישי", "אבישי סגלוביץ'"))   # apostrophe
        self.assertFalse(B.loose_match("גנץ בני", "בניה גנצר"))          # THE trap
        self.assertFalse(B.loose_match("כהן", "אלי כהן"))                # one word — never

    def test_en_display_flips_comma(self):
        self.assertEqual(B.en_display("Netanyahu, Benjamin"), "Benjamin Netanyahu")
        self.assertEqual(B.en_display("Benny Gantz"), "Benny Gantz")

    def test_slugs(self):
        self.assertEqual(B.slug_he("בנימין נתניהו"), "בנימין-נתניהו")
        self.assertEqual(B.slug_en("Benjamin Netanyahu"), "benjamin-netanyahu")
        self.assertEqual(B.slug_he("אבישי סגלוביץ'"), "אבישי-סגלוביץ")   # no apostrophe in a URL


class RoleLogic(unittest.TestCase):
    def test_pm_is_exact(self):
        self.assertEqual(B.role_rank("ראש הממשלה"), 100)
        self.assertEqual(B.role_rank("ראש הממשלה החלופי"), 92)   # not the PM

    def test_en_dash_speaker_and_deputy(self):
        self.assertEqual(B.role_rank("יושב–ראש הכנסת"), 85)
        self.assertEqual(B.role_rank("סגן יושב–ראש הכנסת"), 35)  # tested BEFORE the speaker

    def test_bill_bucket(self):
        self.assertEqual(B.bill_bucket("התקבלה בקריאה השלישית"), "passed")
        self.assertEqual(B.bill_bucket("פורסמה ברשומות"), "passed")
        self.assertEqual(B.bill_bucket("נדחתה בקריאה הטרומית"), "rejected")
        self.assertEqual(B.bill_bucket("מוזגה עם הצעת חוק אחרת"), "process")

    def test_faction_short(self):
        self.assertEqual(B.faction_short("הליכוד בראשות בנימין נתניהו"), "הליכוד")
        self.assertEqual(B.faction_short(FACTIONS[2]["FactionName"]), 'ש"ס')

    def test_tidy_dedupes_and_stitches(self):
        rows = B.resolve_roles([dict(r) for r in POS_ALL if r["PersonID"] == 100], {})
        tidied = B.tidy_positions(rows)
        pm = [r for r in tidied if r["_role"] == "ראש הממשלה"]
        # 2 gendered duplicates → 1 open row; 2 split K23 rows → 1 stitched;
        # the K16 treasury row is another office entirely
        self.assertEqual(len(pm), 2)                       # K25 (open) + K23 (stitched)
        k23 = next(r for r in pm if r["KnessetNum"] == 23)
        self.assertEqual(B.year_of(k23["StartDate"]), 2020)
        self.assertEqual(B.year_of(k23["FinishDate"]), 2021)

    def test_gap_kept(self):
        a = {"_role": "שר", "KnessetNum": 20, "StartDate": "2015-01-01T00:00:00",
             "FinishDate": "2016-01-01T00:00:00"}
        b = {"_role": "שר", "KnessetNum": 20, "StartDate": "2016-06-01T00:00:00",
             "FinishDate": "2017-01-01T00:00:00"}
        self.assertEqual(len(B.tidy_positions([dict(a), dict(b)])), 2)

    def test_current_role_substance_only(self):
        rows = [{"_role": "חבר הכנסת", "FinishDate": None},
                {"_role": "חברת סיעה", "FinishDate": None, "FactionName": "x"}]
        self.assertEqual(B.current_role(rows), "")


class Paging(unittest.TestCase):
    def test_pages_capped_at_100(self):
        fake = FakeWorld()
        many = [dict(POS_ALL[0], PersonID=9000 + i) for i in range(250)]
        orig = fake.upstream
        def upstream(url):
            if "KNS_PersonToPosition()" in url and "PersonID eq 9" in fake.filter_of(url):
                return fake.od_page(url, many)
            return orig(url)
        fake.upstream = upstream
        relay = B.Relay("https://relay.test", fetch=fake.fetch)
        rows = relay.od_paged("KNS_PersonToPosition()?$filter=PersonID eq 9000&x=1")
        self.assertEqual(len(rows), 250)   # 3 pages, short page stops it

    def test_unfiltered_count_refused(self):
        relay = B.Relay("https://relay.test", fetch=FakeWorld().fetch)
        with self.assertRaises(ValueError):
            relay.count("KNS_BillInitiator()", "")


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.problems, cls.relay = build_world()
        cls.cards = cls.data["members"]

    def test_everyone_resolved(self):
        self.assertEqual(self.problems["unresolved"], [])
        self.assertEqual(len(self.cards), 7)
        self.assertEqual(self.data["knesset"], 25)

    def test_netanyahu_card(self):
        c = self.cards["771"]
        self.assertEqual(c["he"], "בנימין נתניהו")           # persons form, not cmb form
        self.assertEqual(c["en"], "Benjamin Netanyahu")       # comma flipped
        self.assertEqual(c["slugHe"], "בנימין-נתניהו")
        self.assertEqual(c["slugEn"], "benjamin-netanyahu")
        self.assertEqual(c["role"], "ראש הממשלה")
        self.assertEqual(c["faction"], "הליכוד")
        self.assertEqual(c["bills"], {"proposed": 31, "passed": 6})
        self.assertEqual(c["knessets"], [16, 24, 25])
        self.assertEqual(c["since"], 2003)
        self.assertIsNone(c["until"])
        self.assertTrue(c["current"])
        self.assertEqual(c["photo"], "771-abcd1234.jpg")
        # highlights: the open PM row first, no duplicate, the K23 stitch present
        self.assertEqual(c["positions"][0]["role"], "ראש הממשלה")
        self.assertTrue(c["positions"][0]["now"])
        pm_rows = [p for p in c["positions"] if p["role"] == "ראש הממשלה"]
        self.assertEqual(len(pm_rows), 2)

    def test_namesake_not_summed(self):
        c = self.cards["803"]                 # אלי כהן the sitting one
        self.assertEqual(c["pids"], [300])    # 301 (99 laws) excluded — K25 rows decide
        self.assertEqual(c["bills"], {"proposed": 20, "passed": 5})
        self.assertEqual(c["role"], "שר החוץ")

    def test_loose_and_extra_word_members(self):
        self.assertEqual(self.cards["802"]["pids"], [200])   # גנץ בני → בנימין גנץ
        self.assertEqual(self.cards["804"]["pids"], [400])   # extra word

    def test_snapshot_miss_fallback(self):
        c = self.cards["805"]                 # רות קלדרון — via KNS_Person
        self.assertEqual(c["pids"], [500])
        self.assertIsNone(c["photo"])         # no photo → null, never a guessed URL

    def test_speaker_en_dash(self):
        self.assertEqual(self.cards["806"]["role"], "יושב–ראש הכנסת")   # not the deputy row

    def test_leaver(self):
        c = self.cards["807"]                 # גפני: IsCurrent false, K25 row closed
        self.assertFalse(c["current"])
        self.assertEqual(c["until"], 2024)
        self.assertEqual(c["since"], 2021)
        # his old committee chairmanship is a highlight with years
        chair = next(p for p in c["positions"] if "ועדת הכספים" in p["role"])
        self.assertEqual((chair["y0"], chair["y1"], chair["now"]), (2021, 2022, False))

    def test_stats_yardstick(self):
        s = self.data["stats"]
        self.assertEqual(s["count"], 7)
        self.assertAlmostEqual(s["avgProposed"], round((31 + 12 + 20 + 7 + 3 + 15 + 40) / 7, 1))
        self.assertAlmostEqual(s["avgPassed"], round((6 + 2 + 5 + 0 + 1 + 4 + 9) / 7, 1))

    def test_statuses_fallback_to_odata(self):
        fake = FakeWorld()
        fake.bills_published = False          # /data/bills 404s → KNS_Status
        data, problems, _ = build_world(fake)
        self.assertEqual(data["members"]["771"]["bills"], {"proposed": 31, "passed": 6})


class Gates(unittest.TestCase):
    def test_small_world_needs_no_publish_flag(self):
        data, problems, _ = build_world()
        bad = B.gates(data, problems, partial=False)
        # 7 members < 120 — the fixture world itself must trip the size gate
        self.assertTrue(any("120" in b for b in bad))

    def test_limit_refuses_publish(self):
        data, problems, _ = build_world()
        self.assertTrue(any("slice" in b for b in B.gates(data, problems, partial=True)))

    def test_unresolved_blocks(self):
        data, problems, _ = build_world()
        problems["unresolved"] = ["מישהו עלום"]
        bad = B.gates(data, problems, partial=False)
        self.assertTrue(any("מישהו עלום" in b for b in bad))   # named IN FULL

    def test_missing_en_blocks(self):
        data, problems, _ = build_world()
        problems["missing_en"] = ["פלוני (999)"]
        self.assertTrue(any("English" in b for b in B.gates(data, problems, partial=False)))

    def test_bill_failures_over_threshold_block(self):
        data, problems, _ = build_world()
        problems["bill_failures"] = ["איש %d — timeout" % i for i in range(B.MAX_BILL_FAILURES + 1)]
        self.assertTrue(any("bill counts" in b for b in B.gates(data, problems, partial=False)))
        problems["bill_failures"] = ["איש 1 — timeout"]
        self.assertFalse(any("bill counts" in b for b in B.gates(data, problems, partial=False)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
