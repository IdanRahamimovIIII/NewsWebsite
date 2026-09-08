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
const CMB = {
  Knessets: [
    { KnessetId: 25, KnessetStart: '2022-11-15T00:00:00', KnessetEnd: '2026-11-10T00:00:00' },
    { KnessetId: 24, KnessetStart: '2021-04-06T00:00:00', KnessetEnd: '2022-11-15T00:00:00' },
    { KnessetId: 20, KnessetStart: '2015-03-31T00:00:00', KnessetEnd: '2019-04-30T00:00:00' },
  ],
  // the official strings, dirt included: a trailing space, a "בראשות" suffix
  Factions: [
    { ID: 1, FactionName: 'יש עתיד ', KnessetId: 25 },
    { ID: 2, FactionName: 'עוצמה יהודית בראשות איתמר בן גביר', KnessetId: 25 },
    { ID: 3, FactionName: 'העבודה', KnessetId: 20 },
  ],
  MKS: [
  { Id: 1001, Name: 'לפיד יאיר', KnessetId: 25, faction_id: 1 },
  { Id: 900,  Name: 'לפיד יאיר', KnessetId: 24, faction_id: 1 },
  { Id: 900,  Name: 'לפיד יאיר', KnessetId: 24, faction_id: 1 },   // duplicate row — must not double the chip
  { Id: 800,  Name: 'כהן משה',  KnessetId: 25, faction_id: 2 },
  { Id: 700,  Name: 'לוי משה',  KnessetId: 20, faction_id: 3 },    // left long ago — must rank below כהן
  { Id: 600,  Name: 'רגב מירי', KnessetId: 25, faction_id: 2 },    // in the votes directory ONLY — the persons snapshot missed her
  { Id: 500,  Name: 'עזב דני',  KnessetId: 25, faction_id: 1 },    // sat in K25 and LEFT (a former minister) — sorts last
  { Id: 400,  Name: 'גנץ בני',  KnessetId: 25, faction_id: 1 },    // the persons table has him as "בנימין גנץ" — a nickname
] };
const PERSONS = { t: 1, data: { 2605: 'יאיר לפיד', 2700: 'משה כהן', 2800: 'משה לוי', 3000: 'דני עזב',
  3100: 'בנימין גנץ',
  3200: 'משה כהן',   // a SECOND משה כהן, long gone — no rows in K25, must not be counted with the minister
  3300: 'בניה גנצר',  // must NOT be taken for גנץ בני: prefixes alone don't make a match (seen live: "אליסף אליעזר" for "אלי")
  3400: 'דוד ישן',    // in the persons table ONLY (no votes-directory row): the grid never holds him until a name search fetches him
} };
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
  1: { VoteHeader: [{ VoteId: 1, IsForAccepted: true, Decision: 'לאשר את החוק', FK_Knesset: 25, SessionNumber: 80, FK_ItemID: 11 }],
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
  /* …and again across the Knesset line (K24, 2021–2021) — the hero must read all of it as one 2020–2021 term */
  { PersonToPositionID: 20, PersonID: 2605, PositionID: 45, KnessetNum: 24, StartDate: '2021-04-06T00:00:00',
    FinishDate: '2021-06-13T00:00:00', GovMinistryName: 'משרד ראש הממשלה', DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: false, GovernmentNum: 35 },
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
  /* reachable only through the KNS_Person fallback (PersonID 2900 is not in the snapshot) */
  { PersonToPositionID: 12, PersonID: 2900, PositionID: 42, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: null, GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: 'ועדת הפנים', IsCurrent: true },
  /* the ordering fixtures: everyone sitting has an open "חבר כנסת" row; רגב was a minister once (→ former-minister
     tier, above plain members); עזב left K25 in 2024 and was a minister back in K20 (→ after everyone serving) */
  { PersonToPositionID: 13, PersonID: 2700, PositionID: 39, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: null, GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: true },
  { PersonToPositionID: 14, PersonID: 2900, PositionID: 39, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: null, GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: true },
  { PersonToPositionID: 15, PersonID: 2900, PositionID: 47, KnessetNum: 24, StartDate: '2021-06-13T00:00:00',
    FinishDate: '2022-12-29T00:00:00', GovMinistryName: 'משרד התחבורה', DutyDesc: 'שרת התחבורה', FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 16, PersonID: 3000, PositionID: 39, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: '2024-01-01T00:00:00', GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 17, PersonID: 3000, PositionID: 47, KnessetNum: 20, StartDate: '2015-05-14T00:00:00',
    FinishDate: '2019-04-30T00:00:00', GovMinistryName: 'משרד החינוך', DutyDesc: 'שר החינוך', FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 18, PersonID: 3100, PositionID: 39, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: null, GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: true },
  { PersonToPositionID: 24, PersonID: 2900, PositionID: 49, KnessetNum: 24, StartDate: '2021-04-06T00:00:00',
    FinishDate: '2022-11-15T00:00:00', GovMinistryName: null, DutyDesc: null, FactionName: 'הליכוד בהנהגת בנימין נתניהו לראשות הממשלה', CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 23, PersonID: 2700, PositionID: 47, KnessetNum: 24, StartDate: '2021-06-13T00:00:00',
    FinishDate: '2022-12-29T00:00:00', GovMinistryName: 'משרד ראש הממשלה', DutyDesc: 'סגן שר במשרד ראש הממשלה', FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 22, PersonID: 3000, PositionID: 48, KnessetNum: 25, StartDate: '2022-12-01T00:00:00',
    FinishDate: '2023-06-01T00:00:00', GovMinistryName: null, DutyDesc: 'סגן יושב–ראש הכנסת', FactionName: null, CommitteeName: null, IsCurrent: false },   // the register's en dash
  { PersonToPositionID: 21, PersonID: 3100, PositionID: 47, KnessetNum: 24, StartDate: '2021-06-13T00:00:00',
    FinishDate: '2022-12-29T00:00:00', GovMinistryName: 'משרד הביטחון', DutyDesc: 'סגן שר הביטחון', FactionName: null, CommitteeName: null, IsCurrent: false },
  { PersonToPositionID: 19, PersonID: 3300, PositionID: 39, KnessetNum: 25, StartDate: '2022-11-15T00:00:00',
    FinishDate: null, GovMinistryName: null, DutyDesc: null, FactionName: null, CommitteeName: null, IsCurrent: true },
];
const POSNAMES = [
  { PositionID: 39, Description: 'חבר כנסת' },
  { PositionID: 40, Description: 'שר' },
  { PositionID: 42, Description: 'חבר ועדה' },
  { PositionID: 45, Description: 'ראש הממשלה' },
  { PositionID: 46, Description: 'ראש הממשלה' },   // the gendered twin code
  { PositionID: 47, Description: 'שר' },
  { PositionID: 49, Description: 'חבר/ת סיעה' },
];
const INITS = [
  { BillID: 11, IsInitiator: true,  Ordinal: 1 },
  { BillID: 12, IsInitiator: false, Ordinal: 4 },
  { BillID: 13, IsInitiator: false, Ordinal: 9 },
  { BillID: 14, IsInitiator: false, Ordinal: 2 },
];
const BILLS = [
  { BillID: 11, Name: 'חוק שעבר', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 118, KnessetNum: 25, LastUpdatedDate: '2026-01-06T00:00:00' },
  { BillID: 12, Name: 'חוק שנפל', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 140, KnessetNum: 24, LastUpdatedDate: '2025-05-01T00:00:00' },
  { BillID: 13, Name: 'חוק בדרך', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 113, KnessetNum: 25, LastUpdatedDate: '2026-02-01T00:00:00' },
  { BillID: 14, Name: 'חוק שנשכח', SubTypeID: 54, SubTypeDesc: 'פרטית', StatusID: 113, KnessetNum: 20, LastUpdatedDate: '2016-02-01T00:00:00' },   // undecided, from a Knesset long gone
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
    // the two BULK filters the directory order uses (this Knesset's rows; ministry rows before it) …
    const kEq = /KnessetNum eq (\d+)/.exec(target);
    const bulk = kEq && !target.includes('PersonID eq') ? POSITIONS.filter(r => r.KnessetNum === +kEq[1])
      : target.includes('GovMinistryID ne null') ? POSITIONS.filter(r => r.GovMinistryName && r.KnessetNum >= 16 && r.KnessetNum < 25)
      : null;
    if (bulk && target.includes('/$count')) return route.fulfill(json(bulk.length));
    if (bulk) return route.fulfill(json({ value: target.includes('$skip=0') ? bulk : [] }));
    // … else answer whichever PersonIDs the (possibly OR-batched) filter names
    const rows = target.includes('$skip=0')
      ? POSITIONS.filter(r => target.includes('PersonID eq ' + r.PersonID)) : [];
    return route.fulfill(json({ value: rows }));
  }
  if (target.includes('KNS_Position(')) return route.fulfill(json({ value: POSNAMES }));
  if (target.includes('KNS_BillInitiator()/$count')) {   // the directory cards' laws-passed counts
    if (!target.includes('KNS_Bill/StatusID eq 118')) return route.fulfill({ status: 500, body: 'a plain count is not what the card asks' });
    return route.fulfill(json(target.includes('PersonID eq 2605') ? 1 : target.includes('PersonID eq 2700') ? 5
      : target.includes('PersonID eq 3200') ? 99 : 0));
  }
  if (target.includes('KNS_BillInitiator'))
    return route.fulfill(json({ value: target.includes('PersonID eq 2605') && target.includes('$skip=0') ? INITS : [] }));
  if (target.includes('KNS_DocumentBill')) {   // the official documents: BillID 11 has three files (one path with the register's dirt)
    const rows = target.includes('BillID eq 11') ? [
      { GroupTypeDesc: 'הצעת חוק לקריאה הראשונה', ApplicationDesc: 'PDF', FilePath: 'https://fs.knesset.gov.il//25/law/25_ls1_1.pdf' },
      { GroupTypeDesc: 'הצעת חוק לקריאה הראשונה', ApplicationDesc: 'DOC', FilePath: 'https://fs.knesset.gov.il/25/law/25_ls1_1.docx' },
      { GroupTypeDesc: 'חוק - פרסום ברשומות', ApplicationDesc: 'PPT', FilePath: 'https://fs.knesset.gov.il//25/law/25_lsr  _2.pdf' },   // the register calls this .pdf a "PPT" — the file wins
    ] : [];
    return route.fulfill(json({ value: rows }));
  }
  if (target.includes('KNS_Bill(')) {
    const rows = BILLS.filter(b => target.includes('BillID eq ' + b.BillID));
    return route.fulfill(json({ value: rows }));
  }
  if (target.includes('KNS_Status')) return route.fulfill(json({ value: STATUSES }));
  if (target.includes('KNS_Person(') && target.includes('GenderID'))   // the hero's verbs
    return route.fulfill(json({ value: target.includes('PersonID eq 2605') ? [{ GenderID: 251, GenderDesc: 'זכר' }] : [] }));
  if (target.includes('KNS_Person(')) {
    // the votes directory says "רגב מירי"; the persons table has her as FirstName מירי, LastName רגב —
    // only the second (reversed) try must hit
    const hit = target.includes("FirstName eq 'מירי'") && target.includes("LastName eq 'רגב'");
    return route.fulfill(json({ value: hit ? [{ PersonID: 2900 }] : [] }));
  }
  if (target.includes('GetMkDetailsContent')) return route.fulfill(json({
    ID: 1001, DateOfBirth: 'י"ח בחשוון תשכ"ד , 05/11/1963', DeathDate: null, PlaceOfBirth: 'תל-אביב, ישראל',   // as the CMS really writes them
    ImmigrationYear: null, Residence: 'תל אביב',
    Education: '- תואר ראשון במדע המדינה&#x0D;\n- תואר שני במינהל עסקים &amp; משפטים',   // as the Knesset CMS really sends it
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
await page.waitForSelector('#dir .dircard');
const tabs = await page.$$eval('nav.tabs a', els => els.map(e => e.getAttribute('href')));
ok('the nav has four tabs', tabs.length === 4, tabs.join(','));
ok('the MK page is the active tab', await page.$eval('nav.tabs a.active', e => e.getAttribute('href')) === '../mk_page/');
const chips = await page.$$eval('#dir .dircard .dcname', els => els.map(e => e.textContent));
ok('the directory lists this Knesset\'s members once each', chips.length === 5, chips.join(','));
ok('ordered by importance: PM → minister → former minister → plain member → the one who left',
  chips.join(',') === 'יאיר לפיד,משה כהן,רגב מירי,בנימין גנץ,דני עזב', chips.join(','));
ok('"גנץ בני" found the persons table\'s "בנימין גנץ" (tolerant match) and counts as serving', chips.includes('בנימין גנץ'));
const gantzPids = await page.evaluate(() => state._dir.find(e => e.name === 'בנימין גנץ').personIds.join(','));
ok('…and only him — a prefix-only lookalike is not taken', gantzPids === '3100', gantzPids);
const roles0 = await page.$$eval('#dir .dcrole', els => els.map(e => e.textContent));
ok('role lines are there at first paint (from this Knesset\'s bulk rows)', roles0.every(r => r !== '…'), roles0.join(' | '));

console.log('\nthe profile cards (party · years · role · bills fill in per card):');
const cardOf = name => page.$$eval('#dir .dircard', (els, n) => {
  const el = els.find(e => e.querySelector('.dcname').textContent === n);
  const g = c => (el.querySelector(c) || {}).textContent || '';
  return { party: g('.dcparty'), years: g('.dcyears'), role: g('.dcrole'), bills: g('.dcbills') };
}, name);
await page.waitForFunction(() => [...document.querySelectorAll('#dir .dircard')]
  .every(e => e.querySelector('.dcrole').textContent !== '…' && (e.querySelector('.dcbills') || {}).textContent !== '…'));
const lapid = await cardOf('יאיר לפיד'), cohen = await cardOf('משה כהן'), regev = await cardOf('רגב מירי'), left = await cardOf('דני עזב');
ok('a leaver\'s years close at the year they left', left.years === '2015–2024', left.years);
ok('a leaver\'s role is the last one of substance, with years', left.role === 'סגן יושב–ראש הכנסת · 2022–2023', left.role);
ok('party from the votes directory, trailing space trimmed', lapid.party === 'יש עתיד', lapid.party);
ok('card order: name, then role, then party', await page.$eval('#dir .dircard', e => [...e.children].map(c => c.className).join(',')).then(s => /dcname,dcrole,dcparty/.test(s)));
ok('the "בראשות <leader>" suffix is dropped from a party name', cohen.party === 'עוצמה יהודית', cohen.party);
ok('years start at the register\'s earliest row, not just the votes directory', lapid.years === '2020–היום', lapid.years);
ok('the heaviest current role of substance is the role line', lapid.role === 'ראש הממשלה' && cohen.role === 'שר האוצר', lapid.role + ' / ' + cohen.role);
ok('a committee seat carries its committee', regev.role === 'חבר ועדה · ועדת הפנים', regev.role);
ok('laws passed: a $count filtered on the passed status, worded for one', lapid.bills === 'חוק אחד שעבר', lapid.bills);
ok('a namesake with no rows in this Knesset is NOT counted with the sitting member', cohen.bills === '5 חוקים שעברו', cohen.bills);
ok('zero laws passed → no line at all', regev.bills === '', regev.bills);

ok('two concurrent asks for the directory share one build (the photo-manifest race)',
  await page.evaluate(() => Promise.all([buildDirectory(), buildDirectory()]).then(([a, b]) => a === b && a.length >= 5)));

console.log('\nreaching the bottom appends earlier members, by the last year in office:');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForFunction(() => document.querySelector('#dirmore') && document.querySelector('#dirmore').textContent.includes('זה הכל'), null, { timeout: 15000 });
const heads = await page.$$eval('#dir .dirk', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
ok('one continuous grid — no dividers', heads.length === 0 && (await page.$$eval('#dir .dirgrid', els => els.length)) === 1, heads.join('|'));
ok('a sitting member with only plain roles today reads "חבר/ת הכנסת", not the deputy-minister line of 2022',
  await page.$$eval('#dir .dircard', els => { const c = els.find(e => e.querySelector('.dcname').textContent === 'בנימין גנץ'); return c.querySelector('.dcrole').textContent === 'חבר/ת הכנסת' && c.querySelector('.dcyears').textContent === '2021–היום'; }));
const allNames = await page.$$eval('#dir .dircard .dcname', els => els.map(e => e.textContent));
ok('its member who never sat in the 25th is there, with the card fully drawn', allNames.includes('משה לוי')
  && (await page.$$eval('#dir .dircard', els => { const c = els.find(e => e.querySelector('.dcname').textContent === 'משה לוי'); return c.querySelector('.dcrole').textContent.includes('ועדת החינוך') && c.querySelector('.dcyears').textContent === '2013–2015'; })));
ok('someone already shown under the 25th is not repeated', allNames.filter(n => n === 'יאיר לפיד').length === 1);
ok('the archive ends at the 16th, and says so', (await page.textContent('#dirmore')).includes('הכנסת ה-16'));
await page.evaluate(() => window.scrollTo(0, 0));

console.log('\nthe search filters the grid in place (Mercy, 2026-09-07):');
// the manifest arrives on its own schedule and the directory is redrawn when it does — wait, don't peek
ok('a collected photo shows in the directory', await page.waitForSelector('#dir img.avatar', { timeout: 5000 }).then(() => true, () => false));
ok('everyone else gets initials, no broken images', await page.$('#dir span.avatar') !== null);
const gridNames = () => page.$$eval('#dir .dircard .dcname', els => els.map(e => e.textContent));
const total = (await gridNames()).length;
await page.fill('#mkq', 'משה');            // fill fires the input event — no button
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 2);
const names = await gridNames();
ok('only the matching cards remain, in the grid\'s own order (serving first)', names.join(',') === 'משה כהן,משה לוי', names.join(','));
ok('no second list, no sentinel while searching', await page.$('.mkcard') === null && await page.$('#dirmore') === null);
await page.fill('#mkq', '');
await page.waitForFunction((n) => document.querySelectorAll('#dir .dircard').length === n, total);
ok('clearing the box brings every card back, and the sentinel', (await gridNames()).length === total && await page.$('#dirmore') !== null);
await page.fill('#mkq', 'אין כזה');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 0);
ok('no match says so, in place', (await page.textContent('#dir')).includes('לא נמצא'));

console.log('\nsearch by role or party:');
await page.fill('#mkq', 'שר האוצר');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 1 && document.querySelector('#dir .dircard').textContent.includes('משה כהן'));
ok('a role cuts the grid to its holder', true);
await page.fill('#mkq', 'ראש ממשלה');
await page.waitForFunction(() => state.dirQ === 'ראש ממשלה' && document.querySelectorAll('#dir .dircard').length === 2);
ok('"ראש ממשלה" (no ה) finds "ראש הממשלה" and "…במשרד ראש הממשלה" — words with Hebrew prefixes, not substrings', (await gridNames()).join(',') === 'יאיר לפיד,משה כהן', (await gridNames()).join(','));
ok('…and each card that is not the PM says why it is there', await page.$$eval('#dir .dircard', els => els.find(e => e.querySelector('.dcname').textContent === 'משה כהן').querySelector('.dchit').textContent.includes('סגן שר במשרד ראש הממשלה · 2021–2022')));
ok('…but not the member whose old faction name merely contains "לראשות הממשלה"', !(await gridNames()).includes('רגב מירי'));
await page.fill('#mkq', 'לראשות הממשלה');
await page.waitForFunction(() => state.dirQ === 'לראשות הממשלה' && document.querySelectorAll('#dir .dircard').length === 1);
ok('that faction name is found by its own words, and shown as the reason', (await gridNames())[0] === 'רגב מירי' && (await page.textContent('#dir .dchit')).includes('לראשות הממשלה'));
await page.fill('#mkq', 'ראש הממ');
await page.waitForFunction(() => state.dirQ === 'ראש הממ' && document.querySelectorAll('#dir .dircard').length === 2);
ok('the word being typed may be a prefix', true);
await page.fill('#mkq', 'יושב-ראש');
await page.waitForFunction(() => state.dirQ === 'יושב-ראש' && document.querySelectorAll('#dir .dircard').length === 1);
ok('a typed hyphen meets the register\'s en dash, word by word', (await gridNames())[0] === 'דני עזב');
ok('a hyphen finds the register\'s en-dash ("יושב–ראש")', await page.evaluate(async () => (await findCandidates('יושב-ראש הכנסת')).some(c => c.name === 'דני עזב')));
await page.fill('#mkq', 'עוצמה יהודית');
await page.waitForFunction(() => state.dirQ === 'עוצמה יהודית' && [...document.querySelectorAll('#dir .dircard .dcname')].some(e => e.textContent === 'משה כהן') && !document.querySelector('#dir .dchit'));
ok('a party cuts the grid to its members (both of them), without repeating the party as the reason', (await gridNames()).join(',') === 'משה כהן,רגב מירי' && await page.$('#dir .dchit') === null, (await gridNames()).join(','));
await page.fill('#mkq', 'שר החינוך');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 1 && document.querySelector('#dir .dircard').textContent.includes('דני עזב'));
ok('a ministry held in an earlier Knesset is found, and the card says why (the years included)',
  (await page.textContent('#dir .dircard .dchit')).includes('שר החינוך · 2015–2019'));
