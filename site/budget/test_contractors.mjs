/* Playwright test for contractors.html (ספקים והתקשרויות).
   Runs the page against a FAKE BudgetKey contract_spending that arms every
   trap the live table actually contains (verified live 2026-09-08):
     - supplier_name is a JSON ARRAY whose ::text round-trips JSON.stringify
     - entity_id NULL on many rows (drill-down must fall back to the name)
     - a supplier name carrying a quote (בע"מ) — SQL escaping, both ways
     - junk years at both edges: min_year 1899 (must be excluded from the
       ranking) and max_year 2099 (kept as "in force", never printed)
     - purchase_method as an array, executed NULL
   THE MOCK HONOURS THE SELECT LIST: every answer is projected through the
   query's own SELECT expressions, and an expression it does not model
   throws. A fixture more generous than the real source turns a test into a
   rubber stamp (learned 2026-08-22, twice).

   node site/budget/test_contractors.mjs   (needs: npm i playwright)   */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8932;
const THIS_YEAR = new Date().getFullYear();
const DEFAULT_YEAR = THIS_YEAR - 1;           // the page's own default

/* ---------- the fake contract_spending ---------- */
const C = (o) => ({
  entity_id: o.eid ?? null, entity_kind: o.kind ?? null,
  supplier_name: o.name,                       // an ARRAY, like the real thing
  purpose: o.purpose, publisher_name: o.office,
  purchase_method: o.method ?? ['מכרז פומבי'],
  exemption_reason: o.exemption ?? [],         // an array too; junk exists in it
  tender_key: o.tkey ?? [],                    // JSON strings: [pid, type, tid]
  min_year: o.y0, max_year: o.y1,
  volume: o.volume ?? null, executed: o.executed ?? null,
});

/* the exemptions register (procurement_tenders) — only what the join needs */
const PUBS = {
  777001: { publication_id: 777001, description: 'הסכם בדיקה לחמש שנים',
    reason: 'ספק יחיד לשירות זה', regulation: 'תקנה 3(29) - ספק יחיד',
    decision: 'נרשם',
    page_url: 'https://www.mr.gov.il/ExemptionMessage/Pages/ExemptionMessage.aspx?pID=777001' },
};
const T = [
  /* the big one: 27 contracts, two ministries, an open-ended 2099 max */
  C({ eid: '513000001', kind: 'company', name: ['דן בדיקה בע"מ'],
      purpose: 'שירות תחבורה ציבורית', office: 'משרד התחבורה',
      method: ['הקצאת זכות/משאב בהליך תחרותי'],
      y0: 2022, y1: 2099, volume: 6e9, executed: 0.4e9 }),
  C({ eid: '513000001', kind: 'company', name: ['דן בדיקה בע"מ'],
      purpose: 'רכש אוטובוסים', office: 'משרד התחבורה',
      method: ['פטור ממכרז'], exemption: ['תקנה 3(29) - ספק יחיד'],
      /* linked to a register publication — each element is a JSON STRING */
      tkey: ['["777001", "exemptions", "none"]'],
      y0: 2017, y1: 2025, volume: 3e9, executed: 0.2e9 }),
  /* a junk MIN year with a huge volume — the ranking must exclude it, or a
     contract "running since 1899" tops every year on the page */
  C({ eid: '599999999', kind: 'company', name: ['עתיק בע"מ'],
      purpose: 'שירות עתיק', office: 'משרד הפנים',
      y0: 1899, y1: 2030, volume: 50e9, executed: 1e9 }),
  C({ eid: '516000002', kind: 'company', name: ['אגד בדיקה בע"מ'],
      purpose: 'קווי תחבורה', office: 'משרד התחבורה',
      y0: 2020, y1: 2026, volume: 4e9, executed: 1e9 }),
  C({ eid: '500000001', kind: 'municipality', name: ['עיריית בדיקה'],
      purpose: 'תשתיות עירוניות', office: 'משרד השיכון',
      method: ['פטור ממכרז'], exemption: ['תקנה 3(16) - רשות מקומית'],
      y0: 2024, y1: 2026, volume: 1e9, executed: 0.3e9 }),
  /* the exemption field carries junk in the wild (an order number was seen
     in it) — a citation with no תקנה must never reach the regulations table */
  C({ name: ['רשומה משובשת'], purpose: 'רשומה משובשת', office: 'משרד הפנים',
      method: ['פטור ממכרז'], exemption: ['4400001148'],
      y0: 2024, y1: 2025, volume: 1e5, executed: 1e5 }),
  /* in force only 2016–2017 — must vanish from the default year, and lead 2016 */
  C({ eid: '511111111', kind: 'company', name: ['היסטורי בע"מ'],
      purpose: 'שירות ישן', office: 'משרד האוצר',
      y0: 2016, y1: 2017, volume: 9e9, executed: 8e9 }),
  /* no entity_id: the drill-down has only the name to go by */
  C({ name: ['שרה כהן'], purpose: 'ייעוץ ארגוני', office: 'משרד הרווחה',
      method: ['פטור ממכרז'], exemption: ['תקנה 3(1) - התקשרות ששוויה אינו עולה על הסכום הקבוע בתקנה'],
      y0: 2023, y1: 2025, volume: 8e5, executed: 3e5 }),
  /* no entity_id AND a quote in the name — escaping, both directions;
     executed NULL must print as a dash, never as 0 */
  C({ name: ['בדק בע"מ'], purpose: 'בדיקות מעבדה', office: 'משרד הבריאות',
      y0: 2024, y1: 2025, volume: 2e6, executed: null }),
];
/* 25 small contracts so the profile's "showing 25 of 27" note is exercised */
for (let i = 0; i < 25; i++)
  T.push(C({ eid: '513000001', kind: 'company', name: ['דן בדיקה בע"מ'],
    purpose: 'שירות קטן ' + (i + 1),
    office: i === 0 ? 'שירות בתי הסוהר' : 'משרד התחבורה',
    y0: 2024, y1: 2026, volume: i === 0 ? 2e6 : 1e6, executed: 0.5e6 }));

