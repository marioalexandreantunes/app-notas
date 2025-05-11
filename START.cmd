@echo off
echo ======================================================
echo   Iniciando o App de Ditado com Gemini AI
echo ======================================================
echo.
echo Verificações antes de iniciar:
echo  1. Verificando se dependências estão instaladas...
echo  2. Verificando se o arquivo .env.local existe...
echo.

REM Verifica se a pasta node_modules existe
if not exist "node_modules" (
    echo [!] node_modules não encontrada. Instalando dependências...
    npm install
) else (
    echo [OK] Dependências já instaladas.
)

REM Verifica se o arquivo .env.local existe
if not exist ".env.local" (
    echo [ERRO] Arquivo .env.local NÃO encontrado!
    echo Por favor, crie esse arquivo com sua API_KEY antes de continuar.
    pause
    exit /b
) else (
    echo [OK] Arquivo .env.local encontrado.
)

echo.
echo Iniciando o servidor...
echo.

npm run dev

pause
