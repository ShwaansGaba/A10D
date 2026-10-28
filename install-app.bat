@echo off
setlocal enabledelayedexpansion

:: Switch to the directory where this script is located
cd /d "%~dp0"

echo ====================================================================
echo             A10D - ONE-CLICK ANDROID KIOSK INSTALLER
echo ====================================================================
echo.

:: 1. Locate ADB executable
set ADB="%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"

if not exist %ADB% (
    where adb >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set ADB=adb
    ) else (
        echo [ERROR] adb.exe could not be found.
        echo Please ensure Android SDK Platform-Tools are installed at:
        echo %LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
        echo or added to your system PATH.
        echo.
        pause
        exit /b 1
    )
)

:: 2. Check for connected Android device
echo Checking for connected Android devices via ADB...
%ADB% devices
echo.

:: Check if at least one device is connected
for /f "skip=1 tokens=1,2" %%A in ('%ADB% devices') do (
    if "%%B"=="device" (
        set DEVICE_FOUND=1
    )
)

if not defined DEVICE_FOUND (
    echo [WARNING] No authorized Android device detected.
    echo.
    echo Please make sure:
    echo  1. Your phone is connected via USB cable.
    echo  2. "USB Debugging" is enabled in Developer Options.
    echo  3. Tap "Allow USB Debugging" on your phone's screen.
    echo.
    echo Retrying in 5 seconds...
    ping 127.0.0.1 -n 6 >nul
    for /f "skip=1 tokens=1,2" %%A in ('%ADB% devices') do (
        if "%%B"=="device" (
            set DEVICE_FOUND=1
        )
    )
)

:: 3. Verify latest compiled APK exists
set APK_PATH="build\app\outputs\flutter-apk\app-debug.apk"

if not exist %APK_PATH% (
    echo [INFO] Pre-compiled APK not found. Building fresh APK now...
    call flutter build apk --debug
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Flutter build failed.
        pause
        exit /b 1
    )
)

echo.
echo Installing latest A10D Kiosk APK onto your phone...
echo Target APK: %APK_PATH%
echo.

:: 4. Install APK with replace (-r) and downgrade (-d) flags
%ADB% install -r -d %APK_PATH%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================================
    echo [SUCCESS] A10D Kiosk App installed successfully on your device!
    echo ====================================================================
    echo.
    echo Launching A10D on phone...
    %ADB% shell monkey -p com.attendancetracker.app.attendance_app -c android.intent.category.LAUNCHER 1 >nul 2>nul
    echo App launched!
) else (
    echo.
    echo ====================================================================
    echo [ERROR] Installation failed.
    echo If your device has an existing install with conflicting signatures,
    echo please uninstall the old A10D app from your phone and run this again.
    echo ====================================================================
)

echo.
pause
