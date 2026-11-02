@echo off
title A10D Database & Auth Purge
echo ========================================================
echo   A10D: Wipe Entire Database and Auth Accounts
echo ========================================================
echo.
echo WARNING: This will permanently delete:
echo   - ALL user accounts from auth.users
echo   - ALL employee profiles and face data
echo   - ALL attendance punches and logs
echo.
set /p CONFIRM="Type YES to confirm total wipe: "
if /i not "%CONFIRM%"=="YES" (
  echo Aborted. No data was deleted.
  pause
  exit /b 0
)

echo.
node "%~dp0wipe-database.js"
echo.
pause