const nameText = r => JSON.stringify(r.supplier_name);

/* ---------- a tiny SQL engine that honours the SELECT list ---------- */
const norm = s => s.replace(/\s+/g, ' ').trim();
const unq = s => s.replace(/''/g, "'");

function splitTop(s) {                        // split on commas outside parens
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* Postgres SUM ignores NULLs and returns NULL when every input is NULL —
   the page must get a null (→ a dash), never a confident 0 it invented */
const sum = (rows, k) => rows.some(r => r[k] != null)
  ? rows.reduce((a, r) => a + (+r[k] || 0), 0) : null;
/* every SELECT expression the page is allowed to use — anything else throws */
function evalExpr(expr, rows, groupKey) {
  const e = norm(expr).toLowerCase().replace(/\s+as\s+\w+$/, '');
  const m = (re) => re.exec(e);
  if (e === 'coalesce(entity_id, supplier_name::text)') return groupKey;
  if (e === 'count(distinct coalesce(entity_id, supplier_name::text))')
    return new Set(rows.map(r => r.entity_id ?? nameText(r))).size;
  if (e === "sum(case when purchase_method::text like '%פטור ממכרז%' then volume else 0 end)")
    return rows.reduce((a, r) => a + (isExempt(r) ? +r.volume || 0 : 0), 0);
  if (e === "count(case when purchase_method::text like '%פטור ממכרז%' then 1 end)")
    return rows.filter(isExempt).length;
  if (e === 'exemption_reason') return groupKey !== undefined ? rows[0].exemption_reason : rows[0].exemption_reason;
  if (e === 'min(supplier_name::text)') return rows.map(nameText).sort()[0];
  if (e === 'min(entity_kind)') return rows.map(r => r.entity_kind).filter(x => x != null).sort()[0] ?? null;
  if (e === 'count(*)') return rows.length;
  if (e === 'sum(volume)') return sum(rows, 'volume');
  if (e === 'sum(executed)') return sum(rows, 'executed');
  if (m(/^min\(case when min_year > 1990 then min_year end\)$/)) {
    const ys = rows.map(r => +r.min_year).filter(y => y > 1990);
    return ys.length ? Math.min(...ys) : null;
  }
  let c;
  if ((c = m(/^max\(case when max_year <= (\d+) then max_year end\)$/))) {
    const ys = rows.map(r => +r.max_year).filter(y => y <= +c[1]);
    return ys.length ? Math.max(...ys) : null;
  }
  if (e === 'publisher_name') return groupKey !== undefined ? groupKey : rows[0].publisher_name;
  if (rows.length === 1 && groupKey === undefined) {   // plain column, row-level
    if (e === 'supplier_name') return rows[0].supplier_name;
    if (['entity_id','entity_kind','purpose','publisher_name','purchase_method',
         'tender_key','min_year','max_year','volume','executed'].includes(e)) return rows[0][e];
  }
  throw new Error('the mock does not model the expression: ' + expr);
}

const isExempt = r => JSON.stringify(r.purchase_method).includes('פטור ממכרז');

let sqlSeen = [];
function runSql(sqlRaw) {
  const sql = norm(sqlRaw);
  sqlSeen.push(sql);
  if (/from\s+raw_budget/i.test(sql))
    throw new Error('the contractors page has no business in raw_budget: ' + sql.slice(0, 120));

  /* the exemptions register: one publication by id, projected as asked */
  if (/from\s+procurement_tenders/i.test(sql)) {
    const pm = /publication_id = (\d+)/i.exec(sql);
    if (!pm || !/tender_type = 'exemptions'/i.test(sql))
      throw new Error('a register query must key on publication_id + tender_type: ' + sql.slice(0, 140));
    const pub = PUBS[+pm[1]];
    if (!pub) return [];
    const cols = splitTop(/^select (.*?) from /i.exec(sql)[1]).map(c => norm(c).toLowerCase());
    const o = {};
    for (const c of cols) {
      if (!(c in pub)) throw new Error('the register mock does not model the column: ' + c);
      o[c] = pub[c];
    }
    return [o];
  }

  if (!/from\s+contract_spending/i.test(sql))
    throw new Error('unexpected table in: ' + sql.slice(0, 120));

  /* the profile's per-year series (generate_series over the in-force span) */
  let gs;
  if ((gs = /generate_series\(GREATEST\(min_year, (\d+)\), LEAST\(max_year, (\d+)\)\)/i.exec(sql))) {
    const [lo, hi] = [+gs[1], +gs[2]];
    let rows = T.filter(r => +r.min_year > 1990);
    let sm;
    if ((sm = /entity_id = '((?:[^']|'')*)'/i.exec(sql)))
      rows = rows.filter(r => r.entity_id === unq(sm[1]));
    if ((sm = /supplier_name::text = '((?:[^']|'')*)'/i.exec(sql)))
      rows = rows.filter(r => nameText(r) === unq(sm[1]));
    const by = {};
    for (const r of rows)
      for (let y = Math.max(+r.min_year, lo); y <= Math.min(+r.max_year, hi); y++)
        by[y] = (by[y] || 0) + (+r.volume || 0);
    return Object.keys(by).sort().map(y => ({ year: +y, volume: by[y] }));
  }

  const selectList = splitTop(/^select (.*?) from /i.exec(sql)[1]);
  const aliasOf = (expr, i) => (/\s+AS\s+(\w+)\s*$/i.exec(expr) || [])[1]
    || norm(expr).split('::')[0].split(/\s+/).pop() || ('c' + i);

  /* WHERE */
  let rows = T.slice();
  const wm = / where (.*?)(?: group by | order by | limit |$)/i.exec(sql);
  const where = wm ? wm[1] : '';
  let mm;
  if ((mm = /min_year <= (\d+) and max_year >= (\d+)/i.exec(where)))
    rows = rows.filter(r => +r.min_year <= +mm[1] && +r.max_year >= +mm[2]);
  if (/min_year > 1990/i.test(where))
    rows = rows.filter(r => +r.min_year > 1990);
  if ((mm = /entity_id = '((?:[^']|'')*)'/i.exec(where)))
    rows = rows.filter(r => r.entity_id === unq(mm[1]));
  if ((mm = /supplier_name::text = '((?:[^']|'')*)'/i.exec(where)))
    rows = rows.filter(r => nameText(r) === unq(mm[1]));
  if ((mm = /supplier_name::text ilike '%((?:[^']|'')*)%' or purpose ilike '%((?:[^']|'')*)%'/i.exec(where))) {
    const q = unq(mm[1]);
    rows = rows.filter(r => nameText(r).includes(q) || String(r.purpose).includes(q));
  }
  if (/and purchase_method::text like '%פטור ממכרז%'/i.test(where))
    rows = rows.filter(isExempt);
  if (/exemption_reason::text like '%תקנה%'/i.test(where))
    rows = rows.filter(r => JSON.stringify(r.exemption_reason).includes('תקנה'));

  /* GROUP BY */
  let groups = null;
  if (/group by coalesce\(entity_id, supplier_name::text\)/i.test(sql)) {
    const g = new Map();
    for (const r of rows) {
      const k = r.entity_id ?? nameText(r);
      (g.get(k) || g.set(k, []).get(k)).push(r);
    }
    groups = [...g.entries()];
  } else if (/group by exemption_reason/i.test(sql)) {
    const g = new Map();
    for (const r of rows) {
      const k = JSON.stringify(r.exemption_reason);
      (g.get(k) || g.set(k, []).get(k)).push(r);
    }
    groups = [...g.entries()];
  } else if (/group by publisher_name/i.test(sql)) {
    const g = new Map();
    for (const r of rows) {
      const k = r.publisher_name;
      (g.get(k) || g.set(k, []).get(k)).push(r);
    }
    groups = [...g.entries()];
  } else if (/count\(\*\)/i.test(sql)) {
    groups = [[undefined, rows]];               // one aggregate row
  }

  let out;
  if (groups) {
    out = groups.map(([key, rs]) => {
      const o = {};
      selectList.forEach((ex, i) => o[aliasOf(ex, i)] = evalExpr(ex, rs, key));
      return o;
    });
    if (/order by sum\(volume\) desc/i.test(sql))
      out.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  } else {
    out = rows.map(r => {
      const o = {};
      selectList.forEach((ex, i) => o[aliasOf(ex, i)] = evalExpr(ex, [r]));
      return o;
    });
    if (/order by volume desc/i.test(sql))
      out.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  }
  const lm = /limit (\d+)/i.exec(sql);
  if (lm) out = out.slice(0, +lm[1]);
  return out;
}

