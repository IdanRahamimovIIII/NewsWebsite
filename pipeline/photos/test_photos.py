#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_photos.py — publish_photos.py against a FAKE Cloudflare KV (no network).

What must hold (2026-09-06):
  - every portrait in index.json goes up as photo:mk/<MkId>-<hash8>.<ext>,
    the manifest as pub:mkphotos in the relay's envelope, pointing at them
  - binary values travel base64 through the bulk API and come back identical
  - an unchanged portrait is NOT re-uploaded; a changed one gets a NEW name
    and the old name is deleted (content-hashed names, immutable caching)
  - a manifest entry whose file is missing or is not an image refuses the run
  - the read-back verification catches a dropped key

    python3 photos/test_photos.py        (from pipeline/)
"""
import base64, contextlib, io, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import publish_photos as P
import cf_kv

FAILED = []


def ok(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "   " + str(detail)[:300]))
    if not cond:
        FAILED.append(name)


# a real (tiny) JPEG header + padding: sniffed as jpg, over the 1,500-byte floor
def jpeg(seed):
    return b"\xff\xd8\xff\xe0" + bytes([seed % 256]) * 2000 + b"\xff\xd9"


class FakeKV:
    def __init__(self, drop=None):
        self.store, self.drop, self.calls = {}, drop, []

    def __call__(self, cred, method, path, body=None, raw=False, content_type="application/json"):
        self.calls.append((method, path.split("?")[0].rsplit("/", 1)[-1]))
        if body is not None and not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode("utf-8")      # what the real api() does
        if method == "GET" and "/storage/kv/namespaces?" in path:
            return {"success": True, "result": [{"id": "ns-1", "title": "DATA"}]}
        if method == "GET" and "/keys" in path:
            prefix = cf_kv.urllib.parse.unquote(path.split("prefix=")[1].split("&")[0])
            return {"success": True, "result": [{"name": k} for k in self.store if k.startswith(prefix)],
                    "result_info": {"cursor": ""}}
        if method == "PUT" and path.endswith("/bulk"):
            for item in json.loads(body.decode("utf-8")):
                v = base64.b64decode(item["value"]) if item.get("base64") else item["value"].encode("utf-8")
                if item["key"] != self.drop:
                    self.store[item["key"]] = v
            return {"success": True}
        if method == "DELETE" and path.endswith("/bulk"):
            for k in json.loads(body.decode("utf-8")):
                self.store.pop(k, None)
            return {"success": True}
        if method == "GET" and "/values/" in path:
            key = cf_kv.urllib.parse.unquote(path.split("/values/")[1])
            if key not in self.store:
                raise RuntimeError("HTTP 404 from Cloudflare on GET %s" % path)
            return self.store[key]
        raise AssertionError("unexpected call %s %s" % (method, path))


def photos_dir(members, missing=None, junk=None):
    d = tempfile.mkdtemp()
    index = {}
    for mk_id, seed in members.items():
        fname = "%s.jpg" % mk_id
        index[mk_id] = fname
        if mk_id == missing:
            continue
        with open(os.path.join(d, fname), "wb") as fh:
            fh.write(b"<html>blocked</html>" if mk_id == junk else jpeg(seed))
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh)
    return d


def run(argv, fake):
    cf_kv.api = fake
    cf_kv.relay_url = lambda root: None
    cf_kv.time.sleep = lambda s: None
    out = io.StringIO()
    sys.argv = ["publish_photos.py", "--config", "/nonexistent"] + argv
    os.environ["CF_API_TOKEN"], os.environ["CF_ACCOUNT_ID"] = "tok", "acct"
    code = 0
    with contextlib.redirect_stdout(out):
        try:
            P.main()
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else 1
            out.write(str(e.code) + "\n")
    return code, out.getvalue()


print("first publish, three members:")
d = photos_dir({"1": 1, "1132": 2, "969": 3})
kv = FakeKV()
code, out = run(["--photos", d], kv)
ok("run succeeds", code == 0, out)
man = json.loads(kv.store["pub:mkphotos"].decode("utf-8"))
ok("manifest is the relay envelope {t, data}", set(man) == {"t", "data"}, man.keys())
ok("manifest names all three, content-hashed", set(man["data"]) == {"1", "1132", "969"}
   and all(P.PREFIX + v in kv.store for v in man["data"].values())
   and all(len(v.split("-")[1].split(".")[0]) == 8 for v in man["data"].values()), man["data"])
ok("image bytes round-trip base64 exactly", kv.store[P.PREFIX + man["data"]["1132"]] == jpeg(2))
ok("manifest sorted by member id", list(man["data"]) == ["1", "969", "1132"], list(man["data"]))
ok("reports byte-for-byte match", "match byte for byte" in out and "3 member(s) published" in out, out)
n_put_first = sum(1 for m, p in kv.calls if m == "PUT")

print("\nsecond publish, nothing changed:")
kv.calls.clear()
code, out = run(["--photos", d], kv)
ok("no image re-uploaded", code == 0 and "to upload: 0" in out, out)
name_1132 = man["data"]["1132"]

print("\nthird publish, one portrait refreshed:")
with open(os.path.join(d, "1132.jpg"), "wb") as fh:
    fh.write(jpeg(42))
code, out = run(["--photos", d], kv)
man2 = json.loads(kv.store["pub:mkphotos"].decode("utf-8"))
ok("changed portrait gets a NEW name", man2["data"]["1132"] != name_1132, (name_1132, man2["data"]["1132"]))
ok("only that one uploaded", "to upload: 1" in out, out)
ok("the old name is deleted from KV", P.PREFIX + name_1132 not in kv.store and "deleted 1 stale" in out, out)
ok("unchanged members keep their names", man2["data"]["1"] == man["data"]["1"])

print("\nrefusals:")
code, out = run(["--photos", photos_dir({"1": 1, "2": 2}, missing="2")], FakeKV())
ok("a manifest entry with no file refuses", code != 0 and "2 → 2.jpg: file missing" in out, out)
code, out = run(["--photos", photos_dir({"1": 1, "2": 2}, junk="2")], FakeKV())
ok("a block page saved as .jpg refuses (bytes decide, not the name)", code != 0 and "not an image" in out, out)
kv3 = FakeKV(drop="pub:mkphotos")
code, out = run(["--photos", d], kv3)
ok("a dropped manifest fails the read-back", code != 0 and "pub:mkphotos: missing" in out, out)
code, out = run(["--photos", d, "--dry-run"], FakeKV())
ok("--dry-run writes nothing", code == 0 and "nothing written" in out, out)

print()
if FAILED:
    sys.exit("%d FAILED: %s" % (len(FAILED), ", ".join(FAILED)))
print("all green")
