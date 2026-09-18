@echo off
REM ===========================================================================
REM  VEYE - official demo / test mode
REM
REM  Serves build\ over http://localhost so every page shares ONE origin and
REM  localStorage behaves the same in Chrome and Firefox. Opening the HTML
REM  files directly (file://) still works, but Firefox gives each file:// page
REM  its own opaque origin, so the prototype has to fall back to carrying state
REM  in the URL. localhost is the mode to demo and test in.
REM
REM  No dependencies beyond Python's built-in http.server.
REM ===========================================================================

setlocal
cd /d "%~dp0"

set "PORT=8765"
set "PY="

where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"

if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  echo.
  echo   Python was not found on this machine.
  echo.
  echo   VEYE needs any local web server to serve the "build" folder.
  echo   Either install Python from https://www.python.org/downloads/
  echo   ^(tick "Add python.exe to PATH"^) and run this file again, or serve
  echo   the folder with a tool you already have, for example:
  echo.
  echo       npx --yes serve build -l %PORT%
  echo.
  echo   Then open  http://localhost:%PORT%/index.html
  echo.
  pause
  exit /b 1
)

if not exist "build\index.html" (
  echo.
  echo   Could not find "build\index.html" next to this file.
  echo   Run RUN_VEYE_LOCAL.bat from the VEYE project root.
  echo.
  pause
  exit /b 1
)

echo.
echo   ===============================================================
echo     VEYE is running. Open this in your browser:
echo.
echo         http://localhost:%PORT%/index.html
echo.
echo     Onboarding ... http://localhost:%PORT%/onboarding.html
echo     Dashboard .... http://localhost:%PORT%/dashboard.html
echo.
echo     Leave this window open while you demo.
echo     Press Ctrl+C to stop the server.
echo   ===============================================================
echo.

%PY% -m http.server %PORT% --directory build

endlocal
