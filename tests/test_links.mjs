/* Every page loads every file it asks for, and every nav link points at a real
   page. This is the guard for the folder layout: move a file without fixing a
   path and this fails immediately.

   node test_links.mjs        (needs: npm i playwright)                      */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = fs.existsSync(path.join(process.cwd(), 'index.html'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..', 'site');
const PORT = 8932;

const PAGES = ['index.html', 'votes.html', 'court.html',
               'tools/qa.html', 'tools/build.html', 'tools/selftest.html'];

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
  const broken = hrefs.filter(h => !fs.existsSync(path.join(DIR, path.normalize(base + h))));
  ok('every nav link points at a real page', broken.length === 0, broken.join(', '));

  await page.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
