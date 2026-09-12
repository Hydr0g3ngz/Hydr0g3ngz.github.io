@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Studio requires Node.js 24 or newer. Please update Node.js and try again.
  pause
  exit /b 1
)
node scripts\studio-launch.mjs %*
set "studioExitCode=%errorlevel%"
if not "%studioExitCode%"=="0" pause
exit /b %studioExitCode%
