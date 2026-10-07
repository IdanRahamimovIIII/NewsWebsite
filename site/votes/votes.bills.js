"use strict";
/* =====================================================================
   votes.bills.js — the second tab: bills in the legislative process
   Self-contained: its own search, its own list, its own row detail.
   ===================================================================== */

/* ---------- TAB 2: bills in the legislative process ---------- */
function setTab(tab) {
  state.tab = tab;
  document.getElementById("votesTab").style.display = tab === "votes" ? "" : "none";
  document.getElementById("billsTab").style.display = tab === "bills" ? "" : "none";
  document.getElementById("st-votes").classList.toggle("on", tab === "votes");
  document.getElementById("st-bills").classList.toggle("on", tab === "bills");
  if (tab === "bills" && !state.btab) loadBTab();
}

const votedOnStatus = id => /התקבל|אושר|נדח|הוסרה/.test(state.statuses[id] || "");

async function loadBTab() {
  state.btab = { src: [], page: 1 };
  try {
    await ensureStatuses();
    // fill the stage dropdown: the shortcuts, then every official status
    const sel = document.getElementById("bstatus");
    const names = Object.entries(state.statuses)
      .filter(([, d]) => d).sort((a, b) => a[1].localeCompare(b[1]));
    sel.innerHTML = `<option value="all">${esc(t("allOpt"))}</option>
      <option value="voted">${esc(t("bVoted"))}</option>
      <option value="not">${esc(t("bNot"))}</option>` +
      names.map(([id, d]) => `<option value="${id}">${esc(d)}</option>`).join("");
  } catch (e) { debug("statuses: " + e.message); }
  runBSearch();
}

function bFilter() {
  const q = document.getElementById("bq").value.trim();
  const st = document.getElementById("bstatus").value;
  const tp = document.getElementById("btype").value;
  const from = document.getElementById("bfrom").value;
  const to = document.getElementById("bto").value;
  const f = [];
  if (q) f.push(`substringof('${encodeURIComponent(q.replace(/'/g, "''"))}',Name) eq true`);
  if (/^\d+$/.test(st)) f.push(`StatusID eq ${st}`);
  if (/^\d+$/.test(tp)) f.push(`SubTypeID eq ${tp}`);
  if (from) f.push(`LastUpdatedDate ge datetime'${from}T00:00:00'`);
  if (to) f.push(`LastUpdatedDate le datetime'${to}T23:59:59'`);
  // the voted / never-voted shortcuts as the status ids they mean — filtering
  // AFTER the fetch left pages short and the count wrong
  if (st === "voted" || st === "not") {
    const ids = Object.keys(state.statuses).filter(id => votedOnStatus(id) === (st === "voted"));
    if (ids.length) f.push("(" + ids.map(id => `StatusID eq ${+id}`).join(" or ") + ")");
  }
  return f.join(" and ");
}
/* one page of the server's list (the site-wide pager: LIST_PAGE a page) */
function bQuery(page) {
  const f = bFilter();
  return `KNS_Bill()?${f ? "$filter=" + f + "&" : ""}$orderby=LastUpdatedDate desc&$skip=${(page - 1) * LIST_PAGE}&$top=${LIST_PAGE}`;
}
/* how many match — the service refuses a bare $count, so an always-true filter */
async function bCount() {
  return +(await viaRelay(PARL + "KNS_Bill()/$count?$filter=" + (bFilter() || "BillID gt 0"))) || 0;
}

