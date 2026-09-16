@echo off
REM ---------------------------------------------------------------------
REM  check-credentials.bat - proves the three Cloudflare values in
REM  ..\d1-config.json against D1 in seconds. Read-only (SELECT 1),
REM  needs NO local database file - safe to run any time.
REM
REM  Use it BEFORE pasting the values into the GitHub repo secrets
REM  (CF_ACCOUNT_ID / CF_DATABASE_ID / CF_API_TOKEN): if this says OK,
REM  the values are right and any workflow 401 is a paste problem.
REM  (a bad secret must cost seconds, not a 40-minute build)
REM ---------------------------------------------------------------------
cd /d "%~dp0.."
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python contractors\pipeline2.py check-credentials
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py contractors\pipeline2.py check-credentials
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
