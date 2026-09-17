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

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const CHECK = process.argv.includes("--check");

/* ---------- the five pages ---------- */
const PAGES = [
  { html: "budget/index.html",      strings: "budget/budget.strings.js" },
  { html: "budget/contractors.html",strings: "budget/contractors.strings.js" },
  { html: "votes/index.html",       strings: "votes/votes.strings.js" },
  { html: "mk/index.html",          strings: "mk/mk.strings.js" },
  { html: "court/index.html",       strings: null /* inline in the HTML */ },
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
  const src = p.strings
    ? fs.readFileSync(path.join(SITE, p.strings), "utf8")
    : fs.readFileSync(path.join(SITE, p.html), "utf8");
  const sandbox = { window: {} };
  // strings files only assign window.PAGE / window.PAGE_STR; for the court
  // page (inline strings) evaluate just those two assignments.
  if (p.strings) {
    vm.runInNewContext(src, sandbox);
  } else {
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
    ["budget", "budget/", "navBudget"],
    ["votes", "votes/", "navVotes"],
    ["mk", "mk/", "navMk"],
    ["court", "court/", "navCourt"],
  ];
  const tabsHtml = tabs.map(([id, href, key]) =>
    `<a href="${BASE}${href}" class="${activePage === id ? "active" : ""}" data-i18n="${key}">${t(key)}</a>`).join("");
  return `<header class="topbar"><div class="tbwrap">
      <a class="brand" href="${BASE}budget/" data-i18n="title">${t("title")}</a>
      <nav class="tabs">${tabsHtml}</nav>
      <button class="langbtn" id="langbtn" onclick="toggleLang()">English</button>
    </div></header>`;
}

/* ---------- bake one file ---------- */
function bake(p) {
  const file = path.join(SITE, p.html);
  let html = fs.readFileSync(file, "utf8");
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

/* ---------- run ---------- */
let drift = 0;
for (const p of PAGES) {
  const { file, html } = bake(p);
  const current = fs.readFileSync(file, "utf8");
  if (CHECK) {
    if (current !== html) {
      console.error(`DRIFT: ${p.html} — strings and HTML disagree; run: node scripts/bake_i18n.mjs`);
      drift++;
    }
  } else if (current !== html) {
    fs.writeFileSync(file, html);
    console.log(`baked: ${p.html}`);
  } else {
    console.log(`ok (unchanged): ${p.html}`);
  }
}
if (CHECK) {
  console.log(drift ? `${drift} file(s) drifted` : "bake check: all HTML matches the strings");
  process.exit(drift ? 1 : 0);
}
