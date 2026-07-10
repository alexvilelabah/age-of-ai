// Constantes de rede, simulação e balanceamento — fonte única da verdade
// para servidor (validação/simulação) e cliente (UI, custos, pré-validação).

import type { BuildingType, NodeType, Resources, ResourceType, UnitType } from './types';

// ---------- Rede ----------
export const GAME_PORT = 8080;

// ---------- Simulação ----------
export const TICK_RATE = 10; // ticks por segundo
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_TICKS = 2; // snapshot completo a cada N ticks (5/s)

// ---------- Mapa ----------
// Escala estilo Age of Empires 2 ("Pequeno" = 144x144). É só este número para
// redimensionar o mundo inteiro (servidor e cliente se ajustam).
export const MAP_SIZE = 144; // MAP_SIZE x MAP_SIZE tiles
export const TILE_GRASS = 0;
export const TILE_WATER = 1;

// ---------- Partida ----------
export const MAX_PLAYERS_PER_ROOM = 4;
export const MIN_PLAYERS_TO_START = 2;
export const STARTING_RESOURCES: Resources = { food: 250, wood: 250, gold: 100, stone: 100 };
// Modo "Batalha/Rápido": começa cheio de recursos e numa era avançada, para ir
// direto ao combate (partida rápida — e ótimo pra gravar o gameplay).
export const BATTLE_STARTING_RESOURCES: Resources = { food: 20000, wood: 20000, gold: 20000, stone: 10000 };
export const BATTLE_STARTING_AGE = 3; // Idade dos Castelos: quartel/arquearia/estábulo já liberados
export const START_VILLAGERS = 3;
export const POP_CAP_MAX = 75;

// ---------- Coleta ----------
export const CARRY_CAPACITY = 10; // quanto um aldeão carrega antes de depositar
export const GATHER_RATE = 1.0;   // recursos por segundo
export const FARM_FOOD = 250;     // comida total de uma fazenda concluída

// ---------- Unidades ----------
export interface UnitDef {
  hp: number;
  speed: number;          // tiles por segundo
  attack: number;         // dano por golpe
  range: number;          // alcance em tiles (1 = corpo a corpo)
  attackCooldown: number; // segundos entre golpes
  sight: number;          // raio de visão/aggro em tiles
  cost: Partial<Resources>;
  trainTime: number;      // segundos
  pop: number;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  villager:  { hp: 30,  speed: 2.0, attack: 3,  range: 1,   attackCooldown: 1.5, sight: 5, cost: { food: 50 },           trainTime: 8,  pop: 1 },
  swordsman: { hp: 60,  speed: 1.8, attack: 9,  range: 1,   attackCooldown: 1.2, sight: 5, cost: { food: 60, gold: 20 }, trainTime: 10, pop: 1 },
  archer:    { hp: 35,  speed: 1.9, attack: 6,  range: 4.5, attackCooldown: 1.5, sight: 6, cost: { wood: 40, gold: 30 }, trainTime: 10, pop: 1 },
  knight:    { hp: 100, speed: 2.6, attack: 14, range: 1,   attackCooldown: 1.2, sight: 6, cost: { food: 70, gold: 50 }, trainTime: 16, pop: 1 },
};

