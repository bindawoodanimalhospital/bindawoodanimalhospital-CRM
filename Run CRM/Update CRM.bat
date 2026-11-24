@echo off
rem Gets the latest version of the CRM and prepares it. Then double-click "Run CRM".
setlocal
title Bin Dawood Animal Hospital CRM - update
cd /d "%~dp0.."

where node >nul 2>&1 || (echo Node.js is not installed on this computer. Install the LTS version from nodejs.org, then try again. & pause & exit /b 1)
node -e "process.exit(+process.versions.node.split('.')[0] < 20 ? 1 : 0)" || (echo Node.js is too old. Install the LTS version from nodejs.org, then try again. & pause & exit /b 1)

rem A running CRM keeps its files locked, so close it first.
echo Closing the CRM if it is running...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "Start-Sleep -Seconds 1"

echo Getting the latest version...
rem package-lock.json is generated; an older installer may have edited it here, which would block the update.
git checkout -- package-lock.json >nul 2>&1
call git pull --ff-only || (echo Could not get the update. Check the internet, or send a photo of this window to OBD. & pause & exit /b 1)

echo Installing the CRM's packages...
call npm ci --no-audit --no-fund || (echo Installing failed. Check the internet and try again, or send a photo of this window to OBD. & pause & exit /b 1)
copy /y package-lock.json node_modules\.crm-installed >nul

echo Preparing the CRM, this takes a few minutes...
if exist .next rmdir /s /q .next
call npm run build || (echo Preparing failed. Send a photo of this window to OBD. & pause & exit /b 1)
set "REV=no-git"
for /f %%r in ('git rev-parse HEAD 2^>nul') do set "REV=%%r"
>.next\.crm-built echo %REV%

echo.
echo Update finished. Now double-click "Run CRM".
pause
