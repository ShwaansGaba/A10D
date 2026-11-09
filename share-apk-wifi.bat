@echo off
setlocal
cd /d "%~dp0"

echo ====================================================================
echo        A10D - STARTING WIRELESS PHONE INSTALLER (WI-FI)
echo ====================================================================
echo.

node -v >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in system PATH.
    pause
    exit /b 1
)

node share-apk-server.js
pause
