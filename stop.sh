#!/usr/bin/env bash
# stop.sh — desliga o Age of AI (servidor + túnel). Uso (Termux/Linux): bash stop.sh
pkill -f 'cloudflared tunnel' 2>/dev/null || true
pkill -f 'tsx src/index.ts'  2>/dev/null || true
pkill -f 'npm run start'     2>/dev/null || true
termux-wake-unlock 2>/dev/null || true
echo "Age of AI: servidor e túnel encerrados."
