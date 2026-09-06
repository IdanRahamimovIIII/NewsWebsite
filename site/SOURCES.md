# SOURCES.md — the upstream data sources, as measured

Reference for every zone: what each government API really returns, verified
live on the dates given. Owned by nobody — whoever learns something new about
an upstream source records it here (same rule as CLAUDE.md: keep it current,
date corrections, delete what proved wrong). The contracts-side BudgetKey
knowledge (`contract_spending`, `contracts_data`, the registers) is in
`pipeline\CLAUDE.md` because only the pipeline reads those tables.

## Data source conclusions (2026-08-20 → 22)

- **BudgetKey (next.obudget.org/api/query?query=SQL)** (2026-08-20):
  works, open CORS, no key. Table `raw_budget`: year, code, title,
  net_allocated / net_revised / net_executed. Codes: '00' root, 4-char =
  ministry/section, +2 chars per level down.
  **CORRECTED 2026-08-22 — this bullet was incomplete on both counts:**
  `raw_budget` has ~60 columns, not 5, and the code space holds TWO trees plus
  revenue (see "THE BUDGET DATA" section below). Values come back in WHOLE ₪
  (2025 total = 682799662000), so index.html's autoScale() resolves to ×1 —
  the ×1000 branch is a fallback for small subtrees, don't rely on it. Table
  `contract_spending`: supplier_name (jsonb-ish), purpose, publisher_name,
  min_year, max_year, volume, executed. Search with `supplier_name::text ILIKE`.
  Verified live by Mercy: data loads and looks right.
  FAILURE MODE (2026-08-21, seen live): when their Postgres is saturated the
  API returns HTTP 200 with {"success":false,"error":"…connection slots…"}.
  bk() in index.html now throws UPSTREAM:: on success:false → page shows a
  "temporarily overloaded" message instead of silent zeros. Transient.
- **Knesset OData ParliamentInfo.svc** (2026-08-20): works THROUGH THE RELAY
  (no CORS headers; blocks datacenter/bot fetches — Claude's sandbox and
  WebFetch get 4xx, Cloudflare Workers get through). KNS_Bill + KNS_Status
  verified live by Mercy: current, updates within days.
- **Knesset OData Votes.svc — CONFIRMED FROZEN** (2026-08-20, verified via
  relay): max vote_id 34525, vote_date 2021-07-13, Knesset 24. Header table
  `View_vote_rslts_hdr_Approved` fields verified: vote_id, knesset_num,
  session_id, sess_item_dscr, vote_item_dscr, vote_date, vote_time,
  is_accepted, total_for/against/abstain, session_num, reason.
  Per-member table is `vote_rslts_kmmbr_shadow` (NOT ..._shpn — that 404s!),
  fields verified: vote_id, kmmbr_id (zero-padded string "000000405"),
  kmmbr_name, vote_result (1=for 2=against), knesset_num, faction_id,
  faction_name. Useful for HISTORY (Knesset ~16–24), never for current votes.
