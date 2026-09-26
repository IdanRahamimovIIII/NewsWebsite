#!/usr/bin/env node
"use strict";
/* =====================================================================
   bake_i18n.mjs — pre-fill the Hebrew strings into the HTML shells.

   WHY: search engines and AI crawlers read the raw HTML; before this
   script every data-i18n element was empty until JS filled it, so
   crawlers saw an empty shell. Baking writes the Hebrew text (the
   default language) straight into the HTML. The runtime JS then
   overwrites it with the same strings (and handles the EN toggle), so
   nothing changes visually — but the raw HTML now carries the content.

   RUN:    node scripts/bake_i18n.mjs           (rewrites the HTML files)
   CHECK:  node scripts/bake_i18n.mjs --check   (exit 1 if HTML and
           strings drifted — run by tests/CI; after editing a
           *.strings.js re-run the bake)

   Mirrors shared/common.js exactly:
   - t(key): page strings override COMMON_STR, language "he"
   - applyLang() assigns innerHTML, so strings are inserted verbatim
   - buildChrome() topbar + tagline are baked too (buildChrome skips
     rebuilding when the header already has children — by design)
   Zero dependencies; runs on plain node.
   ===================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import crypto from "node:crypto";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const CHECK = process.argv.includes("--check");
// compare and bake in LF: a Windows checkout (autocrlf) must not read as drift;
// a written file keeps the line endings it had
const lf = s => s.replace(/\r\n/g, "\n");

/* ---------- the pages ---------- */
const PAGES = [
  { html: "budget/index.html",      strings: "budget/budget.strings.js" },
  { html: "budget/contractors.html",strings: "budget/contractors.strings.js" },
  { html: "votes/index.html",       strings: "votes/votes.strings.js" },
  { html: "mk/index.html",          strings: "mk/mk.strings.js", json: "mk/mk.i18n.json" },
  { html: "court/index.html",       strings: null /* inline in the HTML */ },
  { html: "law/index.html",         strings: "law/law.strings.js" },
  { html: "law/laws.html",          strings: ["law/law.strings.js", "law/laws.strings.js"] },
  { html: "law/page.html",          strings: ["law/law.strings.js", "law/page.strings.js"], json: "law/law.i18n.json" },
  { html: "law/bill.html",          strings: ["law/law.strings.js", "law/page.strings.js"] },
];

/* ---------- load COMMON_STR from shared/common.js ---------- */
function extractObject(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error("marker not found: " + marker);
  const start = src.indexOf("{", i);
  let depth = 0, j = start;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  return vm.runInNewContext("(" + src.slice(start, j + 1) + ")");
}
const commonSrc = fs.readFileSync(path.join(SITE, "shared/common.js"), "utf8");
const COMMON_STR = extractObject(commonSrc, "const COMMON_STR");

/* ---------- load a page's strings + PAGE id ---------- */
function loadPage(p) {
  const sandbox = { window: {} };
  // strings files only assign window.PAGE / window.PAGE_STR (a page may load
  // two, in order: a section's shared words, then its own); for the court
  // page (inline strings) evaluate just those two assignments.
  if (p.strings) {
    for (const f of [].concat(p.strings)) vm.runInNewContext(fs.readFileSync(path.join(SITE, f), "utf8"), sandbox);
  } else {
    const src = fs.readFileSync(path.join(SITE, p.html), "utf8");
    const pageM = /window\.PAGE\s*=\s*"([^"]+)"/.exec(src);
    sandbox.window.PAGE = pageM ? pageM[1] : "";
    sandbox.window.PAGE_STR = extractObject(src, "window.PAGE_STR");
  }
  return { PAGE: sandbox.window.PAGE, STR: sandbox.window.PAGE_STR };
}

/* ---------- t(), Hebrew, exactly like common.js ---------- */
function makeT(pageStr, file) {
  return k => {
    const page = (pageStr && pageStr.he) || {};
    if (page[k] !== undefined) return page[k];
    if (COMMON_STR.he[k] !== undefined) return COMMON_STR.he[k];
    throw new Error(`${file}: data-i18n key "${k}" not found in strings (he)`);
  };
}

/* ---------- the topbar, exactly what buildChrome() builds ---------- */
function chromeHtml(activePage, t) {
  const BASE = "../";
  const tabs = [
    ["budget", "budget/", "navBudget", ["budget"]],
    ["law", "law/", "navLaw", ["law", "votes", "court"]],
    ["mk", "mk/", "navMk", ["mk"]],
  ];
  const tabsHtml = tabs.map(([id, href, key, pages]) =>
    `<a href="${BASE}${href}" class="${pages.includes(activePage) ? "active" : ""}" data-i18n="${key}">${t(key)}</a>`).join("");
  return `<header class="topbar"><div class="tbwrap">
      <a class="brand" href="${BASE}budget/" data-i18n="title">${t("title")}</a>
      <nav class="tabs">${tabsHtml}</nav>
      <button class="langbtn" id="langbtn" onclick="toggleLang()">English</button>
    </div></header>`;
}

