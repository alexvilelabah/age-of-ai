@echo off
rem Abre o Browser Empires para jogar pela internet (tunel Cloudflare).
rem Da dois cliques neste arquivo. Feche a janela para encerrar tudo.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0abrir_online.ps1"
echo.
echo Tunel encerrado.
pause
