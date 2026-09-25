"use strict";
/* =====================================================================
   Our Money — shared code for all pages
   Load order in every page:  config.js → common.js → the page's script.
   Each page defines:
     window.PAGE = "budget" | "votes" | "court"   (which nav tab is active)
     window.PAGE_STR = { he: {...}, en: {...} }   (page-specific strings)
     window.onLangChange = () => { ...re-render data-driven parts... }
   ===================================================================== */

/* ---------- shared strings ---------- */
const COMMON_STR = {
  he: {
    title: "הכסף שלנו",
    navBudget: "התקציב",
    navVotes: "הצבעות וחקיקה",
    navMk: "חברי הכנסת",
    navCourt: "בית המשפט העליון",
    loading: "טוען נתונים…",
    searchBtn: "חיפוש",
    empty: "לא נמצאו תוצאות.",
    credit: "מקורות המידע: ",
    err: "שגיאה בטעינת הנתונים. נסו שוב מאוחר יותר.",
    updatedAt: "הנתונים עודכנו: ",
    errCors: "המידע הזה דורש ממסר (relay). פתחו את README.md — הקמה חד-פעמית קצרה, בחינם.",
    errProxy: "הממסר מוגדר אך הבקשה נכשלה. ודאו שהגרסה העדכנית של worker.js הועתקה ל-Cloudflare, או ספרו לקלוד מה כתוב בתחתית העמוד.",
    aboutBody: "״הכסף שלנו״ הוא אתר עצמאי, ללא קשר לגוף ממשלתי, למפלגה או לארגון, שנועד להעניק לאזרחי ישראל מבט נקי ומסודר על פעילות המדינה ועל האופן שבו היא משתמשת בכסף שלנו. כל הנתונים מגיעים ישירות מהמקורות הרשמיים ומוצגים כפי שהם, עם קישור למקור. מצאתם טעות או נתון חסר? כתבו לנו ונתקן:",
    contactLabel: "אמצעי תקשורת - ",
    devLabel: "למפתחים: ",
  },
  en: {
    title: "Our Money",
    navBudget: "The Budget",
    navVotes: "Votes & Legislation",
    navMk: "Knesset Members",
    navCourt: "Supreme Court",
    loading: "Loading data…",
    searchBtn: "Search",
    empty: "No results found.",
    credit: "Data sources: ",
    err: "Failed to load data. Please try again later.",
    updatedAt: "Data updated: ",
    errCors: "This data needs a relay. Open README.md — a short one-time, free setup.",
    errProxy: "A relay is configured but the request failed. Make sure the latest worker.js is deployed on Cloudflare, or tell Claude what the bottom of the page says.",
    aboutBody: "Our Money is an independent site, unaffiliated with any government body, party or organization, built to give Israel's citizens a clean, clear view of the state's activity and of how it uses our money. All the data comes straight from the official sources and is shown as it is, linked to the original. Found a mistake or a missing figure? Write to us and we'll fix it:",
    contactLabel: "Contact - ",
    devLabel: "Developers: ",
  },
};

let lang = "he";
function t(k) {
  const page = (window.PAGE_STR && window.PAGE_STR[lang]) || {};
  if (page[k] !== undefined) return page[k];
  if (COMMON_STR[lang][k] !== undefined) return COMMON_STR[lang][k];
  return k;
}

/* ---------- language & chrome (header + nav) ---------- */
function buildChrome() {
  // Every page is site/<name>/index.html and every tool is site/tools/…,
  // so from any of them the site root is one level up. A page that lives
  // deeper can set window.BASE (e.g. "../../") before loading this file.
  const BASE = window.BASE || "../";
  const tabs = [
    ["budget", "budget/", "navBudget"],
    ["votes", "votes/", "navVotes"],
    ["mk", "mk/", "navMk"],
    ["court", "court/", "navCourt"],
  ];
  const tabsHtml = tabs.map(([id, href, key]) =>
    `<a href="${BASE}${href}" class="${window.PAGE === id ? "active" : ""}" data-i18n="${key}"></a>`).join("");

  const bar = document.querySelector("header.topbar");
  if (bar && !bar.childElementCount) {
    bar.innerHTML = `<div class="tbwrap">
      <a class="brand" href="${BASE}budget/" data-i18n="title"></a>
      <nav class="tabs">${tabsHtml}</nav>
      <button class="langbtn" id="langbtn" onclick="toggleLang()">English</button>
    </div>`;
  }
  // page subtitle under the header (only when the page defines one)
  const hasTagline = window.PAGE_STR &&
    (((window.PAGE_STR.he || {}).tagline) || ((window.PAGE_STR.en || {}).tagline));
  const wrap = document.querySelector(".wrap");
  if (wrap && hasTagline && !wrap.querySelector(".tagline")) {
    const p = document.createElement("p");
    p.className = "tagline";
    p.dataset.i18n = "tagline";
    wrap.prepend(p);
  }
}

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  const btn = document.getElementById("langbtn");
  if (btn) btn.textContent = lang === "he" ? "English" : "עברית";
  document.querySelectorAll("[data-i18n]").forEach(el => el.innerHTML = t(el.dataset.i18n));
  document.querySelectorAll("[data-i18n-ph]").forEach(el => el.placeholder = t(el.dataset.i18nPh));
  renderFreshness();
}
function toggleLang() {
  lang = lang === "he" ? "en" : "he";
  applyLang();
  if (typeof window.onLangChange === "function") window.onLangChange();
}