// ---------- Prédios ----------
export interface BuildingDef {
  hp: number;
  size: number; // ocupa size x size tiles
  cost: Partial<Resources>;
  buildTime: number; // segundos com 1 construtor
  popProvided: number;
  trains: UnitType[];
  isDropOff: boolean; // aceita depósito de recursos
  ageReq: number;     // era mínima para poder construir (1 = desde o início)
  accepts?: ResourceType[]; // se depósito: recursos que aceita (ausente = TODOS, ex.: Centro da Cidade)
  /** Pré-requisito de prédio (árvore do AoE2): precisa ter um CONCLUÍDO deste
   *  tipo pra construir. Ex.: Fazenda/Mercado ← Moinho; Arquearia/Estábulo/
   *  Ferraria ← Quartel. Sem o pré-requisito o botão nem aparece no menu. */
  requires?: BuildingType;
}

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  town_center:   { hp: 1000, size: 3, cost: { wood: 275, stone: 100 }, buildTime: 60, popProvided: 5, trains: ['villager'],   isDropOff: true,  ageReq: 1 },
  house:         { hp: 250,  size: 2, cost: { wood: 50 },              buildTime: 12, popProvided: 5, trains: [],              isDropOff: false, ageReq: 1 },
  barracks:      { hp: 700,  size: 3, cost: { wood: 150 },             buildTime: 25, popProvided: 0, trains: ['swordsman'],   isDropOff: false, ageReq: 1 },
  farm:          { hp: 120,  size: 2, cost: { wood: 60 },              buildTime: 10, popProvided: 0, trains: [],              isDropOff: false, ageReq: 1, requires: 'mill' },
  archery_range: { hp: 700,  size: 3, cost: { wood: 175 },             buildTime: 25, popProvided: 0, trains: ['archer'],      isDropOff: false, ageReq: 2, requires: 'barracks' },
  stable:        { hp: 700,  size: 3, cost: { wood: 175 },             buildTime: 25, popProvided: 0, trains: ['knight'],      isDropOff: false, ageReq: 3, requires: 'barracks' },
  blacksmith:    { hp: 700,  size: 2, cost: { wood: 150 },             buildTime: 25, popProvided: 0, trains: [],              isDropOff: false, ageReq: 2, requires: 'barracks' },
  market:        { hp: 600,  size: 2, cost: { wood: 150 },             buildTime: 25, popProvided: 0, trains: [],              isDropOff: false, ageReq: 2, requires: 'mill' },
  wall:          { hp: 550,  size: 1, cost: { stone: 10 },             buildTime: 6,  popProvided: 0, trains: [],              isDropOff: false, ageReq: 1 },
  watch_tower:   { hp: 480,  size: 1, cost: { wood: 40, stone: 80 },   buildTime: 22, popProvided: 0, trains: [],              isDropOff: false, ageReq: 2 },
  mill:          { hp: 250,  size: 2, cost: { wood: 100 },             buildTime: 15, popProvided: 0, trains: [],              isDropOff: true,  ageReq: 1, accepts: ['food'] },
  lumber_camp:   { hp: 250,  size: 2, cost: { wood: 100 },             buildTime: 15, popProvided: 0, trains: [],              isDropOff: true,  ageReq: 1, accepts: ['wood'] },
  mining_camp:   { hp: 250,  size: 2, cost: { wood: 100 },             buildTime: 15, popProvided: 0, trains: [],              isDropOff: true,  ageReq: 1, accepts: ['gold', 'stone'] },
};

// ---------- Mercado: compra/venda de recursos por ouro ----------
// Preços em ouro por LOTE de 100 unidades, compartilhados pela sala (estilo
// AoE2): comprar encarece o recurso, vender barateia — para todo mundo.
export const TRADE_LOT = 100;
export const MARKET_START_PRICE = 100;
export const MARKET_PRICE_STEP = 5;   // variação do preço a cada transação
export const MARKET_PRICE_MIN = 25;
export const MARKET_PRICE_MAX = 250;
export const MARKET_FEE = 0.15;       // taxa do mercador (spread compra/venda)
/** Quanto CUSTA comprar 1 lote ao preço atual (com taxa). */
export function tradeBuyCost(price: number): number {
  return Math.ceil(price * (1 + MARKET_FEE));
}
/** Quanto RENDE vender 1 lote ao preço atual (com taxa). */
export function tradeSellGain(price: number): number {
  return Math.floor(price * (1 - MARKET_FEE));
}

// ---------- Torre de vigia (combate de prédio) ----------
export const TOWER_RANGE = 6.5;    // alcance em tiles
export const TOWER_COOLDOWN = 1.6; // segundos entre flechas
/** Dano da flecha da torre — cresce com a era do dono (torre "evolui"). */
export function towerAttack(age: number): number {
  return 6 + Math.max(0, age - 2) * 2;
}

export const TRAIN_QUEUE_MAX = 5;

// ---------- Eras (estilo AoE2) ----------
// Pesquisadas no Centro da Cidade; liberam unidades e mudam o visual dos prédios.
export const MAX_AGE = 4;
export const AGE_NAMES: string[] = ['', 'Idade das Trevas', 'Idade Feudal', 'Idade dos Castelos', 'Idade Imperial'];
export const AGE_NUMERALS: string[] = ['', 'I', 'II', 'III', 'IV'];
/** Custo para pesquisar a era N (índice = era destino) — valores do Age of
 *  Mythology (Clássica 400c; Heroica 800c+500o; Mítica 1000c+1000o): o último
 *  salto é BEM caro, compensando pedir poucos prédios. */
