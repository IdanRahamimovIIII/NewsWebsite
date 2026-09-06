/* Playwright test for the rebuilt budget page.
   Runs index.html against a FAKE BudgetKey whose table deliberately contains
   both trees ('00xx' and 'Cxxx') plus the revenue root '0000' — the exact
   shape that produced the live bug. Also feeds the OLD, mixed snapshot to
   prove the page filters it client-side (no worker redeploy needed).

   node site/budget_page/test_budget.mjs   (needs: npm i playwright)                    */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* the site is this file's parent folder (site/budget_page/ → site/) — works from any cwd */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

/* contracts_data keys lines as '20.60.01.01'; the budget calls the same line
   '0020600101'. The page has to translate, and this fixture only answers the
   dotted form — so a wrong translation shows up as an empty list, not a pass. */
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
  /* THE מילגם CASE. BudgetKey stores the order value to the agora and the
     amount paid as 0.0 — so the ministry's own published file is the only
     place the payment exists. The relay's /data/paid/<section> document must
     fill it in, and the row must say the figure came from somewhere else. */
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
  const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'budget_page/index.html');
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/* The real OECD response lists TIME_PERIOD newest-first. Mapping observations
   by position instead of by the codelist silently shifts every year — it did,
   once. This fixture keeps that trap armed. */
const OECD_DEBT = { 2026: 1519.9e9, 2025: 1427.3e9, 2024: 1323.2e9 };
function sdmxFixture() {
  const years = Object.keys(OECD_DEBT).sort((a, b) => b - a);          // descending
  return { data: {
    structures: [{ dimensions: { observation: [
      { id: 'REF_AREA', values: [{ id: 'ISR' }] },
      { id: 'TIME_PERIOD', values: years.map(y => ({ id: String(y) })) },
    ] } }],
    dataSets: [{ observations: Object.fromEntries(
      years.map((y, i) => [`0:${i}`, [OECD_DEBT[y]]])) }],
  } };
}

async function openPage({ snapshot, noDebt }) {
  const page = await browser.newPage();
  await page.route('**/sdmx.oecd.org/**', route => noDebt
    ? route.fulfill({ status: 500, body: 'oecd down' })
    : route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(sdmxFixture()) }));
  page.on('console', m => { if (m.type() === 'error') console.log('    [browser error]', m.text()); });

  await page.route('**/next.obudget.org/api/query**', route => {
    const sql = new URL(route.request().url()).searchParams.get('query') || '';  // already decoded
    let body;
    try { body = { success: true, rows: runSql(sql) }; }
    catch (e) { body = { success: false, error: e.message }; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/our-money.idannhhb.workers.dev/data/budget', route => {
    if (!snapshot) return route.fulfill({ status: 404, body: 'no snapshot' });
    // deliberately the OLD mixed query: every length-4 row, both trees + '0000'
    const sections = T.filter(r => r.year === 2026 && r.code.length === 4);
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ t: Date.now(), data: {
        year: 2026, years: [2026, 2025, 2024], sections,
        total: T.find(r => r.year === 2026 && r.code === '00'),
      } }),
    });
  });

  /* the ministry-report overlay, as the relay serves it since 2026-09-06
     (before that the page read site/data/paid/*.json from its own folder).
     One section only — משרד החינוך — with the מילגם order the assertions
     below look for. */
  await page.route('**/our-money.idannhhb.workers.dev/data/paid/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const env = data => ({ status: 200, contentType: 'application/json',
                           body: JSON.stringify({ t: Date.now(), data }) });
    if (name === 'index') return route.fulfill(env({ sections: ['0020'] }));
    if (name === '0020') return route.fulfill(env({
      sources: ['https://www.gov.il/BlobFolder/dynamiccollectorresultitem/education_1_2025/he/repository-of-answers_ministry-of-education_education_1_2025.xlsx'],
      reports: { education: '2025Q1' },
      orders: { '4502539235:0020670205': [235298429.36, 409961432.74] },
    }));
    route.fulfill({ status: 404, body: 'no such section' });
  });

  await page.goto(`http://localhost:${PORT}/budget_page/index.html`);
  await page.waitForFunction(() => document.querySelectorAll('.barrow').length > 0, null, { timeout: 12000 });
  return page;
}

const codes = page => page.$$eval('#chart > .barrow', els => els.map(e => e.dataset.code));
const allCodes = page => page.$$eval('.barrow', els => els.map(e => e.dataset.code));

