#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cf_kv.py — the pipeline's one Cloudflare KV client (standard library only).

Shared by every publisher (publish_photos.py; publish_paid.py used it until
the paid overlay was deleted on 2026-09-08) so there is exactly ONE place
that knows how to talk to Cloudflare from Mercy's machine or from GitHub
Actions. Import it with

    sys.path.insert(0, os.path.join(<pipeline>, "shared")); import cf_kv

CREDENTIALS — env first (CI: repo secrets CF_API_TOKEN + CF_ACCOUNT_ID),
then a JSON config file (Mercy's machine: pipeline\\d1-config.json, the D1
token with "Workers KV Storage: Edit" added on 2026-09-06).

NAMESPACE — found by TITLE, never by an id copied into a file. worker.js's
header says to name it "our-money-data"; Mercy's account has it titled
"DATA" (same as the binding — found by the first live publish, 2026-09-06).
Both are tried; a lone namespace is taken whatever its title.

RULE (the D1 lesson of 2026-08-26): never trust an API's status words.
Every publisher reads its keys back and compares — `read_back` is here so
they all do it the same way.

Limits that matter: 25 MB per value · bulk write ≤ 10,000 keys / 100 MB
per request (we chunk at 40 MB) · binary values go through the bulk
endpoint base64-encoded (`base64: true`) · list/keys pages by cursor ·
the API itself allows ~1,200 requests per 5 minutes: `verify` reads keys
back ONE call each, so a 1,000-portrait publish sits right at that line —
a 429 is waited out (Retry-After, else 15 s) and the call retried, never
reported as a failed publish (added 2026-09-06 before the first full
historical run).
"""
import base64, json, os, re, time, urllib.error, urllib.parse, urllib.request

API = "https://api.cloudflare.com/client/v4"
NAMESPACE_TITLES = ["our-money-data", "DATA"]
BULK_LIMIT = 40 * 1024 * 1024
VALUE_LIMIT = 25 * 1024 * 1024
UA = "our-money pipeline cf_kv.py"


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- credentials
def credentials(config_path):
    """{'token','account','namespace_id','source'} or None. Env wins."""
    tok = os.environ.get("CF_API_TOKEN", "").strip()
    acct = os.environ.get("CF_ACCOUNT_ID", "").strip()
    ns_id = os.environ.get("CF_KV_NAMESPACE_ID", "").strip()
    src = "environment"
    if not (tok and acct):
        if not (config_path and os.path.exists(config_path)):
            return None
        with open(config_path, encoding="utf-8") as fh:
            cfg = json.load(fh)
        tok, acct = (cfg.get("api_token") or "").strip(), (cfg.get("account_id") or "").strip()
        ns_id = ns_id or (cfg.get("kv_namespace_id") or "").strip()
        src = config_path
    if not (tok and acct) or tok.startswith("<"):
        return None
    return {"token": tok, "account": acct, "namespace_id": ns_id, "source": src}


RATE_LIMIT_RETRIES = 8      # 429s waited out before giving up (~2 min at the default pause)
RATE_LIMIT_PAUSE = 15       # seconds, when Cloudflare sends no Retry-After


def api(cred, method, path, body=None, raw=False, content_type="application/json"):
    """One Cloudflare REST call. Raises RuntimeError with Cloudflare's own
    words on any refusal; returns the parsed JSON, or the raw bytes.
    A 429 (too many requests — ~1,200 per 5 minutes) is not a refusal: the
    call waits Retry-After seconds (else RATE_LIMIT_PAUSE) and goes again."""
    data = None
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode("utf-8")
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        req = urllib.request.Request(API + path, data=data, method=method,
                                     headers={"Authorization": "Bearer " + cred["token"],
                                              "Content-Type": content_type, "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                payload = r.read()
            break
        except urllib.error.HTTPError as e:
            detail = e.read(600).decode("utf-8", "replace")
            if e.code == 429 and attempt < RATE_LIMIT_RETRIES:
                try:
                    wait = max(1, int(e.headers.get("Retry-After", "")))
                except (TypeError, ValueError):
                    wait = RATE_LIMIT_PAUSE
                log("  Cloudflare asks for a pause (429) — waiting %ds, then retrying %s %s"
                    % (wait, method, path.split("?")[0][-60:]))
                time.sleep(wait)
                continue
            raise RuntimeError("HTTP %d from Cloudflare on %s %s — %s" % (e.code, method, path, detail))
    if raw:
        return payload
    j = json.loads(payload.decode("utf-8"))
    if not j.get("success", False):
        raise RuntimeError("Cloudflare said no on %s %s: %s" % (method, path, json.dumps(j.get("errors"))[:600]))
    return j


def namespace_id(cred, title=None):
    if cred["namespace_id"]:
        return cred["namespace_id"]
    j = api(cred, "GET", "/accounts/%s/storage/kv/namespaces?per_page=100" % cred["account"])
    spaces = j.get("result") or []
    titles = [title] if title else NAMESPACE_TITLES
    for t in titles:
        for s in spaces:
            if s.get("title") == t:
                return s["id"]
    if not title and len(spaces) == 1:
        log("note: the account has one KV namespace, %r — using it" % spaces[0].get("title"))
        return spaces[0]["id"]
    raise RuntimeError("no KV namespace titled %s in this account. Namespaces found: %s. "
                       "Pass --namespace <title> (the one bound as DATA in the worker), or "
                       "check the token has 'Workers KV Storage'."
                       % (" / ".join(repr(t) for t in titles),
                          ", ".join(s.get("title", "?") for s in spaces) or "none"))


# --------------------------------------------------------------------- writes
def _ns(cred, ns):
    return "/accounts/%s/storage/kv/namespaces/%s" % (cred["account"], ns)


def bulk_put(cred, ns, items):
    """items: [(key, value)] — value str (text) or bytes (binary, sent base64).
    Chunked under BULK_LIMIT. Returns the number of keys sent."""
    chunk, size, sent = [], 0, 0

    def flush():
        nonlocal chunk, size, sent
        body = json.dumps(chunk).encode("utf-8")
        log("  writing %d keys (%.1f MB)…" % (len(chunk), len(body) / 1e6))
        api(cred, "PUT", _ns(cred, ns) + "/bulk", body=body)
        sent += len(chunk)
        chunk, size = [], 0

    for k, v in items:
        if isinstance(v, (bytes, bytearray)):
            entry, n = {"key": k, "value": base64.b64encode(v).decode("ascii"), "base64": True}, len(v) * 4 // 3
        else:
            entry, n = {"key": k, "value": v}, len(v.encode("utf-8"))
        if n > VALUE_LIMIT:
            raise RuntimeError("%s is %.1f MB — over KV's 25 MB per-value cap" % (k, n / 1e6))
        if chunk and size + n + 64 > BULK_LIMIT:
            flush()
        chunk.append(entry)
        size += n + 64
    if chunk:
        flush()
    return sent


def bulk_delete(cred, ns, keys):
    keys = list(keys)
    for i in range(0, len(keys), 5000):
        api(cred, "DELETE", _ns(cred, ns) + "/bulk", body=keys[i:i + 5000])
    return len(keys)


def list_keys(cred, ns, prefix):
    """every key name under a prefix (paged by cursor)"""
    names, cursor = [], None
    while True:
        q = "?limit=1000&prefix=" + urllib.parse.quote(prefix, safe="")
        if cursor:
            q += "&cursor=" + urllib.parse.quote(cursor, safe="")
        j = api(cred, "GET", _ns(cred, ns) + "/keys" + q)
        names += [r["name"] for r in (j.get("result") or [])]
        cursor = ((j.get("result_info") or {}).get("cursor")) or None
        if not cursor:
            return names


def read_back(cred, ns, key):
    """the stored bytes, or None when the key is absent"""
    try:
        return api(cred, "GET", _ns(cred, ns) + "/values/" + urllib.parse.quote(key, safe=""), raw=True)
    except RuntimeError as e:
        if "HTTP 404" in str(e):
            return None
        raise


def verify(cred, ns, items, retries=6):
    """Every (key, value) read back and compared byte for byte. KV is
    eventually consistent: a fresh write can lag a read by seconds, so a
    mismatch is retried before it counts. Returns the list of bad keys."""
    bad = []
    for k, v in items:
        want = v if isinstance(v, (bytes, bytearray)) else v.encode("utf-8")
        got = None
        for attempt in range(retries):
            got = read_back(cred, ns, k)
            if got == want:
                break
            time.sleep(2 + attempt * 2)
        if got != want:
            bad.append(k + (": missing" if got is None else ": differs (%d vs %d bytes)" % (len(got), len(want))))
    return bad


# -------------------------------------------------------------------- helpers
def envelope(data, t=None):
    """the relay's snapshot shape, compact"""
    return json.dumps({"t": t or int(time.time() * 1000), "data": data},
                      ensure_ascii=False, separators=(",", ":"))


def relay_url(pipeline_root):
    """the worker's address, from site\\shared\\config.js beside the pipeline
    (config.js moved into shared\\ on 2026-09-08; the old root path is kept as
    a fallback). Comments are stripped first — the header carries an EXAMPLE
    address. Else env RELAY_URL."""
    for c in (os.path.join(pipeline_root, "..", "site", "shared", "config.js"),
              os.path.join(pipeline_root, "..", "site", "config.js")):
        if os.path.exists(c):
            cfg = open(c, encoding="utf-8").read()
            cfg = re.sub(r"/\*.*?\*/", "", cfg, flags=re.S)
            cfg = re.sub(r"(?m)^\s*//[^\n]*", "", cfg)
            m = re.search(r'PROXY_URL\s*=\s*"([^"]+)"', cfg)
            if m:
                return m.group(1).rstrip("/")
    return os.environ.get("RELAY_URL", "").rstrip("/") or None


def relay_get(url, timeout=20):
    """(status, bytes, content-type) from the public relay — what a visitor gets"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(300), e.headers.get("Content-Type", "")