export const AGE_COSTS: Partial<Resources>[] = [
  {}, {},
  { food: 400 },              // -> Feudal
  { food: 800, gold: 500 },   // -> Castelos
  { food: 1000, gold: 1000 }, // -> Imperial
];
/** Tempo de pesquisa (s) da era N (índice = era destino). */
export const AGE_RESEARCH_TIME: number[] = [0, 0, 25, 40, 55];
/** REGRA DO AoE2 pra avançar de era: além dos recursos, é preciso ter construído
 *  2 prédios DIFERENTES da era atual — e Casa, Fazenda e Muralha NÃO contam
 *  (nem o Centro da Cidade). Ex.: nas Trevas valem Quartel/Moinho/Madeireira/
 *  Campo de Mineração. Duas cópias do mesmo prédio contam como UM. */
export const AGE_UP_EXCLUDED: ReadonlySet<BuildingType> = new Set<BuildingType>(['town_center', 'house', 'farm', 'wall']);

/** Este tipo conta pro avanço a partir da era `fromAge`? */
export function countsForAgeUp(type: BuildingType, fromAge: number): boolean {
  return !AGE_UP_EXCLUDED.has(type) && BUILDING_DEFS[type].ageReq === fromAge;
}

/** Nº de prédios (tipos distintos) exigidos pra sair de cada era — estilo Age
 *  of Mythology (pede POUCOS prédios e recursos cada vez mais caros): sair da
 *  era 1 = 1 prédio, era 2 = 2 prédios, era 3 = 1 prédio. (índice = era atual) */
const AGE_UP_WANTED = [0, 1, 2, 1];

export function buildingsToAdvance(fromAge: number): number {
  let types = 0;
  for (const t of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    if (countsForAgeUp(t, fromAge)) types++;
  }
  return Math.min(AGE_UP_WANTED[fromAge] ?? 1, types);
}
/** Era mínima para treinar cada unidade. */
export const UNIT_AGE_REQ: Record<UnitType, number> = {
  villager: 1,
  swordsman: 1,
  archer: 2,
  knight: 3,
};

// ---------- Tecnologias / upgrades (pesquisados nos prédios) ----------
export interface TechDef {
  id: string;
  name: string;
  icon: string;
  building: BuildingType; // onde é pesquisada
  ageReq: number;
  cost: Partial<Resources>;
  time: number;           // segundos de pesquisa
  prereq?: string;        // tecnologia obrigatória antes
  units: UnitType[];      // unidades afetadas pelo bônus (vazio = tech econômica)
  addAttack?: number;
  addHp?: number;
  addArmor?: number;      // reduz o dano recebido
  addRange?: number;      // alcance (arqueiro)
  /** Bônus econômico: fração a mais na velocidade de coleta por recurso (0.2 = +20%). */
  gather?: Partial<Record<ResourceType, number>>;
  /** Bônus econômico: capacidade extra de carga do aldeão. */
  carry?: number;
}

const MELEE: UnitType[] = ['swordsman', 'knight'];
const ARCHER: UnitType[] = ['archer'];

