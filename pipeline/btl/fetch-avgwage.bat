@echo off
rem Fetch + parse the legal average wage page (no publish) - green-run check
cd /d "%~dp0"
python fetch_avgwage.py
if errorlevel 1 (
  echo.
  echo *** SOMETHING FAILED - paste the output above into the chat ***
)
echo.
pause
