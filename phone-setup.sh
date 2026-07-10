#!/usr/bin/env bash
# phone-setup.sh — configura o Age of AI num celular Android (Termux) para:
#   1) ligar sozinho quando o celular reinicia (via Termux:Boot);
#   2) ter botões "Ligar"/"Desligar" na tela inicial (via Termux:Widget).
# Rode UMA vez no Termux:  bash phone-setup.sh
# Requer os apps complementares Termux:Boot e Termux:Widget instalados (F-Droid).
set -e
REPO="$(cd "$(dirname "$0")" && pwd)"

# 1) Auto-start no boot — o Termux:Boot executa tudo em ~/.termux/boot/
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/ageofai <<EOF
#!/data/data/com.termux/files/usr/bin/sh
# Sobe o Age of AI quando o celular liga.
exec bash "$REPO/start.sh"
EOF
chmod +x ~/.termux/boot/ageofai

# 2) Botões na tela inicial — o Termux:Widget lista os scripts de ~/.shortcuts/
mkdir -p ~/.shortcuts
cat > ~/.shortcuts/"Ligar Age of AI" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
bash "$REPO/start.sh"
EOF
cat > ~/.shortcuts/"Desligar Age of AI" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
bash "$REPO/stop.sh"
EOF
chmod +x ~/.shortcuts/*

echo "OK! Configurado:"
echo "  - Auto-start no boot: ~/.termux/boot/ageofai"
echo "  - Botoes: ~/.shortcuts/ (Ligar / Desligar Age of AI)"
echo "Falta: abrir o app Termux:Boot 1x e adicionar o widget do Termux:Widget na tela inicial."
