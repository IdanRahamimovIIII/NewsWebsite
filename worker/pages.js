/**
 * Our Money — entity pages (Cloudflare Worker `our-money-pages`).
 * Rules and setup: worker\CLAUDE.md ("our-money-pages"). Mercy pastes this
 * file into the dashboard → Deploy. NO bindings: it reads only public URLs.
 *
 * Routes: ourmoneyil.com/mk/* and ourmoneyil.com/law/*  (a route runs BEFORE
 * the site, which stays as is)
 *   /law/<IsraelLawID>-<name>/  one law's page, facts baked in (Hebrew only)
 *   /law/<IsraelLawID>[-…][/]   301 → the right address
 *   /law/sitemap.xml            the promoted law pages · /law/index.txt every law (for AI)
 *   /law/ … anything else       the site's own section pages, untouched
 *   /mk/<MkId>-<hebrew-name>/   the MK page in Hebrew, facts baked into the HTML
 *   /mk/<MkId>-<english-name>/  the same page in English
 *   /mk/<MkId>[-anything][/]    301 → the right address (wrong/missing slug, no slash)
 *   /mk/                        the list, every card pre-filled as a link (else the site's page)
 *   /mk/sitemap.xml             every MK address, he+en, for search engines
 *   /mk/roster.txt              who holds what today, grouped + counted (for AI agents)
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
const BILLS_URL = "https://api.ourmoneyil.com/data/mkbills/";   // + MkId: [{n, s, k, b}], newest first
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

const MINISTER = /^ה?שר(ה|ת)?(\s|$)/;
const PM = /^(ראש הממשלה|ראש הממשלה החלופי|ממלא מקום ראש הממשלה|(סגן|סגנית) ראש הממשלה)$/;   // "סגן שר במשרד ראש הממשלה" is a deputy minister
const DEPUTY = /^(סגן|סגנית)\s+שר(ה|ת)?(\s|$)/;
const GOV = { test: r => MINISTER.test(r) || PM.test(r) || DEPUTY.test(r) };   // minister · deputy minister · PM and deputies
// today's role: the card's, else an ongoing position (a minister who left
// the Knesset under the Norwegian law has no Knesset role but is serving)
const inKnesset = (c, k) => (c.knessets || []).includes(k);   // the snapshot spans K16 → today
const nowRole = c => String(c.role || ((c.positions || []).find(p => p.now) || {}).role || "").trim();

/* ---- the facts, in the page's own markup (mk.view.js renderHead /
   renderTiles / renderPositions) so nothing jumps when the JS takes over ---- */
function tenure(c, S) {
  if (!c.since) return "";
  if (c.current && !c.until) {
    const n = new Date().getFullYear() - c.since;
    return fill(S.tenureSince, { y: c.since }) + (n >= 2 ? " " + fill(S.tenureYears, { n }) : "");
  }
  // left the Knesset but still in government (Norwegian law): say both, or
  // "Knesset 2015–2023" next to "minister, now" reads as a contradiction
  const gov = !c.current && (c.positions || []).find(p => p.now && GOV.test(String(p.role || "").trim()));
  return fill(S.tenureSpan, { a: c.since, b: c.until || S.untilNow }) +
    (gov && gov.y0 && S.tenureGov ? " · " + fill(S.tenureGov, { y: gov.y0 }) : "");   // (words not deployed yet → skip)
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
    c.faction ? `<span class="factionname" data-tip="${esc(S.factionTip)}">${esc(c.faction)}</span>` : "",
    esc(tenure(c, S)),
  ].filter(Boolean).join(`<span class="sep"> · </span>`);
  return `<a class="backbtn" href="/mk/">${esc(S.backToDir)}</a>
     <div class="pheadcol">
       ${av}
       <h1 class="mkname">${esc(name)}${nowRole(c) ? ` <span class="mkrole">· ${esc(nowRole(c))}</span>` : ""}</h1>
       ${story ? `<div class="story">${story}</div>` : ""}
     </div>`;
}
/* the personal background (mk.view.js bioTableHtml): the card's
   [[fact key, text], …] as the build read them; labels in the page's language,
   the text is the Knesset's Hebrew. A key the words don't know is skipped. */
