import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const PORT=8951;
const AUDIT=path.dirname(fileURLToPath(import.meta.url));                                  // pipeline/audit/ (this folder)
const ROOT=path.resolve(AUDIT,'..'), SITE=path.resolve(ROOT,'..','site');                  // pipeline/ and the site zone beside it
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
/* the paid documents at /paid/, the way audit_server.py serves them since
   2026-09-06 (lean from pipeline/paid, .full.json from pipeline/build/full) —
   from the checked-in fixture ONLY (the מילגם record, verified live), never
   from this machine's real files, so the asserts below mean the same
   everywhere: section 0020 exists, every other section is "not downloaded" */
const FIX=JSON.parse(fs.readFileSync(path.join(AUDIT,'fixtures-paid.json'),'utf8'));
const paidFile=name=>{
 if(name==='index.json') return Buffer.from(JSON.stringify(FIX.index));
 if(name==='0020.full.json') return Buffer.from(JSON.stringify(FIX.full));
 if(name==='0020.json') return Buffer.from(JSON.stringify(FIX.lean));
 return null; };
const srv=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);
 if(u.startsWith('/paid/')){ const b=paidFile(u.slice(6)); if(!b){s.writeHead(404);s.end('no');return;} s.writeHead(200,{'Content-Type':'application/json'});s.end(b);return; }
 const f=u.startsWith('/site/')?path.join(SITE,u.slice(6)):path.join(AUDIT,u.replace(/^\/+/,'')||'compare.html');
 fs.readFile(f,(e,b)=>{ if(e){s.writeHead(404);s.end('no');return;} s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});s.end(b);});});
await new Promise(r=>srv.listen(PORT,r));
const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await br.newPage({viewport:{width:980,height:1000}});
p.on('pageerror',e=>console.log('PAGEERROR:',e.message));

/* the real BudgetKey rows for order 4502539235, captured live earlier today */
await p.route('**/*.workers.dev/**', route => route.fulfill({status:404,body:'not published'}));   // the relay: never reached from a test
await p.route('**/next.obudget.org/api/query*', route => {
  const sql=decodeURIComponent(new URL(route.request().url()).searchParams.get('query')||'');
  let rows=[];
  if(/TABLESAMPLE/i.test(sql)) {
    /* echo the seed back as the order id: if the page ever stops varying the
       seed, every click returns the same contract — which is exactly the bug
       Mercy hit, caused by BudgetKey caching identical query text. */
    const seed=(sql.match(/REPEATABLE\s*\((\d+)\)/i)||[])[1]||'noseed';
    rows=[{order_id:'S'+seed,budget_code:'0024010101',
    supplier_name:'ספק אקראי',entity_name:'ספק אקראי בע"מ',purpose:'שירותים',
    volume:10355614.96,executed:2500000,min_year:2019,max_year:2023,publisher_name:'משרד הבריאות',
    payments:[{year:'2023',period:'2',executed:2500000,volume:10355614.96}]}];
  }
  else if(/NEVERMATCH/.test(sql)) rows=[{order_id:'4501313608',budget_code:'0024010101',
    supplier_name:'ספק אקראי',entity_name:'ספק אקראי בע"מ',purpose:'שירותים',
    volume:10355614.96,executed:2500000,min_year:2019,max_year:2023,publisher_name:'משרד הבריאות',
    payments:[{year:'2023',period:'2',executed:2500000,volume:10355614.96}]}];
  else if(/FROM contract_spending/i.test(sql)) rows=[{order_id:'4502539235',budget_code:'0020670205',
    supplier_name:'מילגם בע"מ',entity_name:'מילגם בע"מ',purpose:'מ7/7.2020 הזנה בניצנים תשפה',
    volume:409961432.74,executed:0,min_year:2024,max_year:2026,publisher_name:'משרד החינוך',
    payments:[{year:'2024',period:'4',executed:0,volume:409961432.74},
              {year:'2025',period:'1',executed:0,volume:409961432.74}]}];
  else if(/FROM contracts_data/i.test(sql)) rows=[{supplier_entity_name:'מילגם בע"מ',volume:409961432.74,
    executed:0,start_year:2024,end_year:2025,volume_per_year:204980716.37,executed_per_year:0}];
  else if(/quarterly_contract_spending_reports/i.test(sql)) rows=[
    {executed:0,volume:409961432.74,y:'2025',p:'1',title:'דוח התקשרויות רבעון 1 שנת 2025 - משרד החינוך',url:'https://www.gov.il/x.xlsx',revision:2},
    {executed:0,volume:409961432.74,y:'2024',p:'4',title:'דוח התקשרויות רבעון 4 שנת 2024 - משרד החינוך',url:'https://www.gov.il/y.xlsx',revision:2}];
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows})});
});
await p.goto(`http://localhost:${PORT}/compare.html?q=4502539235`);
await p.waitForSelector('.res',{timeout:8000});
console.log('--- search path OK');
const txt=(await p.textContent('.res')).replace(/\s+/g,' ');
console.log(txt.slice(0,700));
await p.waitForTimeout(600);
const mx = await p.textContent('table.mx');
console.log('--- matrix has every source column:',
  ['contract_spending','contracts_data','הדוח שפורסם','הקובץ שהמשרד פרסם','data.gov.il']
    .every(h => mx.includes(h)));
