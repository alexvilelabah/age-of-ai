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
import { conectarJogo, slugDoPath, estadoDasSalas } from './online-games-ws';

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
      res.end(JSON.stringify({ ...readMetrics(), ...lobby.stats(), colecao: estadoDasSalas() }));
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

// Memoriza o JSON de cada mensagem. O snapshot vai pra TODOS os jogadores no
// mesmo tick e antes era serializado uma vez POR DESTINATÁRIO — sempre o mesmo
// texto. Medido: 216 µs por serialização de um snapshot de fim de partida
// (~53 KB); com 4 jogadores eram 4× isso, 5 vezes por segundo.
//
// WeakMap: a entrada some junto com a mensagem, sem vazar memória. Não há tempo
// de vida a gerenciar — o coletor de lixo faz sozinho.
//
// ⚠️ CONTRATO: NÃO altere uma ServerMessage depois de enviá-la — o segundo
// destinatário receberia o texto do primeiro. Hoje todo envio em laço respeita
// isso: ou cria objeto novo por iteração (o `gameStart` faz, porque o campo
// `you` muda por jogador), ou manda um objeto pronto que ninguém mexe
// (snapshot, roomList, chat, roomState). Se precisar variar por jogador, crie
// um objeto por jogador — nunca reaproveite mutando.
const jsonMemo = new WeakMap<object, string>();

function safeSend(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    let raw = jsonMemo.get(msg);
    if (raw === undefined) {
      raw = JSON.stringify(msg);
      jsonMemo.set(msg, raw);
    }
    ws.send(raw);
  } catch (err) {
    console.error('[ws] falha ao enviar mensagem', err);
  }
}

// WebSocket no MESMO servidor HTTP. O cliente do Age of AI usa ws://host:8080
// em local e wss://host/ws atras do tunel — ambos sobem aqui.
// maxPayload: teto no tamanho das mensagens RECEBIDAS do cliente (as do jogo são
// pequenas — comando/chat/nome). Evita que alguém mande um frame gigante e estoure
// a memória do celular. 64 KB é bem folgado pro maior comando legítimo.
//
// Por que noServer + roteamento manual do upgrade (logo abaixo): a coleção
// /online-games tem jogos com multiplayer próprio, que precisam do seu próprio
// WebSocket. Com um WSS unico "no servidor HTTP", TODA conexao caía no lobby do
// Age of AI. A regra é conservadora: só o prefixo da coleção vai para o outro
// servico; QUALQUER outro path — inclusive o /ws do Age of AI — continua indo
// para o lobby, exatamente como antes desta mudança.
// COMPRESSÃO (perMessageDeflate): o ganho mais barato que existe aqui. O
// snapshot é JSON repetitivo, então compacta pra ~12% do tamanho. Medido num
// snapshot de fim de partida: 53 KB → 6,5 KB.
//
// Escala do problema que isto resolve: o snapshot vai 5×/s pra cada jogador, e a
// 53 KB isso dava ~266 KB/s POR PESSOA — com 4 jogadores, 8,3 Mbps de UPLOAD
// saindo de um CELULAR na internet de casa. Era o gargalo real do jogo (a CPU
// não era). Compactado cai pra ~1 Mbps.
//
// Nível 1 de propósito: comprime em 153 µs contra 421 µs do nível 6, e o tamanho
// final quase não muda (12% vs 10%) — para JSON, o nível alto só queima CPU. Num
// celular isso importa.
//
// `threshold`: mensagem pequena (comando, chat, ping) não compensa compactar — o
// cabeçalho do deflate custa mais que a economia.
//
// É transparente: o navegador descompacta sozinho e o JavaScript recebe o mesmo
// objeto de antes. Nada muda no jogo, nem visual nem de regra.
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1, memLevel: 7 },
    threshold: 1024,
    concurrencyLimit: 4,
  },
});
const jogosWss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const JOGOS_WS_BASE = '/online-games/ws';

httpServer.on('upgrade', (req, socket, head) => {
  const caminho = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  const slug = caminho === JOGOS_WS_BASE || caminho.startsWith(JOGOS_WS_BASE + '/')
    ? slugDoPath(caminho, JOGOS_WS_BASE)
    : null;

  if (slug === null && caminho.startsWith(JOGOS_WS_BASE)) {
    socket.destroy(); // path da coleção, mas slug inválido
    return;
  }
  if (slug !== null) {
    jogosWss.handleUpgrade(req, socket, head, (ws) => jogosWss.emit('connection', ws, req, slug));
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// A coleção roda isolada: um erro dela não pode derrubar o lobby do Age of AI.
jogosWss.on('connection', (ws: WebSocket, _req: unknown, slug: string) => {
  try {
    conectarJogo(ws, slug);
  } catch (err) {
    console.error('[online-games] falha ao conectar', err);
    try { ws.close(); } catch { /* ignora */ }
  }
});
jogosWss.on('error', (err) => console.error('[online-games] erro no servidor', err));

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