function bioHtml(c, S) {
  const f = (Array.isArray(c.bio) ? c.bio : []).filter(x => Array.isArray(x) && S[x[0]] && x[1]);
  return f.length ? `<div class="biot">${f.map(([k, v]) =>
    `<span class="bk">${esc(S[k])}</span><span class="bv">${esc(v)}</span>`).join("")}</div>` : "";
}
function tilesHtml(c, S) {
  const line = billsLine(c, S);
  const bar = !line ? "" : c.bills.proposed ? `<div class="billsbar"><div class="bhead">${esc(line)}</div></div>`
    : `<div class="story">${esc(line)}</div>`;
  return bar + bioHtml(c, S);   // the background rides under the bills line, as on the page
}
function positionsHtml(c, S) {
  return (c.positions || []).map(p => `<div class="posrow">
      <div class="posdates">${esc(p.y0 || "")}${p.y0 ? " – " : ""}${p.now ? `<span class="nowchip">${esc(S.posNow)}</span>` : esc(p.y1 || "")}</div>
      <div class="posbody"><b>${esc(p.role || S.posMember)}</b>${p.k ? ` <span class="names">· ${esc(S.posKnesset)} ${esc(p.k)}</span>` : ""}</div>
    </div>`).join("");
}
/* "מה ניסו להעביר?": EVERY bill, name + exact status, in the page's piles
   (עברו · נפלו · בתהליך · לא הוכרעו) with counts, each pile folded — the
   text is in the HTML for crawlers, and people get the live list on top.
   No list (not built / fetch failed) → the page's loader stays. */
const PILES = [["passed", "bPassed"], ["rejected", "bRejected"], ["pending", "bPending"], ["undecided", "bUndecided"]];
const pileOf = b => b.b === "stale" ? "undecided" : b.b;   // lists built before the rename said "stale"
function billsHtml(bills, S) {
  if (!Array.isArray(bills)) return "";
  if (!bills.length) return `<div class="loading">${esc(S.bNoBills)}</div>`;
  return PILES.map(([key, label]) => {
    const rows = bills.filter(b => pileOf(b) === key);
    if (!rows.length) return "";
    const why = key === "undecided" && S.tipUndecided ? `<p class="names">${esc(S.tipUndecided)}</p>` : "";   // the page shows it on hover
    return `<details class="bakedpile"><summary>${esc(S[label])} (${rows.length})</summary>${why}<ul class="bakedbills">` +
      rows.map(b => `<li>${esc(b.n)}${b.s ? ` <span class="names">· ${esc(b.s)}</span>` : ""}</li>`).join("") +
      `</ul></details>`;
  }).join("");
}

function description(c, S, lang) {
  const who = [nowRole(c), c.faction].filter(Boolean).join(", ");
  const bits = [tenure(c, S), billsLine(c, S)].map(s => s.replace(/\.$/, "")).filter(Boolean);   // no ".."
  return [lang === "en" ? c.en : c.he, who].filter(Boolean).join(" — ") + ". " +
    (bits.length ? bits.join(". ") + ". " : "") + S.entityDesc;
}

/* ---- the site's /mk/ shell → this MK's page. Each step touches one known
   anchor of site/mk/index.html; a missing anchor skips that step (the page
   still works — the JS draws everything); wtest_pages.mjs runs every step
   on the real index.html so a shell change that breaks one fails there ---- */
