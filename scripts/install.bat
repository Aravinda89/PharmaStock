@echo off
REM ===================================================================
REM  PharmaStock - one-time setup
REM
REM  Installs everything, creates the database with the four starter
REM  accounts, and puts a shortcut on the desktop.
REM ===================================================================

title PharmaStock setup
cd /d "%~dp0.."

echo.
echo   PharmaStock setup
echo   =================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed.
  echo   Install it from https://nodejs.org ^(LTS version^), then run this again.
  echo.
  pause
  exit /b 1
)

echo   [1/4] Installing the server...
call npm install || goto :failed

echo   [2/4] Installing the screens...
call npm --prefix web install || goto :failed

echo   [3/4] Building...
call npm run build || goto :failed

echo   [4/4] Preparing the database...
call npm run seed || goto :failed

echo.
echo   Creating a desktop shortcut...
powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\PharmaStock.lnk');" ^
  "$s.TargetPath = '%CD%\scripts\Start PharmaStock.bat';" ^
  "$s.WorkingDirectory = '%CD%';" ^
  "$s.Description = 'Pharmacy inventory management';" ^
  "$s.Save()"

echo.
echo   ============================================================
echo    Setup complete.
echo.
echo    Double-click "PharmaStock" on the desktop to start.
echo    Then open http://localhost:4000 and sign in.
echo.
echo    Starter accounts (each must set a new password on first use):
echo      pharmacist / pharma123
echo      doctor     / doctor123
echo      assistant1 / assist123
echo      assistant2 / assist123
echo.
echo    Read docs\USER_GUIDE.md for how to use the system.
echo   ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo   Setup failed. Please check the messages above.
echo.
pause
exit /b 1
