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

# Segredos LOCAIS (não versionados — ficam só no aparelho, fora do GitHub):
# a senha do painel /sistema (MONITOR_KEY) e afins. Crie ~/.age_env com, ex.:
#   export MONITOR_KEY=suaSenhaForte
[ -f "$HOME/.age_env" ] && . "$HOME/.age_env"

# Mantém CPU/rede acordadas — ESSENCIAL num celular (senão o Android dorme e o
# servidor cai). Sem efeito fora do Termux.
termux-wake-lock 2>/dev/null || true

# Garante o build de produção do cliente (client/dist).
if [ ! -f client/dist/index.html ]; then
  echo "[start] gerando build de produção do cliente..."
  npm run build -w client
fi

# SEMPRE tenta reconstruir o servidor (leva ~15 ms). Assim é impossível rodar
# código velho sem perceber: o que está no ar é sempre o que está no fonte.
#
# Por que o servidor é BUILDADO e não roda direto do TypeScript: rodar com `tsx`
# mantém um processo esbuild vivo pra sempre só pra transpilar em tempo real —
# medido no celular, ele gastava 0,47% de CPU parado (MAIS que o próprio
# servidor) e uns 30 MB de RAM, 24h por dia, sem fazer nada. Ferramenta de
# desenvolvimento não tem o que fazer em produção.
#
# MAS o build é uma OTIMIZAÇÃO, nunca um requisito: se ele falhar, sobe pelo
# fonte e o site fica no ar do mesmo jeito. Isto não é zelo excessivo — na
# primeira vez que o build entrou, o esbuild não estava instalado no celular
# (o npm do Termux bloqueia postinstall por padrão), o `set -e` abortou o
# start.sh, e o site FICOU FORA DO AR até alguém perceber. Otimização que
# derruba o serviço não vale a CPU que economiza.
echo "[start] compilando o servidor..."
if npm run build -w server && [ -f server/dist/index.js ]; then
  MODO_START="start"        # node dist/index.js — sem esbuild vivo
else
  echo "[start] AVISO: o build falhou. Subindo pelo FONTE (tsx) para não ficar fora" >&2
  echo "        do ar. Isso mantém um esbuild vivo (~0,5% de CPU a mais)." >&2
  echo "        Conserto: 'npm install' e, no Termux, 'npm approve-scripts esbuild'." >&2
  MODO_START="start:tsx"
fi

# Descobre o túnel pelas credenciais em ~/.cloudflared (sem ID fixo no código).
CREDS="$(ls "$HOME"/.cloudflared/*.json 2>/dev/null | head -1)"
if [ -z "$CREDS" ]; then
  echo "ERRO: faltam as credenciais do túnel em ~/.cloudflared/*.json" >&2
  exit 1
fi
UUID="$(basename "$CREDS" .json)"

# Já tem servidor de pé? Aborta. Sem isto, o node novo não consegue pegar a 8080,
# morre calado, e o ANTIGO segue respondendo — o deploy então "passa" no teste de
# saúde e anuncia sucesso com o código velho no ar. Pare-o com `bash stop.sh`.
if curl -sf -m 3 http://127.0.0.1:8080/status >/dev/null 2>&1; then
  echo "ERRO: a porta 8080 já responde — tem servidor rodando. Rode 'bash stop.sh' antes." >&2
  exit 1
fi

echo "== Age of AI =="
echo "[1/2] subindo o servidor na porta 8080 (modo: $MODO_START)..."
PORT=8080 npm run "$MODO_START" -w server &
SRV=$!

# Encerra o servidor junto se o script for interrompido.
trap 'kill "$SRV" 2>/dev/null || true' EXIT INT TERM

sleep 5
echo "[2/2] conectando o túnel -> https://playageofai.com"
echo "    (deixe esta janela aberta; Ctrl+C encerra tudo)"
cloudflared tunnel run --url http://127.0.0.1:8080 --credentials-file "$CREDS" "$UUID"
