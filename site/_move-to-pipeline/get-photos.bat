@echo off
rem Collect the official photos of all current Knesset members into
rem photos\mk\ (next to this file) — the pipeline then publishes them to Cloudflare.
rem Fully automatic: the Knesset's own API says where each photo lives.
rem Run it again after each election to pick up the new members.
rem Options:  get-photos.bat --refresh   (re-download updated portraits)
rem           get-photos.bat --all       (past members too, not just current)
REM  (moved out of site\ on 2026-09-06 — pipeline territory now, beside fetch_photos.py)
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
