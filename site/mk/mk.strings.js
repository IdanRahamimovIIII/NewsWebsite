/* mk.strings.js — every word the Knesset-members page says, Hebrew and English.
   Safe to edit wording here without touching any logic. Keys are grouped the
   way the page is: the search card → the directory cards → the hero → the
   three sections (positions, bills, votes). Keep `he` and `en` in the same
   order so a missing key is easy to spot. */
window.PAGE = "mk";
window.PAGE_STR = {
  he: {
    tagline: "מי האנשים שמצביעים בשמכם — ומה הם עשו עם זה",

    /* the search card */
    pageTitle: "תיק חבר/ת כנסת",
    pageHint: "חפשו לפי שם, תפקיד או סיעה — גם מכנסות קודמות — וראו מה הגישו, איך הצביעו ואילו תפקידים מילאו.",
    searchMkPh: "שם, תפקיד או סיעה — למשל \"שר החוץ\" או \"יש עתיד\"…",
    noneFound: "לא נמצא חבר/ת כנסת בשם הזה. נסו שם משפחה בלבד.",

    /* the directory cards + the infinite scroll */
    dirTitle: "חברי הכנסת הנוכחית",
    dirHint: "לחצו על כרטיס כדי לפתוח את התיק המלא. אפשר לחפש למעלה כל שם מכל כנסת.",
    dirLoadingMore: "טוען עוד חברי כנסת…",
    dirEnd: "זה הכל — המאגר הממוחשב מכסה מהכנסת ה-16 (2003) ואילך.",
    dirPassed: "{n} חוקים שעברו",
    dirPassed1: "חוק אחד שעבר",
    posMember: "חבר/ת הכנסת",     /* a card with no role of substance today; also the timeline's fallback role */
    untilNow: "היום",

    /* the hero: portrait · name · role · one story line · the bills sentence · background facts */
    backToDir: "→ חזרה לרשימה",
    tenureSince: "בכנסת מאז {y}",
    tenureYears: "({n} שנה)",
    tenureSpan: "בכנסת {a}–{b}",
    /* "סיעה" is a taught term — this tooltip sits on the faction name in the hero and on the cards' party line */
    factionTip: "סיעה: הקבוצה שאליה משתייך/ת חבר/ת הכנסת בתוך הכנסת. לא תמיד זהה למפלגה — רשימה אחת יכולה לאגד כמה מפלגות, וסיעה יכולה להתפצל.",
    billsStory: "{t} הצעות חוק — {p} הפכו לחוק",
    billsStory1: "{t} הצעות חוק — אחת הפכה לחוק",
    billsStory0: "{t} הצעות חוק — אף אחת לא הפכה לחוק (עדיין)",
    factBorn: "לידה", factDied: "פטירה", factAliyah: "עלייה", factHome: "מגורים",
    factEdu: "השכלה", factArmy: "צבא", factNat: "שירות לאומי", factProf: "מקצוע", factLangs: "שפות",

    /* positions — the section titles are the reader's questions (Mercy) */
    secPositions: "מה עשו לאורך השנים?",
    posNow: "מכהנ/ת",
    posKnesset: "כנסת",
    posNoData: "לא נמצאו תפקידים רשומים.",
    posShowAll: "הצג את כל התפקידים ▾",
    posHideSome: "הצג פחות ▴",

    /* bills: four piles, one on screen at a time, a name search inside it */
    secBills: "מה ניסו להעביר?",
    bPassed: "עברו",
    bRejected: "נפלו",
    bPending: "בתהליך",        /* of THIS Knesset, no verdict yet */
    bUnfinished: "לא הושלמו לפני הבחירות",   /* of an earlier Knesset: it ended (elections) before the final vote (Mercy: plain words, same name as the data) */
    bStoppedAt: "הגיעה עד שלב: ",
    /* what each pile means — on hover, in the hero counts and on the check-circles */
    tipPassed: "הצעות שאושרו בקריאה שלישית והפכו לחוק.",
    tipRejected: "הצעות שהכנסת דחתה, הסירה מסדר היום או עצרה.",
    tipPending: "הצעות מהכנסת הנוכחית שעדיין לא הוכרעו — יכולות עוד לעבור.",
    tipUnfinished: "הצעות מכנסות קודמות שלא הגיעו להצבעה הסופית לפני הבחירות. כשכנסת מסתיימת, הצעה שלא הושלמה נעצרת — ואפשר להגיש אותה מחדש בכנסת הבאה.",
    bNoBills: "לא נמצאו הצעות חוק על שמם.",
    bNoMatch: "אין הצעות חוק שמתאימות לסינון.",
    bSearchPh: "חיפוש הצעת חוק לפי שם…",
    bLead: "יוזמ/ת ראשי/ת",
    bMore: "עוד {n} הצעות ▾",
    /* the official documents behind a bill (and behind a vote on a bill) */
    docsTitle: "המסמכים הרשמיים (אתר הכנסת)",
    docsNone: "לא נמצאו מסמכים במרשם הכנסת.",
    docsFail: "מרשם המסמכים לא ענה — נסו שוב.",

    /* votes */
    secVotes: "איך הצביעו?",
    vCount: "{n} הצבעות במליאה בכנסת ה-{k}",
    vKnesset: "כנסת {n}",
    vNoVotes: "אין נתוני הצבעות לכנסת הזו.",
    vNoMatch: "אין הצבעות שמתאימות לחיפוש.",
    vSearchPh: "חיפוש הצבעה לפי נושא…",
    vNoVotesAtAll: "אין נתוני הצבעות זמינים — המאגר הממוחשב מכסה מהכנסת ה-16 (2003) ואילך.",
    votedL: "הצביע/ה",
    decisionL: "ההחלטה",
    forL: "בעד", againstL: "נגד", abstainL: "נמנע/ה", noVoteL: "לא הצביע/ה",
    passedYes: "✔ התקבלה", passedNo: "✘ לא התקבלה",
    prevPage: "→ לעמוד הקודם",
    nextPage: "לעמוד הבא ←",
    pageN: "עמוד {n}",
    knesset: "כנסת",
    sessionNo: "ישיבה",
    votesInGroup: "הצבעות",

    /* the entity address /mk/<id>-<name>/ — the pages worker (worker\pages.js)
       bakes these via mk.i18n.json (written by scripts/bake_i18n.mjs) */
    entityTitle: "{name} — תיק חבר/ת כנסת | הכסף שלנו",
    entityDesc: "תפקידים, הצעות חוק והצבעות — מנתונים רשמיים של הכנסת.",
    entityNotFound: "לא מצאנו חבר/ת כנסת בכתובת הזו.",
    entityToList: "לרשימת חברי הכנסת",
    tenureGov: "בממשלה מאז {y} (לא בכנסת)",

    /* no longer in index.html (the bio card and the four hint lines under the
       section titles) — kept so a browser holding a cached older index.html
       never shows a raw key. Safe to delete after a few weeks. */
    secBio: "רקע אישי",
    bioHint: "כפי שנמסר לכנסת ומפורסם באתר הרשמי.",
    posHint: "כל תפקיד רשמי — שר/ה, יו״ר ועדה, חבר/ת ועדה, סיעה — מתוך מרשם הכנסת.",
    billsHint: "כל הצעה שהם חתומים עליה — כולל אלה שנפלו. דווקא ההצעות שנדחו מספרות את הסיפור.",
    votesHint: "באילו הצבעות במליאה הם השתתפו, ומה הם הצביעו. לחצו על הצבעה לפרטים.",
  },
  en: {
    tagline: "The people who vote in your name — and what they did with it",

    pageTitle: "Knesset member portfolio",
    pageHint: "Search by name, role or faction — past Knessets included — and see what they proposed, how they voted, and which positions they held.",
    searchMkPh: "Name, role or faction (Hebrew) — e.g. \"שר החוץ\" or \"יש עתיד\"…",
    noneFound: "No Knesset member found by that name. Try the surname alone.",

    dirTitle: "Members of the current Knesset",
    dirHint: "Click a card to open the full portfolio. The search above covers every Knesset.",
    dirLoadingMore: "Loading more members…",
    dirEnd: "That's all — the digital record covers the 16th Knesset (2003) onward.",
    dirPassed: "{n} laws passed",
    dirPassed1: "1 law passed",
    posMember: "Member of Knesset",
    untilNow: "today",

    backToDir: "→ Back to the list",
    tenureSince: "In the Knesset since {y}",
    tenureYears: "({n} years)",
    tenureSpan: "In the Knesset {a}–{b}",
    factionTip: "Faction: the group a member belongs to inside the Knesset. Not always a party — one list can bundle several parties, and a faction can split.",
    billsStory: "{t} bills — {p} became law",
    billsStory1: "{t} bills — one became law",
    billsStory0: "{t} bills — none became law (yet)",
    factBorn: "Born", factDied: "Died", factAliyah: "Immigrated", factHome: "Lives in",
    factEdu: "Education", factArmy: "Army", factNat: "National service", factProf: "Profession", factLangs: "Languages",

    secPositions: "What did they do over the years?",
    posNow: "current",
    posKnesset: "Knesset",
    posNoData: "No recorded positions found.",
    posShowAll: "Show all positions ▾",
    posHideSome: "Show fewer ▴",

    secBills: "What did they try to pass?",
    bPassed: "Passed",
    bRejected: "Rejected",
    bPending: "In process",
    bUnfinished: "Unfinished at the election",
    bStoppedAt: "got as far as: ",
    tipPassed: "Bills approved in the third reading — they became law.",
    tipRejected: "Bills the Knesset voted down, removed from the agenda, or stopped.",
    tipPending: "Bills of the current Knesset with no verdict yet — they can still pass.",
    tipUnfinished: "Bills of earlier Knessets that did not reach their final vote before the election. When a Knesset ends, an unfinished bill stops — it can be filed again in the next Knesset.",
    bNoBills: "No bills found under their name.",
    bNoMatch: "No bills match the filter.",
    bSearchPh: "Search bills by name…",
    bLead: "lead sponsor",
    bMore: "{n} more bills ▾",
    docsTitle: "Official documents (Knesset site)",
    docsNone: "No documents in the Knesset register.",
    docsFail: "The document register did not answer — try again.",

    secVotes: "How did they vote?",
    vCount: "{n} plenum votes in Knesset {k}",
    vKnesset: "Knesset {n}",
    vNoVotes: "No vote data for this Knesset.",
    vNoMatch: "No votes match the search.",
    vSearchPh: "Search votes by subject…",
    vNoVotesAtAll: "No vote data available — the digital record covers the 16th Knesset (2003) onward.",
    votedL: "Voted",
    decisionL: "Decision",
    forL: "For", againstL: "Against", abstainL: "Abstained", noVoteL: "Did not vote",
    passedYes: "✔ Passed", passedNo: "✘ Not passed",
    prevPage: "← Previous page",
    nextPage: "Next page →",
    pageN: "Page {n}",
    knesset: "Knesset",
    sessionNo: "sitting",
    votesInGroup: "votes",

    entityTitle: "{name} — Knesset member portfolio | Our Money",
    entityDesc: "Positions, bills and votes — from official Knesset data.",
    entityNotFound: "We couldn't find a Knesset member at this address.",
    entityToList: "All Knesset members",
    tenureGov: "in government since {y} (not an MK)",

    secBio: "Personal background",
    bioHint: "As reported to the Knesset and published on its official site.",
    posHint: "Every official role — minister, committee chair, committee member, faction — from the Knesset's own register.",
    billsHint: "Every bill bearing their name — including the ones that fell. The rejected ones tell the story.",
    votesHint: "Which plenum votes they took part in, and how they voted. Click a vote for details.",
  }
};
