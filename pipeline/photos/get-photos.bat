@echo off
rem Collect the official photos of all current Knesset members into mk\
rem (next to this file). Fully automatic: the Knesset's own API says where
rem each photo lives. Then run publish-photos.bat to put them on Cloudflare.
rem Run again after each election to pick up the new members.
rem Options:  get-photos.bat --refresh   (re-download updated portraits)
rem           get-photos.bat --all       (past members too, not just current)
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during the install, then run me again.
  pause
  exit /b 1
)
python fetch_photos.py %*
pause
