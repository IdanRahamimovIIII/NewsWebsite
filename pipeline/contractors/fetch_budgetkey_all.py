#!/usr/bin/env python3
"""
fetch_budgetkey_all.py — collect the whole BudgetKey side, section by section.

WHY A DRIVER AND NOT ONE BIG RUN
  contract_spending is ~1,036,112 rows and SELECT * rows carry the payments[]
  history — the full pull is on the order of 1.5 GB of JSON. Accumulating
  that in one process risks the runner's memory, and one crash near the end
  would lose everything. So: ONE OUTPUT FILE PER BUDGET SECTION
  (build/raw/<section>.json), written and freed as each section completes.
  A section whose file already exists is skipped, so the collection is
  resumable across runs for free — the same manifest idea as the reports.

  fetch_budgetkey.py itself is untouched: it already collects one section
  correctly (counts first, pages by what actually came back, keeps every
  column except the two rule-7 averages). This only drives it.

RULES: BudgetKey is collected RAW and kept SEPARATE (Mercy) —
  nothing here is combined with the ministry files or the registers.

usage:
  fetch_budgetkey_all.py --out build/raw [--sections 0020,0024]
                         [--deadline-minutes 240]
"""
import argparse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_budgetkey as K
import fetch_reports as R      # read-only: for the real section list


def section_list(log=print):
    """The budget's own sections, like the reports fetcher uses; the
       0001..0099 sweep only if BudgetKey cannot answer."""
    try:
        secs = R.sections_from_budget(log=log)
        return sorted(secs)
    except Exception as e:
        log("  section list failed (%s) — sweeping 0001..0099" % e)
        return ["%04d" % n for n in range(1, 100)]


def run(outdir, sections=None, deadline_minutes=0, log=print):
    os.makedirs(outdir, exist_ok=True)
    deadline = (time.time() + deadline_minutes * 60) if deadline_minutes else None
    sections = sections or section_list(log=log)

    done = skipped = 0
    failed, stopped_early = [], False
    for sec in sections:
        path = os.path.join(outdir, sec + ".json")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            skipped += 1
            continue                       # collected on a previous run
        if deadline is not None and time.time() >= deadline:
            stopped_early = True
            remaining = [s for s in sections
                         if not os.path.exists(os.path.join(outdir, s + ".json"))]
            log("time budget reached with %d sections still to collect — "
                "stopping cleanly; they continue next run" % len(remaining))
            break
        log("section %s…" % sec)
        try:
            K.run([sec], path, log=log)
            done += 1
        except Exception as e:
            failed.append(sec)
            log("  x %s failed: %s" % (sec, str(e)[:200]))
            # a half-written file must not masquerade as a collected section
            if os.path.exists(path):
                os.unlink(path)
        time.sleep(1.0)                    # be a polite guest

    status = {"collected_this_run": done, "already_had": skipped,
              "failed": failed, "stopped_early": stopped_early}
    with open(os.path.join(outdir, "status.json"), "w", encoding="utf-8") as fh:
        json.dump(status, fh, ensure_ascii=False, indent=1)
    log("collected %d · already had %d · failed %d%s"
        % (done, skipped, len(failed),
           " · stopped early" if stopped_early else ""))
    if failed:
        log("failed sections (retry next run): %s" % " ".join(failed))
    return status


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sections", default="",
                    help="comma separated; blank = the real list from raw_budget")
    ap.add_argument("--deadline-minutes", type=int, default=0)
    a = ap.parse_args()
    secs = [s.strip() for s in a.sections.split(",") if s.strip()] or None
    if secs and any(not s.isdigit() for s in secs):
        sys.exit("sections must be digits only")
    st = run(a.out, secs, a.deadline_minutes)
    # failures are loud (the step goes red, GitHub emails) but partial data
    # is still cached and uploaded — nothing is lost, only unfinished
    sys.exit(1 if st["failed"] else 0)
