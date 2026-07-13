// Lobby: conexões, salas, chat e transição sala -> partida.

import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, PLAYER_COLORS } from '@age/shared';
import type { BotDifficulty, ClientMessage, GameMode, RoomPlayer, RoomSummary, ServerMessage } from '@age/shared';
import { Game, type RoomMember } from './game/room';

export interface Connection {
  id: number;
  name: string;
  roomId: string | null;
  clientId?: string; // identidade estável do navegador (localStorage) p/ reassumir o nome no refresh
  send: (msg: ServerMessage) => void;
}

interface RoomPlayerState {
  id: number;
  ready: boolean;
  joinOrder: number;
  isBot?: boolean;
  difficulty?: BotDifficulty; // apenas bots
  team?: number; // 0/ausente = sozinho; 1/2 = time (host escolhe na sala)
  name?: string; // apenas bots (não têm Connection)
  clientId?: string;   // identidade estável do navegador (p/ reconectar na MESMA partida)
  disconnected?: boolean; // caiu no meio do jogo e a vaga está reservada (aguardando reconexão)
  graceTimer?: ReturnType<typeof setTimeout>; // conta o tempo até desistir e derrotar
}

interface Room {
  id: string;
  hostId: number;
  members: Map<number, RoomPlayerState>; // playerId -> estado
  inGame: boolean;
  game: Game | null;
  mode: GameMode; // 'normal' | 'batalha' (escolhido pelo host)
  fog: boolean; // névoa de guerra (mapa fechado); default false = mapa aberto
  lastActivity: number; // última ação na sala (Date.now) — p/ fechar sala ociosa
}

const ROOM_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// --- Salas "vitrine" (social proof no início) -----------------------------
// Enquanto a base de jogadores é pequena, o lobby mostra algumas partidas
// FICTÍCIAS "em jogo" pra não parecer deserto. São só rótulos na lista: como
// aparecem como "em jogo", o botão Entrar fica desabilitado no cliente, então
// ninguém entra e descobre que estão vazias. O conjunto (quantidade, nomes e
// lotação) é DETERMINÍSTICO pela hora do relógio — muda de hora em hora, sem
// timer nem custo por tick (é calculado só quando a lista é montada). O
// endpoint /status continua contando SÓ as salas reais (monitoramento honesto).
// Mistura proposital: uns "cool" capitalizados, muitos preguiçosos (minúsculo,
// número, teclado batido) — como um lobby de verdade, não uma lista curada.
const FAKE_HOST_NAMES = [
  'drakonz', 'ale12', 'qwer', 'asd', '1234', 'joao123', 'SiegeLord', 'rafa',
  'ShadowFox', 'pedro_', 'lucas7', 'br123', 'NightRaider', 'gg', 'test123', 'mari',
  'ElConquistador', 'aaa', 'xX_dark', 'thiago', 'zzz', 'noobmaster', 'gabriel', 'kkkk',
  'ReiArthur', 'top1', 'player1', 'biel', 'proGamer', '999', 'diego', 'aloxx',
  'Kratos77', 'zero_', 'mestre', 'guto', 'DarkZ', 'ana_', 'vitor', 'aK47',
  'PhantomScout', 'gugu', 'rush', 'matheus', 'jvzin', 'dudu', 'Onyxia', 'poko',
];

