// wtest_pages.mjs — the entity-pages worker (worker/pages.js) against the
// REAL site/mk/index.html + mk.i18n.json, with a fake mkcards snapshot that
// carries the live traps: namesakes (same name, two MkIds), an apostrophe
// dropped from the slug, no photo, bills null / 0 / 1, a leaver, no
// positions, markup inside a Knesset field. Run: node worker/wtest_pages.mjs
// (also renders every card of pipeline/mkcards/out/mkcards.json if present).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = fs.readFileSync(path.join(ROOT, "site/mk/index.html"), "utf8");
const I18N = fs.readFileSync(path.join(ROOT, "site/mk/mk.i18n.json"), "utf8");
const ORIGIN = "https://ourmoneyil.com";
const CARDS_URL = "https://api.ourmoneyil.com/data/mkcards";

const card = (o) => ({ pids: [1], photo: null, current: true, role: "", faction: "הליכוד",
  since: 2022, until: null, knessets: [25], bills: { proposed: 10, passed: 2 }, positions: [], ...o });
const FIX = { t: 1790232519868, data: { knesset: 25, stats: {}, members: {
  "1096": card({ id: 1096, he: "עמיחי אליהו", en: "Amichay Eliyahu", slugHe: "עמיחי-אליהו", slugEn: "amichay-eliyahu",
    photo: "1096-5b417625.jpg", role: "שר המורשת", faction: "עוצמה יהודית", bills: { proposed: 0, passed: 0 },
    positions: [{ role: "שר המורשת", y0: 2025, y1: null, k: 25, now: true }, { role: "שר המורשת", y0: 2022, y1: 2025, k: 25, now: false }] }),
  "1132": card({ id: 1132, he: "מוחמד אבו אל היג'א", en: "Mohammad Abu El Higa", slugHe: "מוחמד-אבו-אל-היגא",
    slugEn: "mohammad-abu-el-higa", faction: "יש עתיד", bills: null }),
  "30": card({ id: 30, he: "אלי כהן", en: "Eli Cohen", slugHe: "אלי-כהן", slugEn: "eli-cohen", bills: { proposed: 5, passed: 1 } }),
  "31": card({ id: 31, he: "אלי כהן", en: "Eli Cohen", slugHe: "אלי-כהן", slugEn: "eli-cohen", current: false,
    since: 2006, until: 2025, role: "<b>יו\"ר</b>", positions: [{ role: "יו\"ר ועדה & <x>", y0: 2006, y1: 2009, k: 17, now: false }] }),
} } };

let failures = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { failures++; console.error("FAIL: " + msg); } };

let upstream = { cards: () => new Response(JSON.stringify(FIX)) };
let passed = [];
globalThis.fetch = async (input, init) => {
  const u = typeof input === "string" ? input : input.url;
  if (u === CARDS_URL) return upstream.cards();
  if (u === ORIGIN + "/mk/") return new Response(SHELL);
  if (u === ORIGIN + "/mk/mk.i18n.json") return new Response(I18N);
  passed.push(u);
  return new Response("SITE:" + u);
};
const { default: worker } = await import("./pages.js?" + Date.now());
const get = (p, method = "GET") => worker.fetch(new Request(ORIGIN + p, { method, redirect: "manual" }));
const enc = s => encodeURIComponent(s);
const divBalance = h => (h.match(/<div\b/g) || []).length - (h.match(/<\/div>/g) || []).length;

// 1. everything that isn't an MK address belongs to the site
for (const p of ["/mk/", "/mk/mk.css", "/mk/?name=x", "/mk/mk.i18n.json", "/mk/tests/x"]) {
  const r = await get(p), site = await (await fetch(ORIGIN + p)).text();
  ok((await r.text()) === site, "pass-through " + p);
}
passed = []; ok((await (await get("/mk/1096-עמיחי-אליהו/", "POST")).text()).startsWith("SITE:"), "POST passes through");

