@echo off
REM ---------------------------------------------------------------------
REM  upload-to-d1-contractors.bat - sends ONLY the contractors page's
REM  precomputed tables (ctr_* + the search index) to Cloudflare D1.
REM
REM  Run it after build-contractors.bat. It does NOT re-upload the 1.3 GB
REM  of contract rows D1 already holds - just the small new tables, each
REM  part verified by row counts, plus one real search query at the end
REM  to prove the index answers.
REM
REM  Uses the same ..\d1-config.json as database\upload-to-d1.bat.
REM  (On a full re-upload day you do NOT need this - the full uploader's
REM  dump carries these tables too.)
REM ---------------------------------------------------------------------
cd /d "%~dp0.."
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python contractors\upload_contractors.py
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py contractors\upload_contractors.py
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
