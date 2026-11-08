@echo off
REM Double-click to build and serve MARS: FRONTIER on your Wi-Fi for your iPhone.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies the first time...
  call npm install
)
call npm run phone
pause
