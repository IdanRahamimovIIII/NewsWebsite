@echo off
rem Builds the laws snapshot (every law + court effects + bills in committee now)
rem and publishes it to Cloudflare KV as pub:laws -> served at /data/laws by the relay.
rem Credentials: pipeline\d1-config.json. Takes ~3 minutes (polite pace).
rem Dry run without publishing:  build-laws.bat --no-publish
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 build_laws.py %*
) else (
  python build_laws.py %*
)
pause
