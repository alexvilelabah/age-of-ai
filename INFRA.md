# Mapa do sistema — playageofai.com

Leia isto **antes de mexer em qualquer coisa de servidor**. É o mapa de tudo que está no ar:
o que roda onde, quem serve cada URL, e como publicar sem quebrar.

> Para quem chega agora (humano ou IA): este arquivo existe para você **não** precisar
> reconstruir o contexto perguntando. Se algo aqui divergir da realidade, a realidade ganha —
> e corrija este arquivo.

## O essencial em 30 segundos

Um **celular Android** (Samsung S22 Ultra, Termux) roda **um único processo Node** que serve
**tudo** do site, e um **túnel Cloudflare** liga esse processo ao domínio. Não há servidor na
nuvem, não há porta aberta no roteador. O PC só **gera** conteúdo e **publica** pelo cabo USB.

```
navegador → playageofai.com → Cloudflare → túnel → celular:8080 → node (server/src/index.ts)
```

## Quem serve cada URL

Tudo sai do **mesmo processo** ([server/src/index.ts](server/src/index.ts)):

| URL | O que é | De onde vem |
|---|---|---|
| `/` | o jogo Age of AI (SPA) | `client/dist/` — buildado deste repo |
| `/ws` (WebSocket) | lobby e partidas do Age of AI | `server/src/lobby.ts` |
| `/online-games/` | coleção de joguinhos HTML | pasta `online-games/` — **não versionada aqui** |
| `/online-games/ws/<slug>` (WebSocket) | multiplayer dos joguinhos | `server/src/online-games-ws.ts` |
| `/status` | contagem ao vivo (público) | — |
| `/sistema?k=<senha>` | painel de métricas (privado) | senha na env `MONITOR_KEY`, em `~/.age_env` no celular |

**Regra de ouro do roteamento:** `/online-games/...` tem que ser resolvido **antes** do
fallback da SPA. Sem isso, qualquer URL errada devolveria 200 com a página do Age of AI
(soft-404). Já quebrou uma vez; tem verificação no deploy.

## Onde mora cada projeto (fonte de verdade)

