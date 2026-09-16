@echo off
REM ---------------------------------------------------------------------
REM  publish-photos.bat - puts the MK portraits (mk\) into Cloudflare KV,
REM  where the relay serves them to the MK page:
REM     /data/mkphotos        the manifest {MkId: filename}
REM     /photos/mk/<file>     the image
REM
REM  Run it after get-photos.bat. Only NEW or CHANGED portraits are
REM  uploaded (the stored name carries a content hash); portraits no
REM  longer in the manifest are deleted from KV. Afterwards it reads
REM  everything back and asks the relay for the manifest and one face.
REM
REM  Credentials: ..\d1-config.json - the same token as the D1 upload,
REM  with "Workers KV Storage: Edit" (needed for KV). Nothing else.
REM ---------------------------------------------------------------------
cd /d "%~dp0"
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python publish_photos.py %*
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  py publish_photos.py %*
  goto :done
)

echo Python was not found - install from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH") and run this again.

:done
echo.
pause
