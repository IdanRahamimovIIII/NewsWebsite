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
  - since 2003: namesakes 20 years apart (K16 "כהן אלי" vs K25 "כהן אלי
    אליהו", the live spellings) decided by rows in THEIR OWN Knessets; a
    former MK whose register rows were left OPEN (not a minister today)
  - the eight live misses of the first run since 2003: hyphens ("בר-לב" /
    "בר לב"), parentheses ("משה (מוץ) מטלון"), a name split differently in
    KNS_Person ("עבד אלחכים" / "עבד אל חכים"), nicknames ("רפאל" / "רפי",
    "אבי" / "אברהם") — with עמיר פרץ sitting in the same Knesset as a trap
  - the bill lists: the same bill twice (lead row + ordinal row), an
    initiator row with no bill behind it, an unknown StatusID, >100 rows
    (paging), undecided bills of this Knesset vs an earlier one
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
    "800": "ישראל ישראלי",      # K17 only; the register left his rows open
    "900": "עמר בר לב",          # cmb "בר-לב עמר" (hyphen)
    "901": "משה (מוץ) מטלון",    # cmb "מטלון משה מוץ" (parentheses)
    "902": "רפי פרץ",            # cmb "פרץ רפאל" (nickname)
    "903": "עמיר פרץ",           # the trap: same surname, same Knesset
    "905": "אברהם וורצמן",       # cmb "וורצמן אבי" (nickname)
    # 904 "עבד אל חכים חאג' יחיא" exists ONLY in KNS_Person, split differently
}

KNS_PERSON = [       # what KNS_Person answers by LastName
    {"PersonID": 500, "FirstName": "רות", "LastName": "קלדרון"},
    {"PersonID": 904, "FirstName": "עבד אל חכים", "LastName": "חאג' יחיא"},
]

# cmb MKS rows: Id = MkId (stable), KnessetId, faction_id
MKS = [
    {"Id": 771, "Name": "נתניהו בנימין", "KnessetId": 25, "faction_id": 1},
    {"Id": 771, "Name": "נתניהו בנימין", "KnessetId": 24, "faction_id": 1},
    {"Id": 771, "Name": "נתניהו בנימין", "KnessetId": 16, "faction_id": 1},
    {"Id": 802, "Name": "גנץ בני", "KnessetId": 25, "faction_id": 2},
    {"Id": 803, "Name": "כהן אלי אליהו", "KnessetId": 25, "faction_id": 1},   # the live spelling
    {"Id": 804, "Name": "פינדרוס יצחק זאב", "KnessetId": 25, "faction_id": 3},
    {"Id": 805, "Name": "קלדרון רות", "KnessetId": 25, "faction_id": 2},
    {"Id": 806, "Name": "אוחנה אמיר", "KnessetId": 25, "faction_id": 1},
    {"Id": 807, "Name": "גפני משה", "KnessetId": 25, "faction_id": 3},
    {"Id": 807, "Name": "גפני משה", "KnessetId": 24, "faction_id": 3},
    {"Id": 810, "Name": "כהן אלי", "KnessetId": 16, "faction_id": 1},      # the OTHER אלי כהן
    {"Id": 811, "Name": "ישראלי ישראל", "KnessetId": 17, "faction_id": 2},
    {"Id": 866, "Name": "בר-לב עמר", "KnessetId": 20, "faction_id": 2},
    {"Id": 838, "Name": "מטלון משה מוץ", "KnessetId": 21, "faction_id": 2},
    {"Id": 1021, "Name": "פרץ רפאל", "KnessetId": 21, "faction_id": 2},
    {"Id": 923, "Name": "חאג' יחיא  עבד אלחכים", "KnessetId": 20, "faction_id": 2},   # the live double space
    {"Id": 870, "Name": "וורצמן אבי", "KnessetId": 20, "faction_id": 2},
]

FACTIONS = [
    {"ID": 1, "FactionName": "הליכוד בראשות בנימין נתניהו"},
    {"ID": 2, "FactionName": "המחנה הממלכתי"},
    {"ID": 3, "FactionName": "התאחדות הספרדים שומרי תורה תנועתו של מרן הרב עובדיה יוסף זצ\"ל"},
]

