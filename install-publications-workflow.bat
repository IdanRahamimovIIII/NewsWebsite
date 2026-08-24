@echo off
REM Creates .github\workflows\collect-publications.yml - the Origin B register
REM collector. A separate workflow: it shares no files with the monthly
REM refresh and never commits, so it cannot collide with a running refresh.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\install-publications-workflow.ps1"
pause
