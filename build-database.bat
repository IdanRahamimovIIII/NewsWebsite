@echo off
REM ---------------------------------------------------------------------
REM  build-database.bat - builds the contracts database on THIS computer.
REM
REM  Inputs it looks for in this folder (see tools\build_database.py):
REM    full-records.zip            required (Actions -> refresh data)
REM    mr-exemptions / mr-tenders  the converted registers (already here)
REM    budgetkey-raw.zip           optional until "collect budgetkey" ran
REM
REM  Outputs, in this folder:
REM    contracts.db         the full database audit.bat reads (stays local)
REM    contracts-public.db  the copy that will go to Cloudflare D1
REM
REM  Takes a few minutes and some memory at full scale. Re-run any time an
REM  input changed - it always rebuilds the whole thing.
REM ---------------------------------------------------------------------
cd /d "%~dp0"
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\build_database.py
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py tools\build_database.py
  goto :done
)

echo Python was not found on this computer.
echo Install it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" in the installer, then run this again.

:done
echo.
pause