await page.fill('#mkq', 'ישן');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 1 && document.querySelector('#dir .dircard').textContent.includes('דוד ישן'));
ok('someone the grid never held (persons table only) is fetched by name and shown as a card', true);
await page.fill('#mkq', '');
await page.waitForFunction((n) => document.querySelectorAll('#dir .dircard').length === n + 1, total);
ok('…and stays in the grid afterwards, at the end (no Knesset to place them by)', (await gridNames()).slice(-1)[0] === 'דוד ישן');
await page.fill('#mkq', 'לפיד');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 1 && document.querySelector('#dir .dircard').textContent.includes('לפיד'));

console.log('\nopening a portfolio (search bridges the two id spaces):');
await page.click('#dir .dircard');
await page.waitForSelector('.mkname');
ok('the display name comes from the persons table', (await page.$eval('.mkname', e => e.firstChild.textContent.trim())) === 'יאיר לפיד');
ok('the portfolio header carries the big centered portrait', await page.$('#phead .pheadcol .avatar.avxxl') !== null);
ok('the search card is gone while a portfolio is open', await page.$eval('#mkq', e => getComputedStyle(e.closest('.card')).display) === 'none');
ok('the site tagline is gone while a portfolio is open', await page.$eval('[data-i18n="tagline"]', e => getComputedStyle(e).display) === 'none');
ok('the current role sits next to the name', (await page.textContent('#phead .mkrole')).includes('ראש הממשלה'));
await page.waitForFunction(() => document.getElementById('positions').querySelector('.posrow'));
const story = await page.textContent('#phead .story');
ok('the story line: faction · in the Knesset since the register\'s first year', story.includes('יש עתיד') && story.includes('בכנסת מאז 2020'), story);
ok('…and nothing else (the PM spans are the timeline\'s job)', !story.includes('ראש הממשלה'), story);
ok('the faction explanation is two short sentences', (await page.$eval('#phead .factionname', e => e.title)).length < 140);
ok('no list of Knesset numbers anywhere in the hero', !(await page.textContent('#phead')).includes('24, 25'));
ok('the faction name carries its explanation (no underline any more)', (await page.$eval('#phead .factionname', e => e.title)).includes('לא תמיד זהה למפלגה')
  && await page.$('#phead .term') === null);
