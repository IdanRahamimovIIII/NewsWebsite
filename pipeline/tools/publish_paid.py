#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_paid.py — puts the ministry-report documents (pipeline\\paid\\) into
Cloudflare KV, where the relay serves them to the budget page.

WHY (Mercy, 2026-09-06): "we should upload the ministry data as its own
dataset and make a script to update it once a month." The paid figures come
from the ministries' own quarterly .xlsx reports — the column BudgetKey's
parser drops — so no API has them; we collect them (refresh-data.yml,
monthly) and publish them ourselves. The site keeps no data: the budget page
asks the relay for /data/paid/index and /data/paid/<section>, and the relay
answers from KV.

WHAT IT WRITES (the contract the pages already expect, see
site\\HANDOFF-cloudflare-data.md and audit\\paidcheck.html):

  KV key               value (JSON, the relay's snapshot envelope)
  pub:paid/index       {"t": <ms>, "data": {"sections": ["0000", …]}}     = index.json
  pub:paid/<section>   {"t": <ms>, "data": {"sources": [...], "reports": {...},
                                             "orders": {"<order>:<code>": [paid, volume]}}}
                                                                            = <section>.json
  (.full.json is NEVER published — every column, ~240 MB; artifact only.)

The worker serves any `pub:<name>` key at /data/<name> (worker.js,
servePublished). One write per document per run: 53 keys, ~20 MB — nothing
next to KV's limits (25 MB per value, 1,000 writes/day on the free plan).

TRUST CONTENT, NOT STATUS WORDS (the D1 lesson of 2026-08-26): after
writing, every key is read back and compared to what was sent; the index and
the largest document are printed with their sizes. Then, if the relay's
address is known (site\\config.js), /data/paid/index is fetched through it
and the answer says whether the worker route is live.

WHO RUNS IT
  - Mercy: publish-paid.bat (double-click). Credentials from pipeline\\d1-config.json
    (account_id + api_token — the SAME token as the D1 upload, which needs
    the extra permission "Workers KV Storage: Edit"; add it in the dashboard
    under My Profile → API Tokens → Edit).
  - GitHub Actions: refresh-data.yml, monthly, with the repo secrets
    CF_API_TOKEN and CF_ACCOUNT_ID (env vars win over the config file).
    Without the secret the step prints a NOTE and skips (--optional).

Standard library only.

usage:
  publish_paid.py [--paid DIR] [--config FILE] [--namespace <KV title>]
                  [--dry-run] [--verify-only] [--optional]
"""
import argparse, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # pipeline\
API = "https://api.cloudflare.com/client/v4"
# the worker's KV namespace, bound as DATA. worker.js's header says to name
# it "our-money-data"; Mercy's account has it titled "DATA" (found 2026-09-06,
# first live run) — both are tried, and a lone namespace is taken as it is.
NAMESPACE_TITLES = ["our-money-data", "DATA"]
BULK_LIMIT = 40 * 1024 * 1024                     # bytes per bulk request (API cap is 100 MB)
VALUE_LIMIT = 25 * 1024 * 1024                    # KV's per-value cap
UA = "our-money publish_paid.py"


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- credentials
def credentials(config_path):
    """env first (CI), then the config file (Mercy's machine)."""
    tok, acct = os.environ.get("CF_API_TOKEN", "").strip(), os.environ.get("CF_ACCOUNT_ID", "").strip()
    ns_id = os.environ.get("CF_KV_NAMESPACE_ID", "").strip()
    src = "environment"
    if not (tok and acct):
        if not os.path.exists(config_path):
            return None
        with open(config_path, encoding="utf-8") as fh:
            cfg = json.load(fh)
        tok, acct = (cfg.get("api_token") or "").strip(), (cfg.get("account_id") or "").strip()
        ns_id = ns_id or (cfg.get("kv_namespace_id") or "").strip()
        src = config_path
    if not (tok and acct) or tok.startswith("<"):
        return None
    return {"token": tok, "account": acct, "namespace_id": ns_id, "source": src}


def api(cred, method, path, body=None, raw=False, content_type="application/json"):
    data = None
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + cred["token"],
                                          "Content-Type": content_type, "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read(600).decode("utf-8", "replace")
        raise RuntimeError("HTTP %d from Cloudflare on %s %s — %s" % (e.code, method, path, detail))
    if raw:
        return payload
    j = json.loads(payload.decode("utf-8"))
    if not j.get("success", False):
        raise RuntimeError("Cloudflare said no on %s %s: %s" % (method, path, json.dumps(j.get("errors"))[:600]))
    return j


def namespace_id(cred, title=None):
    """The KV namespace by TITLE — nobody has to copy an id into a file.
    --namespace names one explicitly; otherwise the known titles are tried,
    and if the account has exactly ONE namespace that is the worker's."""
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


# ------------------------------------------------------------------ documents
def load_documents(paid_dir):
    """index.json + every <section>.json it names. Refuses a section the
    index promises but the folder lacks — a half-published dataset must not
    look complete on the site."""
    idx_path = os.path.join(paid_dir, "index.json")
    if not os.path.exists(idx_path):
        sys.exit("no index.json in %s — that folder should hold the 52 <section>.json "
                 "documents plus index.json (from site\\_move-to-pipeline\\data\\paid, or "
                 "parse_all.py --out %s)" % (paid_dir, paid_dir))
    with open(idx_path, encoding="utf-8") as fh:
        index = json.load(fh)
    sections = list(index.get("sections") or [])
    if not sections:
        sys.exit("index.json names no sections — nothing to publish")
    docs, missing = {}, []
    for sec in sections:
        p = os.path.join(paid_dir, sec + ".json")
        if not os.path.exists(p):
            missing.append(sec)
            continue
        with open(p, encoding="utf-8") as fh:
            docs[sec] = json.load(fh)
    if missing:
        sys.exit("index.json names %d section(s) with no document in %s: %s"
                 % (len(missing), paid_dir, ", ".join(missing)))
    strays = sorted(n[:-5] for n in os.listdir(paid_dir)
                    if n.endswith(".json") and not n.endswith(".full.json")
                    and n != "index.json" and n[:-5] not in docs)
    if strays:
        log("note: %d document(s) not named by index.json are NOT published: %s"
            % (len(strays), ", ".join(strays)))
    return index, docs


def envelope(data, t):
    return json.dumps({"t": t, "data": data}, ensure_ascii=False, separators=(",", ":"))


def plan(index, docs):
    """[(key, value-string)] — index first, then sections in index order."""
    t = int(time.time() * 1000)
    items = [("pub:paid/index", envelope(index, t))]
    for sec in index["sections"]:
        items.append(("pub:paid/" + sec, envelope(docs[sec], t)))
    for k, v in items:
        n = len(v.encode("utf-8"))
        if n > VALUE_LIMIT:
            sys.exit("%s is %.1f MB — over KV's 25 MB per-value cap. Split the section "
                     "or move the overlay to D1." % (k, n / 1e6))
    return items


# --------------------------------------------------------------------- writes
def bulk_put(cred, ns, items):
    """PUT /bulk in chunks under BULK_LIMIT bytes. One request per chunk."""
    chunk, size, sent = [], 0, 0
    for k, v in items:
        n = len(v.encode("utf-8")) + len(k) + 40
        if chunk and size + n > BULK_LIMIT:
            _flush(cred, ns, chunk); sent += len(chunk); chunk, size = [], 0
        chunk.append({"key": k, "value": v}); size += n
    if chunk:
        _flush(cred, ns, chunk); sent += len(chunk)
    return sent


def _flush(cred, ns, chunk):
    body = json.dumps(chunk, ensure_ascii=False).encode("utf-8")
    log("  writing %d keys (%.1f MB)…" % (len(chunk), len(body) / 1e6))
    api(cred, "PUT", "/accounts/%s/storage/kv/namespaces/%s/bulk" % (cred["account"], ns), body=body)


def read_back(cred, ns, key):
    path = "/accounts/%s/storage/kv/namespaces/%s/values/%s" % (
        cred["account"], ns, urllib.parse.quote(key, safe=""))
    try:
        return api(cred, "GET", path, raw=True).decode("utf-8")
    except RuntimeError as e:
        if "HTTP 404" in str(e):
            return None
        raise


def verify(cred, ns, items):
    """Every key read back and compared byte-for-byte with what was sent.
    KV is eventually consistent: a fresh write can take a few seconds to be
    visible to a read — retry a mismatch a few times before calling it wrong."""
    bad = []
    for k, v in items:
        got = None
        for attempt in range(6):
            got = read_back(cred, ns, k)
            if got == v:
                break
            time.sleep(2 + attempt * 2)
        if got != v:
            bad.append(k + (": missing" if got is None else ": differs (%d vs %d bytes)"
                            % (len(got.encode("utf-8")), len(v.encode("utf-8")))))
    return bad


def relay_check(relay):
    """Does the WORKER serve it? (the pages read the relay, not KV)"""
    url = relay.rstrip("/") + "/data/paid/index"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.loads(r.read().decode("utf-8"))
        secs = ((j.get("data") or {}).get("sections")) or []
        return True, "%s → %d sections, published %s" % (
            url, len(secs), time.strftime("%Y-%m-%d %H:%M", time.localtime((j.get("t") or 0) / 1000)))
    except urllib.error.HTTPError as e:
        body = e.read(200).decode("utf-8", "replace")
        if e.code == 404 and "Unknown dataset" in body:
            return False, ("%s → 404 'Unknown dataset': the WORKER is the old one. Paste the new "
                           "worker.js into the Cloudflare dashboard and Deploy." % url)
        return False, "%s → HTTP %d %s" % (url, e.code, body.strip()[:120])
    except Exception as e:
        return False, "%s → %s" % (url, e)


def relay_from_config():
    for c in (os.path.join(ROOT, "..", "site", "config.js"),):
        if os.path.exists(c):
            cfg = open(c, encoding="utf-8").read()
            cfg = re.sub(r"/\*.*?\*/", "", cfg, flags=re.S)
            cfg = re.sub(r"(?m)^\s*//[^\n]*", "", cfg)
            m = re.search(r'PROXY_URL\s*=\s*"([^"]+)"', cfg)
            if m:
                return m.group(1).rstrip("/")
    return os.environ.get("RELAY_URL", "").rstrip("/") or None


# ----------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--paid", default=os.path.join(ROOT, "paid"), help="folder with index.json + <section>.json")
    ap.add_argument("--config", default=os.path.join(ROOT, "d1-config.json"),
                    help="JSON with account_id + api_token (env CF_API_TOKEN/CF_ACCOUNT_ID win)")
    ap.add_argument("--namespace", default=None,
                    help="KV namespace TITLE (default: try %s, else the account's only one)"
                         % " / ".join(NAMESPACE_TITLES))
    ap.add_argument("--dry-run", action="store_true", help="show what would be written, touch nothing")
    ap.add_argument("--verify-only", action="store_true", help="compare KV with the local documents, write nothing")
    ap.add_argument("--optional", action="store_true",
                    help="no credentials → print a NOTE and exit 0 (for the workflow)")
    ap.add_argument("--relay", default=None, help="relay base url for the final route check (default: site/config.js)")
    a = ap.parse_args()

    index, docs = load_documents(a.paid)
    items = plan(index, docs)
    total = sum(len(v.encode("utf-8")) for _, v in items)
    biggest = max(items[1:], key=lambda kv: len(kv[1].encode("utf-8")))
    orders = sum(len(d.get("orders") or {}) for d in docs.values())
    log("paid documents: %d sections · %s orders · %.1f MB · largest %s (%.1f MB)"
        % (len(docs), format(orders, ","), total / 1e6, biggest[0], len(biggest[1].encode("utf-8")) / 1e6))

    if a.dry_run:
        for k, v in items:
            log("  %-22s %8.1f KB" % (k, len(v.encode("utf-8")) / 1024))
        log("dry run — nothing written.")
        return

    cred = credentials(a.config)
    if not cred:
        msg = ("no Cloudflare credentials: set CF_API_TOKEN + CF_ACCOUNT_ID, or fill account_id "
               "and api_token in %s (the D1 token, with 'Workers KV Storage: Edit' added)." % a.config)
        if a.optional:
            log("NOTE: " + msg + " The documents were NOT published this run.")
            return
        sys.exit(msg)
    log("credentials from %s · account %s…" % (cred["source"], cred["account"][:6]))
    try:
        ns = namespace_id(cred, a.namespace)
        log("KV namespace = %s" % ns)
        if not a.verify_only:
            n = bulk_put(cred, ns, items)
            log("wrote %d keys." % n)
        log("reading every key back…")
        bad = verify(cred, ns, items)
    except RuntimeError as e:          # a Cloudflare answer, said plainly — not a traceback
        sys.exit("\n" + str(e))
    if bad:
        for b in bad:
            log("  ✘ " + b)
        sys.exit("%d of %d keys do not match what was sent — the dataset in KV is NOT complete. "
                 "Run again; if it persists, the answer above says which key." % (len(bad), len(items)))
    log("  ✔ all %d keys match byte for byte (index + %d sections)." % (len(items), len(docs)))

    relay = a.relay or relay_from_config()
    if relay:
        ok, msg = relay_check(relay)
        log(("  ✔ the relay serves it: " if ok else "  ✘ the relay does not serve it yet: ") + msg)
    else:
        log("  (relay address unknown — pass --relay to check the worker route)")
    log("done. paidcheck.html (audit.bat) shows the same thing the budget page sees.")


if __name__ == "__main__":
    main()