KNESSETS = [
    {"KnessetId": 16, "KnessetStart": "2003-02-17T00:00:00", "KnessetEnd": "2006-04-17T00:00:00"},
    {"KnessetId": 17, "KnessetStart": "2006-04-17T00:00:00", "KnessetEnd": "2009-03-31T00:00:00"},
    {"KnessetId": 20, "KnessetStart": "2015-03-31T00:00:00", "KnessetEnd": "2019-04-30T00:00:00"},
    {"KnessetId": 21, "KnessetStart": "2019-04-30T00:00:00", "KnessetEnd": "2019-10-03T00:00:00"},
    {"KnessetId": 24, "KnessetStart": "2021-04-06T00:00:00", "KnessetEnd": "2022-11-15T00:00:00"},
    {"KnessetId": 25, "KnessetStart": "2022-11-15T00:00:00", "KnessetEnd": None},
]

DROP_HE = [
    {"ID": 771, "Name": "נתניהו בנימין", "IsCurrent": True},
    {"ID": 802, "Name": "גנץ בני", "IsCurrent": True},
    {"ID": 803, "Name": "כהן אלי אליהו", "IsCurrent": True},
    {"ID": 804, "Name": "פינדרוס יצחק זאב", "IsCurrent": True},
    {"ID": 805, "Name": "קלדרון רות", "IsCurrent": True},
    {"ID": 806, "Name": "אוחנה אמיר", "IsCurrent": True},
    {"ID": 807, "Name": "גפני משה", "IsCurrent": False},   # left mid-Knesset
    {"ID": 810, "Name": "כהן אלי", "IsCurrent": False},
    {"ID": 811, "Name": "ישראלי ישראל", "IsCurrent": False},
    {"ID": 866, "Name": "בר-לב עמר", "IsCurrent": False},
    {"ID": 838, "Name": "מטלון משה מוץ", "IsCurrent": False},
    {"ID": 1021, "Name": "פרץ רפאל", "IsCurrent": False},
    {"ID": 923, "Name": "חאג' יחיא  עבד אלחכים", "IsCurrent": False},
    {"ID": 870, "Name": "וורצמן אבי", "IsCurrent": False},
]