console.log('--- matrix has the full field list:',
  ['ספק','מספר ח״פ','מטרה','אופן רכישה','תקנת הפטור','היקף','שולם','תאריך הזמנה','מספר פרסום']
    .every(f => mx.includes(f)));
console.log('--- a field with no such column says so:', /אין שדה כזה/.test(mx));
/* three DIFFERENT empty states must be distinguishable: no link to the
   register at all, a link whose record is missing, and a ministry file we
   have simply not downloaded yet. Conflating them is what made the page
   look broken when it was merely uncovered. */
console.log('--- "no link to the register" is distinct:', /אין קישור/.test(mx));

console.log('--- disagreeing rows are flagged:', await p.$$eval('tr.disagree', e=>e.length));
/* THE POINT OF THIS ROUND: the ministry-file column must carry the whole
   record, not two numbers. It reads the REAL 0020.full.json we ship. */
await p.waitForFunction(() => {
  const td = [...document.querySelectorAll('td[data-s="ours"]')];
  return td.some(x => /510982325/.test(x.textContent));
}, null, {timeout: 8000}).catch(()=>{});
const ours = (await p.$$eval('td[data-s="ours"]', e => e.map(x => x.textContent.trim()))).join(' | ');
console.log('--- ministry file supplies ח״פ:', /510982325/.test(ours));
console.log('--- …the supplier name:', /מילגם/.test(ours));
console.log('--- …the purchase method:', /מכרז פומבי רגיל/.test(ours));
console.log('--- …the publication number:', /651623/.test(ours));
console.log('--- …the budget code:', /20670205/.test(ours));
console.log('--- …and the paid figure:', /235,298,429/.test(ours));
/* THE MERGE. Field by field, not row by row: the ח״פ must come from the
   ministry file (100% filled) while the supplier NAME comes from BudgetKey
   (which normalises spellings), on the SAME contract. And the payment must
   come from the file, because BudgetKey records 0. */
const mrg = await p.$$eval('td[data-s="mrg"]', e => e.map(x => x.textContent.replace(/\s+/g,' ').trim()));
const byLabel = await p.$$eval('tbody tr', rows => Object.fromEntries(rows.map(r => [
  r.querySelector('td b').textContent.trim(),
  (r.querySelector('td[data-s="mrg"]')||{}).textContent.replace(/\s+/g,' ').trim()])));
console.log('--- merged ח״פ comes from the file :', /510982325/.test(byLabel['מספר ח״פ']||'') && /קובץ המשרד/.test(byLabel['מספר ח״פ']||''));
console.log('--- merged supplier from BudgetKey :', /BudgetKey/.test(byLabel['ספק']||''));
console.log('--- merged שולם from the file      :', /235,298,429/.test(byLabel['שולם']||'') && /קובץ המשרד/.test(byLabel['שולם']||''));
console.log('--- a field no source has says so  :', mrg.some(x => /אין נתון באף מקור/.test(x)));
/* RULE 5: a 0 must never beat a real number. BudgetKey stores 0 for this
   contract, the ministry file has 235,298,429.36 — the number must win. */
console.log('--- rule 5, zero does not beat a number:',
  /235,298,429/.test(byLabel['שולם']||'') && !/^0/.test((byLabel['שולם']||'').trim()));
/* RULE 6: one date shape. The file writes "2024-12-04 00:00:00". */
console.log('--- rule 6, dates normalised to YYYY-MM-DD:',
  /2024-12-04/.test(byLabel['תאריך הזמנה']||'') && !/00:00:00/.test(byLabel['תאריך הזמנה']||''));
/* RULE 7: never merge a computed average. */
console.log('--- rule 7, computed average excluded:',
  /לא נכנס למאגר/.test(byLabel['שולם — לשנה (ממוצע מחושב, לא מדידה)']||''));
/* RULE 8: missing and zero must read differently. */
const texts = Object.values(byLabel).join(' | ');
console.log('--- rule 8, missing and zero worded apart:',
  /אין נתון באף מקור/.test(texts));
