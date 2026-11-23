@echo off
rem Gets the latest version of the CRM and prepares it.
rem Close the "Run CRM" window first, run this, then double-click "Run CRM" again.
title Bin Dawood Animal Hospital CRM - update
cd /d "%~dp0.."

echo Getting the latest version...
call git pull --ff-only || (echo Could not get the update. Check the internet, or send a photo of this window to OBD. & pause & exit /b 1)

echo Installing...
call npm install || (echo Install failed. Check the internet and try again. & pause & exit /b 1)

echo Preparing the CRM, this takes a few minutes...
call npm run build || (echo Preparing failed. Send a photo of this window to OBD. & pause & exit /b 1)

echo.
echo Update finished. Now double-click "Run CRM".
pause
