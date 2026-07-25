// ============================================================
//  Multiplayer da coleção /online-games — serviço de SALAS
//
//  Um servidor de presença/combate genérico, compartilhado por qualquer
//  jogo da coleção. Cada jogo tem a sua própria sala, isolada das demais,
//  identificada pelo slug no path da conexão:
//
//      wss://host/online-games/ws/<slug>
//
//  Para dar multiplayer a um jogo NOVO da coleção, não se mexe aqui:
//  basta o cliente dele conectar no path com o próprio slug. A sala nasce
//  na primeira conexão e morre quando o último jogador sai.
//
//  Vive isolado do lobby do Age of AI de propósito: o index.ts só roteia o
//  upgrade por path. Um erro daqui não derruba o jogo principal.
//
//  Protocolo (JSON). O cliente do Cube Range já fala exatamente isto:
//    <- welcome { id, players[] }        ao entrar
//    <- join    { id, x, y, z, yaw }     alguém entrou
//    <- leave   { id }                   alguém saiu
//    <- states  { players[] }            20x por segundo
//    <- shot    { id, x, y, z }          traço do tiro de outro jogador
//    <- damaged { dano, x, z, de }       você levou dano
//    <- killed  { alvo, nome }           você abateu alguém
//    <- feed    { a, b }                 linha do killfeed para todos
//    -> state   { x, y, z, yaw, pitch, hp }
//    -> shot    { x, y, z }
//    -> hit     { alvo, dano, head }
//    -> died / spawn
// ============================================================
import type { WebSocket } from 'ws';

const TICK_MS = 50;          // 20 Hz de broadcast
const LIMITE_MUNDO = 400;    // teto de coordenada (arenas da coleção são bem menores)
const MAX_POR_SALA = 16;
const MAX_SALAS = 24;
const MAX_DANO = 150;        // teto por acerto declarado pelo cliente
const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{0,39}$/;

type Jogador = {
  ws: WebSocket;
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hp: number;
  vivo: boolean;
  abates: number;
  respondeu: boolean;        // heartbeat
};

type Sala = {
  slug: string;
  jogadores: Map<number, Jogador>;
  proximoId: number;
};

const salas = new Map<string, Sala>();

/** Slug do path, ou null se o path não for da coleção / for inválido. */
export function slugDoPath(caminho: string, base: string): string | null {
  if (caminho === base) return 'default';           // sem slug: sala única
  if (!caminho.startsWith(base + '/')) return null;
  const slug = caminho.slice(base.length + 1).replace(/\/+$/, '');
  return SLUG_VALIDO.test(slug) ? slug : null;
}

function enviar(ws: WebSocket, obj: unknown): void {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* conexão morrendo */ }
}

function paraSala(sala: Sala, obj: unknown, excetoId: number | null = null): void {
  const raw = JSON.stringify(obj);   // serializa uma vez só
  for (const [id, p] of sala.jogadores) {
    if (id === excetoId) continue;
    if (p.ws.readyState === 1) {
      try { p.ws.send(raw); } catch { /* ignora */ }
    }
  }
}

// número finito dentro da faixa — nenhum cliente injeta NaN/Infinity aqui
function num(v: unknown, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : 0;
}

function retrato(sala: Sala, excetoId: number | null = null) {
  const lista = [];
  for (const [id, p] of sala.jogadores) {
    if (id === excetoId) continue;
    lista.push({ id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp });
  }
  return lista;
}

/**
 * Liga uma conexão nova à sala do jogo. Chamado pelo index.ts.
 * @param slug identificador do jogo (vem do path)
 */