/* === 1. snapshot path — the stored snapshot is still the old mixed one === */
console.log('\nsnapshot path (old mixed snapshot, filtered in the page):');
{
  const page = await openPage({ snapshot: true });
  const c = await codes(page);
  ok('no functional (C…) rows in the ministry view', !c.some(x => x.startsWith('C')), c.filter(x => x.startsWith('C')).join(','));
  ok("revenue root '0000' is not shown as a section", !c.includes('0000'));
  ok('every row is a real 00xx section', c.every(x => /^00\d\d$/.test(x) && x !== '0000'), c.join(','));
  ok('biggest section first (0015 משרד הביטחון)', c[0] === '0015', c[0]);
  ok('the section count says 24 real sections, not the 33 the old query returned',
    /\b24\b/.test(await page.textContent('#treecount')), await page.textContent('#treecount'));
  await page.close();
}

/* === 2. live path === */
console.log('\nlive path (no snapshot):');
const page = await openPage({ snapshot: false });
{
  const c = await codes(page);
  ok('no C… rows', !c.some(x => x.startsWith('C')));
  ok("no '0000'", !c.includes('0000'));
  ok('15 rows before "show all"', c.length === 15, String(c.length));
  ok('no single "total budget" headline is claimed any more',
    (await page.$$('#t-total')).length === 0);
}

/* === 3. drilldown to תקנה level (10 chars) === */
console.log('\ndrilldown, ministry tree:');
{
  await page.click('.barrow[data-code="0020"]');
  await page.waitForSelector('.barrow[data-code="002060"]', { timeout: 5000 });
  ok('4 → 6 opens', true);
  await page.click('.barrow[data-code="002060"]');
  await page.waitForSelector('.barrow[data-code="00206001"]', { timeout: 5000 });
  ok('6 → 8 opens', true);
  const caret8 = await page.$eval('.barrow[data-code="00206001"] .caret', e => e.textContent.trim());
  ok('an 8-char row still offers a caret (the old code stopped here)', caret8 === '▸', JSON.stringify(caret8));
  await page.click('.barrow[data-code="00206001"]');
  await page.waitForSelector('.barrow[data-code="0020600101"]', { timeout: 5000 });
  ok('8 → 10 opens: the תקנה level is reachable', true);
  const caret10 = await page.$eval('.barrow[data-code="0020600101"] .caret', e => e.textContent.trim());
  ok('a תקנה still opens — it is the end of the budget tree, not of the trail',
     caret10 === '▸', JSON.stringify(caret10));
}

/* === 4. the by-purpose view === */
console.log('\nby-purpose view:');
{
  await page.click('#modeswitch .segbtn:nth-child(2)');
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('#chart > .barrow')].map(e => e.dataset.code);
    return c.length && c.every(x => x.startsWith('C'));
  }, null, { timeout: 5000 });
  const c = await codes(page);
  ok('shows the functional roots', c.every(x => /^C\d$/.test(x)), c.join(','));
  ok('C8 (revenue) is excluded from a spending view', !c.includes('C8'), c.join(','));
  ok('7 areas of activity', c.length === 7, String(c.length));
  ok('the count followed the view', /\b7\b/.test(await page.textContent('#treecount')), await page.textContent('#treecount'));
  await page.click('.barrow[data-code="C1"]');
  await page.waitForSelector('.barrow[data-code="C111"]', { timeout: 5000 });
  const name = await page.$eval('.barrow[data-code="C111"] .name', e => e.textContent.trim());
  ok('child title drops the repeated parent prefix', name.endsWith('בטחון') && !name.includes('/'), JSON.stringify(name));
  const full = await page.$eval('.barrow[data-code="C111"] .name', e => e.getAttribute('title'));
  ok('…but the full official title stays in the tooltip', full.includes('/'), full);
  const caret = await page.$eval('.barrow[data-code="C111"] .caret', e => e.textContent.trim());
  ok('the functional tree stops at 2 levels (leaf, no caret)', caret === '', JSON.stringify(caret));
}

