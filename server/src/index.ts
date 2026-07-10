// Ponto de entrada: servidor WebSocket autoritativo do Age of AI.
// Em PRODUCAO ele tambem SERVE o cliente ja buildado (client/dist) pelo mesmo
// processo/porta — assim, ao expor pela internet (tunel), so o jogo pronto fica
// acessivel: nao expomos o servidor de desenvolvimento (Vite) nem o codigo-fonte.
// Em desenvolvimento o Vite continua servindo o cliente (porta 5199) e este HTTP
// estatico fica ocioso.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GAME_PORT } from '@age/shared';
import type { ClientMessage, ServerMessage } from '@age/shared';
import { Lobby } from './lobby';

const lobby = new Lobby();
const PORT = Number(process.env.PORT) || GAME_PORT;

// Pasta do cliente buildado (vite build -> client/dist), resolvida a partir
// deste arquivo (server/src) e nao do diretorio de trabalho.
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Serve SOMENTE arquivos de dentro de client/dist. Nada mais do PC fica acessivel.
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

  // Contagem ao vivo (jogadores online / salas / partidas) — usada pelo monitor.
  if (urlPath === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(lobby.stats()));
    return;
  }

  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);

  // Trava contra path traversal (../): o alvo TEM que ficar dentro de DIST.
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }

  let stat: fs.Stats | null = null;
  try { stat = fs.statSync(filePath); } catch { stat = null; }
  if (!stat || stat.isDirectory()) {
    filePath = path.join(DIST, 'index.html'); // fallback: joga tudo no index
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }
  if (!stat) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Cliente nao encontrado. Rode: npm run build -w client');
    return;
  }

  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
}

const httpServer = http.createServer(serveStatic);

// WS com flag de vitalidade p/ o heartbeat (detecção de conexão morta).
type HeartbeatWS = WebSocket & { isAlive?: boolean };

function safeSend(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error('[ws] falha ao enviar mensagem', err);
  }
}

// WebSocket no MESMO servidor HTTP. Sem restricao de path: o cliente usa
// ws://host:8080 em local e wss://host/ws atras do tunel — ambos sobem aqui.
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket) => {
  const conn = lobby.connect((msg) => safeSend(ws, msg));

  // Heartbeat: marca viva ao conectar e a cada 'pong' recebido.
  (ws as HeartbeatWS).isAlive = true;
  ws.on('pong', () => {
    (ws as HeartbeatWS).isAlive = true;
  });

  ws.on('message', (data) => {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      safeSend(ws, { type: 'error', code: 'err.bad_json' });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
      safeSend(ws, { type: 'error', code: 'err.bad_message' });
      return;
    }
    try {
      lobby.handleMessage(conn.id, parsed);
    } catch (err) {
      console.error('[ws] erro processando mensagem', err);
    }
  });

  ws.on('close', () => {
    try {
      lobby.disconnect(conn.id);
    } catch (err) {
      console.error('[ws] erro no cleanup de desconexão', err);
    }
  });

  ws.on('error', (err) => {
    console.error('[ws] erro de conexão', err);
  });
});

wss.on('error', (err) => {
  console.error('[wss] erro no servidor', err);
});

// Ping periódico: derruba conexões mortas cujo 'close' nunca chegou (túnel/proxy/
// queda de rede). Sem isto, o nome do jogador ficaria preso até timeout de TCP.
const HEARTBEAT_MS = 30000;
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const c = client as HeartbeatWS;
    if (c.isAlive === false) {
      c.terminate(); // dispara 'close' -> lobby.disconnect -> libera nome e limpa salas
      continue;
    }
    c.isAlive = false;
    try {
      c.ping();
    } catch {
      // se falhar, o próximo ciclo faz terminate
    }
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`Age of AI server ouvindo na porta ${PORT}`);
  console.log(`Servindo o cliente de: ${DIST}`);
});
