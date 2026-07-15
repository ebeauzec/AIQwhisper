@echo off
setlocal enabledelayedexpansion
title AIQwhisper
color 0B

echo.
echo     _    ___ ___           _     _
echo    / \  ^|_ _/ _ \__      _^| ^|__ (_)___ _ __   ___ _ __
echo   / _ \  ^| ^| ^| ^| \ \ /\ / / '_ \^| / __^| '_ \ / _ \ '__^|
echo  / ___ \ ^| ^| ^|_^| ^|\ V  V /^| ^| ^| ^| \__ \ ^|_) ^|  __/ ^|
echo /_/   \_\___\__\_\ \_/\_/ ^|_^| ^|_^|_^|___/ .__/ \___^|_^|
echo                                        ^|_^|
echo.
echo  On-Premises NetApp Infrastructure Manager
echo  ==========================================
echo.

:: ===============================================================
::  CONFIGURATION
:: ===============================================================
set "SCRIPT_DIR=%~dp0"
set "RUNTIME_DIR=%SCRIPT_DIR%runtime"
set "LOCAL_DIR=%LOCALAPPDATA%\AIQwhisper"
set "NODE_VERSION=22.16.0"
set "NODE_CMD="
set "NPM_CMD="
set "APP_PORT=3000"

:: Read port from .env
if exist "%SCRIPT_DIR%.env" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%SCRIPT_DIR%.env") do (
        if "%%a"=="PORT" set "APP_PORT=%%b"
    )
)

:: ===============================================================
::  STEP 1 — Locate or install Node.js
:: ===============================================================

:: 1a. Bundled runtime
if exist "%RUNTIME_DIR%\node.exe" (
    set "NODE_CMD=%RUNTIME_DIR%\node.exe"
    set "NPM_CMD=%RUNTIME_DIR%\npm.cmd"
    echo [OK] Bundled Node.js runtime found.
    goto :have_node
)

:: 1b. System Node.js
where node >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=1 delims=." %%v in ('node -v') do set "_V=%%v"
    set "_V=!_V:v=!"
    if !_V! GEQ 18 (
        set "NODE_CMD=node"
        set "NPM_CMD=npm"
        echo [OK] System Node.js found ^(v!_V!^).
        goto :have_node
    )
    echo [WARN] System Node.js too old ^(v!_V!, need 18+^).
)

:: 1c. Download portable Node.js
echo.
echo [SETUP] Downloading Node.js v%NODE_VERSION%... ^(one-time, ~30 MB^)
set "ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
set "_ZIP=%TEMP%\node-%NODE_VERSION%.zip"
set "_DIR=%TEMP%\node-v%NODE_VERSION%-win-%ARCH%"

powershell -NoProfile -Command ^
  "$ProgressPreference='SilentlyContinue'; " ^
  "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " ^
  "Invoke-WebRequest 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-%ARCH%.zip' " ^
  "-OutFile '%_ZIP%' -UseBasicParsing"
if !errorlevel! neq 0 (
    echo [ERROR] Download failed. Install Node.js 18+ from https://nodejs.org/
    pause & exit /b 1
)

echo [SETUP] Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%_ZIP%' -DestinationPath '%TEMP%' -Force"
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
xcopy /E /Y /Q "%_DIR%\*" "%RUNTIME_DIR%\" >nul 2>&1
del /q "%_ZIP%" >nul 2>&1 & rmdir /s /q "%_DIR%" >nul 2>&1

if exist "%RUNTIME_DIR%\node.exe" (
    set "NODE_CMD=%RUNTIME_DIR%\node.exe"
    set "NPM_CMD=%RUNTIME_DIR%\npm.cmd"
    echo [OK] Node.js v%NODE_VERSION% installed.
) else (
    echo [ERROR] Extraction failed. Install Node.js manually.
    pause & exit /b 1
)

:have_node

:: Ensure node is always on PATH for native module builds
set "PATH=%RUNTIME_DIR%;%PATH%"

:: ===============================================================
::  STEP 2 — Install dependencies (to local filesystem)
:: ===============================================================
::  node_modules go to %LOCALAPPDATA%\AIQwhisper to avoid
::  Google Drive / OneDrive / Dropbox sync interference.

if not exist "!LOCAL_DIR!" mkdir "!LOCAL_DIR!"

:: Check if install is needed (look for express as a canary)
if not exist "!LOCAL_DIR!\node_modules\express\package.json" (
    echo.
    echo [SETUP] Installing dependencies... ^(first run, ~30 seconds^)

    copy /y "%SCRIPT_DIR%package.json" "!LOCAL_DIR!\package.json" >nul
    if exist "%SCRIPT_DIR%package-lock.json" copy /y "%SCRIPT_DIR%package-lock.json" "!LOCAL_DIR!\package-lock.json" >nul

    pushd "!LOCAL_DIR!"
    call "!NPM_CMD!" install --production 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] npm install failed.
        echo         Check your internet connection and try again.
        popd & pause & exit /b 1
    )
    popd
    echo [OK] Dependencies installed.
) else (
    echo [OK] Dependencies ready.
)

:: ===============================================================
::  STEP 3 — Create config / data dirs if missing
:: ===============================================================
if not exist "%SCRIPT_DIR%.env" (
    if exist "%SCRIPT_DIR%.env.example" (
        copy "%SCRIPT_DIR%.env.example" "%SCRIPT_DIR%.env" >nul
        echo [OK] Default .env created. Edit it to add your systems.
    )
)
if not exist "%SCRIPT_DIR%data" mkdir "%SCRIPT_DIR%data"

:: ===============================================================
::  STEP 4 — Kill any previous instance on port %APP_PORT%
:: ===============================================================
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr "LISTENING" ^| findstr ":%APP_PORT% "') do (
    if "%%p" NEQ "0" (
        echo [WARN] Stopping previous instance ^(PID %%p^) on port !APP_PORT!...
        taskkill /F /PID %%p >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
)

:: ===============================================================
::  STEP 5 — Launch
:: ===============================================================
echo.
echo ============================================
echo   AIQwhisper starting on port !APP_PORT!
echo   Browser will open automatically
echo   Press Ctrl+C to stop
echo ============================================
echo.

set "NODE_PATH=!LOCAL_DIR!\node_modules"
"!NODE_CMD!" "%SCRIPT_DIR%src\index.js"

if !errorlevel! neq 0 (
    echo.
    echo [ERROR] AIQwhisper exited with an error.
    echo         Check the output above for details.
    pause
)
