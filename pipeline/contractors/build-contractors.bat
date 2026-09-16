@echo off
REM ---------------------------------------------------------------------
REM  build-contractors.bat - precomputes THE CONTRACTORS PAGE's tables
REM  (ctr_years / ctr_top / ctr_ex / ctr_sup + the ctr_fts search index)
REM  into ..\out\contracts-public.db.
REM
REM  Run it AFTER database\build-database.bat (it needs the public db to
REM  exist), or any time on the current db to refresh just these tables.
REM  A full database build also runs this step by itself at the end, so
REM  normally you only need this one when adding the tables to a db that
REM  predates the ctr_ tables.
REM
REM  It prints SANITY numbers at the end (2024 vs the live BudgetKey
REM  figures) - read them; a LARGE gap means a definition drifted.
REM
REM  Next step after this: upload-to-d1-contractors.bat (sends only the
REM  new small tables to Cloudflare, minutes not hours).
REM ---------------------------------------------------------------------
cd /d "%~dp0.."
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python contractors\build_contractors.py
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py contractors\build_contractors.py
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
