#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""Build the /data/mkcards snapshot — one card of baked facts per MK since
2003 (every person in the votes directory, Knessets 16 → today).

This is phase 1 of the entity-pages plan (claude/entity-pages-plan.md):
the pages Worker will render /mk/<id>-<name>/ from THIS snapshot, and the
MK page's directory can read the same counts for free. Per member:
ids, names he/en, URL slugs, photo file, current role, faction, tenure,
Knessets served, bill counts (proposed/passed), top positions — plus K25
averages as the "6 of 31" yardstick.

Sources (all through the relay, the proven route to knesset.gov.il):
  MKs/GetMksDropdown he+en · Votes/GetVotesCmbData · /data/persons ·
  /data/mkphotos · /data/bills (statuses; else KNS_Status) ·
  KNS_PersonToPosition (K25 bulk + per-person history) ·
  KNS_BillInitiator/$count (always filtered — the WAF 473s lambdas, and
  the service refuses unfiltered counts).

The name logic is the MK page's, ported verbatim (two id spaces, the
bridge is the name): nameKey word-order-blind, looseMatch for the six K25
spellings, namesakes decided by rows in THIS Knesset, KNS_Person fallback
both word orders. billBucket / roleRank / tidyPositions ported the same.
A drift here = the card disagrees with the live page — test_mkcards.py
pins each rule.

Publish: KV pub:mkcards (relay envelope) → served as /data/mkcards by the
relay automatically (any pub:<name>), no worker change. Read back byte for
byte + checked at the public relay, like every publisher (cf_kv rules).

Never a partial list as complete (Mercy): the run REFUSES to publish when
a member is unresolved, an English name is missing, or bill counts failed
for more than a handful — it prints the full list of who, and exits red.

Zero-install: standard library only.
  --no-publish   build out\mkcards.json only (no credentials needed)
  --limit N      quick dev run on N members — publishing is refused
"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent            # pipeline\mkcards\
sys.path.insert(0, str(HERE.parent / "shared"))
import cf_kv  # noqa: E402

OUT = HERE / "out"
KAPI = "https://knesset.gov.il/WebSiteApi/knessetapi/"
PARL = "https://knesset.gov.il/Odata/ParliamentInfo.svc/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
PAUSE = 0.2          # politeness between relay calls — somebody else's server
KEY = "pub:mkcards"
MAX_BILL_FAILURES = 5   # more members without counts than this = a broken run, not a snapshot


def log(*a):
    print(*a, flush=True)


# =====================================================================
# name + role + bill logic — PORTED FROM site\mk\mk.data.js. The page and
# the snapshot must agree; change one → change both (and the tests).
# =====================================================================

def name_key(s):
    """name → stable key: the words, sorted ("לפיד יאיר" meets "יאיר לפיד")"""
    return " ".join(sorted(w for w in str(s or "").split() if w))


_PLAIN = re.compile("['\"׳״]")


_PUNCT = re.compile("[\"'`\u05f3\u05f4\u201c\u201d\u2018\u2019()\\[\\]]")


def norm_name(s):
    """the second pass (the page's first pass missed): hyphens are spaces,
    parentheses and every kind of quote go — "בר-לב" = "בר לב", "משה (מוץ)
    מטלון" = "משה מוץ מטלון", "כ”ץ" = "כ"ץ" = "כץ" """
    s = re.sub("[-\u05be\u2013\u2014]", " ", str(s or ""))
    return re.sub(r"\s+", " ", _PUNCT.sub("", s)).strip()


def nickname_match(cmb_name, person_name):
    """"פרץ רפאל" ~ "רפי פרץ", "וורצמן אבי" ~ "אברהם וורצמן": two words each,
    the surname identical, the first names share their first two letters.
    A CANDIDATE only — build() accepts it when exactly one such person has
    rows in this member's own Knessets"""
    a, b = norm_name(cmb_name).split(), norm_name(person_name).split()
    if len(a) != 2 or len(b) != 2:
        return False
    same = set(a) & set(b)
    if len(same) != 1:
        return False
    x, y = [w for w in a if w not in same][0], [w for w in b if w not in same][0]
    return x != y and x[:2] == y[:2]


def _words(s):
    return [w for w in _PLAIN.sub("", str(s or "")).split() if w]


def _prefix_fits(a, b):
    return len(a) >= 3 and len(b) >= 3 and (b.startswith(a) or a.startswith(b))


