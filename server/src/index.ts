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
import { readMetrics, MONITOR_HTML } from './metrics';

const lobby = new Lobby();
const PORT = Number(process.env.PORT) || GAME_PORT;
// Senha do painel /sistema: vem SÓ da env MONITOR_KEY (definida fora do repo, no
// ~/.age_env do celular). Sem a env, o /sistema fica DESLIGADO (404 sempre) — assim
// não existe senha padrão exposta no código público (o repositório é open source).
const MONITOR_KEY = process.env.MONITOR_KEY ?? '';

// Pasta do cliente buildado (vite build -> client/dist), resolvida a partir
// deste arquivo (server/src) e nao do diretorio de trabalho.
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Colecao de jogos HTML estaticos servida em /online-games/ (projeto separado,
// gerado fora deste repo). Fica FORA do git de proposito: sao ~47 MB de conteudo
// de terceiros, que nao tem por que inchar o historico. Se a pasta nao existir,
// a rota simplesmente responde 404 e o resto do site segue normal.
const JOGOS_BASE = '/online-games/';
const JOGOS_DIR = process.env.JOGOS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../online-games');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  // .htm sem o "l": um dos jogos da colecao (/online-games) tem index.htm como
  // entrada. Sem esta linha o navegador recebe octet-stream e BAIXA a pagina em
  // vez de abrir.
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
};

// Serve a colecao de jogos de /online-games/. Separado do serveStatic de
// proposito por causa do 404: aqui um caminho inexistente TEM que responder 404
// de verdade. Se caisse no fallback do index.html (como faz o bloco do jogo),
// toda URL errada devolveria 200 com a pagina do Age of AI — o "soft 404" que o
// Google penaliza, e que ainda esconderia erro de link nosso.
function serveJogos(urlPath: string, res: http.ServerResponse): void {
  const rel = urlPath.slice(JOGOS_BASE.length);
  let filePath = path.join(JOGOS_DIR, rel);

  // Mesma trava de path traversal do bloco do jogo: o alvo TEM que ficar dentro
  // de JOGOS_DIR.
  if (filePath !== JOGOS_DIR && !filePath.startsWith(JOGOS_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }

  let stat: fs.Stats | null = null;
  try { stat = fs.statSync(filePath); } catch { stat = null; }

  if (stat?.isDirectory()) {
    // Pasta sem barra no fim (/online-games/algum-jogo) redireciona pra versao
    // com barra. Sem isso, link relativo dentro da pagina resolve pro nivel
    // errado — e o canonical passa a divergir da URL acessada.
    if (!urlPath.endsWith('/')) {
      res.writeHead(301, { Location: urlPath + '/' });
      res.end();
      return;
    }
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>Page not found.</p><p><a href="/online-games/">Back to the games</a></p>');
    return;
  }

  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
}

// Serve SOMENTE arquivos de dentro de client/dist. Nada mais do PC fica acessivel.
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

  // Contagem ao vivo (jogadores online / salas / partidas) — usada pelo monitor.
  if (urlPath === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(lobby.stats()));
    return;
  }

  // Painel de métricas do celular numa URL DISCRETA /sistema (LEVE: lê SOB
  // DEMANDA, sem processo em background — fecha a aba e o custo zera). Protegido
  // por senha (?k=) e marcado noindex p/ não aparecer no Google. ?data=1 = JSON.
  // Removível apagando este bloco + o import de ./metrics.
  if (urlPath === '/sistema') {
    const u = new URL(req.url ?? '/', 'http://localhost');
    // sem chave configurada, ou chave errada -> 404 (nem revela que existe)
    if (!MONITOR_KEY || u.searchParams.get('k') !== MONITOR_KEY) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    if (u.searchParams.get('data') === '1') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      res.end(JSON.stringify({ ...readMetrics(), ...lobby.stats() }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' });
      res.end(MONITOR_HTML);
    }
    return;
  }

  // Colecao de jogos. TEM que ser resolvida aqui, ANTES do bloco abaixo: o
  // fallback da linha ~95 devolve o index.html do jogo pra QUALQUER caminho
  // inexistente, entao sem este desvio /online-games/... nunca apareceria.
  if (urlPath === '/online-games') {
    res.writeHead(301, { Location: JOGOS_BASE });
    res.end();
    return;
  }
  if (urlPath.startsWith(JOGOS_BASE)) {
    serveJogos(urlPath, res);
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
// maxPayload: teto no tamanho das mensagens RECEBIDAS do cliente (as do jogo são
// pequenas — comando/chat/nome). Evita que alguém mande um frame gigante e estoure
// a memória do celular. 64 KB é bem folgado pro maior comando legítimo.
const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

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
      lobby.disconnect(conn);
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
