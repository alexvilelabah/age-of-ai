# Sobe o Browser Empires (servidor + cliente) e abre um tunel publico da Cloudflare.
# O tunel aponta para o Vite (porta 5199), que faz proxy do WebSocket /ws -> 8080,
# entao tudo passa por uma unica origem HTTPS (funciona atraves do tunel).
# Feche esta janela (ou Ctrl+C) para encerrar servidor, cliente e tunel.

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Browser Empires - Online (Cloudflare Tunnel)"

$cloudflared = Join-Path $PSScriptRoot "cloudflared.exe"
$linkFile = Join-Path $PSScriptRoot "link_temporario.txt"

if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw "cloudflared.exe nao encontrado nesta pasta."
}

if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "Instalando dependencias (so na primeira vez)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Falha no npm install." }
}

Remove-Item -LiteralPath $linkFile -ErrorAction SilentlyContinue

# Libera as portas do jogo caso uma execucao anterior tenha ficado presa nelas
# (evita o travamento em "Aguardando o jogo subir..." por porta ocupada).
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

# --- Abertura robusta do link publico ------------------------------------
# O link *.trycloudflare.com aparece no log na hora, mas o DNS desse subdominio
# novo leva alguns segundos para propagar. Abrir o navegador cedo demais mostra
# "site nao encontrado" (parece que quebrou). Estas funcoes esperam o tunel
# responder de verdade antes de abrir, e tem fallback quando o DNS da rede
# ainda esta atrasado (forca o IP direto no navegador).

function Wait-CloudflareDns($HostName, $TimeoutSeconds = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $answer = Resolve-DnsName -Name $HostName -Type A -Server "1.1.1.1" -ErrorAction Stop |
                Where-Object { $_.IPAddress } | Select-Object -First 1
            if ($answer) { return $answer.IPAddress }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return $null
}

function Test-PublicSite($Link, $IpAddress) {
    # Usa curl --resolve para testar o link mesmo que o DNS local ainda nao ache.
    $hostName = ([Uri]$Link).Host
    $resolveRule = "$hostName`:443:$IpAddress"
    try {
        $output = & curl.exe -L --resolve $resolveRule --max-time 15 --silent --show-error --write-out "`nHTTP_STATUS:%{http_code}`n" $Link 2>&1
        $text = ($output | Out-String)
        if ($text -match "HTTP_STATUS:(\d+)") { return [int]$Matches[1] }
    } catch {}
    return 0
}