def loose_match(cmb_name, person_name):
    """quotes ignored; every word of the SHORTER name found in the longer,
    each used once, at least one exact (3+ letters may prefix-match:
    בני ~ בנימין — but "בניה גנצר" must NOT ride on "גנץ בני")."""
    a, b = _words(cmb_name), _words(person_name)
    short, long_ = (a, list(b)) if len(a) <= len(b) else (b, list(a))
    if len(short) < 2:
        return False
    exact = 0
    for w in short:
        if w in long_:
            long_.remove(w)
            exact += 1
            continue
        hit = next((x for x in long_ if _prefix_fits(w, x)), None)
        if hit is None:
            return False
        long_.remove(hit)
    return exact >= 1


def role_rank(role):
    """how heavy a role is; wording from the register (יושב–ראש may carry an
    en dash). Order matters: deputy speaker is tested BEFORE speaker."""
    s = str(role or "").strip()
    if s == "ראש הממשלה":
        return 100                     # exact — החלופי is not the PM
    if re.search(r"ראש הממשלה החלופי", s):
        return 92
    if re.search(r"ממלא מקום ראש הממשלה|סגן ראש הממשלה", s):
        return 90
    if re.search(r"סגן.{0,6}יושב[-–\s]?ראש הכנסת", s):
        return 35
    if re.search(r"יושב(ת)?[-–\s]?ראש הכנסת", s):
        return 85
    if re.search(r"ראש האופוזיציה", s):
        return 75
    if re.search(r'^סגנ(ית)?\s*שר|^סגן שר', s):
        return 60
    if re.search(r'ממלא מקום שר|מ"מ שר', s):
        return 58
    if re.search(r"^שר", s):
        return 80
    if re.search(r'יושב(ת)?[-–\s]?ראש\s*ועד|יו"ר\s*ועד', s):
        return 50
    if re.search(r'יושב(ת)?[-–\s]?ראש\s*סיע|יו"ר\s*סיע', s):
        return 40
    if re.search(r"חבר(ת)?\s*ועד", s):
        return 10
    return 5


def plain_role(r):
    """faction membership and the bare "חבר הכנסת" row are not substance"""
    role = str(r.get("_role") or "").strip()
    return bool(re.search(r"סיע", role) or re.fullmatch(r"חבר(ת)?\s*(ה)?כנסת", role))


def pos_ctx(r):
    """generic roles earn their context; a named role speaks for itself"""
    role = r.get("_role") or ""
    if re.search(r"ועד", role) and r.get("CommitteeName"):
        return "%s · %s" % (role, r["CommitteeName"])
    if re.search(r"סיע", role) and r.get("FactionName"):
        return "%s · %s" % (role, r["FactionName"])
    return role


def bill_bucket(desc):
    """which pile a bill-status text belongs to — the page's exact rule"""
    s = str(desc or "")
    if re.search(r"התקבלה|פורסמ.*רשומות", s):
        return "passed"
    if re.search(r"נדח|הסרה|הוסר|נעצר|בוטל|מבוטל|נסגר", s):
        return "rejected"
    return "process"


def faction_short(name):
    """official faction string fit for a card: "בראשות …" dropped, Shas by
    the name everyone uses (its registered name is 14 words long)"""
    s = str(name or "").strip()
    if not s:
        return ""
    if re.search(r"התאחדות הספרדים", s):
        return 'ש"ס'
    return re.sub(r"\s*[-–]?\s*בראשות\s.*$", "", s).strip()


_MS = re.compile(r"/Date\((\-?\d+)")
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def date_ms(v):
    """OData date (ISO or /Date(ms)/) → epoch ms, or None"""
    s = str(v or "")
    m = _MS.search(s)
    if m:
        return int(m.group(1))
    m = _ISO.match(s)
    if not m:
        return None
    import calendar
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return calendar.timegm((y, mo, d, 0, 0, 0)) * 1000
    except Exception:
        return None


def year_of(v):
    ms = date_ms(v)
    if ms is None:
        return None
    import datetime
    # epoch + delta, not fromtimestamp: Windows refuses negative stamps and
    # careers since 2003 reach back to the 1960s ("/Date(-...)/")
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    return (epoch + datetime.timedelta(milliseconds=ms)).year


_DAY = 86400000
_INF = float("inf")


def _start(r):
    return date_ms(r.get("StartDate")) or 0


def _finish(r):
    if not r.get("FinishDate"):
        return _INF
    ms = date_ms(r.get("FinishDate"))
    return ms if ms is not None else _INF


