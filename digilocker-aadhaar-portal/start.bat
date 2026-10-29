@echo off
title DigiLocker Aadhaar Verification Gateway
cd /d "%~dp0"
echo ========================================================
echo   Launching DigiLocker Aadhaar Verification Gateway
echo   Open in browser: http://localhost:8080
echo ========================================================
start "" "http://localhost:8080"
dart server.dart
pause