ok('the counts carry explanations on hover', (await page.$$eval('#ptiles .bleg .chip', els => els.every(e => e.title.length > 20))));
ok('the role by the name is the same size as the name', await page.$eval('#phead .mkrole', e => getComputedStyle(e).fontSize) === await page.$eval('#phead .mkname', e => getComputedStyle(e).fontSize));
ok('no hint lines under the section titles', (await page.$$eval('#profile .hint', els => els.length)) === 0);

console.log('\npersonal background (a small table under the bills bar):');
await page.waitForSelector('#ptiles .biot');
const facts = await page.$$eval('#ptiles .biot', els => { const ch = [...els[0].children]; const out = []; for (let i = 0; i < ch.length; i += 2) out.push(ch[i].textContent + '=' + ch[i + 1].textContent); return out; });
const bioText = facts.join(' | ');
ok('birth: year out of the Hebrew date, country dropped', facts[0] === 'לידה=1963 · תל-אביב', facts[0]);
ok('residence, education (bullets → a run), army', facts.includes('מגורים=תל אביב') && facts.includes('השכלה=תואר ראשון במדע המדינה, תואר שני במינהל עסקים & משפטים') && facts.includes('צבא=צנחנים'), bioText);
ok('empty fields leave no fact behind', !bioText.includes('שירות לאומי') && !bioText.includes('עלייה'));
ok('the free-text Content field is NOT injected', !(await page.innerHTML('#ptiles')).includes('ignored'));
ok('CMS entities decoded, nothing from upstream lands as markup', !bioText.includes('&#') && !(await page.innerHTML('#ptiles')).includes('&#x0D'));
ok('the block stacks (no leftover tile grid): the table starts below the bar', await page.$eval('#ptiles', e => e.querySelector('.biot').getBoundingClientRect().top >= e.querySelector('.billsbar').getBoundingClientRect().bottom));
ok('the table sits in the same block, under the bar', await page.$eval('#ptiles', e => e.querySelector('.billsbar') && e.querySelector('.biot') && e.querySelector('.billsbar').compareDocumentPosition(e.querySelector('.biot')) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false));
ok('no separate bio card in the page any more — the table under the bills sentence is it', await page.$('#bioCard') === null && await page.$('#bio') === null);