export function conectarJogo(ws: WebSocket, slug: string): void {
  let sala = salas.get(slug);
  if (!sala) {
    if (salas.size >= MAX_SALAS) {
      try { ws.close(1013, 'muitas salas'); } catch { /* ignora */ }
      return;
    }
    sala = { slug, jogadores: new Map(), proximoId: 1 };
    salas.set(slug, sala);
  }
  if (sala.jogadores.size >= MAX_POR_SALA) {
    try { ws.close(1013, 'sala cheia'); } catch { /* ignora */ }
    return;
  }

  const id = sala.proximoId++;
  const p: Jogador = {
    ws, id, x: 0, y: 0, z: 15, yaw: 0, pitch: 0,
    hp: 100, vivo: true, abates: 0, respondeu: true
  };
  sala.jogadores.set(id, p);

  enviar(ws, { t: 'welcome', id, players: retrato(sala, id) });
  paraSala(sala, { t: 'join', id, x: p.x, y: p.y, z: p.z, yaw: p.yaw }, id);
  console.log(`[online-games:${slug}] jogador ${id} entrou (${sala.jogadores.size} na sala)`);

  ws.on('message', (data: unknown) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return; // lixo: ignora em silêncio
    }
    if (!msg || typeof msg !== 'object') return;
    const s = sala as Sala;

    try {
      switch (msg.t) {
        case 'state':
          p.x = num(msg.x, -LIMITE_MUNDO, LIMITE_MUNDO);
          p.y = num(msg.y, -LIMITE_MUNDO, LIMITE_MUNDO);
          p.z = num(msg.z, -LIMITE_MUNDO, LIMITE_MUNDO);
          p.yaw = num(msg.yaw, -10, 10);
          p.pitch = num(msg.pitch, -2, 2);
          if (typeof msg.hp === 'number') p.hp = num(msg.hp, 0, 100);
          break;

        case 'shot':
          // só repassa o traço; quem julga o acerto é o atirador (ver 'hit')
          paraSala(s, {
            t: 'shot', id,
            x: num(msg.x, -LIMITE_MUNDO, LIMITE_MUNDO),
            y: num(msg.y, -LIMITE_MUNDO, LIMITE_MUNDO),
            z: num(msg.z, -LIMITE_MUNDO, LIMITE_MUNDO)
          }, id);
          break;

        case 'hit': {
          const alvo = s.jogadores.get(num(msg.alvo, 0, 1e9));
          if (!alvo || !alvo.vivo || alvo.id === id) break;
          const dano = Math.round(num(msg.dano, 0, MAX_DANO));
          if (dano <= 0) break;
          alvo.hp = Math.max(0, alvo.hp - dano);
          enviar(alvo.ws, { t: 'damaged', dano, x: p.x, z: p.z, de: 'JOGADOR ' + id });
          if (alvo.hp === 0) {
            alvo.vivo = false;
            p.abates++;
            enviar(ws, { t: 'killed', alvo: alvo.id, nome: 'JOGADOR ' + alvo.id });
            paraSala(s, { t: 'feed', a: 'JOGADOR ' + id, b: 'JOGADOR ' + alvo.id });
            console.log(`[online-games:${s.slug}] ${id} abateu ${alvo.id}`);
          }
          break;
        }

        case 'died':
          p.vivo = false; p.hp = 0;
          break;

        case 'spawn':
          p.vivo = true; p.hp = 100;
          break;
      }
    } catch (err) {
      console.error(`[online-games:${s.slug}] erro processando mensagem`, err);
    }
  });

  ws.on('pong', () => { p.respondeu = true; });

  ws.on('close', () => {
    const s = salas.get(slug);
    if (!s) return;
    s.jogadores.delete(id);
    paraSala(s, { t: 'leave', id });
    console.log(`[online-games:${slug}] jogador ${id} saiu (${s.jogadores.size} na sala)`);
    if (s.jogadores.size === 0) salas.delete(slug);  // sala vazia não fica ocupando nada
  });

  ws.on('error', () => { try { ws.close(); } catch { /* ignora */ } });
}

// UM laço global para todas as salas (mais barato que um timer por sala, e não
// deixa timer órfão quando uma sala some). Sala com menos de 2 jogadores não
// precisa de broadcast: o cliente sozinho joga contra os bots locais dele.
setInterval(() => {
  for (const sala of salas.values()) {
    if (sala.jogadores.size < 2) continue;
    paraSala(sala, { t: 'states', players: retrato(sala) });
  }
}, TICK_MS);

// Conexão que morreu sem avisar (aba fechada, túnel caiu): ping/pong derruba.
setInterval(() => {
  for (const sala of salas.values()) {
    for (const [, p] of sala.jogadores) {
      if (!p.respondeu) { try { p.ws.terminate(); } catch { /* ignora */ } continue; }
      p.respondeu = false;
      if (p.ws.readyState === 1) { try { p.ws.ping(); } catch { /* ignora */ } }
    }
  }
}, 30000);

/** Só para diagnóstico (painel /sistema, logs). */
export function estadoDasSalas() {
  return [...salas.values()].map(s => ({ slug: s.slug, jogadores: s.jogadores.size }));
}
