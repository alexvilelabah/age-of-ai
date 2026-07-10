@echo off
title Browser Empires
cd /d "%~dp0"

rem Instala dependencias na primeira execucao
if not exist node_modules (
    echo Instalando dependencias ^(so na primeira vez^)...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERRO: falha no npm install. Verifique se o Node.js 20+ esta instalado.
        pause
        exit /b 1
    )
)

echo Iniciando o servidor do jogo (porta 8080)...
start "Browser Empires - Servidor" cmd /k "cd /d %~dp0 && npm run dev:server"

echo Iniciando o cliente web (porta 5199)...
start "Browser Empires - Cliente" cmd /k "cd /d %~dp0 && npm run dev:client"

echo Aguardando os servidores subirem...
timeout /t 6 /nobreak >nul

echo Abrindo o jogo no navegador...
start http://localhost:5199

echo.
echo ============================================================
echo  Jogo aberto! Para uma partida sao necessarios 2 jogadores:
echo  abra OUTRA aba do navegador em http://localhost:5199
echo  (ou acesse de outro PC da rede pelo IP desta maquina).
echo.
echo  Para encerrar o jogo, feche as duas janelas de terminal
echo  "Browser Empires - Servidor" e "Browser Empires - Cliente".
echo ============================================================
echo.
pause