def tidy_positions(rows):
    """collapse rows that RENDER the same (the register lists the SAME office
    under two gendered position codes), then stitch same-office spans that
    touch (≤1 day) or overlap (a term split where GovernmentNum changed).
    Never across Knessets; genuinely separate stints keep their gap."""
    office = lambda r: "|".join([str(r.get("_role") or ""), str(r.get("GovMinistryName") or ""),
                                 str(r.get("CommitteeName") or ""), str(r.get("FactionName") or ""),
                                 str(r.get("KnessetNum") or "")])
    seen, uniq = set(), []
    for r in rows:
        k = "%s|%s|%s" % (office(r), _start(r), _finish(r))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    by_office = {}
    for r in uniq:
        by_office.setdefault(office(r), []).append(r)
    out = []
    for lst in by_office.values():
        lst.sort(key=_start)
        cur = lst[0]
        for r in lst[1:]:
            if _start(r) <= _finish(cur) + _DAY:
                if _finish(r) > _finish(cur):
                    cur["FinishDate"] = r.get("FinishDate")
                    cur["IsCurrent"] = cur.get("IsCurrent") or r.get("IsCurrent")
            else:
                out.append(cur)
                cur = r
        out.append(cur)
    out.sort(key=lambda r: (-_start(r), -(r.get("KnessetNum") or 0)))
    return out


def current_role(rows):
    """the heaviest role of substance held NOW, or "" — one answer to
    "what are they today", same as the page's cards and hero"""
    cur = [r for r in (rows or [])
           if r.get("_role") and not plain_role(r) and not r.get("FinishDate")]
    cur.sort(key=lambda r: -role_rank(r.get("_role")))
    return pos_ctx(cur[0]) if cur else ""


def is_mk_row(r):
    return bool(re.fullmatch(r"חבר(ת)?\s*(ה)?כנסת", str(r.get("_role") or "").strip()))


def highlights(rows, limit=4, open_ok=True):
    """the timeline's head, baked: roles of substance, ongoing first
    (heaviest first), then past newest-first — what the entity page shows.
    open_ok=False (not in the current Knesset): the register leaves rows
    open for people long gone — nothing of theirs is "now"."""
    subst = [r for r in rows if r.get("_role") and not plain_role(r)]
    now = sorted([r for r in subst if not r.get("FinishDate")],
                 key=lambda r: (-role_rank(r.get("_role")), -_start(r)))
    past = sorted([r for r in subst if r.get("FinishDate")], key=lambda r: -_finish(r))
    out = []
    for r in (now + past)[:limit]:
        y0, y1 = year_of(r.get("StartDate")), year_of(r.get("FinishDate"))
        out.append({"role": pos_ctx(r), "y0": y0, "y1": y1,
                    "k": r.get("KnessetNum") or None,
                    "now": open_ok and not r.get("FinishDate")})
    return out


_SLUG_DROP = re.compile("['\"׳״`’.,()]+")


def slug_he(name):
    """URL tail per the plan: the Hebrew name, spaces → hyphens"""
    s = _SLUG_DROP.sub("", str(name or "").strip())
    return re.sub(r"[\s_]+", "-", s).strip("-")


def slug_en(name):
    s = _SLUG_DROP.sub("", str(name or "").strip().lower())
    return re.sub(r"[\s_]+", "-", s).strip("-")


def en_display(name):
    """the English dropdown may list "Surname, Firstname" — make it a name"""
    s = str(name or "").strip()
    if "," in s:
        parts = [p.strip() for p in s.split(",", 1)]
        if len(parts) == 2 and parts[1]:
            s = parts[1] + " " + parts[0]
    return re.sub(r"\s+", " ", s)


# =====================================================================
# the relay — one fetch function, injectable so the tests need no network
# =====================================================================

