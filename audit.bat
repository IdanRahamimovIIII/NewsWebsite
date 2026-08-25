@echo off
REM ---------------------------------------------------------------------
REM  audit.bat - Mercy's local audit tool.
REM
REM  Serves site\ on http://localhost:8081 AND answers /audit/ queries
REM  from contracts.db (the FULL database, provenance and registers
REM  included). compare.html uses it to show what the built dataset
REM  really holds, next to what every live source says.
REM
REM  Nothing leaves this computer. Close the window to stop it.
REM
REM  Needs python (the only thing that can read the database without any
REM  installs). If the message below says python is missing: install it
REM  from https://www.python.org/downloads/ and tick "Add python.exe to
REM  PATH" in the installer, then double-click this file again.
REM ---------------------------------------------------------------------
cd /d "%~dp0"
echo.

if not exist contracts.db (
  echo contracts.db is not in this folder yet.
  echo It is produced by the dataset build - ask Claude for the current copy,
  echo or run the build once BudgetKey collection is done.
  echo.
  pause
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8081/tools/compare.html
  python tools\audit_server.py --db contracts.db --site site --port 8081
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8081/tools/compare.html
  py tools\audit_server.py --db contracts.db --site site --port 8081
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
