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

// the bill lists (/data/mkbills/<id>): 30 has six across the piles, with
// markup in a name and an empty status; 1096 has none; 31's fetch fails
const BILLS = {
  "30": [{ n: "חוק א", s: "התקבלה בקריאה השלישית", k: 25, b: "passed" },
         { n: 'חוק <b>"ב"</b> & ג', s: "נדחתה בקריאה הטרומית", k: 25, b: "rejected" },
         { n: "חוק ד", s: "הונחה על שולחן הכנסת", k: 25, b: "pending" },
         { n: "חוק ה", s: "", k: 20, b: "stale" },   // a list built before the rename
         { n: "חוק ז", s: "הונחה על שולחן הכנסת", k: 19, b: "undecided" },
         { n: "חוק ו", s: "הוסרה מסדר היום", k: 20, b: "rejected" }],
  "1096": [],
};
let upstream = { cards: () => new Response(JSON.stringify(FIX)) };
let passed = [];
globalThis.fetch = async (input, init) => {
  const u = typeof input === "string" ? input : input.url;
  if (u === CARDS_URL) return upstream.cards();
  if (u.startsWith("https://api.ourmoneyil.com/data/mkbills/")) {
    const id = u.split("/").pop();
    return BILLS[id] ? new Response(JSON.stringify({ t: 1, data: BILLS[id] })) : new Response("{}", { status: 500 });
  }
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
for (const p of ["/mk/mk.css", "/mk/mk.i18n.json", "/mk/tests/x"]) {
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

// 4b. "מה ניסו להעביר?": every bill, name + status, in the page's piles
{
  const HE = JSON.parse(I18N).he;
  r = await get(`/mk/30-${enc("אלי-כהן")}/`); h = await r.text();
  const box = /<div id="bills">([\s\S]*?)<\/div>\s*<\/div>/.exec(h)[1];
  ok(box.includes(`<summary>${HE.bPassed} (1)</summary>`) && box.includes(`<summary>${HE.bRejected} (2)</summary>`) &&
     box.includes(`<summary>${HE.bPending} (1)</summary>`) && box.includes(`<summary>${HE.bUndecided} (2)</summary>`) &&
     box.includes(HE.tipUndecided.slice(0, 30)), "bills: four piles, counted; old \"stale\" lists still land in לא הוכרעו");
  ok((box.match(/<li>/g) || []).length === 6, "bills: every bill listed");
  ok(box.indexOf(HE.bPassed) < box.indexOf(HE.bRejected) && box.indexOf(HE.bRejected) < box.indexOf(HE.bPending), "bills: the page's pile order");
  ok(box.includes("חוק &lt;b&gt;&quot;ב&quot;&lt;/b&gt; &amp; ג") && !box.includes("<b>"), "bills: names escaped");
  ok(box.includes("<li>חוק ה</li>") && box.includes('<li>חוק א <span class="names">· התקבלה בקריאה השלישית</span></li>'), "bills: status shown, empty status left out");
  ok(divBalance(h) === divBalance(SHELL), "bills: divs balanced");
  h = await (await get(heP)).text();
  ok(new RegExp(`<div id="bills"><div class="loading">${HE.bNoBills}</div></div>`).test(h), "bills: an empty list says so");
  h = await (await get(`/mk/31-${enc("אלי-כהן")}/`)).text();
  ok(/<div id="bills"><div class="loading" data-i18n="loading">/.test(h), "bills: fetch failed → the page's loader stays");
  h = await (await get(`/mk/1132-${enc("מוחמד-אבו-אל-היגא")}/`)).text();
  ok(/<div id="bills"><div class="loading" data-i18n="loading">/.test(h), "bills: no count → no list asked for");
}

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

// 7b. /mk/ itself: every card a real link, in the directory's order; a
// minister outside the Knesset (left under the Norwegian law) keeps today's role
{
  const { default: wl } = await import("./pages.js?list" + Date.now());
  const LIST = JSON.parse(JSON.stringify(FIX));
  Object.assign(LIST.data.members, {
    "90": card({ id: 90, he: "בנימין נתניהו", en: "Benjamin Netanyahu", slugHe: "בנימין-נתניהו", slugEn: "benjamin-netanyahu", role: "ראש הממשלה", bills: { proposed: 3, passed: 0 } }),
    "91": card({ id: 91, he: "דוד אמסלם", en: "David Amsalem", slugHe: "דוד-אמסלם", slugEn: "david-amsalem", current: false, until: 2023,
      positions: [{ role: "שר נוסף במשרד המשפטים", y0: 2023, y1: null, k: 25, now: true }] }),
    // traps: "סגן" ends in a final nun; a deputy minister's title contains "ראש הממשלה"
    "92": card({ id: 92, he: "אלמוג כהן", en: "Almog Cohen", slugHe: "אלמוג-כהן", slugEn: "almog-cohen", current: false, until: 2025,
      positions: [{ role: "סגן שר במשרד ראש הממשלה", y0: 2023, y1: null, k: 25, now: true }] }),
    "93": card({ id: 93, he: "יעקב מרגי", en: "Yakov Margi", slugHe: "יעקב-מרגי", slugEn: "yakov-margi", role: "סגן יושב-ראש הכנסת" }),
    // an earlier Knesset only (K17): a page + the roster, not the current list
    "95": card({ id: 95, he: "ישראל ישראלי", en: "Israel Israeli", slugHe: "ישראל-ישראלי", slugEn: "israel-israeli",
      current: false, since: 2006, until: 2009, knessets: [17],
      positions: [{ role: "שר התיירות", y0: 2007, y1: null, k: 17, now: false }] }),
  });
  const keep = upstream.cards; upstream.cards = () => new Response(JSON.stringify(LIST));
  r = await wl.fetch(new Request(ORIGIN + "/mk/")); h = await r.text();
  const links = [...h.matchAll(/<a class="dircard" href="([^"]+)">/g)].map(x => x[1]);
  ok(r.status === 200 && links.length === 8 && !links.some(l => l.startsWith("/mk/95-")), "list: the 8 of the current Knesset as links, not earlier Knessets");
  ok((await (await wl.fetch(new Request(ORIGIN + "/mk/?name=x"))).text()).includes(links[0]), "list: ?name= arrivals get it too");
  ok(links[0] === "/mk/90-" + enc("בנימין-נתניהו") + "/" && links[1].startsWith("/mk/1096-"), "list: PM, then the minister");
  ok(["91", "92", "31"].every(id => links.slice(-3).some(l => l.startsWith(`/mk/${id}-`))), "list: leavers last");
  ok(h.includes('href="/mk/roster.txt"'), "list: points to the roster");
  ok(h.includes('<span class="dcrole">שר נוסף במשרד המשפטים · 2023–היום</span>'), "list: a minister outside the Knesset keeps the role");
  ok(!/dcbills">[^<]*0 /.test(h) && h.includes(fill(JSON.parse(I18N).he.dirPassed, 2)), "list: laws passed, never a 0");
  ok(!/<div id="dir"><div class="loading"/.test(h) && divBalance(h) === divBalance(SHELL), "list: loader replaced, divs balanced");
  ok(h.includes('data-i18n="devLabel"'), "footer carries the API link");
  r = await wl.fetch(new Request(ORIGIN + `/mk/91-${enc("דוד-אמסלם")}/`)); h = await r.text();
  ok(h.includes('<span class="mkrole">· שר נוסף במשרד המשפטים</span>') && h.includes('"jobTitle":"שר נוסף במשרד המשפטים"'), "entity: today's role for a minister outside the Knesset");
  ok(h.includes(JSON.parse(I18N).he.tenureGov.replace("{y}", 2023)), "entity: 'in government, not in the Knesset' said, not a contradiction");
  r = await wl.fetch(new Request(ORIGIN + "/mk/1096-amichay-eliyahu/")); h = await r.text();
  ok(!/content="[^"]*\.\.[^"]*"/.test(h), "description: no double period");
  // the roster: every card in exactly one group, counted
  r = await wl.fetch(new Request(ORIGIN + "/mk/roster.txt")); const txt = await r.text();
  ok(r.headers.get("content-type").startsWith("text/plain"), "roster: plain text");
  const sec = t => (new RegExp(`## ${t}[^\\n]*\\((\\d+)\\)\\n([\\s\\S]*?)(?=\\n## |$)`).exec(txt) || []);
  const gov = sec("Government"), dep = sec("Deputy"), posts = sec("Knesset posts"), oth = sec("Other"), left = sec("Left");
  ok([gov, dep, posts, oth, left].every(x => x.length) &&
    [gov, dep, posts, oth, left].reduce((n, x) => n + +x[1], 0) === 8 && (txt.match(/^- /gm) || []).length === 9, "roster: 9 cards, each once, counts add up");
  const early = sec("Members of earlier Knessets");
  ok(early[1] === "1" && early[2].includes("ישראל ישראלי") && early[2].includes("last post: שר התיירות 2007") && !gov[2].includes("ישראל ישראלי"), "roster: earlier Knesset in its own section, not in government");
  ok(/the 17th–24th/.test(txt), "roster: the span of earlier Knessets from the data");
  r = await wl.fetch(new Request(ORIGIN + "/mk/95-israel-israeli/")); h = await r.text();
  ok(r.status === 200 && h.includes("In the Knesset 2006–2009") && !h.includes('class="mkrole"'), "entity: an earlier-Knesset member's page, no role today");
  ok(gov[2].includes("בנימין נתניהו") && gov[2].includes("דוד אמסלם") && gov[2].includes("(not an MK now)") && !gov[2].includes("אלמוג"), "roster: government incl. the minister outside the Knesset");
  ok(dep[1] === "1" && dep[2].includes("אלמוג כהן"), "roster: deputy minister in the PM's office is a deputy");
  ok(posts[2].includes("יעקב מרגי") && !posts[2].includes("אלמוג"), "roster: deputy speaker is a Knesset post");
  ok(left[2].includes("אלי כהן") && txt.includes("https://ourmoneyil.com/mk/90-benjamin-netanyahu/"), "roster: leavers + page links");
  ok(txt.includes("https://api.ourmoneyil.com/data/mkcards") && /never sat in the 25th Knesset/.test(txt), "roster: data link + honest scope");
  ok(txt.includes("Committee chairs are not listed"), "roster: no chairs in the data → says so");
  // once the register carries chairs, they're listed and the caveat goes
  const CH = JSON.parse(JSON.stringify(LIST));
  CH.data.members["94"] = card({ id: 94, he: "שמחה רוטמן", en: "Simcha Rothman", slugHe: "שמחה-רוטמן", slugEn: "simcha-rothman", role: 'יו"ר ועדת החוקה, חוק ומשפט' });
  upstream.cards = () => new Response(JSON.stringify(CH));
  const { default: wc } = await import("./pages.js?chairs" + Date.now());
  const t2 = await (await wc.fetch(new Request(ORIGIN + "/mk/roster.txt"))).text();
  ok(!t2.includes("Committee chairs are not listed") && /## Knesset posts[^\n]*committee chairs\) \(2\)/.test(t2) && t2.includes("שמחה רוטמן"), "roster: chairs appear → listed, caveat gone");
  upstream.cards = () => new Response(JSON.stringify(LIST));
  // inputs down or the anchor gone → the site's own /mk/, never an error
  upstream.cards = () => new Response("nope", { status: 500 });
  const { default: wd } = await import("./pages.js?listdown" + Date.now());
  ok((await (await wd.fetch(new Request(ORIGIN + "/mk/"))).text()) === SHELL, "list: snapshot down → the site's page");
  upstream.cards = keep;
}
function fill(s, n) { return s.replace("{n}", n); }

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
  // …with their real bill lists when the build wrote them
  const realBills = path.join(ROOT, "pipeline/mkcards/out/mkbills.json");
  const lists = fs.existsSync(realBills) ? JSON.parse(fs.readFileSync(realBills, "utf8")) : {};
  Object.assign(BILLS, lists);
  const { default: w4 } = await import("./pages.js?real" + Date.now());
  let bad = 0, biggest = [0, ""];
  for (const c of Object.values(env.data.members)) for (const l of ["he", "en"]) {
    const p = `/mk/${c.id}-${enc(l === "en" ? c.slugEn : c.slugHe)}/`;
    const x = await w4.fetch(new Request(ORIGIN + p)); const t = await x.text();
    const listed = (t.match(/<li>/g) || []).length, want = lists[c.id] ? lists[c.id].length : null;
    if (x.status !== 200 || divBalance(t) !== divBalance(SHELL) || !t.includes(`lang="${l}"`) ||
        (want !== null && listed !== want) || (want !== null && c.bills && want !== c.bills.proposed)) {
      bad++; console.error("real card:", p, x.status, "listed", listed, "want", want, "card", c.bills && c.bills.proposed);
    }
    if (t.length > biggest[0]) biggest = [t.length, c.he];
  }
  ok(!bad, `all ${Object.keys(env.data.members).length} real cards render in he+en` +
    (Object.keys(lists).length ? `, every bill listed (${Object.keys(lists).length} lists)` : ""));
  console.log(`  heaviest page: ${biggest[1]} — ${Math.round(biggest[0] / 1024)} KB of HTML`);
}

console.log(failures ? `${failures} of ${n} FAILED` : `all ${n} passed`);
process.exit(failures ? 1 : 0);