class Relay:
    def __init__(self, proxy, fetch=None):
        self.proxy = proxy.rstrip("/")
        self._fetch = fetch or self._urllib
        self.calls = 0

    def _urllib(self, url, timeout=45):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read(300).decode("utf-8", "replace").strip()
            except Exception:
                pass
            raise RuntimeError("HTTP %d from %s%s" % (
                e.code, url.split("?")[0], (" — " + detail) if detail else ""))

    def raw(self, upstream, retries=2):
        """an upstream URL through the relay's /?url= door, with a pause and
        a couple of retries — a long run must not die on one hiccup"""
        url = self.proxy + "/?url=" + urllib.parse.quote(upstream, safe="")
        last = None
        for attempt in range(retries + 1):
            try:
                self.calls += 1
                data = self._fetch(url)
                time.sleep(PAUSE)
                return data
            except Exception as e:  # noqa: BLE001
                last = e
                if attempt < retries:
                    time.sleep(2 + attempt * 3)
        raise RuntimeError("relay call failed after %d tries: %s — %s"
                           % (retries + 1, upstream[:120], last))

    def own(self, path):
        """the relay's own routes (/data/*) — 404 is an answer, not an error"""
        self.calls += 1
        try:
            data = self._fetch(self.proxy + path)
        except RuntimeError as e:
            if "HTTP 404" in str(e) or "HTTP 501" in str(e):
                return None
            raise
        time.sleep(PAUSE)
        return data

    def json(self, upstream):
        return json.loads(self.raw(upstream).decode("utf-8"))

    def od(self, path):
        """OData rows: adds $format=json, unwraps both v3 flavours"""
        url = PARL + path + ("&" if "?" in path else "?") + "$format=json"
        j = self.json(url)
        if not j:
            return []
        if isinstance(j, list):
            return j
        if j.get("value") is not None:
            return j["value"]
        d = j.get("d")
        if isinstance(d, dict):
            return d.get("results") or []
        return d if isinstance(d, list) else []

    def od_paged(self, path, cap=2000):
        """the service answers at most 100 rows a page whatever $top says —
        page with $skip until a short page"""
        rows = []
        for skip in range(0, cap, 100):
            page = self.od("%s%s$skip=%d&$top=100" % (path, "&" if "?" in path else "?", skip))
            rows.extend(page)
            if len(page) < 100:
                break
        return rows

    def count(self, entity, flt):
        """$count — ALWAYS filtered; the service refuses a bare count"""
        if not flt:
            raise ValueError("unfiltered $count — the service refuses these")
        raw = self.raw(PARL + entity + "/$count?$filter=" + flt)
        n = raw.decode("utf-8", "replace").strip().lstrip("﻿")
        if not re.fullmatch(r"\d+", n):
            raise RuntimeError("$count did not answer a number: %r" % n[:80])
        return int(n)


def dataset(relay, name):
    """a /data/<name> snapshot's data, or None when unpublished"""
    raw = relay.own("/data/" + name)
    if raw is None:
        return None
    j = json.loads(raw.decode("utf-8"))
    return j.get("data") if isinstance(j, dict) and "data" in j else j


# =====================================================================
# collection
# =====================================================================

def odata_str(s):
    return str(s or "").replace("'", "''")


def fallback_person_ids(relay, name):
    """KNS_Person for the spellings the persons snapshot misses: the last
    name at every split point, both orders; the first name compared with
    spaces ignored ("עבד אלחכים" = "עבד אל חכים"). Runs BEFORE the gates."""
    words = [w for w in str(name or "").split() if w]
    if len(words) < 2:
        return []
    squash = lambda s: re.sub(r"\s+", "", norm_name(s))
    tried = set()
    for i in range(1, len(words)):
        for last, first in ((words[i:], words[:i]), (words[:i], words[i:])):
            last_s = " ".join(last)
            if last_s in tried:
                continue
            tried.add(last_s)
            try:
                rows = relay.od("KNS_Person()?$filter=LastName eq '%s'"
                                "&$select=PersonID,FirstName&$top=20" % odata_str(last_s))
            except Exception:  # noqa: BLE001
                continue
            hit = [int(r["PersonID"]) for r in rows if squash(r.get("FirstName")) == squash(" ".join(first))]
            if hit:
                return hit[:3]
    return []


POS_SELECT = ("$select=PersonID,PositionID,KnessetNum,StartDate,FinishDate,"
              "GovMinistryName,DutyDesc,CommitteeName,FactionName,IsCurrent")


def ensure_pos_names(relay):
    names = {}
    for skip in range(0, 500, 100):
        rows = relay.od("KNS_Position()?$select=PositionID,Description&$skip=%d&$top=100" % skip)
        for p in rows:
            names[p["PositionID"]] = p.get("Description")
        if len(rows) < 100:
            break
    return names


def resolve_roles(rows, pos_names):
    for r in rows:
        r["_role"] = r.get("DutyDesc") or pos_names.get(r.get("PositionID")) or ""
    return rows


def bulk_positions(relay, flt, pos_names):
    """every register row matching a filter ($count first, then the pages)"""
    n = relay.count("KNS_PersonToPosition()", flt)
    rows = []
    for skip in range(0, max(n, 1), 100):
        rows.extend(relay.od("KNS_PersonToPosition()?$filter=%s&$skip=%d&$top=100&%s"
                             % (flt, skip, POS_SELECT)))
    return resolve_roles(rows, pos_names)