console.log('\npositions:');
ok('only the last 4 show by default', (await page.$$eval('#positions .posrow', els => els.length)) === 4);
await page.click('#positions .votechip');   // "show all"
await page.waitForFunction(() => document.querySelectorAll('#positions .posrow').length > 4);
const posText = await page.textContent('#positions');
ok('the ministry position is there with its role', posText.includes('שר החוץ') && posText.includes('משרד החוץ'));
ok('the committee seat is there', posText.includes('ועדת הכספים'));
ok('the open-ended current seat is marked', await page.$('.nowchip') !== null);
const nowFlags = await page.$$eval('#positions .posrow', els => els.map(e => !!e.querySelector('.nowchip')));
ok('every current role sits above every past one', nowFlags.indexOf(false) > nowFlags.lastIndexOf(true), nowFlags.join(','));
ok('…the heaviest current role first', (await page.$eval('#positions .posrow', e => e.textContent)).includes('ראש הממשלה'));
ok('the role name came from KNS_Position when DutyDesc is empty', posText.includes('חבר כנסת'));
const pmRows = await page.$$eval('#positions .posrow', els =>
  els.map(e => e.textContent).filter(x => x.includes('ראש הממשלה')));
ok('the twin-position-code duplicate collapsed to one row', pmRows.filter(x => x.includes('כנסת 25')).length === 1, pmRows.join(' || '));
const k23 = pmRows.filter(x => x.includes('כנסת 23'));
ok('a term split by a mid-Knesset government change is one row', k23.length === 1, pmRows.join(' || '));
ok('…spanning the full term', k23[0] && k23[0].includes('2020') && k23[0].includes('2021'));
const housing = posText.match(/שר הבינוי והשיכון/g) || [];
ok('separate short stints with a real gap stay separate', housing.length === 2, 'found ' + housing.length);

