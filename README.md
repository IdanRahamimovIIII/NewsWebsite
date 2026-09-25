# הכסף שלנו · Our Money

**https://ourmoneyil.com**

An independent, non-partisan website that makes the State of Israel easier
to understand: where the budget comes from and where it goes, who receives
government contracts, how the Knesset votes and legislates, what each
member of Knesset has done, and what the Supreme Court decides.

Hebrew first, with an English toggle on every page.

אתר עצמאי ולא מפלגתי שמסביר את המדינה בשפה פשוטה: התקציב, ההתקשרויות
הממשלתיות, ההצבעות והחקיקה בכנסת, חברי הכנסת ופסקי הדין של בית המשפט העליון.

## What's here

| folder | what it is |
|---|---|
| `site/` | the website: plain HTML, CSS and JavaScript, no build step |
| `worker/` | the Cloudflare workers: a read-only relay and data API (`api.ourmoneyil.com`), and the per-member pages at `/mk/` |
| `pipeline/` | the data collection: scripts and scheduled GitHub workflows that gather, merge and publish the datasets |
| `scripts/` | local helpers (preview server, text bake) |

## For developers and AI agents

- Free JSON API, no key needed: https://ourmoneyil.com/api/
- A guide for AI systems: https://ourmoneyil.com/llms.txt

## Contact

Found a wrong or missing figure? Write to contact@ourmoneyil.com.
