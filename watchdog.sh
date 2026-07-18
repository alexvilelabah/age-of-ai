#!/data/data/com.termux/files/usr/bin/bash
# watchdog.sh — cão de guarda do Age of AI.
#
# A cada N minutos pergunta ao servidor "você está vivo?" (curl no localhost:8080).
# Se não responder, sobe tudo de novo pelo start.sh. Cobre o buraco que derrubou o
# site em 18/07/2026: a rede ficou saturada por horas (download gigante no Wi-Fi de
# casa), o Android matou o servidor E o túnel de uma vez, e como NÃO houve reboot o
# Termux:Boot não reergueu nada — o site ficou fora do ar até restart manual.
#
# Por que funciona mesmo quando o Android mata o servidor: este script é minúsculo
# (dorme 99% do tempo), então é dos ÚLTIMOS que o Android escolhe matar sob pressão
# de memória — o servidor Node, que come muito mais RAM, vai primeiro. O cão de
# guarda sobrevive e o ressuscita sozinho em até um intervalo.
#
# Roda como um 2º item do Termux:Boot, ao lado do start.sh — de propósito são
# processos independentes: se um cai, o outro continua.
#
# Uso:  bash watchdog.sh              (intervalo padrão: 5 min)
#       WATCHDOG_INTERVAL=600 bash watchdog.sh   (troca pra 10 min)
cd "$(cd "$(dirname "$0")" && pwd)"
termux-wake-lock 2>/dev/null || true

INTERVAL="${WATCHDOG_INTERVAL:-300}"   # segundos entre checagens (300 = 5 min)
LOG="$HOME/watchdog.log"
say() { echo "[watchdog $(date '+%F %T')] $*" >> "$LOG"; }

say "no ar (checa a cada ${INTERVAL}s)"

while true; do
  # Dorme PRIMEIRO: no boot, dá tempo do start.sh subir o servidor antes da 1ª
  # checagem — assim o cão de guarda não tenta subir um 2º por engano.
  sleep "$INTERVAL"

  # Vivo? (-f: falha em erro HTTP; -s: silencioso). Se sim, volta a dormir.
  curl -sf -m 10 http://127.0.0.1:8080/status >/dev/null 2>&1 && continue

  say "servidor NÃO respondeu -> reiniciando"
  # Limpa restos pra não subir túnel/servidor duplicado (caso um pedaço tenha
  # sobrevivido). Matar o cloudflared faz o start.sh antigo se desenrolar sozinho.
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  pkill -f "src/index.ts"       2>/dev/null || true
  pkill -f "npm run start"      2>/dev/null || true
  sleep 2
  # nohup: o start.sh novo não morre junto se este cão de guarda for morto depois.
  nohup bash start.sh >> "$LOG" 2>&1 &
  sleep 30   # deixa o servidor subir antes de a próxima volta checar de novo
done
