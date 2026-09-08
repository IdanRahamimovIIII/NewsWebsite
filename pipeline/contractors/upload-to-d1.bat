@echo off
REM ---------------------------------------------------------------------
REM  upload-to-d1.bat - uploads contracts-public.db to Cloudflare D1.
REM  (in contractors\ since the 2026-09-08 by-DATASET reorg; the code it
REM   runs is shared\upload_to_d1.py - both uploads use that machinery)
REM
REM  FIRST TIME: it creates ..\d1-config.json and stops. Fill in the three
REM  values (where to find each one is written inside shared\upload_to_d1.py
REM  at the top) and run this again.
REM
REM  The token file is gitignored - it never leaves this computer.
REM
REM  What it does: turns the public database into SQL, uploads it
REM  (~1.5 GB - the upload is the long part, leave the window open),
REM  and waits for D1 to finish importing. Re-running replaces the
REM  data cleanly - safe to repeat after every monthly rebuild. The dump
REM  carries the ctr_* tables + search index too when the db has them.
REM  To send ONLY those small tables after build-contractors.bat, use
REM  upload-to-d1-contractors.bat instead - much faster.
REM ---------------------------------------------------------------------
cd /d "%~dp0.."
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python shared\upload_to_d1.py
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py shared\upload_to_d1.py
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