function Wait-PublicSite($Link, $IpAddress, $TimeoutSeconds = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ((Test-PublicSite -Link $Link -IpAddress $IpAddress) -eq 200) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-DefaultDns($HostName) {
    try {
        $answer = Resolve-DnsName -Name $HostName -Type A -ErrorAction Stop |
            Where-Object { $_.IPAddress } | Select-Object -First 1
        return [bool]$answer
    } catch { return $false }
}

function Open-GameLink($Link, $IpAddress) {
    $hostName = ([Uri]$Link).Host
    # Se o DNS normal do Windows ja acha o link, abre direto.
    if (Test-DefaultDns -HostName $hostName) { Start-Process $Link; return }
    # Senao, abre Edge/Chrome forcando o IP (contorna o atraso do DNS da rede).
    $browser = Get-Command "msedge.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $browser) { $browser = Get-Command "chrome.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($browser) {
        Write-Host " O DNS desta rede ainda nao acha o link; abrindo com regra temporaria..." -ForegroundColor Yellow
        Start-Process -FilePath $browser.Source -ArgumentList @("--new-window", "--host-resolver-rules=MAP $hostName $IpAddress", $Link)
        return
    }
    Write-Host " Abra o link manualmente (esta salvo em link_temporario.txt)." -ForegroundColor Yellow
}

Write-Host "Iniciando o servidor do jogo (porta 8080)..." -ForegroundColor Cyan
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/k npm run dev:server" -PassThru -WindowStyle Minimized
Write-Host "Iniciando o cliente web (porta 5199)..." -ForegroundColor Cyan
$client = Start-Process -FilePath "cmd.exe" -ArgumentList "/k npm run dev:client" -PassThru -WindowStyle Normal

try {
    Write-Host "Aguardando o jogo subir (pode demorar na primeira vez)..." -ForegroundColor Yellow
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            # Com host:true no Vite (escuta 0.0.0.0), 127.0.0.1 responde de forma
            # rapida e deterministica (IPv4, sem a lentidao/timeout do IPv6 ::1).
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5199" -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        }
        catch {
            if ($client.HasExited) { throw "O cliente (Vite) encerrou inesperadamente." }
        }
    }
    if (-not $ready) { throw "O cliente (Vite) nao respondeu na porta 5199 a tempo." }

    Write-Host ""
    Write-Host "Jogo local pronto: http://localhost:5199" -ForegroundColor Green
    Write-Host "Aguardando a Cloudflare gerar o link publico (aparece em segundos)..." -ForegroundColor Yellow
    Write-Host "Para parar TUDO, aperte Ctrl+C ou feche esta janela." -ForegroundColor Yellow
    Write-Host ""

    $lastLink = $null
    $opened = $false
    $ErrorActionPreference = "Continue"

    # Os tuneis GRATIS da Cloudflare as vezes falham na hora de serem criados
    # ("unexpected EOF" ao falar com api.trycloudflare.com) - e instabilidade do
    # servidor DELES, nao do jogo. Costuma ser temporario, entao tentamos algumas
    # vezes antes de desistir.
    $maxTries = 5
    for ($try = 1; $try -le $maxTries; $try++) {
        $script:tunnelUp = $false
        & $cloudflared tunnel --url http://127.0.0.1:5199 --no-autoupdate 2>&1 | ForEach-Object {
            $line = $_.ToString()
            # IMPORTANTE: 'api.trycloudflare.com' e o endereco INTERNO que o cloudflared
            # usa para PEDIR o tunel (aparece no log antes do link real) - ignorar. O
            # link publico verdadeiro e um subdominio aleatorio (varias palavras).
            if ($line -match "https://[a-z0-9-]+\.trycloudflare\.com" -and $Matches[0] -ne "https://api.trycloudflare.com") {
                $script:tunnelUp = $true
                $link = $Matches[0]
                if ($link -ne $lastLink) {
                    $lastLink = $link
                    Set-Content -LiteralPath $linkFile -Value $link -Encoding ASCII
                    try { Set-Clipboard -Value $link } catch {}
                    Write-Host ""
                    Write-Host "===============================================================" -ForegroundColor Green
                    Write-Host " LINK PUBLICO DO JOGO:" -ForegroundColor Green
                    Write-Host "   $link" -ForegroundColor White
                    Write-Host ""
                    Write-Host " - Copiado para a area de transferencia e salvo em link_temporario.txt" -ForegroundColor Green
                    Write-Host " - Compartilhe SO com quem voce quer que jogue (qualquer um" -ForegroundColor Green
                    Write-Host "   com o link consegue entrar enquanto esta janela estiver aberta)." -ForegroundColor Green
                    Write-Host " - Para uma partida sao necessarios 2 jogadores." -ForegroundColor Green
                    Write-Host "===============================================================" -ForegroundColor Green
                    Write-Host ""
                    if (-not $opened) {
                        $opened = $true
                        Write-Host " Aguardando o DNS/tunel ficarem prontos (alguns segundos)..." -ForegroundColor Yellow
                        $ip = Wait-CloudflareDns -HostName ([Uri]$link).Host -TimeoutSeconds 90
                        if ($ip -and (Wait-PublicSite -Link $link -IpAddress $ip -TimeoutSeconds 90)) {
                            Write-Host " Tunel confirmado (HTTP 200). Abrindo o jogo no navegador..." -ForegroundColor Green
                            Open-GameLink -Link $link -IpAddress $ip
                        } else {
                            Write-Host " O link foi criado, mas ainda nao respondeu. Aguarde alguns" -ForegroundColor Yellow
                            Write-Host " segundos e abra o link acima manualmente." -ForegroundColor Yellow
                        }
                    }
                }
            }
            Write-Host $line
        }
        # cloudflared encerrou. Se o tunel chegou a subir, foi fechado/derrubado
        # (nao insiste). Se NUNCA subiu, foi falha ao criar -> tenta de novo.
        if ($script:tunnelUp) { break }
        if ($try -lt $maxTries) {
            Write-Host ""
            Write-Host " A Cloudflare recusou o tunel agora (instabilidade do servidor DELES," -ForegroundColor Yellow
            Write-Host " nao e o seu jogo nem conflito de arquivo). Tentando de novo ($try de $maxTries)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 4
        } else {
            Write-Host ""
            Write-Host "===============================================================" -ForegroundColor Red
            Write-Host " Nao consegui criar o tunel apos $maxTries tentativas." -ForegroundColor Red
            Write-Host " Quase sempre e instabilidade dos tuneis GRATIS da Cloudflare." -ForegroundColor Yellow
            Write-Host " O que fazer:" -ForegroundColor Yellow
            Write-Host "   1) Espere 1-2 minutos e rode este arquivo de novo." -ForegroundColor Yellow
            Write-Host "   2) Se tiver VPN ou proxy ligado, desligue e tente." -ForegroundColor Yellow
            Write-Host "   3) O jogo LOCAL continua funcionando em http://localhost:5199" -ForegroundColor Yellow
            Write-Host "===============================================================" -ForegroundColor Red
        }
    }
}
finally {
    Write-Host ""
    Write-Host "Encerrando servidor, cliente e tunel..." -ForegroundColor Yellow
    Stop-Tree $client
    Stop-Tree $server
    Remove-Item -LiteralPath $linkFile -ErrorAction SilentlyContinue
}