/* ---------- tiny helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 864e5);
  return d.toISOString().slice(0, 10);
}

/* any government date → Date|null.
   Handles ISO ("2026-08-19T00:00:00"), OData "/Date(1787…)/" and "20/08/2026". */
function dateOf(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v);
  if (s.startsWith("/Date(")) return new Date(+s.slice(6, -2));
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dm) return new Date(+dm[3], +dm[2] - 1, +dm[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function fmtDate(v, style) {
  const d = dateOf(v);
  if (!d) return "";
  return d.toLocaleDateString(lang === "he" ? "he-IL" : "en-GB",
    style === "long" ? { day: "numeric", month: "long", year: "numeric" }
                     : { day: "numeric", month: "short", year: "numeric" });
}

/* ---------- relay (Cloudflare Worker from config.js) ---------- */
const PROXY = (typeof window !== "undefined" && window.PROXY_URL) ? window.PROXY_URL.replace(/\/$/, "") : "";

/* fetch JSON through the relay. url = the real government address.
   bodyObj (optional) makes it a POST with a JSON body. 204 → null. */
async function viaRelay(url, bodyObj) {
  if (!PROXY) throw new Error("CORS_OR_NET::no-relay");
  const final = PROXY + "/?url=" + encodeURIComponent(url);
  let res;
  try {
    res = await fetch(final, bodyObj
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj) }
      : undefined);
  } catch (e) { throw new Error("CORS_OR_NET::" + final); }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("HTTP " + res.status + "::" + final);
  return res.json();
}

/* call a named shortcut defined inside worker.js (e.g. "verdicts", "votes") */
async function preset(name, params) {
  if (!PROXY) throw new Error("CORS_OR_NET::no-relay");
  const qs = new URLSearchParams(params).toString();
  const url = PROXY + "/preset/" + name + (qs ? "?" + qs : "");
  let res;
  try { res = await fetch(url); }
  catch (e) { throw new Error("CORS_OR_NET::" + url); }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error("HTTP " + res.status + "::" + url);
  return res.json();
}

/* our own snapshot dataset, kept fresh by the worker's scheduled refresh.
   Returns the data; also shows a small "data updated at…" note in the footer. */
async function dataset(name) {
  if (!PROXY) throw new Error("CORS_OR_NET::no-relay");
  const url = PROXY + "/data/" + name;
  let res;
  try { res = await fetch(url); }
  catch (e) { throw new Error("CORS_OR_NET::" + url); }
  if (!res.ok) throw new Error("HTTP " + res.status + "::" + url);
  const j = await res.json();
  if (!j || j.error || j.data === undefined) throw new Error("DATASET::" + ((j && j.error) || "bad response"));
  showFreshness(j.t);
  return j.data;
}

function showFreshness(ts) {
  if (!ts) return;
  window._freshT = ts;
  renderFreshness();
}
function renderFreshness() {
  if (!window._freshT) return;
  const footer = document.querySelector("footer");
  if (!footer) return;
  let el = document.getElementById("fresh");
  if (!el) {
    el = document.createElement("div");
    el.id = "fresh";
    el.style.marginTop = "6px";
    // insertBefore throws if #debug lives in a DIFFERENT footer — and this
    // helper must never be able to break the data it is only annotating
    const dbg = document.getElementById("debug");
    try {
      if (dbg && dbg.parentNode === footer) footer.insertBefore(el, dbg);
      else footer.appendChild(el);
    } catch (e) { return; }
  }
  el.textContent = t("updatedAt") + new Date(window._freshT).toLocaleString(lang === "he" ? "he-IL" : "en-GB",
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* fetch that works without the relay too (for CORS-open APIs like BudgetKey) */
async function fetchJson(url) {
  let res;
  try { res = await fetch(url); }
  catch (e) { throw new Error("CORS_OR_NET::" + url); }
  if (!res.ok) throw new Error("HTTP " + res.status + "::" + url);
  return res.json();
}

/* ---------- errors & debug ---------- */
function friendly(e) {
  const m = String(e.message);
  if (m.startsWith("CORS_OR_NET")) return PROXY ? t("errProxy") : t("errCors");
  if (PROXY && /^HTTP [45]/.test(m)) return t("errProxy");
  return t("err");
}
function debug(msg) {
  console.warn("[our-money]", msg);
  const d = document.getElementById("debug");
  if (d) d.textContent = msg ? "⚠ " + String(msg).slice(0, 300) : "";
}

/* ---------- boot ---------- */
buildChrome();