| Projeto | Pasta no PC | GitHub | Papel |
|---|---|---|---|
| **Age of AI** (o servidor de tudo) | `D:\age` | [age-of-ai](https://github.com/alexvilelabah/age-of-ai) — **público** | jogo + servidor HTTP/WS |
| **Coleção de jogos** | `D:\projetos\jogos-html` | `jogos-html` — **privado** | gera a pasta `online-games/` (ver `DEPLOY.md` de lá) |
| **Cube Range** (jogo de tiro) | `D:\projetos\tiro` | `cube-range` — **privado** | fonte do único jogo próprio da coleção |

Só o Age of AI é **público**. Os outros dois são privados de propósito: servem de backup, não
de publicação — os joguinhos da coleção são de outras pessoas e não há por que redistribuí-los.
Por isso `jogos-fonte/` e `publico/` ficam fora do git: sobem só ~350 KB de código próprio.

Auditoria antes do 1º push (28/07): nenhum segredo nos 30 arquivos. As credenciais do túnel
vivem em `~/.cloudflared/` no celular, fora de qualquer repositório. **Se um dia abrir esses
repositórios**, revise antes: o UUID do túnel citado no `DEPLOY.md` (identificador, não senha —
mas é permanente) e a procedência do áudio embutido no `index.html` do Cube Range.

A pasta `online-games/` fica no `.gitignore` deste repo de propósito (~50 MB de conteúdo de
terceiros). Ela chega no celular por **cópia pelo cabo**, não por `git pull`.

## Como adicionar um jogo multiplayer novo

**Não se mexe no servidor.** O serviço de salas já é genérico:

1. O jogo (HTML/JS) entra na coleção, com um `slug` (o nome da pasta).
2. O cliente dele conecta em `wss://<host>/online-games/ws/<slug>`.
3. Pronto. A sala nasce na primeira conexão e some quando o último jogador sai.

O protocolo está documentado no topo de
[server/src/online-games-ws.ts](server/src/online-games-ws.ts). Limites: 16 jogadores por sala,
24 salas. Cada slug é uma sala isolada — um jogo não vê o outro.

**Custo quando ninguém está jogando: zero.** Os temporizadores só existem enquanto há
jogador (travado por `scripts/onlinegames_ws_test.ts`). Isso é intencional: o servidor é um
celular. Se for mexer nesse arquivo, **não volte a criar `setInterval` de topo de módulo.**

## Operar o celular (a tela está QUEBRADA — só por ADB)

Ver [DEPLOY.md](DEPLOY.md) para o passo a passo completo. Os tropeços que já custaram tempo:

- **Confirme com `screencap` que o Termux está na frente antes de digitar.** Já aconteceu de
  os comandos irem parar na Galeria e o deploy "não fazer nada".
- Digitar: `adb shell input text "cmd%scom%sespacos"` (espaço = `%s`) + `adb shell input keyevent 66`.
- **Nunca** use `&&` ou `;` dentro do `input text` — o shell do adb intercepta. Um comando por vez.
- Para preservar `& > |`: `adb shell "input text 'texto literal'"` (aspas simples por dentro).
- Os `.sh` perderam o bit de execução no celular: rode `bash X.sh`.
- O servidor roda numa sessão do Termux em primeiro plano. Para digitar sem derrubá-lo, abra
  uma **2ª sessão** (deslize da borda esquerda → botão `+`).

### Ligar / desligar

| | |
|---|---|
| `bash start.sh` | compila o servidor e sobe servidor + túnel. **Recusa** se a 8080 já responder. |
| `bash stop.sh` | derruba os dois. **Confere** que morreram; sai com erro se não. |
| `bash watchdog.sh` | cão de guarda: a cada 5 min, se o servidor não responder, reergue. |
| `bash phone-setup.sh` | registra os dois no boot (Termux:Boot). Roda 1× por aparelho. |

`start.sh` e `stop.sh` são o **único** jeito de ligar/desligar. Se você escrever um script de
deploy, chame esses dois — não reinvente o `pkill`, que foi como nasceu o bug do "no ar!"
mentiroso (matava mal, o servidor velho sobrevivia, e o deploy declarava sucesso).

⚠️ **O npm do Termux bloqueia `postinstall` por padrão.** Se o esbuild não compilar, o
`start.sh` sobe pelo fonte (o site não cai) e avisa no log. Conserto:
`npm install && npm approve-scripts esbuild`. Vale pra qualquer dependência nova com
postinstall — no Windows instala calado, no celular não.

## Saúde do sistema (medido em 2026-07-28)

| | |
|---|---|
| Disco no celular | 452 GB livres, 202 MB usados — **não é gargalo** |
| RAM | 7 GB livres de 11 GB |
| CPU parado | **servidor 0,07%** · túnel ~2,9% de **um** núcleo (de 6) |
| CPU em partida | o Age of AI é o que pesa (RTS com A* a 10 ticks/s). Os joguinhos não pesam. |

O servidor parado saiu de **1,32% → 0,07%** (95% a menos) com dois consertos, e os dois eram
a mesma ideia: **nada deve rodar quando ninguém está usando.**

1. O multiplayer da coleção tinha um `setInterval` de 50 ms no topo do módulo, rodando 24h
   por dia com zero jogadores. Virou sob demanda (ver `online-games-ws.ts`).
2. O servidor rodava com `tsx`, que mantém um **esbuild vivo pra sempre** transpilando em
   tempo real — gastava mais CPU que o próprio servidor. Agora é buildado (`node dist/index.js`).

Se a CPU parada subir de novo, procure **processo ou temporizador que não dorme**. Foi essa
a causa das duas vezes.

## Riscos conhecidos (ainda não resolvidos)

1. **A cópia publicada do Cube Range fica atrasada** em relação ao fonte de
   `D:\projetos\tiro` — a sincronização entre as duas pastas é **manual** (já houve trabalho
   pronto que nunca foi ao ar). Ver o `LEIA-ME.md` de lá.
2. **`D:\projetos\tiro\server.js` é um duplicado morto** do multiplayer real: protocolo
   divergente (ignora tiro e dano) e não usado em produção — o jogo publicado usa
   `/online-games/ws/<slug>`. Serve só para abrir o jogo por `file://`.
3. **A raiz de `D:\age` acumulou coisa que não é do jogo** (`art-in`, `image`, `music`,
   backups de sprites). Está toda no `.gitignore`, então não vaza para o GitHub — mas é a
   origem da sensação de bagunça.
