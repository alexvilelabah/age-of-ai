// Tipos de dados compartilhados entre servidor e cliente.
// Convenções:
//  - Posições de unidades são floats em unidades de tile (centro da unidade).
//  - Prédios são ancorados no tile superior-esquerdo e ocupam size x size tiles.
//  - Ids de unidades, prédios e nós de recurso vêm de um contador único
//    (um id nunca se repete entre categorias — comandos usam targetId genérico).

export type ResourceType = 'food' | 'wood' | 'gold' | 'stone';
export type UnitType =
  | 'villager' | 'swordsman' | 'archer' | 'knight'
  // Navais (andam SÓ na água; treinadas no Porto):
  | 'fishing_boat' // pesca bancos de peixe e entrega no Porto
  | 'war_galley'   // barco de guerra (ataque à distância)
  | 'transport';   // leva unidades terrestres pelo rio (embarcar/desembarcar)
export type BuildingType =
  | 'town_center'
  | 'house'
  | 'barracks'
  | 'farm'
  | 'archery_range'
  | 'stable'
  | 'blacksmith'
  | 'market'
  | 'wall'
  | 'watch_tower'
  | 'mill'          // depósito de comida
  | 'lumber_camp'   // depósito de madeira
  | 'mining_camp'   // depósito de ouro e pedra
  | 'dock';         // Porto: NA água (costa); deposita peixe e treina barcos
export type NodeType = 'tree' | 'berry_bush' | 'gold_mine' | 'stone_mine' | 'fish';

export type Resources = Record<ResourceType, number>;

export type UnitState =
  | 'idle'
  | 'moving'
  | 'movingToGather'
  | 'gathering'
  | 'returning'      // levando recursos ao depósito
  | 'movingToBuild'
  | 'building'
  | 'movingToGarrison' // indo entrar numa torre/Centro (guarnição)
  | 'movingToAttack'
  | 'attacking';

export interface UnitSnap {
  id: number;
  owner: number; // playerId
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  state: UnitState;
  carryType?: ResourceType;
  carryAmount?: number;
  targetId?: number;
  /** Barco de transporte: quantas unidades estão embarcadas. */
  garrison?: number;
}

// progress 0..1 — apenas o primeiro item da fila avança
export interface TrainQueueItem {
  unit: UnitType;
  progress: number;
}

export interface BuildingSnap {
  id: number;
  owner: number;
  type: BuildingType;
  tileX: number; // canto superior-esquerdo
  tileY: number;
  hp: number;
  progress: number; // 0..1 de construção; 1 = concluído
  queue: TrainQueueItem[];
  rallyX?: number;
  rallyY?: number;
  foodLeft?: number; // apenas fazendas concluídas
  /** Pesquisa de tecnologia em andamento neste prédio (id + progresso 0..1). */
  research?: { id: string; progress: number };
  /** Alvo atual (torres de vigia atirando — o cliente desenha a flecha). */
  targetId?: number;
  /** Quantas unidades estão GUARNECIDAS dentro (torre/Centro) — o cliente mostra
   *  a contagem e desenha flechas extras. */
  garrison?: number;
}

export interface NodeSnap {
  id: number;
  type: NodeType;
  tileX: number;
  tileY: number;
  amount: number; // recurso restante
}

/** Ovelha (estilo AoE): comida do início de jogo, branca quando selvagem
 *  (owner = -1), tingida da cor do dono quando um jogador a converte
 *  chegando perto. Posição em coordenadas de tile (centro), como as unidades. */
export interface SheepSnap {
  id: number;
  owner: number; // -1 = selvagem (branca)
  x: number;
  y: number;
  food: number; // comida restante
}

export interface PlayerSnap {
  id: number;
  resources: Resources;
  pop: number;
  popCap: number;
  defeated: boolean;
  /** Era atual (1..MAX_AGE). */
  age: number;
  /** Progresso 0..1 da pesquisa da próxima era (ausente se não pesquisando). */
  ageProgress?: number;
  /** Ids das tecnologias já pesquisadas. */
  techs: string[];
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  team?: number; // 0/ausente = sozinho; 1/2 = time (aliados)
}

export interface MapData {
  size: number;
  // row-major: tiles[y * size + x]; valores TILE_GRASS | TILE_WATER (constants.ts)
  tiles: number[];
}
