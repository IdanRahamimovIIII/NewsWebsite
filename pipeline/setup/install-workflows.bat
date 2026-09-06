@echo off
REM Copies pipeline\workflows\*.yml into the project's .github\workflows\ (where
REM GitHub insists on finding them). Run it after ANY change to a workflow file,
REM then commit both folders and push. It only touches files that differ.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "install-workflows.ps1"
pause
