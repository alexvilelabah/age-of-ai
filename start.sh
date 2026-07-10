#!/usr/bin/env bash
# start.sh — sobe o Age of AI em produção: servidor (porta 8080, servindo o jogo
# buildado) + túnel Cloudflare (playageofai.com). Feito pra Termux/Linux (ex.: rodar
# o servidor num celular Android 24/7). No Windows use os .bat/.ps1.
#
# Uso:  bash start.sh
# Requer: ~/.cloudflared/<uuid>.json (credenciais do túnel 'ageofai') e o build já
#         feito (npm run build -w client) — o start faz o build se faltar.
set -e
cd "$(cd "$(dirname "$0")" && pwd)"

# Mantém CPU/rede acordadas — ESSENCIAL num celular (senão o Android dorme e o
# servidor cai). Sem efeito fora do Termux.
termux-wake-lock 2>/dev/null || true

# Garante o build de produção do cliente (client/dist).
if [ ! -f client/dist/index.html ]; then
  echo "[start] gerando build de produção..."
  npm run build -w client
fi

# Descobre o túnel pelas credenciais em ~/.cloudflared (sem ID fixo no código).
CREDS="$(ls "$HOME"/.cloudflared/*.json 2>/dev/null | head -1)"
if [ -z "$CREDS" ]; then
  echo "ERRO: faltam as credenciais do túnel em ~/.cloudflared/*.json" >&2
  exit 1
fi
UUID="$(basename "$CREDS" .json)"

echo "== Age of AI =="
echo "[1/2] subindo o servidor na porta 8080..."
PORT=8080 npm run start -w server &
SRV=$!

# Encerra o servidor junto se o script for interrompido.
trap 'kill "$SRV" 2>/dev/null || true' EXIT INT TERM

sleep 5
echo "[2/2] conectando o túnel -> https://playageofai.com"
echo "    (deixe esta janela aberta; Ctrl+C encerra tudo)"
cloudflared tunnel run --url http://127.0.0.1:8080 --credentials-file "$CREDS" "$UUID"