console.log('\nbills: one list, newest first, the reader filters:');
await page.waitForFunction(() => document.getElementById('bills').querySelector('.brow'));
const billsText = await page.textContent('#bills');
const order = await page.$$eval('#bills .brow .bname', els => els.map(e => e.firstChild.textContent.replace(/^[▸▾]\s*/, '').trim()));
ok('opens on the passed pile alone', order.join(',') === 'חוק שעבר', order.join(','));
ok('four radio chips with counts, exactly one on (עברו)', (await page.$$eval('#bills .fchip', els => els.length)) === 4
  && (await page.$$eval('#bills .fchip.on', els => els.map(e => e.dataset.k).join(','))) === 'passed');
ok('each check-circle explains its pile on hover', await page.$$eval('#bills .fchip', els => els.every(e => e.title.length > 20)));
ok('the passed pile holds the passed bill, with its status', billsText.includes('חוק שעבר') && billsText.includes('התקבלה בקריאה שלישית'));
await page.click('#bills .fchip[data-k="rejected"]');
const rejT = await page.textContent('#billslist');
ok('picking נפלו swaps the list — one pile at a time', rejT.includes('חוק שנפל') && rejT.includes('להסרה מסדר היום') && !rejT.includes('חוק שעבר')
  && (await page.$$eval('#bills .fchip.on', els => els.length)) === 1);