/* === 5. switching back keeps state, and the year selector still works === */
console.log('\nswitch back / change year:');
{
  await page.click('#modeswitch .segbtn:nth-child(1)');
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('#chart > .barrow')].map(e => e.dataset.code);
    return c.length && c.every(x => x.startsWith('00'));
  }, null, { timeout: 5000 });
  ok('back to the ministry view', true);
  ok('the drilldown that was open is remembered', (await allCodes(page)).includes('0020600101'));

  await page.selectOption('#yearsel', '2026');
  await page.waitForFunction(() => !document.querySelector('.barrow[data-code="0020600101"]'),
    null, { timeout: 6000 });
  const c = await codes(page);
  ok('year change reloads and still shows only 00xx', c.every(x => /^00\d\d$/.test(x)) && !c.includes('0000'), c.join(','));
  ok('the tree resets on a year change', !(await allCodes(page)).includes('0020600101'));
}

/* === 6. language toggle doesn't break the tree === */
console.log('\nlanguage:');
{
  await page.click('#langbtn');
  await page.waitForTimeout(200);
  ok('English keeps the rows', (await codes(page)).length > 0);
  ok('the switch is translated', (await page.textContent('#modeswitch')).includes('By ministry'),
    await page.textContent('#modeswitch'));
}


/* === 7. the four flows === */
console.log('\nthe four flows:');
{
  const p2 = await openPage({ snapshot: true });
  const year = await p2.$eval('#yearsel', e => e.value);
  ok('defaults to the last year with real execution, not the newest plan', year === '2025', year);
  const tiles = await p2.$$eval('.kpi .num', els => els.map(e => e.textContent.trim()));
  ok('four numbers', tiles.length === 4, tiles.join(' | '));
  ok('taxes+fees use the EXECUTED figures (300+205+10=515), not the budget',
     tiles[0].startsWith('515'), tiles[0]);
  ok('borrowing shows execution 220', tiles[1].startsWith('220'), tiles[1]);
  const notes = await p2.$$eval('.kpi .plan', els => els.map(e => e.textContent.trim()));
  ok('the line under a number says what it MEANS, not how it was booked',
     /%/.test(notes[0]) && !/בתקציב/.test(notes[0]), notes[0]);
  ok('the principal tile says what the year did to the debt overall',
     /גדל|קטן/.test(notes[3]), notes[3]);
  ok('budget-vs-reality moved into the popover, not the tile',
     !notes.some(n => /בתקציב/.test(n)), notes.join(' | '));

  // the popover
  ok('popover starts closed', !(await p2.isVisible('#pop.open')));
  await p2.click('.kpi.debt .ask');
  await p2.waitForTimeout(120);
  ok('the question opens a popover', await p2.isVisible('#pop.open'));
  ok('…and the popover is where budget-vs-reality now lives',
     /בתקציב תוכננו/.test(await p2.textContent('#pop')), await p2.textContent('#pop'));
  const pos = await p2.$eval('#pop', e => getComputedStyle(e).position);
  ok('it floats over the page instead of pushing it down', pos === 'fixed', pos);
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(120);
  ok('Escape closes it', !(await p2.isVisible('#pop.open')));

  // charts
  ok('the stacked chart drew a column per year', (await p2.$$eval('#chartIn .col', e => e.length)) >= 2);
  ok('the plan year is hatched, not solid',
     (await p2.$eval('#chartIn', e => e.innerHTML)).includes('url(#pf-tax)'));
  ok('the cost line only plots years with actuals (2024–2025), not the 2026 plan',
     (await p2.$$eval('#chartCost .hit', e => e.length)) === 2,
     String(await p2.$$eval('#chartCost .hit', e => e.length)));

  // the table
  await p2.click('.tabletoggle summary');
  await p2.waitForTimeout(100);
  const yrs = await p2.$$eval('#flowtbl tbody tr td:first-child', els => els.map(e => e.textContent.trim()));
  ok('flows table is newest-first', yrs[0].startsWith('2026') && yrs[yrs.length-1].startsWith('2024'), yrs.join(','));
  ok('the plan year is starred', yrs[0].includes('★'), yrs[0]);

  // the paragraph is generated, never hard-coded
  const para = await p2.textContent('#debtpara');
  ok('the paragraph carries this year\'s numbers', para.includes('147') && para.includes('2025'), para.slice(0, 80));
  await p2.selectOption('#yearsel', '2026');
  await p2.waitForTimeout(400);
  const para26 = await p2.textContent('#debtpara');
  ok('and rewrites itself when the year changes', para26.includes('168') && para26.includes('2026'), para26.slice(0, 80));
  ok('…and switches to the "due to" wording for a year not yet run',
     para26 !== para && /אמורה/.test(para26));
  await p2.close();
}


