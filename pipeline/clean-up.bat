@echo off
REM ---------------------------------------------------------------------
REM  clean-up.bat (2026-09-05) - deletes the REBUILDABLE files, ~9.6 GB.
REM
REM  Everything below can be recreated by build-database.bat from the
REM  files we KEEP (inputs\: the three zips + the export folders), or is
REM  already superseded. What is NEVER touched: out\ (contracts-public.db),
REM  inputs\ (full-records.zip, budgetkey-raw.zip, publications-register.zip,
REM  Tenders-07082026, Exemptions-07082026), reports, tools, tests, audit,
REM  FIELDS.xlsx, d1-config.json.
REM
REM  build\contracts-full.db IS on the list (since 2026-09-06): it is the
REM  full database audit\audit.bat reads, ~2.3 GB, and build-database.bat
REM  recreates it in minutes. Keep it only while you are auditing.
REM
REM  build\d1\manifest.json + state.json are kept on purpose: they are
REM  how upload-to-d1.bat remembers the upload is complete.
REM
REM  Unlike the old tidy-up bats, this one really DELETES (Mercy asked,
REM  2026-09-05). It shows the list first and waits for a key.
REM ---------------------------------------------------------------------
REM  (lives in pipeline\ since 2026-09-06 - paths below are relative to it)
cd /d "%~dp0"
if not exist tools\build_database.py (
  echo This does not look like the pipeline folder - stopping.
  pause
  exit /b 1
)
echo.
echo This will PERMANENTLY DELETE (all rebuildable, up to ~12 GB):
echo.
echo   build\raw\              (re-extracted from budgetkey-raw.zip)
echo   build\contracts\        (intermediates of build-database.bat)
echo   build\full\             (re-extracted from full-records.zip)
echo   build\mr-exemptions.json  (re-gunzipped from Exemptions folder)
echo   build\contracts-full.db   (the audit's full database, ~2.3 GB - rebuilt by build-database.bat)
echo   build\d1-upload.sql     (old single-file dump, superseded)
echo   build\d1\part-*.sql     (uploaded to D1 and verified)
echo   ..\_old_delete_me\         (marked for deletion on 2026-08-25)
echo   tools\__pycache__\      (Python cache)
echo.
echo Close this window to cancel, or
pause

if exist "build\raw"                rd /s /q "build\raw"
if exist "build\contracts"          rd /s /q "build\contracts"
if exist "build\full"               rd /s /q "build\full"
if exist "build\mr-exemptions.json" del /q "build\mr-exemptions.json"
if exist "build\contracts-full.db"  del /q "build\contracts-full.db"
if exist "build\d1-upload.sql"      del /q "build\d1-upload.sql"
if exist "build\d1\part-001.sql"    del /q "build\d1\part-*.sql"
if exist "..\_old_delete_me"           rd /s /q "..\_old_delete_me"
if exist "tools\__pycache__"        rd /s /q "tools\__pycache__"

echo.
echo Checking...
set OK=1
for %%p in ("build\raw" "build\contracts" "build\full" "..\_old_delete_me" "tools\__pycache__") do (
  if exist %%p (
    echo   STILL THERE: %%p  ^(a file may be open in another program^)
    set OK=0
  )
)
if exist "build\d1-upload.sql" ( echo   STILL THERE: build\d1-upload.sql & set OK=0 )
if exist "build\contracts-full.db" ( echo   STILL THERE: build\contracts-full.db  ^(audit.bat still running?^) & set OK=0 )
if exist "build\d1\part-001.sql" ( echo   STILL THERE: build\d1 parts & set OK=0 )
if "%OK%"=="1" (
  echo   All clean.
) else (
  echo   Close whatever is using those files and run this again.
)
echo.
pause
