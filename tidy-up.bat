@echo off
rem ===================================================================
rem  Our Money - tidy up after the 2026-08-22 reorganisation.
rem  The website now lives entirely in site\ . This moves the old,
rem  now-unused copies into _old_delete_me\ so you can check them and
rem  then delete that one folder.  Nothing is deleted by this script.
rem ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo Moving the old copies into _old_delete_me\ ...
echo.
if not exist "_old_delete_me" mkdir "_old_delete_me"
if not exist "_old_delete_me\site" mkdir "_old_delete_me\site"

set MOVED=0
if exist "budget.css" ( move /Y "budget.css" "_old_delete_me\" >nul && echo   moved budget.css && set /a MOVED+=1 )
if exist "budget.data.js" ( move /Y "budget.data.js" "_old_delete_me\" >nul && echo   moved budget.data.js && set /a MOVED+=1 )
if exist "budget.strings.js" ( move /Y "budget.strings.js" "_old_delete_me\" >nul && echo   moved budget.strings.js && set /a MOVED+=1 )
if exist "budget.view.js" ( move /Y "budget.view.js" "_old_delete_me\" >nul && echo   moved budget.view.js && set /a MOVED+=1 )
if exist "build.html" ( move /Y "build.html" "_old_delete_me\" >nul && echo   moved build.html && set /a MOVED+=1 )
if exist "common.js" ( move /Y "common.js" "_old_delete_me\" >nul && echo   moved common.js && set /a MOVED+=1 )
if exist "config.js" ( move /Y "config.js" "_old_delete_me\" >nul && echo   moved config.js && set /a MOVED+=1 )
if exist "court.html" ( move /Y "court.html" "_old_delete_me\" >nul && echo   moved court.html && set /a MOVED+=1 )
if exist "index.html" ( move /Y "index.html" "_old_delete_me\" >nul && echo   moved index.html && set /a MOVED+=1 )
if exist "qa.html" ( move /Y "qa.html" "_old_delete_me\" >nul && echo   moved qa.html && set /a MOVED+=1 )
if exist "selftest.html" ( move /Y "selftest.html" "_old_delete_me\" >nul && echo   moved selftest.html && set /a MOVED+=1 )
if exist "selftest.js" ( move /Y "selftest.js" "_old_delete_me\" >nul && echo   moved selftest.js && set /a MOVED+=1 )
if exist "style.css" ( move /Y "style.css" "_old_delete_me\" >nul && echo   moved style.css && set /a MOVED+=1 )
if exist "test_budget.mjs" ( move /Y "test_budget.mjs" "_old_delete_me\" >nul && echo   moved test_budget.mjs && set /a MOVED+=1 )
if exist "votes.bills.js" ( move /Y "votes.bills.js" "_old_delete_me\" >nul && echo   moved votes.bills.js && set /a MOVED+=1 )
if exist "votes.css" ( move /Y "votes.css" "_old_delete_me\" >nul && echo   moved votes.css && set /a MOVED+=1 )
if exist "votes.data.js" ( move /Y "votes.data.js" "_old_delete_me\" >nul && echo   moved votes.data.js && set /a MOVED+=1 )
if exist "votes.html" ( move /Y "votes.html" "_old_delete_me\" >nul && echo   moved votes.html && set /a MOVED+=1 )
if exist "votes.search.js" ( move /Y "votes.search.js" "_old_delete_me\" >nul && echo   moved votes.search.js && set /a MOVED+=1 )
if exist "votes.strings.js" ( move /Y "votes.strings.js" "_old_delete_me\" >nul && echo   moved votes.strings.js && set /a MOVED+=1 )
if exist "votes.view.js" ( move /Y "votes.view.js" "_old_delete_me\" >nul && echo   moved votes.view.js && set /a MOVED+=1 )
if exist "worker.js" ( move /Y "worker.js" "_old_delete_me\" >nul && echo   moved worker.js && set /a MOVED+=1 )

if exist "site\budget.css" ( move /Y "site\budget.css" "_old_delete_me\site\" >nul && echo   moved site\budget.css && set /a MOVED+=1 )
if exist "site\budget.data.js" ( move /Y "site\budget.data.js" "_old_delete_me\site\" >nul && echo   moved site\budget.data.js && set /a MOVED+=1 )
if exist "site\budget.strings.js" ( move /Y "site\budget.strings.js" "_old_delete_me\site\" >nul && echo   moved site\budget.strings.js && set /a MOVED+=1 )
if exist "site\budget.view.js" ( move /Y "site\budget.view.js" "_old_delete_me\site\" >nul && echo   moved site\budget.view.js && set /a MOVED+=1 )
if exist "site\build.html" ( move /Y "site\build.html" "_old_delete_me\site\" >nul && echo   moved site\build.html && set /a MOVED+=1 )
if exist "site\common.js" ( move /Y "site\common.js" "_old_delete_me\site\" >nul && echo   moved site\common.js && set /a MOVED+=1 )
if exist "site\qa.html" ( move /Y "site\qa.html" "_old_delete_me\site\" >nul && echo   moved site\qa.html && set /a MOVED+=1 )
if exist "site\selftest.html" ( move /Y "site\selftest.html" "_old_delete_me\site\" >nul && echo   moved site\selftest.html && set /a MOVED+=1 )
if exist "site\selftest.js" ( move /Y "site\selftest.js" "_old_delete_me\site\" >nul && echo   moved site\selftest.js && set /a MOVED+=1 )
if exist "site\style.css" ( move /Y "site\style.css" "_old_delete_me\site\" >nul && echo   moved site\style.css && set /a MOVED+=1 )
if exist "site\votes.bills.js" ( move /Y "site\votes.bills.js" "_old_delete_me\site\" >nul && echo   moved site\votes.bills.js && set /a MOVED+=1 )
if exist "site\votes.css" ( move /Y "site\votes.css" "_old_delete_me\site\" >nul && echo   moved site\votes.css && set /a MOVED+=1 )
if exist "site\votes.data.js" ( move /Y "site\votes.data.js" "_old_delete_me\site\" >nul && echo   moved site\votes.data.js && set /a MOVED+=1 )
if exist "site\votes.search.js" ( move /Y "site\votes.search.js" "_old_delete_me\site\" >nul && echo   moved site\votes.search.js && set /a MOVED+=1 )
if exist "site\votes.strings.js" ( move /Y "site\votes.strings.js" "_old_delete_me\site\" >nul && echo   moved site\votes.strings.js && set /a MOVED+=1 )
if exist "site\votes.view.js" ( move /Y "site\votes.view.js" "_old_delete_me\site\" >nul && echo   moved site\votes.view.js && set /a MOVED+=1 )

echo.
echo Done.
echo.
echo What is left:
echo    site\        - the website. Double-click site\index.html.
echo    worker\      - the Cloudflare relay code.
echo    tests\       - the automated checks.
echo    README.md, TODO.md, CLAUDE.md
echo.
echo Open site\index.html and site\votes.html to make sure they still work,
echo then delete the _old_delete_me folder. You can also delete this .bat file.
echo.
pause
