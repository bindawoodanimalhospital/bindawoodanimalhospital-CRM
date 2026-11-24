@echo off
rem Starts the CRM on this computer at http://localhost:3000
rem Every start checks that the packages and the prepared version match the current code, and fixes them if not.
rem Keep this window open while the clinic is working: closing it stops the CRM.
setlocal
title Bin Dawood Animal Hospital CRM
cd /d "%~dp0.."

rem 1) Node.js must be installed (version 20 or newer).
where node >nul 2>&1 || (echo Node.js is not installed on this computer. Install the LTS version from nodejs.org, then try again. & pause & exit /b 1)
node -e "process.exit(+process.versions.node.split('.')[0] < 20 ? 1 : 0)" || (echo Node.js is too old. Install the LTS version from nodejs.org, then try again. & pause & exit /b 1)

rem 2) Free port 3000 for the CRM (closes whatever else is using it).
echo Making port 3000 free for the CRM...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Write-Host ('  Closing ' + (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName + ' (process ' + $_ + ') that was using port 3000'); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "Start-Sleep -Seconds 1"

rem 3) Packages must be exactly the ones the code lists (package-lock.json). Reinstalled whenever it changes.
fc /b package-lock.json node_modules\.crm-installed >nul 2>&1
if errorlevel 1 (
  echo Installing the CRM's packages, this takes a few minutes...
  call npm ci --no-audit --no-fund || (echo Installing failed. Check the internet and try again, or send a photo of this window to OBD. & pause & exit /b 1)
  copy /y package-lock.json node_modules\.crm-installed >nul
  if exist .next rmdir /s /q .next
)

rem 4) The prepared (built) CRM must match the current code. Rebuilt from a clean folder whenever the code changes.
set "REV=no-git"
for /f %%r in ('git rev-parse HEAD 2^>nul') do set "REV=%%r"
set "BUILT="
if exist .next\BUILD_ID if exist .next\.crm-built set /p BUILT=<.next\.crm-built
if not "%BUILT%"=="%REV%" (
  echo Preparing the CRM, this takes a few minutes...
  if exist .next rmdir /s /q .next
  call npm run build || (echo Preparing failed. Send a photo of this window to OBD. & pause & exit /b 1)
  >.next\.crm-built echo %REV%
)

echo.
echo Starting the CRM... the browser will open in a few seconds.
echo Keep this window open. Closing it stops the CRM.
echo.
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"
call npx next start -p 3000
echo.
echo The CRM stopped. Double-click "Run CRM" to start it again.
pause
