@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install Node.js 22 or newer.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Please check your Node.js installation.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] First run detected. Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [INFO] Starting WereWolf...
call npm run dev

if errorlevel 1 (
  echo.
  echo [ERROR] WereWolf failed to start.
  pause
)

endlocal
