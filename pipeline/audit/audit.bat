@echo off
REM ---------------------------------------------------------------------
REM  audit.bat - Mercy's local audit tool.  (lives in pipeline\audit\)
REM
REM  Serves this folder (compare.html, paidcheck.html) on
REM  http://localhost:8081, mounts the website at /site/, and answers
REM  /audit/ queries from the FULL database - the one with provenance per
REM  field and the register rows embedded. compare.html uses it to show
REM  what the built dataset really holds, next to what every live source
REM  says.
REM
REM  The full database is a BUILD INTERMEDIATE since 2026-09-06:
REM     ..\build\contracts-full.db     written by ..\contractors\build-database.bat,
REM                                    deleted by ..\clean-up.bat, rebuildable.
REM  (out\contracts-public.db is the D1 upload - it has no provenance and
REM   cannot feed an audit.)
REM
REM  Nothing leaves this computer. Close the window to stop it.
REM  Needs python: https://www.python.org/downloads/ - tick "Add python.exe
REM  to PATH" in the installer, then double-click this file again.
REM ---------------------------------------------------------------------
cd /d "%~dp0"
echo.

if not exist ..\build\contracts-full.db (
  echo ..\build\contracts-full.db is not there.
  echo Run ..\contractors\build-database.bat first - it writes the full database there
  echo ^(a few minutes^). clean-up.bat deletes it again; it is rebuildable.
  echo.
  pause
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8081/compare.html
  python audit_server.py --db ..\build\contracts-full.db --site ..\..\site --audit . --port 8081
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8081/compare.html
  py audit_server.py --db ..\build\contracts-full.db --site ..\..\site --audit . --port 8081
  goto :done
)

echo Python was not found on this computer.
echo Install it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" in the installer, then run this again.
echo.

:done
echo.
echo Audit server stopped.
pause
