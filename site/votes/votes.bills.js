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
  state.btab = { src: [], noMore: false };
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

function bFilters(skip) {
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
  return `KNS_Bill()?${f.length ? "$filter=" + f.join(" and ") + "&" : ""}$orderby=LastUpdatedDate desc&$skip=${skip || 0}&$top=40`;
}

async function runBSearch() {
  const box = document.getElementById("blist");
  box.innerHTML = `<div class="loading">${esc(t("loading"))}</div>`;
  const initName = document.getElementById("binit").value.trim();
  if (state.btabPickFor !== initName) { state.btabPickName = null; state.btabPickFor = initName; }
  try {
    await ensureStatuses();
    if (initName) return runInitiatorSearch(initName);
    const rows = await od(PARL, bFilters(0));
    state.btab = { src: rows, noMore: rows.length < 40 };
    renderBTab();
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(friendly(e))}</div>`;
    debug("bsearch: " + e.message);
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
  state.btab = { src: bills, noMore: true, initiator: chosen, initTotal: r.total };
  renderBTab();
}

async function btabMore() {
  try {
    const more = await od(PARL, bFilters(state.btab.src.length));
    if (more.length < 40) state.btab.noMore = true;
    state.btab.src = state.btab.src.concat(more);
    renderBTab();
  } catch (e) { debug("bmore: " + e.message); }
}

function renderBTab() {
  const box = document.getElementById("blist");
  if (!state.btab) return;
  const st = document.getElementById("bstatus").value;
  let src = state.btab.src;
  // the voted / never-voted shortcuts filter by the official status text
  let shown = src.map((b, i) => ({ b, i }));
  if (st === "voted") shown = shown.filter(x => votedOnStatus(x.b.StatusID));
  if (st === "not") shown = shown.filter(x => !votedOnStatus(x.b.StatusID));
  state.billArr = src;
  let html = state.btab.initiator
    ? `<div class="hint" style="margin:0 0 8px"><b>${esc(t("bInitHdr"))} ${esc(state.btab.initiator)}</b> · ${state.btab.initTotal}</div>`
    : "";
  html += shown.map(({ b, i }) => `<button class="vote" onclick="toggleBill(${i})">
      <div class="vtitle">${b._open ? "▾" : "▸"} ${esc(b.Name)}</div>
      <div class="vmeta"><span>${esc(state.statuses[b.StatusID] || "")}</span><span>${fmtDate(b.LastUpdatedDate)}</span></div>
    </button>` + (b._open ? `<div class="kidsbox">${billItemHtml(b._item, b._docs, i, b._initsOpen)}</div>` : "")).join("");
  if (!shown.length) html += `<div class="loading">${esc(t("empty"))}</div>`;
  if (!state.btab.noMore)
    html += `<div class="pager"><button class="votechip" onclick="btabMore()">${esc(t("moreBills"))}</button></div>`;
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
