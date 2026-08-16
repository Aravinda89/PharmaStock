@echo off
REM ===================================================================
REM  PharmaStock - start the pharmacy inventory system
REM
REM  Double-click this file (or its desktop shortcut) to start.
REM  Keep the black window open while the pharmacy is using the system.
REM  Close the window, or press Ctrl+C, to stop.
REM ===================================================================

title PharmaStock
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Install it from https://nodejs.org  ^(choose the LTS version^),
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   First-time setup - installing. This takes a few minutes.
  echo.
  call npm install || goto :failed
  call npm --prefix web install || goto :failed
  call npm run build || goto :failed
)

if not exist "web\dist\index.html" (
  echo   Building the screens...
  call npm run build || goto :failed
)

echo.
echo   Starting PharmaStock...
echo.

REM Give the server a moment to bind the port before opening the browser.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:4000"

node server/index.js

echo.
echo   PharmaStock has stopped. Your data is saved.
pause
exit /b 0

:failed
echo.
echo   Setup failed. Please check the messages above.
echo.
pause
exit /b 1
