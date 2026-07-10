@echo off
rem Abre o Age of AI pela internet no dominio FIXO https://playageofai.com
rem (rode "configurar-dominio.bat" uma vez antes). Feche a janela para encerrar.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0abrir_online_fixo.ps1"
echo.
echo Tunel encerrado.
pause
