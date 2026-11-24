@echo off
rem Starts the Bin Dawood Animal Hospital CRM on this computer at http://localhost:3000
rem Whatever else is using port 3000 is closed first, so the CRM always gets it.
rem Keep this window open while the clinic is working: closing it stops the CRM.
title Bin Dawood Animal Hospital CRM
cd /d "%~dp0.."

echo Making port 3000 free for the CRM...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Write-Host ('  Closing ' + (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName + ' (process ' + $_ + ') that was using port 3000'); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "Start-Sleep -Seconds 1"

if not exist node_modules (
  echo Installing for the first time, please wait...
  call npm install || (echo Install failed. Check the internet and try again. & pause & exit /b 1)
)

if not exist .next\BUILD_ID (
  echo Preparing the CRM, this takes a few minutes the first time...
  rem The developer cache (.next\dev) is not needed here and can break the build if left half-written.
  if exist .next\dev rmdir /s /q .next\dev
  call npm run build || (echo Preparing failed. Send a photo of this window to OBD. & pause & exit /b 1)
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
