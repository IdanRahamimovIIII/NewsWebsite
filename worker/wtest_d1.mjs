/* wtest_d1.mjs — the REAL worker's D1 endpoints against a REAL database.
   Builds a tiny contracts-public.db with the pipeline's own build_sqlite.py
   (so the schema, the dictionary encoding and the contracts_v view are the
   genuine article, never a hand-copied imitation), wraps it in a fake D1
   binding over node:sqlite, and drives worker.js's fetch() directly.

   Run (Claude's cloud workspace — Mercy has no node):
     node --experimental-sqlite worker/wtest_d1.mjs
   Needs: python3 + ../pipeline/shared/build_sqlite.py (or set BUILD_SQLITE). */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const firstThere = (...cands) => cands.find(p => fs.existsSync(p));
const BUILD_SQLITE = process.env.BUILD_SQLITE || firstThere(
  path.join(HERE, '..', 'pipeline', 'shared', 'build_sqlite.py'),
  path.join(HERE, '..', 'pipeline', 'database', 'build_sqlite.py'),
  path.join(HERE, '..', 'pipeline', 'tools', 'build_sqlite.py'));

/* ---------- the fixture dataset, in build_dataset.py's output shape ---------- */
const rep = (year, period, paid_cumulative, volume, url) =>
  ({ year: String(year), period, volume, paid_cumulative, url });
const FIX = {
  '0020': { contracts: [
    { order_id: '4501000001', supplier: 'קייטרינג הדגל בע"מ', entity_kind: 'company',
      company_id: '512000001', ministry: 'משרד החינוך', budget_code: '0020600101',
      purpose: 'הזנה בגני ילדים', method: 'תקנה 3(4) - פטור ממכרז',
      exemption: 'תקנה 3(4) - התקשרות עם ספק יחיד',
      volume: 40e6, paid: 30e6, first_year: 2019, last_year: 2026,
      sources: ['file', 'bk'],
      allocations: [{ budget_code: '0020600101', volume: 40e6, paid: 30e6, source: 'file' }],
      reports: [rep(2024, 4, 18e6, 40e6, 'https://foi.gov.il/a.xlsx'),
                rep(2025, 2, 26e6, 40e6, 'https://foi.gov.il/b.xlsx')] },
    /* an order whose charge MOVED: its live allocation is under 002061…, and
       0020600101 is only HISTORICAL — /contracts?code=00206001 must not list it */
    { order_id: '4501000002', supplier: 'הסעות הדרום בע"מ', entity_kind: 'company',
      company_id: '512000002', ministry: 'משרד החינוך', budget_code: '0020610207',
      purpose: 'הסעות תלמידים', method: 'תקנה 1ב - מכרז פומבי רגיל',
      volume: 300e6, paid: 290e6, first_year: 2020, last_year: 2027,
      sources: ['bk'],
      allocations: [{ budget_code: '0020610207', volume: 300e6, paid: 290e6, source: 'bk' }],
      historical_allocations: [{ budget_code: '0020600101', volume: 300e6, paid: null, source: 'bk' }],
      reports: [rep(2024, 4, 200e6, 300e6, 'https://foi.gov.il/e.xlsx')] },
    // no known years — a year-filtered list must exclude it, an unfiltered one may keep it
    { order_id: '4501000003', supplier: 'ספק בלי שנים', entity_kind: 'company',
      ministry: 'משרד החינוך', budget_code: '0020600101', purpose: 'לא ידוע',
      method: 'תקנה 1ב - מכרז פומבי רגיל',
      volume: 900e6, paid: null, first_year: null, last_year: null,
      sources: ['bk'],
      allocations: [{ budget_code: '0020600101', volume: 900e6, paid: null, source: 'bk' }] },
    // the same supplier ח"פ as 4501000001 — /supplier?hp= must return both
    { order_id: '4501000004', supplier: 'קייטרינג הדגל בע"מ', entity_kind: 'company',
      company_id: '512000001', ministry: 'משרד הבריאות', budget_code: '0024000107',
      purpose: 'הזנה בבתי חולים', method: 'תקנה 1ב - מכרז פומבי רגיל',
      volume: 7e6, paid: 2e6, first_year: 2024, last_year: 2025,
      sources: ['bk'],
      allocations: [{ budget_code: '0024000107', volume: 7e6, paid: 2e6, source: 'bk' }],
      reports: [rep(2024, 4, 2e6, 7e6, 'https://foi.gov.il/x.xlsx')] },
  ] },
};

