#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_publish.py — publish_paid.py against a FAKE Cloudflare KV (no network).

What must hold (2026-09-06):
  - the index and every section it names go up, in the relay's envelope
  - a section the index promises but the folder lacks REFUSES the run
    (a half-published dataset must not look complete on the site)
  - the read-back verification catches a key that KV silently dropped
  - the fake KV JSON-round-trips values, so an encoding slip would show
  - no credentials + --optional is a NOTE, not a failure (the workflow)
"""
import json, os, sys, tempfile, io, contextlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import publish_paid as P

FAILED = []


def ok(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "   " + str(detail)[:300]))
    if not cond:
        FAILED.append(name)


class FakeKV:
    """the four API calls publish_paid makes, answered from a dict"""
    def __init__(self, drop=None, titles=("our-money-data", "something-else")):
        self.store, self.drop, self.calls, self.titles = {}, drop, [], titles

    def __call__(self, cred, method, path, body=None, raw=False, content_type="application/json"):
        self.calls.append((method, path))
        if method == "GET" and path.endswith("/storage/kv/namespaces?per_page=100"):
            return {"success": True, "result": [{"id": "ns-%d" % i, "title": t}
                                                for i, t in enumerate(self.titles)]}
        if method == "PUT" and path.endswith("/bulk"):
            for item in json.loads(body.decode("utf-8")):          # JSON round-trip, like the real thing
                if item["key"] != self.drop:
                    self.store[item["key"]] = item["value"]
            return {"success": True}
        if method == "GET" and "/values/" in path:
            key = P.urllib.parse.unquote(path.split("/values/")[1])
            if key not in self.store:
                raise RuntimeError("HTTP 404 from Cloudflare on GET %s — key not found" % path)
            return self.store[key].encode("utf-8")
        raise AssertionError("unexpected call %s %s" % (method, path))


def paid_dir(sections, drop_doc=None):
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"sections": sections}, fh)
    for s in sections:
        if s == drop_doc:
            continue
        with open(os.path.join(d, s + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"sources": ["https://www.gov.il/x_%s.xlsx" % s], "reports": {"x": "2025Q1"},
                       "orders": {"450%s:00%s670205" % (s, s): [235298429.36, 409961432.74],
                                  "451%s:00%s600138" % (s, s): [7359.3, 13440.2]}}, fh, ensure_ascii=False)
    return d


def run(argv, fake):
    P.api = fake
    P.relay_from_config = lambda: None
    out = io.StringIO()
    sys.argv = ["publish_paid.py"] + argv
    code = 0
    with contextlib.redirect_stdout(out):
        try:
            P.main()
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else 1
            out.write(str(e.code) + "\n")
    return code, out.getvalue()


print("publishing two sections to a fake KV:")
d = paid_dir(["0020", "0024"])
kv = FakeKV()
code, out = run(["--paid", d, "--config", "/nonexistent"], kv)
os.environ["CF_API_TOKEN"], os.environ["CF_ACCOUNT_ID"] = "tok", "acct"
kv = FakeKV()
code, out = run(["--paid", d], kv)
ok("run succeeds", code == 0, out)
ok("index + both sections written", set(kv.store) == {"pub:paid/index", "pub:paid/0020", "pub:paid/0024"}, set(kv.store))
env = json.loads(kv.store["pub:paid/0020"])
ok("value is the relay envelope {t, data}", set(env) == {"t", "data"} and isinstance(env["t"], int), env.keys())
ok("data is the document verbatim", env["data"]["orders"]["4500020:000020670205"] == [235298429.36, 409961432.74], env["data"])
ok("index names the sections", json.loads(kv.store["pub:paid/index"])["data"] == {"sections": ["0020", "0024"]})
ok("namespace resolved by title", any("/storage/kv/namespaces?" in p for _, p in kv.calls))
ok("every key read back", sum(1 for m, p in kv.calls if m == "GET" and "/values/" in p) == 3, kv.calls)
ok("reports byte-for-byte match", "all 3 keys match byte for byte" in out, out)

print("\nthe namespace, as Mercy's account really names it (2026-09-06):")
kvd = FakeKV(titles=("DATA",))
code, out = run(["--paid", d], kvd)
ok("a namespace titled DATA is found without --namespace", code == 0 and len(kvd.store) == 3, out)
kvx = FakeKV(titles=("odd-name",))
code, out = run(["--paid", d], kvx)
ok("a lone namespace with any title is used, and says so", code == 0 and "one KV namespace" in out, out)
kvy = FakeKV(titles=("odd-name", "other"))
code, out = run(["--paid", d], kvy)
ok("two unknown titles refuse and name them", code != 0 and "odd-name, other" in out, out)
code, out = run(["--paid", d, "--namespace", "other"], kvy)
ok("--namespace picks one explicitly", code == 0, out)

print("\nrefusals:")
d2 = paid_dir(["0020", "0024"], drop_doc="0024")
code, out = run(["--paid", d2], FakeKV())
ok("a section the index promises but the folder lacks refuses the run", code != 0 and "0024" in out, out)
kv3 = FakeKV(drop="pub:paid/0024")
P.time.sleep = lambda s: None                     # the retry loop, without the waiting
code, out = run(["--paid", d], kv3)
ok("a key KV silently dropped fails the verification", code != 0 and "pub:paid/0024: missing" in out, out)
code, out = run(["--paid", d, "--dry-run"], FakeKV())
ok("--dry-run writes nothing", code == 0 and "nothing written" in out, out)

print("\nthe workflow without a secret:")
del os.environ["CF_API_TOKEN"]; del os.environ["CF_ACCOUNT_ID"]
code, out = run(["--paid", d, "--config", "/nonexistent", "--optional"], FakeKV())
ok("no credentials + --optional is a NOTE, exit 0", code == 0 and "NOTE:" in out, out)
code, out = run(["--paid", d, "--config", "/nonexistent"], FakeKV())
ok("no credentials without --optional fails", code != 0, out)

print()
if FAILED:
    sys.exit("%d FAILED: %s" % (len(FAILED), ", ".join(FAILED)))
print("all green")
