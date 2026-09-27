@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)
node server.mjs
pause
