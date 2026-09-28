"""The AI summaries' work tool — reads the last local run (..\\out\\laws.json
+ lawcards.json; run build_laws.py --no-publish first if they are old).

  python kit.py next [N]   the next N laws in scope with no summary, newest first
  python kit.py <id>       one law's sources: gazette PDFs, official summaries,
                           explanatory notes, court rows, Wikisource (a guide only)
  python kit.py stale      summaries written before a newer amendment
Scope (Mercy): in force or about to be (budget laws aside); a court-stopped
law the Knesset still lists counts. Rules for the text: GUIDE.md.
"""
import json, sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "out"


def load():
    d = json.loads((OUT / "laws.json").read_text(encoding="utf-8"))
    d = d.get("data", d)
    cards = json.loads((OUT / "lawcards.json").read_text(encoding="utf-8"))
    sums = {int(f.stem): json.loads(f.read_text(encoding="utf-8")) for f in HERE.glob("*.json")}
    return d, cards, sums


def in_scope(l, today):
    return (l["st"] in ("תקף", "טרם נכנס לתוקף") and "u" not in (l.get("f") or "")
            and not (l.get("e") and l["e"] < today))


def main(a):
    sys.stdout.reconfigure(encoding="utf-8")
    d, cards, sums = load()
    today = date.today().isoformat()
    if not a or a[0] == "next":
        todo = [l for l in d["laws"] if in_scope(l, today) and l["i"] not in sums]
        todo.sort(key=lambda l: l.get("p") or "", reverse=True)
        print("%d in scope, %d written, %d to go" % (sum(in_scope(l, today) for l in d["laws"]), len(sums), len(todo)))
        for l in todo[:int(a[1]) if len(a) > 1 else 20]:
            print(l["i"], l.get("p"), l["n"])
    elif a[0] == "stale":
        for i, s in sorted(sums.items()):
            newer = [x for x in (cards.get(str(i)) or {}).get("am", []) if (x.get("d") or "") > (s.get("upto") or "")]
            if newer:
                print(i, s.get("upto"), "→", ", ".join("%s %s" % (x["d"], x["n"]) for x in newer))
    else:
        i = int(a[0])
        l = next(x for x in d["laws"] if x["i"] == i)
        c = cards.get(str(i)) or {}
        print(l["n"], "|", l["st"], "| start", l.get("s"), "| end", l.get("e"), "| flags", l.get("f"))
        o = c.get("orig") or {}
        print("original:", o.get("d"), o.get("pdf") or "(no PDF)")
        if o.get("sum"):
            print("  Knesset summary (may be outdated):", o["sum"])
        if c.get("note"):
            print("Knesset note:", c["note"])
        print("explanatory notes:", c.get("expl") or "-")
        print("amendments (%d), newest first:" % len(c.get("am", [])))
        for x in c.get("am", [])[:15]:
            print("  %s %s %s" % (x.get("d"), x["n"], x.get("pdf") or ""))
            if x.get("sum"):
                print("     summary:", x["sum"][:300])
        for x in (d.get("amends") or []):
            if i in (x.get("laws") or []) and (x.get("c") or "") > today:
                print("passed, starts", x["c"], x["n"])
        for x in c.get("pend", []):
            print("pending bill:", x["n"], x.get("step"))
        for x in d.get("court", []):
            if x["l"] == i:
                print("court:", x["k"], x["c"], x["d"], x["w"], x["u"])
        print("Wikisource (guide only):", c.get("ws") or "-")
        print("upto (newest amendment):", (c.get("am") or [{}])[0].get("d"))


if __name__ == "__main__":
    main(sys.argv[1:])