console.log('--- cells still empty in that column:',
  ours.split(' | ').filter(x => /אין שדה כזה|אין קובץ|לא נגיש/.test(x)).length);
await p.screenshot({path:path.join(AUDIT,'compare.png'),fullPage:true});

/* the random button must produce a result without any typing */
await p.click('#rnd');
await p.waitForTimeout(700);
const r2 = await p.$$eval('.res', e=>e.length);
console.log('--- random button produced results:', r2);
console.log('--- random shows a BudgetKey figure:',
  /2,500,000/.test(await p.textContent('#out')));
/* the random contract is in section 0024, for which no ministry report has
   been downloaded. That must read as coverage, naming the section — not as a
   failure. Conflating the two is what made the page look broken. */
console.log('--- an un-downloaded section names itself:',
  /אין קובץ לסעיף 0024/.test(await p.textContent('#out')));
const seen=new Set();
for (let i=0;i<4;i++){
  await p.click('#rnd'); await p.waitForTimeout(400);
  const m=(await p.textContent('#out')).match(/S(\d+)/);
  if(m) seen.add(m[1]);
}
console.log('--- distinct seeds across 4 clicks:', seen.size, seen.size>=3?'(varies)':'(STUCK)');

/* ONE ORDER, THREE ROWS. Real case 4501119831: the charge moved between
   budget codes, so BudgetKey holds a row per code — and one code twice.
   The page must (a) warn that the rows must not be summed, and (b) still
   find the ministry record even when the code differs, saying that it does. */
const p3 = await br.newPage({viewport:{width:980,height:900}});
await p3.route('**/next.obudget.org/api/query*', route => {
  const sql=decodeURIComponent(new URL(route.request().url()).searchParams.get('query')||'');
  const base={supplier_name:'אגוד הייעל',entity_name:'אגוד הייעל (1985) בע"מ',
    purpose:'עריכת מרכז שמירה ואבטחה',publisher_name:'משרד החינוך',payments:[],tender_key:[]};
  let rows=[];
  if(/FROM contract_spending/i.test(sql)) rows=[
    {...base,order_id:'4501119831',budget_code:'0020400312',volume:13326.3,executed:7359.3,min_year:2015,max_year:2015},
    {...base,order_id:'4501119831',budget_code:'0020400312',volume:13326.3,executed:7359.3,min_year:null,max_year:null},
    {...base,order_id:'4501119831',budget_code:'0020600138',volume:13440.2,executed:0,min_year:2015,max_year:2015}];
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows})});
});
await p3.goto(`http://localhost:${PORT}/compare.html?q=4501119831`);
await p3.waitForSelector('.res',{timeout:6000});
await p3.waitForTimeout(900);
console.log('--- warns not to sum the rows:', /אין לסכם/.test(await p3.textContent('#status')));
const all = await p3.textContent('#out');
console.log('--- finds the file record under the other code:', /רשומה תחת תקנה 0020600138/.test(all));
console.log('--- and the payment from the file appears:', /7,359/.test(all));
await p3.close();

/* the ministry-file random button */
await p.click('#edu');
await p.waitForTimeout(900);
console.log('--- edu button status:', (await p.textContent('#status')).slice(0,90));

/* THE BUG THIS PAGE SHIPPED WITH: one slow source blanked the whole screen.
   "8 contracts found" sat above nothing. Hang contracts_data and the card must
   still draw, with the figures we already had, in well under a second. */
const p2 = await br.newPage({viewport:{width:980,height:900}});
await p2.route('**/next.obudget.org/api/query*', async route => {
  const sql=decodeURIComponent(new URL(route.request().url()).searchParams.get('query')||'');
  if(/FROM contracts_data/i.test(sql)) return;              // never answers
  if(/quarterly_contract_spending_reports/i.test(sql)) return;
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows:[{
    order_id:'4502539235',budget_code:'0020670205',supplier_name:'מילגם בע"מ',
    entity_name:'מילגם בע"מ',purpose:'הזנה',volume:409961432.74,executed:12345678,
    min_year:2024,max_year:2026,publisher_name:'משרד החינוך',
    payments:[{year:'2025',period:'1',executed:12345678,volume:409961432.74}]}]})});
});
const t0=Date.now();
await p2.goto(`http://localhost:${PORT}/compare.html?q=4502539235`);
await p2.waitForSelector('.res',{timeout:4000});
await p2.waitForFunction(()=>/12,345,678/.test(document.querySelector('#out').textContent),null,{timeout:4000});
console.log('--- card drawn despite a dead source, in ms:', Date.now()-t0);
console.log('--- slow source shows as pending:',
  /בודק/.test(await p2.textContent('#out')));
console.log('--- build stamp:', await p2.textContent('#build'));
await p2.close();
await br.close(); srv.close();
