@echo off
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed.
  echo Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies (first run)...
  call npm install
)

echo Starting HEKounter...
echo Opening http://localhost:5173 in your browser...
echo.

start "" "http://localhost:5173"
timeout /t 2 /nobreak >nul

npm run dev
