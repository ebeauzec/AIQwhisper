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

:: -------------------------------------------------------
:: 1. Check for Node.js
:: -------------------------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo.
    echo  Please install Node.js 18+ from: https://nodejs.org/
    echo  After installing, close this window and run start.bat again.
    echo.
    pause
    exit /b 1
)

:: Check Node.js version (need 18+)
for /f "tokens=1 delims=v" %%i in ('node -v') do set NODE_VER=%%i
for /f "tokens=1 delims=v." %%i in ('node -v') do set NODE_MAJOR=%%i
set NODE_MAJOR=%NODE_MAJOR:v=%

if %NODE_MAJOR% LSS 18 (
    echo [ERROR] Node.js 18+ is required. You have: v%NODE_MAJOR%
    echo  Please upgrade from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js found: 
node -v

:: -------------------------------------------------------
:: 2. Install dependencies if needed
:: -------------------------------------------------------
if not exist "node_modules" (
    echo.
    echo [SETUP] Installing dependencies... (first run only^)
    echo.
    call npm install --production
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed.
) else (
    echo [OK] Dependencies already installed.
)

:: -------------------------------------------------------
:: 3. Create .env from template if needed
:: -------------------------------------------------------
if not exist ".env" (
    echo.
    echo [SETUP] Creating default configuration from .env.example...
    copy .env.example .env >nul
    echo [OK] Configuration created at .env
    echo      Edit .env to customize settings before adding systems.
) else (
    echo [OK] Configuration file found.
)

:: -------------------------------------------------------
:: 4. Create data directory if needed
:: -------------------------------------------------------
if not exist "data" (
    mkdir data
    echo [OK] Data directory created.
)

:: -------------------------------------------------------
:: 5. Start the application
:: -------------------------------------------------------
echo.
echo ============================================
echo  Starting AIQwhisper...
echo  Dashboard: http://localhost:3080
echo  Press Ctrl+C to stop
echo ============================================
echo.

node src/index.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Application exited with an error.
    pause
)