// 2. the Hebrew page
const heP = `/mk/1096-${enc("עמיחי-אליהו")}/`;
let r = await get(heP), h = await r.text();
ok(r.status === 200, "he 200");
ok(h.includes('<html lang="he" dir="rtl">'), "he html lang");
ok((h.match(/<title>/g) || []).length === 1 && h.includes("<title>עמיחי אליהו — "), "one he title with the name");
ok((h.match(/rel="canonical"/g) || []).length === 1 && h.includes(`rel="canonical" href="${ORIGIN}${heP}"`), "one canonical, encoded");
ok(h.includes(`hreflang="en" href="${ORIGIN}/mk/1096-amichay-eliyahu/"`) && h.includes('hreflang="x-default"'), "hreflang pair");
ok((h.match(/og:title/g) || []).length === 1 && (h.match(/og:url/g) || []).length === 1, "og tags not duplicated");
ok(h.indexOf('<base href="/mk/">') > -1 && h.indexOf('<base href="/mk/">') < h.indexOf("stylesheet"), "<base> before the stylesheets");
const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h)[1]);
ok(ld["@type"] === "Person" && ld.name === "עמיחי אליהו" && ld.alternateName === "Amichay Eliyahu" && ld.jobTitle === "שר המורשת", "JSON-LD person");
ok(/id="profile" style="display:block"/.test(h) && /id="searchCard" style="display:none"/.test(h) && /id="dirCard" style="display:none"/.test(h), "portfolio open, list hidden");
ok(/<p class="tagline"[^>]*style="display:none"/.test(h), "tagline hidden");
ok(/<h1 class="mkname">עמיחי אליהו <span class="mkrole">· שר המורשת<\/span><\/h1>/.test(h), "hero name + role");
ok(h.includes("https://api.ourmoneyil.com/photos/mk/1096-5b417625.jpg"), "portrait");
ok(h.includes(JSON.parse(I18N).he.bNoBills), "0 bills → the no-bills sentence, not a 0");
ok((h.match(/class="posrow"/g) || []).length === 2 && h.includes("2022 – 2025"), "positions baked");
ok(divBalance(h) === divBalance(SHELL), "div balance kept");
const ent = h.indexOf("window.MK_ENTITY="), cfg = h.search(/<script src="[^"]*shared\/config\.js">/);
ok(ent > -1 && ent < cfg, "MK_ENTITY before config.js");
const E = JSON.parse(/window\.MK_ENTITY=(\{.*?\});<\/script>/.exec(h)[1]);
ok(E.id === 1096 && E.lang === "he" && E.url.en === "/mk/1096-amichay-eliyahu/" && E.dir === "/mk/", "MK_ENTITY payload");
ok(E.title.list && SHELL.includes(`<title>${E.title.list}</title>`), "the list's own title kept for Back");
ok(r.headers.get("content-language") === "he", "content-language");

// 3. the English page
r = await get("/mk/1096-amichay-eliyahu/"); h = await r.text();
const EN = JSON.parse(I18N).en;
ok(r.status === 200 && h.includes('<html lang="en" dir="ltr">'), "en html lang");
ok(h.includes("<title>Amichay Eliyahu — Knesset member portfolio"), "en title");
ok(h.includes(`data-i18n="secPositions">${EN.secPositions}<`) && h.includes(`data-i18n="navMk">${EN.navMk}<`), "en chrome baked");
ok(h.includes(`placeholder="${EN.searchMkPh.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`), "en placeholder");
ok(/<button class="langbtn"[^>]*>עברית<\/button>/.test(h), "lang button offers Hebrew");
ok(h.includes(EN.posNow) && h.includes(EN.backToDir), "en baked facts");
ok(divBalance(h) === divBalance(SHELL), "en div balance");

