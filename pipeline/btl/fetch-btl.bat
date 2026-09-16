@echo off
rem Fetch raw BTL bulletin Excel files (chapter 15 - unemployment) into raw\
cd /d "%~dp0"
python fetch_btl.py
if errorlevel 1 (
  echo.
  echo *** SOMETHING FAILED - paste the output above into the chat ***
)
echo.
pause