/* === 8. changing the year from anywhere === */
console.log('\nthe year follows you:');
{
  const p3 = await openPage({ snapshot: true });
  const bar = await p3.$eval('#yearbar', e => getComputedStyle(e).position);
  ok('the year control is sticky, not stranded at the top', bar === 'sticky', bar);

  await p3.click('.tabletoggle summary');
  await p3.waitForTimeout(100);
  ok('the current year is marked in the table',
     (await p3.$$eval('#flowtbl tr.current', e => e.length)) === 1);
  ok('only the year cell is clickable, not the whole row',
     (await p3.$$eval('#flowtbl tbody tr:first-child button', e => e.length)) === 1);

  await p3.click('#flowtbl tbody tr:first-child .yearbtn');    // 2026
  await p3.waitForTimeout(500);
  ok('clicking a year in the table moves the whole report',
     (await p3.$eval('#yearsel', e => e.value)) === '2026');
  ok('…and the KPI numbers followed', (await p3.textContent('.kpis')).includes('168'));
  ok('…and the tree reloaded for that year', !(await p3.$('.barrow[data-code="0020600101"]')));
  ok('the sticky bar pulses so the change is not silent',
     await p3.$eval('#yearbar', e => e.classList.contains('changed')));

  const cols = await p3.$$('#chartIn .col .hit');              // back via the chart
  await cols[0].click();                                       // leftmost column = oldest year
  await p3.waitForTimeout(500);
  ok('clicking a chart column does the same', (await p3.$eval('#yearsel', e => e.value)) === '2024');
  ok('the selected column is marked in the chart',
     (await p3.$$eval('#chartIn .col.current', e => e.length)) === 1);
  await p3.close();
}


/* === 9. total government debt === */
console.log('\ntotal debt:');
{
  const p4 = await openPage({ snapshot: true });
  await p4.click('.kpi.muted .ask');
  await p4.waitForTimeout(200);
  const txt = await p4.textContent('#pop');
  ok('the principal popover says what share of the whole debt this is',
     /מהחוב הכולל/.test(txt), txt.slice(0, 200));
  // 2025: repaid 147e9*1 of a 1427.3e9 stock = 10.3%
  ok('the year is matched to the RIGHT debt figure, not shifted by SDMX order',
     txt.includes('10.3%') && txt.includes('1,427'), txt.slice(0, 240));
  ok('the debt figure names its source, because it is not from the budget',
     /OECD/.test(await p4.textContent('#pop .popsrc')));
  await p4.close();

  const p5 = await openPage({ snapshot: true, noDebt: true });
  await p5.click('.kpi.muted .ask');
  await p5.waitForTimeout(200);
  const txt5 = await p5.textContent('#pop');
  ok('when the debt source is down the page loses one sentence and nothing else',
     !/מהחוב הכולל/.test(txt5) && /קרן/.test(txt5) && (await p5.$$('.kpi')).length === 4);
  await p5.close();
}