export const TECH_DEFS: TechDef[] = [
  // --- Ferraria: ataque e blindagem para todo o exército ---
  { id: 'forging',      name: 'Forja',              icon: '🔨', building: 'blacksmith', ageReq: 2, cost: { food: 150 },            time: 25, units: MELEE,  addAttack: 1 },
  { id: 'iron_casting', name: 'Fundição de Ferro',  icon: '🔥', building: 'blacksmith', ageReq: 3, cost: { food: 220, gold: 120 }, time: 30, prereq: 'forging', units: MELEE, addAttack: 1 },
  { id: 'fletching',    name: 'Retesamento',        icon: '🪶', building: 'blacksmith', ageReq: 2, cost: { food: 100, gold: 50 },  time: 20, units: ARCHER, addAttack: 1, addRange: 0.5 },
  { id: 'bodkin',       name: 'Ponta Bodkin',       icon: '➶',  building: 'blacksmith', ageReq: 3, cost: { food: 200, gold: 100 }, time: 25, prereq: 'fletching', units: ARCHER, addAttack: 1, addRange: 0.5 },
  { id: 'scale_mail',   name: 'Cota de Escamas',    icon: '🛡️', building: 'blacksmith', ageReq: 2, cost: { food: 100 },            time: 25, units: MELEE,  addArmor: 1 },
  { id: 'padded_armor', name: 'Armadura Acolchoada', icon: '🧥', building: 'blacksmith', ageReq: 2, cost: { food: 100 },           time: 25, units: ARCHER, addArmor: 1 },

  // --- Quartel: linha da infantaria ---
  { id: 'man_at_arms',   name: 'Homem de Armas', icon: '⚔️', building: 'barracks', ageReq: 2, cost: { food: 100, gold: 40 },  time: 30, units: ['swordsman'], addAttack: 2, addHp: 15 },
  { id: 'long_swordsman', name: 'Espada Longa',  icon: '🗡️', building: 'barracks', ageReq: 3, cost: { food: 200, gold: 65 },  time: 35, prereq: 'man_at_arms', units: ['swordsman'], addAttack: 2, addHp: 15 },

  // --- Arquearia: linha dos arqueiros ---
  { id: 'crossbow', name: 'Besteiro', icon: '🎯', building: 'archery_range', ageReq: 3, cost: { food: 125, gold: 75 }, time: 30, units: ['archer'], addAttack: 1, addHp: 5, addRange: 0.5 },

  // --- Estábulo: linha da cavalaria ---
  { id: 'cavalier', name: 'Cavaleiro Pesado', icon: '🐴', building: 'stable', ageReq: 3, cost: { food: 300, gold: 300 }, time: 40, units: ['knight'], addAttack: 2, addHp: 20 },
  { id: 'paladin',  name: 'Paladino',         icon: '🏇', building: 'stable', ageReq: 4, cost: { food: 500, gold: 350 }, time: 50, prereq: 'cavalier', units: ['knight'], addAttack: 4, addHp: 40 },

  // --- Mercado: melhorias econômicas (coleta mais rápida, mais carga) ---
  { id: 'sharp_sickles', name: 'Foices Afiadas',    icon: '🌾', building: 'market', ageReq: 2, cost: { wood: 100 },            time: 25, units: [], gather: { food: 0.2 } },
  { id: 'steel_axes',    name: 'Machados de Aço',   icon: '🪓', building: 'market', ageReq: 2, cost: { food: 100 },            time: 25, units: [], gather: { wood: 0.2 } },
  { id: 'iron_picks',    name: 'Picaretas de Ferro', icon: '⛏️', building: 'market', ageReq: 2, cost: { food: 100, wood: 50 }, time: 25, units: [], gather: { gold: 0.2, stone: 0.2 } },
  { id: 'wheelbarrow',   name: 'Carrinho de Mão',   icon: '🛒', building: 'market', ageReq: 3, cost: { food: 150, wood: 75 },  time: 30, units: [], carry: 5 },
];

const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECH_DEFS.map((t) => [t.id, t]));

/** Bônus acumulado (ataque/blindagem/vida/alcance) das techs para uma unidade. */
export function techBonus(
  techs: Iterable<string>,
  type: UnitType,
): { attack: number; armor: number; hp: number; range: number } {
  let attack = 0;
  let armor = 0;
  let hp = 0;
  let range = 0;
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (!t || !t.units.includes(type)) continue;
    attack += t.addAttack ?? 0;
    armor += t.addArmor ?? 0;
    hp += t.addHp ?? 0;
    range += t.addRange ?? 0;
  }
  return { attack, armor, hp, range };
}

/** Multiplicador de coleta de um recurso com as techs econômicas (1 = normal). */
export function gatherMultiplier(techs: Iterable<string>, resource: ResourceType): number {
  let mul = 1;
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (t?.gather?.[resource]) mul += t.gather[resource]!;
  }
  return mul;
}

/** Capacidade de carga do aldeão com as techs econômicas. */
export function carryCapacity(techs: Iterable<string>): number {
  let cap = CARRY_CAPACITY;
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (t?.carry) cap += t.carry;
  }
  return cap;
}

// ---------- Nós de recurso ----------
export interface NodeDef {
  resource: ResourceType;
  amount: number;
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  tree:       { resource: 'wood',  amount: 130 },
  berry_bush: { resource: 'food',  amount: 200 },
  gold_mine:  { resource: 'gold',  amount: 650 },
  stone_mine: { resource: 'stone', amount: 550 },
};

// ---------- Jogadores ----------
export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
