@echo off
rem Parse raw\latest\O15*.XLS into the combined snapshot AND publish it to KV.
rem Normal home for this step is the update-btl workflow (CI); this .bat is
rem the local fallback. Needs the xlrd Excel reader - installed once, below.
cd /d "%~dp0"
python -c "import xlrd" 2>nul || python -m pip install --user xlrd
python fetch_btl.py
if errorlevel 1 goto :fail
python parse_btl.py --publish
if errorlevel 1 goto :fail
echo.
goto :done
:fail
echo.
echo *** SOMETHING FAILED - paste the output above into the chat ***
:done
pause
