@echo off
rem ============================================================================
rem Starts the dashboard's server on this computer and keeps it running.
rem
rem   Double-click this file. A window opens, the server starts, and the
rem   dashboard opens in your browser at http://localhost:5180/
rem   Leave the window open (minimise it). Close it to stop the server.
rem
rem   If the server stops for any reason it is started again after 5 seconds.
rem   If it is already running, this only opens the page.
rem
rem   start-dashboard.cmd quiet     start the server without opening the browser
rem ============================================================================
setlocal
title Economic Dashboard - leave this window open
cd /d "%~dp0"
set "URL=http://localhost:5180/"

rem Already running? Just open the page.
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 '%URL%'; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto already

where npm >nul 2>nul
if errorlevel 1 goto nonode

if exist node_modules goto opener
echo Installing packages (first run only)...
call npm install
if errorlevel 1 goto failed

:opener
rem Open the page once the server answers. Skipped with "quiet".
if /i "%~1"=="quiet" goto run
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 90; $i++) { try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%'; Start-Process '%URL%'; break } catch { Start-Sleep -Seconds 1 } }"

:run
echo.
echo [%date% %time%] Starting the dashboard at %URL%
call npm run dev
echo.
echo [%date% %time%] The server stopped (code %errorlevel%). Starting it again in 5 seconds.
echo Close this window to stop it for good.
timeout /t 5 /nobreak >nul
goto run

:already
echo The dashboard is already running at %URL%
if /i not "%~1"=="quiet" start "" "%URL%"
timeout /t 4 >nul
exit /b 0

:nonode
echo Node.js was not found on this computer. Install it from https://nodejs.org and run this again.
pause
exit /b 1

:failed
echo The packages could not be installed. See the messages above.
pause
exit /b 1
