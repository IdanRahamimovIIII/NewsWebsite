@echo off
REM Creates .github\workflows\collect-budgetkey.yml - collects the BudgetKey
REM side of the contracts dataset, raw and whole, section by section.
REM Separate workflow: shares no files with the other pipelines, commits
REM nothing, cannot collide with anything.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\install-budgetkey-workflow.ps1"
pause
