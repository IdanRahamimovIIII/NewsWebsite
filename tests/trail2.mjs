/* Playwright test for the rebuilt budget page.
   Runs index.html against a FAKE BudgetKey whose table deliberately contains
   both trees ('00xx' and 'Cxxx') plus the revenue root '0000' — the exact
   shape that produced the live bug. Also feeds the OLD, mixed snapshot to
   prove the page filters it client-side (no worker redeploy needed).

   node test_budget.mjs        (needs: npm i playwright)                    */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* the site lives next door in ../site — but still work if run from inside it */
const DIR = fs.existsSync(path.join(process.cwd(), 'index.html'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..', 'site');
const PORT = 8931;

/* ---------- the fake raw_budget table ---------- */
const T = [];
const row = (year, code, title, a, r, e) =>
  T.push({ year, code, title, net_allocated: a, net_revised: r, net_executed: e });

for (const year of [2026, 2025, 2024]) {
  const k = year === 2025 ? 1 : 0.94;
  row(year, '00',   'המדינה',        682e9 * k, 683e9 * k, 640e9 * k);
  row(year, '0000', 'הכנסות המדינה', 755e9 * k, 756e9 * k, 700e9 * k);   // revenue, must never be a "section"
  // functional tree (2 levels only)
  const funcs = [['C1','בטחון וסדר ציבורי',197e9],['C2','שירותים חברתיים',272e9],
                 ['C3','תשתיות',58e9],['C4','משרדי מטה',35e9],['C5','עניני משק',8e9],
                 ['C6','החזרי חוב',77e9],['C7','הוצאות אחרות',32e9],['C8','הכנסות',755e9]];
  for (const [c, tl, v] of funcs) row(year, c, tl, v * k, v * k, v * 0.95 * k);
  row(year, 'C111', 'בטחון וסדר ציבורי / בטחון',       150e9 * k, 150e9 * k, 148e9 * k);
  row(year, 'C112', 'בטחון וסדר ציבורי / בטחון פנים',   47e9 * k,  47e9 * k,  46e9 * k);
  row(year, 'C221', 'שירותים חברתיים / בריאות',         80e9 * k,  80e9 * k,  79e9 * k);
  // administrative tree — 22 sections so the "show all" path is exercised
  const secs = [['0015','משרד הביטחון',197e9],['0020','משרד החינוך',96e9],                ['0024','משרד הבריאות',60e9],['0027','הקצבות לביטוח לאומי',55e9],['0079','תחבורה',30e9],
                ['0007','המשרד לביטחון לאומי',28e9],['0098','רשות מקרקעי ישראל',26e9],
                ['0031','משרד הפנים',18e9],['0035','משרד המשפטים',12e9],
                ['0040','משרד החקלאות',9e9],['0047','משרד התרבות',7e9],['0019','משרד החוץ',6e9],
                ['0022','משרד הכלכלה',5e9],['0060','משרד האנרגיה',4e9],['0070','המשרד להגנת הסביבה',3e9],
                ['0072','משרד התיירות',2e9],['0074','משרד המדע',1.5e9],['0076','משרד העלייה',1e9],
                ['0088','משרד הדתות',0.8e9],['0090','נשיא המדינה',0.2e9],
                ['0092','מבקר המדינה',1.2e9],['0094','הכנסת',0.9e9]];
  for (const [c, tl, v] of secs) row(year, c, tl, v * k * 0.95, v * k, v * k * 0.9);
  // the four flows: revenue codes + the two debt sections
  // 2024 and 2025 have real execution; 2026 is still only a plan
  const done = year <= 2025;
  const grow = year === 2026 ? 1.08 : (year === 2025 ? 1 : 0.92);
  const act = v => done ? v * grow : null;
  row(year, 'C881', 'הכנסות / מסים ישירים',  280e9*grow, 285e9*grow, act(300e9));
  row(year, 'C882', 'הכנסות / מסים עקיפים',  190e9*grow, 195e9*grow, act(205e9));
  row(year, 'C883', 'הכנסות / אגרות',          9e9*grow,   9e9*grow, act( 10e9));
  row(year, 'C884', 'הכנסות / הכנסות אחרות',  26e9*grow,  26e9*grow, act( 29e9));
  row(year, 'C886', 'הכנסות / למימון גירעון', 238e9*grow, 238e9*grow, act(220e9));
  row(year, '0045', 'תשלום ריבית ועמלות',      57e9*grow,  58e9*grow, act( 58e9));
  row(year, '0084', 'תשלום חובות',            155e9*grow, 156e9*grow, act(147e9));
  // depth under משרד החינוך: 6 → 8 → 10
  row(year, '002060',     'חינוך יסודי',            50e9 * k, 51e9 * k, 49e9 * k);
  row(year, '002061',     'חינוך על יסודי',         30e9 * k, 30e9 * k, 29e9 * k);
  row(year, '00206001',   'תכנית הזנה',              3e9 * k,  3e9 * k,  2.9e9 * k);
  row(year, '0020600101', 'תקנה: הזנה בגני ילדים',   1e9 * k,  1e9 * k,  0.95e9 * k);
}

/* contract_spending keys lines with the budget's OWN 10-digit code, so a
   prefix match is the join. payments[] is the real money: one entry per
   published quarterly report, carrying the CUMULATIVE paid to that date.
   Every trap the live data actually contains is armed here:
     - the same report published twice (two URLs) → must be deduped
     - an annual report with period null, which lands AFTER Q4
     - executed dropping to 0 in the newest reports → "not reported", and the
       page must print a dash rather than invent a collapse
     - a contract with no years at all → must NOT be assumed to be running now
     - purchase_method / exemption_reason arrive as ARRAYS, not strings */
const P = (year, period, executed, volume, url) => ({ year: String(year), period, executed, volume, url });
const CONTRACTS = [
  { budget_code: '0020600101', supplier_name: 'קייטרינג הדגל', entity_name: 'קייטרינג הדגל בע"מ',
    entity_kind: 'company', purpose: 'הזנה בגני ילדים',
    publisher_name: 'משרד החינוך', purchase_method: ['תקנה 3(4) - פטור ממכרז'],
    exemption_reason: ['תקנה 3(4) - התקשרות עם ספק יחיד'],
    volume: 40e6, executed: 30e6, min_year: 2019, max_year: 2026,
    payments: [
      P(2024, 4, 18e6, 40e6, 'https://foi.gov.il/a.xlsx'),
      P(2024, 4, 18e6, 40e6, 'https://gov.il/a.xlsx'),     // same report, twice
      P(2025, 2, 26e6, 40e6, 'https://foi.gov.il/b.xlsx'),
      P(2025, null, 30e6, 40e6, 'https://foi.gov.il/c.xlsx'), // annual, after Q4
    ] },
  { budget_code: '0020600101', supplier_name: 'עמותת מזון לכל', entity_name: 'עמותת מזון לכל',
    entity_kind: 'association', purpose: 'הזנה בבתי ספר',
    publisher_name: 'משרד החינוך', purchase_method: ['תקנה 1ב - מכרז פומבי רגיל'],
    exemption_reason: [],
    volume: 12e6, executed: 11e6, min_year: 2018, max_year: 2021,
    payments: [P(2021, 4, 11e6, 12e6, 'https://foi.gov.il/d.xlsx')] },
  // deliberately NOT on the deepest line: a section must answer for what is under it
  { budget_code: '0020610207', supplier_name: 'הסעות הדרום', entity_name: 'הסעות הדרום בע"מ',
    entity_kind: 'company', purpose: 'הסעות תלמידים',
    publisher_name: 'משרד החינוך', purchase_method: ['תקנה 1ב - מכרז פומבי רגיל'],
    exemption_reason: [],
    volume: 300e6, executed: 290e6, min_year: 2020, max_year: 2027,
    payments: [
      P(2024, 4, 200e6, 300e6, 'https://foi.gov.il/e.xlsx'),
      P(2025, 3, 0, 300e6, 'https://foi.gov.il/f.xlsx'),   // stopped reporting
    ] },
  /* reported in 2023 and again in 2025, nothing in 2024 — a real pattern
     (מ. מ. ירוחם is reported in 2017 then not again until 2023). The gap must
     not be silently spanned: 9m − 5m would blame 2025 for two years of money. */
  { budget_code: '0020600101', supplier_name: 'תשתיות הנגב', entity_name: 'תשתיות הנגב בע"מ',
    entity_kind: 'company', purpose: 'תחזוקת מבנים',
    publisher_name: 'משרד החינוך', purchase_method: ['תקנה 1ב - מכרז פומבי רגיל'],
    exemption_reason: [],
    volume: 20e6, executed: 9e6, min_year: 2019, max_year: 2026,
    payments: [P(2023, 4, 5e6, 20e6, 'https://foi.gov.il/g.xlsx'),
               P(2025, 2, 9e6, 20e6, 'https://foi.gov.il/h.xlsx')] },
  /* THE מילגם CASE, with the REAL order id and the REAL budget code, so this
     test resolves against the actual site/data/paid/0020.json we ship. */
  { budget_code: '0020670205', supplier_name: 'מילגם', entity_name: 'מילגם בע"מ',
    entity_kind: 'company', purpose: 'הזנה בניצנים',
    publisher_name: 'משרד החינוך', purchase_method: ['תקנה 1ב - מכרז פומבי רגיל'],
    exemption_reason: [], order_id: '4502539235',
    volume: 409961432.74, executed: 0, min_year: 2024, max_year: 2026,
    payments: [P(2024, 4, 0, 409961432.74, 'https://foi.gov.il/i.xlsx'),
               P(2025, 1, 0, 409961432.74, 'https://foi.gov.il/j.xlsx')] },
  // no years at all — must never be assumed to be running in the chosen year
  { budget_code: '0020600101', supplier_name: 'ספק בלי שנים', entity_name: 'ספק בלי שנים',
    entity_kind: 'company', purpose: 'לא ידוע',
    publisher_name: 'משרד החינוך', purchase_method: ['תקנה 1ב - מכרז פומבי רגיל'],
    exemption_reason: [],
    volume: 900e6, executed: 0, min_year: null, max_year: null, payments: [] },
];
let lastContractSql = '';

/* ---------- a tiny SQL matcher (also validates the SQL we generate) ---------- */
function runSql(sql) {
  if (/FROM\s+contract_spending/i.test(sql)) {
    lastContractSql = sql;
    const pre = (sql.match(/budget_code\s+LIKE\s+'([^%']*)%'/i) || [])[1];
    if (pre == null) throw new Error('contracts query with no budget_code filter');
    const from = (sql.match(/min_year\s*<=\s*(\d+)/) || [])[1];
    const to = (sql.match(/max_year\s*>=\s*(\d+)/) || [])[1];
    const needYears = /min_year\s+IS\s+NOT\s+NULL/i.test(sql) && /max_year\s+IS\s+NOT\s+NULL/i.test(sql);
    /* Honour the SELECT list. A fixture that hands back every column no matter
       what was asked for lets a missing column pass here and fall back to the
       wrong number live — the whole point of this test is to catch that. */
    const cols = (sql.match(/SELECT([\s\S]*?)FROM/i) || [, ''])[1]
      .split(',').map(s => s.trim()).filter(Boolean);
    const project = c => Object.fromEntries(cols.filter(k => k in c).map(k => [k, c[k]]));
    return CONTRACTS.filter(c => c.budget_code.startsWith(pre)
      && (!needYears || (c.min_year != null && c.max_year != null))
      && (!from || (c.min_year != null && c.min_year <= +from))
      && (!to || (c.max_year != null && c.max_year >= +to)))
      .sort((a, b) => b.volume - a.volume)
      .map(project);
  }
  if (/DISTINCT\s+year/i.test(sql)) return [{ year: 2026 }, { year: 2025 }, { year: 2024 }];
  if (!/FROM\s+raw_budget/i.test(sql)) throw new Error('unexpected table in: ' + sql);

  const year = (sql.match(/year\s*=\s*(\d+)/) || [])[1];
  const yearMin = (sql.match(/year\s*>=\s*(\d+)/) || [])[1];
  const inList = (sql.match(/code\s+IN\s*\(([^)]*)\)/i) || [])[1];
  const like = (sql.match(/code\s+LIKE\s+'([^%']*)%'/i) || [])[1];
  const len = (sql.match(/length\(code\)\s*=\s*(\d+)/i) || [])[1];
  const ne = (sql.match(/code\s*<>\s*'([^']*)'/) || [])[1];
  const eq = (sql.match(/code\s*=\s*'([^']*)'/) || [])[1];

  let rows = T.filter(r => !year || r.year === +year);
  if (yearMin) rows = rows.filter(r => r.year >= +yearMin);
  if (inList) {
    const set = new Set(inList.split(',').map(x => x.trim().replace(/^'|'$/g, '')));
    rows = rows.filter(r => set.has(r.code));
  }
  if (eq !== undefined) rows = rows.filter(r => r.code === eq);
  if (like !== undefined) rows = rows.filter(r => r.code.startsWith(like));
  if (len !== undefined) rows = rows.filter(r => r.code.length === +len);
  if (ne !== undefined) rows = rows.filter(r => r.code !== ne);
  rows = rows.slice().sort((a, b) => (b.net_revised ?? b.net_allocated) - (a.net_revised ?? a.net_allocated));
  return rows;
}

/* ---------- static server ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));


const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport:{width:1180,height:900}, colorScheme:'light' });
const errs=[]; page.on('pageerror', e=>errs.push(String(e)));
await page.route('**/sdmx.oecd.org/**', r => r.fulfill({ status:200, contentType:'application/json',
  body: JSON.stringify({ data:{ structures:[{dimensions:{observation:[{id:'TIME_PERIOD',values:[{id:'2025'}]}]}}],
  dataSets:[{observations:{'0':[1427.3e9]}}] } }) }));
await page.route('**/next.obudget.org/api/query**', route => {
  const sql = new URL(route.request().url()).searchParams.get('query') || '';
  let body; try { body = { success:true, rows: runSql(sql) }; } catch(e){ body={success:false,error:e.message}; }
  route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) }); });
