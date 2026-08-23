@echo off
REM Creates .github\workflows\refresh-data.yml — the monthly data refresh.
REM Explorer will not let you make a folder starting with a dot, so this does it.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\install-workflow.ps1"
pause
