# Sobe o Age of AI em MODO PRODUCAO e abre o tunel FIXO da Cloudflare no endereco
# https://playageofai.com (mesma URL sempre - pode divulgar).
#
# Em producao, UM unico servidor Node (porta 8080) serve o JOGO JA BUILDADO
# (client/dist) + o WebSocket. Assim, ao expor pela internet, so o jogo pronto
# fica acessivel - nao o servidor de desenvolvimento (Vite) nem o codigo-fonte.
#
# Precisa ter rodado "configurar-dominio.bat" UMA vez antes.
# Feche esta janela (ou Ctrl+C) para encerrar servidor e tunel.

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Age of AI - Online (playageofai.com)"

$cloudflared = Join-Path $PSScriptRoot "cloudflared.exe"
$domain      = "playageofai.com"
$tunnelName  = "ageofai"

if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw "cloudflared.exe nao encontrado nesta pasta."
}
if (-not (Test-Path (Join-Path $HOME ".cloudflared\cert.pem"))) {
    throw "Tunel ainda nao configurado. Rode 'configurar-dominio.bat' primeiro (so uma vez)."
}

if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "Instalando dependencias (so na primeira vez)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Falha no npm install." }
}

# Prepara o jogo: gera a versao de producao (client/dist) que o servidor vai servir.
Write-Host "Preparando o jogo (build de producao)..." -ForegroundColor Cyan
npm run build -w client
if ($LASTEXITCODE -ne 0) { throw "Falha ao buildar o cliente (npm run build -w client)." }

# Libera as portas caso uma execucao anterior tenha ficado presa nelas.
function Free-Port($port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "Porta $port estava ocupada (PID $($c.OwningProcess)) - liberando..." -ForegroundColor Yellow
        cmd /c "taskkill /PID $($c.OwningProcess) /T /F" 2>$null | Out-Null
    }
}
Free-Port 8080
Free-Port 5199
Start-Sleep -Milliseconds 500

function Stop-Tree($proc) {
    if ($proc -and -not $proc.HasExited) {
        cmd /c "taskkill /PID $($proc.Id) /T /F" 2>$null | Out-Null
    }
}

Write-Host "Iniciando o servidor de producao (porta 8080)..." -ForegroundColor Cyan
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/k npm run start -w server" -PassThru -WindowStyle Minimized
$tunnel = $null

try {
    Write-Host "Aguardando o jogo subir..." -ForegroundColor Yellow
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080" -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        }
        catch {
            if ($server.HasExited) { throw "O servidor encerrou inesperadamente." }
        }
    }
    if (-not $ready) { throw "O servidor nao respondeu na porta 8080 a tempo." }

    Write-Host ""
    Write-Host "Iniciando o tunel fixo..." -ForegroundColor Cyan
    $tunnel = Start-Process -FilePath $cloudflared `
        -ArgumentList @("tunnel", "run", "--url", "http://127.0.0.1:8080", $tunnelName) `
        -PassThru -WindowStyle Minimized

    Write-Host "Aguardando o tunel conectar..." -ForegroundColor Yellow
    $up = $false
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 2
        if ($tunnel.HasExited) { throw "O cloudflared encerrou. Rode 'configurar-dominio.bat' de novo." }
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "https://$domain" -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $up = $true; break }
        } catch {}
    }

    Write-Host ""
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host " LINK FIXO DO JOGO:  https://$domain" -ForegroundColor White
    Write-Host " (mesmo endereco sempre - pode divulgar no Reddit etc.)" -ForegroundColor Green
    Write-Host " Deixe esta janela ABERTA. Feche para encerrar tudo." -ForegroundColor Yellow
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host ""

    if ($up) {
        Write-Host "Tunel no ar! Abrindo o jogo no navegador..." -ForegroundColor Green
        Start-Process "https://$domain"
    } else {
        Write-Host "O tunel demorou a responder. Abra https://$domain manualmente em alguns segundos." -ForegroundColor Yellow
    }

    # Monitor ao vivo: mostra quantos jogadores estao online, atualizando sozinho
    # quando alguem entra ou sai. Tambem segura a janela aberta e encerra se o
    # tunel cair (fechar a janela encerra tudo pelo bloco finally).
    Write-Host "Monitorando jogadores (a linha atualiza quando alguem entra/sai)..." -ForegroundColor DarkGray
    Write-Host ""
    $lastLine = ""
    while (-not $tunnel.HasExited) {
        Start-Sleep -Seconds 3
        try {
            $s = Invoke-RestMethod -Uri "http://127.0.0.1:8080/status" -TimeoutSec 3
            $line = "Jogadores online: $($s.players)  |  Salas: $($s.rooms)  |  Em partida: $($s.games)"
            if ($line -ne $lastLine) {
                $lastLine = $line
                Write-Host ("[{0}]  {1}" -f (Get-Date -Format "HH:mm:ss"), $line) -ForegroundColor Cyan
            }
        } catch {}
    }
}
finally {
    Write-Host ""
    Write-Host "Encerrando servidor e tunel..." -ForegroundColor Yellow
    Stop-Tree $server
    Stop-Tree $tunnel
}