await page.click('#bills .fchip[data-k="pending"]');
ok('an undecided bill of THIS Knesset is "בתהליך" (blue dot)', await page.$$eval('#billslist .brow', els => els.length === 1 && els[0].textContent.includes('חוק בדרך') && !!els[0].querySelector('.dot.pending')));
await page.click('#bills .fchip[data-k="stale"]');
ok('an undecided bill of an old Knesset is "לא הוכרעו" (gray dot)', await page.$$eval('#billslist .brow', els => els.length === 1 && els[0].textContent.includes('חוק שנשכח') && !!els[0].querySelector('.dot.abstain')));
await page.fill('#bills .billq', 'שנשכח');
ok('the name search narrows the list', (await page.$$eval('#billslist .brow', els => els.length)) === 1 && (await page.textContent('#billslist')).includes('חוק שנשכח'));
ok('…and typing kept the caret in the box', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('billq')));
await page.fill('#bills .billq', 'אין כזה');
ok('no match says so', (await page.textContent('#billslist')).includes('אין הצעות חוק שמתאימות'));
await page.fill('#bills .billq', '');
await page.click('#bills .fchip[data-k="passed"]');
ok('the lead-sponsor tag shows', await page.$('.leadchip') !== null);
console.log('\na bill opens to its official documents:');
await page.click('#billslist .brow');
await page.waitForSelector('#billslist .kidsbox .docs');
const dtypes = await page.$$eval('#billslist .drow .dtype', els => els.map(e => e.textContent));
ok('documents grouped by stage, in the register\'s order', dtypes.join(',') === 'הצעת חוק לקריאה הראשונה,חוק - פרסום ברשומות', dtypes.join(','));
const hrefs = await page.$$eval('#billslist .dlink', els => els.map(e => e.textContent + '=' + e.getAttribute('href')));
ok('one link per format, paths normalized (no double slash, spaces encoded), new tab',
  hrefs[0] === 'PDF=https://fs.knesset.gov.il/25/law/25_ls1_1.pdf' && hrefs[1] === 'DOC=https://fs.knesset.gov.il/25/law/25_ls1_1.docx'
  && hrefs[2] === 'PDF=https://fs.knesset.gov.il/25/law/25_lsr%20%20_2.pdf'
  && await page.$$eval('#billslist .dlink', els => els.every(e => e.target === '_blank' && e.rel.includes('noopener'))), hrefs.join(' | '));