/* ---------- static server ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));

/* ---------- harness ---------- */
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let relayCalls = 0;
async function openPage(hash = '') {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('    [browser error]', m.text()); });
  await page.route('**/next.obudget.org/api/query**', route => {
    const sql = new URL(route.request().url()).searchParams.get('query') || '';
    let body;
    try { body = { success: true, rows: runSql(sql) }; }
    catch (e) { console.log('    [mock sql error]', e.message); body = { success: false, error: e.message }; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  /* this page reads BudgetKey directly — it has no business at the relay */
  await page.route('**/api.ourmoneyil.com/**', route => {
    relayCalls++;
    console.log('    [unexpected relay request]', route.request().url());
    route.fulfill({ status: 404, body: '{"error":"unmocked route"}' });
  });
  await page.goto(`http://localhost:${PORT}/budget/contractors.html${hash}`);
  return page;
}
const topNames = page => page.$$eval('#topout tbody tr', els =>
  els.map(e => e.querySelector('.supbtn').textContent.trim()));

/* === 1. the shell: sub-header, chrome, the top list of the default year === */
console.log('\nshell + the top suppliers of the default year:');
{
  const page = await openPage();
  await page.waitForSelector('#topout tbody tr', { timeout: 12000 });

  const links = await page.$$eval('.subnav a', els =>
    els.map(a => ({ href: a.getAttribute('href'), active: a.classList.contains('active') })));
  ok('the sub-header is here, with this page marked current',
     links.length === 2 && !links[0].active && links[1].active, JSON.stringify(links));
  ok('…and the first tab leads back to the budget', links[0].href === './', JSON.stringify(links));
  ok('the main nav still lights the budget tab (this page is part of the section)',
     await page.$eval('nav.tabs a.active', a => a.dataset.i18n) === 'navBudget');

  ok('the year defaults to the last full calendar year',
     (await page.$eval('#yearsel', e => e.value)) === String(DEFAULT_YEAR),
     await page.$eval('#yearsel', e => e.value));
  const names = await topNames(page);
  ok('ranked by the total volume of contracts in force that year',
     names[0] === 'דן בדיקה בע"מ' && names[1] === 'אגד בדיקה בע"מ' && names[2] === 'עיריית בדיקה',
     names.join(' | '));
  ok('a contract "running since 1899" is junk, not the #1 supplier of every year',
     !names.includes('עתיק בע"מ'), names.join(' | '));
  ok('a supplier whose contracts ended long ago is not in force now',
     !names.includes('היסטורי בע"מ'), names.join(' | '));
  const body = await page.textContent('#topout');
  ok('what kind of body a supplier is, is shown', /רשות מקומית/.test(body));
  ok('the junk 2099 year is never printed', !/2099/.test(body));
  ok('the money is compact, not a 13-digit wall', /מיליארד/.test(body));
  ok('the caption counts the suppliers with no payment on record',
     /ולו תשלום אחד/.test(await page.textContent('#topgap')), await page.textContent('#topgap'));
  /* בדק בע"מ has one contract whose paid was never reported: SUM over only
     NULLs is NULL, and the ranking must print a dash, not a confident 0 ₪ */
  const dashRow = await page.$$eval('#topout tbody tr', els => {
    const r = els.find(e => /בדק בע/.test(e.textContent));
    return r ? [...r.querySelectorAll('td')].map(td => td.textContent.trim()) : null;
  });
  ok('a supplier with no reported payments gets a dash, never an invented 0',
     dashRow && dashRow.includes('—') && !dashRow.some(c => /^0\s*₪/.test(c) || /^₪\s*0$/.test(c)),
     JSON.stringify(dashRow));
  const hint = await page.textContent('#tophint');
  ok('the caption defines the ranking and names the year',
     new RegExp(DEFAULT_YEAR).test(hint) && /היקף אינו תשלום/.test(hint), hint.slice(0, 120));
  ok('…and warns that recent years are partially reported', /חלקית/.test(hint), hint);
  ok('the note says where the data is from and why defence is absent',
     /משרד הביטחון/.test(await page.textContent('#topnote')));

  /* the opening numbers */
  ok('the year control is sticky, within reach anywhere on the page',
     (await page.$eval('#yearbar', e => getComputedStyle(e).position)) === 'sticky');
  await page.waitForFunction(() => document.querySelectorAll('#tiles .kpi').length >= 3, null, { timeout: 6000 });
  const tileTexts = await page.$$eval('#tiles .kpi', els => els.map(e => e.textContent));
  ok('three opening tiles', tileTexts.length === 3, String(tileTexts.length));
  ok('the total counts every contract in force (14bn, 32 contracts)',
     /14/.test(tileTexts[0]) && /32/.test(tileTexts[0]), tileTexts[0]);
  ok('the exempt tile counts the record\'s own words (4bn = 28.5%)',
     /4\s*מיליארד/.test(tileTexts[1].replace(/\n/g, ' ')) && /28.5%/.test(tileTexts[1]),
     JSON.stringify(tileTexts[1]));
  ok('the concentration tile knows how many suppliers there are',
     /100%/.test(tileTexts[2]) && /6/.test(tileTexts[2]), tileTexts[2]);
  await page.click('#tiles .kpi:nth-child(2) .ask');
  await page.waitForTimeout(150);
  const expop = await page.textContent('#pop');
  ok('the exempt tile explains the law, both ways (lawful, but nobody competed)',
     /חוק חובת המכרזים/.test(expop) && /לא התמודד/.test(expop), expop.slice(0, 160));
  ok('…and cites it', /1992/.test(expop));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  /* the defence card */
  const def = await page.textContent('.card.explain');
  ok('the ministry that is NOT here gets a card saying exactly why',
     /משרד הביטחון/.test(def) && /אינן ציבוריות/.test(def), def.slice(0, 120));

  await page.click('#topout th:nth-child(4) .info-i');
  await page.waitForTimeout(150);
  ok('the volume header explains itself (whole life, not this year)',
     /לכל אורך חייהן/.test(await page.textContent('#pop')));
  await page.keyboard.press('Escape');
  await page.click('#topout th:nth-child(5) .info-i');
  await page.waitForTimeout(150);
  ok('the paid header admits the source often lacks the figure',
     /יכול להיות גבוה/.test(await page.textContent('#pop')));
  await page.keyboard.press('Escape');

  /* === 2. a year with a different answer === */
  console.log('\nchanging the year:');
  await page.selectOption('#yearsel', '2016');
  await page.waitForFunction(() =>
    document.querySelector('#topout tbody') &&
    /היסטורי/.test(document.querySelector('#topout tbody').textContent), null, { timeout: 6000 });
  const n16 = await topNames(page);
  ok('2016 has its own top list', n16[0] === 'היסטורי בע"מ', n16.join(' | '));
  ok('…without the suppliers whose contracts had not started yet',
     !n16.includes('עיריית בדיקה'), n16.join(' | '));
  ok('…and the caption follows the year', /2016/.test(await page.textContent('#tophint')));

  /* === 3. the profile, from the top list === */
  console.log('\nthe supplier profile:');
  await page.selectOption('#yearsel', String(DEFAULT_YEAR));
  await page.waitForFunction(() =>
    /דן בדיקה/.test((document.querySelector('#topout tbody') || {}).textContent || ''),
    null, { timeout: 6000 });
  await page.click('#topout .supbtn');
  await page.waitForFunction(() =>
    document.querySelector('#supbody table'), null, { timeout: 6000 });
  ok('clicking a name opens the profile', !(await page.$eval('#supcard', e => e.hidden)));
  ok('…named after the supplier', /דן בדיקה/.test(await page.textContent('#supname')));
  ok('…and addressable, so it can be sent to someone',
     decodeURIComponent(await page.evaluate(() => location.hash)) === '#s=513000001',
     await page.evaluate(() => location.hash));
  const facts = await page.textContent('#supfacts');
  ok('the header counts all 27 recorded contracts', /27/.test(facts), facts);
  ok('…sums the whole volume', /9(\.\d+)? מיליארד/.test(facts), facts);
  ok('…and clamps the junk 2099 out of the years line',
     /2017–2026/.test(facts) && !/2099/.test(facts), facts);
  const supbody = await page.textContent('#supbody');
  ok('the money is broken down by ministry', /משרד התחבורה/.test(supbody) && /שירות בתי הסוהר/.test(supbody));
  ok('the largest contracts are listed with their purpose', /שירות תחבורה ציבורית/.test(supbody));
  ok('…and how they were bought', /הקצאת זכות/.test(supbody));
  ok('the list says it is capped: 25 shown of 27',
     /25/.test(supbody) && /27/.test(supbody), supbody.slice(-200));

  /* the exemption's own publication, behind a button on the exempt row only */
  const whyBtns = await page.$$('#supbody button:has-text("מדוע פטור?")');
  ok('the register button appears exactly on the contract that has a publication',
     whyBtns.length === 1, String(whyBtns.length));
  await whyBtns[0].click();
  await page.waitForFunction(() => /מרשם/.test((document.getElementById('pop') || {}).textContent || ''),
    null, { timeout: 6000 });
  const wpop = await page.textContent('#pop');
  ok('…and opens what the ministry itself published: the what and the why',
     /הסכם בדיקה לחמש שנים/.test(wpop) && /ספק יחיד לשירות זה/.test(wpop), wpop.slice(0, 200));
  ok('…with the committee decision', /נרשם/.test(wpop), wpop.slice(0, 200));
  ok('…linking to the publication itself',
     (await page.$$eval('#pop a[href*="mr.gov.il"]', e => e.length)) === 1);
  ok('…and saying plainly that the button exists only where a publication does',
     /רק בהתקשרויות שנקשרו/.test(wpop), wpop.slice(-160));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  /* the chart: in-force volume year by year, same definition as the tables */
  const svg = await page.$eval('#supbody svg.chart', e => e.innerHTML).catch(() => null);
  ok('the profile draws the supplier\'s story as a chart', !!svg);
  ok('…the 2022 jump is in it', svg && /<title>2022:/.test(svg));
  ok('…years before the first contract stay empty', svg && !/<title>2015:/.test(svg));
  ok('…and the youngest, still-reported years are hatched, not solid',
     svg && /url\(#sp-part\)/.test(svg));
  ok('…with the caption saying what hatched means',
     /מדווחות עדיין חלקית/.test(supbody), supbody.slice(-300));

  await page.click('.supclose');
  ok('closing hides the card and clears the address',
     await page.$eval('#supcard', e => e.hidden) && !(await page.evaluate(() => location.hash)));

  /* === 3b. the no-tender lens === */
  console.log('\nthe no-tender lens:');
  await page.click('#topswitch .segbtn:nth-child(2)');
  await page.waitForFunction(() => {
    const b = document.querySelector('#topout tbody');
    return b && !/אגד בדיקה/.test(b.textContent) && /דן בדיקה/.test(b.textContent);
  }, null, { timeout: 6000 });
  const exNames = await topNames(page);
  ok('the same ranking, restricted to the exempt contracts',
     exNames[0] === 'דן בדיקה בע"מ' && exNames[1] === 'עיריית בדיקה', exNames.join(' | '));
  ok('…so a supplier whose contracts were all tendered drops out',
     !exNames.includes('אגד בדיקה בע"מ'), exNames.join(' | '));
  ok('…and the ranked volume is only the exempt volume (3bn, not 9bn)',
     /3 מיליארד/.test(await page.textContent('#topout tbody tr:first-child')) &&
     !/9 מיליארד/.test(await page.textContent('#topout tbody tr:first-child')));
  ok('the caption switched with the lens',
     /פטור ממכרז/.test(await page.textContent('#tophint')));
  await page.click('#topswitch .segbtn:nth-child(1)');
  await page.waitForFunction(() =>
    /אגד בדיקה/.test((document.querySelector('#topout tbody') || {}).textContent || ''),
    null, { timeout: 6000 });
  ok('switching back is instant (cached), and the full list returns', true);

  /* === 3c. which exemption regulations carry the money === */
  console.log('\nthe exemption regulations:');
  const exBody = await page.textContent('#exout');
  ok('the regulations are ranked by the money riding on them',
     /ספק יחיד/.test(exBody) && /רשות מקומית/.test(exBody), exBody.slice(0, 200));
  const exRows = await page.$$eval('#exout tbody tr td:first-child', els => els.map(e => e.textContent.trim()));
  ok('…biggest first', /ספק יחיד/.test(exRows[0]), exRows.join(' | '));
  ok('the regulation text is verbatim, as recorded', /תקנה 3\(29\)/.test(exRows[0]), exRows[0]);
  ok('junk citations (an order number) never reach the table',
     !/4400001148/.test(exBody), exBody.slice(0, 200));
  ok('the caption names the year', new RegExp(DEFAULT_YEAR).test(await page.textContent('#exhint')));
  ok('the regulations query matches its caption: exempt contracts only',
     sqlSeen.some(s => /group by exemption_reason/i.test(s)
       && /purchase_method::text like '%פטור ממכרז%'/i.test(s)),
     sqlSeen.find(s => /group by exemption_reason/i.test(s)) || 'no exemptions query seen');

  /* === 4. the search, and the no-entity-id drill-down === */
  console.log('\nthe search:');
  await page.fill('#q', 'ייעוץ');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#searchout tbody tr', { timeout: 6000 });
  const srows = await page.textContent('#searchout');
  ok('a word from the purpose finds the contract', /שרה כהן/.test(srows));
  ok('the supplier column is a door, not just text', !!(await page.$('#searchout .supbtn')));
  await page.click('#searchout .supbtn');
  await page.waitForFunction(() => document.querySelector('#supbody table'), null, { timeout: 6000 });
  ok('a supplier with no registrar id still opens, by exact name',
     /שרה כהן/.test(await page.textContent('#supname')));
  ok('…and finds exactly her contracts', /ייעוץ ארגוני/.test(await page.textContent('#supbody')));
  ok('…including how it was bought', /פטור ממכרז/.test(await page.textContent('#supbody')));

  await page.fill('#q', 'בדק בע');
  await page.click('.searchrow button');
  await page.waitForFunction(() =>
    /בדק בע/.test((document.querySelector('#searchout tbody') || {}).textContent || ''),
    null, { timeout: 6000 });
  const dash = await page.$$eval('#searchout tbody tr:first-child td', tds =>
    tds.map(td => td.textContent.trim()));
  ok('an unreported payment is a dash, never a confident 0', dash.includes('—'), dash.join(' | '));
  await page.click('#searchout .supbtn');
  await page.waitForFunction(() => document.querySelector('#supbody table'), null, { timeout: 6000 });
  ok('a quote inside a supplier name survives the SQL round-trip',
     /בדיקות מעבדה/.test(await page.textContent('#supbody')),
     await page.textContent('#supbody'));

  await page.fill('#q', 'שום דבר כזה אין');
  await page.click('.searchrow button');
  await page.waitForFunction(() =>
    /לא נמצאו/.test((document.querySelector('#searchout') || {}).textContent || ''),
    null, { timeout: 6000 });
  ok('an empty search says so', true);

  /* === 5. language === */
  console.log('\nlanguage:');
  await page.click('#langbtn');
  await page.waitForTimeout(250);
  ok('English re-renders the top list', /Who receives the most/i.test(await page.textContent('.wrap')));
  ok('…and the profile that was open', /largest contracts/i.test(await page.textContent('#supbody')));
  await page.close();
}

/* === 6. a shared link opens straight onto the supplier === */
console.log('\ndeep link:');
{
  const page = await openPage('#s=513000001');
  await page.waitForFunction(() => document.querySelector('#supbody table'), null, { timeout: 8000 });
  ok('the profile opens from the address alone', !(await page.$eval('#supcard', e => e.hidden)));
  ok('…and takes its NAME from the data, not from the id',
     /דן בדיקה/.test(await page.textContent('#supname')), await page.textContent('#supname'));
  await page.close();
}

/* === 7. the phone === */
console.log('\nthe phone:');
{
  const page = await openPage();
  await page.setViewportSize({ width: 390, height: 820 });
  await page.waitForSelector('#topout tbody tr', { timeout: 12000 });
  const phone = await page.evaluate(() => {
    const d = document.documentElement;
    return { page: d.scrollWidth > d.clientWidth + 0.5,
             labelled: !!document.querySelector('#topout td[data-l]') };
  });
  ok('the page does not scroll sideways', phone.page === false, JSON.stringify(phone));
  ok('…because each figure carries its own label instead of a column header',
     phone.labelled === true, JSON.stringify(phone));
  await page.close();
}

/* === 8. discipline === */
console.log('\ndiscipline:');
ok('the page never called the relay — its data is BudgetKey, live', relayCalls === 0, String(relayCalls));
ok('every list query carries a LIMIT (never "give me the table")',
   sqlSeen.filter(s => !(!/group by/i.test(s) && /count\(\*\)/i.test(s))   // pure aggregates: one row
                    && !/generate_series/i.test(s))                        // bounded by the year span
     .every(s => /limit \d+/i.test(s)),
   sqlSeen.find(s => !/limit \d+/i.test(s)) || '');
ok('the in-force filter always excludes the junk minimum years',
   sqlSeen.filter(s => /min_year <=/i.test(s)).every(s => /min_year > 1990/i.test(s)));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