def positions_for_many(relay, pids, pos_names):
    """full history per PersonID, 6 ids per OR-filter, paged — the same
    batched fetch the page uses. Any chunk failing after retries FAILS the
    run: a member with silently-empty positions would bake a wrong card."""
    pids = sorted(set(int(p) for p in pids))
    by_pid = {p: [] for p in pids}
    for i in range(0, len(pids), 6):
        chunk = pids[i:i + 6]
        flt = " or ".join("PersonID eq %d" % p for p in chunk)
        rows = relay.od_paged("KNS_PersonToPosition()?$filter=%s&%s" % (flt, POS_SELECT), cap=900)
        for r in resolve_roles(rows, pos_names):
            by_pid.setdefault(int(r["PersonID"]), []).append(r)
    return by_pid


BILL_EXPAND = ("$expand=KNS_Bill&$select=BillID,KNS_Bill/Name,KNS_Bill/StatusID,"
               "KNS_Bill/KnessetNum,KNS_Bill/LastUpdatedDate")


def bill_rows(relay, pids, status_map, latest):
    """every bill this person signed (lead or co-signer), deduped by BillID,
    newest first — the page's list (loadBills): name, exact status text,
    Knesset, pile. The undecided split like the page: this Knesset →
    "pending", an earlier one → "stale". $expand is a navigation path (the
    WAF allows those); pages cap at 100 rows, so od_paged pages by $skip."""
    seen = {}
    for pid in pids:
        rows = relay.od_paged("KNS_BillInitiator()?$filter=PersonID eq %d&%s" % (int(pid), BILL_EXPAND), cap=8000)
        for r in rows:
            b = r.get("KNS_Bill")
            if not b or not r.get("BillID") or r["BillID"] in seen:
                continue                      # an initiator row with no bill behind it is no bill
            status = status_map.get(int(b.get("StatusID") or 0), "") or ""
            pile = bill_bucket(status)
            k = int(b.get("KnessetNum") or 0) or None
            if pile == "process":
                pile = "pending" if k == latest else "stale"
            seen[r["BillID"]] = (date_ms(b.get("LastUpdatedDate")) or 0,
                                 {"n": str(b.get("Name") or "").strip(), "s": status, "k": k, "b": pile})
    return [row for _, row in sorted(seen.values(), key=lambda x: -x[0])]


def collect(relay, limit=None):
    """everything the snapshot needs, raw — returns the world dict"""
    log("reading the directories…")
    drop_he = relay.json(KAPI + "MKs/GetMksDropdown?languageKey=he") or []
    drop_en = relay.json(KAPI + "MKs/GetMksDropdown?languageKey=en") or []
    cmb = relay.json(KAPI + "Votes/GetVotesCmbData") or {}
    persons = dataset(relay, "persons") or {}
    photos = dataset(relay, "mkphotos") or {}

    statuses = None
    bills_snap = dataset(relay, "bills")
    if isinstance(bills_snap, dict) and bills_snap.get("statuses"):
        statuses = bills_snap["statuses"]
    if not statuses:
        log("  /data/bills has no statuses — asking KNS_Status")
        statuses = relay.od("KNS_Status()?$top=200")
    status_map = {int(s["StatusID"]): s.get("Desc") for s in statuses if s.get("StatusID") is not None}

    mks = cmb.get("MKS") or []
    if not mks:
        sys.exit("GetVotesCmbData answered no MKS — read one raw answer before blaming the code")
    latest = max(int(m.get("KnessetId") or 0) for m in mks)
    log("  latest Knesset: %d · cmb rows: %d · persons: %d · photos: %d · statuses: %d"
        % (latest, len(mks), len(persons), len(photos), len(status_map)))

    log("reading the K%d register (bulk)…" % latest)
    pos_names = ensure_pos_names(relay)
    k_rows = bulk_positions(relay, "KnessetNum eq %d" % latest, pos_names)
    log("  %d register rows" % len(k_rows))

    # everyone in the votes directory (K16 → today), one member per MkId,
    # carried by the row of their LATEST Knesset (its faction is the card's)
    members = []
    seen = set()
    for m in sorted(mks, key=lambda x: -int(x.get("KnessetId") or 0)):
        mk_id = int(m.get("Id") or 0)
        if not mk_id or mk_id in seen:
            continue
        seen.add(mk_id)
        members.append(dict(m, _lastK=int(m.get("KnessetId") or 0)))
    if limit:
        members = members[:limit]
    log("members since K%d: %d (K%d: %d)" % (
        min(int(m.get("KnessetId") or 99) for m in mks), len(members), latest,
        sum(1 for m in members if m["_lastK"] == latest)))

    return {"drop_he": drop_he, "drop_en": drop_en, "cmb": cmb, "persons": persons,
            "photos": photos, "status_map": status_map, "latest": latest,
            "k_rows": k_rows, "members": members, "pos_names": pos_names}


