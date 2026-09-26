// wtest_lawpages.mjs — the law pages of the entity-pages worker (worker/pages.js)
// against the REAL site/law/page.html + law.i18n.json, with a fake /data/laws
// + /data/lawcard/<id> that carry the live traps: a law voided in full whose
// Knesset record still says תקף, an old obsolete law (noindex, not in the
// sitemap), a law with no card (the page still stands), markup inside a name,
// 14 amendments (10 shown, all in the HTML), a name with a year and quotes
// (the slug), a pending law. Run: node worker/wtest_lawpages.mjs
// (also renders every law of pipeline/laws/out/laws.json + lawcards.json if present).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = fs.readFileSync(path.join(ROOT, "site/law/page.html"), "utf8");
const I18N = fs.readFileSync(path.join(ROOT, "site/law/law.i18n.json"), "utf8");
const ORIGIN = "https://ourmoneyil.com";
const LAWS_URL = "https://api.ourmoneyil.com/data/laws";
const CARD_URL = "https://api.ourmoneyil.com/data/lawcard/";

const law = o => ({ st: "תקף", s: null, e: null, p: "2000-01-01", lp: "2020-01-01", f: "", t: [], a: 0, ad: 0, r: null, ...o });
let SNAP = { t: 1790000000000, data: { knesset: 25, topics: {}, bills: [], laws: [
  law({ i: 2015037, n: 'חוק להסדרת ההתיישבות ביהודה והשומרון, התשע"ז-2017', p: "2017-02-13", lp: "2017-02-13" }),
  law({ i: 2000001, n: "פקודת הפנסיה לסיר <b>מקדונל</b>, 1936", st: "נושן", p: "1936-12-31", lp: "1936-12-31" }),
  law({ i: 2000479, n: 'חוק העונשין, התשל"ז-1977', a: 14, ad: 10, s: "1978-04-02" }),
  law({ i: 2245315, n: 'חוק התקשורת (שידורים), התשפ"ו-2026', st: "טרם נכנס לתוקף", s: "2028-07-28" }),
  law({ i: 2000002, n: "חוק ישן שבוטל", st: "בטל", e: "2021-05-01", p: "1990-01-01", lp: "2019-01-01" }),
], court: [
  { l: 2015037, k: "void", c: 'בג"ץ 1308/17', d: "2020-06-09", w: "ביטול החוק כולו", u: "https://supremedecisions.court.gov.il/x", pn: "9", ds: "נ' סולברג" },
] } };
const BILLCARDS = {};
const CARDS = {
  2000479: { i: 2000479, min: "המשפטים", cm: "חוקה, חוק ומשפט", note: "הערה", ws: "https://he.wikisource.org/wiki/חוק_העונשין",
    kz: "https://www.kolzchut.org.il/x", prev: [], orig: { n: "חוק העונשין", d: "1977-08-04", pdf: "", sum: "" },
    am: Array.from({ length: 14 }, (_, k) => ({ n: `חוק העונשין (תיקון מס' ${155 - k})`, d: `2026-0${1 + (k % 9)}-01`, ty: k % 3 ? "ישיר" : "עקיף", pdf: k === 0 ? "https://fs.knesset.gov.il/a.pdf" : "", sum: k === 1 ? "תקציר <script>x</script>" : "" })),
    repBy: [], pend: [{ i: 1, n: "הצעת חוק העונשין (תיקון מס' 160)", no: "(פ/2198/25)", ty: "פרטית", step: "הכנה לקריאה ראשונה", cm: "", d: "2025-07-14" }],
    regs: [{ n: "תקנות א", d: "2022-07-04" }], nregs: 89, nproc: 11, replacedBy: [], replaces: [] },
  2015037: { i: 2015037, min: "", cm: "", note: "", ws: "", kz: "", prev: [], orig: { n: "x", d: "2017-02-13", pdf: "https://fs.knesset.gov.il/o.pdf", sum: "החוק נועד להסדיר" },
    am: [], repBy: [], pend: [], regs: [], nregs: 0, nproc: 0, replacedBy: [], replaces: [] },
};

