# SOURCES.md — upstream APIs used by more than one page (as measured)

Single-page sources live in that page's NOTES.md (BudgetKey → budget_page,
court → court_page). Probing rules: root `CLAUDE.md`.

## Knesset — general
- Everything through the relay (no CORS; datacenter/bot fetches get 4xx;
  Workers pass). Responses Hebrew-only. 204 = empty result, not an error.
  A 405-on-GET + 204-on-empty-POST is a real POST endpoint — confirm with a
  real payload before declaring anything dead.
- main.knesset.gov.il HTML pages (LawBill.aspx, Vote.aspx, /apps/*) are behind
  Radware (status 247): unreachable, not linkable. Discovery = Mercy's DevTools.
  Files on fs.knesset.gov.il are public (200) — link them directly.
- Each הסתייגות gets its own plenum vote: one bill title can repeat dozens of
  times a day → group by bill + day.
- No coalition/opposition dataset anywhere (KNS_Faction has no flag; the
  register knows סיעות, not parties — a list can hold several parties, a
  סיעה can split mid-term). Finance Committee transfer requests: no OData entity.
- History: github.com/hasadna/knesset-data.

## OData `https://knesset.gov.il/Odata/ParliamentInfo.svc/` (add `$format=json`)
- Firewall answers 473 to `any()`/`all()` lambdas — don't retry; navigation
  paths in $filter/$expand/$select work. `$count` (also with a navigation
  filter) and `$inlinecount=allpages` work.
- KNS_Bill: BillID, Name, SubTypeID/Desc, StatusID, KnessetNum,
  LastUpdatedDate (filter with `datetime'…'`). KNS_Status: Hebrew partly
  garbled → match patterns, not ids; only 118 "התקבלה בקריאה שלישית" = passed.
- KNS_BillInitiator: caps pages at 100 whatever `$top` says → page with
  `$skip`. IsInitiator / Ordinal 1 = lead sponsor. Government bills have no
  initiators (empty is correct).
- KNS_PersonToPosition: PositionID, KnessetNum, Start/FinishDate,
  GovMinistryID/Name, DutyDesc, FactionID/Name, GovernmentNum,
  CommitteeID/Name, IsCurrent; back to Knesset 2. Role = DutyDesc, else
  KNS_Position.Description (gendered). Dirt: the same office under two
  gendered codes (45 and 39 = ראש הממשלה); a term split per Knesset and
  wherever GovernmentNum changed; open-ended rows for people long gone (an
  open row is not proof of serving); יושב–ראש with en dash or hyphen. Real
  short stints with gaps are the record, not noise. K25 = 554 rows.
- KNS_Person: FirstName/LastName (try both word orders); GenderID 251 זכר / 250 נקבה.
- KNS_DocumentBill: one row per file; GroupTypeDesc = stage; ApplicationDesc
  lies (the extension wins); FilePath has a doubled slash and spaces — normalize.
- KNS_PlmSessionItem.ItemID (+ItemTypeID: 1 שאילתה · 2 הצעת חוק · 3 אי אמון ·
  4 הצעה לסדר · 5 ישיבת מליאה · 12 ישיבת ועדה); for a bill ItemID = BillID.
- Also: KNS_Faction (FactionID, Name, KnessetNum, dates, IsCurrent) ·
  KNS_IsraelLaw · KNS_LawBinding.

## Votes.svc (old archive) — FROZEN at vote_id 34525, 2021-07-13, K24
- `View_vote_rslts_hdr_Approved`: vote_id, knesset_num, session_id,
  sess_item_id (= KNS_PlmSessionItem.ItemID → BillID), vote_item_id,
  sess_item_dscr, vote_item_dscr, vote_date, vote_time, is_accepted,
  total_for/against/abstain, session_num, reason.
- Per member: `vote_rslts_kmmbr_shadow` (NOT `_shpn`): vote_id, kmmbr_id
  ("000000405"), kmmbr_name, vote_result (1 for, 2 against), faction_id/name.

## WebSiteApi `https://knesset.gov.il/WebSiteApi/knessetapi/` (current)
- POST `Votes/GetVotesHeaders` `{"SearchType":1,"FromDate":"YYYY-MM-DD","ToDate":…}`
  → `{Table:[{VoteId, VoteProtocolNo, VoteDate, VoteDateStr, VoteTimeStr,
  VoteType, ItemTitle, KnessetId, SessionId}]}`; `{"SearchType":2,
  "KnessetNum":25,"MkId":N}` → one member's votes.
- GET `Votes/GetVoteDetails/{id}` → VoteHeader (Decision, ChairmanName,
  IsForAccepted, AcceptedText, FK_ItemID = BillID for a bill vote,
  SessionNumber, FK_Knesset) · VoteCounters (Title, countOfResult) ·
  VoteDetails (MkName, FactionName, VoteResultId 7=בעד, Title).
- GET `Votes/GetVotesCmbData` (big) → MKS [{Id, Name surname-first,
  KnessetId, faction_id}] K16–25 with duplicates · Factions [{ID,
  FactionName (trailing space, "בראשות …" suffixes), KnessetId}] · Knessets
  [{KnessetId, KnessetStart, KnessetEnd}]. Also `GetAllVotesDates`.
- GET `MKs/GetMksDropdown?languageKey=he` → [{ID, Name, IsCurrent}].
- GET `MKs/GetMkDetailsContent?mkId=N&languageKey=he` → DateOfBirth as text
  (`כ"ח בתשרי תש"י , 21/10/1949`), PlaceOfBirth, Education… with HTML
  entities, `\n`, "- " bullets; `Content` = free HTML (never inject).
- POST `BillsLegislation/GetTableResults` `{"KnessetIDs":"25","PageNumber":1,
  "RowsPerPage":10,"Sort":"d","Subject":""}` → `{lgsBillResults:[{ItemId,
  Name, Status, CommitteeName…}], lawSteps, TotalResults}`.
- GET `LegislationItem/GetLegislationBillItem?ItemId=` → bill detail incl.
  sessionAndDocs.Sessions (VoteId often null).
