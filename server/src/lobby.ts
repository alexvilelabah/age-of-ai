// Lobby: conexões, salas, chat e transição sala -> partida.

import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, PLAYER_COLORS } from '@age/shared';
import type { ClientMessage, RoomPlayer, RoomSummary, ServerMessage } from '@age/shared';
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
  name?: string; // apenas bots (não têm Connection)
}

interface Room {
  id: string;
  hostId: number;
  members: Map<number, RoomPlayerState>; // playerId -> estado
  inGame: boolean;
  game: Game | null;
}

const ROOM_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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

  disconnect(playerId: number): void {
    const conn = this.conns.get(playerId);
    if (!conn) return;
    if (conn.roomId) this.handleDisconnectFromRoom(conn);
    this.conns.delete(playerId);
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
        this.addBot(conn);
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
    // nome já em uso por OUTRA conexão viva (ignora maiúsc/minúsc)?
    let holder: Connection | undefined;
    for (const c of this.conns.values()) {
      if (c.id !== conn.id && c.name.toLowerCase() === wanted.toLowerCase()) {
        holder = c;
        break;
      }
    }
    if (holder) {
      // Mesmo clientId = é o MESMO usuário reconectando (refresh/queda): despeja a
      // conexão antiga (libera o nome e limpa a sala/partida dela) e deixa esta assumir.
      if (clientId && holder.clientId === clientId) {
        this.disconnect(holder.id);
      } else {
        conn.send({ type: 'nameTaken' });
        return;
      }
    }
    conn.name = wanted;
    conn.send({ type: 'nameOk' });
    if (conn.roomId) this.broadcastRoomState(conn.roomId);
  }

  // ---------------- Salas ----------------

  private genRoomId(): string {
    let id: string;
    do {
      id = Array.from({ length: 6 }, () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]).join('');
    } while (this.rooms.has(id));
    return id;
  }

  private createRoom(conn: Connection): void {
    if (conn.roomId) {
      conn.send({ type: 'error', message: 'Você já está em uma sala.' });
      return;
    }
    const id = this.genRoomId();
    const room: Room = {
      id,
      hostId: conn.id,
      members: new Map(),
      inGame: false,
      game: null,
    };
    room.members.set(conn.id, { id: conn.id, ready: false, joinOrder: this.joinCounter++ });
    this.rooms.set(id, room);
    conn.roomId = id;
    this.broadcastRoomState(id);
    this.broadcastRoomListToLobbyClients();
  }

  private joinRoom(conn: Connection, roomId: string): void {
    if (conn.roomId) {
      conn.send({ type: 'error', message: 'Você já está em uma sala.' });
      return;
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      conn.send({ type: 'error', message: 'Sala não encontrada.' });
      return;
    }
    if (room.inGame) {
      conn.send({ type: 'error', message: 'Essa sala já está em partida.' });
      return;
    }
    if (room.members.size >= MAX_PLAYERS_PER_ROOM) {
      conn.send({ type: 'error', message: 'Sala cheia.' });
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
      room.game.markDefeated(conn.id);
      // se não sobrou nenhum humano conectado, encerra e remove a sala
      const anotherHuman = [...room.members.values()].some(
        (m) => m.id !== conn.id && !m.isBot && this.conns.has(m.id),
      );
      if (!anotherHuman) {
        room.game.stop();
        this.rooms.delete(roomId);
        this.broadcastRoomListToLobbyClients();
      }
      conn.roomId = null;
      return;
    }
    this.removeFromRoom(conn, roomId);
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

  private addBot(conn: Connection): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room || room.inGame) return;
    if (room.hostId !== conn.id) {
      conn.send({ type: 'error', message: 'Apenas o anfitrião pode adicionar bots.' });
      return;
    }
    if (room.members.size >= MAX_PLAYERS_PER_ROOM) {
      conn.send({ type: 'error', message: 'Sala cheia.' });
      return;
    }
    const botCount = [...room.members.values()].filter((m) => m.isBot).length;
    const id = this.nextPlayerId++;
    room.members.set(id, {
      id,
      ready: true, // bots já entram prontos
      joinOrder: this.joinCounter++,
      isBot: true,
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
      conn.send({ type: 'error', message: 'Apenas o anfitrião pode iniciar a partida.' });
      return;
    }
    if (room.members.size < MIN_PLAYERS_TO_START) {
      conn.send({ type: 'error', message: `São necessários pelo menos ${MIN_PLAYERS_TO_START} jogadores.` });
      return;
    }
    const allReady = [...room.members.values()].every((m) => m.id === room.hostId || m.ready);
    if (!allReady) {
      conn.send({ type: 'error', message: 'Nem todos os jogadores estão prontos.' });
      return;
    }

    const orderedMembers = [...room.members.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    const gameMembers: RoomMember[] = orderedMembers.map((m, i) => {
      const c = this.conns.get(m.id);
      return {
        id: m.id,
        name: m.isBot ? m.name ?? 'Bot' : c?.name ?? `Jogador ${m.id}`,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        isBot: !!m.isBot,
      };
    });

    const game = new Game(
      gameMembers,
      (playerId, msg) => {
        const c = this.conns.get(playerId);
        if (c) c.send(msg);
      },
      () => this.onGameOver(room.id),
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
      };
    });
    const msg: ServerMessage = { type: 'roomState', roomId, players };
    for (const m of room.members.values()) this.conns.get(m.id)?.send(msg);
  }
}
