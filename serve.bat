@echo off
REM ---------------------------------------------------------------------
REM  Serves site\ on http://localhost:8080 so the browser will load our own
REM  data files. Opening site\index.html from disk does NOT work: a file://
REM  page is blocked from reading its own folder, silently, and the payment
REM  columns come out empty with no error anywhere.
REM
REM  Tries node, then python, then py, then PowerShell. One of them is on
REM  every Windows machine.
REM ---------------------------------------------------------------------
cd /d "%~dp0"
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  echo Using node.
  start "" http://localhost:8080/
  node tools\serve.mjs
  goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Using python.
  start "" http://localhost:8080/
  python -m http.server 8080 --directory site
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo Using the py launcher.
  start "" http://localhost:8080/
  py -m http.server 8080 --directory site
  goto :done
)

echo Using PowerShell ^(no node or python found^).
start "" http://localhost:8080/
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\serve.ps1"

:done
echo.
echo Server stopped.
pause
