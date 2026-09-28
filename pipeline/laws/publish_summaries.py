"""Puts the AI summaries on the live law cards — ONLY the laws whose summary
changed, not the whole dataset (Mercy). Seconds, not 15 minutes.

  python pipeline/laws/publish_summaries.py          changed summaries only
  python pipeline/laws/publish_summaries.py --all    every summary file (re-check)

Each card is read from KV itself (not the cached public API — an hour-old copy
written back would undo a newer weekly run), gets `ai`, is written and read
back. What went up is remembered in out/summaries_published.json. The weekly
build_laws.py run attaches every summary as well — this is only for "now".
"""
import hashlib, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shared"))
import cf_kv  # noqa: E402
import build_laws as B  # noqa: E402

STAMP = B.OUT / "summaries_published.json"


def digest(ai):
    return hashlib.sha1(json.dumps(ai, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def plan(sums, stamp, everything=False):
    """{id: ai} of the summaries to publish (the file minus its id)"""
    out = {}
    for i, s in sums.items():
        ai = {k: v for k, v in s.items() if k != "i"}
        if everything or stamp.get(str(i)) != digest(ai):
            out[i] = ai
    return out


def patch(raw, ai):
    """the stored card envelope with `ai` set; None when it already holds it.
    The card's own time stays — only the summary changed."""
    env = json.loads(raw)
    if env["data"].get("ai") == ai:
        return None
    env["data"]["ai"] = ai
    return cf_kv.envelope(env["data"], env.get("t"))


def main(argv):
    sums, bad = B.read_summaries()
    if bad:
        sys.exit("bad summary files — fix them first:\n" + "\n".join(bad))
    stamp = json.loads(STAMP.read_text(encoding="utf-8")) if STAMP.exists() else {}
    todo = plan(sums, stamp, "--all" in argv)
    print("%d summary files, %d to check against the live cards" % (len(sums), len(todo)))
    if not todo:
        return 0
    cred = cf_kv.credentials(str(HERE.parent / "d1-config.json"))
    ns = cf_kv.namespace_id(cred)
    items, missing = [], []
    for i, ai in sorted(todo.items()):
        raw = cf_kv.read_back(cred, ns, B.CARD_KEY % i)
        if raw is None:
            missing.append(i)   # no card yet — the weekly run makes it, with the summary
            continue
        v = patch(raw, ai)
        if v is not None:
            items.append((B.CARD_KEY % i, v))
    if items:
        print("writing %d cards…" % len(items))
        cf_kv.bulk_put(cred, ns, items)
        wrong = cf_kv.verify(cred, ns, items)
        if wrong:
            sys.exit("read-back FAILED: " + "; ".join(wrong))
    for i, ai in todo.items():
        if i not in missing:
            stamp[str(i)] = digest(ai)
    B.OUT.mkdir(parents=True, exist_ok=True)
    STAMP.write_text(json.dumps(stamp, sort_keys=True), encoding="utf-8")
    print("published %d, already live %d, no card yet %s — OK (pages refresh within an hour)"
          % (len(items), len(todo) - len(items) - len(missing), missing or "none"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