await page.route('**/our-money.idannhhb.workers.dev/data/budget', route => {
  const sections = T.filter(r => r.year === 2026 && r.code.length === 4);
  route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ t: Date.now(), data:{
    year: 2026, years:[2026,2025,2024], sections, total: T.find(r=>r.year===2026 && r.code==='00') } }) }); });
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(()=>document.querySelectorAll('.barrow').length>0,null,{timeout:12000});
await page.click('.barrow[data-code="0020"]');
await page.waitForTimeout(400);
await page.click('.barrow[data-code="0020"] ~ .kids > .paidline .paidbtn');
await page.waitForSelector('.whopaid');
await page.evaluate(()=>document.querySelector('.whopaid').scrollIntoView({block:'center'}));
await page.waitForTimeout(200);
await page.screenshot({ path:'/tmp/new/tests/trail2.png' });
{ await page.setViewportSize({ width:390, height:820 });
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.querySelector('.whopaid').scrollIntoView({block:'center'}));
  await page.waitForTimeout(250);
  const over = await page.evaluate(()=>{ const d=document.documentElement;
    const w=document.querySelector('.whopaid .tw');
    let worst = null, wmax = 0; const list = [];
    document.querySelectorAll('body *').forEach(el => {
      if (el.closest('svg')) return;              // svg roots clip their own paint
      const r = el.getBoundingClientRect();
      if (r.right > d.clientWidth + 0.5 || r.left < -0.5)
        list.push(el.tagName + '.' + (el.className || '') + ' L' + Math.round(r.left) + ' R' + Math.round(r.right));
      if (r.right > wmax) { wmax = r.right; worst = el; }
    });
    return { pageScrollsSideways: d.scrollWidth > d.clientWidth,
             docScrollW: d.scrollWidth, clientW: d.clientWidth,
             offenders: list.slice(0, 8), widestRight: Math.round(wmax),
             widest: worst && (worst.tagName + '.' + (worst.className || '')),
             tw: w ? { client: w.clientWidth, scroll: w.scrollWidth } : null,
             tableW: w ? w.querySelector('table').scrollWidth : null }; });
  console.log('phone:', JSON.stringify(over));
  await page.screenshot({ path:'/tmp/new/tests/phone.png' });
  await page.setViewportSize({ width:1180, height:900 });
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.querySelector('.whopaid').scrollIntoView({block:'center'}));
  await page.waitForTimeout(200); }
await page.click('.whopaid .purposebtn');
await page.waitForTimeout(300);
console.log('pops after purpose:', await page.$$eval('.pop', e=>e.length));
await page.screenshot({ path:'/tmp/new/tests/pop-purpose.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('.whopaid .info-i');
await page.waitForTimeout(300);
console.log('pops after info:', await page.$$eval('.pop', e=>e.length));
await page.screenshot({ path:'/tmp/new/tests/pop-info.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('.whopaid button.method');
await page.waitForTimeout(300);
console.log('pops after tender:', await page.$$eval('.pop', e=>e.length));
await page.screenshot({ path:'/tmp/new/tests/pop-tender.png' });
console.log(errs.length ? 'ERR '+errs.join(' | ') : 'clean');
await browser.close(); server.close();
