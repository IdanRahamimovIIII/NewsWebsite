/* wtest_contractors.mjs — the REAL worker's v9 /contractors/* endpoints
   against a REAL database: fixtures → the pipeline's own build_sqlite.py →
   build_contractors.py (definitions and all) → a fake D1 binding over
   node:sqlite → worker.js's fetch(). Sibling of wtest_d1.mjs.

   Run (Claude's cloud workspace — Mercy has no node):
     node --experimental-sqlite worker/wtest_contractors.mjs
   Needs python3 + ../pipeline/shared/build_sqlite.py +
   ../pipeline/contractors/build_contractors.py. */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.join(HERE, '..', 'pipeline');
const firstThere = (...cands) => cands.find(p => fs.existsSync(p));
const BUILD_SQLITE = process.env.BUILD_SQLITE || firstThere(
  path.join(PIPE, 'shared', 'build_sqlite.py'),
  path.join(PIPE, 'database', 'build_sqlite.py'),
  path.join(PIPE, 'tools', 'build_sqlite.py'));
const BUILD_CTR = process.env.BUILD_CTR ||
  path.join(PIPE, 'contractors', 'build_contractors.py');

/* the same fixtures test_contractors.py pins the build with — every row
   exists to prove one honesty rule survives all the way to the endpoint */
const C = (o) => ({ sources: ['bk'], ...o });
const FIX = { '0020': { contracts: [
  C({ order_id: 'A1', supplier: 'קייטרינג הדגל בע"מ', entity_id: '512000001',
      entity_kind: 'חברה', ministry: 'משרד החינוך', purpose: 'הזנה בגני ילדים',
      method: 'תקנה 3(29) - פטור ממכרז', exemption: 'תקנה 3(29) - ספק יחיד',
      volume: 40e6, paid: 30e6, first_year: 2019, last_year: 2026 }),
  C({ order_id: 'A2', supplier: 'קיטרינג הדגל', entity_id: '512000001',
      entity_kind: 'חברה', ministry: 'משרד הבריאות', purpose: 'הזנה בבתי חולים',
      method: 'מכרז פומבי', volume: 7e6, paid: null,
      first_year: 2024, last_year: 2025 }),
  C({ order_id: 'B1', supplier: 'הסעות הדרום בע"מ', entity_id: '512000002',
      entity_kind: 'חברה', ministry: 'משרד החינוך', purpose: 'הסעות תלמידים',
      method: 'תקנה 1ב - מכרז פומבי רגיל', volume: 30e6, paid: 25e6,
      first_year: 2020, last_year: 2027 }),
  /* junk MIN year — must be in NO ranking, NO tile */
  C({ order_id: 'J1', supplier: 'ספק עתיק', entity_id: '512000003',
      ministry: 'משרד החינוך', purpose: 'שירות מסתורי', method: 'פטור ממכרז',
      volume: 999e6, paid: 1e6, first_year: 1899, last_year: 2030 }),
  /* junk MAX — open-ended, still in force */
  C({ order_id: 'K1', supplier: 'ספק נצחי', entity_id: '512000004',
      ministry: 'משרד האוצר', purpose: 'אחזקת מערכות', method: 'פטור ממכרז',
      exemption: 'תקנה 3(1) - עד 50,000 שח', volume: 5e6, paid: null,
      first_year: 2023, last_year: 9999 }),
  /* no entity_id — sid is the exact name */
  C({ order_id: 'N1', supplier: 'עמותת שם בלבד', ministry: 'משרד הרווחה',
      purpose: 'שירותי רווחה', method: 'מכרז פומבי', volume: 2e6, paid: null,
      first_year: 2024, last_year: 2025, sources: ['file'] }),
] } };

