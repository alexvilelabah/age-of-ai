// Protocolo WebSocket — mensagens JSON (uma por frame de texto).
// O servidor é autoritativo: o cliente só envia intenções (comandos) e
// renderiza os snapshots que recebe.

import type {
  BuildingSnap,
  BuildingType,
  MapData,
  NodeSnap,
  PlayerInfo,
  PlayerSnap,
  UnitSnap,
  UnitType,
} from './types';

// ---------- Cliente -> Servidor ----------

export type GameCommand =
  | { kind: 'move'; unitIds: number[]; x: number; y: number }
  | { kind: 'stop'; unitIds: number[] }
  // targetId: nó de recurso OU fazenda concluída do próprio jogador
  | { kind: 'gather'; unitIds: number[]; targetId: number }
  // colocar um prédio novo, ou (mesmo tile/tipo) designar aldeões a uma obra existente.
  // queue=true (Ctrl/Shift): enfileira a obra em vez de substituir a tarefa atual.
  | { kind: 'build'; unitIds: number[]; building: BuildingType; tileX: number; tileY: number; queue?: boolean }
  | { kind: 'train'; buildingId: number; unit: UnitType }
  | { kind: 'cancelTrain'; buildingId: number; index: number }
  | { kind: 'attack'; unitIds: number[]; targetId: number }
  | { kind: 'setRally'; buildingId: number; x: number; y: number }
  // pesquisar a próxima era no Centro da Cidade
  | { kind: 'advanceAge' }
  // pesquisar uma tecnologia/upgrade num prédio
  | { kind: 'research'; buildingId: number; techId: string }
  // Mercado: comprar/vender 1 lote (100) de recurso por ouro (requer mercado pronto)
  | { kind: 'trade'; action: 'buy' | 'sell'; resource: 'food' | 'wood' | 'stone' };

/** Preços do mercado (ouro por lote de 100), compartilhados pela sala. */
export type MarketPrices = Record<'food' | 'wood' | 'stone', number>;

/** Modo da partida: 'normal' (economia do zero) ou 'batalha' (recursos de sobra,
 * já numa era avançada — jogo rápido, direto pro combate). */
export type GameMode = 'normal' | 'batalha';

export type ClientMessage =
  | { type: 'setName'; name: string; clientId?: string }
  | { type: 'setMode'; mode: GameMode } // apenas host: escolhe Normal/Batalha na sala
  | { type: 'listRooms' }
  | { type: 'createRoom' }
  | { type: 'joinRoom'; roomId: string }
  | { type: 'leaveRoom' }
  | { type: 'setReady'; ready: boolean }
  | { type: 'addBot' } // apenas host: adiciona um oponente de IA à sala
  | { type: 'removeBot' } // apenas host: remove o último bot
  | { type: 'startGame' } // apenas host
  | { type: 'chat'; text: string }
  | { type: 'cmd'; cmd: GameCommand };

// ---------- Servidor -> Cliente ----------

export interface RoomSummary {
  id: string;
  hostName: string; // nome de quem criou a sala (mostrado no lugar do código)
  playerCount: number;
  maxPlayers: number;
  inGame: boolean;
}

export interface RoomPlayer {
  id: number;
  name: string;
  ready: boolean;
  isHost: boolean;
  color: string;
  isBot?: boolean;
}

export type ServerMessage =
  | { type: 'welcome'; playerId: number }
  | { type: 'nameOk' }              // nome aceito -> pode ir pro lobby
  | { type: 'nameTaken' }           // nome já em uso -> escolha outro
  | { type: 'roomList'; rooms: RoomSummary[] }
  | { type: 'roomState'; roomId: string; players: RoomPlayer[]; mode: GameMode }
  | { type: 'leftRoom' }
  // Erro: o servidor manda um CÓDIGO (traduzido no cliente via i18n) + params
  // opcionais. `age` (número) e `building` (tipo) são convertidos para o nome
  // no idioma do jogador pelo cliente. `message` é reserva (texto pronto).
  | { type: 'error'; code: string; params?: Record<string, string | number>; message?: string }
  | { type: 'chat'; from: string; text: string }
  | { type: 'gameStart'; map: MapData; players: PlayerInfo[]; you: number }
  | {
      type: 'snapshot';
      tick: number;
      units: UnitSnap[];
      buildings: BuildingSnap[];
      nodes: NodeSnap[];
      players: PlayerSnap[];
      /** Preços do mercado (ouro por lote de 100) — globais da sala. */
      market: MarketPrices;
    }
  | { type: 'gameOver'; winner: number; winnerName: string };
