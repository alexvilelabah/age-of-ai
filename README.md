# Age of AI

Jogo de estratégia em tempo real (RTS) **multiplayer para navegador**, inspirado nas mecânicas clássicas do gênero (Age of Empires / Age of Mythology): coleta de recursos, construção de base, avanço de eras, treinamento de unidades e combate. Todo o conteúdo é original — arte e trilha geradas por IA, código e balanceamento próprios. Projeto **open source**, feito por diversão e com a ajuda de IA.

🎮 **Jogar agora:** **[playageofai.com](https://playageofai.com)**
*(demo ao vivo — pode estar fora do ar quando o servidor não está ligado)*

> Roda 100% no navegador, em Canvas 2D isométrico. Sem downloads, sem plugins.

## Requisitos

- Node.js **20+**
- npm 10+

## Como rodar localmente

```bash
npm install

# Terminal 1 — servidor (WebSocket na porta 8080)
npm run dev:server

# Terminal 2 — cliente (Vite na porta 5199)
npm run dev:client
```

Atalho no Windows: dê dois cliques em **`iniciar.bat`** — instala as dependências (na primeira vez), sobe servidor e cliente e abre o jogo no navegador.

Abra `http://localhost:5199` em **duas ou mais abas/máquinas** (mínimo 2 jogadores) — ou jogue sozinho contra um **bot** (adicione um oponente de IA na sala). Crie uma sala, marque "Pronto" e o host inicia a partida.

## Hospedar pela internet

Dá para expor o jogo publicamente com um túnel Cloudflare (HTTPS, sem abrir porta no roteador). Há duas formas:

- **Rápido (link temporário):** dê dois cliques em **`jogar-online.bat`** → gera um link `https://…trycloudflare.com` (muda a cada execução).
- **Domínio fixo (modo produção):** rode **`configurar-dominio.bat`** uma vez e depois use **`jogar-online-fixo.bat`** → serve o jogo já buildado no seu próprio domínio, sempre no mesmo endereço.

Passo a passo completo (incluindo hospedar num celular Android 24/7 via Termux) em **[DEPLOY.md](DEPLOY.md)**.

## Outros comandos

```bash
npm run typecheck   # checagem de tipos de servidor + cliente
npm run build       # build de produção do cliente (client/dist)
npm run smoke       # teste E2E: sobe o servidor e simula uma partida com 2 clientes WebSocket
```

## Arquitetura

```
shared/   Contrato compartilhado (TypeScript puro, sem dependências)
          ├─ types.ts      — tipos de entidades e snapshots
          ├─ constants.ts  — balanceamento (custos, HP, velocidades, mapa, ticks)
          └─ protocol.ts   — mensagens ClientMessage/ServerMessage (JSON via WebSocket)

server/   Backend Node.js + TypeScript + ws — SERVIDOR AUTORITATIVO
          ├─ HTTP: serve o cliente buildado (client/dist) em produção
          ├─ Lobby: salas, ready-check, chat, migração de host
          └─ Simulação: loop de 10 ticks/s, A* para pathfinding,
             máquinas de estado (coleta → depósito, construção, combate),
             validação de todos os comandos no servidor

client/   Frontend Vite + TypeScript + Canvas 2D (isométrico dimétrico 2:1)
          ├─ Telas DOM: nome → lobby → sala → jogo → fim de partida
          ├─ Renderização com sprites (arte gerada por IA) + interpolação entre snapshots
          └─ HUD: recursos, população, minimapa, painel de seleção e ações
```

### Decisões técnicas

- **WebSocket (`ws`)** para comunicação tempo real bidirecional no navegador.
- **Servidor autoritativo**: o cliente envia apenas *intenções* (`move`, `gather`, `build`, `train`, `attack`…); toda a simulação e validação acontecem no servidor — trapaça por cliente modificado não afeta o estado.
- **Snapshots completos a 5 Hz** com interpolação visual: simples, robusto (perda de mensagem não corrompe estado) e suficiente para o tamanho de partida.
- **Monorepo com pacote `shared`**: um único lugar define protocolo e balanceamento; servidor e cliente não divergem silenciosamente.

## Como jogar

| Ação | Controle |
|---|---|
| Selecionar | Clique esquerdo / arrastar caixa (Shift adiciona) |
| Comando contextual | Clique direito (mover, coletar, atacar, construir) |
| Câmera | WASD / setas, arrastar com botão do meio, roda = zoom |
| Centralizar no Centro da Cidade | H |
| Opções (volume, resolução) | engrenagem no canto |
| Chat | Enter |
| Cancelar seleção/construção | Esc |

- **Recursos**: comida, madeira, ouro, pedra — aldeões coletam e depositam no Centro da Cidade.
- **Eras**: avance de era construindo prédios e juntando recursos, desbloqueando novas unidades e construções.
- **Vitória**: destrua todos os Centros da Cidade inimigos.

## Contribuindo

Contribuições são **muito bem-vindas** — é um projeto de hobby, aberto pra quem quiser ajudar a melhorar. Abra uma *issue* com ideias/bugs ou mande um *pull request*. 🙂

## Licença

[MIT](LICENSE) — use, modifique e compartilhe à vontade.