/* === 10. who was paid out of a budget line === */
console.log('\nthe contract trail:');
{
  const p6 = await openPage({ snapshot: true });
  await p6.click('.barrow[data-code="0020"]');
  await p6.waitForSelector('.barrow[data-code="002060"]');
  await p6.click('.barrow[data-code="002060"]');
  await p6.waitForSelector('.barrow[data-code="00206001"]');
  await p6.click('.barrow[data-code="00206001"]');
  await p6.waitForSelector('.barrow[data-code="0020600101"]');
  await p6.click('.barrow[data-code="0020600101"]');
  await p6.waitForSelector('.whopaid', { timeout: 6000 });   // a leaf opens straight to the money

  ok('the budget line joins straight to the contracts table, no translation',
     /budget_code\s+LIKE\s+'0020600101%'/.test(lastContractSql), lastContractSql.slice(0, 200));
  ok('…and it queries the indexed column, not a replace() over a million rows',
     !/replace\s*\(/i.test(lastContractSql));
  ok('…and it asks for the payment reports, the only real per-year money',
     /payments/.test(lastContractSql) && !/per_year/.test(lastContractSql),
     lastContractSql.slice(0, 200));

  const body = await p6.textContent('.whopaid');
  ok('the suppliers paid from that line are listed', /קייטרינג הדגל/.test(body));
  ok('a contract last reported in 2021 is not shown under 2025',
     !/עמותת מזון לכל/.test(body), body.slice(0, 200));
  ok('a contract with NO years is not assumed to be running now',
     !/ספק בלי שנים/.test(body), body.slice(0, 300));
  ok('what kind of body it is, is shown', /חברה/.test(body));

  /* the arithmetic: 30m reported by the end of 2025 (the annual report, which
     lands after Q4) minus 18m by the end of 2024 = 12m paid during 2025 — and
     the duplicate 2024 report must not be counted twice */
  ok('the money column is what the reports say moved THIS year',
     /12 מיליון/.test(body), body.slice(0, 300));
  ok('…and the whole-contract volume sits beside it, not divided',
     /40 מיליון/.test(body), body.slice(0, 300));
  ok('a year with no report of its own is a dash, not a confident zero',
     /תשתיות הנגב/.test(body) && !/4 מיליון/.test(body), body.slice(0, 400));
  const head = await p6.textContent('.whopaid thead');
  ok('the column header names the year it belongs to', /שולם ב-2025/.test(head));
  ok('…and the all-time total stands beside it as its own column',
     /שולם סה״כ/.test(head), head);
  /* קייטרינג הדגל: 30m paid in all, of which 12m during 2025. Both must show,
     and they are different numbers — that is the point of having both. */
  ok('the year and the total are both printed, and are not the same number',
     /12 מיליון/.test(body) && /30 מיליון/.test(body), body.slice(0, 400));
  await p6.click('.whopaid th:nth-child(5) .info-i');
  await p6.waitForTimeout(150);
  ok('the total explains that the years need not add up to it',
     /לא תמיד יסתכמו/.test(await p6.textContent('#pop')));
  await p6.keyboard.press('Escape');
  ok('a contract bought without a tender is marked',
     (await p6.$$eval('.method.open', e => e.length)) === 1);
  ok('the junk years in the source are not printed',
     !/1899/.test(body) && !/9999/.test(body), body.slice(0, 200));
  ok('the caption names the year the list belongs to', /2025/.test(body), body.slice(-140));
  ok('the purpose is behind a button, not squeezing the table',
     !/הזנה בגני ילדים/.test(body) && (await p6.$$('.purposebtn')).length > 0);
  await p6.click('.whopaid .purposebtn');
  await p6.waitForTimeout(150);
  const pop = await p6.textContent('#pop');
  ok('…and the button opens the full contract', /הזנה בגני ילדים/.test(pop) && /פטור ממכרז/.test(pop),
     pop.slice(0, 160));
  ok('the details do not repeat the two money columns back at the reader',
     !/היקף כל החוזה/.test(pop) && !/שולם על כל החוזה/.test(pop), pop.slice(0, 200));
  ok('…and the details link to the ministry report the number came from',
     (await p6.$$eval('#pop a[href*=".xlsx"]', e => e.length)) === 1);
  await p6.keyboard.press('Escape');

  // the three explanations
  await p6.click('.whopaid th:nth-child(3) .info-i');
  await p6.waitForTimeout(150);
  ok('the years header admits these are report years, not contract dates',
     /לא בהכרח תאריכי החוזה/.test(await p6.textContent('#pop')));
  await p6.keyboard.press('Escape');
  await p6.click('.whopaid th:nth-child(4) .info-i');
  await p6.waitForTimeout(150);
  ok('the volume header says it is the whole contract, not this year',
     /לכל אורכה/.test(await p6.textContent('#pop')));
  await p6.keyboard.press('Escape');
  await p6.click('.whopaid th:nth-child(6) .info-i');
  await p6.waitForTimeout(150);
  const ppop = await p6.textContent('#pop');
  ok('the paid header explains the subtraction, naming both years from live state',
     /2025/.test(ppop) && /2024/.test(ppop), ppop.slice(0, 200));
  ok('…and says plainly what a dash means', /קו מפריד/.test(ppop));
  await p6.keyboard.press('Escape');
  await p6.click('.whopaid button.method.open');
  await p6.waitForTimeout(150);
  const tpop = await p6.textContent('#pop');
  ok('the no-tender chip explains the rule and the exception',
     /חוק חובת המכרזים/.test(tpop) && /אינו מעיד על פסול/.test(tpop), tpop.slice(0, 140));
  ok('…and cites the law rather than asserting it', /1992/.test(tpop));
  ok('…and names the actual regulation the exemption rests on',
     /ספק יחיד/.test(tpop), tpop.slice(-160));
  await p6.keyboard.press('Escape');

  ok('the label names the section it belongs to',
     /משרד החינוך/.test(await p6.$eval('.barrow[data-code="0020"] ~ .kids > .paidline .paidbtn',
       e => e.textContent)));

  // THE FIX: a section answers for everything beneath it. This was the bug —
  // contracts were offered only on the deepest line, where they are rarest.
  const sectionBtn = await p6.$('.barrow[data-code="0020"] ~ .kids > .paidline .paidbtn');
  ok('every level offers the money trail, not just the deepest one', !!sectionBtn);
  await sectionBtn.click();
  await p6.waitForTimeout(500);
  const secBody = await p6.$eval('.barrow[data-code="0020"] ~ .kids > .paidline', e => e.textContent);
  ok('a ministry shows contracts recorded further down the tree',
     /הסעות הדרום/.test(secBody), secBody.slice(0, 200));
  /* הסעות הדרום reported 200m by end-2024 and then 0 in 2025. Zero after a
     positive figure is the field going unreported, not a refund — the page
     must say nothing rather than print a collapse that did not happen. */
  ok('a report that drops to zero is treated as missing, not as a refund',
     !/200 מיליון/.test(secBody) && !/-200/.test(secBody), secBody.slice(0, 400));
  ok('…and the caption counts how many rows we cannot answer for',
     /אין דיווח/.test(secBody), secBody.slice(-220));
  ok('…and the ones on its deepest lines too', /קייטרינג הדגל/.test(secBody));

  /* THE OVERLAY, end to end against the file we actually ship. BudgetKey has
     this contract's paid amount as 0.0; משרד החינוך's own published report has
     ₪235,298,429.36. The page must show the ministry's figure and must mark it
     as coming from somewhere else. */
  ok('a payment BudgetKey records as zero is filled from the ministry report',
     /235\.3 מיליון/.test(secBody), secBody.slice(0, 500));
  ok('…and the figure is marked, not passed off as the same source',
     (await p6.$$eval('.whopaid .fromreport', e => e.length)) === 1);
  ok('…while a figure BudgetKey does have is left alone',
     /290 מיליון/.test(secBody) &&
     (await p6.$$eval('.whopaid .fromreport', e => e.length)) === 1, secBody.slice(0, 300));
  await p6.waitForTimeout(200);
  // the func tree has no contracts at all — its leaves must stay dead ends
  await p6.click('#modeswitch .segbtn:nth-child(2)');
  await p6.waitForTimeout(500);
  await p6.click('.barrow[data-code="C1"]');
  await p6.waitForSelector('.barrow[data-code="C111"]');
  const cCaret = await p6.$eval('.barrow[data-code="C111"] .caret', e => e.textContent.trim());
  ok('an empty list says we have no data, and does not guess why',
     !/שכר והעברות/.test(await p6.textContent('#chart')));
  ok('a leaf in the by-purpose tree stays a dead end (contracts do not join to it)',
     cCaret === '', JSON.stringify(cCaret));

  /* PHONE. Seven columns need 542px in a 312px well, so on a narrow screen each
     contract becomes a labelled card. Two things must hold: every field is
     still on screen, and the PAGE never scrolls sideways — a reader should not
     have to find a horizontal gesture to see what was paid. */
  await p6.click('#modeswitch .segbtn:nth-child(1)');
  await p6.waitForTimeout(300);
  await p6.setViewportSize({ width: 390, height: 820 });
  await p6.waitForTimeout(300);
  await p6.click('.barrow[data-code="0020"] ~ .kids > .paidline .paidbtn').catch(() => {});
  await p6.waitForTimeout(400);
  const phone = await p6.evaluate(() => {
    const d = document.documentElement, w = document.querySelector('.whopaid .tw');
    return { page: d.scrollWidth > d.clientWidth + 0.5,
             table: w ? w.scrollWidth > w.clientWidth + 0.5 : null,
             labelled: !!document.querySelector('.whopaid td[data-l]') };
  });
  ok('on a phone the page does not scroll sideways', phone.page === false, JSON.stringify(phone));
  ok('…and the contract table fits without one either', phone.table === false, JSON.stringify(phone));
  ok('…because each figure carries its own label instead of a column header',
     phone.labelled === true, JSON.stringify(phone));
  await p6.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
