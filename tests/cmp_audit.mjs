/* cmp_audit.mjs — compare.html WITH the built dataset behind it.
   Its own file, like everything since the frozen-files rule: cmp.mjs keeps
   guarding the no-audit fallback, this guards the audit mode.

   Self-contained: builds a TINY contracts.db from fixtures (build_sqlite.py,
   registers embedded), starts the real audit_server.py on it, serves the
   real compare.html from that same server, mocks only BudgetKey. Asserts:
   - the page announces the built db is connected
   - the green column shows the db's own values, provenance labels included
   - the register columns fill from the embedded mr.gov.il rows
   - a contract that exists ONLY in a ministry file is FOUND (the old gap)
     and its BudgetKey column says honestly why it is empty

   node tests/cmp_audit.mjs        (from the repo root; needs playwright) */
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = fs.existsSync('/tmp/new/site') ? '/tmp/new/site'
                                            : path.join(ROOT, 'site');
const TMP = fs.mkdtempSync('/tmp/cmpaudit-');
const PY = process.env.PYTHON || 'python3';
const PORT = 8983;

/* ---- fixtures: two contracts, one register row ---- */
const MILGAM = {
  order_id: '4502539235', supplier: 'מילגם בע"מ', company_id: '510982325',
  ministry: 'משרד החינוך', unit: 'מטה כללי משרד החינוך',
  purpose: 'מ7/7.2020 הזנה בניצנים תשפה', method: 'תקנה 1ב - מכרז פומבי רגיל',
  budget_code: '0020670205', volume: 409961432.74, paid: 235298429.36,
  currency: 'ILS', publication: '651623', procedure_id: '7/7.2020',
  publication_status: 'בעדכון', published_date: '2020-07-13',
  sources: ['file', 'tn'],
  provenance: { supplier: 'file', paid: 'file', procedure_id: 'tn',
                publication_status: 'tn', publication: 'file' },
  allocations: [{ budget_code: '0020670205', volume: 409961432.74,
                  paid: 235298429.36, source: 'file' }],
  historical_allocations: [], reports: [],
};
const FILE_ONLY = {
  order_id: '9990001111', supplier: 'ספק שרק בקובץ המשרד',
  ministry: 'משרד הבדיקות', purpose: 'שירות נדיר לבדיקת האיחוד',
  budget_code: '0020010101', volume: 1000, currency: 'ILS',
  sources: ['file'], provenance: { supplier: 'file', volume: 'file' },
  allocations: [{ budget_code: '0020010101', volume: 1000, paid: null,
                  source: 'file' }],
  historical_allocations: [], reports: [],
};
fs.mkdirSync(path.join(TMP, 'contracts'));
fs.writeFileSync(path.join(TMP, 'contracts', '0020.json'),
  JSON.stringify({ contracts: [MILGAM, FILE_ONLY] }));
const TN_COLS = ['מספר פרסום', 'שם המשרד', 'סוג הליך', 'מספר הליך', 'שם הליך', 'סטטוס'];
fs.writeFileSync(path.join(TMP, 'tn.json'), JSON.stringify({
  columns: TN_COLS,
  rows: [['651623', 'משרד החינוך', 'מכרז פומבי', '7/7.2020',
          'מתן שירותים מנהליים להפעלת תכניות הזנה', 'בעדכון']] }));

/* ---- build the db with the real builder, registers embedded ---- */
const DB = path.join(TMP, 'contracts.db');
execFileSync(PY, [path.join(ROOT, 'tools', 'build_sqlite.py'),
  '--contracts', path.join(TMP, 'contracts'), '--out', DB,
  '--tenders', path.join(TMP, 'tn.json')], { stdio: 'inherit' });