let failures = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { failures++; console.error("FAIL: " + msg); } };
let passed = [];
globalThis.fetch = async (input) => {
  const u = typeof input === "string" ? input : input.url;
  if (u === LAWS_URL) return new Response(JSON.stringify(SNAP));
  if (u.startsWith(CARD_URL)) {
    const id = u.slice(CARD_URL.length);
    return CARDS[id] ? new Response(JSON.stringify({ t: 1, data: CARDS[id] })) : new Response('{"error":"not published"}', { status: 404 });
  }
  if (u === ORIGIN + "/law/page") return new Response(SHELL);
  if (u === ORIGIN + "/law/bill") return new Response(fs.readFileSync(path.join(ROOT, "site/law/bill.html"), "utf8"));
  if (u.startsWith("https://api.ourmoneyil.com/data/billcard/")) {
    const id = u.split("/").pop();
    return BILLCARDS[id] ? new Response(JSON.stringify({ t: 1, data: BILLCARDS[id] })) : new Response("{}", { status: 404 });
  }
  if (u === ORIGIN + "/law/law.i18n.json") return new Response(I18N);
  passed.push(u);
  return new Response("SITE:" + u);
};
const { default: worker } = await import("./pages.js?" + Date.now());
const get = (p, method = "GET") => worker.fetch(new Request(ORIGIN + p, { method, redirect: "manual" }));
const slug = "חוק-להסדרת-ההתיישבות-ביהודה-והשומרון";

// the canonical page
let r = await get(`/law/2015037-${encodeURIComponent(slug)}/`);
let h = await r.text();
ok(r.status === 200, "voided law page 200, got " + r.status);
ok(h.includes('<h1 class="lawname">חוק להסדרת ההתיישבות ביהודה והשומרון, התשע&quot;ז-2017</h1>'), "the name is the headline");
ok(h.includes("בוטל בבג״ץ") && !h.includes(">חל היום<"), "voided in full says so, never 'applies today'");
ok(h.includes("ברשומות הכנסת: תקף"), "the Knesset's own word stays, labelled");
ok(h.includes('"legislationLegalForce":"NotInForce"'), "JSON-LD: not in force");
ok(!h.includes('name="robots"'), "a court-touched law is indexed");
ok(h.includes(`<link rel="canonical" href="https://ourmoneyil.com/law/2015037-${encodeURIComponent(slug)}/">`), "canonical address");
ok(h.includes("9 שופטים") && h.includes("נ&#39; סולברג"), "panel + dissent shown");
ok(h.includes("החוק נועד להסדיר"), "the original law's official summary");
ok(h.includes('<base href="/law/">'), "relative files resolve from /law/");
ok(!/<p class="tagline"/.test(h), "no section headline on a law's page");
ok(r.headers.get("content-language") === "he", "content-language he");

// slug/slash/id spellings → one address
r = await get("/law/2015037");
ok(r.status === 301 && r.headers.get("location").endsWith(`/law/2015037-${encodeURIComponent(slug)}/`), "no slug → 301");
r = await get(`/law/2015037-${encodeURIComponent(slug)}`);
ok(r.status === 301, "no trailing slash → 301");
r = await get("/law/2015037-wrong-name/");
ok(r.status === 301, "wrong slug → 301");
r = await get("/law/0999999-x/");
ok(r.status === 404, "unknown law → 404");
ok((await r.text()).includes("noindex"), "the 404 is noindex");

// an obsolete 1936 ordinance: exists, noindex, markup escaped, no card → still a page
r = await get("/law/2000001");
const to = r.headers.get("location");
r = await get(new URL(to).pathname);
h = await r.text();
ok(r.status === 200, "a law without a card still has a page");
ok(h.includes('<meta name="robots" content="noindex">'), "an old obsolete law is noindex");
ok(h.includes("&lt;b&gt;מקדונל&lt;/b&gt;") && !h.includes("<b>מקדונל</b>"), "markup in a name is escaped");
ok(h.includes("נושן"), "obsolete said in words");

// the penal code: amendments, pending bills, regulations, sources
r = await get("/law/2000479"); r = await get(new URL(r.headers.get("location")).pathname); h = await r.text();
ok(h.includes("משרד אחראי: המשפטים") && h.includes("ועדה בכנסת: חוקה, חוק ומשפט"), "ministry + committee by name");
ok(Array.from({ length: 14 }, (_, k) => 155 - k).every(no => h.includes("(תיקון מס&#39; " + no + ")")), "all 14 amendments are in the HTML (AI reads them)");
ok(h.includes("כל 14 התיקונים"), "the rest folded behind 'all 14'");
ok(h.includes("תקציר &lt;script&gt;") && !h.includes("<script>x</script>"), "an official summary is escaped");
ok(h.includes("הצעת חוק העונשין (תיקון מס&#39; 160)") && h.includes("שלב: הכנה לקריאה ראשונה"), "pending bills with their stage");
ok(h.includes("89 תקנות") && h.includes("ועוד 11 בהליך"), "regulations counted");
ok(h.includes("https://he.wikisource.org/wiki/חוק_העונשין") && h.includes("כל זכות"), "sources: Wikisource + Kol Zchut");
ok(h.includes("תיקון עקיף"), "direct/indirect in words");

