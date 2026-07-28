#!/usr/bin/env bash
# stop.sh — desliga o Age of AI (servidor + túnel). Uso (Termux/Linux): bash stop.sh
#
# CONFERE que morreu mesmo, e sai com erro se não morreu. Não é preciosismo:
# antes ele só mandava o sinal e dava "ok". Quando o kill falhava, o start.sh
# logo depois subia um servidor novo que NÃO conseguia pegar a porta 8080 (o
# velho ainda estava lá) — e o teste de saúde do deploy passava, porque o
# processo ANTIGO respondia. Resultado: o deploy anunciava "no ar!" com o código
# velho rodando. Sai com erro pra quem chamou poder parar em vez de mentir.
# 'dist/index.js' = o servidor buildado (o normal em produção); 'src/index.ts' =
# o mesmo servidor rodando do fonte por tsx (`npm run start:tsx` / `npm run dev`).
# Os dois estão aqui de propósito: esquecer um deixaria o servidor vivo e o
# start.sh seguinte subiria um natimorto por cima.
PADROES=('cloudflared tunnel' 'dist/index.js' 'src/index.ts' 'npm run start')

vivos() {
  local p n=0
  for p in "${PADROES[@]}"; do
    n=$((n + $(pgrep -f "$p" 2>/dev/null | wc -l)))
  done
  echo "$n"
}

for p in "${PADROES[@]}"; do pkill -f "$p" 2>/dev/null || true; done

# Dá um tempo pra sair sozinho; se teimar, insiste com -9.
for _ in 1 2 3 4 5; do
  [ "$(vivos)" -eq 0 ] && break
  sleep 1
done
if [ "$(vivos)" -ne 0 ]; then
  for p in "${PADROES[@]}"; do pkill -9 -f "$p" 2>/dev/null || true; done
  sleep 2
fi

termux-wake-unlock 2>/dev/null || true

if [ "$(vivos)" -ne 0 ]; then
  echo "ERRO: sobrou processo vivo depois do kill -9:" >&2
  for p in "${PADROES[@]}"; do pgrep -af "$p" 2>/dev/null; done >&2
  exit 1
fi

# A porta livre é a prova final: com ela ocupada, o start.sh sobe um servidor
# natimorto e o antigo segue atendendo.
if curl -sf -m 3 http://127.0.0.1:8080/status >/dev/null 2>&1; then
  echo "ERRO: a porta 8080 ainda responde — tem outro servidor de pé." >&2
  exit 1
fi

echo "Age of AI: servidor e túnel encerrados."
