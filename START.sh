#!/bin/bash

echo "======================================================"
echo "  Iniciando o App de Ditado com Gemini AI"
echo "======================================================"
echo
echo "Verificações antes de iniciar:"
echo "  1. Verificando se dependências estão instaladas..."
echo "  2. Verificando se o arquivo .env.local existe..."
echo

# Verifica se node_modules existe
if [ ! -d "node_modules" ]; then
    echo "[!] node_modules não encontrada. Instalando dependências..."
    npm install
else
    echo "[OK] Dependências já instaladas."
fi

# Verifica se .env.local existe
if [ ! -f ".env.local" ]; then
    echo "[ERRO] Arquivo .env.local NÃO encontrado!"
    echo "Por favor, crie esse arquivo com sua API_KEY antes de continuar."
    read -p "Pressione Enter para sair..."
    exit 1
else
    echo "[OK] Arquivo .env.local encontrado."
fi

echo
echo "Iniciando o servidor..."
echo

npm run dev

read -p "Pressione Enter para sair..."