// pending law
r = await get("/law/2245315"); r = await get(new URL(r.headers.get("location")).pathname); h = await r.text();
ok(h.includes("יתחיל לחול ב") && h.includes('"legislationLegalForce":"NotInForce"'), "a pending law starts later");

// sitemap + index.txt
r = await get("/law/sitemap.xml"); h = await r.text();
ok(r.headers.get("content-type").startsWith("application/xml"), "sitemap is xml");
ok(h.includes("/law/2015037-") && h.includes("/law/2000479-") && h.includes("/law/2245315-"), "promoted laws in the sitemap");
ok(!h.includes("/law/2000001-"), "an obsolete 1936 law is not promoted");
ok(h.includes("/law/2000002-"), "a law repealed ≤10 years ago is promoted");
r = await get("/law/index.txt"); h = await r.text();
ok(h.includes("5 laws in the Knesset register"), "index.txt counts every law");
ok(/Voided in full[^\n]*\(1\)/.test(h) && h.includes("court: void בג\"ץ 1308/17"), "index.txt: the voided group + the ruling");
ok(h.includes("Obsolete") && h.includes("מקדונל"), "index.txt holds what people see folded");

// a bill page (a multi-law amendment): its facts in the site-wide order
SNAP.data.billPages = [{ i: 2219672, n: 'חוק לעידוד פעילות בשוק ההון (תיקוני חקיקה), התשפ"ו-2026', k: "amend" }];
BILLCARDS[2219672] = { i: 2219672, k: "amend", n: 'חוק לעידוד פעילות בשוק ההון (תיקוני חקיקה), התשפ"ו-2026', ty: "ממשלתית",
  st: "התקבלה בקריאה שלישית", cm: "ועדת הכספים", by: [], first: "הצעות חוק הממשלה, 26/06/2024", pub: "ספר החוקים, 02/08/2026",
  c: "2026-11-02", sum: "", note: "", journey: [{ d: "2024-06-26", s: "הונחה על שולחן הכנסת לקריאה ראשונה", w: "במליאה", p: "https://fs.knesset.gov.il/p.doc" }],
  docs: [{ g: "הצעת חוק לקריאה הראשונה", u: "https://fs.knesset.gov.il/b.pdf" }], laws: [{ i: 2000479, n: "x" }, { i: 2015037, n: "y" }] };