/* ---------- bake one file ---------- */
function bake(p) {
  const file = path.join(SITE, p.html);
  let html = lf(fs.readFileSync(file, "utf8"));
  const { PAGE, STR } = loadPage(p);
  const t = makeT(STR, p.html);

  // 1) topbar (replace whatever is there — empty or a previous bake)
  html = html.replace(/<header class="topbar">[\s\S]*?<\/header>/, chromeHtml(PAGE, t));

  // 2) tagline — buildChrome() prepends it into .wrap when the page has one
  if (STR && ((STR.he || {}).tagline || (STR.en || {}).tagline)) {
    const tag = `<p class="tagline" data-i18n="tagline">${t("tagline")}</p>`;
    if (/<p class="tagline"[^>]*>[\s\S]*?<\/p>/.test(html)) {
      html = html.replace(/<p class="tagline"[^>]*>[\s\S]*?<\/p>/, tag);
    } else {
      html = html.replace(/(<div class="wrap">)/, `$1\n  ${tag}`);
    }
  }

  // 3) every data-i18n element gets its Hebrew string as content
  //    (runtime does innerHTML = t(key); strings contain no "<", verified)
  html = html.replace(
    /<(\w+)([^>]*\bdata-i18n="([\w]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (m, tag, attrs, key) => `<${tag}${attrs}>${t(key)}</${tag}>`);

  // 4) data-i18n-ph → a real placeholder attribute
  html = html.replace(/<(\w+)([^>]*\bdata-i18n-ph="([\w]+)"[^>]*?)(\s*\/?)>/g,
    (m, tag, attrs, key, close) => {
      const ph = t(key).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      const cleaned = attrs.replace(/\s*placeholder="[^"]*"/, "");
      return `<${tag}${cleaned} placeholder="${ph}"${close}>`;
    });

  return { file, html };
}

/* ---------- merged strings as JSON (p.json) ----------
   For code that can't run the strings file — the pages worker
   (worker/pages.js) reads mk.i18n.json to bake /mk/<id>-<name>/ in he/en.
   Same merge as t(): page strings over COMMON_STR, per language. */
function i18nJson(p) {
  const { STR } = loadPage(p);
  const out = {};
  for (const l of ["he", "en"]) out[l] = { ...COMMON_STR[l], ...((STR && STR[l]) || {}) };
  return { file: path.join(SITE, p.json), html: JSON.stringify(out, null, 1) + "\n", name: p.json };
}

/* ---------- versions: every local script/style link carries ?v=<hash of that
   file>, so a browser fetches a changed file at once instead of keeping the
   old one for hours (the host lets them cache 4h — new page + old script
   broke what Mercy saw). One site version = a hash of all of them, shown at
   the bottom of every page ("גרסה: …"). config.js is left bare: the pages
   worker anchors on its exact tag, and it holds only the relay address. ---------- */
const hashOf = f => crypto.createHash("sha1").update(lf(fs.readFileSync(f, "utf8"))).digest("hex").slice(0, 8);
const ASSET = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#:]+\.(?:js|css))(?:\?v=[0-9a-f]+)?(")/g;
function assets(html, page) {
  const dir = path.dirname(path.join(SITE, page));
  return [...html.matchAll(ASSET)].map(m => m[2]).filter(a => !/config\.js$/.test(a))
    .map(a => path.join(dir, a)).filter(f => fs.existsSync(f));
}
function stamp(html, page) {
  const dir = path.dirname(path.join(SITE, page));
  return html.replace(ASSET, (m, head, a, tail) => {
    const f = path.join(dir, a);
    if (/config\.js$/.test(a) || !fs.existsSync(f)) return head + a + tail;
    return head + a + "?v=" + hashOf(f) + tail;
  });
}
function withVersion(html, ver, t) {
  const line = `<p class="sitever"><span data-i18n="verLabel">${t("verLabel")}</span><span class="vcode">${ver}</span></p>`;
  if (/<p class="sitever">[\s\S]*?<\/p>/.test(html)) return html.replace(/<p class="sitever">[\s\S]*?<\/p>/, line);
  return html.replace(/(\n?\s*)<\/footer>/, `\n    ${line}$1</footer>`);
}

/* ---------- run ---------- */
let drift = 0;
const JOBS = [];
const baked = PAGES.map(p => ({ p, ...bake(p) }));
const allAssets = [...new Set(baked.flatMap(b => assets(b.html, b.p.html)))].sort();
const SITE_VER = crypto.createHash("sha1").update(allAssets.map(f => path.relative(SITE, f) + ":" + hashOf(f)).join("\n"))
  .digest("hex").slice(0, 7);
for (const { p, file, html } of baked) {
  const { STR } = loadPage(p);
  JOBS.push({ file, html: withVersion(stamp(html, p.html), SITE_VER, makeT(STR, p.html)), name: p.html });
  if (p.json) JOBS.push(i18nJson(p));
}
for (const { file, html, name } of JOBS) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const current = lf(raw);
  if (CHECK) {
    if (current !== html) {
      console.error(`DRIFT: ${name} — strings and HTML disagree; run: node scripts/bake_i18n.mjs`);
      drift++;
    }
  } else if (current !== html) {
    fs.writeFileSync(file, raw.includes("\r\n") ? html.replace(/\n/g, "\r\n") : html);
    console.log(`baked: ${name}`);
  } else {
    console.log(`ok (unchanged): ${name}`);
  }
}
if (CHECK) {
  console.log(drift ? `${drift} file(s) drifted` : "bake check: all HTML matches the strings");
  process.exit(drift ? 1 : 0);
}
