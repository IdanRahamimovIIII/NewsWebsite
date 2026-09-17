/* Every page loads every file it asks for, and every nav link points at a real
   page. This is the guard for the folder layout: move a file without fixing a
   path and this fails immediately.

   node site/tests/test_links.mjs   (needs: npm i playwright)                      */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* the site is this file's parent folder (site/tests/ → site/) — works from any cwd */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8932;

const PAGES = ['budget/index.html', 'votes/index.html', 'mk/index.html',
               'court/index.html', 'votes/selftest.html',
               'tools/qa.html', 'tools/build.html'];
/* the forwarding stubs at the old addresses (2026-09-06): each must exist and
   point at a page that exists — they are what keeps old links alive */
const FORWARDERS = { 'index.html': 'budget/', 'votes.html': 'votes/',
                     'mk.html': 'mk/', 'court.html': 'court/' };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const p of PAGES) {
  console.log('\n' + p + ':');
  const page = await browser.newPage();
  const missing = [];
  page.on('response', r => {
    if (r.url().startsWith(`http://localhost:${PORT}/`) && r.status() === 404) missing.push(new URL(r.url()).pathname);
  });
  // the government APIs and the relay are not what this test is about
  await page.route(url => !url.href.startsWith(`http://localhost:${PORT}/`), r => r.abort());

  await page.goto(`http://localhost:${PORT}/${p}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  ok('every file it asks for exists', missing.length === 0, missing.join(', '));

  const hrefs = await page.$$eval('header.topbar a', els => els.map(e => e.getAttribute('href')));
  ok('the header rendered', hrefs.length > 0);
  const base = path.dirname(p) === '.' ? '' : path.dirname(p) + '/';
  // a link to a folder is only good if the folder has an index.html
  const resolves = h => {
    const f = path.join(DIR, path.normalize(base + h));
    return fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html')));
  };
  const broken = hrefs.filter(h => !resolves(h));
  ok('every nav link points at a real page', broken.length === 0, broken.join(', '));

  await page.close();
}

console.log('\nforwarders at the old addresses:');
for (const [stub, target] of Object.entries(FORWARDERS)) {
  const src = fs.existsSync(path.join(DIR, stub)) ? fs.readFileSync(path.join(DIR, stub), 'utf8') : '';
  ok(`${stub} forwards to ${target}`,
     src.includes(`url=${target}`) && fs.existsSync(path.join(DIR, target, 'index.html')));
}

await browser.close();
server.close();

/* the baked Hebrew in the HTML shells must match the strings files —
   crawlers read the raw HTML, so drift here is invisible on screen but
   real for SEO. Fix: node scripts/bake_i18n.mjs */
console.log('\nbaked i18n (crawler-visible HTML):');
const { spawnSync } = await import('node:child_process');
const bakeRes = spawnSync(process.execPath,
  [path.join(DIR, '..', 'scripts', 'bake_i18n.mjs'), '--check'], { encoding: 'utf8' });
ok('HTML shells match the strings files', bakeRes.status === 0,
   (bakeRes.stderr || bakeRes.stdout || '').trim().split('\n')[0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