function render(shell, c, I, lang, bills) {
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
    jobTitle: nowRole(c) || S.posMember,
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
  const bl = billsHtml(bills, S);
  if (bl) h = h.replace(/(<div id="bills"[^>]*>)(?:<div class="loading"[^>]*>[^<]*<\/div>)?<\/div>/,
    (m, a) => a + bl + "</div>");
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

/* ---- /mk/ itself: every card of the snapshot as a real link to its page,
   in the directory's order (mk.data.js dirRank/dirOrder, approximated from
   the card: serving first, then PM → alternate/deputy PM → Speaker →
   opposition leader → minister → deputy minister → committee chair →
   former minister; leavers by year left). The page's JS redraws it live. ---- */
function tier(c) {
  const r = nowRole(c);
  if (r === "ראש הממשלה") return 10;
  if (/ראש הממשלה החלופי|ממלא מקום ראש הממשלה|סגן ראש הממשלה/.test(r)) return 9;
  if (/^יושב(ת)?[-–\s]?ראש הכנסת/.test(r)) return 8;
  if (/ראש האופוזיציה/.test(r)) return 7;
  if (MINISTER.test(r)) return 6;
  if (DEPUTY.test(r)) return 5;
  if (/^(יושב(ת)?[-–\s]?ראש\s*ועד|יו"ר\s*ועד)/.test(r)) return 4;
  return (c.positions || []).some(p => !p.now && MINISTER.test(String(p.role || "").trim())) ? 3 : 0;
}
const lastMin = c => Math.max(0, ...(c.positions || [])
  .filter(p => !p.now && MINISTER.test(String(p.role || "").trim())).map(p => p.y1 || 0));
function listOrder(a, b) {
  return (b.current - a.current) ||
    (a.current ? 0 : (b.until || 0) - (a.until || 0)) ||
    (tier(b) - tier(a)) || (lastMin(b) - lastMin(a)) || a.he.localeCompare(b.he, "he");
}
function cardRole(c, S) {
  if (c.current) return String(c.role || "").trim() || S.posMember;
  const p = (c.positions || [])[0];                    // a leaver: the latest role (a minister outside the Knesset: today's)
  if (!p) return S.posMember;
  const span = p.now ? "–" + S.untilNow : p.y1 && p.y1 !== p.y0 ? "–" + p.y1 : "";   // ongoing says so (the live card shows only the start)
  return String(p.role || "").trim() + (p.y0 ? ` · ${p.y0}${span}` : "");
}
function listHtml(cards, S) {
  const list = Object.values(cards.data.members).filter(c => inKnesset(c, cards.data.knesset)).sort(listOrder);   // earlier Knessets: pages + sitemap + roster
  return `<div class="dirgrid">` + list.map(c => {
    const initials = c.he.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("");
    const av = c.photo ? `<img class="avatar avxl" src="${esc(PHOTO_BASE + c.photo)}" alt="" loading="lazy">`
      : `<span class="avatar avxl">${esc(initials)}</span>`;
    const years = c.since ? `${c.since}–${c.current ? S.untilNow : (c.until || "")}` : "";
    const b = c.bills && c.bills.passed;                 // none or unknown → no line (Mercy)
    const bills = !b ? "" : b === 1 ? S.dirPassed1 : fill(S.dirPassed, { n: b });
    return `<a class="dircard" href="${esc(pathOf(c, "he"))}">${av}` +
      `<span class="dcname">${esc(c.he)}</span><span class="dcrole">${esc(cardRole(c, S))}</span>` +
      (c.faction ? `<span class="dcparty" title="${esc(S.factionTip)}">${esc(c.faction)}</span>` : "") +
      (years ? `<span class="dcyears">${esc(years)}</span>` : "") +
      (bills ? `<span class="dcbills">${esc(bills)}</span>` : "") + `</a>`;
  }).join("") + `</div>`;
}
async function listPage(request, url) {
  const [cards, I, shell] = await Promise.all([
    cached("cards", async () => JSON.parse(await getText(CARDS_URL))),
    cached("i18n", async () => JSON.parse(await getText(url.origin + "/mk/mk.i18n.json"))),
    cached("shell", () => getText(url.origin + "/mk/")),
  ]);
  if (!cards || !cards.data || !cards.data.members) throw new Error("mkcards: no members");
  const re = /(<div id="dir"[^>]*>)(?:<div class="loading"[^>]*>[^<]*<\/div>)?<\/div>/;
  if (!re.test(shell)) throw new Error("shell: #dir anchor missing");
  const h = shell.replace(re, (m, a) => a + listHtml(cards, I.he) + "</div>")
    .replace(/<\/head>/, `<link rel="alternate" type="text/plain" href="/mk/roster.txt" title="Knesset members and ministers — plain text">
</head>`);
  return html(request.method === "HEAD" ? null : h);
}

/* ---- /mk/roster.txt: who holds what today, grouped and counted, in one
   plain-text fetch — for AI agents (they summarise long HTML badly and
   can't open 152 pages). English prose: it's machine-facing like llms.txt;
   roles stay in the register's Hebrew. Every card lands in exactly one group. ---- */
function rosterTxt(cards) {
  const K = cards.data.knesset;
  const all = Object.values(cards.data.members);
  const now = all.filter(c => inKnesset(c, K)), earlier = all.filter(c => !inKnesset(c, K));
  const firstK = Math.min(K, ...all.flatMap(c => c.knessets || []));
  const rolesOf = c => [...new Set([c.role, ...(c.positions || []).filter(p => p.now).map(p => p.role)]
    .map(r => String(r || "").trim()).filter(Boolean))];
  const inGov = c => rolesOf(c).some(r => MINISTER.test(r) || PM.test(r));
  const deputy = c => rolesOf(c).some(r => DEPUTY.test(r));
  // the register has had no committee-chair rows this Knesset: say so only
  // while that's true — once chairs appear they land in "Knesset posts"
  const chairs = now.some(c => rolesOf(c).some(r => /^(יושב(ת)?[-–\s]?ראש|יו"ר)\s*(ה)?ועד/.test(r)));
  const groups = [
    ["Government — ministers · הממשלה — שרים (incl. PM and deputy PM)", inGov],
    ["Deputy ministers · סגני שרים", c => !inGov(c) && deputy(c)],
    [`Knesset posts · תפקידים בכנסת (Speaker, deputy speakers, opposition leader, coalition chair${chairs ? ", committee chairs" : ""})`,
      c => c.current && !inGov(c) && !deputy(c) && rolesOf(c).length],
    ["Other serving members · חברי כנסת", c => c.current && !inGov(c) && !deputy(c) && !rolesOf(c).length],
    ["Left the Knesset during this term · עזבו את הכנסת", c => !c.current && !inGov(c) && !deputy(c)],
  ];
  const line = c => {
    const roles = rolesOf(c), past = !c.current && (c.positions || [])[0];
    const b = c.bills && c.bills.proposed ? `${c.bills.proposed} bill${c.bills.proposed === 1 ? "" : "s"}, ${c.bills.passed} became law` : "";
    const mk = c.current ? `MK since ${c.since}` : `MK ${c.since}–${c.until || ""}` + (inGov(c) || deputy(c) ? " (not an MK now)" : "");
    return "- " + [`${c.he} | ${c.en}`,
      roles.length ? roles.join("; ") : past ? `last post: ${String(past.role || "").trim()} ${past.y0 || ""}${past.y1 && past.y1 !== past.y0 ? "–" + past.y1 : ""}` : "",
      c.faction, mk, b, SITE + pathOf(c, "en")].filter(Boolean).join(" — ");
  };
  const date = cards.t ? new Date(cards.t).toISOString().slice(0, 10) : "";
  let out = `# Knesset members and government ministers — הכסף שלנו (Our Money)

All ${now.length} people who served in the ${K}th Knesset (including those who left it), grouped by the post they hold today;
then the ${earlier.length} members of earlier Knessets only (the ${firstK}th–${K - 1}th).
Source: the Knesset's official register (KNS_PersonToPosition), rebuilt monthly${date ? "; this snapshot: " + date : ""}.
Ministers who never sat in the ${cards.data.knesset}th Knesset are not in this list.${chairs ? "" : `
Committee chairs are not listed: the register holds no committee-chair rows for this Knesset.`}
Each line: Hebrew name | English name — posts today (as the register writes them) — faction — Knesset years — bills — page.
Machine-readable: https://api.ourmoneyil.com/data/mkcards · every page: ${SITE}/mk/sitemap.xml
`;
  const byTier = (a, b) => (tier(b) - tier(a)) || a.he.localeCompare(b.he, "he");
  for (const [title, test] of groups) {
    const rows = now.filter(test).sort(byTier);
    out += `\n## ${title} (${rows.length})\n` + rows.map(line).join("\n") + "\n";
  }
  const byLeft = (a, b) => ((b.until || 0) - (a.until || 0)) || a.he.localeCompare(b.he, "he");
  out += `\n## Members of earlier Knessets only · חברי כנסות קודמות (${earlier.length})\n` +
    earlier.sort(byLeft).map(line).join("\n") + "\n";
  return out;
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

/* =====================================================================
   /law/<IsraelLawID>-<name>/ — one law's page (site\law\NOTES.md). Hebrew
   only: laws have no English names (the page's own words still toggle).
   Inputs: /data/laws (every law, memoised) + /data/lawcard/<id> (this law:
   amendments, pending bills, regulations — edge-cached, not memoised) +
   the site's /law/page shell + /law/law.i18n.json (baked words).
   ===================================================================== */
const LAWS_URL = "https://api.ourmoneyil.com/data/laws";
const LAWCARD_URL = "https://api.ourmoneyil.com/data/lawcard/";
const DAY = () => new Date().toISOString().slice(0, 10);

// the name without its year ("חוק X, התשע"ז-2017" → "חוק X"), letters and
// digits only — the address tail; the id alone decides which law it is
const lawTitle = n => String(n || "").replace(/,?\s*(התש|תש)[\u0590-\u05ff"'״׳]*\s*[–-]?\s*\d{4}\s*$/, "")
  .replace(/,\s*\d{4}\s*$/, "").trim();
const lawSlug = n => lawTitle(n).replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/[\s-]+/g, "-");
const lawPath = l => `/law/${l.i}-${encodeURIComponent(lawSlug(l.n))}/`;

// the Knesset's validity words → plain groups (law.data.js lawState, same rules)
function lawState(l, today) {
  const st = l.st || "";
  if (/טרם/.test(st) || (l.s && l.s > today && /תקף/.test(st))) return "pending";
  if (/^תקף/.test(st)) return "in";
  if (/בטל/.test(st)) return "repealed";
  if (/פקע/.test(st)) return "expired";
  if (/נושן/.test(st)) return "obsolete";
  return "in";
}
const STATE_KEY = { in: "stIn", pending: "stPending", repealed: "stRepealed", expired: "stExpired", obsolete: "stObsolete", voided: "stVoided" };
const KIND_KEY = { void: "kVoid", partial: "kPartial", frozen: "kFrozen", deferred: "kDeferred" };
const LEGAL_FORCE = { in: "InForce", pending: "NotInForce", repealed: "NotInForce", expired: "NotInForce", obsolete: "NotInForce", voided: "NotInForce" };

function lawIndex(snap) {
  const d = snap.data, byId = new Map(d.laws.map(l => [l.i, l])), court = new Map();
  for (const c of d.court || []) (court.get(c.l) || court.set(c.l, []).get(c.l)).push(c);
  return { d, byId, court, t: snap.t };
}
function shownState(l, X, today) {
  const s = lawState(l, today);
  return s === "in" && (X.court.get(l.i) || []).some(c => c.k === "void") ? "voided" : s;
}
/* promoted = indexed + in the sitemap (Mercy): in force · not yet in force ·
   touched by the court · stopped ≤10 years ago (no end date → last publication) */
function promoted(l, X, today) {
  const s = lawState(l, today);
  if (s === "in" || s === "pending" || X.court.has(l.i)) return true;
  const ten = String(+today.slice(0, 4) - 10) + today.slice(4);
  return (l.e || l.lp || l.p || "") >= ten;
}
const fmtD = v => {
  if (!v) return "";
  const d = new Date(v + "T12:00:00Z");
  return isNaN(d) ? "" : d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const amendWords = (l, S) => l.a === 0 ? S.neverAmended : l.a === 1 ? S.amendedOnce : fill(S.amendedN, { n: l.a });

function lawBody(l, card, X, S, today) {
  const st = shownState(l, X, today), court = X.court.get(l.i) || [];
  const h2 = key => `<h2 data-i18n="${key}">${esc(S[key])}</h2>`;
  const link = (href, text, ext) => `<a class="doclink" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(text)}</a>`;
  const lawRef = r => { const o = r && r.i && X.byId.get(+r.i); return o ? link(lawPath(o), o.n) : esc(r.n || ""); };
  const out = [];

  // the head: name, the one-word truth, the facts in one line
  const chips = [`<span class="lbadge${st === "voided" ? " court" : ""}">${esc(S[STATE_KEY[st]])}</span>`];
  const cb = court.find(c => c.k !== "void" || st !== "voided");
  if (cb) chips.push(`<span class="lbadge court">${esc(S[KIND_KEY[cb.k]])}</span>`);
  if ((l.f || "").includes("b")) chips.push(`<span class="lbadge soft">${esc(S.basicLaw || "חוק יסוד")}</span>`);
  const facts = [];
  if (l.s) facts.push((st === "pending" ? S.startsDate : S.fromDate) + fmtD(l.s));
  if (l.e) facts.push((l.e < today ? S.endedDate : S.untilDate) + fmtD(l.e));
  facts.push(amendWords(l, S));
  if (card && card.min) facts.push(S.ministry + card.min);
  if (card && card.cm) facts.push(S.committee + card.cm);
  const rel = [];
  if (card && card.prev && card.prev.length) rel.push(esc(S.prevNames) + esc(card.prev.join(" · ")));
  // a long list (the penal code replaced 17 ordinances) shows three, the rest
  // one click away — still in the HTML for AI
  const refs = list => list.length <= 4 ? list.map(lawRef).join(" · ")
    : list.slice(0, 3).map(lawRef).join(" · ") + ` <details class="inline"><summary>${esc(fill(S.andMore, { n: list.length - 3 }))}</summary>${list.slice(3).map(lawRef).join(" · ")}</details>`;
  if (card && card.replacedBy && card.replacedBy.length) rel.push(esc(S.replacedByL) + refs(card.replacedBy));
  else if (l.r && X.byId.get(l.r)) rel.push(esc(S.replacedByL) + lawRef({ i: l.r }));
  if (card && card.replaces && card.replaces.length) rel.push(esc(S.replacesL) + refs(card.replaces));
  out.push(`<div class="card lawhead">
    <p class="crumbs"><a href="/law/laws.html" data-i18n="lpToList">${esc(S.lpToList)}</a></p>
    <h1 class="lawname">${esc(l.n)}</h1>
    <p class="chips">${chips.join(" ")}</p>
    <p class="facts">${facts.map(esc).join(" · ")}</p>
    ${rel.map(r => `<p class="facts">${r}</p>`).join("")}
    ${l.st ? `<p class="facts knesset">${esc(S.knessetSays + l.st)}</p>` : ""}
  </div>`);

  // about: the official summary of the original law + the Knesset's note
  const about = [];
  if (card && card.orig && card.orig.sum) about.push(`<p>${esc(card.orig.sum)}</p>`);
  if (card && card.note) about.push(`<p class="note">${esc(card.note)}</p>`);
  if (card && card.kz) about.push(`<p>${link(card.kz, S.kolZchut, true)}</p>`);
  if (about.length) out.push(`<div class="card">${h2("secAbout")}${about.join("")}</div>`);

  // what is about to change: bills pending that amend it
  if (card && card.pend && card.pend.length) {
    out.push(`<div class="card">${h2("secPending")}<p class="hint" data-i18n="pendHint">${esc(S.pendHint)}</p><ul class="hl plain">${card.pend.map(b =>
      `<li><div class="nm">${esc(b.n)}</div><div class="line">${esc([b.ty, b.step ? S.step + b.step : "", b.d ? S.lastSession + fmtD(b.d) : "", b.no].filter(Boolean).join(" · "))}</div></li>`).join("")}</ul></div>`);
  }

  // the court
  if (court.length) {
    out.push(`<div class="card">${h2("secCourt")}<ul class="hl plain">${court.map(c =>
      `<li><div class="nm">${esc(S[KIND_KEY[c.k]])} — ${esc(c.w)}</div><div class="line">${link(c.u, c.c, true)} · ${esc(fmtD(c.d))}${c.pn ? " · " + esc(c.pn + S.judges) : ""}${c.ds ? " · " + esc(S.dissent + c.ds) : ""}</div></li>`).join("")}</ul></div>`);
  }

  // amendments: the latest ten, the rest one click away (all in the HTML — AI reads it)
  if (card) {
    const row = a => `<li><div class="nm">${esc(a.n)}</div><div class="line">${esc([fmtD(a.d), a.ty === "ישיר" ? S.direct : a.ty ? S.indirect : ""].filter(Boolean).join(" · "))}${a.pdf ? " · " + link(a.pdf, S.pdf, true) : ""}</div>${a.sum ? `<details class="sum"><summary>${esc(S.officialSum)}</summary><p>${esc(a.sum)}</p></details>` : ""}</li>`;
    const am = card.am || [], head = am.slice(0, 10), rest = am.slice(10);
    const orig = card.orig ? `<p class="facts">${esc(S.origLaw)}${esc(fmtD(card.orig.d))}${card.orig.pdf ? " · " + link(card.orig.pdf, S.pdf, true) : ""}</p>` : "";
    const rep = (card.repBy || []).length ? `<p class="facts">${esc(S.repealedIn)}${card.repBy.map(r => esc(r.n) + (r.pdf ? " · " + link(r.pdf, S.pdf, true) : "")).join(" · ")}</p>` : "";
    out.push(`<div class="card">${h2("secAmend")}${am.length ? `<ul class="hl plain">${head.map(row).join("")}</ul>` +
      (rest.length ? `<details class="more"><summary>${esc(fill(S.allAmend, { n: am.length }))}</summary><ul class="hl plain">${rest.map(row).join("")}</ul></details>` : "")
      : `<p class="hint">${esc(S.noAmend)}</p>`}${rep}${orig}</div>`);
  }

  // regulations made under it
  if (card && card.nregs) {
    const r = card.regs || [], top = r.slice(0, 5), more = r.slice(5);
    const li = x => `<li><div class="nm">${esc(x.n)}</div>${x.d ? `<div class="line">${esc(fmtD(x.d))}</div>` : ""}</li>`;
    out.push(`<div class="card">${h2("secRegs")}<p class="hint">${esc(fill(S.regsCount, { n: card.nregs }))}</p><ul class="hl plain">${top.map(li).join("")}</ul>` +
      (more.length ? `<details class="more"><summary>${esc(S.allRegs)}</summary><ul class="hl plain">${more.map(li).join("")}</ul></details>` : "") +
      (card.nproc ? `<p class="hint">${esc(fill(S.regsProc, { n: card.nproc }))}</p>` : "") + `</div>`);
  }

  // sources, always
  const ws = (card && card.ws) || ("https://he.wikisource.org/w/index.php?search=" + encodeURIComponent(lawTitle(l.n)) + "&go=Go");
  out.push(`<div class="card">${h2("secSources")}<p class="srcs">${link(ws, S.srcTextL, true)}
    ${link("https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_IsraelLaw(" + l.i + ")?$format=json", S.srcKnessetL, true)}
    ${card && card.kz ? link(card.kz, S.kolZchut, true) : ""}</p>
    <p class="notadvice" data-i18n="notAdvice">${esc(S.notAdvice)}</p></div>`);
  return out.join("\n");
}

function renderLaw(shell, l, card, X, I) {
  const S = I.he, today = DAY(), st = shownState(l, X, today);
  const canon = SITE + lawPath(l);
  const title = fill(S.lpTitle, { name: l.n });
  const desc = fill(S.lpDesc, { name: l.n, state: S[STATE_KEY[st]], amended: amendWords(l, S) });
  const ld = { "@context": "https://schema.org", "@type": "Legislation", name: l.n, url: canon,
    legislationIdentifier: "IsraelLawID " + l.i, legislationJurisdiction: "IL", inLanguage: "he",
    legislationLegalForce: LEGAL_FORCE[st], description: desc };
  if (l.p) ld.legislationDate = l.p;
  if (l.lp) ld.dateModified = l.lp;
  if (card && card.ws) ld.sameAs = card.ws;
  let h = shell.replace(/<title>[\s\S]*?<\/title>\s*/, "")
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace(/<meta name="robots"[^>]*>\s*/, "")
    .replace(/<meta property="og:(title|description|url)"[^>]*>\s*/g, "");
  const head = `
<base href="/law/">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${promoted(l, X, today) ? "" : '<meta name="robots" content="noindex">\n'}<link rel="canonical" href="${esc(canon)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
`;
  h = /<meta charset[^>]*>/i.test(h) ? h.replace(/(<meta charset[^>]*>)/i, "$1" + head) : h.replace(/<head>/, "<head>" + head);
  return h.replace(/(<div id="lawpage"[^>]*>)<\/div>/, (m, a) => a + lawBody(l, card, X, S, today) + "</div>");
}

/* /law/index.txt — every law, grouped by what it is today, counted, one line
   each with its address: the AI agents' one-fetch answer (like roster.txt).
   Includes what people see folded (budget, no longer in force): AI sees all. */
function lawsTxt(X) {
  const today = DAY(), S = X.d;
  const groups = { pending: [], voided: [], in: [], repealed: [], expired: [], obsolete: [] };
  for (const l of S.laws) groups[shownState(l, X, today)].push(l);
  const title = { pending: "Passed, not yet in force", voided: "Voided in full by the Supreme Court (the Knesset's record still says תקף)",
    in: "In force", repealed: "Repealed by the Knesset (בטל)", expired: "Expired — temporary laws that ended (פקע)",
    obsolete: "Obsolete — served their purpose, never repealed (נושן)" };
  const line = l => {
    const bits = [l.n];
    for (const c of X.court.get(l.i) || []) bits.push(`court: ${c.k} ${c.c} ${c.d} — ${c.w}`);
    if (l.e) bits.push((l.e < today ? "ended " : "until ") + l.e);
    if ((l.f || "").includes("u")) bits.push("budget law");
    return `- ${bits.join(" | ")} — ${SITE}${lawPath(l)}`;
  };
  const parts = Object.keys(groups).map(k => `## ${title[k]} (${groups[k].length})\n` +
    groups[k].sort((a, b) => a.n.localeCompare(b.n, "he")).map(line).join("\n"));
  return `# Every Israeli law — הכסף שלנו (Our Money)
${S.laws.length} laws in the Knesset register, grouped by what they are today, as of ${new Date(X.t).toISOString().slice(0, 10)}.
Court effects come from a hand-kept list (the Knesset's records never note a court annulment).
Machine-readable: https://api.ourmoneyil.com/data/laws · every law's page: ${SITE}/law/sitemap.xml
Each page: status, amendments with gazette PDFs, bills that would change it, Supreme Court rulings, regulations, sources.

${parts.join("\n\n")}
`;
}

function lawSitemap(X) {
  const today = DAY(), mod = X.t ? `<lastmod>${new Date(X.t).toISOString().slice(0, 10)}</lastmod>` : "";
  const rows = X.d.laws.filter(l => promoted(l, X, today)).map(l => `<url><loc>${esc(SITE + lawPath(l))}</loc>${mod}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- the promoted law pages (worker\\pages.js, from /data/laws): in force, not yet in force, touched by the court, stopped ≤10 years ago -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join("\n")}
</urlset>
`;
}

async function lawRoute(request, url) {
  const isMap = url.pathname === "/law/sitemap.xml", isTxt = url.pathname === "/law/index.txt";
  const m = /^\/law\/(\d+)(?:-([^/]*))?(\/?)$/.exec(url.pathname);
  if (!m && !isMap && !isTxt) return fetch(request);             // the section's own pages and files
  const unavailable = e => new Response("Temporarily unavailable — " + e.message, {
    status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "300" } });
  let X, I;
  try {
    [X, I] = await Promise.all([
      cached("laws", async () => lawIndex(JSON.parse(await getText(LAWS_URL)))),
      cached("lawI18n", async () => JSON.parse(await getText(url.origin + "/law/law.i18n.json"))),
    ]);
  } catch (e) { return unavailable(e); }
  const head = request.method === "HEAD";
  if (isTxt) return new Response(head ? null : lawsTxt(X), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (isMap) return new Response(head ? null : lawSitemap(X), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });

  const l = X.byId.get(+m[1]);
  if (!l) return html(head ? null : lawNotFound(I, url.origin), 404);
  let slug = "";
  try { slug = decodeURIComponent(m[2] || ""); } catch (e) { /* bad escape → redirect */ }
  if (slug !== lawSlug(l.n) || m[1] !== String(l.i) || !m[3]) return moved(url.origin + lawPath(l));

  let shell;
  try { shell = await cached("lawShell", () => getText(url.origin + "/law/page")); }
  catch (e) { return unavailable(e); }
  let card = null;                                               // missing card → the page still has the facts
  if (!head) {
    try { card = JSON.parse(await getText(LAWCARD_URL + l.i)).data; } catch (e) { card = null; }
  }
  return html(head ? null : renderLaw(shell, l, card, X, I), 200,
    { "content-language": "he", link: `<${SITE + lawPath(l)}>; rel="canonical"` });
}

function lawNotFound(I, origin) {
  const S = I.he, E = I.en;
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>${esc(S.title)}</title><link rel="stylesheet" href="${origin}/shared/style.css"></head>
<body><div class="wrap"><div class="card">
<h2>${esc(S.lpNotFound)}</h2><p><a href="/law/laws.html">${esc(S.lpToList)}</a></p>
<p dir="ltr">${esc(E.lpNotFound)} <a href="/law/laws.html">${esc(E.lpToList)}</a></p>
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
    if (url.pathname.startsWith("/law/")) return lawRoute(request, url);
    // the list: pre-filled when everything is at hand, else the site's page as is
    if (url.pathname === "/mk/") return listPage(request, url).catch(() => fetch(request));
    const isMap = url.pathname === "/mk/sitemap.xml", isRoster = url.pathname === "/mk/roster.txt";
    const m = /^\/mk\/(\d+)(?:-([^/]*))?(\/?)$/.exec(url.pathname);
    if (!m && !isMap && !isRoster) return fetch(request);           // the page's files — the site's

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
    if (isRoster) return new Response(request.method === "HEAD" ? null : rosterTxt(cards), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
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
    // the bill list: its own document per MK, edge-cached, not memoised
    // (500 lists up to ~300 KB each would crowd the isolate); missing → loader
    let bills = null;
    if (request.method !== "HEAD" && c.bills) {
      try { bills = JSON.parse(await getText(BILLS_URL + c.id)).data; } catch (e) { bills = null; }
    }
    const vary = { "content-language": lang, link: `<${SITE + pathOf(c, lang)}>; rel="canonical"` };
    return html(request.method === "HEAD" ? null : render(shell, c, I, lang, bills), 200, vary);
  },
};
