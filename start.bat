@echo off
setlocal enabledelayedexpansion
title AIQwhisper - On-Premises NetApp Infrastructure Manager
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

set "SCRIPT_DIR=%~dp0"
set "RUNTIME_DIR=%SCRIPT_DIR%runtime"
set "NODE_CMD="
set "NPM_CMD="
set "NODE_VERSION=22.16.0"

:: -------------------------------------------------------
:: 1. Find or install Node.js
:: -------------------------------------------------------

:: Option A: Check for bundled runtime first
if exist "%RUNTIME_DIR%\node.exe" (
    set "NODE_CMD=%RUNTIME_DIR%\node.exe"
    set "NPM_CMD=%RUNTIME_DIR%\npm.cmd"
    echo [OK] Using bundled Node.js runtime.
    goto :node_found
)

:: Option B: Check for system-wide Node.js
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=1 delims=." %%a in ('node -v') do set "SYS_VER=%%a"
    set "SYS_VER=!SYS_VER:v=!"
    if !SYS_VER! GEQ 18 (
        set "NODE_CMD=node"
        set "NPM_CMD=npm"
        echo [OK] System Node.js found: 
        node -v
        goto :node_found
    )
    echo [WARN] System Node.js is too old: v!SYS_VER! ^(need 18+^)
)

:: Option C: Auto-download portable Node.js
echo.
echo [SETUP] Node.js not found. Downloading portable runtime...
echo         This is a one-time download ^(~30 MB^).
echo.

set "ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"

set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-%ARCH%.zip"
set "NODE_ZIP=%TEMP%\node-v%NODE_VERSION%-win-%ARCH%.zip"
set "NODE_EXTRACT=%TEMP%\node-v%NODE_VERSION%-win-%ARCH%"

echo         Downloading Node.js v%NODE_VERSION% for Windows %ARCH%...

powershell -NoProfile -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "try { " ^
    "  $ProgressPreference = 'SilentlyContinue'; " ^
    "  Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -UseBasicParsing; " ^
    "  Write-Host '[OK] Download complete.' " ^
    "} catch { " ^
    "  Write-Host '[ERROR] Download failed:' $_.Exception.Message; " ^
    "  exit 1 " ^
    "}"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to download Node.js. Please install manually: https://nodejs.org/
    pause
    exit /b 1
)

echo [SETUP] Extracting Node.js runtime...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; " ^
    "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%TEMP%' -Force"

if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
xcopy /E /Y /Q "%NODE_EXTRACT%\*" "%RUNTIME_DIR%\" >nul 2>&1
del /f /q "%NODE_ZIP%" >nul 2>&1
rmdir /s /q "%NODE_EXTRACT%" >nul 2>&1

if exist "%RUNTIME_DIR%\node.exe" (
    set "NODE_CMD=%RUNTIME_DIR%\node.exe"
    set "NPM_CMD=%RUNTIME_DIR%\npm.cmd"
    echo [OK] Node.js v%NODE_VERSION% installed to runtime\ directory.
) else (
    echo [ERROR] Node.js installation failed. Please install manually: https://nodejs.org/
    pause
    exit /b 1
)

:node_found

:: -------------------------------------------------------
:: 2. Install dependencies
:: -------------------------------------------------------
:: Use a PERSISTENT local directory for node_modules to avoid
:: cloud-sync file-locking issues (Google Drive, OneDrive, Dropbox).
:: Source lives wherever the user cloned; node_modules lives locally.
set "LOCAL_APP_DIR=%LOCALAPPDATA%\AIQwhisper"
if not exist "!LOCAL_APP_DIR!" mkdir "!LOCAL_APP_DIR!"

if not exist "!LOCAL_APP_DIR!\node_modules\express" (
    echo.
    echo [SETUP] Installing dependencies... ^(first run only, may take a minute^)
    echo.

    :: Copy package files to local directory
    copy "%SCRIPT_DIR%package.json" "!LOCAL_APP_DIR!\package.json" >nul
    if exist "%SCRIPT_DIR%package-lock.json" copy "%SCRIPT_DIR%package-lock.json" "!LOCAL_APP_DIR!\package-lock.json" >nul

    :: Ensure node is on PATH for native module builds (better-sqlite3)
    if exist "%RUNTIME_DIR%\node.exe" set "PATH=%RUNTIME_DIR%;!PATH!"

    :: Run npm install on the local filesystem (no sync interference)
    pushd "!LOCAL_APP_DIR!"
    call "%NPM_CMD%" install --production
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] npm install failed. Check your internet connection.
        popd
        pause
        exit /b 1
    )
    popd

    echo.
    echo [OK] Dependencies installed to !LOCAL_APP_DIR!
) else (
    echo [OK] Dependencies already installed.
)

:: Tell Node.js where to find modules
set "NODE_PATH=!LOCAL_APP_DIR!\node_modules"

:: -------------------------------------------------------
:: 3. Create .env from template if needed
:: -------------------------------------------------------
if not exist "%SCRIPT_DIR%.env" (
    echo.
    echo [SETUP] Creating default configuration...
    copy "%SCRIPT_DIR%.env.example" "%SCRIPT_DIR%.env" >nul
    echo [OK] Configuration created at .env
    echo      Edit .env to customize settings before adding systems.
) else (
    echo [OK] Configuration file found.
)

:: -------------------------------------------------------
:: 4. Create data directory if needed
:: -------------------------------------------------------
if not exist "%SCRIPT_DIR%data" (
    mkdir "%SCRIPT_DIR%data"
    echo [OK] Data directory created.
)

:: -------------------------------------------------------
:: 5. Start the application (browser opens automatically)
:: -------------------------------------------------------
echo.
echo ============================================
echo  Starting AIQwhisper...
echo  Dashboard will open in your browser.
echo  Press Ctrl+C to stop
echo ============================================
echo.

"%NODE_CMD%" "%SCRIPT_DIR%src\index.js"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Application exited with an error.
    pause
)