/* ---- the real audit server, on the real site directory ---- */
const srv = spawn(PY, [path.join(ROOT, 'tools', 'audit_server.py'),
  '--db', DB, '--site', SITE, '--port', String(PORT)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1200));

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const p = await br.newPage({ viewport: { width: 1100, height: 1100 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  /* BudgetKey live: knows מילגם, has never heard of the file-only order */
  await p.route('**/next.obudget.org/api/query*', route => {
    const sql = decodeURIComponent(new URL(route.request().url()).searchParams.get('query') || '');
    let rows = [];
    if (/4502539235/.test(sql) && /FROM contract_spending/i.test(sql))
      rows = [{ order_id: '4502539235', budget_code: '0020670205',
        supplier_name: 'מילגם בע"מ', entity_name: 'מילגם בע"מ',
        purpose: 'מ7/7.2020 הזנה בניצנים תשפה', volume: 409961432.74,
        executed: 0, min_year: 2024, max_year: 2026,
        publisher_name: 'משרד החינוך', payments: [] }];
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ rows }) });
  });

  /* 1: the מילגם card — green column FROM THE DB, registers lit */
  await p.goto(`http://localhost:${PORT}/tools/compare.html?q=4502539235`);
  await p.waitForSelector('.res', { timeout: 8000 });
  await p.waitForFunction(() => /contracts\.db/.test(
    document.getElementById('dbline').textContent), null, { timeout: 6000 });
  console.log('--- page announces the built db:', /2 התקשרויות|מהמאגר/.test(
    await p.textContent('#dbline')) || /contracts\.db/.test(await p.textContent('#dbline')));
  await p.waitForFunction(() => {
    const t = [...document.querySelectorAll('td[data-s="mrg"]')].map(x => x.textContent).join(' ');
    return /235,298,429/.test(t);
  }, null, { timeout: 6000 });
  const byLabel = await p.$$eval('tbody tr', rows => Object.fromEntries(rows.map(r => [
    r.querySelector('td b').textContent.trim(),
    (r.querySelector('td[data-s="mrg"]') || {}).textContent.replace(/\s+/g, ' ').trim()])));
  console.log('--- green שולם is the db value + its source:',
    /235,298,429/.test(byLabel['שולם'] || '') && /קובץ המשרד/.test(byLabel['שולם'] || ''));
  console.log('--- green מספר הליך came from the tenders register:',
    /7\/7\.2020/.test(byLabel['מספר הליך'] || '') && /מרשם המכרזים/.test(byLabel['מספר הליך'] || ''));
  await p.waitForFunction(() => {
    const t = [...document.querySelectorAll('td[data-s="tnr"]')].map(x => x.textContent).join(' ');
    return /מכרז פומבי/.test(t);
  }, null, { timeout: 6000 });
  const tnr = (await p.$$eval('td[data-s="tnr"]', e => e.map(x => x.textContent))).join(' | ');
  console.log('--- the register column shows the raw mr.gov.il row:',
    /מכרז פומבי/.test(tnr) && /7\/7\.2020/.test(tnr));
  const exr = (await p.$$eval('td[data-s="exr"]', e => e.map(x => x.textContent))).join(' | ');
  console.log('--- the exemptions column says the pub is not there:',
    /לא במרשם הזה/.test(exr));

  /* 2: THE OLD GAP — a file-only contract is now findable */
  await p.fill('#q', 'ספק שרק בקובץ');
  await p.click('#go');
  await p.waitForSelector('.res', { timeout: 8000 });
  const card = await p.textContent('#out');
  console.log('--- file-only contract FOUND via the built db:',
    /9990001111/.test(card) && /שירות נדיר/.test(card));
  console.log('--- and its BudgetKey column says why it is empty:',
    /קיימת רק בקובץ המשרד/.test(card));

  /* 3: random draws from OUR dataset */
  await p.click('#rnd');
  await p.waitForSelector('.res', { timeout: 8000 });
  console.log('--- random draws from the built db:',
    /4502539235|9990001111/.test(await p.textContent('#out')));
} finally {
  await br.close();
  srv.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
}
