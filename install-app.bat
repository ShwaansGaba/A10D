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
    echo You can install via USB Cable OR Wireless Wi-Fi:
    echo   - If using USB: Plug in your cable, enable USB Debugging, and press Enter.
    echo   - If Wireless: Enable "Wireless Debugging" on phone and enter the IP:Port below.
    echo.
    set /p USER_INPUT="Enter Wireless IP:PORT (e.g. 192.168.1.50:5555) or press Enter for USB: "
    if defined USER_INPUT (
        echo Connecting to !USER_INPUT! via Wireless ADB...
        %ADB% connect !USER_INPUT!
        ping 127.0.0.1 -n 3 >nul
        for /f "skip=1 tokens=1,2" %%A in ('%ADB% devices') do (
            if "%%B"=="device" (
                set DEVICE_FOUND=1
            )
        )
    ) else (
        echo Retrying USB connection in 3 seconds...
        ping 127.0.0.1 -n 4 >nul
        for /f "skip=1 tokens=1,2" %%A in ('%ADB% devices') do (
            if "%%B"=="device" (
                set DEVICE_FOUND=1
            )
        )
    )
)

:: 3. Detect device architecture & select lightweight optimized release APK
set TARGET_ABI=arm64-v8a
for /f "tokens=*" %%i in ('%ADB% shell getprop ro.product.cpu.abi 2^>nul') do (
    set TARGET_ABI=%%i
)

echo Detected device ABI: %TARGET_ABI%

set APK_PATH=A10D-Kiosk.apk
if not exist "%APK_PATH%" (
    set APK_PATH=build\app\outputs\flutter-apk\app-%TARGET_ABI%-release.apk
)
if not exist "%APK_PATH%" (
    if exist "build\app\outputs\flutter-apk\app-arm64-v8a-release.apk" (
        set APK_PATH=build\app\outputs\flutter-apk\app-arm64-v8a-release.apk
    ) else if exist "build\app\outputs\flutter-apk\app-release.apk" (
        set APK_PATH=build\app\outputs\flutter-apk\app-release.apk
    ) else if exist "build\app\outputs\flutter-apk\app-armeabi-v7a-release.apk" (
        set APK_PATH=build\app\outputs\flutter-apk\app-armeabi-v7a-release.apk
    ) else if exist "build\app\outputs\flutter-apk\app-debug.apk" (
        set APK_PATH=build\app\outputs\flutter-apk\app-debug.apk
    ) else (
        echo [INFO] Pre-compiled APK not found. Building optimized release APKs now...
        call flutter build apk --release --split-per-abi
        if %ERRORLEVEL% NEQ 0 (
            echo [ERROR] Flutter build failed.
            pause
            exit /b 1
        )
        set APK_PATH=build\app\outputs\flutter-apk\app-%TARGET_ABI%-release.apk
        if not exist "!APK_PATH!" (
            set APK_PATH=build\app\outputs\flutter-apk\app-arm64-v8a-release.apk
        )
    )
)

echo.
echo Installing optimized A10D Kiosk APK onto your phone...
echo Target APK: %APK_PATH%
echo.

:: 4. Install APK with replace (-r) and downgrade (-d) flags
%ADB% install -r -d "%APK_PATH%"

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
