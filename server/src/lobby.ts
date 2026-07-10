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
}

const ROOM_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Quanto tempo a vaga de um jogador fica reservada após ele cair no meio da
 *  partida — se ele reconectar (mesmo clientId) dentro disso, retoma o jogo de
 *  onde estava; senão, é dado como derrotado. Ajustável via env (útil em testes). */
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 60_000;

export class Lobby {
  private conns = new Map<number, Connection>();
  private rooms = new Map<string, Room>();
  private nextPlayerId = 1;
  private joinCounter = 0;

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
      case 'joinRoom':
        this.joinRoom(conn, msg.roomId);
        break;
      case 'leaveRoom':
        this.leaveRoom(conn);
        break;
      case 'setReady':
        this.setReady(conn, msg.ready);
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
      conn.send({ type: 'gameStart', map: room.game.map, players: room.game.toPlayerInfos(), you: oldId });
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
    };
    room.members.set(conn.id, { id: conn.id, ready: false, joinOrder: this.joinCounter++ });
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
    this.broadcastRoomState(room.id);
  }

  private addBot(conn: Connection, difficulty?: BotDifficulty): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame) return;
    if (room.hostId !== conn.id) {
      conn.send({ type: 'error', code: 'err.host_only_bots' });
      return;
    }
    if (room.members.size >= MAX_PLAYERS_PER_ROOM) {
      conn.send({ type: 'error', code: 'err.room_full' });
      return;
    }
    const botCount = [...room.members.values()].filter((m) => m.isBot).length;
    const id = this.nextPlayerId++;
    room.members.set(id, {
      id,
      ready: true, // bots já entram prontos
      joinOrder: this.joinCounter++,
      isBot: true,
      difficulty: difficulty ?? 'normal',
      name: `Bot ${botCount + 1}`,
    });
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
      const msg: ServerMessage = { type: 'gameStart', map: game.map, players: playerInfos, you: m.id };
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
    for (const m of room.members.values()) m.ready = false;
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

  // ---------------- Room list / state broadcasts ----------------

  private roomSummaries(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      hostName: this.conns.get(r.hostId)?.name ?? 'Jogador',
      playerCount: r.members.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      inGame: r.inGame,
    }));
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
      };
    });
    const msg: ServerMessage = { type: 'roomState', roomId, players, mode: room.mode };
    for (const m of room.members.values()) this.conns.get(m.id)?.send(msg);
  }
}
