@echo off
REM ---------------------------------------------------------------------
REM  publish-paid.bat - uploads the ministry-report documents (paid\) to
REM  Cloudflare KV, where the relay serves them to the budget page as
REM  /data/paid/index and /data/paid/<section>.
REM
REM  WHY: the paid column BudgetKey drops exists only in the ministries'
REM  own .xlsx reports. We collect it (refresh-data, monthly) and publish
REM  it ourselves as its own dataset (Mercy, 2026-09-06).
REM
REM  CREDENTIALS: the same d1-config.json as upload-to-d1.bat (account_id +
REM  api_token). The token needs ONE extra permission the first time:
REM  Cloudflare dashboard -> My Profile -> API Tokens -> Edit ->
REM  add "Workers KV Storage: Edit". Nothing else to configure - the KV
REM  namespace (our-money-data) is found by name.
REM
REM  After writing it reads every key back and compares, then asks the
REM  relay for /data/paid/index and says whether the worker serves it.
REM  Re-running is safe: it rewrites the same 53 keys.
REM
REM  The monthly workflow does the same thing automatically once the repo
REM  secrets CF_API_TOKEN + CF_ACCOUNT_ID exist (see workflows\README.md).
REM ---------------------------------------------------------------------
cd /d "%~dp0"
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\publish_paid.py %*
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py tools\publish_paid.py %*
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
