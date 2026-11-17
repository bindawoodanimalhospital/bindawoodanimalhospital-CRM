@echo off
rem Starts the clinic system on this computer (production mode: fast, no developer error screens).
rem Open it at http://localhost:3000 . Keep this window open while the clinic is working.
title Bin Dawood Animal Hospital - system
cd /d "%~dp0"

if not exist node_modules (
  echo Installing for the first time, please wait...
  call npm install || (echo Install failed. Check the internet and try again. & pause & exit /b 1)
)

if not exist .next\BUILD_ID (
  echo Preparing the system, this takes a few minutes the first time...
  call npm run build || (echo Preparing failed. Send a photo of this window to OBD. & pause & exit /b 1)
)

echo.
echo Starting... the browser will open in a few seconds.
echo Keep this window open. Closing it stops the system.
echo.
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"
call npx next start -p 3000
echo.
echo The system stopped. If it said the port is in use, close the other black window running the system and try again.
pause
