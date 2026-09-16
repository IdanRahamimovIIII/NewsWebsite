# NOTES — Supreme Court page (site\court_page\)

`index.html` only: shell, `<style>`, `window.PAGE = "court"` + PAGE_STR and
the script inline. Data: `preset("verdicts", {…})` (relay `/preset/verdicts`)
or the `/data/verdicts` snapshot (last 90 days, capped 50). Documents link to
the court's own download URL — never re-hosted. No Playwright test yet;
`tools\qa.html` checks the snapshot live.

## The API — supremedecisions.court.gov.il (via relay, no cookies, no bot wall)
- POST `/Home/SearchVerdicts` with the big JSON body (template in worker
  PRESETS.verdicts; dates ISO with time; lan:1 = Hebrew) → `{"data":[…]}`,
  ~50 per batch. Fields: Id, CaseId, VerdictsDtString (DD/MM/YYYY), CaseNum,
  CaseDesc ('בג"ץ 7209-06-26'), CaseName (parties), Type (פסק-דין/החלטה),
  TypeCode, Pages, Technical (false = substantive), Path, PathForWeb,
  FileName, DocName (.docx), MadorDesc, InyanId, VerdictDesc.
- Document: `/Home/Download?path={PathForWeb}&fileName={FileName}&type=2`.
- GET lookups: `/Home/GetJudges?lan=1` → [{text,value,other}], GetInyans,
  GetTypeCourts, GetMadors, GetLastInyanim, GetQuotes. GetHtmlPage (HTML
  view of a ruling) exists — params not captured.
- History: HUJI ISCD (iscd.huji.ac.il); HF LevMuchnik/SupremeCourtOfIsrael
  (751k docs, ~2022).

## Open
- Pagination past 50 (unexplored) · judge filter (GetJudges ready) · read
  rulings in-site (capture GetHtmlPage) · פסיקה נבחרת filter.
- Plain-language ruling summaries.
