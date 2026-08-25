#!/usr/bin/env python3
"""
test_budgetkey_all.py — the BudgetKey section driver, network replaced by
fakes. Its own file, its own workflow; nothing the other pipelines use.

    python3 tests/test_budgetkey_all.py
"""
import json, os, sys, tempfile, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import fetch_budgetkey_all as A
import fetch_budgetkey as K

PASS = FAIL = 0

def ok(name, cond, info=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  ✔ " + name)
    else:
        FAIL += 1; print("  ✘ " + name + ("  → " + str(info) if info else ""))


calls = []
def fake_krun(sections, out_path, log=print):
    calls.append(sections[0])
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump([{"order_id": "45001", "budget_code": sections[0] + "000000"}], fh)
    return {"rows": 1, "orders": 1, "missing": []}
K.run, _real = fake_krun, K.run

print("\none file per section, resumable:")
with tempfile.TemporaryDirectory() as d:
    st = A.run(d, sections=["0020", "0024", "0033"], log=lambda *a: None)
    ok("every section got its own file",
       sorted(f for f in os.listdir(d) if f != "status.json")
       == ["0020.json", "0024.json", "0033.json"], os.listdir(d))
    ok("status says so", st["collected_this_run"] == 3 and st["failed"] == [], st)

    calls.clear()
    st2 = A.run(d, sections=["0020", "0024", "0033"], log=lambda *a: None)
    ok("a second run skips everything already collected",
       calls == [] and st2["already_had"] == 3, (calls, st2))

print("\none section failing must not stop the rest, and leaves no debris:")
def flaky(sections, out_path, log=print):
    if sections[0] == "0024":
        with open(out_path, "w") as fh:
            fh.write("[half a fi")          # crash mid-write
        raise RuntimeError("budgetkey hiccup")
    return fake_krun(sections, out_path, log)
K.run = flaky
with tempfile.TemporaryDirectory() as d:
    st = A.run(d, sections=["0020", "0024", "0033"], log=lambda *a: None)
    ok("the other sections were still collected",
       st["collected_this_run"] == 2, st)
    ok("the failure is named for the next run", st["failed"] == ["0024"], st)
    ok("no half-written file survives to masquerade as data",
       not os.path.exists(os.path.join(d, "0024.json")))

print("\nthe time budget stops cleanly:")
K.run = fake_krun
calls.clear()
with tempfile.TemporaryDirectory() as d:
    st = A.run(d, sections=["0020", "0024"], deadline_minutes=-1,
               log=lambda *a: None)
    ok("a spent budget collects nothing but stops CLEANLY with status written",
       calls == [] and st["stopped_early"] is True
       and os.path.exists(os.path.join(d, "status.json")), st)

K.run = _real
print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