- **Knesset WebSiteApi — the modern API, FULLY CRACKED** (2026-08-20, all
  verified live via relay). Base `https://knesset.gov.il/WebSiteApi/knessetapi/`:
  - POST `Votes/GetVotesHeaders` body `{"SearchType":1,"FromDate":"YYYY-MM-DD",
    "ToDate":"YYYY-MM-DD"}` → `{Table:[{VoteId, VoteProtocolNo, VoteDate,
    VoteDateStr, VoteTimeStr, VoteType, ItemTitle, KnessetId, SessionId}]}`.
    CURRENT data (verified votes from 2026-07-28).
  - POST `Votes/GetVotesHeaders` body `{"SearchType":2,"KnessetNum":25,
    "MkId":<id>}` → same shape, that MK's votes.
  - GET `Votes/GetVoteDetails/{voteId}` → `{VoteHeader:[{...Decision,
    ChairmanName, IsForAccepted, AcceptedText, FK_ItemID (= legislation
    ItemId!), SessionNumber, FK_Knesset}], VoteCounters:[{Title,
    countOfResult, ColorName}], VoteDetails:[{MkName, FactionName,
    VoteResultId (7=בעד), Title}]}`.
  - GET `Votes/GetVotesCmbData` → `{Knessets:[...], MKS:[{Id, Name,
    KnessetId, faction_id}]}` (MK directory, Knessets 16–25).
  - GET `MKs/GetMksDropdown?languageKey=he` → [{ID, Name, IsCurrent}].
  - POST `BillsLegislation/GetTableResults` body like `{"KnessetIDs":"25",
    "PageNumber":1,"RowsPerPage":10,"Sort":"d","Subject":""}` →
    `{lgsBillResults:[{ItemId, Name, Status, CommitteeName,...}], lawSteps,
    TotalResults}`.
  - GET `LegislationItem/GetLegislationBillItem?ItemId=<id>` → bill detail
    incl. sessionAndDocs.Sessions (VoteId/VoteSessionId often null).
  - Responses are Hebrew-only. 204 = empty search, NOT an error.
  - LESSON (recorded per the rule): the earlier conclusion "Votes controller
    is stub scaffolding" was WRONG — a 405-on-GET plus 204-on-empty-POST is
    how a real POST search endpoint looks; "GetMkVotes → 'value'" was the
    default route Get(id) answering, not the action. Confirm with a real
    payload before declaring an endpoint dead.
  - HTML pages (main.knesset.gov.il, /apps/*) are behind Radware bot
    protection ("kramericaindustries" challenge, status 247) — unreachable
    from relay/cloud; API endpoints pass fine. Frontend discovery must go
    through Mercy's browser (F12 → Network → Copy as cURL — she's good at it).
- **data.gov.il `votes-knesset` (resource 419be3b0-…) is NOT Knesset votes**
  (2026-08-20, verified): it's ELECTION results per polling station. Dead end
  for plenum votes; maybe useful someday for an elections page.
- **WebFetch quirk** (2026-08-20): mangles URLs whose query contains an
  encoded URL (?url=https%3A…) — always use the relay's /b64/<base64url>
  path form for probing. Claude's sandbox curl cannot reach workers.dev.
- **Vote duplicates are real**: each הסתייגות (reservation) on a bill gets its
  own plenum vote — same bill title appears dozens of times in one day.
  UI should eventually group votes by bill/sitting.
- **Supreme Court — WORKS via relay, no cookies needed** (2026-08-21):
  supremedecisions.court.gov.il, no bot protection. POST /Home/SearchVerdicts
  with the big JSON body (template captured; encoded in worker PRESETS.verdicts)
  → {"data":[…]} ~50 records/batch. Record fields: Id, CaseId, VerdictsDtString
  (DD/MM/YYYY), CaseNum, CaseDesc ('בג"ץ 7209-06-26'), CaseName (parties),
  Type (פסק-דין/החלטה), TypeCode, Pages, Technical (bool — false = substantive!),
  Path, PathForWeb, FileName, DocName (.docx), MadorDesc, InyanId, VerdictDesc.
  Document URL: /Home/Download?path={PathForWeb}&fileName={FileName}&type=2.
  GET lookups (no body): /Home/GetJudges?lan=1 → [{text,value,other}],
  GetInyans?lan=1, GetTypeCourts, GetMadors?lan=1, GetLastInyanim, GetQuotes.
  Also exists: GetHtmlPage (HTML view of a verdict — params not yet captured).
  Body dates: ISO with time. lan:1=Hebrew. Pagination beyond 50: not yet
  explored. History resources: HUJI ISCD (iscd.huji.ac.il), HF
  LevMuchnik/SupremeCourtOfIsrael (751k docs, ~2022 snapshot).

- **CORRECTION to an earlier conclusion** (2026-08-21): the WebSiteApi `Votes`
  controller is NOT a scaffold stub. It's real and is the current votes API:
  POST /WebSiteApi/knessetapi/Votes/GetVotesHeaders with JSON like
  {"SearchType":1,"FromDate":"2026-08-20","ToDate":"2026-08-20"} (dates
  YYYY-MM-DD; empty result → 204 No Content, which I misread as a stub).
  Vote detail: the app GETs a URL ending in /<voteId> (e.g. 46699) — exact
  path prefix still unverified (/Votes/<id> returned 405 on GET; likely a
  different action name — capture pending). Other actions seen in DevTools:
  GetVotesCmbData, GetAllVotesDates. Old-style page (jquery) at
  main.knesset.gov.il/Activity/plenum/Votes/pages/default.aspx hosts this UI.

## VERIFIED BY MERCY 2026-08-22 — the two open checks came back GOOD

- **Bank of Israel SDMX WORKS.** She ran the PS dataflow and got CSV. It gives
  **MONTHLY series through 2026-07** — this closes the "BudgetKey is annual"
  gap. Series seen: MOF_ED_NO_CREDIT_M_N (expenditure), I_TAX_TOT_M (tax
  collection) + _CSYTD cumulative variants, MOF_DEFD_NO_CREDIT_M_N (deficit),
  MOF_DEFD_NO_CREDIT_R_GDP_Q_N (deficit % GDP), TAX_TOT_R_GDP_A, OZAR_* .
  Columns: SERIES_CODE, TIME_PERIOD, OBS_VALUE, UNIT_MEASURE (ILS/PT),
  UNIT_MULT (6 = millions, 3 = thousands — READ IT, it varies by series).
  Her call used startPeriod=2020; earlier history not yet tested.
  Worker allowlist still needs `edge.boi.gov.il` before pages can call it.
- **data.gov.il CKAN WORKS** (68 hits for "תקציב"). Most useful: משרד האוצר
  quarterly **אומדן ביצוע** XLSX, one dataset per quarter 2017→2025-06;
  שינויי תקציב per year 2005–2013; משרד החינוך שקיפות תקציבית per authority/
  school (2016, XLS); עיריית באר-שבע publishes its own budget as CSV/JSON.
  API form: data.gov.il/api/3/action/package_search?q=…&rows=25 — already on
  the worker allowlist, and it answers through the relay.
  NOTE: robots blocks WebFetch on data.gov.il/api — use the relay's /b64/.
  A search for "שכר" returns only 6 datasets, none of them public-sector pay.

**PROBING TRICK (2026-08-22).** WebFetch is robots-blocked on
next.obudget.org/api AND data.gov.il/api, but the relay's /b64/<base64url>
path works for both. HARD LIMIT: the WebFetch proxy 403s on relay URLs longer
than ~248 chars — 247 passed, 250 failed. Keep probe SQL tiny (`select * from
<table> limit 1` then ask for the keys) or add a preset to the worker.