def build(relay, world):
    """the snapshot's data — and the full list of everything that failed"""
    latest, members = world["latest"], world["members"]
    persons, cmb = world["persons"], world["cmb"]
    mks = cmb.get("MKS") or []

    k_start, k_end = {}, {}
    for k in cmb.get("Knessets") or []:
        k_start[int(k["KnessetId"])] = year_of(k.get("KnessetStart"))
        k_end[int(k["KnessetId"])] = year_of(k.get("KnessetEnd"))
    f_name = {f["ID"]: f.get("FactionName") for f in cmb.get("Factions") or []}
    drop_by_id = {int(m["ID"]): m for m in world["drop_he"] if m.get("ID") is not None}
    en_by_id = {int(m["ID"]): m.get("Name") for m in world["drop_en"] if m.get("ID") is not None}

    pid_by_key = {}
    for pid, nm in persons.items():
        pid_by_key.setdefault(name_key(nm), []).append(int(pid))
    by_pid_k = {}
    for r in world["k_rows"]:
        by_pid_k.setdefault(int(r["PersonID"]), []).append(r)
    knessets_of, first_k = {}, {}
    for m in mks:
        mk_id = int(m.get("Id") or 0)
        k = int(m.get("KnessetId") or 0)
        knessets_of.setdefault(mk_id, set()).add(k)
        first_k[mk_id] = min(first_k.get(mk_id, 99), k)

    # ---- who each member is in the persons table: candidates by name ----
    norm_key = {}
    for pid, nm in persons.items():
        norm_key.setdefault(name_key(norm_name(nm)), []).append(int(pid))
    for m in members:
        m["_nick"] = False
        pids = pid_by_key.get(name_key(m["Name"])) or []
        if not pids:
            pids = [int(pid) for pid, nm in persons.items() if loose_match(m["Name"], nm)]
        if not pids:                          # hyphens, parentheses, quote marks
            n = norm_name(m["Name"])
            pids = norm_key.get(name_key(n)) or [
                int(pid) for pid, nm in persons.items() if loose_match(n, norm_name(nm))]
        if not pids:
            pids = fallback_person_ids(relay, m["Name"])
        if not pids:                          # רפאל ~ רפי — decided by own-Knesset rows below
            pids = [int(pid) for pid, nm in persons.items() if nickname_match(m["Name"], nm)]
            m["_nick"] = bool(pids)
        m["_cand"] = pids

    # ---- full position history for every candidate, batched ------------
    all_pids = sorted({p for m in members for p in m["_cand"]})
    log("reading position history for %d PersonIDs (%d queries)…"
        % (len(all_pids), (len(all_pids) + 5) // 6))
    by_pid_all = positions_for_many(relay, all_pids, world["pos_names"])

    # ---- namesakes: the PersonID with rows in the Knessets THIS member
    # served in wins (two אלי כהן: one in K16, one in K25) ---------------
    unresolved, claimed = [], {}
    for m in members:
        ks = knessets_of.get(int(m.get("Id") or 0)) or {m["_lastK"]}
        own = [p for p in m["_cand"] if any(int(r.get("KnessetNum") or 0) in ks
                                            for r in by_pid_all.get(p, []))]
        # a nickname match is a guess unless exactly ONE such person sat here
        m["_pids"] = (own if len(own) == 1 else []) if m["_nick"] else (own or m["_cand"])[:3]
        if not m["_pids"]:
            unresolved.append(m["Name"])
        for p in m["_pids"]:
            claimed.setdefault(p, []).append("%s (%s)" % (m["Name"], m.get("Id")))
    shared = ["PersonID %d ← %s" % (p, " + ".join(who)) for p, who in sorted(claimed.items()) if len(who) > 1]

    # ---- the bills: the list (published per MK) and the counts from it --
    if not any(bill_bucket(d) == "passed" for d in world["status_map"].values()):
        sys.exit("no passed statuses recognised — billBucket vs KNS_Status drifted; fix before publishing")
    log("reading the bills of %d members…" % len(members))
    bill_failures, world["bill_lists"] = [], {}
    for i, m in enumerate(members, 1):
        try:
            rows = bill_rows(relay, m["_pids"], world["status_map"], latest)
            world["bill_lists"][int(m.get("Id") or 0)] = rows
            m["_bills"] = {"proposed": len(rows), "passed": sum(1 for r in rows if r["b"] == "passed")}
        except Exception as e:  # noqa: BLE001
            m["_bills"] = None                # no count and no list — never a partial one
            bill_failures.append("%s — %s" % (m["Name"], e))
        if i % 10 == 0:
            log("  %d/%d…" % (i, len(members)))

    # ---- assemble one card per member ----------------------------------
    cards, missing_en, no_photo = {}, [], []
    for m in members:
        mk_id = int(m.get("Id") or 0)
        pids = m["_pids"]
        in_latest = latest in (knessets_of.get(mk_id) or ())
        rows = tidy_positions([r for p in pids for r in by_pid_all.get(p, [])])
        he = (pids and persons.get(str(pids[0]))) or m["Name"]   # "יאיר לפיד", not "לפיד יאיר"
        en = en_display(en_by_id.get(mk_id) or "")
        if not en:
            missing_en.append("%s (%d)" % (he, mk_id))
        d = drop_by_id.get(mk_id)
        serving = bool(d and d.get("IsCurrent")) or (in_latest and any(
            is_mk_row(r) for p in pids for r in by_pid_k.get(p, []) if not r.get("FinishDate")))

        since = k_start.get(first_k.get(mk_id)) or None
        starts = [year_of(r.get("StartDate")) for r in rows if year_of(r.get("StartDate"))]
        if starts:
            since = min([since] + starts) if since else min(starts)
        until = None
        if not serving:
            ends = [year_of(r.get("FinishDate")) for r in rows if year_of(r.get("FinishDate"))]
            until = max(ends) if ends else (k_end.get(m["_lastK"]) or None)

        photo = world["photos"].get(str(mk_id)) or None
        if not photo:
            no_photo.append("%s (%d)" % (he, mk_id))
        cards[str(mk_id)] = {
            "id": mk_id, "pids": pids,
            "he": he, "en": en, "slugHe": slug_he(he), "slugEn": slug_en(en),
            "photo": photo, "current": serving,
            "role": current_role(rows) if in_latest else "",   # an open row of someone long gone is not a role
            "faction": faction_short(f_name.get(m.get("faction_id"))),
            "since": since, "until": until,
            "knessets": sorted(knessets_of.get(mk_id) or []),
            "bills": m["_bills"],
            "positions": highlights(rows, open_ok=in_latest),
        }

    now_k = [c for c in cards.values() if latest in c["knessets"]]
    counted = [c["bills"] for c in now_k if c["bills"]]
    stats = {"count": len(now_k), "all": len(cards),   # averages: the current Knesset's yardstick
             "avgProposed": round(sum(b["proposed"] for b in counted) / len(counted), 1) if counted else None,
             "avgPassed": round(sum(b["passed"] for b in counted) / len(counted), 1) if counted else None}
    data = {"knesset": latest, "stats": stats, "members": cards}
    problems = {"unresolved": unresolved, "missing_en": missing_en, "shared": shared,
                "bill_failures": bill_failures, "no_photo": no_photo}
    return data, problems


# =====================================================================
# gates + publish
# =====================================================================

def gates(data, problems, partial):
    """the reasons this snapshot must NOT be published, in full — never a
    partial list shown as complete"""
    bad = []
    def full_list(title, items):
        bad.append("%s (%d):\n  - %s" % (title, len(items), "\n  - ".join(items)))
    if problems["unresolved"]:
        full_list("members with NO PersonID — their pages would be empty", problems["unresolved"])
    if problems["missing_en"]:
        full_list("members with no English name — the /en/ URL cannot exist", problems["missing_en"])
    if problems.get("shared"):
        full_list("one PersonID claimed by two members — namesakes merged", problems["shared"])
    if len(problems["bill_failures"]) > MAX_BILL_FAILURES:
        full_list("bill counts failed for too many members", problems["bill_failures"])
    now_k = sum(1 for c in data["members"].values() if data["knesset"] in c["knessets"])
    if not partial and now_k < 120:
        bad.append("only %d members of K%d built — a Knesset seats 120; the source answered short"
                   % (now_k, data["knesset"]))
    if partial:
        bad.append("--limit run: a slice is not the Knesset")
    return bad


BILLS_KEY = "pub:mkbills/%d"   # → /data/mkbills/<MkId> (the relay serves any pub:<name>)


def publish(data, bill_lists):
    cred = cf_kv.credentials(str(HERE.parent / "d1-config.json"))
    if not cred:
        sys.exit("no Cloudflare credentials: set CF_API_TOKEN + CF_ACCOUNT_ID, "
                 "or fill pipeline\\d1-config.json")
    ns = cf_kv.namespace_id(cred)
    value = cf_kv.envelope(data)
    if len(value.encode("utf-8")) > 2 * 1024 * 1024:
        sys.exit("snapshot is %.1f MB — that is not ~500 cards; refusing to publish"
                 % (len(value.encode("utf-8")) / 1e6))
    t = int(time.time() * 1000)
    items = [(BILLS_KEY % mk_id, cf_kv.envelope(rows, t)) for mk_id, rows in sorted(bill_lists.items())]
    log("publishing %s (%.0f KB) + %d bill lists (%.1f MB)…" % (
        KEY, len(value.encode("utf-8")) / 1024, len(items), sum(len(v.encode("utf-8")) for _, v in items) / 1e6))
    # the lists first: a card never points at a list that isn't there yet
    cf_kv.bulk_put(cred, ns, items + [(KEY, value)])
    bad = cf_kv.verify(cred, ns, items + [(KEY, value)])
    if bad:
        sys.exit("read-back FAILED (%d): %s" % (len(bad), "; ".join(bad[:20])))
    log("read back byte for byte — OK (%d keys)" % (len(items) + 1))
    relay = cf_kv.relay_url(str(HERE.parent))
    if relay:
        status, body, _ = cf_kv.relay_get(relay + "/data/mkcards?fresh=1")
        try:
            served = json.loads(body.decode("utf-8"))["data"]
            n = len(served.get("members") or {})
        except Exception:  # noqa: BLE001
            n = -1
        if status != 200 or n != len(data["members"]):
            sys.exit("the public relay serves status %d with %d members (built %d) — check "
                     "the worker before calling this done" % (status, n, len(data["members"])))
        log("public check: %s/data/mkcards serves %d members — OK" % (relay, n))
        # and the bills of the busiest member, through the same door the pages use
        top = max(bill_lists, key=lambda k: len(bill_lists[k]), default=None)
        if top is not None:
            status, body, _ = cf_kv.relay_get(relay + "/data/mkbills/%d?fresh=1" % top)
            try:
                got = len(json.loads(body.decode("utf-8"))["data"])
            except Exception:  # noqa: BLE001
                got = -1
            if status != 200 or got != len(bill_lists[top]):
                sys.exit("/data/mkbills/%d serves status %d with %d bills (built %d)"
                         % (top, status, got, len(bill_lists[top])))
            log("public check: /data/mkbills/%d serves %d bills — OK" % (top, got))
    else:
        log("note: relay URL not found — skipped the public check (verify /data/mkcards yourself)")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    no_publish = "--no-publish" in argv
    limit = None
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
    proxy = cf_kv.relay_url(str(HERE.parent)) or ""
    if not proxy:
        sys.exit("could not read PROXY_URL from site\\shared\\config.js (or env RELAY_URL)")

    relay = Relay(proxy)
    world = collect(relay, limit=limit)
    data, problems = build(relay, world)

    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / "mkcards.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "mkbills.json").write_text(json.dumps(world.get("bill_lists") or {}, ensure_ascii=False),
                                      encoding="utf-8")
    log("\nbuilt %d cards → %s (%d relay calls)" % (len(data["members"]), out_path, relay.calls))
    if problems["no_photo"]:
        log("no photo for %d members (their pages show initials):" % len(problems["no_photo"]))
        for p in problems["no_photo"]:
            log("  - " + p)
    if problems["bill_failures"]:
        log("bills missing for %d members (no count, no list on their page):" % len(problems["bill_failures"]))
        for p in problems["bill_failures"]:
            log("  - " + p)

    bad = gates(data, problems, partial=bool(limit))
    if bad:
        log("\nNOT publishing — fix these first:")
        for b in bad:
            log("* " + b)
        return 1
    if no_publish:
        log("\n--no-publish: stopping before Cloudflare. Snapshot is in out\\mkcards.json")
        return 0
    publish(data, world["bill_lists"])
    log("\ndone. The MK page and the pages Worker read /data/mkcards from here on.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