/** PRNG determinístico em [0,1) a partir de um inteiro (mesma semente -> mesmo valor). */
function seededUnit(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = (x * 2246822519) >>> 0;
  x ^= x >>> 13; x = (x * 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Salas-vitrine (4 a 6, "em jogo", nomes distintos). Cada VAGA tem o seu próprio
 * relógio, defasado 10 min da anterior: a vaga i troca de nome no minuto i*10 de
 * cada hora — ou seja, a cada 10 min UMA sala muda, nunca todas de uma vez. As
 * vagas 0-3 estão sempre ocupadas (mínimo 4 salas); as vagas 4 e 5 entram/saem a
 * cada hora (no minuto delas), fazendo o total oscilar 4..6 (às vezes 4). Cada
 * vaga sorteia o nome do SEU grupo (blocos disjuntos do pool) e avança 1 por
 * hora — então muda toda hora sem depender das outras (staggering limpo).
 */
export function generateFakeRooms(nowMs: number, maxPlayers: number): RoomSummary[] {
  const HOUR = 3_600_000;
  const STAGGER = 10 * 60_000; // 10 min entre a troca de uma sala e a seguinte
  const GROUP = Math.floor(FAKE_HOST_NAMES.length / 6); // 6 grupos disjuntos de nomes
  const out: RoomSummary[] = [];
  for (let i = 0; i < 6; i++) {
    // relógio da vaga: vira 1x/hora, mas defasado i*10min do vizinho
    const bucket = Math.floor((nowMs - i * STAGGER) / HOUR);
    // vagas 4 e 5 só aparecem em ~metade das horas -> total oscila entre 4 e 6
    if (i >= 4 && seededUnit(bucket * 2600 + i * 17 + 9) < 0.5) continue;
    // nome do grupo da vaga (grupos não se cruzam -> nunca repete entre salas),
    // avançando 1 por hora (cicla os do grupo) -> muda toda hora
    const k = i * GROUP + (((bucket + i * 3) % GROUP) + GROUP) % GROUP;
    const pc = 2 + Math.floor(seededUnit(bucket * 977 + i * 13) * (maxPlayers - 1)); // 2..max
    out.push({
      id: `live-${i}-${bucket}`, // não colide com id real (6 chars maiúsculos)
      hostName: FAKE_HOST_NAMES[k],
      playerCount: Math.min(pc, maxPlayers),
      maxPlayers,
      inGame: true, // "fechado": aparece em andamento, Entrar fica desabilitado
    });
  }
  return out;
}

/** Quanto tempo a vaga de um jogador fica reservada após ele cair no meio da
 *  partida — se ele reconectar (mesmo clientId) dentro disso, retoma o jogo de
 *  onde estava; senão, é dado como derrotado. Ajustável via env (útil em testes). */
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 60_000;
/** Sala fora de jogo sem NENHUMA ação por este tempo é fechada (sala fantasma:
 *  criou, foi embora e deixou os outros esperando). Ajustável via env p/ testes. */
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS) || 5 * 60_000;

export class Lobby {
  private conns = new Map<number, Connection>();
  private rooms = new Map<string, Room>();
  private nextPlayerId = 1;
  private joinCounter = 0;
  // Varredura de salas ociosas (unref: não segura o processo em scripts/testes).
  private idleSweep = setInterval(() => this.sweepIdleRooms(), 60_000);

  constructor() {
    this.idleSweep.unref?.();
  }

  /** Marca atividade na sala (adia o fechamento por ociosidade). */
  private touch(room: Room): void {
    room.lastActivity = Date.now();
  }

  /** Fecha salas fora de jogo paradas há ROOM_IDLE_MS (sala fantasma). */
  private sweepIdleRooms(): void {
    const now = Date.now();
    let closed = false;
    for (const room of [...this.rooms.values()]) {
      if (room.inGame || now - room.lastActivity < ROOM_IDLE_MS) continue;
      for (const m of room.members.values()) {
        if (m.isBot) continue;
        const c = this.conns.get(m.id);
        if (!c) continue;
        c.roomId = null;
        c.send({ type: 'error', code: 'err.room_idle_closed' });
        c.send({ type: 'leftRoom' });
      }
      this.rooms.delete(room.id);
      closed = true;
    }
    if (closed) this.broadcastRoomListToLobbyClients();
  }

  connect(send: (msg: ServerMessage) => void): Connection {
    const id = this.nextPlayerId++;
    const conn: Connection = { id, name: `Jogador ${id}`, roomId: null, send };
    this.conns.set(id, conn);
    send({ type: 'welcome', playerId: id });
    this.sendRoomListTo(conn);
    return conn;
  }

  disconnect(conn: Connection): void {
    // Se esta conexão já não é a mapeada para o id (a vaga foi reassumida por uma
    // reconexão que reusou o mesmo playerId), ignore — não derrube o novo dono.
    if (this.conns.get(conn.id) !== conn) return;
    if (conn.roomId) this.handleDisconnectFromRoom(conn);
    if (this.conns.get(conn.id) === conn) this.conns.delete(conn.id);
  }

  /** Contagem ao vivo p/ monitorar quem está online (usada no endpoint /status). */
  stats(): { players: number; rooms: number; games: number } {
    let games = 0;
    for (const r of this.rooms.values()) if (r.inGame) games++;
    return { players: this.conns.size, rooms: this.rooms.size, games };
  }

  handleMessage(playerId: number, msg: ClientMessage): void {
    const conn = this.conns.get(playerId);
    if (!conn) return;
    switch (msg.type) {
      case 'setName':
        this.setName(conn, msg.name, msg.clientId);
        break;
      case 'listRooms':
        this.sendRoomListTo(conn);
        break;
      case 'createRoom':
        this.createRoom(conn);
        break;
      case 'setMode':
        this.setMode(conn, msg.mode);
        break;
      case 'setFog':
        this.setFog(conn, msg.fog);
        break;
      case 'setBotDifficulty':
        this.setBotDifficulty(conn, msg.botId, msg.difficulty);
        break;
      case 'joinRoom':
        this.joinRoom(conn, msg.roomId);
        break;
      case 'leaveRoom':
        this.leaveRoom(conn);
        break;
      case 'setReady':
        this.setReady(conn, msg.ready);
        break;
      case 'setTeam':
        this.setTeam(conn, msg.playerId, msg.team);
        break;
      case 'addBot':
        this.addBot(conn, msg.difficulty);
        break;
      case 'removeBot':
        this.removeBot(conn);
        break;
      case 'startGame':
        this.startGame(conn);
        break;
      case 'chat':
        this.chat(conn, msg.text);
        break;
      case 'setPause':
        this.setPause(conn, msg.paused);
        break;
      case 'ping':
        this.ping(conn, msg.x, msg.y);
        break;
      case 'cmd':
        this.cmd(conn, msg);
        break;
    }
  }

  // ---------------- Nome ----------------

  private setName(conn: Connection, name: string, clientId?: string): void {
    const wanted = name.trim().slice(0, 20) || `Jogador ${conn.id}`;
    if (clientId) conn.clientId = clientId;

    // RECONEXÃO NA MESMA PARTIDA: se este clientId tem uma vaga ativa num jogo em
    // andamento (caiu e voltou dentro do tempo), retoma de onde estava em vez de
    // criar um jogador novo no lobby.
    if (clientId) {
      const resume = this.findResumableGame(clientId, conn.id);
      if (resume) {
        this.resumeGame(conn, resume.room, resume.member, wanted);
        return;
      }
    }

    // nome já em uso por OUTRA conexão viva (ignora maiúsc/minúsc)?
    let holder: Connection | undefined;
    for (const c of this.conns.values()) {
      if (c.id !== conn.id && c.name.toLowerCase() === wanted.toLowerCase()) {
        holder = c;
        break;
      }
    }
    if (holder) {
      // Mesmo clientId = é o MESMO usuário reconectando (refresh/queda) no lobby/sala:
      // despeja a conexão antiga (libera o nome e a sala dela) e deixa esta assumir.
      if (clientId && holder.clientId === clientId) {
        this.disconnect(holder);
      } else {
        conn.send({ type: 'nameTaken' });
        return;
      }
    }
    conn.name = wanted;
    conn.send({ type: 'nameOk' });
    if (conn.roomId) this.broadcastRoomState(conn.roomId);
  }

  /** Procura, entre as salas EM JOGO, uma vaga deste clientId cujo jogador ainda
   *  esteja vivo (não derrotado) — a partida que ele pode retomar. */
  private findResumableGame(clientId: string, excludeId: number): { room: Room; member: RoomPlayerState } | null {
    for (const room of this.rooms.values()) {
      if (!room.inGame || !room.game) continue;
      for (const m of room.members.values()) {
        if (m.isBot || m.id === excludeId || m.clientId !== clientId) continue;
        const gp = room.game.players.get(m.id);
        if (!gp || gp.defeated) continue; // já perdeu enquanto estava fora → não retoma
        return { room, member: m };
      }
    }
    return null;
  }

  /** Reconecta `conn` à vaga `member` de uma partida em andamento: reassume o
   *  playerId antigo (pra toda a engrenagem — conns/jogo/sala — continuar valendo)
   *  e reenvia identidade + gameStart; os snapshots voltam a fluir sozinhos. */
  private resumeGame(conn: Connection, room: Room, member: RoomPlayerState, wanted: string): void {
    const oldId = member.id;
    if (member.graceTimer) {
      clearTimeout(member.graceTimer);
      member.graceTimer = undefined;
    }
    member.disconnected = false;
    // se ainda houver uma conexão viva ocupando a vaga (reabertura rápida), solta-a
    const stale = this.conns.get(oldId);
    if (stale && stale !== conn) {
      stale.roomId = null;
      this.conns.delete(oldId);
    }
    // reassume o id antigo do jogo
    this.conns.delete(conn.id);
    conn.id = oldId;
    conn.roomId = room.id;
    conn.name = wanted;
    this.conns.set(oldId, conn);
    // reenvia identidade + a partida em andamento (o cliente remonta a tela de jogo)
    conn.send({ type: 'welcome', playerId: oldId });
    conn.send({ type: 'nameOk' });
    if (room.game) {
      conn.send({ type: 'gameStart', map: room.game.map, players: room.game.toPlayerInfos(), you: oldId, fog: room.fog });
      // reconectou no meio de uma pausa: já mostra o overlay (senão veria o jogo congelado sem explicação)
      if (room.game.isPaused) conn.send({ type: 'gamePaused', paused: true, by: '' });
    }
  }

  // ---------------- Salas ----------------

  /** Host escolhe o modo (Normal/Batalha) antes de iniciar. */
  private setMode(conn: Connection, mode: GameMode): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame) return;
    if (room.hostId !== conn.id) return; // só o host muda
    if (mode !== 'normal' && mode !== 'batalha') return;
    room.mode = mode;
    this.touch(room);
    this.broadcastRoomState(room.id);
  }

  private genRoomId(): string {
    let id: string;
    do {
      id = Array.from({ length: 6 }, () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]).join('');
    } while (this.rooms.has(id));
    return id;
  }

  private createRoom(conn: Connection): void {
    if (conn.roomId) {
      conn.send({ type: 'error', code: 'err.already_in_room' });
      return;
    }
    const id = this.genRoomId();
    const room: Room = {
      id,
      hostId: conn.id,
      members: new Map(),
      inGame: false,
      game: null,
      mode: 'normal',
      fog: false, // mapa começa ABERTO (o host fecha se quiser névoa)
      lastActivity: Date.now(),
    };
    room.members.set(conn.id, { id: conn.id, ready: false, joinOrder: this.joinCounter++ });
    // Sala já nasce com 1 bot FÁCIL (padrão amigável: o fácil é passivo, não
    // atropela quem tá começando). Host troca no chip ou remove com "− Bot".
    this.addBotToRoom(room, 'easy');
    this.rooms.set(id, room);
    conn.roomId = id;
    this.broadcastRoomState(id);
    this.broadcastRoomListToLobbyClients();
  }

  private joinRoom(conn: Connection, roomId: string): void {
    if (conn.roomId) {
      conn.send({ type: 'error', code: 'err.already_in_room' });
      return;
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      conn.send({ type: 'error', code: 'err.room_not_found' });
      return;
    }
    if (room.inGame) {
      conn.send({ type: 'error', code: 'err.room_in_game' });
      return;
    }
    if (room.members.size >= MAX_PLAYERS_PER_ROOM) {
      conn.send({ type: 'error', code: 'err.room_full' });
      return;
    }
    room.members.set(conn.id, { id: conn.id, ready: false, joinOrder: this.joinCounter++ });
    conn.roomId = roomId;
    this.touch(room);
    this.broadcastRoomState(roomId);
    this.broadcastRoomListToLobbyClients();
  }

  private leaveRoom(conn: Connection): void {
    if (!conn.roomId) return;
    this.removeFromRoom(conn, conn.roomId);
    conn.send({ type: 'leftRoom' });
  }

  private removeFromRoom(conn: Connection, roomId: string): void {
    const room = this.rooms.get(roomId);
    conn.roomId = null;
    if (!room) return;
    room.members.delete(conn.id);
    const humansLeft = [...room.members.values()].some((m) => !m.isBot);
    if (!humansLeft) {
      // sem humanos: encerra e remove a sala (não deixa bots órfãos)
      if (room.game) room.game.stop();
      this.rooms.delete(roomId);
      this.broadcastRoomListToLobbyClients();
      return;
    }
    if (room.hostId === conn.id) {
      // host migra para o HUMANO remanescente mais antigo (bots não podem ser host)
      let oldest: RoomPlayerState | null = null;
      for (const m of room.members.values()) {
        if (m.isBot) continue;
        if (!oldest || m.joinOrder < oldest.joinOrder) oldest = m;
      }
      if (oldest) room.hostId = oldest.id;
    }
    this.touch(room);
    this.broadcastRoomState(roomId);
    this.broadcastRoomListToLobbyClients();
  }

  private handleDisconnectFromRoom(conn: Connection): void {
    const roomId = conn.roomId;
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) {
      conn.roomId = null;
      return;
    }
    if (room.inGame && room.game) {
      const member = room.members.get(conn.id);
      const gp = room.game.players.get(conn.id);
      // RESUMÍVEL: humano com clientId e ainda vivo → reserva a vaga por um tempo
      // (grace) em vez de derrotar. Suas unidades ficam paradas (vulneráveis) e,
      // se ele reconectar dentro do prazo, retoma a MESMA partida. Ver resumeGame.
      if (member && !member.isBot && conn.clientId && gp && !gp.defeated) {
        member.clientId = conn.clientId;
        member.disconnected = true;
        if (member.graceTimer) clearTimeout(member.graceTimer);
        member.graceTimer = setTimeout(() => this.expireGrace(roomId, conn.id), RECONNECT_GRACE_MS);
        conn.roomId = null;
        return;
      }
      // Fallback (sem clientId / bot / já derrotado): derrota imediata.
      // markDefeated pode ENCERRAR a partida (checkVictory→onGameOver zera room.game).
      room.game.markDefeated(conn.id);
      const anotherHuman = [...room.members.values()].some(
        (m) => m.id !== conn.id && !m.isBot && this.conns.has(m.id),
      );
      if (!anotherHuman) {
        if (room.game) room.game.stop(); // pode já ter sido encerrado por onGameOver
        this.rooms.delete(roomId);
        this.broadcastRoomListToLobbyClients();
      }
      conn.roomId = null;
      return;
    }
    this.removeFromRoom(conn, roomId);
  }

  /** Passou o tempo de tolerância sem o jogador reconectar: agora sim ele é dado
   *  como derrotado e a vaga liberada (mesma limpeza da desconexão imediata). */
  private expireGrace(roomId: string, playerId: number): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.game) return;
    const member = room.members.get(playerId);
    if (!member || !member.disconnected) return; // já reconectou ou já saiu
    member.graceTimer = undefined;
    room.game.markDefeated(playerId); // pode encerrar a partida (onGameOver zera room.game)
    room.members.delete(playerId);
    const anyHuman = [...room.members.values()].some((m) => !m.isBot && this.conns.has(m.id));
    if (!anyHuman) {
      if (room.game) room.game.stop();
      this.rooms.delete(roomId);
      this.broadcastRoomListToLobbyClients();
      return;
    }
    // migra o host se quem saiu era ele
    if (room.hostId === playerId) {
      let oldest: RoomPlayerState | null = null;
      for (const m of room.members.values()) {
        if (m.isBot) continue;
        if (!oldest || m.joinOrder < oldest.joinOrder) oldest = m;
      }
      if (oldest) room.hostId = oldest.id;
    }
    this.broadcastRoomState(roomId); // se a partida acabou, o room voltou pro lobby
    this.broadcastRoomListToLobbyClients();
  }

  private setReady(conn: Connection, ready: boolean): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame) return;
    const m = room.members.get(conn.id);
    if (!m) return;
    m.ready = ready;
    this.touch(room);
    this.broadcastRoomState(room.id);
  }

  /** Host abre/fecha o mapa (névoa de guerra). */
  private setFog(conn: Connection, fog: boolean): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame || room.hostId !== conn.id) return;
    room.fog = !!fog;
    this.touch(room);
    this.broadcastRoomState(room.id);
  }

  /** Host muda a dificuldade de um bot da sala (antes de iniciar). */
  private setBotDifficulty(conn: Connection, botId: number, difficulty: BotDifficulty): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame || room.hostId !== conn.id) return;
    if (!['easy', 'normal', 'hard', 'expert'].includes(difficulty)) return;
    const m = room.members.get(botId);
    if (!m || !m.isBot) return;
    m.difficulty = difficulty;
    this.touch(room);
    this.broadcastRoomState(room.id);
  }

  /** Host define o TIME de qualquer vaga (0 = sozinho, 1/2 = time). */
  private setTeam(conn: Connection, playerId: number, team: number): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame || room.hostId !== conn.id) return;
    if (team !== 0 && team !== 1 && team !== 2) return;
    const m = room.members.get(playerId);
    if (!m) return;
    m.team = team === 0 ? undefined : team;
    this.touch(room);
    this.broadcastRoomState(room.id);
  }

  /** Insere um bot na sala (sem broadcasts). false = sala cheia. */
  private addBotToRoom(room: Room, difficulty?: BotDifficulty): boolean {
    if (room.members.size >= MAX_PLAYERS_PER_ROOM) return false;
    const botCount = [...room.members.values()].filter((m) => m.isBot).length;
    const id = this.nextPlayerId++;
    room.members.set(id, {
      id,
      ready: true, // bots já entram prontos
      joinOrder: this.joinCounter++,
      isBot: true,
      difficulty: difficulty ?? 'easy',
      name: `Bot ${botCount + 1}`,
    });
    return true;
  }

  private addBot(conn: Connection, difficulty?: BotDifficulty): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame) return;
    if (room.hostId !== conn.id) {
      conn.send({ type: 'error', code: 'err.host_only_bots' });
      return;
    }
    if (!this.addBotToRoom(room, difficulty)) {
      conn.send({ type: 'error', code: 'err.room_full' });
      return;
    }
    this.touch(room);
    this.broadcastRoomState(room.id);
    this.broadcastRoomListToLobbyClients();
  }

  private removeBot(conn: Connection): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame || room.hostId !== conn.id) return;
    let last: RoomPlayerState | null = null;
    for (const m of room.members.values()) {
      if (m.isBot && (!last || m.joinOrder > last.joinOrder)) last = m;
    }
    if (last) {
      room.members.delete(last.id);
      this.touch(room);
      this.broadcastRoomState(room.id);
      this.broadcastRoomListToLobbyClients();
    }
  }

  private startGame(conn: Connection): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame) return;
    if (room.hostId !== conn.id) {
      conn.send({ type: 'error', code: 'err.host_only_start' });
      return;
    }
    if (room.members.size < MIN_PLAYERS_TO_START) {
      conn.send({ type: 'error', code: 'err.need_players', params: { n: MIN_PLAYERS_TO_START } });
      return;
    }
    this.touch(room);
    const allReady = [...room.members.values()].every((m) => m.id === room.hostId || m.ready);
    if (!allReady) {
      conn.send({ type: 'error', code: 'err.not_all_ready' });
      return;
    }

    const orderedMembers = [...room.members.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    // grava o clientId de cada humano na vaga — é a chave pra reconectar na partida
    for (const m of orderedMembers) {
      if (!m.isBot) m.clientId = this.conns.get(m.id)?.clientId;
    }
    const gameMembers: RoomMember[] = orderedMembers.map((m, i) => {
      const c = this.conns.get(m.id);
      return {
        id: m.id,
        name: m.isBot ? m.name ?? 'Bot' : c?.name ?? `Jogador ${m.id}`,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        isBot: !!m.isBot,
        difficulty: m.difficulty,
        team: m.team,
      };
    });

    const game = new Game(
      gameMembers,
      (playerId, msg) => {
        const c = this.conns.get(playerId);
        if (c) c.send(msg);
      },
      () => this.onGameOver(room.id),
      room.mode,
    );
    room.game = game;
    room.inGame = true;

    const playerInfos = game.toPlayerInfos();
    for (const m of gameMembers) {
      const c = this.conns.get(m.id);
      if (!c) continue;
      const msg: ServerMessage = { type: 'gameStart', map: game.map, players: playerInfos, you: m.id, fog: room.fog };
      c.send(msg);
    }
    game.start();
  }

  private onGameOver(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.game) room.game.stop();
    room.game = null;
    room.inGame = false;
    // Humanos voltam "aguardando"; bots continuam prontos (não há como
    // prontificá-los depois — sem isso a sala nunca reiniciava uma partida).
    for (const m of room.members.values()) m.ready = !!m.isBot;
    this.touch(room); // sala acabou de voltar do jogo — não varrer já
    // host permanece o mesmo (ou o membro mais antigo se por algum motivo saiu)
    if (![...room.members.values()].some((m) => m.id === room.hostId)) {
      let oldest: RoomPlayerState | null = null;
      for (const m of room.members.values()) {
        if (!oldest || m.joinOrder < oldest.joinOrder) oldest = m;
      }
      if (oldest) room.hostId = oldest.id;
    }
    this.broadcastRoomState(roomId);
  }

  // ---------------- Chat ----------------

  private chat(conn: Connection, text: string): void {
    const trimmed = text.trim().slice(0, 200);
    if (trimmed.length === 0) return;
    const msg: ServerMessage = { type: 'chat', from: conn.name, text: trimmed };
    if (conn.roomId) {
      const room = this.rooms.get(conn.roomId);
      if (!room) return;
      if (!room.inGame) this.touch(room);
      for (const m of room.members.values()) this.conns.get(m.id)?.send(msg);
    } else {
      for (const c of this.conns.values()) {
        if (c.roomId === null) c.send(msg);
      }
    }
  }

  // ---------------- Comandos de jogo ----------------

  private cmd(conn: Connection, msg: Extract<ClientMessage, { type: 'cmd' }>): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || !room.inGame || !room.game) return;
    room.game.enqueueCommand(conn.id, msg.cmd);
  }

  /** Pausar/retomar a partida (qualquer jogador da sala). */
  private setPause(conn: Connection, paused: boolean): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || !room.inGame || !room.game) return;
    room.game.setPaused(conn.id, paused);
  }

  /** Sinaliza (ping) no minimapa — o Game repassa só aos aliados. */
  private ping(conn: Connection, x: number, y: number): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || !room.inGame || !room.game) return;
    room.game.signalPing(conn.id, x, y);
  }

  // ---------------- Room list / state broadcasts ----------------

  private roomSummaries(): RoomSummary[] {
    const real = [...this.rooms.values()].map((r) => ({
      id: r.id,
      hostName: this.conns.get(r.hostId)?.name ?? 'Jogador',
      playerCount: r.members.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      inGame: r.inGame,
    }));
    // Salas reais primeiro (as que dá pra entrar ficam no topo); vitrine embaixo.
    return [...real, ...generateFakeRooms(Date.now(), MAX_PLAYERS_PER_ROOM)];
  }

  private sendRoomListTo(conn: Connection): void {
    if (conn.roomId) return;
    conn.send({ type: 'roomList', rooms: this.roomSummaries() });
  }

  private broadcastRoomListToLobbyClients(): void {
    const msg: ServerMessage = { type: 'roomList', rooms: this.roomSummaries() };
    for (const c of this.conns.values()) {
      if (c.roomId === null) c.send(msg);
    }
  }

  private broadcastRoomState(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const ordered = [...room.members.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    const players: RoomPlayer[] = ordered.map((m, i) => {
      const c = this.conns.get(m.id);
      return {
        id: m.id,
        name: m.isBot ? m.name ?? 'Bot' : c?.name ?? `Jogador ${m.id}`,
        ready: m.ready,
        isHost: m.id === room.hostId,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        isBot: !!m.isBot,
        difficulty: m.difficulty,
        team: m.team,
      };
    });
    const msg: ServerMessage = { type: 'roomState', roomId, players, mode: room.mode, fog: room.fog };
    for (const m of room.members.values()) this.conns.get(m.id)?.send(msg);
  }
}
