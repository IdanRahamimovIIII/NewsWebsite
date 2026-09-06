/* The MK portfolio page (mk_page/index.html) against a fake Knesset that contains the
   same traps as the real one: two id spaces bridged by name ("לפיד יאיר" in
   the votes directory, "יאיר לפיד" in the persons table), a duplicate cmb
   entry per Knesset, reservation votes that must fold into one row, and
   statuses that must land in the right pile (passed / rejected / in process).

   node site/mk_page/test_mk.mjs   (needs: npm i playwright)                        */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* the site is this file's parent folder (site/mk_page/ → site/) — works from any cwd */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8933;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'mk_page/index.html');
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(PORT, r));

/* ---------- the fake Knesset ---------- */
const CMB = { Knessets: [], MKS: [
  { Id: 1001, Name: 'לפיד יאיר', KnessetId: 25, faction_id: 1 },
  { Id: 900,  Name: 'לפיד יאיר', KnessetId: 24, faction_id: 1 },
  { Id: 900,  Name: 'לפיד יאיר', KnessetId: 24, faction_id: 1 },   // duplicate row — must not double the chip
  { Id: 800,  Name: 'כהן משה',  KnessetId: 25, faction_id: 2 },
  { Id: 700,  Name: 'לוי משה',  KnessetId: 20, faction_id: 3 },    // left long ago — must rank below כהן
] };
const PERSONS = { t: 1, data: { 2605: 'יאיר לפיד', 2700: 'משה כהן', 2800: 'משה לוי' } };
const DROPDOWN = [
  { ID: 1001, Name: 'יאיר לפיד', IsCurrent: true },
  { ID: 800,  Name: 'משה כהן',  IsCurrent: true },
  { ID: 700,  Name: 'משה לוי',  IsCurrent: false },
];
const STATUSES = [
  { StatusID: 118, Desc: 'התקבלה בקריאה שלישית' },
  { StatusID: 140, Desc: 'להסרה מסדר היום לבקשת ועדה' },
  { StatusID: 113, Desc: 'הכנה לקריאה שנייה ושלישית' },
];
const VOTES_T2 = { Table: [
  { VoteId: 1, ItemTitle: 'הצעת חוק הדוגמה', VoteDate: '2026-01-05T00:00:00', VoteDateStr: '05.01.2026', VoteTimeStr: '12:00', VoteProtocolNo: 3 },
  { VoteId: 2, ItemTitle: 'הצעת חוק הדוגמה', VoteDate: '2026-01-05T00:00:00', VoteDateStr: '05.01.2026', VoteTimeStr: '11:00', VoteProtocolNo: 2 },
  { VoteId: 3, ItemTitle: 'הצעת חוק אחרת',  VoteDate: '2025-12-01T00:00:00', VoteDateStr: '01.12.2025', VoteTimeStr: '10:00', VoteProtocolNo: 1 },
] };
const DETAILS = {
  1: { VoteHeader: [{ VoteId: 1, IsForAccepted: true, Decision: 'לאשר את החוק', FK_Knesset: 25, SessionNumber: 80 }],
       VoteCounters: [{ Title: 'בעד', countOfResult: 55 }, { Title: 'נגד', countOfResult: 40 }, { Title: 'נמנע', countOfResult: 2 }],
       VoteDetails: [{ MkName: 'יאיר לפיד', FactionName: 'יש עתיד', Title: 'בעד' }] },
  3: { VoteHeader: [{ VoteId: 3, IsForAccepted: false, FK_Knesset: 25, SessionNumber: 60 }],
       VoteCounters: [{ Title: 'בעד', countOfResult: 20 }, { Title: 'נגד', countOfResult: 60 }, { Title: 'נמנע', countOfResult: 0 }],
       VoteDetails: [{ MkName: 'יאיר לפיד', FactionName: 'יש עתיד', Title: 'נגד' }] },
};
const POSITIONS = [
  { PersonToPositionID: 1, PersonID: 2605, PositionID: 39, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: null, GovMinistryName: null, DutyDesc: null, FactionName: 'יש עתיד', CommitteeName: null, IsCurrent: true },
  { PersonToPositionID: 2, PersonID: 2605, PositionID: 40, KnessetNum: 24, StartDate: '2021-06-13T00:00:00',
    FinishDate: '2022-12-29T00:00:00', GovMinistryName: 'משרד החוץ', DutyDesc: 'שר החוץ', FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 3, PersonID: 2605, PositionID: 42, KnessetNum: 24, StartDate: '2021-04-06T00:00:00',
    FinishDate: '2021-06-13T00:00:00', GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: 'ועדת הכספים', IsCurrent: false },
  /* the register's REAL dirt, measured on PersonID 965 (2026-08-25):
     the same office under two gendered position codes, same span … */
  { PersonToPositionID: 4, PersonID: 2605, PositionID: 45, KnessetNum: 25, StartDate: '2022-12-29T00:00:00',
    FinishDate: null, GovMinistryName: 'משרד ראש הממשלה', DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: true, GovernmentNum: 37 },
  { PersonToPositionID: 5, PersonID: 2605, PositionID: 46, KnessetNum: 25, StartDate: '2022-12-29T00:00:00',
    FinishDate: null, GovMinistryName: 'משרד ראש הממשלה', DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: true, GovernmentNum: 37 },
  /* … and one continuous term split where the GovernmentNum changed mid-Knesset */
  { PersonToPositionID: 6, PersonID: 2605, PositionID: 45, KnessetNum: 23, StartDate: '2020-03-16T00:00:00',
    FinishDate: '2020-05-17T00:00:00', GovMinistryName: 'משרד ראש הממשלה', DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: false, GovernmentNum: 34 },
  { PersonToPositionID: 7, PersonID: 2605, PositionID: 45, KnessetNum: 23, StartDate: '2020-05-17T00:00:00',
    FinishDate: '2021-04-06T00:00:00', GovMinistryName: 'משרד ראש הממשלה', DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: false, GovernmentNum: 35 },
  /* a genuinely separate short stint — a real gap, must NOT be merged away */
  { PersonToPositionID: 8, PersonID: 2605, PositionID: 47, KnessetNum: 23, StartDate: '2020-09-15T00:00:00',
    FinishDate: '2020-10-14T00:00:00', GovMinistryName: 'משרד הבינוי והשיכון', DutyDesc: 'שר הבינוי והשיכון', FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 9, PersonID: 2605, PositionID: 47, KnessetNum: 23, StartDate: '2020-11-15T00:00:00',
    FinishDate: '2020-11-18T00:00:00', GovMinistryName: 'משרד הבינוי והשיכון', DutyDesc: 'שר הבינוי והשיכון', FactionName: null, CommitteeName: null, IsCurrent: false },
  /* the ranking fixtures: a serving minister vs. someone long gone */
  { PersonToPositionID: 10, PersonID: 2700, PositionID: 47, KnessetNum: 25, StartDate: '2022-12-29T00:00:00',
    FinishDate: null, GovMinistryName: 'משרד האוצר', DutyDesc: 'שר האוצר', FactionName: null, CommitteeName: null, IsCurrent: true },
  { PersonToPositionID: 11, PersonID: 2800, PositionID: 42, KnessetNum: 20, StartDate: '2013-03-18T00:00:00',
    FinishDate: '2015-03-31T00:00:00', GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: 'ועדת החינוך', IsCurrent: false },
];
const POSNAMES = [
  { PositionID: 39, Description: 'חבר כנסת' },
  { PositionID: 40, Description: 'שר' },
  { PositionID: 42, Description: 'חבר ועדה' },
  { PositionID: 45, Description: 'ראש הממשלה' },
  { PositionID: 46, Description: 'ראש הממשלה' },   // the gendered twin code
  { PositionID: 47, Description: 'שר' },
];
const INITS = [
  { BillID: 11, IsInitiator: true,  Ordinal: 1 },
  { BillID: 12, IsInitiator: false, Ordinal: 4 },
  { BillID: 13, IsInitiator: false, Ordinal: 9 },
];
const BILLS = [
  { BillID: 11, Name: 'חוק שעבר', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 118, KnessetNum: 25, LastUpdatedDate: '2026-01-06T00:00:00' },
  { BillID: 12, Name: 'חוק שנפל', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 140, KnessetNum: 24, LastUpdatedDate: '2025-05-01T00:00:00' },
  { BillID: 13, Name: 'חוק בדרך', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 113, KnessetNum: 25, LastUpdatedDate: '2026-02-01T00:00:00' },
];

