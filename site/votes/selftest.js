"use strict";
/* =====================================================================
   selftest.js — runs the REAL search code against the REAL data
   ---------------------------------------------------------------------
   Why this exists: every bug that reached Mercy got past tests built on
   mock data. This runs the actual page functions (doSearch / advSearch /
   currentList) against the live Knesset data and our own index, checks what
   came back, and POSTs the report to the worker so Claude can read exactly
   what happened — no screenshots, no copying.
   ===================================================================== */

const T = [];                       // results
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function record(name, ok, info, ms) {
  T.push({ name, ok: !!ok, info: String(info || "").slice(0, 400), ms: ms || 0 });
  render();
}
function render() {
  const bad = T.filter(x => !x.ok).length;
  $("sum").textContent = bad ? `${bad} בדיקות נכשלו מתוך ${T.length}` : `${T.length} בדיקות — הכול תקין`;
  $("out").innerHTML = T.map(x =>
    `<div class="row"><div class="st ${x.ok ? "ok" : "bad"}">${x.ok ? "✔" : "✘"}</div>
       <div class="name">${esc(x.name)}${x.ms ? ` <span class="info">(${x.ms}ms)</span>` : ""}
         ${x.info ? `<div class="info">${esc(x.info)}</div>` : ""}</div></div>`).join("");
}

/* wait until the page has genuinely finished working */
async function settle(maxMs) {
  const t0 = Date.now();
  await sleep(300);
  while (Date.now() - t0 < (maxMs || 60000)) {
    const busy = state.advWork || state.deepWork ||
      /בודק|מחפש|טוען|מאמת/.test(($("votes").textContent || ""));
    if (!busy) { await sleep(200); return Date.now() - t0; }
    await sleep(250);
  }
  return Date.now() - t0;
}

/* set the controls exactly as a person would, then press search.
   NOTE: don't call advClear() here — it kicks off a search of its own that
   finishes later and overwrites the one we're measuring. */
function resetControls() {
  ["q", "advmk", "advinit", "advfrom", "advto"].forEach(id => { $(id).value = ""; });
  $("advtype").value = "all";
  $("advresult").value = "all";
  state.adv = null; state.advGroups = null; state.advPickList = null; state.found = null;
  state.advWork = null; state.advCursor = 0; state.advAllChecked = false;
  state.mkSel = null; state.q = ""; state.page = 1;
  state.advSeq++; state.deepSeq++;
}
async function search(opts) {
  resetControls();
  $("q").value = opts.q || "";
  $("advmk").value = opts.mk || "";
  $("advinit").value = opts.init || "";
  $("advtype").value = opts.tp || "all";
  $("advfrom").value = opts.from || "";
  $("advto").value = opts.to || "";
  $("advresult").value = opts.res || "all";
  const t0 = Date.now();
  await doSearch();
  const ms = await settle(opts.maxMs) + (Date.now() - t0);
  return { ms, list: currentList(), shown: state.shown || [] };
}

const dateOfRow = g => { const d = dateOf(g.date); return d ? d.getTime() : 0; };
const isDescending = list => list.every((g, i) => i === 0 || dateOfRow(list[i - 1]) >= dateOfRow(g));