await page.click('#billslist .brow');
ok('…and closes again', await page.$('#billslist .kidsbox') === null);
await page.click('#bills .fchip[data-k="rejected"]');
await page.click('#billslist .brow');
await page.waitForFunction(() => document.querySelector('#billslist .kidsbox') && !document.querySelector('#billslist .kidsbox .loading'));
ok('a bill with no documents says so', (await page.textContent('#billslist .kidsbox')).includes('לא נמצאו מסמכים'));
await page.click('#bills .fchip[data-k="passed"]');
await page.waitForFunction(() => document.querySelector('#ptiles .bhead'));
const bhead = await page.textContent('#ptiles .bhead');
ok('one sentence instead of four tiles: "4 הצעות חוק — אחת הפכה לחוק"', bhead === '4 הצעות חוק — אחת הפכה לחוק', bhead);
const legT = await page.textContent('#ptiles .bleg');
ok('no bar — the counts, named like the piles below', await page.$('#ptiles .bbar') === null
  && legT.includes('עברו 1') && legT.includes('נפלו 1') && legT.includes('בתהליך 1') && legT.includes('לא הוכרעו 1'), legT);

console.log('\nthe voting record:');
await page.waitForSelector('#mkvotes .vote');
const rows = await page.$$('#mkvotes .vote');
ok('reservation votes folded into one row per bill+day', rows.length === 2);
await page.waitForFunction(() => document.querySelector('#mkvotes .myvote'));
ok('the plenum-votes number lives in the votes section now', (await page.textContent('#mkknessets')).includes('3 הצבעות במליאה בכנסת ה-25'));
const row1 = await page.textContent('#mkvotes .vote');
ok('the decisive result is on the row', row1.includes('התקבלה'));
ok('how THEY voted is on the row', row1.includes('בעד'));
await page.click('#mkvotes .vote');
await page.waitForSelector('.kidsbox');
const kid = await page.textContent('.kidsbox');
ok('expanding shows the tallies', kid.includes('55') && kid.includes('40'));
ok('expanding shows the decision text', kid.includes('לאשר את החוק'));
await page.waitForSelector('#mkvotes .kidsbox .docs');
ok('…and the official documents of the bill behind the vote', (await page.textContent('#mkvotes .kidsbox .docs')).includes('חוק - פרסום ברשומות'));
await page.fill('#mkknessets .voteq', 'אחרת');
ok('the subject search narrows the votes', (await page.$$eval('#mkvotes .vote', els => els.length)) === 1 && (await page.textContent('#mkvotes')).includes('הצעת חוק אחרת'));
ok('…and the caret stays in the box while the list re-renders', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('voteq')));
await page.fill('#mkknessets .voteq', 'אין כזה');
ok('no match says so', (await page.textContent('#mkvotes')).includes('אין הצבעות שמתאימות'));
await page.fill('#mkknessets .voteq', '');
ok('clearing brings everything back', (await page.$$eval('#mkvotes .vote', els => els.length)) === 2);

