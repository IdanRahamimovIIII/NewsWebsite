@echo off
REM ---------------------------------------------------------------------
REM  build-database.bat - builds the contracts database on THIS computer.
REM
REM  Inputs it looks for in inputs\ (see tools\build_database.py):
REM    full-records.zip            required (Actions -> refresh data)
REM    mr-exemptions / mr-tenders  the converted registers (already here)
REM    budgetkey-raw.zip           optional until "collect budgetkey" ran
REM
REM  ONE output (since 2026-09-06):
REM    out\contracts-public.db     the file upload-to-d1.bat sends to Cloudflare
REM
REM  Along the way it writes build\contracts-full.db - the full database
REM  (provenance per field, register rows) the public copy is derived from
REM  and audit\audit.bat reads. It is an intermediate: clean-up.bat deletes
REM  it, this build recreates it.
REM
REM  Takes a few minutes and some memory at full scale. Re-run any time an
REM  input changed - it always rebuilds the whole thing.
REM ---------------------------------------------------------------------
REM  (lives in pipeline\ since 2026-09-06 - paths below are relative to it)
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
