/* ==========================================================================
   Our Money — site configuration  |  הגדרות האתר
   ==========================================================================
   PROXY_URL: the address of your Cloudflare Worker data relay.
   Needed for the Knesset data (votes_page, mk_page) — the Knesset API blocks direct
   browser access from other sites. See README.md for the 5-minute setup.

   כתובת ה-Worker שלכם מ-Cloudflare. נדרש לנתוני הכנסת (הצבעות וחקיקה).
   הוראות התקנה קצרות בקובץ README.md.

   After setup it should look like:
   window.PROXY_URL = "https://our-money.mercy.workers.dev";
   ========================================================================== */

window.PROXY_URL = "https://our-money.idannhhb.workers.dev/";