console.log('\nhistory: a card click is a step the browser can undo');
await page.goBack();
await page.waitForFunction(() => document.getElementById('dirCard').style.display !== 'none');
ok('browser Back returns to the grid, not off the page', await page.$eval('#profile', e => e.style.display) === 'none' && !(await page.evaluate(() => location.search)).includes('name'));
ok('…and the search card is back', await page.$eval('#mkq', e => getComputedStyle(e.closest('.card')).display) !== 'none');
ok('…and so is the tagline', await page.$eval('[data-i18n="tagline"]', e => getComputedStyle(e).display) !== 'none');
await page.goForward();
await page.waitForSelector('.mkname');
ok('browser Forward re-opens the same person', (await page.$eval('.mkname', e => e.firstChild.textContent.trim())) === 'יאיר לפיד');
await page.click('.backbtn');
await page.waitForFunction(() => document.getElementById('dirCard').style.display !== 'none');
ok('the page\'s own Back button does the same', await page.$eval('#profile', e => e.style.display) === 'none');

console.log('\nsomeone who left: no "היום", no role by the name');
await page.fill('#mkq', 'עזב');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 1 && document.querySelector('#dir .dircard').textContent.includes('עזב'));
await page.click('#dir .dircard');
await page.waitForFunction(() => document.getElementById('positions').querySelector('.posrow'));
const leftStory = await page.textContent('#phead .story');
ok('the story line closes at the year they left', leftStory.includes('בכנסת 2015–2024') && !leftStory.includes('היום'), leftStory);
ok('no current role next to the name', await page.$('#phead .mkrole') === null);
await page.click('.backbtn');
await page.waitForFunction(() => document.getElementById('dirCard').style.display !== 'none');

console.log('\nsomeone the persons snapshot missed:');
await page.fill('#mkq', 'רגב');
await page.waitForFunction(() => document.querySelectorAll('#dir .dircard').length === 1 && document.querySelector('#dir .dircard').textContent.includes('רגב'));
await page.click('#dir .dircard');
await page.waitForFunction(() => document.getElementById('positions').querySelector('.posrow'));
ok('her PersonID came from KNS_Person (reversed word order) and her positions loaded',
  (await page.textContent('#positions')).includes('ועדת הפנים'));

console.log('\nlanguage + deep link:');
await page.click('#langbtn');
ok('English flips the direction', await page.$eval('html', e => e.dir) === 'ltr');
ok('English strings appear', (await page.textContent('#profile')).includes('What did they do over the years?'));
const page2 = await browser.newPage();
await page2.route(url => url.href.startsWith('https://our-money.'), answer);
await page2.route(url => !url.href.startsWith(`http://localhost:${PORT}/`) && !url.href.startsWith('https://our-money.'), r => r.abort());
await page2.goto(`http://localhost:${PORT}/mk_page/index.html?name=${encodeURIComponent('לפיד יאיר')}`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('.mkname');
ok('?name= opens the portfolio directly', (await page2.$eval('.mkname', e => e.firstChild.textContent.trim())) === 'יאיר לפיד');
await page2.close();

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
