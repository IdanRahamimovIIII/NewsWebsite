/**
 * Our Money — entity pages (Cloudflare Worker `our-money-pages`).
 * Rules and setup: worker\CLAUDE.md ("our-money-pages"). Mercy pastes this
 * file into the dashboard → Deploy. NO bindings: it reads only public URLs.
 *
 * Route: ourmoneyil.com/mk/*  (a route runs BEFORE the site, which stays as is)
 *   /mk/<MkId>-<hebrew-name>/   the MK page in Hebrew, facts baked into the HTML
 *   /mk/<MkId>-<english-name>/  the same page in English
 *   /mk/<MkId>[-anything][/]    301 → the right address (wrong/missing slug, no slash)
 *   /mk/sitemap.xml             every MK address, he+en, for search engines
 *   anything else               passed through to the site untouched
 *
 * The page IS the site's /mk/ page: its HTML is fetched from the site, the
 * facts from the mkcards snapshot are written into it (so crawlers, which
 * don't run JS, see them), and window.MK_ENTITY tells mk.view.js to open
 * that MK — people get the full live profile on top.
 */

const SITE = "https://ourmoneyil.com";                 // canonical addresses are always the real domain
const CARDS_URL = "https://api.ourmoneyil.com/data/mkcards";
const PHOTO_BASE = "https://api.ourmoneyil.com/photos/mk/";
const MEMO_MS = 10 * 60 * 1000;                        // inputs change monthly (cards) or on deploy (shell)

const memo = {};                                       // per isolate: url → {t, v}
async function cached(key, load) {
  const m = memo[key];
  if (m && Date.now() - m.t < MEMO_MS) return m.v;
  const v = await load();
  memo[key] = { t: Date.now(), v };
  return v;
}
async function getText(url) {
  const r = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error(url + " → " + r.status);
  return r.text();
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o[k] ?? m));
const pathOf = (c, lang) => `/mk/${c.id}-${encodeURIComponent(lang === "en" ? c.slugEn : c.slugHe)}/`;

/* ---- the facts, in the page's own markup (mk.view.js renderHead /
   renderTiles / renderPositions) so nothing jumps when the JS takes over ---- */
function tenure(c, S) {
  if (!c.since) return "";
  if (c.current && !c.until) {
    const n = new Date().getFullYear() - c.since;
    return fill(S.tenureSince, { y: c.since }) + (n >= 2 ? " " + fill(S.tenureYears, { n }) : "");
  }
  return fill(S.tenureSpan, { a: c.since, b: c.until || S.untilNow });
}
function billsLine(c, S) {
  const b = c.bills;
  if (!b) return "";                                   // unknown count → no line (never "0")
  if (!b.proposed) return S.bNoBills;
  const k = b.passed === 0 ? "billsStory0" : b.passed === 1 ? "billsStory1" : "billsStory";
  return fill(S[k], { t: b.proposed, p: b.passed });
}
function heroHtml(c, S, lang) {
  const name = lang === "en" ? c.en : c.he;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("");
  const av = c.photo
    ? `<img class="avatar avxxl" src="${esc(PHOTO_BASE + c.photo)}" alt="${esc(name)}">`
    : `<span class="avatar avxxl">${esc(initials)}</span>`;
  const story = [
    c.faction ? `<span class="factionname" title="${esc(S.factionTip)}">${esc(c.faction)}</span>` : "",
    esc(tenure(c, S)),
  ].filter(Boolean).join(`<span class="sep"> · </span>`);
  return `<a class="backbtn" href="/mk/">${esc(S.backToDir)}</a>
     <div class="pheadcol">
       ${av}
       <h1 class="mkname">${esc(name)}${c.role ? ` <span class="mkrole">· ${esc(c.role)}</span>` : ""}</h1>
       ${story ? `<div class="story">${story}</div>` : ""}
     </div>`;
}
function tilesHtml(c, S) {
  const line = billsLine(c, S);
  if (!line) return "";
  return c.bills.proposed ? `<div class="billsbar"><div class="bhead">${esc(line)}</div></div>`
    : `<div class="story">${esc(line)}</div>`;
}
function positionsHtml(c, S) {
  return (c.positions || []).map(p => `<div class="posrow">
      <div class="posdates">${esc(p.y0 || "")}${p.y0 ? " – " : ""}${p.now ? `<span class="nowchip">${esc(S.posNow)}</span>` : esc(p.y1 || "")}</div>
      <div class="posbody"><b>${esc(p.role || S.posMember)}</b>${p.k ? ` <span class="names">· ${esc(S.posKnesset)} ${esc(p.k)}</span>` : ""}</div>
    </div>`).join("");
}
function description(c, S, lang) {
  const who = [c.role, c.faction].filter(Boolean).join(", ");
  return [lang === "en" ? c.en : c.he, who].filter(Boolean).join(" — ") + ". " +
    [tenure(c, S), billsLine(c, S)].filter(Boolean).join(". ") + ". " + S.entityDesc;
}

