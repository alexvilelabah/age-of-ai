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
// Raso (vau): a travessia a pé do mapa Rio — passável por unidades E barcos.
export const TILE_SHALLOW = 2;

// ---------- Partida ----------
export const MAX_PLAYERS_PER_ROOM = 4;
// 1 permite treinar 100% sozinho (o host remove o bot automático da sala).
export const MIN_PLAYERS_TO_START = 1;
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
  // ---- Navais (só água; treinadas no Porto) ----
  fishing_boat: { hp: 60,  speed: 2.2, attack: 0,  range: 0,   attackCooldown: 1,   sight: 6, cost: { wood: 60 },            trainTime: 10, pop: 1 },
  war_galley:   { hp: 130, speed: 2.4, attack: 8,  range: 5.5, attackCooldown: 1.6, sight: 7, cost: { wood: 90, gold: 30 },  trainTime: 14, pop: 2 },
  transport:    { hp: 110, speed: 2.6, attack: 0,  range: 0,   attackCooldown: 1,   sight: 6, cost: { wood: 80 },            trainTime: 12, pop: 1 },
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
  // Porto: construído NA ÁGUA encostado na costa; deposita o peixe e treina barcos.
  dock:          { hp: 600,  size: 2, cost: { wood: 150 },             buildTime: 20, popProvided: 0, trains: ['fishing_boat', 'war_galley', 'transport'], isDropOff: true, ageReq: 1, accepts: ['food'] },
};

// ---------- Naval ----------
/** Unidades que andam SÓ na água (água funda ou raso). */
export const NAVAL_UNITS: ReadonlySet<UnitType> = new Set(['fishing_boat', 'war_galley', 'transport']);
export const isNavalUnit = (t: UnitType): boolean => NAVAL_UNITS.has(t);
/** Capacidade do barco de transporte (unidades terrestres embarcadas). */
export const TRANSPORT_CAP = 5;
/** Quanto o barco de pesca carrega antes de entregar no Porto. */
export const FISH_BOAT_CARRY = 15;
/** Raio mínimo entre barcos (empurra-afasta suave — não ficam colados). */
export const BOAT_SEPARATION = 0.9;

// ---------- Visão (névoa de guerra, só apresentação no cliente) ----------
// Raios em tiles, medidos do CENTRO da fonte. Unidades usam o `sight` delas.
export const BUILDING_VISION_DEFAULT = 6;
export const BUILDING_VISION: Partial<Record<BuildingType, number>> = {
  town_center: 9,
  watch_tower: 9,
  dock: 7,
};
export const SHEEP_VISION = 3;

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

// ---------- Prédios de defesa (torre de vigia + Centro da Cidade atiram flechas) ----------
export interface DefenseDef {
  range: number;    // alcance base em tiles (na era mínima do prédio)
  cooldown: number; // segundos entre flechas
  attack: number;   // dano base por flecha
}
/** Prédios que atiram flechas nos inimigos próximos. Alcance e dano crescem com
 *  a era do dono e com as pesquisas de defesa — ver buildingRange/buildingAttack. */
export const DEFENSE_DEFS: Partial<Record<BuildingType, DefenseDef>> = {
  watch_tower: { range: 6.5, cooldown: 1.5, attack: 5 },
  town_center: { range: 6,   cooldown: 2.0, attack: 4 },
};
/** Ganho por era acima da 1ª: a cada avanço, a flecha vai mais longe e bate mais. */
export const DEFENSE_RANGE_PER_AGE = 0.5;
export const DEFENSE_ATTACK_PER_AGE = 1.5;

/** Capacidade de GUARNIÇÃO (quantas unidades cabem dentro pra se proteger). Cada
 *  unidade guarnecida faz o prédio atirar uma flecha a mais (até a capacidade). */
export const GARRISON_CAP: Partial<Record<BuildingType, number>> = {
  town_center: 10,
  watch_tower: 5,
};

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
  fishing_boat: 1,
  war_galley: 2, // barco de guerra a partir da Idade Feudal (estilo AoE)
  transport: 1,  // travessia cedo: o rio não pode trancar o mapa na Idade das Trevas
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
  /** Bônus de DEFESA de prédio (torre de vigia + Centro da Cidade): dano e/ou
   *  alcance das flechas. Techs de defesa têm `units: []`. */
  defense?: { attack?: number; range?: number };
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

  // --- Centro da Cidade: defesa (torres e CC atiram mais longe / mais forte) ---
  { id: 'ballistics', name: 'Balística', icon: '📐', building: 'town_center', ageReq: 2, cost: { wood: 150, gold: 75 },  time: 30, units: [], defense: { range: 1 } },
  { id: 'arrowslits', name: 'Frestas',   icon: '🗼', building: 'town_center', ageReq: 3, cost: { food: 150, wood: 100 }, time: 35, prereq: 'ballistics', units: [], defense: { attack: 3 } },
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

/** Bônus de defesa de prédio (alcance/dano de flecha) das techs pesquisadas. */
export function defenseBonus(techs?: Iterable<string>): { attack: number; range: number } {
  let attack = 0;
  let range = 0;
  if (techs) {
    for (const id of techs) {
      const d = TECH_BY_ID[id]?.defense;
      if (d) {
        attack += d.attack ?? 0;
        range += d.range ?? 0;
      }
    }
  }
  return { attack, range };
}

/** Alcance de tiro de um prédio de defesa: base + cresce por era + pesquisas. */
export function buildingRange(type: BuildingType, age: number, techs?: Iterable<string>): number {
  const def = DEFENSE_DEFS[type];
  if (!def) return 0;
  return def.range + Math.max(0, age - 1) * DEFENSE_RANGE_PER_AGE + defenseBonus(techs).range;
}

/** Dano por flecha de um prédio de defesa: base + cresce por era + pesquisas. */
export function buildingAttack(type: BuildingType, age: number, techs?: Iterable<string>): number {
  const def = DEFENSE_DEFS[type];
  if (!def) return 0;
  return def.attack + Math.max(0, age - 1) * DEFENSE_ATTACK_PER_AGE + defenseBonus(techs).attack;
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
  // Banco de peixes (só no mapa Rio): MUITA comida — pesca longa, estilo AoE.
  fish:       { resource: 'food',  amount: 450 },
};

// ---------- Ovelhas (comida do início, estilo AoE) ----------
export const SHEEP_WILD_OWNER = -1;   // dono sentinela = selvagem (branca)
export const SHEEP_FOOD = 100;        // comida por ovelha (também: fronteira "saudável ≥100 / carcaça <100")
export const SHEEP_FOOD_MAX = 150;    // teto: ovelha saudável e PARADA engorda até aqui
export const SHEEP_FATTEN_PER_S = 0.5; // comida/s ganha ao engordar parada (devagar; decay é 2/s)
export const SHEEP_CONVERT_RANGE = 3.0; // tiles: unidade mais perta que isto "rouba" a ovelha
export const SHEEP_CONVERT_EVERY_TICKS = 5; // varre conversão 2x/s (TICK_RATE=10)
export const SHEEP_SPEED = 0.7;       // tiles/s quando pastoreada (Fase 2)
export const SHEEP_DECAY_PER_S = 2;   // carcaça abandonada apodrece (comida/s) até sumir (AoE)
export const SHEEP_HERD_MIN = 2;      // rebanho perto do CV
export const SHEEP_HERD_MAX = 4;
export const SHEEP_SCATTER_CLUSTERS = 3; // grupinhos espalhados pelo mapa
export const SHEEP_SCATTER_PER_CLUSTER = 2;

// ---------- Jogadores ----------
export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
