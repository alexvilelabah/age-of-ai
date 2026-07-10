# Hospedar o Age of AI pela internet

O jogo tem um **servidor autoritativo** (Node/WebSocket), então não basta um host estático:
precisa de algo que rode Node. A forma mais simples e gratuita é usar um **Cloudflare Tunnel**,
que expõe o servidor local com HTTPS **sem abrir porta no roteador** e escondendo seu IP.

## Pré-requisitos

- **Node.js 20+**
- **`cloudflared`** (binário do Cloudflare Tunnel). Baixe em
  <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
  e coloque o `cloudflared.exe` na raiz do projeto (ele é ignorado pelo git de propósito).

---

## Opção A — Link temporário (mais simples, sem conta)

Dê dois cliques em **`jogar-online.bat`**. Ele sobe servidor + cliente e cria um túnel anônimo;
em segundos aparece um link `https://…trycloudflare.com` (copiado para a área de transferência).

- ✅ Não precisa de conta nem domínio.
- ⚠️ A URL é **aleatória e muda a cada execução** — não serve para divulgar.

## Opção B — Domínio fixo (modo produção, recomendado para divulgar)

Serve o jogo **já buildado** (`client/dist`) por um único servidor Node, sempre no mesmo
endereço. Só o jogo pronto fica exposto (não o servidor de desenvolvimento nem o código-fonte).

**1. Uma vez:** registre um domínio (o [Cloudflare Registrar](https://domains.cloudflare.com/)
vende a preço de custo) e rode **`configurar-dominio.bat`**. Ele faz:

```
cloudflared tunnel login          # autoriza na sua conta (abre o navegador)
cloudflared tunnel create ageofai # cria o túnel
cloudflared tunnel route dns ageofai SEU_DOMINIO.com
```

**2. Sempre que quiser hospedar:** dê dois cliques em **`jogar-online-fixo.bat`**. Ele builda o
jogo, sobe o servidor de produção (porta 8080) e conecta o túnel → abre `https://SEU_DOMINIO.com`.

> **Fork?** Troque `playageofai.com` e o nome do túnel (`ageofai`) nos arquivos
> `configurar_dominio.ps1` e `abrir_online_fixo.ps1` pelo seu domínio/túnel.

O servidor só fica no ar **enquanto o `jogar-online-fixo.bat` estiver aberto**. Feche a janela e
o site sai do ar.

---

## Hospedar 24/7 num celular Android (Termux)

Um celular antigo plugado vira um servidor sempre-ligado, de graça, sem depender do PC.

1. Instale o **Termux** pelo [F-Droid](https://f-droid.org/packages/com.termux/) (não pela Play Store).
2. No Termux: `pkg install nodejs git`, clone o repositório, `npm install`.
3. Copie a pasta de credenciais do túnel do PC (`C:\Users\SEU_USUARIO\.cloudflared\`) para o
   `~/.cloudflared/` do celular — assim o **mesmo domínio** funciona no celular.
4. Rode o servidor de produção (`npm run build -w client` e `npm run start -w server`) e o túnel
   (`cloudflared tunnel run --url http://127.0.0.1:8080 ageofai`).
5. Para não ser morto pelo Android: `termux-wake-lock`, Termux com bateria **"sem restrição"**, e
   **Termux:Boot** para iniciar sozinho após reiniciar. Deixe o celular plugado.

### Trocar entre PC e celular

O domínio "aponta para o túnel", não para uma máquina específica. As credenciais em
`~/.cloudflared/` são o "chip": rode o túnel **só num aparelho por vez** (senão viram dois mundos
de jogo separados). Para migrar, encerre num e suba no outro — a URL continua a mesma.