const json = o => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* answer like the relay: /?url=<real address> (GET or POST), /data/<name> */
function answer(route) {
  const u = new URL(route.request().url());
  if (u.pathname === '/data/persons') return route.fulfill(json(PERSONS));
  if (u.pathname === '/data/bills') return route.fulfill(json({ t: 1, data: { statuses: STATUSES } }));
  // the photo manifest lives on the relay too (2026-09-06): כהן (800) has a
  // photo, nobody else does. A bare filename resolves to <relay>/photos/mk/<file>.
  if (u.pathname === '/data/mkphotos') return route.fulfill(json({ t: 1, data: { 800: '800.jpg' } }));
  if (u.pathname === '/photos/mk/800.jpg') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (u.pathname.startsWith('/data/')) return route.fulfill({ status: 404, body: 'no' });
  const target = decodeURIComponent(u.searchParams.get('url') || '');
  if (target.includes('GetVotesCmbData')) return route.fulfill(json(CMB));
  if (target.includes('GetMksDropdown')) return route.fulfill(json(DROPDOWN));
  if (target.includes('GetVotesHeaders')) return route.fulfill(json(VOTES_T2));
  if (target.includes('GetVoteDetails/')) {
    const id = +target.split('GetVoteDetails/')[1];
    return route.fulfill(json(DETAILS[id] || { VoteHeader: [{}], VoteCounters: [], VoteDetails: [] }));
  }
  if (target.includes('KNS_PersonToPosition')) {
    // answer whichever PersonIDs the (possibly OR-batched) filter names
    const rows = target.includes('$skip=0')
      ? POSITIONS.filter(r => target.includes('PersonID eq ' + r.PersonID)) : [];
    return route.fulfill(json({ value: rows }));
  }
  if (target.includes('KNS_Position(')) return route.fulfill(json({ value: POSNAMES }));
  if (target.includes('KNS_BillInitiator'))
    return route.fulfill(json({ value: target.includes('PersonID eq 2605') && target.includes('$skip=0') ? INITS : [] }));
  if (target.includes('KNS_Bill(')) {
    const rows = BILLS.filter(b => target.includes('BillID eq ' + b.BillID));
    return route.fulfill(json({ value: rows }));
  }
  if (target.includes('KNS_Status')) return route.fulfill(json({ value: STATUSES }));
  if (target.includes('KNS_Person(')) return route.fulfill(json({ value: [] }));
  if (target.includes('GetMkDetailsContent')) return route.fulfill(json({
    ID: 1001, DateOfBirth: '1963-11-05T00:00:00', DeathDate: null, PlaceOfBirth: 'תל אביב',
    ImmigrationYear: null, Residence: 'תל אביב', Education: 'תואר ראשון במדע המדינה',
    MilitaryService: 'צנחנים', NationalService: null, profession: 'עיתונאי',
    Languages: 'עברית, אנגלית', Content: '<p>ignored</p>',
  }));
  return route.fulfill({ status: 404, body: 'unexpected: ' + target });
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
page.on('pageerror', e => ok('no page error', false, String(e)));
await page.route(url => url.href.startsWith('https://our-money.'), answer);
await page.route(url => !url.href.startsWith(`http://localhost:${PORT}/`) && !url.href.startsWith('https://our-money.'), r => r.abort());

console.log('\nthe directory + nav:');
await page.goto(`http://localhost:${PORT}/mk_page/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#dir .votechip');
const tabs = await page.$$eval('nav.tabs a', els => els.map(e => e.getAttribute('href')));
ok('the nav has four tabs', tabs.length === 4, tabs.join(','));
ok('the MK page is the active tab', await page.$eval('nav.tabs a.active', e => e.getAttribute('href')) === '../mk_page/');
const chips = await page.$$eval('#dir .votechip', els => els.map(e => e.textContent));
ok('the directory lists current members once each', chips.length === 2, chips.join(','));

console.log('\nlive search: type, and ranked cards appear');
ok('a collected photo shows in the directory', await page.$('#dir img.avatar') !== null);
ok('everyone else gets initials, no broken images', await page.$('#dir span.avatar') !== null);
await page.fill('#mkq', 'משה');            // fill fires the input event — no button
await page.waitForSelector('.mkcard');
await page.waitForFunction(() => {
  const subs = [...document.querySelectorAll('.mkcard .mcsub')].map(e => e.textContent);
  return subs.length === 2 && subs.every(s => s !== '…');
});
const names = await page.$$eval('.mkcard .mcname', els => els.map(e => e.textContent));
ok('the serving member outranks the long-gone one', names[0] === 'משה כהן' && names[1] === 'משה לוי', names.join(','));
const subs = await page.$$eval('.mkcard .mcsub', els => els.map(e => e.textContent));
ok('a current position shows as-is', subs[0].includes('שר האוצר'));
ok('a past position shows with its years and context', subs[1].includes('ועדת החינוך') && subs[1].includes('2013'));
const nowChips = await page.$$('.mkcard .nowchip');
ok('only the serving member gets the "serving now" chip', nowChips.length === 1);
ok('search cards carry avatars', await page.$('.mkcard .avatar') !== null);
const kinds = await page.$$eval('.mkcard .avatar', els => els.map(e => e.tagName));
ok('the collected member has a photo card, the other has initials',
  kinds[0] === 'IMG' && kinds[1] === 'SPAN', kinds.join(','));

await page.fill('#mkq', 'לפיד');
await page.waitForFunction(() => {
  const c = document.querySelectorAll('.mkcard');
  return c.length === 1 && c[0].textContent.includes('לפיד');
});
await page.waitForFunction(() =>
  document.querySelector('.mkcard .mcsub').textContent.includes('ראש הממשלה'));
const pmSub = await page.textContent('.mkcard .mcsub');
ok('an ever-PM shows the PM line with year spans', pmSub.includes('ראש הממשלה 2020–2021 · 2022–היום'), pmSub);

console.log('\nopening a portfolio (search bridges the two id spaces):');
await page.click('.mkcard');
await page.waitForSelector('.mkname');
ok('the display name comes from the persons table', (await page.textContent('.mkname')).trim() === 'יאיר לפיד');
ok('the portfolio header carries the large avatar', await page.$('#phead .avatar.avlg') !== null);
await page.waitForFunction(() => document.getElementById('positions').querySelector('.posrow'));
ok('Knessets served shows both, once', (await page.textContent('#phead')).includes('24, 25'));
ok('the faction line found the current faction', (await page.textContent('#phead')).includes('יש עתיד'));

console.log('\npersonal background:');
await page.waitForFunction(() => document.getElementById('bioCard').style.display !== 'none');
const bioText = await page.textContent('#bio');
ok('birth year, education and service render', bioText.includes('1963') && bioText.includes('מדע המדינה') && bioText.includes('צנחנים'));
ok('empty fields leave no row behind', !bioText.includes('שירות לאומי') && !bioText.includes('שנת עלייה'));
ok('the free-text Content field is NOT injected', !(await page.innerHTML('#bio')).includes('ignored'));

console.log('\npositions:');
const posText = await page.textContent('#positions');
ok('the ministry position is there with its role', posText.includes('שר החוץ') && posText.includes('משרד החוץ'));
ok('the committee seat is there', posText.includes('ועדת הכספים'));
ok('the open-ended current seat is marked', await page.$('.nowchip') !== null);
ok('the role name came from KNS_Position when DutyDesc is empty', posText.includes('חבר כנסת'));
const pmRows = await page.$$eval('#positions .posrow', els =>
  els.map(e => e.textContent).filter(x => x.includes('ראש הממשלה')));
ok('the twin-position-code duplicate collapsed to one row', pmRows.filter(x => x.includes('כנסת 25')).length === 1, pmRows.join(' || '));
const k23 = pmRows.filter(x => x.includes('כנסת 23'));
ok('a term split by a mid-Knesset government change is one row', k23.length === 1, pmRows.join(' || '));
ok('…spanning the full term', k23[0] && k23[0].includes('2020') && k23[0].includes('2021'));
const housing = posText.match(/שר הבינוי והשיכון/g) || [];
ok('separate short stints with a real gap stay separate', housing.length === 2, 'found ' + housing.length);

console.log('\nbills, in three honest piles:');
await page.waitForFunction(() => document.getElementById('bills').querySelector('.bucket'));
const billsText = await page.textContent('#bills');
ok('passed pile holds the passed bill', billsText.includes('חוק שעבר') && billsText.includes('התקבלה בקריאה שלישית'));
ok('rejected pile holds the fallen bill', billsText.includes('חוק שנפל') && billsText.includes('להסרה מסדר היום'));
ok('in-process pile holds the rest', billsText.includes('חוק בדרך'));
ok('the lead-sponsor tag shows', await page.$('.leadchip') !== null);
await page.waitForFunction(() => document.querySelector('#ptiles .tile'));
const tiles = await page.$$eval('#ptiles .tile .tv', els => els.map(e => e.textContent));
ok('tiles: 3 bills, 1 passed, 1 rejected', tiles[0] === '3' && tiles[1] === '1' && tiles[2] === '1', tiles.join(','));

console.log('\nthe voting record:');
await page.waitForSelector('#mkvotes .vote');
const rows = await page.$$('#mkvotes .vote');
ok('reservation votes folded into one row per bill+day', rows.length === 2);
await page.waitForFunction(() => document.querySelector('#mkvotes .myvote'));
const row1 = await page.textContent('#mkvotes .vote');
ok('the decisive result is on the row', row1.includes('התקבלה'));
ok('how THEY voted is on the row', row1.includes('בעד'));
await page.click('#mkvotes .vote');
await page.waitForSelector('.kidsbox');
const kid = await page.textContent('.kidsbox');
ok('expanding shows the tallies', kid.includes('55') && kid.includes('40'));
ok('expanding shows the decision text', kid.includes('לאשר את החוק'));

console.log('\nlanguage + deep link:');
await page.click('#langbtn');
ok('English flips the direction', await page.$eval('html', e => e.dir) === 'ltr');
ok('English strings appear', (await page.textContent('#profile')).includes('Passed'));
const page2 = await browser.newPage();
await page2.route(url => url.href.startsWith('https://our-money.'), answer);
await page2.route(url => !url.href.startsWith(`http://localhost:${PORT}/`) && !url.href.startsWith('https://our-money.'), r => r.abort());
await page2.goto(`http://localhost:${PORT}/mk_page/index.html?name=${encodeURIComponent('לפיד יאיר')}`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('.mkname');
ok('?name= opens the portfolio directly', (await page2.textContent('.mkname')).trim() === 'יאיר לפיד');
await page2.close();

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