// 4. traps: apostrophe slug, no photo, bills null, namesakes, markup in data, leaver
r = await get(`/mk/1132-${enc("מוחמד-אבו-אל-היגא")}/`); h = await r.text();
ok(r.status === 200 && /<span class="avatar avxxl">מא<\/span>/.test(h), "no photo → initials");
ok(!/billsbar|bNoBills/.test(h) && !h.includes(JSON.parse(I18N).he.bNoBills), "bills null → no line");
ok(/<div id="positions"><div class="loading"/.test(h), "no positions → the page's loader stays");
r = await get(`/mk/31-${enc("אלי-כהן")}/`); h = await r.text();
ok(h.includes("&lt;b&gt;יו&quot;ר&lt;/b&gt;") && !h.includes("<b>יו\"ר</b>") && h.includes("&amp; &lt;x&gt;"), "Knesset text escaped");
ok(h.includes("בכנסת 2006–2025") && /window\.MK_ENTITY=\{"id":31/.test(h), "leaver tenure + own id");
ok(h.includes(JSON.parse(I18N).he.billsStory.replace("{t}", 10).replace("{p}", 2)), "bills sentence");
r = await get(`/mk/30-${enc("אלי-כהן")}/`); h = await r.text();
ok(/window\.MK_ENTITY=\{"id":30/.test(h) && h.includes(JSON.parse(I18N).he.billsStory1.replace("{t}", 5)), "namesake by id, one law");

// 5. every other spelling → one 301 to the canonical address
const loc = async p => { const x = await get(p); return x.status + " " + (x.headers.get("location") || ""); };
ok(await loc("/mk/1096") === `301 ${ORIGIN}${heP}`, "bare id → he");
ok(await loc("/mk/1096/") === `301 ${ORIGIN}${heP}`, "id/ → he");
ok(await loc(`/mk/1096-${enc("עמיחי-אליהו")}`) === `301 ${ORIGIN}${heP}`, "no slash → slash");
ok(await loc("/mk/1096-Amichay-Eliyahu/") === `301 ${ORIGIN}/mk/1096-amichay-eliyahu/`, "case → en canonical");
ok(await loc("/mk/1096-someone-else/") === `301 ${ORIGIN}/mk/1096-amichay-eliyahu/`, "latin wrong slug → en");
ok(await loc(`/mk/1096-${enc("שם-אחר")}/`) === `301 ${ORIGIN}${heP}`, "hebrew wrong slug → he");
ok(await loc("/mk/01096-amichay-eliyahu/") === `301 ${ORIGIN}/mk/1096-amichay-eliyahu/`, "leading zero → canonical");
ok(await loc("/mk/1096-%E0%A4%A/") === `301 ${ORIGIN}${heP}`, "broken escape → he");

// 6. unknown MK → a real 404 (never the site's catch-all page)
r = await get("/mk/999999-nobody/"); h = await r.text();
ok(r.status === 404 && h.includes('name="robots" content="noindex"'), "unknown id → 404 noindex");
r = await get("/mk/999999-nobody/", "HEAD");
ok(r.status === 404 && (await r.text()) === "", "HEAD 404 no body");

// 7. the sitemap: every card, both languages, each with its pair
r = await get("/mk/sitemap.xml"); h = await r.text();
ok(r.headers.get("content-type").startsWith("application/xml"), "sitemap type");
ok((h.match(/<url>/g) || []).length === 8 && (h.match(/<xhtml:link /g) || []).length === 16, "sitemap: 4 cards × 2 langs, paired");
ok(h.includes(`<loc>${ORIGIN}${heP}</loc><lastmod>2026-09-24</lastmod>`), "sitemap loc + lastmod");

// 8. snapshot down → 503, not the site
const { default: w2 } = await import("./pages.js?down" + Date.now());
upstream.cards = () => new Response("nope", { status: 404 });
r = await w2.fetch(new Request(ORIGIN + heP)); ok(r.status === 503 && r.headers.get("retry-after"), "snapshot down → 503");
upstream.cards = () => new Response(JSON.stringify({ error: "not published" }));
const { default: w3 } = await import("./pages.js?empty" + Date.now());
r = await w3.fetch(new Request(ORIGIN + heP)); ok(r.status === 503, "no members → 503");

// 9. every real card, if a local build exists
const real = path.join(ROOT, "pipeline/mkcards/out/mkcards.json");
if (fs.existsSync(real)) {
  const raw = JSON.parse(fs.readFileSync(real, "utf8"));
  const env = raw.data && raw.data.members ? raw : { t: Date.now(), data: raw };   // out\ holds the bare data
  upstream.cards = () => new Response(JSON.stringify(env));
  const { default: w4 } = await import("./pages.js?real" + Date.now());
  let bad = 0;
  for (const c of Object.values(env.data.members)) for (const l of ["he", "en"]) {
    const p = `/mk/${c.id}-${enc(l === "en" ? c.slugEn : c.slugHe)}/`;
    const x = await w4.fetch(new Request(ORIGIN + p)); const t = await x.text();
    if (x.status !== 200 || divBalance(t) !== divBalance(SHELL) || !t.includes(`lang="${l}"`)) { bad++; console.error("real card:", p, x.status); }
  }
  ok(!bad, `all ${Object.keys(env.data.members).length} real cards render in he+en`);
}

console.log(failures ? `${failures} of ${n} FAILED` : `all ${n} passed`);
process.exit(failures ? 1 : 0);
