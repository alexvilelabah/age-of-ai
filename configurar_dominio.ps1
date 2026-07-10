# Configura UMA VEZ o tunel FIXO da Cloudflare para o dominio playageofai.com.
# Depois de rodar isto (e autorizar no navegador), use "jogar-online-fixo.bat".
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Age of AI - Configurar dominio fixo"

$cloudflared = Join-Path $PSScriptRoot "cloudflared.exe"
$domain      = "playageofai.com"
$tunnelName  = "ageofai"

if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw "cloudflared.exe nao encontrado nesta pasta."
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " CONFIGURACAO DO DOMINIO FIXO  ($domain)" -ForegroundColor Cyan
Write-Host " Isto so precisa ser feito UMA vez." -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# --- Passo 1: autorizar o cloudflared na sua conta Cloudflare ------------
Write-Host "[1/3] Autorizando o cloudflared na sua conta Cloudflare..." -ForegroundColor Yellow
Write-Host "      Vai abrir o NAVEGADOR. Escolha o dominio '$domain' e clique Authorize." -ForegroundColor Yellow
& $cloudflared tunnel login
if ($LASTEXITCODE -ne 0) { throw "Falha no login do cloudflared." }

# --- Passo 2: criar o tunel (ignora se ja existir) ----------------------
Write-Host ""
Write-Host "[2/3] Criando o tunel '$tunnelName'..." -ForegroundColor Yellow
$ErrorActionPreference = "Continue"
& $cloudflared tunnel create $tunnelName
$ErrorActionPreference = "Stop"

# --- Passo 3: apontar o dominio para o tunel ----------------------------
Write-Host ""
Write-Host "[3/3] Apontando $domain para o tunel..." -ForegroundColor Yellow
$ErrorActionPreference = "Continue"
& $cloudflared tunnel route dns $tunnelName $domain
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host " PRONTO! Dominio fixo configurado." -ForegroundColor Green
Write-Host " Agora, para jogar/hospedar, use:  jogar-online-fixo.bat" -ForegroundColor Green
Write-Host " O endereco sera SEMPRE: https://$domain" -ForegroundColor White
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""
