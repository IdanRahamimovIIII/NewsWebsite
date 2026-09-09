# Putting this on GitHub

No command line. About fifteen minutes, once.

---

## 1. An account

[github.com](https://github.com) → Sign up. Skip if you have one.

## 2. GitHub Desktop

[desktop.github.com](https://desktop.github.com) → download → install → sign in
with the account from step 1.

## 3. Turn the folder into a repository

In GitHub Desktop: **File → Add local repository** → choose `D:\My\NewsWebsite`.

It will say the folder is not a git repository and offer to **create** one.
Say yes.

You should now see a list of every file, ready to commit. `.gitignore` is
already in the folder, so the spreadsheets and lock files are excluded — the
list should be code, data and documents only. If you see `.xlsx` files in that
list, stop and tell me.

Type a summary — *first commit* — and press **Commit to main**.

## 4. Publish it — PRIVATE

Press **Publish repository**.

**Leave "Keep this code private" TICKED.** `worker/worker.js` contains
`BUILD_KEY = "rebuild"`, which is the word that lets someone wipe the vote
index and restart the harvest. Public repo means public key.

(If you would rather it be public — it is a transparency project, after all —
change that key in the Cloudflare dashboard first and tell me, and I will move
it out of the source properly.)

## 5. Add the workflow file — double-click one thing

In `D:\My\NewsWebsite`, double-click:

```
install-workflow.bat
```

It creates `.github\workflows\refresh-data.yml` for you and prints where it
put it.

*Why a script for this:* Windows Explorer refuses to create a folder whose
name begins with a dot, so `.github` is oddly hard to make by hand. Nothing
clever is happening — the file is just being written to a folder Explorer
will not let you type.

Back in GitHub Desktop you should now see `.github/workflows/refresh-data.yml`
in the changes list. **Commit to main**, then **Push origin**.

## 6. Let the workflow write back

This one is easy to miss and the job fails without it.

On github.com, in your repository:

**Settings → Actions → General → Workflow permissions**
→ select **Read and write permissions** → **Save**.

Without it the job runs, does the work, and cannot save the result.

## 7. The first run — three ministries, not 82

**Actions** tab → **refresh data** → **Run workflow** →

| field | value |
|---|---|
| sections | `0020,0024,0015` |
| years | `2026,2025` |

→ **Run workflow**.

Watch the log. What we are looking for:

- how many report URLs discovery finds
- which ministries come back as *needs downloading by hand* (foi.gov.il)
- whether `parse_report.py` survives a ministry that is not משרד החינוך —
  משרד הבריאות's file is 1.8 MB against education's 680 KB, so the layout may
  well differ
- whether `tests/test_merge.py` still passes at the end

If the parse fails on a ministry, it says which column it could not find. Send
me that line and I will fix the parser.

## 8. Afterwards

- In GitHub Desktop, **Fetch origin** pulls the bot's commits back to your PC.
- Optional: point Netlify at the repository instead of dragging the `site`
  folder — then publishing happens by itself too.
