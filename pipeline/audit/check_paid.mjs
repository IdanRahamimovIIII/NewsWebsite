import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const PORT=8944;
const AUDIT=path.dirname(fileURLToPath(import.meta.url));                                  // pipeline/audit/ (this folder)
const ROOT=path.resolve(AUDIT,'..'), SITE=path.resolve(ROOT,'..','site');                  // pipeline/ and the site zone beside it
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);
 const f=u.startsWith('/site/')?path.join(SITE,u.slice(6)):path.join(AUDIT,u.replace(/^\/+/,'')||'compare.html');
 fs.readFile(f,(e,b)=>{ if(e){s.writeHead(404);s.end('no');return;} s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});s.end(b);});});
await new Promise(r=>srv.listen(PORT,r));
const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await br.newPage({viewport:{width:900,height:800}});
p.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE:',m.text());});
/* paidcheck asks the RELAY (since 2026-09-06) — mock it with the fixture, in
   the snapshot envelope {t, data} the worker serves */
const FIX=JSON.parse(fs.readFileSync(path.join(AUDIT,'fixtures-paid.json'),'utf8'));
await p.route('**/*.workers.dev/data/paid/**', route => {
  const name=route.request().url().split('/data/paid/')[1];
  const data=name==='index'?FIX.index:name==='0020'?FIX.lean:null;
  if(!data) return route.fulfill({status:404,body:'not published'});
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({t:Date.now(),data})});
});
await p.goto(`http://localhost:${PORT}/paidcheck.html`);
await p.waitForTimeout(1200);
const out=(await p.textContent('#out')).replace(/\s+/g,' ');
console.log(out.slice(0,400));
console.log('--- manifest found via the relay:', /נמצא, ובו 1 סעיפים/.test(out));
console.log('--- section doc counted:', /1 התקשרויות עם סכום/.test(out));
console.log('--- summary says the budget page has figures:', /זמינים לדף התקציב/.test(out));
await p.screenshot({path:path.join(AUDIT,'paidcheck.png'),fullPage:true});
await br.close(); srv.close();
