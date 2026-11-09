@echo off
REM Double-click to build MARS: FRONTIER and open it in Edge/Chrome for PS VR2 (SteamVR) on this PC.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20.19+ is required: https://nodejs.org/ & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies the first time...
  call npm install
)
call npm run vr
pause
