@echo off
REM ---------------------------------------------------------------------
REM  clean-up.bat - deletes the REBUILDABLE files, ~10 GB.
REM
REM  Everything below can be recreated by build-database.bat from the
REM  files we KEEP (contractors\inputs\: the three zips + the export
REM  folders), or is superseded. NEVER touched: contractors\inputs\ and
REM  contractors\out\ (contracts-public.db), the job folders, d1-config.json.
REM
REM  ..\build\contracts-full.db IS on the list: it is the full database
REM  audit\audit.bat reads, ~2.3 GB, and build-database.bat recreates it
REM  in minutes. Keep it only while you are auditing.
REM
REM  ..\build\d1\manifest.json + state.json are kept on purpose (and the
REM  same pair in ..\build\d1\ctr\): they are how the uploaders remember
REM  an upload is complete.
REM
REM  This one really DELETES (Mercy asked). It shows the list
REM  first and waits for a key.
REM ---------------------------------------------------------------------
cd /d "%~dp0.."
if not exist contractors\build_database.py (
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
echo   build\d1\ctr\part-*.sql (the contractors-tables upload's parts)
echo   ..\_old_delete_me\         (marked for deletion on 2026-08-25)
echo   __pycache__ folders     (Python cache)
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
if exist "build\d1\ctr\part-001.sql" del /q "build\d1\ctr\part-*.sql"
if exist "..\_old_delete_me"           rd /s /q "..\_old_delete_me"
if exist "tools\__pycache__"        rd /s /q "tools\__pycache__"
if exist "contractors\__pycache__"  rd /s /q "contractors\__pycache__"
if exist "shared\__pycache__"       rd /s /q "shared\__pycache__"

echo.
echo Checking...
set OK=1
for %%p in ("build\raw" "build\contracts" "build\full" "..\_old_delete_me" "tools\__pycache__" "contractors\__pycache__" "shared\__pycache__") do (
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
