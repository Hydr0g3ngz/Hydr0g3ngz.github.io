@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current LTS version from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\astro" (
  echo Installing project dependencies...
  call npm ci
  if errorlevel 1 (
    echo Installation failed. Please check your connection and try again.
    pause
    exit /b 1
  )
)
call npm run studio -- --open
if errorlevel 1 pause
