@echo off
rem Gets the latest version of the clinic system and prepares it. Close start-clinic first, run this, then run start-clinic again.
title Bin Dawood Animal Hospital - update
cd /d "%~dp0"

echo Getting the latest version...
call git pull --ff-only || (echo Could not get the update. Check the internet, or send a photo of this window to OBD. & pause & exit /b 1)

echo Installing...
call npm install || (echo Install failed. Check the internet and try again. & pause & exit /b 1)

echo Preparing the system, this takes a few minutes...
call npm run build || (echo Preparing failed. Send a photo of this window to OBD. & pause & exit /b 1)

echo.
echo Update finished. Now double-click start-clinic.
pause
