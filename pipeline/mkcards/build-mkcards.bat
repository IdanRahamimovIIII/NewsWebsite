@echo off
rem Builds the mkcards snapshot (one baked card per MK since 2003) and publishes it
rem to Cloudflare KV as pub:mkcards -> served at /data/mkcards by the relay.
rem Credentials: pipeline\d1-config.json. Takes ~30 minutes (polite pace).
rem Dry run without publishing:  build-mkcards.bat --no-publish
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 build_mkcards.py %*
) else (
  python build_mkcards.py %*
)
pause
