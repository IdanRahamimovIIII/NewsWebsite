@echo off
rem Fetch the legal average wage page AND publish it to KV pub:avgwage
rem (served by the relay as /data/avgwage). Credentials: pipeline\d1-config.json
cd /d "%~dp0"
python fetch_avgwage.py --publish
if errorlevel 1 (
  echo.
  echo *** SOMETHING FAILED - paste the output above into the chat ***
)
echo.
pause