/* ---- the site's /mk/ shell → this MK's page. Each step touches one known
   anchor of site/mk/index.html; a missing anchor skips that step (the page
   still works — the JS draws everything); wtest_pages.mjs runs every step
   on the real index.html so a shell change that breaks one fails there ---- */
function render(shell, c, I, lang) {
  const S = I[lang], other = lang === "en" ? "he" : "en";
  const canon = SITE + pathOf(c, lang), alt = SITE + pathOf(c, other);
  const name = lang === "en" ? c.en : c.he;
  const title = fill(S.entityTitle, { name });
  const desc = description(c, S, lang);
  const listTitle = ((/<title>([\s\S]*?)<\/title>/.exec(shell) || [])[1] || "")
    .replace(/&(amp|quot|#39|lt|gt);/g, (m, e) => ({ amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" }[e]));
  let h = shell;

  // English: the same swap applyLang() does at runtime, done here for crawlers
  if (lang === "en") {
    h = h.replace(/<(\w+)([^>]*\bdata-i18n="(\w+)"[^>]*)>([\s\S]*?)<\/\1>/g,
      (m, tag, attrs, key) => S[key] !== undefined ? `<${tag}${attrs}>${S[key]}</${tag}>` : m);
    h = h.replace(/(<[^>]*\bdata-i18n-ph="(\w+)"[^>]*?)\splaceholder="[^"]*"/g,
      (m, head, key) => S[key] !== undefined ? `${head} placeholder="${esc(S[key])}"` : m);
    h = h.replace(/(<button class="langbtn"[^>]*>)English(<\/button>)/, "$1עברית$2");
  }
  h = h.replace(/<html[^>]*>/, `<html lang="${lang}" dir="${lang === "en" ? "ltr" : "rtl"}">`);

  // head: this person's title/description/canonical/social tags, the other
  // language's address, JSON-LD, and <base> so the shell's relative links
  // (../shared/…, mk.css) resolve from /mk/ as they do on the real page
  h = h.replace(/<title>[\s\S]*?<\/title>\s*/, "")
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace(/<link rel="canonical"[^>]*>\s*/, "")
    .replace(/<meta property="og:(title|description|url|type|locale)"[^>]*>\s*/g, "")
    .replace(/<meta property="og:locale:alternate"[^>]*>\s*/g, "");
  const ld = {
    "@context": "https://schema.org", "@type": "Person",
    name, alternateName: lang === "en" ? c.he : c.en, url: canon, description: desc,
    jobTitle: c.role || S.posMember,
    memberOf: [{ "@type": "Organization", name: lang === "en" ? "Knesset" : "הכנסת" }]
      .concat(c.faction ? [{ "@type": "Organization", name: c.faction }] : []),
  };
  if (c.photo) ld.image = PHOTO_BASE + c.photo;
  const head = `
<base href="/mk/">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<link rel="alternate" hreflang="${lang}" href="${esc(canon)}">
<link rel="alternate" hreflang="${other}" href="${esc(alt)}">
<link rel="alternate" hreflang="x-default" href="${esc(SITE + pathOf(c, "he"))}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}">
<meta property="og:locale" content="${lang === "en" ? "en_US" : "he_IL"}">
<meta property="og:locale:alternate" content="${lang === "en" ? "he_IL" : "en_US"}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
`;
  h = /<meta charset[^>]*>/i.test(h) ? h.replace(/(<meta charset[^>]*>)/i, "$1" + head) : h.replace(/<head>/, "<head>" + head);

  // body: the portfolio open, the search/directory/tagline hidden — what
  // renderAll() shows when someone is chosen
  const show = (re, v) => { h = h.replace(re, (m, a) => a.replace(/\sstyle="[^"]*"/, "") + ` style="display:${v}"`); };
  show(/(<div class="card" id="searchCard"[^>]*?)(?=>)/, "none");
  show(/(<div class="card" id="dirCard"[^>]*?)(?=>)/, "none");
  show(/(<div id="profile"[^>]*?)(?=>)/, "block");
  show(/(<p class="tagline"[^>]*?)(?=>)/, "none");
  h = h.replace(/(<div id="phead"[^>]*>)<\/div>/, (m, a) => a + heroHtml(c, S, lang) + "</div>");
  h = h.replace(/(<div id="ptiles"[^>]*>)<\/div>/, (m, a) => a + tilesHtml(c, S) + "</div>");
  const pos = positionsHtml(c, S);
  if (pos) h = h.replace(/(<div id="positions"[^>]*>)(?:<div class="loading"[^>]*>[^<]*<\/div>)?<\/div>/,
    (m, a) => a + pos + "</div>");

  // who to open — read by mk.view.js before the first paint
  const ent = {
    id: c.id, lang, he: c.he, dir: "/mk/",
    url: { he: pathOf(c, "he"), en: pathOf(c, "en") },
    title: { he: fill(I.he.entityTitle, { name: c.he }), en: fill(I.en.entityTitle, { name: c.en }), list: listTitle },
  };
  const tag = `<script>window.MK_ENTITY=${JSON.stringify(ent).replace(/</g, "\\u003c")};</script>\n`;
  h = /<script src="[^"]*shared\/config\.js"><\/script>/.test(h)
    ? h.replace(/(<script src="[^"]*shared\/config\.js"><\/script>)/, tag + "$1")
    : h.replace(/<script src=/, tag + "<script src=");
  return h;
}

function sitemap(cards) {
  const alts = c => ["he", "en"].map(l =>
    `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(SITE + pathOf(c, l))}"/>`).join("");
  const mod = cards.t ? `<lastmod>${new Date(cards.t).toISOString().slice(0, 10)}</lastmod>` : "";
  const rows = Object.values(cards.data.members).flatMap(c => ["he", "en"].map(l =>
    `<url><loc>${esc(SITE + pathOf(c, l))}</loc>${mod}${alts(c)}</url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- every MK address, he+en (worker\\pages.js, from /data/mkcards) -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${rows.join("\n")}
</urlset>
`;
}

function notFound(I, origin) {
  const S = I.he, E = I.en;
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>${esc(S.title)}</title><link rel="stylesheet" href="${origin}/shared/style.css"></head>
<body><div class="wrap"><div class="card">
<h2>${esc(S.entityNotFound)}</h2><p><a href="/mk/">${esc(S.entityToList)}</a></p>
<p dir="ltr">${esc(E.entityNotFound)} <a href="/mk/">${esc(E.entityToList)}</a></p>
</div></div></body></html>`;
}

const html = (body, status = 200, extra = {}) => new Response(body, {
  status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", ...extra },
});
const moved = to => new Response(null, { status: 301, headers: { location: to, "cache-control": "public, max-age=3600" } });

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return fetch(request);
    const isMap = url.pathname === "/mk/sitemap.xml";
    const m = /^\/mk\/(\d+)(?:-([^/]*))?(\/?)$/.exec(url.pathname);
    if (!m && !isMap) return fetch(request);           // the page itself, its files — the site's

    let cards, I;
    try {
      [cards, I] = await Promise.all([
        cached("cards", async () => JSON.parse(await getText(CARDS_URL))),
        cached("i18n", async () => JSON.parse(await getText(url.origin + "/mk/mk.i18n.json"))),
      ]);
      if (!cards || !cards.data || !cards.data.members) throw new Error("mkcards: no members");
    } catch (e) {
      // never the site's catch-all page for an MK address: say it's temporary
      return new Response("Temporarily unavailable — " + e.message, {
        status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "300" } });
    }
    if (isMap) return new Response(request.method === "HEAD" ? null : sitemap(cards), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });

    const c = cards.data.members[String(+m[1])];
    if (!c) return html(request.method === "HEAD" ? null : notFound(I, url.origin), 404);
    let slug = "";
    try { slug = decodeURIComponent(m[2] || ""); } catch (e) { /* bad escape → redirect below */ }
    const lang = slug === c.slugHe ? "he" : slug === c.slugEn ? "en" : "";
    if (!lang || m[1] !== String(c.id) || !m[3]) {
      // any other spelling → the canonical address (Latin letters → English)
      const to = lang || (/[a-z]/i.test(slug) ? "en" : "he");
      return moved(url.origin + pathOf(c, to));
    }

    let shell;
    try {
      shell = await cached("shell", () => getText(url.origin + "/mk/"));
    } catch (e) {
      return new Response("Temporarily unavailable — " + e.message, {
        status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "300" } });
    }
    const vary = { "content-language": lang, link: `<${SITE + pathOf(c, lang)}>; rel="canonical"` };
    return html(request.method === "HEAD" ? null : render(shell, c, I, lang), 200, vary);
  },
};