/* ---------- build the real public db + the real ctr_ tables ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wtest-ctr-'));
const cdir = path.join(tmp, 'contracts');
fs.mkdirSync(cdir);
for (const [sec, doc] of Object.entries(FIX))
  fs.writeFileSync(path.join(cdir, sec + '.json'), JSON.stringify(doc));
execFileSync('python3', [BUILD_SQLITE, '--contracts', cdir,
  '--out', path.join(tmp, 'full.db'), '--public', path.join(tmp, 'public.db')],
  { stdio: 'pipe' });
execFileSync('python3', [BUILD_CTR, '--db', path.join(tmp, 'public.db'),
  '--year-from', '2019'], { stdio: 'pipe' });

const db = new DatabaseSync(path.join(tmp, 'public.db'), { readOnly: true });
const CONTRACTS = {
  prepare: (sql) => ({
    bind: (...args) => ({ all: async () => ({ results: db.prepare(sql).all(...args) }) }),
    all: async () => ({ results: db.prepare(sql).all() }),
  }),
};
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
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + JSON.stringify(extra).slice(0, 240) : '')); }
};

console.log('\n/contractors/summary:');
{
  const { status, body } = await call('/contractors/summary');
  ok('answers 200 with every year at once', status === 200 && body.years.length >= 6, body.years?.length);
  const y24 = body.years.find(y => y.year === 2024);
  ok('2024 tiles: in force / suppliers / total / exempt slice — junk-min excluded',
     y24 && y24.n === 5 && y24.suppliers === 4 &&
     y24.total === 40e6 + 7e6 + 30e6 + 5e6 + 2e6 &&
     y24.exempt_n === 2 && y24.exempt_vol === 45e6, y24);
  ok('top10_vol present for the third tile', y24.top10_vol === y24.total, y24);
  const one = await call('/contractors/summary?year=2024');
  ok('?year= filters to one row', one.body.years.length === 1 && one.body.years[0].year === 2024);
  ok('a bad year is refused', (await call('/contractors/summary?year=24')).status === 400);
  ok('a missing binding answers 501', (await call('/contractors/summary', {})).status === 501);
}

console.log('\n/contractors/top:');
{
  const { status, body } = await call('/contractors/top?year=2024&lens=all');
  ok('answers 200, ranked by volume', status === 200 &&
     body.rows[0].sid === '512000001' && body.rows[0].volume === 47e6, body.rows?.[0]);
  ok('one canonical name for two spellings of an entity_id',
     body.rows[0].name === 'קייטרינג הדגל בע"מ', body.rows[0]);
  ok('the junk-min giant is not in the ranking',
     !body.rows.some(r => r.sid === '512000003'), body.rows.map(r => r.sid));
  ok('a name-only supplier keeps its own sid',
     body.rows.some(r => r.sid === 'עמותת שם בלבד'));
  const ex = await call('/contractors/top?year=2024&lens=exempt');
  ok('exempt lens counts only the exempt contracts (40m, not 47m)',
     ex.body.rows[0].sid === '512000001' && ex.body.rows[0].volume === 40e6, ex.body.rows?.[0]);
  ok('paid over only-unknowns arrives as null, never 0',
     ex.body.rows.find(r => r.sid === '512000004').paid === null, ex.body.rows);
  ok('a bad lens is refused', (await call('/contractors/top?year=2024&lens=x')).status === 400);
}

console.log('\n/contractors/exemptions:');
{
  const { status, body } = await call('/contractors/exemptions?year=2024');
  ok('answers 200 with the citations verbatim, by volume', status === 200 &&
     body.rows[0].citation === 'תקנה 3(29) - ספק יחיד' && body.rows[0].volume === 40e6,
     body.rows);
  ok('K1\'s real citation ranks too',
     body.rows.some(r => r.citation === 'תקנה 3(1) - עד 50,000 שח'));
}

console.log('\n/contractors/supplier:');
{
  const { status, body } = await call('/contractors/supplier?sid=512000001');
  ok('answers 200 with facts + byOffice + series + contracts in ONE response',
     status === 200 && body.facts.n === 2 && body.facts.volume === 47e6 &&
     body.byOffice.length === 2 && body.contracts.length === 2, body.facts);
  ok('byOffice biggest first', body.byOffice[0].ministry === 'משרד החינוך', body.byOffice);
  ok('series is the in-force chart, full volume in every year',
     body.series.some(([y, v]) => y === 2024 && v === 47e6), body.series);
  ok('contracts are whole display rows, largest first',
     body.contracts[0].order_id === 'A1' && body.contracts[0].purpose === 'הזנה בגני ילדים' &&
     body.contracts[0].ministry === 'משרד החינוך', body.contracts?.[0]);
  ok('"מוצגות X מתוך Y" has its Y', body.of === 2);
  const byName = await call('/contractors/supplier?sid=' + encodeURIComponent('עמותת שם בלבד'));
  ok('a name-sid profile works (Hebrew sid)', byName.status === 200 && byName.body.facts.n === 1);
  ok('an unknown sid answers 404', (await call('/contractors/supplier?sid=zzz')).status === 404);
}

console.log('\n/contractors/search:');
{
  const { status, body } = await call('/contractors/search?q=' + encodeURIComponent('הזנה'));
  ok('finds by purpose, whole display rows', status === 200 &&
     body.rows.length === 2 && body.rows.every(r => r.purpose.includes('הזנה')), body.rows);
  const two = await call('/contractors/search?q=' + encodeURIComponent('הסעות תלמידים'));
  ok('multiple words AND-ed', two.body.rows.length === 1 && two.body.rows[0].order_id === 'B1');
  const name = await call('/contractors/search?q=' + encodeURIComponent('הדגל'));
  ok('finds by supplier name', name.body.rows.length >= 1 &&
     name.body.rows.some(r => r.order_id === 'A1'), name.body.rows);
  const junk = await call('/contractors/search?q=' + encodeURIComponent('"AND (x OR *'));
  ok('FTS syntax characters cannot break the query', junk.status === 200 || junk.status === 400);
  ok('an empty query is refused', (await call('/contractors/search?q=')).status === 400);
}

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