const { default: wb } = await import("./pages.js?bill" + Date.now());
r = await wb.fetch(new Request(ORIGIN + "/bill/2219672", { redirect: "manual" }));
ok(r.status === 301 && r.headers.get("location").includes("/bill/2219672-"), "a bill without its name → 301");
r = await wb.fetch(new Request(r.headers.get("location"), { redirect: "manual" }));
h = await r.text();
ok(r.status === 200 && h.includes('<h1 class="lawname">חוק לעידוד פעילות בשוק ההון'), "the bill page renders");
// the labels as the page prints them (a bare word can also occur inside the shell)
const order = ["<b>מגישים:</b>", "<b>סוג:</b>", "<b>שלב:</b>", "<b>ועדה:</b>", "<b>תיקון לחוק:</b>", ">מה התיקון עושה<", ">ההצבעות במליאה<", ">מסלול החקיקה<", ">מסמכים רשמיים<"];
const body = h.slice(h.indexOf('id="lawpage"'));
const pos = order.map(w => body.indexOf(w));
ok(pos.every(p => p > 0) && pos.every((p, k) => k === 0 || p > pos[k - 1]), "the bill page keeps the site-wide order: " + order.filter((w, k) => pos[k] <= 0).join(", "));
ok(h.includes('href="/law/2000479-') && h.includes("דברי ההסבר") && h.includes("/votes/?q="), "laws, explanatory notes, votes link");
r = await wb.fetch(new Request(ORIGIN + "/bill/999/", { redirect: "manual" }));
ok(r.status === 404, "a bill without a page → 404");
r = await wb.fetch(new Request(ORIGIN + "/bill/index.txt")); h = await r.text();
ok(h.includes("Amendments that change several laws (1)"), "bill index.txt");
const billSite = new Function(fs.readFileSync(path.join(ROOT, "site/shared/bills.js"), "utf8").match(/function billSlug[\s\S]*?\n}/)[0] + "; return billSlug;")();
const wsrc = fs.readFileSync(path.join(ROOT, "worker/pages.js"), "utf8");
const billWorker = new Function(wsrc.match(/const lawTitle = [\s\S]*?\n/)[0] + wsrc.match(/  \.replace\(\/,\\s\*\\d\{4\}[\s\S]*?\n/)[0] +
  wsrc.match(/const lawSlug = [\s\S]*?\n/)[0] + wsrc.match(/const billSlug = [\s\S]*?\n/)[0] + "; return billSlug;")();
const names = [SNAP.data.billPages[0].n, "הצעת חוק העונשין (תיקון מס' 160) (עונש מוות למחבלים), התשפ\"ו-2025",
  "הצעת חוק הוועדה המשותפת של ועדת החוקה, חוק ומשפט ושל ועדת הכלכלה לדיון בהצעת חוק תובענות ייצוגיות (תיקון מס' 16)"];
ok(names.every(n => billSite(n) === billWorker(n)), "site and worker bill slugs agree");

// the section's own pages pass through untouched
passed = [];
for (const p of ["/law/", "/law/laws.html", "/law/laws", "/law/law.css", "/law/law.i18n.json?x"]) {
  r = await get(p); ok((await r.text()) === "SITE:" + ORIGIN + p, p + " passes through");
}
r = await get("/law/2000479-x/", "HEAD");
ok(r.status === 301, "HEAD redirects too");

// every real law, if the pipeline's output is here
const outDir = path.join(ROOT, "pipeline/laws/out");
if (fs.existsSync(path.join(outDir, "laws.json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(outDir, "laws.json"), "utf8"));
  const cards = fs.existsSync(path.join(outDir, "lawcards.json")) ? JSON.parse(fs.readFileSync(path.join(outDir, "lawcards.json"), "utf8")) : {};
  SNAP = { t: Date.now(), data };
  Object.assign(CARDS, cards);
  const { default: w2 } = await import("./pages.js?real" + Date.now());
  let heavy = { n: "", kb: 0 }, bad = 0;
  for (const l of data.laws) {
    let rr = await w2.fetch(new Request(ORIGIN + "/law/" + l.i, { redirect: "manual" }));
    rr = await w2.fetch(new Request(rr.headers.get("location"), { redirect: "manual" }));
    const hh = await rr.text();
    if (rr.status !== 200 || !hh.includes('class="lawname"')) { bad++; if (bad < 5) console.error("real law failed:", l.i, rr.status); }
    if (hh.length / 1024 > heavy.kb) heavy = { n: l.n, kb: Math.round(hh.length / 1024) };
  }
  ok(bad === 0, `every real law renders (${data.laws.length}, ${bad} failed)`);
  // the site builds the same address the worker serves (law.data.js lawSlug ≡ pages.js lawSlug)
  const siteSrc = fs.readFileSync(path.join(ROOT, "site/law/law.data.js"), "utf8").match(/function lawSlug[\s\S]*?\n}/)[0];
  const workerSrc = fs.readFileSync(path.join(ROOT, "worker/pages.js"), "utf8");
  const siteSlug = new Function(siteSrc + "; return lawSlug;")();
  const workerSlug = new Function(workerSrc.match(/const lawTitle = [\s\S]*?\n/)[0] + workerSrc.match(/  \.replace\(\/,\\s\*\\d\{4\}[\s\S]*?\n/)[0] +
    workerSrc.match(/const lawSlug = [\s\S]*?\n/)[0] + "; return lawSlug;")();
  const drift = data.laws.filter(l => siteSlug(l.n) !== workerSlug(l.n));
  ok(drift.length === 0, `site and worker slugs agree for every law (${drift.length} differ${drift[0] ? ": " + drift[0].n : ""})`);
  console.log(`  real: ${data.laws.length} laws, ${Object.keys(cards).length} cards; heaviest page: ${heavy.n} — ${heavy.kb} KB`);
}

console.log(failures ? `${failures} of ${n} FAILED` : `all ${n} passed`);
process.exit(failures ? 1 : 0);
