// Tipos internos da simulação (estado completo do servidor — os snaps do
// protocolo são projeções destes).

import { UNIT_DEFS } from '@age/shared';
import type {
  BuildingType,
  NodeType,
  ResourceType,
  Resources,
  TrainQueueItem,
  UnitState,
  UnitType,
} from '@age/shared';

export interface Waypoint {
  x: number;
  y: number;
}

export interface Unit {
  id: number;
  owner: number;
  type: UnitType;
  x: number; // centro, em unidades de tile
  y: number;
  hp: number;
  state: UnitState;
  path: Waypoint[];
  /** Waypoints enfileirados (Shift+clique direito): destinos a seguir em sequência
   *  depois de chegar no atual. */
  moveQueue?: Waypoint[];
  carryType?: ResourceType;
  carryAmount: number;
  gatherTargetId?: number; // nó ou fazenda sendo coletada
  gatherResource?: ResourceType;
  dropOffId?: number;
  buildTargetId?: number;
  /** Fila de obras (ids de prédios) a construir em sequência após a atual. */
  buildQueue?: number[];
  attackTargetId?: number;
  attackCooldown: number; // segundos até o próximo golpe
  repathTimer: number;
  aggroTimer: number;
  pathTargetX: number; // posição do alvo quando o caminho foi calculado
  pathTargetY: number;
}

export interface Building {
  id: number;
  owner: number;
  type: BuildingType;
  tileX: number;
  tileY: number;
  hp: number;
  progress: number; // 0..1; 1 = concluído
  queue: TrainQueueItem[];
  rallyX?: number;
  rallyY?: number;
  foodLeft?: number; // apenas fazendas concluídas
  /** Pesquisa de tecnologia em andamento (id + segundos decorridos). */
  research?: { id: string; elapsed: number };
  /** Torre de vigia: alvo atual e recarga da flecha (segundos). */
  targetId?: number;
  attackTimer?: number;
}

export interface ResNode {
  id: number;
  type: NodeType;
  tileX: number;
  tileY: number;
  amount: number;
}

export interface GamePlayer {
  id: number;
  name: string;
  color: string;
  resources: Resources;
  defeated: boolean;
  /** Era atual (1..MAX_AGE). */
  age: number;
  /** Pesquisa de era em andamento (destino + segundos decorridos). */
  ageResearch?: { target: number; elapsed: number };
  /** Tecnologias/upgrades já pesquisados. */
  techs: Set<string>;
}

export function createUnit(id: number, owner: number, type: UnitType, x: number, y: number): Unit {
  return {
    id,
    owner,
    type,
    x,
    y,
    hp: UNIT_DEFS[type].hp,
    state: 'idle',
    path: [],
    carryAmount: 0,
    attackCooldown: 0,
    repathTimer: 0,
    aggroTimer: Math.random() * 0.5, // espalha as checagens de aggro entre ticks
    pathTargetX: 0,
    pathTargetY: 0,
  };
}
