# NOTES — btl\ (נתוני ביטוח לאומי)

Two collections live here: the bulletin's unemployment chapter (below) and the
legal average wage page.

## avgwage — שכר ממוצע לפי חוק (fetch_avgwage.py)
Source: btl.gov.il נתונים כלליים page (HTML, SharePoint). s1/s2 of the law ×
benefits/contributions, current + history 1999→. Monthly via workflow
update-avgwage.yml (CI secrets CF_API_TOKEN/CF_ACCOUNT_ID) or publish-avgwage.bat
(d1-config.json). Publishes KV `pub:avgwage` → relay serves `/data/avgwage`
automatically (servePublished) — no worker change. Parse = tag-strip + tokenizer
(date + 8 cells, "--" = null); sanity gates refuse a redesigned page.
No raw archive anywhere — raw\ is a working copy, safe to delete (Mercy).
Story in the data: the freezes (2002-05, 2020-22, and 2025 contributions-only
= a quiet tax raise; benefits and contributions columns diverge only then).

## Chapter 15 (אבטלה) of the monthly statistical bulletin
Chapter page: btl.gov.il/Publications/quarterly/unemployment/Pages/default.aspx
Files: `…/Rivon%20Statisti/EXCELL/O15<01-05>.XLS` — O<chapter><table>; the whole
bulletin (22 chapters) follows this pattern, so more chapters = more rows in FILES.
btl.gov.il is NOT in the relay ALLOWED() — collection fetches direct (her PC /
GitHub workflow); the site page will read a published snapshot, not BTL live.

## The files (binary .xls, BIFF/OLE2 — xlrd territory, NOT openpyxl)
Rolling files: same URL, history + newest month appended. ~2-month lag
(July 2026 present in mid-Sept 2026). Update ≈ monthly.
- 15.1 = O1501.XLS — תשלומי גמלאות (אלפי ₪), annual 2010→ ; "סך הכול" > "תשלומי
  גמלאות" (includes funds, legal aid, labor court, research, employment-service share).
- 15.2 = O1502.XLS — מקבלים by רמת שכר ערב האבטלה (persons), 1991→.
- 15.3 = O1503.XLS — דמי אבטלה ממוצעים ליום (₪, weighted avg), 1993→, 3 blocks:
  current / 2025 prices / % of avg daily wage.
- 15.4 = O1504.XLS — מקבלים by group (נשים, גברים, עולים, <35, חיילים משוחררים, הכשרה), 1991→.
- 15.5 = O1505.xls (lowercase ext!) — מענק עבודה מועדפת: recipients, avg grant
  (monthly avg since 2019), totals, 1994→.

## Traps (armed in the live data — fixtures must have all of them)
- Sheet layout: title rows → multi-row merged headers → annual rows (year in col A)
  → per-year monthly blocks (Roman numeral month in col B, year from preceding
  bare-year row like `[2026]`) → footnote rows at bottom (small int in col A).
- Header typo at source: `תקןפה` (not תקופה) in 15.2/15.4 — never match the correct spelling only.
- `..` = no data / not yet computed. Constant-price cols equal current in base year.
- 15.1: 2020 excludes the extra corona grant (their footnote 2).
- SOURCE BUG, unresolvable: 15.2 rows 1991–1993 duplicate 15.4's group values.
  PDF twin is no help — 1992/1993 absent there, 1991 shows the same values.
  (Mercy) Keep the points but the site marks them as suspected-wrong for readers.
- Prices are "מחירי 2025" this edition — the base year WILL move; parser must read
  it from the header, not hardcode.
- Recipients counted "לפי חודש האבטלה" (דברי הסבר): late claims join their month
  retroactively → recent months are preliminary and revised UP between editions;
  we keep no old editions (Mercy) — the site shows the current numbers, period.
  Annual row ≠ plain mean of the shown months (2025: 92,600 vs ~84,266) —
  formula unstated; site labels it loosely.
- June 2025 spike in recipients (80K→186K→91K) = the Iran war (עם כלביא) — story, not error.
- "השכר הממוצע": three siblings exist — CBS statistical avg, legal avg per BTL law
  (13,566/13,769 ₪ from 1.1.2026; btl.gov.il נתונים כלליים; frozen 2002-05 and
  2020-22 by legislation), and הסכום הבסיסי (replaced it for benefits since 2006).
  Which one 15.2's bands use — confirm in the bulletin's מבוא before the page defines it.

## Open
- Green run of fetch-btl.bat (Mercy) → then add btl\ row to pipeline\shared\CLAUDE.md map.
- (Mercy) The site ignores inflation entirely — current prices only, and no
  inflation caption/mention anywhere. Parser still keeps the constant-price
  columns in the snapshot, so this stays a display-only decision.
- Parse step (xlrd) + publish decision: raw stays 5 files; published snapshot shape TBD (Mercy).
- Snapshot format needs a per-datapoint flag mechanism (first use: 15.2 1991–93 suspected-wrong).
- 15.5: the grant goes to the SOLDIER, not employers — no company list exists.
  Indirect beneficiaries = the sectors listed in law (link the list on the page).
  Check BTL annual review for a per-branch breakdown of grant recipients (Mercy wants).