DROP_EN = [
    {"ID": 771, "Name": "Netanyahu, Benjamin", "IsCurrent": True},   # comma form — must flip
    {"ID": 802, "Name": "Benny Gantz", "IsCurrent": True},
    {"ID": 803, "Name": "Eli Cohen", "IsCurrent": True},
    {"ID": 804, "Name": "Yitzhak Pindrus", "IsCurrent": True},
    {"ID": 805, "Name": "Ruth Calderon", "IsCurrent": True},
    {"ID": 806, "Name": "Amir Ohana", "IsCurrent": True},
    {"ID": 807, "Name": "Moshe Gafni", "IsCurrent": False},
    {"ID": 810, "Name": "Eli Cohen", "IsCurrent": False},
    {"ID": 811, "Name": "Israel Israeli", "IsCurrent": False},
    {"ID": 866, "Name": "Omer Bar-Lev", "IsCurrent": False},
    {"ID": 838, "Name": "Moshe Mutz Matalon", "IsCurrent": False},
    {"ID": 1021, "Name": "Rafael Peretz", "IsCurrent": False},
    {"ID": 923, "Name": "Abd al-Hakim Hajj Yahya", "IsCurrent": False},
    {"ID": 870, "Name": "Avi Wortzman", "IsCurrent": False},
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
    # the other אלי כהן: K16 only
    {"PersonID": 301, "PositionID": 43, "KnessetNum": 16, "StartDate": "2003-02-17T00:00:00",
     "FinishDate": "2006-04-17T00:00:00", "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": False},
    # K17 only — and the register never closed his rows (the live dirt)
    {"PersonID": 800, "PositionID": 43, "KnessetNum": 17, "StartDate": "2006-04-17T00:00:00",
     "FinishDate": None, "GovMinistryName": None, "DutyDesc": "חבר הכנסת",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
    {"PersonID": 800, "PositionID": 40, "KnessetNum": 17, "StartDate": "2007-01-01T00:00:00",
     "FinishDate": None, "GovMinistryName": "משרד התיירות", "DutyDesc": "שר התיירות",
     "CommitteeName": None, "FactionName": None, "IsCurrent": True},
] + [   # one closed membership row each, in the Knesset they sat in
    {"PersonID": pid, "PositionID": 43, "KnessetNum": k, "StartDate": start, "FinishDate": end,
     "GovMinistryName": None, "DutyDesc": "חבר הכנסת", "CommitteeName": None,
     "FactionName": None, "IsCurrent": False}
    for pid, k, start, end in [
        (900, 20, "2015-03-31T00:00:00", "2019-04-30T00:00:00"),
        (901, 21, "2019-04-30T00:00:00", "2019-10-03T00:00:00"),
        (902, 21, "2019-04-30T00:00:00", "2019-10-03T00:00:00"),
        (903, 21, "2019-04-30T00:00:00", "2019-10-03T00:00:00"),   # עמיר פרץ, same Knesset
        (904, 20, "2015-03-31T00:00:00", "2019-04-30T00:00:00"),
        (905, 20, "2015-03-31T00:00:00", "2019-04-30T00:00:00"),
    ]
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
         400: (7, 0), 500: (3, 1), 600: (15, 4), 700: (40, 9), 800: (130, 1)}


def bill_initiator_rows(pid):
    """KNS_BillInitiator rows with $expand=KNS_Bill, as the live service
    answers — distinct bills = BILLS[pid], plus the dirt that must not count"""
    proposed, passed = BILLS.get(pid, (0, 0))
    rows = []
    for i in range(proposed):
        status = 118 if i < passed else (108 if i % 3 == 0 else 150 if i % 3 == 1 else 999)   # 999: unknown
        rows.append({"BillID": pid * 10000 + i, "KNS_Bill": {
            "Name": "הצעת חוק %d-%d" % (pid, i), "StatusID": status,
            "KnessetNum": 25 if i % 2 == 0 else 20,
            "LastUpdatedDate": "2024-01-%02dT00:00:00" % (1 + i % 28)}})
    if rows:
        rows.append(dict(rows[0]))           # the same bill again (lead row + ordinal row)
        rows.append({"BillID": pid * 10000 + 9999, "KNS_Bill": None})   # an initiator row, no bill
    return rows

PHOTOS = {"771": "771-abcd1234.jpg", "802": "802-ef567890.jpg", "803": "803-11112222.jpg",
          "804": "804-33334444.jpg", "806": "806-55556666.jpg", "807": "807-77778888.jpg"}
# 805 (קלדרון) has NO photo — the card must say null, never a guessed URL


# =====================================================================
# the fake relay: understands exactly the requests the collector may make,
# refuses what the live service refuses
# =====================================================================
# GetMkDetailsContent, as the live service answers (measured): entities
# ("&#x0D;"), bullets, \r\n, a Hebrew date before the Gregorian one, a
# leading space, "…, ישראל"; a member who died (no residence then); an
# unknown id answers JSON null; everyone else: the fields, all empty
BIO_EMPTY = {k: None for k in ("DateOfBirth", "DeathDate", "PlaceOfBirth", "ImmigrationYear", "Residence",
             "Education", "MilitaryService", "NationalService", "profession", "Languages", "ProfessionsDetails")}
BIO = {
    771: dict(BIO_EMPTY, DateOfBirth='כ"ח בתשרי תש"י , 21/10/1949', PlaceOfBirth="תל-אביב, ישראל",
              ImmigrationYear="", Residence="ירושלים",
              Education="- תואר ראשון בארכיטקטורה&#x0D;\n- תואר שני במינהל עסקים&#x0D;\n",
              MilitaryService="- שירת בסיירת מטכ”ל\r\n- לאחר מלחמת יום הכיפורים, דרגתו הועלתה לסרן",
              NationalService="", Languages=" אנגלית, צרפתית", ProfessionsDetails=" ניהול"),
    811: dict(BIO_EMPTY, DateOfBirth='כ"ג באייר תרפ"ט , 02/06/1929', DeathDate="י\"ב באדר ב' תשע\"ט , 19/03/2019",
              PlaceOfBirth="אוסטריה", ImmigrationYear="1936", Residence="חיפה", Education="&lt;b&gt;משפטים&lt;/b&gt;"),
    810: None,
}


class FakeWorld:
    def __init__(self):
        self.persons_published = True
        self.bills_published = True
        self.bills_fail = set()
        self.bio_fail = set()

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
        if "GetMkDetailsContent" in url:
            mk = int(re.search(r"mkId=(\d+)", url).group(1))
            if mk in self.bio_fail:
                raise RuntimeError("HTTP 500 from upstream — details of %d" % mk)
            return json.dumps(BIO.get(mk, dict(BIO_EMPTY, ID=mk)), ensure_ascii=False).encode("utf-8")
        if "GetMksDropdown" in url:
            lang = "en" if "languageKey=en" in url else "he"
            return json.dumps(DROP_EN if lang == "en" else DROP_HE, ensure_ascii=False).encode("utf-8")
        if "GetVotesCmbData" in url:
            return json.dumps({"MKS": MKS, "Factions": FACTIONS, "Knessets": KNESSETS},
                              ensure_ascii=False).encode("utf-8")
        if "/$count" in url:
            return self.count(url)
        if "KNS_BillInitiator()" in url:
            pid = int(re.search(r"PersonID eq (\d+)", self.filter_of(url)).group(1))
            if pid in self.bills_fail:
                raise RuntimeError("HTTP 500 from upstream — bills of %d" % pid)
            return self.od_page(url, bill_initiator_rows(pid))
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
            m = re.search(r"LastName eq '((?:[^']|'')*)'", flt)
            last = m.group(1).replace("''", "'") if m else None
            return self.od_page(url, [r for r in KNS_PERSON if r["LastName"] == last])
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
    relay.world = world                    # the bill lists ride here (published per MK)
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

    def test_dates_before_1970(self):
        # a 1960s career start arrives as a NEGATIVE /Date(ms)/ — Windows'
        # fromtimestamp refuses those (the first run since 2003 died on it)
        self.assertEqual(B.year_of("/Date(-157766400000)/"), 1965)
        self.assertEqual(B.year_of("/Date(1672531200000+0200)/"), 2023)
        self.assertEqual(B.year_of("1969-12-31T00:00:00"), 1969)

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
        self.assertEqual(len(self.cards), 14)         # everyone since 2003, not just K25
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

    def test_namesakes_twenty_years_apart(self):
        old = self.cards["810"]                         # "כהן אלי", K16 only
        self.assertEqual(old["pids"], [301])            # HIS rows are in K16
        self.assertEqual(old["bills"], {"proposed": 99, "passed": 99})
        self.assertEqual((old["knessets"], old["since"], old["until"]), ([16], 2003, 2006))
        self.assertFalse(old["current"])
        self.assertEqual(self.cards["803"]["pids"], [300])   # the K25 one keeps his own
        self.assertEqual(self.problems["shared"], [])

    def test_second_pass_spellings(self):
        pids = {k: self.cards[k]["pids"] for k in ("866", "838", "923", "1021", "870")}
        self.assertEqual(pids, {"866": [900], "838": [901], "923": [904],
                                "1021": [902], "870": [905]})   # רפאל → רפי, never עמיר

    def test_nickname_is_refused_when_ambiguous(self):
        global PERSONS, POS_ALL
        keep_p, keep_a = PERSONS, POS_ALL
        PERSONS = dict(PERSONS, **{"906": "אברמי וורצמן"})    # a second "אב…" וורצמן, same Knesset
        POS_ALL = POS_ALL + [dict(POS_ALL[-1], PersonID=906)]
        try:
            data, problems, _ = build_world()
        finally:
            PERSONS, POS_ALL = keep_p, keep_a
        self.assertIn("וורצמן אבי", problems["unresolved"])      # no guess — the gate stops it

    def test_bill_lists(self):
        lists = self.relay.world["bill_lists"]
        rows = lists[771]
        self.assertEqual(len(rows), 31)                          # deduped, the no-bill row dropped
        self.assertEqual(self.cards["771"]["bills"], {"proposed": 31, "passed": 6})   # counts FROM the list
        self.assertEqual(sum(r["b"] == "passed" for r in rows), 6)
        self.assertTrue(all(set(r) == {"n", "s", "k", "b"} for r in rows))
        piles = {r["b"] for r in rows}
        self.assertLessEqual(piles, {"passed", "rejected", "pending", "undecided"})
        self.assertTrue(all(r["b"] == "pending" for r in rows if r["b"] in ("pending", "undecided") and r["k"] == 25))
        self.assertTrue(all(r["b"] == "undecided" for r in rows if r["b"] in ("pending", "undecided") and r["k"] == 20))
        self.assertTrue(any(r["s"] == "" for r in rows))         # unknown StatusID: no invented text
        self.assertEqual(len(lists[811]), 130)                   # paged past 100
        self.assertEqual(lists[870], [])                         # no bills: an empty list, not a missing one

    def test_background(self):
        self.assertEqual(self.cards["771"]["bio"], [
            ["factBorn", "1949 · תל-אביב"], ["factHome", "ירושלים"],
            ["factEdu", "תואר ראשון בארכיטקטורה, תואר שני במינהל עסקים"],
            ["factArmy", "שירת בסיירת מטכ”ל, לאחר מלחמת יום הכיפורים, דרגתו הועלתה לסרן"],
            ["factProf", "ניהול"], ["factLangs", "אנגלית, צרפתית"]])
        # died: the death year, the aliyah, no "lives in"; entities decoded to TEXT (escaped later)
        self.assertEqual(self.cards["811"]["bio"], [
            ["factBorn", "1929 · אוסטריה"], ["factDied", "2019"], ["factAliyah", "1936"], ["factEdu", "<b>משפטים</b>"]])
        self.assertEqual(self.cards["810"]["bio"], [])            # null answer → nothing to show
        self.assertEqual(self.cards["802"]["bio"], [])            # all fields empty
        self.assertEqual(self.problems["bio_failures"], [])

    def test_background_failure_is_unknown_not_empty(self):
        fake = FakeWorld()
        fake.bio_fail = {802}
        data, problems, _ = build_world(fake)
        self.assertIsNone(data["members"]["802"]["bio"])         # None = the page loads it live
        self.assertTrue(any("גנץ" in f for f in problems["bio_failures"]))
        problems["bio_failures"] = ["איש %d — timeout" % i for i in range(B.MAX_BIO_FAILURES + 1)]
        self.assertTrue(any("background" in b for b in B.gates(data, problems, partial=False)))

    def test_bill_list_failure_is_all_or_nothing(self):
        fake = FakeWorld()
        fake.bills_fail = {300}                                  # the K25 אלי כהן
        data, problems, relay = build_world(fake)
        self.assertIsNone(data["members"]["803"]["bills"])
        self.assertNotIn(803, relay.world["bill_lists"])         # no half list either
        self.assertTrue(any("כהן אלי אליהו" in f for f in problems["bill_failures"]))

    def test_open_rows_of_someone_long_gone(self):
        c = self.cards["811"]                           # K17 only, register rows never closed
        self.assertFalse(c["current"])
        self.assertEqual(c["role"], "")                 # not "שר התיירות" today
        self.assertTrue(c["positions"] and not any(p["now"] for p in c["positions"]))
        self.assertEqual((c["since"], c["until"]), (2006, 2009))   # until = his Knesset's end

    def test_stats_yardstick(self):
        s = self.data["stats"]
        self.assertEqual(s["count"], 7)                 # the current Knesset's yardstick
        self.assertEqual(s["all"], 14)
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

    def test_shared_person_blocks(self):
        # the old אלי כהן loses his K16 row → both namesakes fall back to the
        # same two PersonIDs → merged people must never publish
        fake = FakeWorld()
        global POS_ALL
        keep = POS_ALL
        POS_ALL = [r for r in POS_ALL if not (r["PersonID"] == 301 and r["KnessetNum"] == 16)]
        try:
            data, problems, _ = build_world(fake)
        finally:
            POS_ALL = keep
        self.assertTrue(problems["shared"])
        bad = B.gates(data, problems, partial=False)
        self.assertTrue(any("PersonID" in b and "כהן אלי" in b for b in bad))   # named in full

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
