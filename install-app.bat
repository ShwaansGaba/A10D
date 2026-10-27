@echo off
echo ========================================================
echo Installing FaceID Attendance App to connected Android device...
echo ========================================================

set ADB="%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"

if not exist %ADB% (
    echo [ERROR] adb.exe not found at %LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
    pause
    exit /b 1
)

%ADB% devices
echo.
echo Installing APK: build\app\outputs\flutter-apk\app-debug.apk ...
%ADB% install -r "build\app\outputs\flutter-apk\app-debug.apk"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo [SUCCESS] App installed successfully on your device!
    echo ========================================================
) else (
    echo.
    echo [ERROR] Installation failed. Ensure your phone is connected via USB with USB Debugging enabled.
)

pause
