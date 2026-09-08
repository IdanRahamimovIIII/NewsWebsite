"use strict";
/* =====================================================================
   Our Money — ספקים והתקשרויות: EVERY WORD THE PAGE SAYS.
   Change wording here; no logic lives in this file.
   {name} placeholders are filled in from the live data — never hard-code a
   number in a sentence, it goes stale the moment the data changes.
   ===================================================================== */

window.PAGE = "budget";   /* this page is part of the budget section — the
                             main nav keeps התקציב lit; the subnav moves you
                             between the section's two pages */

window.PAGE_STR = {
  he: {
    tagline: "ספקים והתקשרויות — מי מקבל כסף מהמדינה",
    subBudget: "התקציב",
    subSuppliers: "ספקים והתקשרויות",
    year: "שנה:",
    yearNote: "כל המספרים בעמוד עוקבים אחרי השנה שנבחרה.",
    close: "סגירה",
    info: "הסבר",

    /* ---- the opening numbers ---- */
    tilesTitle: "כמה מהרכש עובר בלי תחרות?",
    tilesHint: "התקשרויות שהיו בתוקף ב-{y}, לפי מה שהמשרדים עצמם רשמו בדוחות.",
    tTotal: "היקף ההתקשרויות שבתוקף",
    tTotalCtx: "{n} התקשרויות פעילות",
    tExempt: "מזה בפטור ממכרז",
    tExemptCtx: "{p} מכל שקל שהמדינה התחייבה לו",
    tConc: "בידי עשרת הספקים הגדולים",
    tConcCtx: "{p} מכלל ההיקף — מתוך {n} ספקים",
    askTotal: "מה נספר כאן?",
    askExempt: "מה זה פטור ממכרז?",
    askConc: "איך זה מחושב?",
    ansTotal: "השווי הכולל של כל ההתקשרויות שהיו בתוקף ב-{y}, לכל אורך חייהן — לא מה ששולם באותה שנה. היקף אינו תשלום: הוא מה שהמדינה התחייבה לו, לעיתים לאורך שנים רבות. ב-{y} מדובר ב-{v}, ב-{n} התקשרויות.",
    ansExempt: "הכלל הוא מכרז פומבי: חוק חובת המכרזים קובע שגוף ציבורי לא יתקשר בחוזה אלא במכרז, כדי שלכל אדם תהיה הזדמנות שווה להשתתף. החוק מאפשר לקבוע בתקנות סוגי התקשרויות הפטורות מכך. פטור אינו מעיד על פסול: זו דרך חוקית ומתועדת. משמעותו היא שאף גורם אחר לא התמודד על העבודה. הסכום כאן סופר את ההתקשרויות שבדוח שלהן נרשם ״פטור ממכרז״ — ב-{y}: {v}, שהם {p} מכלל ההיקף שבתוקף.",
    ansExemptSrc: "חוק חובת המכרזים, התשנ״ב-1992, סעיפים 2 ו-4.",
    ansConc: "סכום ההיקפים של עשרת הספקים עם ההתקשרויות הגדולות ביותר שבתוקף ב-{y}, חלקי ההיקף הכולל של כל ההתקשרויות שבתוקף באותה שנה. עשרה ספקים — {p} מהכסף.",

    /* ---- the top suppliers of a year ---- */
    topTitle: "מי מקבל הכי הרבה?",
    viewAll: "כל ההתקשרויות",
    viewExempt: "בפטור ממכרז בלבד",
    topHintExempt: "אותו דירוג, רק ההתקשרויות שבדוח שלהן נרשם ״פטור ממכרז״ — מי מקבל הכי הרבה כשאף אחד אחר לא התמודד על העבודה.",
    topGapSome: "אצל {n} מתוך {of} הספקים שברשימה לא מופיע במקור ולו תשלום אחד שדווח.",
    topGapOne: "אצל ספק אחד מתוך {of} שברשימה לא מופיע במקור ולו תשלום אחד שדווח.",
    topHint: "מי עמד מול המדינה בהתקשרויות הגדולות ביותר שהיו בתוקף ב-{y}. הדירוג הוא לפי ההיקף הכולל של ההתקשרות לכל אורכה — לא לפי מה ששולם באותה שנה: היקף אינו תשלום, הוא מה שהמדינה התחייבה לו, לעיתים לאורך שנים רבות.",
    topRecent: "שימו לב: המשרדים מדווחים באיחור, ולכן שנים קרובות להווה מציגות תמונה חלקית.",
    colContracts: "התקשרויות",
    colVolume: "היקף סה״כ (₪)",
    colPaidToDate: "שולם עד היום (₪)",
    topNote: "מקור: דוחות ההתקשרויות של המשרדים, דרך מפתח התקציב (obudget.org). משרד הביטחון אינו מפרסם את ספר ההתקשרויות שלו, ולכן אינו יכול להופיע כאן.",
    topEmpty: "אין נתונים לשנה הזו.",

    /* ---- which exemption routes carry the big money ---- */
    exTitle: "באילו פטורים נעשה שימוש?",
    exHint: "התקנות שמכוחן נחתמו ההתקשרויות הפטורות ממכרז שהיו בתוקף ב-{y}, לפי הכסף שעליו הן חלות. נוסח התקנה מופיע כפי שנרשם בדוח.",
    exNote: "התקשרות יכולה לציין יותר מתקנה אחת — במקרה כזה הצירוף מוצג כפי שדווח. רשומות שאינן מציינות תקנה אינן מוצגות.",
    colRegulation: "התקנה",

    /* ---- the ministry that is not here ---- */
    defTitle: "ומשרד הביטחון?",
    defBody: "למשרד הביטחון יש כמובן התקשרויות וספקים — אבל הוא אינו מפרסם את ספר ההתקשרויות שלו בדוחות הרבעוניים שמפרסמים שאר המשרדים: הרכש הביטחוני פועל לפי תקנות פטור נפרדות, וחלק מהתקציב מסווג. הוא נעדר מכל רשימה בעמוד הזה לא כי אין לו התקשרויות — אלא כי הן אינן ציבוריות.",

    volInfoT: "היקף סה״כ (₪)",
    volInfoB: "השווי הכולל של כל ההתקשרויות שהיו בתוקף בשנה שנבחרה, לכל אורך חייהן — לא הסכום של אותה שנה. התקשרות שנמשכת עשר שנים נספרת כאן במלואה בכל אחת משנותיה. היקף אינו תשלום: הוא מה שהמדינה התחייבה לו.",
    paidInfoT: "שולם עד היום (₪)",
    paidInfoB: "הסכום ששולם בפועל מאז תחילת ההתקשרות, כפי שנרשם ב״מפתח התקציב״. בדוחות שפורסמו מ-2024 ואילך הנתון הזה חסר פעמים רבות במקור, ולכן הסכום האמיתי יכול להיות גבוה מהמוצג. בעמוד התקציב, מתחת לכל סעיף, מוצג נתון מלא יותר — שם אנחנו משלימים את החסר מהקבצים שהמשרדים עצמם פרסמו.",

    /* ---- the search ---- */
    searchTitle: "חיפוש התקשרויות וספקים",
    searchHint: "חפשו שם ספק או מילה מתיאור ההתקשרות (למשל: פרסום, יועצים, אל על). לחיצה על שם ספק פותחת את כל ההתקשרויות שלו.",
    searchPh: "לדוגמה: יועצים",
    colSupplier: "ספק", colPurpose: "מטרה", colOffice: "משרד", colYears: "שנים",
    colPaid: "שולם (₪)",
    searchEmpty: "לא נמצאו תוצאות.",

    /* ---- one supplier, in full ---- */
    supClose: "סגירת הפרופיל",
    factContracts: "התקשרויות רשומות",
    factVolume: "היקף סה״כ",
    factPaid: "שולם עד היום",
    factYears: "דווח בשנים",
    byOfficeTitle: "מאילו משרדים מגיע הכסף",
    sparkTitle: "היקף ההתקשרויות שבתוקף, שנה אחר שנה",
    sparkNote: "כל התקשרות נספרת, במלוא היקפה, בכל שנה שבה היא בתוקף — אותה הגדרה כמו בשאר העמוד. שנים המסומנות בקווקוו מדווחות עדיין חלקית, ולכן עשויות להיראות נמוכות מכפי שיתבררו.",
    bigTitle: "ההתקשרויות הגדולות ביותר",
    supMore: "מוצגות {n} הגדולות בלבד, מתוך {of}.",
    supEmpty: "לא מצאנו התקשרויות רשומות לספק הזה.",
    colMethod: "אופן הרכישה",
    whyExempt: "מדוע פטור?",
    pubTitle: "הפרסום במרשם הפטורים",
    pubReason: "הנימוק",
    pubRegulation: "התקנה",
    pubDecision: "החלטה",
    pubLink: "לפרסום המלא במרשם",
    pubSrc: "מרשם המכרזים והפטורים, mr.gov.il — כפי שפורסם. הכפתור מופיע רק בהתקשרויות שנקשרו לפרסום במרשם.",

    /* what kind of body a supplier is — the register's own categories */
    entityCompany: "חברה", entityAssoc: "עמותה", entityMuni: "רשות מקומית",
    entityGov: "גוף ממשלתי", entityUni: "אוניברסיטה", entityCoop: "אגודה שיתופית",
    entityPartner: "שותפות", entityLawOrg: "תאגיד סטטוטורי",
    entityOttoman: "אגודה עות׳מאנית", entityHealth: "קופת חולים",
    entityForeign: "חברה זרה",

    /* ---- explainer ---- */
    explainTitle: "איך לקרוא את המספרים?",
    explain1: "״היקף״ הוא השווי הכולל של ההתקשרות לכל אורכה — מה שהמדינה התחייבה לו, לא מה ששולם. ״שולם״ הוא מה שדווח כמשולם בפועל עד היום. שני המספרים יכולים להיות רחוקים זה מזה: חוזה גדול יכול להתחיל בקטן, ולהיפך.",
    explain2: "הנתונים מגיעים מדוחות ההתקשרויות שמשרדי הממשלה מפרסמים אחת לרבעון, כפי שהם נאספים בבסיס הנתונים הפתוח של ״מפתח התקציב״. הדיווח אינו שלם: ככל שמתקרבים להווה הוא דליל יותר, ומשרד הביטחון אינו מפרסם את התקשרויותיו כלל — הרכש הביטחוני פועל לפי תקנות פטור נפרדות וחלק מהתקציב מסווג.",
    explain3: "טעות במספרים? בעמוד התקציב, מתחת לכל סעיף, מוצגות ההתקשרויות מתוך מאגר שבנינו מכמה מקורות מוצלבים — שם כל התקשרות מציינת את מקורותיה. העמוד הזה קורא ישירות מ״מפתח התקציב״, ולכן משקף גם את מגבלותיו.",

    errBusy: "מסד הנתונים של ״מפתח התקציב״ עמוס כרגע — זו תקלה זמנית אצלם. נסו לרענן בעוד כמה דקות.",
    bn: " מיליארד ₪", mn: " מיליון ₪",
  },

  en: {
    tagline: "Suppliers & contracts — who receives the state's money",
    subBudget: "The budget",
    subSuppliers: "Suppliers & contracts",
    year: "Year:",
    yearNote: "Every number on this page follows the chosen year.",
    close: "Close",
    info: "explain",

    tilesTitle: "How much is bought without competition?",
    tilesHint: "Contracts in force during {y}, by what the ministries themselves recorded in their reports.",
    tTotal: "Contracts in force",
    tTotalCtx: "{n} active contracts",
    tExempt: "Of which, exempt from tender",
    tExemptCtx: "{p} of every shekel the state committed to",
    tConc: "Held by the 10 largest suppliers",
    tConcCtx: "{p} of the whole volume — out of {n} suppliers",
    askTotal: "What is counted here?",
    askExempt: "What is a tender exemption?",
    askConc: "How is this computed?",
    ansTotal: "The total value of every contract in force during {y}, over its whole life — not what was paid that year. Volume is not payment: it is what the state committed to, sometimes over many years. In {y} that is {v}, across {n} contracts.",
    ansExempt: "A public tender is the rule: the Mandatory Tenders Law requires a public body to contract only through a tender, so that everyone has an equal opportunity to compete. The law allows regulations to define categories of contract that are exempt. An exemption is not evidence of wrongdoing: it is a lawful, documented route. What it does mean is that nobody else got to compete for the work. The figure counts the contracts whose report records “פטור ממכרז” — in {y}: {v}, which is {p} of all volume in force.",
    ansExemptSrc: "Mandatory Tenders Law, 1992, sections 2 and 4.",
    ansConc: "The combined volume of the 10 suppliers with the largest contracts in force during {y}, divided by the total volume of all contracts in force that year. Ten suppliers — {p} of the money.",

    topTitle: "Who receives the most?",
    viewAll: "All contracts",
    viewExempt: "Exempt from tender only",
    topHintExempt: "The same ranking, restricted to contracts whose report records “פטור ממכרז” — who receives the most when nobody else competed for the work.",
    topGapSome: "For {n} of the {of} suppliers listed, the source records not a single reported payment.",
    topGapOne: "For one of the {of} suppliers listed, the source records not a single reported payment.",
    topHint: "Who faced the state in the largest contracts in force during {y}. Ranked by the contract's total value over its whole life — not by what was paid that year: volume is not payment, it is what the state committed to, sometimes over many years.",
    topRecent: "Note: ministries report late, so years close to the present show a partial picture.",
    colContracts: "Contracts",
    colVolume: "Total volume (₪)",
    colPaidToDate: "Paid to date (₪)",
    topNote: "Source: the ministries' procurement reports, via BudgetKey (obudget.org). The Ministry of Defense does not publish its contract book, so it cannot appear here.",
    topEmpty: "No data for this year.",

    exTitle: "Which exemptions are used?",
    exHint: "The regulations under which the tender-exempt contracts in force during {y} were signed, by the money riding on them. Each regulation appears as recorded in the report.",
    exNote: "A contract can cite more than one regulation — such combinations are shown as reported. Records citing no regulation are not shown.",
    colRegulation: "Regulation",

    defTitle: "And the Ministry of Defense?",
    defBody: "The Ministry of Defense certainly has contracts and suppliers — but it does not publish its contract book in the quarterly reports the other ministries publish: defense procurement runs under separate exemption regulations, and part of the budget is classified. It is absent from every list on this page not because it has no contracts — but because they are not public.",

    volInfoT: "Total volume (₪)",
    volInfoB: "The total value of every contract in force during the chosen year, over its whole life — not that year's figure. A ten-year contract counts here in full in each of its years. Volume is not payment: it is what the state committed to.",
    paidInfoT: "Paid to date (₪)",
    paidInfoB: "What was actually paid since the contract began, as recorded in BudgetKey. In reports published from 2024 on this figure is often missing at the source, so the real amount can be higher than shown. The budget page shows a fuller figure under each budget line — there we fill the gap from the files the ministries themselves published.",

    searchTitle: "Search contracts & suppliers",
    searchHint: "Search a supplier name or a word from the contract description (try Hebrew terms — the data is in Hebrew). Clicking a supplier's name opens all their contracts.",
    searchPh: "e.g. יועצים (consultants)",
    colSupplier: "Supplier", colPurpose: "Purpose", colOffice: "Ministry", colYears: "Years",
    colPaid: "Paid (₪)",
    searchEmpty: "No results found.",

    supClose: "Close profile",
    factContracts: "Recorded contracts",
    factVolume: "Total volume",
    factPaid: "Paid to date",
    factYears: "Reported in",
    byOfficeTitle: "Which ministries the money comes from",
    sparkTitle: "Volume of contracts in force, year by year",
    sparkNote: "Every contract counts, in full, in each year it is in force — the same definition as the rest of the page. Hatched years are still partially reported, so they may look lower than they will turn out to be.",
    bigTitle: "The largest contracts",
    supMore: "Showing the {n} largest only, out of {of}.",
    supEmpty: "We found no recorded contracts for this supplier.",
    colMethod: "How it was bought",
    whyExempt: "Why exempt?",
    pubTitle: "The exemptions-register publication",
    pubReason: "Reason",
    pubRegulation: "Regulation",
    pubDecision: "Decision",
    pubLink: "The full publication in the register",
    pubSrc: "The tenders & exemptions register, mr.gov.il — as published. The button appears only on contracts linked to a register publication.",

    entityCompany: "company", entityAssoc: "non-profit", entityMuni: "local authority",
    entityGov: "government body", entityUni: "university", entityCoop: "cooperative",
    entityPartner: "partnership", entityLawOrg: "statutory corporation",
    entityOttoman: "Ottoman association", entityHealth: "health fund",
    entityForeign: "foreign company",

    explainTitle: "How to read the numbers",
    explain1: "“Volume” is the contract's total value over its whole life — what the state committed to, not what was paid. “Paid” is what has been reported as actually paid so far. The two can be far apart: a big contract can start small, and the reverse.",
    explain2: "The data comes from the procurement reports government ministries publish every quarter, as collected in the open BudgetKey database. The reporting is incomplete: it thins out as you approach the present, and the Ministry of Defense publishes no contracts at all — defense procurement runs under separate exemption regulations, and part of the budget is classified.",
    explain3: "Spotted an error? On the budget page, under each budget line, contracts come from a database we built from several cross-checked sources — each contract there lists its sources. This page reads directly from BudgetKey, so it reflects its limits too.",

    errBusy: "The BudgetKey database is overloaded right now — a temporary issue on their side. Try refreshing in a few minutes.",
    bn: "B ₪", mn: "M ₪",
  },
};
