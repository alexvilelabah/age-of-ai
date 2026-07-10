# Hosting Age of AI over the internet

The game has an **authoritative server** (Node/WebSocket), so a static host isn't enough:
you need something that runs Node. The simplest and free option is a **Cloudflare Tunnel**,
which exposes your local server over HTTPS **without opening a port on your router** and hides your IP.

## Prerequisites

- **Node.js 20+**
- **`cloudflared`** (the Cloudflare Tunnel binary). Download it from
  <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
  and put `cloudflared.exe` in the project root (it's gitignored on purpose).

---

## Option A — Temporary link (simplest, no account)

Double-click **`jogar-online.bat`**. It starts the server + client and creates an anonymous tunnel;
within seconds a `https://…trycloudflare.com` link appears (copied to your clipboard).

- ✅ No account or domain needed.
- ⚠️ The URL is **random and changes every run** — not suitable for sharing publicly.

## Option B — Fixed domain (production mode, recommended for sharing)

Serves the **pre-built** game (`client/dist`) from a single Node server, always at the same
address. Only the finished game is exposed (not the dev server or the source code).

**1. Once:** register a domain (the [Cloudflare Registrar](https://domains.cloudflare.com/)
sells at cost) and run **`configurar-dominio.bat`**. It runs:

```
cloudflared tunnel login          # authorize on your account (opens the browser)
cloudflared tunnel create ageofai # create the tunnel
cloudflared tunnel route dns ageofai YOUR_DOMAIN.com
```

**2. Whenever you want to host:** double-click **`jogar-online-fixo.bat`**. It builds the
game, starts the production server (port 8080) and connects the tunnel → opens `https://YOUR_DOMAIN.com`.

> **Forking?** Replace `playageofai.com` and the tunnel name (`ageofai`) in the files
> `configurar_dominio.ps1` and `abrir_online_fixo.ps1` with your own domain/tunnel.

The server is only online **while `jogar-online-fixo.bat` is open**. Close the window and
the site goes offline.

---

## Hosting 24/7 on an Android phone (Termux)

An old phone left plugged in becomes an always-on server, for free, without relying on your PC.

1. Install **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) (not the Play Store).
2. In Termux: `pkg install nodejs git`, clone the repository, `npm install`.
3. Copy the tunnel credentials folder from your PC (`C:\Users\YOUR_USER\.cloudflared\`) to the
   phone's `~/.cloudflared/` — that way the **same domain** works on the phone.
4. Run the production server (`npm run build -w client` and `npm run start -w server`) and the tunnel
   (`cloudflared tunnel run --url http://127.0.0.1:8080 ageofai`).
5. To keep Android from killing it: `termux-wake-lock`, set Termux battery to **"unrestricted"**, and
   **Termux:Boot** to start automatically after a reboot. Keep the phone plugged in.

### Switching between PC and phone

The domain "points to the tunnel", not to a specific machine. The credentials in
`~/.cloudflared/` are the "SIM card": run the tunnel on **only one device at a time** (otherwise you
get two separate game worlds). To migrate, stop it on one and start it on the other — the URL stays the same.
