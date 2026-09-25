"use strict";
/* =====================================================================
   The law section's data — shared by the main page (law.view.js) and the
   laws list (laws.view.js). One snapshot: /data/laws (pipeline\laws\),
   rebuilt weekly. Nothing here draws.
   ===================================================================== */

const LAW = { data: null, byId: new Map(), courtByLaw: new Map(), topics: {} };

async function loadLaws() {
  const d = await dataset("laws");
  LAW.data = d;
  LAW.topics = d.topics || {};
  LAW.byId = new Map(d.laws.map(l => [l.i, l]));
  LAW.courtByLaw = new Map();
  for (const c of d.court || []) {
    if (!LAW.courtByLaw.has(c.l)) LAW.courtByLaw.set(c.l, []);
    LAW.courtByLaw.get(c.l).push(c);
  }
  for (const list of LAW.courtByLaw.values()) list.sort((a, b) => b.d.localeCompare(a.d));
  return d;
}

/* ---------- a law's facts, in words ---------- */
const TODAY = new Date().toISOString().slice(0, 10);
function addDays(iso, n) { return new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10); }

// the Knesset's validity words → plain groups. Matched as text: the
// register's words are the contract, not an id.
function lawState(l) {
  const st = l.st || "";
  if (/טרם/.test(st) || (l.s && l.s > TODAY && /תקף/.test(st))) return "pending";
  if (/^תקף/.test(st)) return "in";
  if (/בטל/.test(st)) return "repealed";
  if (/פקע/.test(st)) return "expired";
  if (/נושן/.test(st)) return "obsolete";
  return "in";
}
const STATE_KEY = { in: "stIn", pending: "stPending", repealed: "stRepealed", expired: "stExpired", obsolete: "stObsolete", voided: "stVoided" };
const KIND_KEY = { void: "kVoid", partial: "kPartial", frozen: "kFrozen", deferred: "kDeferred" };

const isBudget = l => (l.f || "").includes("u");
const isTemp = l => (l.f || "").includes("t") || !!l.e;
const isGone = l => ["repealed", "expired", "obsolete"].includes(lawState(l));
const courtOf = l => LAW.courtByLaw.get(l.i) || [];

/* what a reader should be told: a law the court voided IN FULL does not
   "apply today", whatever the Knesset's record says (it never updates) */
function shownState(l) {
  const s = lawState(l);
  return s === "in" && courtOf(l).some(c => c.k === "void") ? "voided" : s;
}

/* the court's strongest word on a law (for a badge) */
function courtBadge(l) {
  const c = courtOf(l);
  if (!c.length) return null;
  for (const k of ["void", "frozen", "partial", "deferred"]) {
    const hit = c.find(x => x.k === k);
    if (hit) return hit;
  }
  return c[0];
}

/* a law name for display: the register's full name */
const lawName = l => l.n || "";

/* the Wikisource page for a law: its title is the name without the year
   ("חוק X, התשע"ז-2017" → "חוק X"); Special:Search with go= lands on the
   page when the title matches, else shows the search — never a dead link */
function wikisourceUrl(l) {
  const title = lawName(l).replace(/,?\s*(התש|תש)[֐-׿"'״׳]*\s*[–-]?\s*\d{4}\s*$/, "").replace(/,\s*\d{4}\s*$/, "").trim();
  return "https://he.wikisource.org/w/index.php?search=" + encodeURIComponent(title) + "&go=Go";
}
function knessetRecordUrl(l) {
  return "https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_IsraelLaw(" + l.i + ")?$format=json";
}
function lawLink(l) { return "laws.html?law=" + l.i; }
function mailSuggest(subject) {
  return "mailto:contact@ourmoneyil.com?subject=" + encodeURIComponent(subject);
}
/* fill "{n}"-style slots in a string */
function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)); }
const fmtN = n => Number(n).toLocaleString(lang === "he" ? "he-IL" : "en-US");
