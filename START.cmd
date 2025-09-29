@echo off
echo ======================================================
echo   Starting the Dictation App with Gemini AI
echo ======================================================
echo.
echo Checks before starting:
echo  1. Checking if dependencies are installed...
echo  2. Checking if the .env.local file exists...
echo.

REM Verifica se a pasta node_modules existe
if not exist "node_modules" (
    echo [!] node_modules not found. Installing dependencies...
    npm install
) else (
    echo [OK] Dependencies already installed.
)

REM Verifica se o arquivo .env.local existe
if not exist ".env.local" (
    echo [ERROR] .env.local file NOT found!
    echo Please create this file with your API_KEY before continuing.
    pause
    exit /b
) else (
    echo [OK] .env.local file found.
)

echo.
echo Starting the server...
REM Open browser to the application (this will run in background)
start http://localhost:5173/
echo.

npm run dev

pause