/* ---------- build the real public db ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtest-d1-'));
const cdir = path.join(tmp, 'contracts');
fs.mkdirSync(cdir);
for (const [sec, doc] of Object.entries(FIX))
  fs.writeFileSync(path.join(cdir, sec + '.json'), JSON.stringify(doc));
execFileSync('python3', [BUILD_SQLITE, '--contracts', cdir,
  '--out', path.join(tmp, 'full.db'), '--public', path.join(tmp, 'public.db')],
  { stdio: 'pipe' });

/* ---------- a fake D1 binding over the real file ---------- */
const db = new DatabaseSync(path.join(tmp, 'public.db'), { readOnly: true });
const CONTRACTS = {
  prepare: (sql) => ({
    bind: (...args) => ({ all: async () => ({ results: db.prepare(sql).all(...args) }) }),
    all: async () => ({ results: db.prepare(sql).all() }),
  }),
};

/* the workers runtime provides caches.default; node does not */
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const worker = (await import(path.join(HERE, 'worker.js'))).default;
const ctx = { waitUntil() {} };
const call = async (pathAndQuery, env) => {
  const res = await worker.fetch(new Request('https://w.example' + pathAndQuery),
    env === undefined ? { CONTRACTS } : env, ctx);
  return { status: res.status, body: await res.json() };
};

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + JSON.stringify(extra).slice(0, 220) : '')); }
};

console.log('\n/contracts:');
{
  const { status, body } = await call('/contracts?code=0020&year=2025');
  ok('answers 200', status === 200);
  ok('biggest volume first, year-filtered', body.rows.length === 2 &&
     body.rows[0].order_id === '4501000002' && body.rows[1].order_id === '4501000001',
     body.rows.map(r => r.order_id));
  ok('a contract with no known years is excluded from a year list',
     !body.rows.some(r => r.order_id === '4501000003'));
  ok('the dictionary encoding is undone — Hebrew text, not integers',
     body.rows[1].ministry === 'משרד החינוך' &&
     body.rows[1].method === 'תקנה 3(4) - פטור ממכרז', body.rows[1].ministry);
  ok('sources arrive as a parsed list', Array.isArray(body.rows[1].sources) &&
     body.rows[1].sources.includes('file'), body.rows[1].sources);
  ok('each row carries its reports, cumulative per published report',
     body.rows[1].reports.length === 2 &&
     +body.rows[1].reports.find(p => p.year === '2025').paid_cumulative === 26e6,
     body.rows[1].reports);
  ok('more=false when everything fitted', body.more === false);

  const un = await call('/contracts?code=0020');
  ok('without a year the no-years contract is allowed back',
     un.body.rows.some(r => r.order_id === '4501000003'), un.body.rows.map(r => r.order_id));

  const deep = await call('/contracts?code=00206001&year=2025');
  ok('a HISTORICAL allocation does not resurrect a moved contract',
     deep.body.rows.length === 1 && deep.body.rows[0].order_id === '4501000001',
     deep.body.rows.map(r => r.order_id));

  const range = await call('/contracts?code=002061&year=2025');
  ok('the digit-range join finds a deeper live allocation',
     range.body.rows.length === 1 && range.body.rows[0].order_id === '4501000002',
     range.body.rows.map(r => r.order_id));

  const capped = await call('/contracts?code=0020&n=1');
  ok('LIMIT is enforced and more=true says the list is cut',
     capped.body.rows.length === 1 && capped.body.more === true);

  ok('a bad code is refused', (await call('/contracts?code=xx')).status === 400);
  ok('a missing binding answers 501, like the KV routes',
     (await call('/contracts?code=0020', {})).status === 501);
}

console.log('\n/contract:');
{
  const { status, body } = await call('/contract?id=4501000002');
  ok('answers 200', status === 200);
  ok('carries every allocation, the historical one labelled',
     body.allocations.length === 2 &&
     body.allocations.find(a => a.budget_code === '0020600101').historical === 1 &&
     body.allocations.find(a => a.budget_code === '0020610207').historical === 0,
     body.allocations);
  ok('carries the reports', body.reports.length === 1);
  ok('an unknown order answers 404', (await call('/contract?id=999')).status === 404);
}

console.log('\n/supplier:');
{
  const { status, body } = await call('/supplier?hp=512000001');
  ok('answers 200', status === 200);
  ok('finds every contract of the ח"פ, biggest first, with the honest total',
     body.total === 2 && body.rows.length === 2 &&
     body.rows[0].order_id === '4501000001', body);
  ok('an unknown ח"פ answers an empty list with total 0',
     (await call('/supplier?hp=1')).body.total === 0);
  ok('a non-numeric hp is refused', (await call('/supplier?hp=abc')).status === 400);
}

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
