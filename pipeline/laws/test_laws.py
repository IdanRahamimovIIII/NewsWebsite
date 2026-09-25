#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for build_laws.py — run from pipeline\\:  python3 laws/test_laws.py

No network, no Cloudflare: a fake relay serves a tiny world that ARMS EVERY
TRAP the live data has (a fixture more generous than the source is a rubber
stamp):
  - pages capped at 100 rows whatever $top says (the laws span 3 pages)
  - the 2026 budget law NOT flagged IsBudgetLaw (the name must catch it)
  - a law repealed by another law's original bill (the "replaced by" link)
  - a committee item whose session id is in range but whose session is
    OUTSIDE the window (ids are not in date order)
  - a finished bill matched by status TEXT (garbled ids are no contract)
  - identical bills filed separately (years differ, both alive) → one entry
    with both lead sponsors; a bare "(תיקון)" name that must NOT fold
  - budget-package pieces "פרק … מתוך הצעת חוק …" → under their parent
  - "(תיקוני חקיקה)" in a NEW law's name is not an amendment
  - a court.csv row pointing at a law the Knesset doesn't have → refused
"""
import json, re, sys, unittest, urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_laws as B
import build_mkcards as M

M.PAUSE = 0

TODAY = date(2026, 9, 25)

LAWS = [{"IsraelLawID": 2000000 + i, "Name": "חוק מספר %d, התש\"ן-1990" % i, "IsBasicLaw": False,
         "IsBudgetLaw": False, "LawValidityDesc": "תקף", "PublicationDate": "1990-01-01T00:00:00",
         "LatestPublicationDate": "1990-01-01T00:00:00", "ValidityStartDate": None,
         "ValidityFinishDate": None} for i in range(1, 231)]
LAWS[0].update(Name="תקציב המדינה לשנת הכספים 2026", IsBudgetLaw=False)            # the flag lies
LAWS[1].update(Name="חוק המרשם הפלילי ותקנת השבים, התשמ\"א-1981", LawValidityDesc="בטל")
LAWS[2].update(Name="חוק המידע הפלילי ותקנת השבים, התשע\"ט-2019")
LAWS[3].update(Name="חוק שירות אזרחי (הוראת שעה), התשפ\"ה-2025", ValidityFinishDate="2026-11-01T00:00:00")

WORLD = {
    "KNS_KnessetDates": [{"KnessetNum": 25, "PlenumStart": "2022-11-15T00:00:00", "IsCurrent": True},
                         {"KnessetNum": 26, "PlenumStart": "2026-11-10T00:00:00", "IsCurrent": False}],
    "KNS_IsraelLaw": LAWS,
    "KNS_IsraelLawClassificiation": [{"IsraelLawID": 2000003, "ClassificiationID": 9, "ClassificiationDesc": "משפט פלילי"}],
    "KNS_LawBinding": [
        {"LawID": 500, "IsraelLawID": 2000002, "LawTypeID": 2, "BindingTypeDesc": "החוק המקורי", "AmendmentTypeDesc": "ישיר"},
        {"LawID": 900, "IsraelLawID": 2000003, "LawTypeID": 2, "BindingTypeDesc": "החוק המקורי", "AmendmentTypeDesc": "ישיר"},
        {"LawID": 900, "IsraelLawID": 2000002, "LawTypeID": 2, "BindingTypeDesc": "מבטל", "AmendmentTypeDesc": "עקיף"},
        {"LawID": 901, "IsraelLawID": 2000003, "LawTypeID": 2, "BindingTypeDesc": "מתקן", "AmendmentTypeDesc": "ישיר"},
        {"LawID": 902, "IsraelLawID": 2000003, "LawTypeID": 2, "BindingTypeDesc": "מתקן", "AmendmentTypeDesc": "עקיף"},
    ],
    "KNS_CommitteeSession": [
        {"CommitteeSessionID": 100, "StartDate": "2026-09-16T10:00:00", "CommitteeID": 7},
        {"CommitteeSessionID": 102, "StartDate": "2026-07-20T10:00:00", "CommitteeID": 7},
    ],
    "KNS_CmtSessionItem": [
        {"ItemID": 11, "CommitteeSessionID": 100},    # alive
        {"ItemID": 12, "CommitteeSessionID": 102},    # finished — status text says so
        {"ItemID": 13, "CommitteeSessionID": 101},    # session 101 is OUTSIDE the window
        {"ItemID": 14, "CommitteeSessionID": 102},    # twin A
        {"ItemID": 15, "CommitteeSessionID": 100},    # twin B (other year)
        {"ItemID": 16, "CommitteeSessionID": 100},    # bare "(תיקון)" — must not fold with 17
        {"ItemID": 17, "CommitteeSessionID": 100},
        {"ItemID": 18, "CommitteeSessionID": 102},    # budget piece
        {"ItemID": 19, "CommitteeSessionID": 100},    # budget piece
        {"ItemID": 20, "CommitteeSessionID": 100},    # a new Basic Law "(תיקוני חקיקה)"
    ],
    "KNS_Bill": [
        {"BillID": 11, "Name": "הצעת חוק העונשין (תיקון - משהו), התשפ\"ו-2026", "SubTypeDesc": "פרטית", "StatusID": 108, "CommitteeID": 7},
        {"BillID": 12, "Name": "הצעת חוק שעברה, התשפ\"ו-2026", "SubTypeDesc": "ממשלתית", "StatusID": 118, "CommitteeID": 7},
        {"BillID": 13, "Name": "הצעת חוק ישנה, התשפ\"ה-2025", "SubTypeDesc": "פרטית", "StatusID": 108, "CommitteeID": 7},
        {"BillID": 14, "Name": "הצעת חוק-יסוד: כניסה והגירה, התשפ\"ה-2025", "SubTypeDesc": "פרטית", "StatusID": 108, "CommitteeID": 7},
        {"BillID": 15, "Name": "הצעת חוק-יסוד: כניסה והגירה, התשפ\"ו-2026", "SubTypeDesc": "פרטית", "StatusID": 108, "CommitteeID": 7},
        {"BillID": 16, "Name": "הצעת חוק החברות (תיקון)", "SubTypeDesc": "פרטית", "StatusID": 108, "CommitteeID": 7},
        {"BillID": 17, "Name": "הצעת חוק החברות (תיקון)", "SubTypeDesc": "פרטית", "StatusID": 108, "CommitteeID": 7},
        {"BillID": 18, "Name": "פרק ג' (מס רכוש) מתוך הצעת חוק ההתייעלות הכלכלית (תיקוני חקיקה), התשפ\"ו-2026", "SubTypeDesc": "ממשלתית", "StatusID": 113, "CommitteeID": 7},
        {"BillID": 19, "Name": "פרק ד' (שדות תעופה) מתוך הצעת חוק ההתייעלות הכלכלית (תיקוני חקיקה), התשפ\"ו-2026", "SubTypeDesc": "ממשלתית", "StatusID": 113, "CommitteeID": 7},
        {"BillID": 20, "Name": "הצעת חוק-יסוד: סמכות חקירה (תיקוני חקיקה)", "SubTypeDesc": "ועדה", "StatusID": 113, "CommitteeID": 7},
        {"BillID": 21, "Name": "הצעת חוק-יסוד: כניסה והגירה, התשפ\"ג-2023", "SubTypeDesc": "פרטית", "StatusID": 104, "CommitteeID": 7},  # a parked copy
    ],
    "KNS_BillUnion": [],
    # the garbled flavour: ids are not a contract, the text is
    "KNS_Status": [{"StatusID": 108, "Desc": "הכנה לקריאה ראשונה"}, {"StatusID": 113, "Desc": "הכנה לקריאה שנייה ושלישית"},
                   {"StatusID": 118, "Desc": "התקבלה בקריאה שלישית"}, {"StatusID": 104, "Desc": "הונחה על שולחן הכנסת לדיון מוקדם"}],
    "KNS_Committee": [{"CommitteeID": 7, "Name": "ועדת החוקה"}],
}
INITIATORS = {14: [{"PersonID": 1, "IsInitiator": True, "Ordinal": 1}],
              15: [{"PersonID": 2, "IsInitiator": True, "Ordinal": 1}],
              11: [{"PersonID": 1, "IsInitiator": True, "Ordinal": 1}]}
PERSONS = {"1": "שמחה רוטמן", "2": "צביקה פוגל"}


def fake_fetch(url):
    if url.endswith("/data/persons"):
        return json.dumps({"t": 1, "data": PERSONS}).encode()
    up = urllib.parse.unquote(url.split("/?url=", 1)[1])
    ent = re.search(r"ParliamentInfo\.svc/(\w+)\(\)", up).group(1)
    if ent == "KNS_BillInitiator":
        bid = int(re.search(r"BillID eq (\d+)", up).group(1))
        return json.dumps({"value": INITIATORS.get(bid, [])}).encode()
    rows = WORLD[ent]
    skip = int((re.search(r"\$skip=(\d+)", up) or [0, 0])[1])
    return json.dumps({"value": rows[skip:skip + 100]}).encode()   # the 100-row cap


class Laws(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        relay = M.Relay("https://relay.example", fetch=fake_fetch)
        cls.w = B.collect(relay, today=TODAY)
        cls.court = [{"law_id": "2000003", "kind": "partial", "case": "בג\"ץ 1/20", "date": "2020-01-01",
                      "what": "ביטול סעיף", "url": "https://x", "source": "wikisource", "panel": "",
                      "dissent": "", "checked": ""}]
        cls.data, cls.problems = B.build(cls.w, cls.court)
        cls.bills = {b["i"]: b for b in cls.data["bills"]}

    def test_paging_reads_every_law(self):
        self.assertEqual(len(self.data["laws"]), 230)

    def test_budget_by_name_when_the_flag_lies(self):
        law = next(l for l in self.data["laws"] if l["i"] == 2000001)
        self.assertIn("u", law["f"])

    def test_temporary_flag(self):
        law = next(l for l in self.data["laws"] if l["i"] == 2000004)
        self.assertIn("t", law["f"])
        self.assertEqual(law["e"], "2026-11-01")

    def test_replaced_by(self):
        old = next(l for l in self.data["laws"] if l["i"] == 2000002)
        self.assertEqual(old["r"], 2000003)

    def test_amendment_counts(self):
        law = next(l for l in self.data["laws"] if l["i"] == 2000003)
        self.assertEqual((law["a"], law["ad"]), (2, 1))

    def test_next_knesset(self):
        self.assertEqual((self.data["knesset"], self.data["nextStart"]), (25, "2026-11-10"))

    def test_window_and_status_text(self):
        self.assertIn(11, self.bills)
        self.assertNotIn(12, self.bills)       # passed
        self.assertNotIn(13, self.bills)       # its session is outside the window

    def test_twins_fold_with_both_sponsors(self):
        rep = [b for b in self.data["bills"] if "כניסה והגירה" in b["n"]]
        self.assertEqual(len(rep), 1)
        self.assertEqual(sorted(rep[0]["by"]), sorted(["שמחה רוטמן", "צביקה פוגל"]))
        self.assertEqual(sorted(rep[0]["twins"] + [rep[0]["i"]]), [14, 15, 21])

    def test_bare_amendment_names_do_not_fold(self):
        self.assertIn(16, self.bills)
        self.assertIn(17, self.bills)

    def test_budget_pieces_fold_under_parent(self):
        g = [b for b in self.data["bills"] if b.get("pieces")]
        self.assertEqual(len(g), 1)
        self.assertEqual(len(g[0]["pieces"]), 2)
        self.assertTrue(g[0]["n"].startswith("הצעת חוק ההתייעלות"))

    def test_amends_vs_new(self):
        self.assertTrue(self.bills[11]["am"])
        self.assertFalse(self.bills[20]["am"])

    def test_court_row_for_unknown_law_is_refused(self):
        _, problems = B.build(self.w, self.court + [dict(self.court[0], law_id="2999999")])
        self.assertTrue(any("2999999" in p for p in problems))
        self.assertFalse(self.problems)

    def test_gates_refuse_a_short_list(self):
        bad = B.gates(self.data, self.problems, self.w)
        self.assertTrue(any("only 230 laws" in b for b in bad))

    def test_the_real_court_list_is_well_formed(self):
        rows = B.read_court()
        self.assertGreaterEqual(len(rows), 20)
        for r in rows:
            self.assertIn(r["kind"], ("void", "partial", "frozen", "deferred"), r["case"])
            self.assertRegex(r["date"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertTrue(r["url"].startswith("https://supremedecisions.court.gov.il/"), r["case"])
            self.assertTrue(r["url"].endswith("type=4"), r["case"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
