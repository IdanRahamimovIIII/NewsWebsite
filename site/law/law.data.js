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

/* a law or bill name, whole — but split in two for the eye (Mercy): the
   words up to the first "(" / "[" or the Hebrew year are what it is about
   (bold); from there on — the amendment number, the subject in brackets,
   "התשפ"ו–2026" — is the same name in a quieter font. Never cut. */
function splitName(n) {
  const s = String(n || "").trim();
  const cut = [s.indexOf("("), s.indexOf("["), s.search(/,?\s*(התש|תש)[\u0590-\u05ff"'״׳]*\s*[–-]?\s*\d{4}\s*$/),
    s.search(/,\s*\d{4}\s*$/)].filter(i => i > 0);
  const at = cut.length ? Math.min(...cut) : -1;
  if (at < 3) return [s, ""];
  return [s.slice(0, at).trim(), s.slice(at).replace(/^,\s*/, "").trim()];
}
function nameHtml(n) {
  const [core, tail] = splitName(n);
  return `<span class="core">${esc(core)}</span>` + (tail ? ` <span class="tail">${esc(tail)}</span>` : "");
}

/* ---------- an opened row: "label: value" lines, the label bold (Mercy) ---------- */
const kv = (key, valueHtml) => valueHtml ? `<p class="kv"><b>${esc(t(key))}:</b> ${valueHtml}</p>` : "";

/* the Knesset's own word, shown only where it contradicts ours: a law the
   court voided in full still reads "תקף" there (a later start date is
   already said by "תחילת תוקף") */
const knessetDiffers = l => shownState(l) === "voided";
function rulingLink(c) {
  return `<a class="doclink" href="${esc(c.u)}" target="_blank" rel="noopener">${esc(c.c)}</a>`;
}
/* a law, opened: status · (the Knesset's word) · from · until · topics · court · replaced by */
function lawKv(l) {
  const topics = (l.t || []).map(id => LAW.topics[id]).filter(Boolean);
  const rep = l.r && LAW.byId.get(l.r);
  return kv("kvStatus", esc(t(STATE_KEY[shownState(l)]))) +
    (knessetDiffers(l) ? kv("kvKnesset", esc(l.st)) : "") +
    kv("kvStart", l.s ? esc(fmtDate(l.s)) : "") +
    kv("kvEnd", l.e ? esc(fmtDate(l.e)) : "") +
    kv("kvTopics", esc(topics.join(" · "))) +
    courtOf(l).map(c => kv("kvCourt", esc(t(KIND_KEY[c.k])) + (c.k === "void" ? "" : ", " + esc(c.w)) +   // "voided in full" needs no "what"
      ` (${rulingLink(c)} · ${esc(fmtDate(c.d))})`)).join("") +
    (rep ? kv("kvReplaced", `<a class="golink" href="${lawLink(rep)}">${esc(lawName(rep))}</a>`) : "");
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
/* a law's own page: /law/<IsraelLawID>-<name without its year>/ — the SAME
   rule as worker/pages.js lawTitle/lawSlug (change both; the worker 301s any
   other spelling, so a drift costs a redirect, never a dead link) */
function lawSlug(n) {
  return String(n || "").replace(/,?\s*(התש|תש)[\u0590-\u05ff"'״׳]*\s*[–-]?\s*\d{4}\s*$/, "")
    .replace(/,\s*\d{4}\s*$/, "").trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/[\s-]+/g, "-");
}
function lawLink(l) { return "/law/" + l.i + "-" + encodeURIComponent(lawSlug(l.n)) + "/"; }
function mailSuggest(subject) {
  return "mailto:contact@ourmoneyil.com?subject=" + encodeURIComponent(subject);
}
/* fill "{n}"-style slots in a string */
function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)); }
const fmtN = n => Number(n).toLocaleString(lang === "he" ? "he-IL" : "en-US");
