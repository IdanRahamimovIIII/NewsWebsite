#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""Build the /data/laws snapshot — every Israeli law, the court's effects on
them, and the bills a Knesset committee is working on now.

The "החוק" section reads it: the main page's highlights and the laws list.
One snapshot, ~0.5 MB: the laws list needs all of it anyway.

Sources (all through the relay, the proven route to knesset.gov.il):
  KNS_IsraelLaw (validity, dates) · KNS_IsraelLawClassificiation (topics) ·
  KNS_LawBinding (original / amends / repeals) · KNS_KnessetDates ·
  KNS_CommitteeSession + KNS_CmtSessionItem (a bill is ALIVE when a
  committee discussed it lately — its status alone lies) · KNS_Bill ·
  KNS_BillUnion (official merges) · KNS_Status · KNS_Committee ·
  KNS_BillInitiator + /data/persons (who proposed).
  court.csv here — the hand-kept list of rulings that voided, froze or
  deferred a law (sources: Wikisource boxes + he.wikipedia, dates and links
  from the court's own search). Kept by hand ON PURPOSE: no official source
  says "law X was voided by ruling Y" (site\shared\SOURCES.md).

Publish: KV pub:laws (relay envelope) → served as /data/laws by the relay
automatically (any pub:<name>), no worker change. Read back byte for byte +
checked at the public relay (cf_kv rules).

Never a partial list as complete (Mercy): gates refuse a short law list, a
court row pointing at a law that isn't there, or a failed bills step.

Zero-install: standard library only.
  --no-publish   build out\laws.json only (no credentials needed)
"""
import csv, json, re, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent            # pipeline\laws\
sys.path.insert(0, str(HERE.parent / "shared"))
sys.path.insert(0, str(HERE.parent / "mkcards"))
import cf_kv  # noqa: E402
from build_mkcards import Relay, dataset  # noqa: E402  (the one relay client)

OUT = HERE / "out"
KEY = "pub:laws"
ALIVE_DAYS = 90          # "discussed in committee in the last 3 months" (Mercy)
MIN_LAWS = 1900          # the register holds ~2,024; fewer = the source answered short
MIN_BINDINGS = 14000     # ~15,300 bill↔law links

# a bill that is finished, one way or another — matched as TEXT: KNS_Status
# Hebrew is partly garbled and its ids are not a stable contract
DONE_RE = re.compile(r"התקבלה בקריאה שלישית|נעצר|מוזג|הוסב|נדח|הוסר|נמשכ|בוטל")
PASSED_RE = re.compile(r"התקבלה בקריאה שלישית")
# a bill that changes an existing law (it belongs on that law's page) vs one
# that would create a NEW law (it gets its own page) — by the Knesset's own
# naming convention; exact links come later from the law API
AMENDS_RE = re.compile(r"\(תיקון|^הצעת חוק לתיקון")   # "(תיקוני חקיקה)" = a new law's side-effects: NOT this
PIECE_RE = re.compile(r"^.*?מתוך\s+(הצעת חוק.*)$")   # "פרק ג' ... מתוך הצעת חוק ההסדרים"
BUDGET_RE = re.compile(r"^תקציב (המדינה|נוסף)")      # IsBudgetLaw misses the 2026 budget
TEMP_RE = re.compile(r"הוראת שעה")


def log(*a):
    print(*a, flush=True)


def day(v):
    """any OData date → 'YYYY-MM-DD' or None"""
    if not v:
        return None
    s = str(v)
    m = re.match(r"/Date\((-?\d+)", s)
    if m:
        return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    return s[:10] if re.match(r"\d{4}-\d{2}-\d{2}", s) else None


def name_key(name):
    """identical bills = the same name once the year and punctuation go.
    A bare "(תיקון)" name is NOT a key: two such bills can be anything."""
    s = re.sub(r",?\s*התש[֐-׿\"'״׳]*\s*[–-]?\s*\d{4}\s*$", "", str(name or ""))
    s = re.sub(r"[\"'״׳.,\s–-]+", " ", s).strip()
    s = re.sub(r"^ה+צעת", "הצעת", s)
    if re.fullmatch(r".*\(תיקון( מס \d+)?\)", s) or len(s) < 12:
        return None
    return s


# =====================================================================
# collection
# =====================================================================

def collect(relay, today=None):
    today = today or date.today()
    w = {}
    kd = relay.od_paged("KNS_KnessetDates()?$select=KnessetNum,PlenumStart,IsCurrent", cap=1000)
    cur = max((r["KnessetNum"] for r in kd if r.get("IsCurrent")), default=None)
    if cur is None:
        raise RuntimeError("KNS_KnessetDates: no current Knesset")
    nxt = [day(r.get("PlenumStart")) for r in kd if r["KnessetNum"] == cur + 1 and r.get("PlenumStart")]
    w["knesset"], w["next_start"] = cur, (min(nxt) if nxt else None)
    log("current Knesset %d; next opens %s" % (cur, w["next_start"] or "—"))

    w["laws"] = relay.od_paged(
        "KNS_IsraelLaw()?$select=IsraelLawID,Name,IsBasicLaw,IsBudgetLaw,LawValidityDesc,"
        "PublicationDate,LatestPublicationDate,ValidityStartDate,ValidityFinishDate", cap=6000)
    log("laws: %d" % len(w["laws"]))
    w["classes"] = relay.od_paged(
        "KNS_IsraelLawClassificiation()?$select=IsraelLawID,ClassificiationID,ClassificiationDesc", cap=12000)
    w["bindings"] = relay.od_paged(
        "KNS_LawBinding()?$select=LawID,IsraelLawID,LawTypeID,BindingTypeDesc,AmendmentTypeDesc", cap=40000)
    log("topic tags: %d · bill↔law links: %d" % (len(w["classes"]), len(w["bindings"])))

    # the bills a committee discussed lately
    since = (today - timedelta(days=ALIVE_DAYS)).isoformat()
    sess = relay.od_paged("KNS_CommitteeSession()?$filter=StartDate ge datetime'%sT00:00:00'"
                          "&$select=CommitteeSessionID,StartDate,CommitteeID" % since, cap=20000)
    w["sessions"] = sess
    items = []
    if sess:
        lo = min(s["CommitteeSessionID"] for s in sess)
        items = relay.od_paged("KNS_CmtSessionItem()?$filter=ItemTypeID eq 2 and CommitteeSessionID ge %d"
                               "&$select=ItemID,CommitteeSessionID" % lo, cap=20000)
    w["items"] = items
    w["bills"] = relay.od_paged("KNS_Bill()?$filter=KnessetNum eq %d&$select=BillID,Name,SubTypeDesc,"
                                "StatusID,CommitteeID" % cur, cap=30000)
    w["unions"] = relay.od_paged("KNS_BillUnion()?$select=MainBillID,UnionBillID", cap=10000)
    w["statuses"] = {s["StatusID"]: s.get("Desc") or "" for s in
                     relay.od_paged("KNS_Status()?$select=StatusID,Desc", cap=1000)}
    w["committees"] = {c["CommitteeID"]: c.get("Name") or "" for c in
                       relay.od_paged("KNS_Committee()?$filter=KnessetNum eq %d&$select=CommitteeID,Name" % cur,
                                      cap=2000)}
    log("committee sessions since %s: %d · bill items: %d · K%d bills: %d"
        % (since, len(sess), len(items), cur, len(w["bills"])))

    # who proposed — only for the bills that will be listed
    alive = alive_ids(w)
    persons = dataset(relay, "persons") or {}
    w["initiators"] = {}
    for bid in sorted(alive):
        rows = relay.od("KNS_BillInitiator()?$filter=BillID eq %d&$select=PersonID,IsInitiator,Ordinal" % bid)
        w["initiators"][bid] = [
            {"name": persons.get(str(r["PersonID"])) or persons.get(r["PersonID"]) or "",
             "lead": bool(r.get("IsInitiator")), "ord": r.get("Ordinal") or 99} for r in rows]
    w["today"] = today.isoformat()
    return w


def alive_ids(w):
    """bills of this Knesset discussed in committee since the cut, not finished"""
    by_id = {b["BillID"]: b for b in w["bills"]}
    # the items query asks by session-id range; ids are not strictly in date
    # order, so only a session inside the window counts
    recent = {s["CommitteeSessionID"] for s in w["sessions"]}
    seen = {i["ItemID"] for i in w["items"] if i["CommitteeSessionID"] in recent}
    return {bid for bid in seen if bid in by_id
            and not DONE_RE.search(w["statuses"].get(by_id[bid]["StatusID"], ""))}


# =====================================================================
# build
# =====================================================================

def read_court(path=HERE / "court.csv"):
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def court_reviewed(path=HERE / "court_reviewed.txt"):
    """the day someone last went over court.csv (a person writes it)"""
    try:
        s = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return s if re.match(r"\d{4}-\d{2}-\d{2}$", s) else None


def build(w, court_rows):
    problems = []
    laws_in = w["laws"]
    topics, tags = {}, {}
    for c in w["classes"]:
        topics[str(c["ClassificiationID"])] = c.get("ClassificiationDesc") or ""
        tags.setdefault(c["IsraelLawID"], set()).add(c["ClassificiationID"])

    amends, direct, repeal_bill = {}, {}, {}
    original_of_bill = {}       # a bill that CREATED a law → that law's id
    for b in w["bindings"]:
        kind = b.get("BindingTypeDesc") or ""
        lid = b.get("IsraelLawID")
        if kind == "החוק המקורי":
            original_of_bill[b.get("LawID")] = lid
        elif kind == "מתקן":
            amends[lid] = amends.get(lid, 0) + 1
            if (b.get("AmendmentTypeDesc") or "") == "ישיר":
                direct[lid] = direct.get(lid, 0) + 1
        elif kind == "מבטל":
            repeal_bill.setdefault(lid, []).append(b.get("LawID"))

    ids = {l["IsraelLawID"] for l in laws_in}
    laws = []
    for l in sorted(laws_in, key=lambda r: (day(r.get("PublicationDate")) or "", r["IsraelLawID"])):
        lid, name = l["IsraelLawID"], (l.get("Name") or "").strip()
        flags = ""
        if l.get("IsBasicLaw"):
            flags += "b"
        if l.get("IsBudgetLaw") or BUDGET_RE.search(name):
            flags += "u"
        if TEMP_RE.search(name):
            flags += "t"
        rep = None
        for bill in repeal_bill.get(lid, []):
            other = original_of_bill.get(bill)
            if other and other != lid and other in ids:
                rep = other          # the law whose passing repealed this one
        laws.append({
            "i": lid, "n": name, "st": (l.get("LawValidityDesc") or "").strip(),
            "s": day(l.get("ValidityStartDate")), "e": day(l.get("ValidityFinishDate")),
            "p": day(l.get("PublicationDate")), "lp": day(l.get("LatestPublicationDate")),
            "f": flags, "t": sorted(tags.get(lid, ())), "a": amends.get(lid, 0),
            "ad": direct.get(lid, 0), "r": rep,
        })

    court = []
    for r in court_rows:
        try:
            lid = int(r["law_id"])
        except ValueError:
            problems.append("court.csv: law_id %r is not a number" % r["law_id"])
            continue
        if lid not in ids:
            problems.append("court.csv: law %d (%s) is not in the Knesset's list" % (lid, r["case"]))
        if r["kind"] not in ("void", "partial", "frozen", "deferred"):
            problems.append("court.csv: unknown kind %r (%s)" % (r["kind"], r["case"]))
        if not re.match(r"\d{4}-\d{2}-\d{2}$", r["date"] or ""):
            problems.append("court.csv: bad date %r (%s)" % (r["date"], r["case"]))
        court.append({"l": lid, "k": r["kind"], "c": r["case"], "d": r["date"], "w": r["what"],
                      "u": r["url"], "src": r["source"], "pn": r["panel"] or None,
                      "ds": r["dissent"] or None, "ck": r["checked"] or None})

    bills = build_bills(w)
    data = {"knesset": w["knesset"], "nextStart": w.get("next_start"), "asOf": w["today"],
            "aliveDays": ALIVE_DAYS, "courtReviewed": court_reviewed(), "topics": topics, "laws": laws, "court": court, "bills": bills}
    return data, problems


def build_bills(w):
    """the bills a committee discussed in the last ALIVE_DAYS, not finished —
    identical bills folded into the most advanced one; budget-law pieces
    ("פרק … מתוך הצעת חוק …") folded under their parent"""
    by_id = {b["BillID"]: b for b in w["bills"]}
    sess_date = {s["CommitteeSessionID"]: day(s.get("StartDate")) for s in w["sessions"]}
    last = {}
    for it in w["items"]:
        d = sess_date.get(it["CommitteeSessionID"])
        if d and d > last.get(it["ItemID"], ""):
            last[it["ItemID"]] = d
    alive = alive_ids(w)

    # official merges: a merged bill points at its lead
    lead_of = {u["UnionBillID"]: u["MainBillID"] for u in w["unions"]}
    # identical names across the WHOLE Knesset (the copies are usually parked)
    same = {}
    for b in w["bills"]:
        k = name_key(b.get("Name"))
        if k:
            same.setdefault(k, []).append(b["BillID"])

    groups = {}          # the representative bill id → entry
    for bid in sorted(alive, key=lambda x: last.get(x, ""), reverse=True):
        b = by_id[bid]
        name = re.sub(r"\s+", " ", b.get("Name") or "").strip()
        piece = PIECE_RE.match(name)
        parent = piece.group(1).strip() if piece else None
        k = name_key(name)
        # one entry per real bill: a budget piece under its parent, identical
        # copies under one name, an official merge under its lead
        key = (("piece", name_key(parent) or parent) if parent else
               ("name", k) if k else ("bill", lead_of.get(bid, bid)))
        twins = [x for x in (same.get(k, []) if k else []) if x != bid]
        g = groups.get(key)
        if g is None:
            ini = sorted(w["initiators"].get(bid, []), key=lambda r: (not r["lead"], r["ord"]))
            g = groups[key] = {
                "i": bid, "n": parent or name, "ty": b.get("SubTypeDesc") or "",
                "st": w["statuses"].get(b["StatusID"], ""), "d": last.get(bid),
                "cm": w["committees"].get(b.get("CommitteeID"), ""),
                "by": [r["name"] for r in ini if r["name"]][:3], "nb": len(ini),
                "am": bool(AMENDS_RE.search(parent or name)),
                "pieces": [] if parent else None, "twins": [],
            }
        elif not parent and bid != g["i"]:
            if bid not in g["twins"]:
                g["twins"].append(bid)      # an identical copy that is ALSO alive
            for r in sorted(w["initiators"].get(bid, []), key=lambda r: (not r["lead"], r["ord"]))[:1]:
                if r["name"] and r["name"] not in g["by"]:
                    g["by"].append(r["name"])   # each copy's lead sponsor
        if parent:
            g["pieces"].append({"i": bid, "n": name.split("מתוך")[0].strip(), "d": last.get(bid),
                                "st": w["statuses"].get(b["StatusID"], "")})
        for t in twins:
            if t not in g["twins"] and t != g["i"]:
                g["twins"].append(t)
    out = []
    for g in groups.values():
        if g["pieces"] is None:
            del g["pieces"]
        g["twins"] = sorted(g["twins"])
        out.append(g)
    out.sort(key=lambda g: g["d"] or "", reverse=True)
    return out


# =====================================================================
# one card per law — the law's own page (worker pages.js /law/<id>-…/)
# Source: the Knesset site's law API (one call per law): ministry and
# committee BY NAME (the OData ministry ids map to nothing), the Knesset's
# note, Wikisource + Kol Zchut links, every amendment with its gazette PDF
# and official summary, pending bills that amend it, its regulations.
# =====================================================================

KAPI_LAW = "https://knesset.gov.il/WebSiteApi/knessetapi/LegislationItem/GetLegislationLawItem?ItemId=%d"
CARD_KEY = "pub:lawcard/%d"      # → /data/lawcard/<IsraelLawID> (the relay serves any pub:<name>)
MAX_CARD_FAILURES = 20


def clean(v):
    s = str(v if v is not None else "").strip()
    return "" if s in ("None", "null") else s


def fix_path(p):
    """the API's file paths mix backslashes and doubled slashes"""
    s = clean(p).replace("\\", "/")
    return re.sub(r"(?<!:)/{2,}", "/", s)


def build_card(l, j):
    g = (j or {}).get("general") or {}
    c = (j or {}).get("corrections") or {}
    rows = []
    for x in c.get("listCorrections") or []:
        add = clean(x.get("AdditionalName"))
        rows.append({"n": clean(x.get("name")), "d": day(x.get("publicationDate")),
                     "no": clean(x.get("correctionNumber")), "ty": clean(x.get("correctionType")),
                     "pdf": fix_path(x.get("filePath")), "sum": clean(x.get("summaryLaw")),
                     "k": "orig" if "המקורי" in add else "rep" if "המבטל" in add else ""})
    orig = next((r for r in rows if r["k"] == "orig"), None)
    am = [r for r in rows if r is not orig and r["k"] != "rep"]          # newest first, as the API gives
    repealed_by = [r for r in rows if r["k"] == "rep"]
    pend = [{"i": int(clean(x.get("itemId")) or 0), "n": clean(x.get("name")),
             "no": re.sub(r"\s+", " ", clean(x.get("description"))), "ty": clean(x.get("subTypeName")),
             "step": clean(x.get("currentStep")), "cm": clean(x.get("committeeName")),
             "d": day(x.get("latestSessionDate"))} for x in c.get("listLegislationBills") or []]
    regs = [{"n": clean(x.get("name")), "d": day(x.get("PublicationDate")) or day(x.get("sessionDate"))}
            for x in j.get("secondaryLawInstalled") or []] if j else []
    regs.sort(key=lambda r: r["d"] or "", reverse=True)
    rel = lambda key: [{"i": x.get("itemId"), "n": clean(x.get("name")), "d": day(x.get("displayPublicationDate"))}
                       for x in c.get(key) or []]
    return {"i": l["i"], "min": clean(g.get("ministriesName")), "cm": clean(g.get("committeeNames")),
            "note": clean(g.get("siteComment")), "ws": clean(g.get("openBookUrl")),
            "kz": clean(g.get("kolZchutUrl")),
            "prev": [clean(x) for x in (g.get("listPrevNames") or []) if clean(x)],
            "orig": orig, "am": am, "repBy": repealed_by, "pend": pend,
            "regs": regs[:40], "nregs": len(regs), "nproc": len((j or {}).get("secondaryLawInProcess") or []),
            "replacedBy": rel("listRelatedsReplacedBy"), "replaces": rel("listRelatedsReplaceAnother")}


CARD_THREADS = 4   # the law API answers in ~2 s: one at a time is 80 minutes; four is still polite


def collect_cards(relay, laws, threads=CARD_THREADS):
    from concurrent.futures import ThreadPoolExecutor
    cards, failures = {}, []

    def one(l):
        try:
            return l, build_card(l, relay.json(KAPI_LAW % l["i"])), None
        except Exception as e:  # noqa: BLE001
            return l, None, "%d %s — %s" % (l["i"], l["n"][:50], str(e)[:120])

    with ThreadPoolExecutor(max_workers=threads) as pool:
        for n, (l, card, err) in enumerate(pool.map(one, laws), 1):
            if card is not None:
                cards[l["i"]] = card
            else:
                failures.append(err)
            if n % 250 == 0:
                log("  cards: %d / %d" % (n, len(laws)))
    return cards, failures


def publish_cards(cards, t):
    cred = cf_kv.credentials(str(HERE.parent / "d1-config.json"))
    ns = cf_kv.namespace_id(cred)
    items = [(CARD_KEY % i, cf_kv.envelope(c, t)) for i, c in sorted(cards.items())]
    log("publishing %d law cards (%.1f MB)…" % (len(items), sum(len(v.encode("utf-8")) for _, v in items) / 1e6))
    cf_kv.bulk_put(cred, ns, items)
    # reading 2,000 keys back one by one sits on the API's rate line: a
    # sample (the biggest + an even spread) proves the write went through
    big = max(items, key=lambda kv: len(kv[1]))
    sample = [big] + items[::max(1, len(items) // 25)]
    bad = cf_kv.verify(cred, ns, sample)
    if bad:
        sys.exit("card read-back FAILED (%d): %s" % (len(bad), "; ".join(bad[:10])))
    log("read back %d sample cards byte for byte — OK" % len(sample))


# =====================================================================
# gates + publish
# =====================================================================

def gates(data, problems, w):
    bad = list(problems)
    if len(data["laws"]) < MIN_LAWS:
        bad.append("only %d laws — the register holds ~2,024; the source answered short" % len(data["laws"]))
    if len(w["bindings"]) < MIN_BINDINGS:
        bad.append("only %d bill↔law links (expected ~15,300)" % len(w["bindings"]))
    if len(data["topics"]) < 40:
        bad.append("only %d topics (expected ~51)" % len(data["topics"]))
    if not w["sessions"] and not w.get("recess_ok"):
        bad.append("no committee session at all in %d days — a recess is possible, but check "
                   "before publishing an empty bills list" % ALIVE_DAYS)
    return bad


def publish(data):
    cred = cf_kv.credentials(str(HERE.parent / "d1-config.json"))
    if not cred:
        sys.exit("no Cloudflare credentials: set CF_API_TOKEN + CF_ACCOUNT_ID, "
                 "or fill pipeline\\d1-config.json")
    ns = cf_kv.namespace_id(cred)
    value = cf_kv.envelope(data)
    size = len(value.encode("utf-8"))
    if size > 3 * 1024 * 1024:
        sys.exit("snapshot is %.1f MB — that is not ~2,000 laws; refusing to publish" % (size / 1e6))
    log("publishing %s (%.0f KB)…" % (KEY, size / 1024))
    cf_kv.bulk_put(cred, ns, [(KEY, value)])
    bad = cf_kv.verify(cred, ns, [(KEY, value)])
    if bad:
        sys.exit("read-back FAILED: %s" % "; ".join(bad))
    log("read back byte for byte — OK")
    relay = cf_kv.relay_url(str(HERE.parent))
    if relay:
        status, body, _ = cf_kv.relay_get(relay + "/data/laws?fresh=1")
        try:
            n = len(json.loads(body.decode("utf-8"))["data"]["laws"])
        except Exception:  # noqa: BLE001
            n = -1
        if status != 200 or n != len(data["laws"]):
            sys.exit("the public relay serves status %d with %d laws (built %d) — check the worker"
                     % (status, n, len(data["laws"])))
        log("public check: %s/data/laws serves %d laws — OK" % (relay, n))
    else:
        log("note: relay URL not found — skipped the public check (verify /data/laws yourself)")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    no_publish = "--no-publish" in argv
    proxy = cf_kv.relay_url(str(HERE.parent)) or ""
    if not proxy:
        sys.exit("could not read PROXY_URL from site\\shared\\config.js (or env RELAY_URL)")
    relay = Relay(proxy)
    w = collect(relay)
    w["recess_ok"] = "--recess-ok" in argv
    data, problems = build(w, read_court())
    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / "laws.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    log("\nbuilt %d laws · %d court rows · %d live bills → %s (%d relay calls)"
        % (len(data["laws"]), len(data["court"]), len(data["bills"]), out_path, relay.calls))
    cards, card_failures = {}, []
    if "--no-cards" not in argv:
        log("\nlaw cards (one law-API call per law, ~15 minutes)…")
        cards, card_failures = collect_cards(relay, data["laws"])
        (OUT / "lawcards.json").write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
        log("built %d law cards (%d failed)" % (len(cards), len(card_failures)))
        for f in card_failures:
            log("  - " + f)
    bad = gates(data, problems, w)
    if len(card_failures) > MAX_CARD_FAILURES:
        bad.append("law cards failed for %d laws (more than %d)" % (len(card_failures), MAX_CARD_FAILURES))
    if bad:
        log("\nNOT publishing — fix these first:")
        for b in bad:
            log("* " + b)
        return 1
    if no_publish:
        log("\n--no-publish: stopping before Cloudflare. Snapshot is in out\\laws.json")
        return 0
    if cards:
        publish_cards(cards, int(time.time() * 1000))   # the cards first: a page never points at a missing card
    publish(data)
    log("\ndone. The law pages read /data/laws from here on.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