async function runBSearch() {
  const box = document.getElementById("blist");
  box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
  const initName = document.getElementById("binit").value.trim();
  if (state.btabPickFor !== initName) { state.btabPickName = null; state.btabPickFor = initName; }
  try {
    await ensureStatuses();
    if (initName) return runInitiatorSearch(initName);
    const [rows, total] = await Promise.all([od(PARL, bQuery(1)), bCount().catch(e => { debug("bcount: " + e.message); return null; })]);
    state.btab = { src: rows, page: 1, total, server: true };
    renderBTab();
  } catch (e) {
    debug("bsearch: " + e.message);
    // the plain "latest bills" view survives the Knesset not answering: the
    // snapshot's 15 newest (worker DATASETS.bills), labelled as exactly that
    const plain = !initName && ["bq", "bstatus", "btype", "bfrom", "bto"].every(id => { const v = document.getElementById(id).value.trim(); return !v || v === "all"; });
    const saved = plain ? await dataset("bills").then(d => (d && d.bills) || []).catch(() => []) : [];
    if (saved.length) {
      state.btab = { src: saved, page: 1, note: t("snapLatest").replace("{n}", saved.length)
        .replace("{d}", DS_T.bills ? fmtDate(new Date(DS_T.bills)) : "") };
      renderBTab();
      return;
    }
    box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`;
  }
}

/* "what did X bring to the table" — bills by initiator, via the persons directory */
async function runInitiatorSearch(initName) {
  const box = document.getElementById("blist");
  const r = await personBills(state.btabPickName || initName);
  if (!r) { box.innerHTML = `<div class="error">${esc(t("advNoMk"))}</div>`; return; }
  if (r.pick) {
    box.innerHTML = `<div class="hint" style="margin:0 0 8px">${esc(t("advPickMk"))}</div>` +
      r.pick.map(n =>
        `<button class="votechip" style="margin:0 4px 6px 0" onclick="state.btabPickName=${JSON.stringify(n).replace(/"/g, "&quot;")};runBSearch()">${esc(n)}</button>`).join(" ");
    return;
  }
  const chosen = r.chosen;
  let bills = r.bills.slice();
  // apply the other filters client-side on the fetched set
  const q = document.getElementById("bq").value.trim();
  const st = document.getElementById("bstatus").value;
  const tp = document.getElementById("btype").value;
  const from = document.getElementById("bfrom").value;
  const to = document.getElementById("bto").value;
  if (q) bills = bills.filter(b => textMatch(b.Name, q));
  if (/^\d+$/.test(st)) bills = bills.filter(b => +b.StatusID === +st);
  if (/^\d+$/.test(tp)) bills = bills.filter(b => +b.SubTypeID === +tp);
  if (from) bills = bills.filter(b => String(dateOf(b.LastUpdatedDate) && dateOf(b.LastUpdatedDate).toISOString()).slice(0, 10) >= from);
  if (to) bills = bills.filter(b => String(dateOf(b.LastUpdatedDate) && dateOf(b.LastUpdatedDate).toISOString()).slice(0, 10) <= to);
  bills.sort((a, b) => (dateOf(b.LastUpdatedDate) || 0) - (dateOf(a.LastUpdatedDate) || 0));
  state.btab = { src: bills, page: 1, initiator: chosen, initTotal: r.total };
  renderBTab();
}

/* the pager's page n: the server's list fetches that page; a list held in
   memory (by initiator, the saved copy) just shows it */
async function btabPage(n) {
  toTop();
  const bt = state.btab;
  if (!bt) return;
  if (bt.server) {
    document.getElementById("blist").innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
    try { bt.src = await od(PARL, bQuery(n)); bt.page = n; }
    catch (e) { debug("bpage: " + e.message); }
  } else bt.page = n;
  renderBTab();
}

function renderBTab() {
  const box = document.getElementById("blist");
  if (!state.btab) return;
  const st = document.getElementById("bstatus").value;
  const bt = state.btab, src = bt.src;
  let all = src.map((b, i) => ({ b, i }));
  // a list held in memory filters the voted / never-voted shortcuts here (the server's has them in its filter)
  if (!bt.server && st === "voted") all = all.filter(x => votedOnStatus(x.b.StatusID));
  if (!bt.server && st === "not") all = all.filter(x => !votedOnStatus(x.b.StatusID));
  // the server's list is one page; its count may have failed → open-ended until a short page
  const pages = !bt.server ? pageCount(all.length) : bt.total !== null && bt.total !== undefined ? pageCount(bt.total)
    : src.length < LIST_PAGE ? bt.page : null;
  if (!bt.server && bt.page > pages) bt.page = pages;
  const shown = bt.server ? all : all.slice((bt.page - 1) * LIST_PAGE, bt.page * LIST_PAGE);
  state.billArr = src;
  let html = state.btab.initiator
    ? `<div class="hint" style="margin:0 0 8px"><b>${esc(t("bInitHdr"))} ${esc(state.btab.initiator)}</b> · ${state.btab.initTotal}</div>`
    : "";
  if (state.btab.note) html = `<div class="snapnote">${esc(state.btab.note)}</div>` + html;
  html += shown.map(({ b, i }) => `<button class="vote" onclick="toggleBill(${i})">
      <div class="vtitle">${rowHeadHtml(b._open, b.Name, "")}</div>
      <div class="vmeta"><span>${esc(state.statuses[b.StatusID] || "")}</span><span>${fmtDate(b.LastUpdatedDate)}</span></div>
    </button>` + (b._open ? `<div class="kidsbox">${billItemHtml(b._item, b._docs, i, b._initsOpen, b)}</div>` : "")).join("");
  if (!shown.length) html += `<div class="loading">${esc(t("empty"))}</div>`;
  html += pagerHtml(bt.page, pages, "btabPage", bt.page);
  box.innerHTML = html;
}

async function toggleBill(idx) {
  const b = (state.billArr || [])[idx];
  if (!b) return;
  if (b._open) { b._open = false; renderBTab(); return; }
  b._open = true;
  if (!b._item) {
    renderBTab();
    try {
      const [item, docs] = await Promise.all([
        viaRelay("https://knesset.gov.il/WebSiteApi/knessetapi/LegislationItem/GetLegislationBillItem?ItemId=" + (+b.BillID)),
        od(PARL, `KNS_DocumentBill()?$filter=BillID eq ${+b.BillID}&$top=40`).catch(() => []),
      ]);
      b._item = item;
      b._docs = docs;
    } catch (e) {
      b._item = { _err: true };
      debug("billitem: " + e.message);
    }
  }
  renderBTab();
}