/* ---------------- the scenarios ---------------- */
async function runAll() {
  T.length = 0;
  $("run").disabled = true;
  $("sum").textContent = "רץ…";

  try {
    /* 0. the basics */
    await settle(30000);
    record("העמוד נטען עם הצבעות אחרונות", (state.groups || []).length > 0,
           `${(state.groups || []).length} קבוצות בפיד`);

    const meta = await idxMeta();
    record("המאגר שלנו זמין", !!meta,
           meta ? `${meta.rows} הצבעות · ${Object.keys(meta.years || {}).length} שנים` : "אין מאגר — הדף עובד במצב איטי");

    /* 1. plain law-name search — the most important path */
    let r = await search({ q: "חוק" });
    record("חיפוש לפי שם חוק מחזיר תוצאות", r.list.length > 0, `${r.list.length} תוצאות`, r.ms);
    record("חיפוש שם חוק מהיר", r.ms < 8000, `${r.ms}ms`, r.ms);
    record("התוצאות ממוינות מהחדש לישן", isDescending(r.list),
           r.list.slice(0, 3).map(g => fmtDate(g.date)).join(" , "));
    if (meta) {
      const oldest = r.list.length ? fmtDate(r.list[r.list.length - 1].date) : "";
      record("החיפוש מגיע גם לשנים ישנות",
             r.list.some(g => dateOfRow(g) < Date.parse("2019-01-01")), "הישן ביותר: " + oldest);
    }

    /* 2. the search that broke: type only, nothing else */
    r = await search({ tp: "54", maxMs: 90000 });
    const shownTp = r.shown.filter(g => g._bill && g._bill !== "loading");
    record("חיפוש לפי סוג בלבד (פרטית) מחזיר תוצאות", r.list.length > 0,
           `${r.list.length} תוצאות · נבדקו ${state.advCursor || 0} מועמדות`, r.ms);
    record("כל התוצאות באמת פרטיות",
           shownTp.length > 0 && shownTp.every(g => g._bill.subType === "פרטית"),
           shownTp.slice(0, 3).map(g => (g._bill || {}).subType || "?").join(" , "));

    /* 3. result filter */
    r = await search({ res: "passed", maxMs: 90000 });
    record("סינון לפי תוצאה (התקבלה) מחזיר תוצאות", r.list.length > 0, `${r.list.length} תוצאות`, r.ms);
    record("כל התוצאות באמת התקבלו", r.shown.every(g => g._passed === true),
           r.shown.slice(0, 3).map(g => String(g._passed)).join(" , "));

    /* 4. a person's bills — the slow, historically wrong path.
       Test any MK by adding ?mk=שם to this page's address. */
    const who = new URLSearchParams(location.search).get("mk") || "יאיר לפיד";
    r = await search({ init: who, maxMs: 120000 });
    const a = state.adv || {};
    record(`חיפוש "הוגשה על ידי ${who}" מוצא את ההצעות שלו`,
           (a.initBills || []).length > 0, `${(a.initBills || []).length} הצעות חוק`, r.ms);
    record("אף תוצאה לא מוצגת לפני שאומתה",
           r.shown.every(g => g._initOk === true || g._initOk === null),
           `מוצגות ${r.shown.length} · אומתו ${(state.advGroups || []).filter(g => g._initOk === true).length} · נדחו ${(state.advGroups || []).filter(g => g._initOk === false).length}`);
    record("הבדיקה נעצרת אחרי שהעמוד מלא",
           (state.advCursor || 0) <= 200,
           `נבדקו ${state.advCursor || 0} מתוך ${(state.advGroups || []).length} מועמדות`, r.ms);

    /* 5. the proposers rule: 4 or fewer named, more than 4 counted */
    if (r.shown.length) {
      await openGroup(0);
      await sleep(2500);
      const g = state.shown[0];
      const names = (g && g._bill && g._bill !== "loading" && g._bill.names) || [];
      const txt = $("votes").textContent || "";
      record("רשימת מגישים לפי הכלל (עד 4 שמות, יותר מזה — מספר)",
             names.length === 0 || names.length <= 4 || txt.includes(names.length + " חברי כנסת"),
             `${names.length} מגישים`);
      await openGroup(0);
    }

    /* 5b. the panel layout Mercy specified */
    r = await search({ q: "חוק", maxMs: 60000 });
    if (r.shown.length) {
      // find a row that took several votes, so the collapsing is exercised
      let k = r.shown.findIndex(g => g.votes.length > 1);
      if (k < 0) k = 0;
      await openGroup(k);
      // wait for the bill behind the vote, or the layout check is vacuous
      for (let n = 0; n < 40; n++) {
        const gg = state.shown[k];
        if (gg && gg._bill && gg._bill !== "loading" && gg._detById &&
            gg._detById[gg._active] && gg._detById[gg._active] !== "loading") break;
        await sleep(300);
      }
      await sleep(400);
      const box = document.querySelector("#votes .kidsbox");
      const txt = box ? box.textContent.replace(/\s+/g, " ").trim() : "";
      const g = state.shown[k];
      const kids = box ? [...box.children].map(c => c.textContent.trim()).filter(Boolean) : [];
      record("התוצאה לא מוצגת פעמיים (רק בשורה למעלה)",
             !/ההצעה התקבלה|ההצעה לא התקבלה/.test(txt), txt.slice(0, 120));
      const hasNames = !!(g._bill && g._bill !== "loading" && (g._bill.names || []).length);
      record("״הוגשה על ידי״ הוא הדבר הראשון בפרטים",
             !hasNames || /הוגשה על ידי/.test(kids[0] || ""),
             (kids[0] || "אין פרטים").slice(0, 80) + (hasNames ? "" : " (אין מגישים לחוק הזה)"));
      record("״מסמכים רשמיים״ הוא הדבר האחרון",
             !/מסמכים רשמיים/.test(txt) || /מסמכים רשמיים/.test(kids[kids.length - 1] || ""),
             (kids[kids.length - 1] || "").slice(0, 80));
      if (g.votes.length > 1) {
        const chips = box ? box.querySelectorAll(".votechip").length : 0;
        record("מוצגת רק ההצבעה המכרעת, השאר מאחורי כפתור",
               chips <= 2 && txt.includes(g.votes.length + " הצבעות"),
               `${g.votes.length} הצבעות · ${chips} כפתורים`);
        toggleInstances(k);
        await sleep(400);
        const after = document.querySelectorAll("#votes .kidsbox .votechip").length;
        record("לחיצה פותחת את כל ההצבעות", after > 2, `${after} כפתורים אחרי פתיחה`);
        toggleInstances(k);
      }
      await openGroup(k);
    }

    /* 6. a person's voting record */
    r = await search({ q: who, maxMs: 60000 });
    record("חיפוש לפי שם חבר כנסת עובד",
           !!state.mkSel || r.list.length > 0,
           state.mkSel ? "נפתחה רשומת ההצבעה של " + state.mkSel.mk.Name : `${r.list.length} תוצאות`, r.ms);
  } catch (e) {
    record("הבדיקות רצו עד הסוף", false, "שגיאה: " + (e && e.message));
  }

  resetControls();
  renderVotes();
  $("run").disabled = false;
  await sendReport();
}

/* hand the report to the worker so Claude can read it directly */
async function sendReport() {
  const report = {
    when: new Date().toISOString(),
    page: (typeof PAGE_VER !== "undefined") ? PAGE_VER : "?",
    ua: navigator.userAgent.slice(0, 120),
    passed: T.filter(x => x.ok).length,
    failed: T.filter(x => !x.ok).length,
    tests: T,
  };
  try {
    const res = await fetch(PROXY + "/qa/report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    $("stamp").textContent = res.ok
      ? "הדוח נשלח — קלוד יכול לקרוא אותו עכשיו. " + new Date().toLocaleString("he-IL")
      : "הדוח לא נשלח (Worker ישן? הדביקי את worker.js העדכני): HTTP " + res.status;
  } catch (e) {
    $("stamp").textContent = "הדוח לא נשלח: " + e.message;
  }
}

applyLang();
$("sum").textContent = "מוכן — לחצי ״הרצת הבדיקות״.";
