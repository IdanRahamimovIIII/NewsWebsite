@echo off
REM ---------------------------------------------------------------------
REM  verify-d1.bat - checks that the data in Cloudflare D1 really MATCHES
REM  contracts-public.db, content and all - not just the row counts.
REM
REM  Compares the whole strings table, plus every column of every row of
REM  40 random orders across contracts / allocations / reports, plus the
REM  contracts_v view. Takes a minute or two. Safe to run any time;
REM  different random orders are drawn each run.
REM
REM  Uses the same d1-config.json as upload-to-d1.bat.
REM ---------------------------------------------------------------------
REM  (lives in pipeline\ since 2026-09-06 - paths below are relative to it)
cd /d "%~dp0"
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\verify_d1.py
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py tools\verify_d1.py
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
