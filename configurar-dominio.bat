@echo off
rem Configura UMA VEZ o dominio fixo playageofai.com no Cloudflare Tunnel.
rem Da dois cliques neste arquivo e siga as instrucoes (autorize no navegador).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar_dominio.ps1"
echo.
pause
