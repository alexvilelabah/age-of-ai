// IA de oponente: administra economia, cidade, pesquisas e exercito usando os
// mesmos comandos e validacoes de um jogador humano.
//
// O planejador abaixo evita a antiga cidade "colada no CC": reserva uma praca
// e quatro vias, escolhe locais por funcao, verifica conectividade antes de
// construir e fecha a base aos poucos com muralhas que deixam entradas abertas.

import {
  AGE_COSTS,
  BUILDING_DEFS,
  buildingsToAdvance,
  countsForAgeUp,
  MAX_AGE,
  POP_CAP_MAX,
  SHEEP_WILD_OWNER,
  TECH_DEFS,
  TILE_GRASS,
  TRAIN_QUEUE_MAX,
  UNIT_AGE_REQ,
  UNIT_DEFS,
} from '@age/shared';
import type { BotDifficulty, BuildingType, NodeType, ResourceType, UnitType } from '@age/shared';
import { idx, type Grid } from './path';
import type { Game } from './room';
import type { Building, ResNode, Sheep, Unit } from './state';

interface Pt { x: number; y: number }
type BuildRole = 'house' | 'civic' | 'military' | 'resource' | 'farm' | 'tower';

interface BotProfile {
  name: 'balanced' | 'aggressive' | 'defensive' | 'economic';
  targetVillagers: number;
  attackArmy: number;
  wallAge: number;
  wallRadius: number;
  stoneReserve: number;
  maxTowers: number;
  extraBarracks: number;
}

interface PlanContext {
  game: Game;
  botId: number;
  tc: Building;
  units: Unit[];
  villagers: Unit[];
  buildings: Building[];
  nodes: ResNode[];
  base: Pt;
  enemyDir: Pt;
  anchor: Pt | null;
  reachableBefore: Uint8Array | null;
}

interface SpotRequest {
  role: BuildRole;
  target?: Pt;
  minRadius?: number;
  maxRadius?: number;
  clearance?: number;
}

const PROFILES: readonly BotProfile[] = [
  { name: 'balanced',   targetVillagers: 18, attackArmy: 7,  wallAge: 2, wallRadius: 14, stoneReserve: 70,  maxTowers: 2, extraBarracks: 0 },
  { name: 'aggressive', targetVillagers: 15, attackArmy: 5,  wallAge: 3, wallRadius: 13, stoneReserve: 110, maxTowers: 1, extraBarracks: 1 },
  { name: 'defensive',  targetVillagers: 18, attackArmy: 9,  wallAge: 2, wallRadius: 12, stoneReserve: 30,  maxTowers: 3, extraBarracks: 0 },
  { name: 'economic',   targetVillagers: 20, attackArmy: 10, wallAge: 3, wallRadius: 15, stoneReserve: 90,  maxTowers: 2, extraBarracks: 0 },
];

// --- Dificuldade (escolhida ao adicionar o bot; estilo Age of Mythology) ---
// A PERSONALIDADE (PROFILES, acima) define o ESTILO (muralha/torre/defesa); a
// DIFICULDADE define a FORCA: tamanho da economia, exercito pra atacar,
// velocidade pra subir de era, se o bot ATACA primeiro e o bonus de recursos
// iniciais (Tita no mais dificil). Assim dois bots do mesmo nivel ainda variam.
export interface DifficultySettings {
  /** false = passivo: nunca ataca primeiro (so revida — o motor faz isso sozinho). */
  initiatesAttacks: boolean;
  /** Quantos aldeoes o bot tenta manter. */
  targetVillagers: number;
  /** Soldados acumulados antes de partir pro ataque. */
  attackArmy: number;
  /** Aldeoes minimos (na era 1) pra comecar a pesquisar a proxima era. */
  ageGateVillagers: number;
  /** Multiplicador dos recursos iniciais (>1 = bonus estilo Tita). */
  resourceMult: number;
}

export const DIFFICULTY: Record<BotDifficulty, DifficultySettings> = {
  easy:   { initiatesAttacks: false, targetVillagers: 10, attackArmy: 99, ageGateVillagers: 9, resourceMult: 1 },
  normal: { initiatesAttacks: true,  targetVillagers: 16, attackArmy: 9,  ageGateVillagers: 6, resourceMult: 1 },
  hard:   { initiatesAttacks: true,  targetVillagers: 22, attackArmy: 6,  ageGateVillagers: 5, resourceMult: 1 },
  expert: { initiatesAttacks: true,  targetVillagers: 28, attackArmy: 5,  ageGateVillagers: 4, resourceMult: 1.6 },
};

const ROAD_RADIUS = 22;
const BASE_APRON = 2;
const MAX_CONCURRENT_CORE_BUILDS = 2;
// Teto de checagens caras de conectividade (cada uma faz um flood do mapa) por
// busca de local de PREDIO.
const MAX_CONNECTIVITY_CHECKS = 36;
// Muralha tem teto MENOR: perto de fechar o anel, muitos pontos falham a
// conectividade e a busca chega ao teto — como a muralha e gradual (tenta a
// cada tick) e as ruas ja deixam as passagens, um teto baixo evita o pico de
// CPU sem prejudicar a defesa. Os ultimos segmentos podem so demorar mais.
const MAX_WALL_CHECKS = 18;

export function runBotAI(game: Game, botId: number): void {
  const player = game.players.get(botId);
  if (!player || player.defeated) return;

  const units = [...game.units.values()].filter((u) => u.owner === botId);
  const buildings = [...game.buildings.values()].filter((b) => b.owner === botId);
  const tc = buildings.find((b) => b.type === 'town_center');
  if (!tc) return;

  const villagers = units.filter((u) => u.type === 'villager');
  const military = units.filter((u) => u.type !== 'villager');
  const nodes = [...game.nodes.values()];
  const profile = profileFor(botId);
  const diff = DIFFICULTY[player.difficulty ?? 'normal'];
  const base = buildingCenter(tc);
  const enemy = nearestEnemyBuilding(game, botId, base.x, base.y);
  const enemyPoint = enemy ? buildingCenter(enemy) : { x: game.grid.size / 2, y: game.grid.size / 2 };
  const enemyDir = normalized(enemyPoint.x - base.x, enemyPoint.y - base.y);
  const anchor = findBaseAnchor(game.grid, tc);
  const ctx: PlanContext = {
    game, botId, tc, units, villagers, buildings, nodes, base, enemyDir, anchor,
    // Preguicoso: so calcula a alcancabilidade "antes" quando (e se) for validar
    // uma obra neste tick. Em ticks sem construcao, nenhum flood roda.
    reachableBefore: null,
  };

  const resources = player.resources;
  const afford = (cost: Partial<Record<ResourceType, number>>, reserve: Partial<Record<ResourceType, number>> = {}): boolean => {
    for (const [kind, amount] of Object.entries(cost) as [ResourceType, number][]) {
      if ((resources[kind] ?? 0) - (reserve[kind] ?? 0) < (amount ?? 0)) return false;
    }
    return true;
  };

  let pop = 0;
  for (const u of units) pop += UNIT_DEFS[u.type]?.pop ?? 1;
  let popCap = 0;
  for (const b of buildings) if (b.progress >= 1) popCap += BUILDING_DEFS[b.type].popProvided;
  popCap = Math.min(POP_CAP_MAX, popCap);

  // Primeiro distribui quem ficou ocioso. Se o mesmo aldeao for escolhido para
  // uma obra neste tick, o comando de construir (enfileirado depois) prevalece.
  assignIdleVillagers(game, botId, villagers, buildings, nodes, player.age, resources, profile);

  const wip = buildings.filter((b) => b.progress < 1);
  let startedBuilding = false;

  // Casa e a unica obra que pode furar a fila: evita travar toda a economia.
  const houseWip = wip.some((b) => b.type === 'house');
  if (pop >= popCap - 2 && popCap < POP_CAP_MAX && !houseWip && afford(BUILDING_DEFS.house.cost)) {
    startedBuilding = issueBuild(ctx, 'house', { role: 'house', minRadius: 6, maxRadius: 13 }, 1);
  }

  const haveAgeBuildings = new Set<BuildingType>();
  for (const b of buildings) {
    if (b.progress >= 1 && countsForAgeUp(b.type, player.age)) haveAgeBuildings.add(b.type);
  }
  const ageNeed = buildingsToAdvance(player.age);
  const ageReady = haveAgeBuildings.size >= ageNeed;
  const ageCost = player.age < MAX_AGE ? (AGE_COSTS[player.age + 1] ?? {}) : {};
  const wantsAge = !player.ageResearch && player.age < MAX_AGE
    && villagers.length >= diff.ageGateVillagers + (player.age - 1) * 3;
  const preparingAge = wantsAge && haveAgeBuildings.size >= Math.max(0, ageNeed - 1);

  // Quando os requisitos estao prontos, economiza e avanca antes de gastar em
  // luxo. Isso tambem evita que treino e pesquisa consumam a comida da era.
  let advancingNow = false;
  if (!startedBuilding && wantsAge && ageReady && afford(ageCost)) {
    game.enqueueCommand(botId, { kind: 'advanceAge' });
    advancingNow = true;
  }

  // Mantem a producao de aldeoes, exceto no exato tick em que compra uma era.
  if (!advancingNow && tc.progress >= 1 && villagers.length < diff.targetVillagers
    && pop < popCap && tc.queue.length < TRAIN_QUEUE_MAX && afford(UNIT_DEFS.villager.cost)) {
    game.enqueueCommand(botId, { kind: 'train', buildingId: tc.id, unit: 'villager' });
  }

  // No maximo duas fundacoes centrais simultaneas. Muralhas usam sua propria
  // cadencia (um segmento por vez) mais abaixo.
  if (!startedBuilding && !advancingNow && wip.filter((b) => b.type !== 'wall').length < MAX_CONCURRENT_CORE_BUILDS) {
    // Se falta predio para a era, constroi um tipo valido e guarda recursos para ele.
    const missingAgeType = wantsAge && !ageReady
      ? nextAgeRequirement(player.age, buildings)
      : null;
    const savingForRequiredBuilding = missingAgeType !== null && !afford(BUILDING_DEFS[missingAgeType].cost);
    if (missingAgeType && afford(BUILDING_DEFS[missingAgeType].cost)) {
      startedBuilding = issueBuild(ctx, missingAgeType, requestForType(ctx, missingAgeType), missingAgeType === 'barracks' ? 2 : 1);
    }

    // Nucleo economico: cada deposito vai perto do recurso que recebe.
    if (!startedBuilding && !savingForRequiredBuilding && villagers.length >= 7) {
      startedBuilding = ensureEconomicBuildings(ctx, player.age, afford);
    }

    // Edificios militares/civicos da era, reconstruidos se forem destruidos.
    if (!startedBuilding && !savingForRequiredBuilding && villagers.length >= 7) {
      startedBuilding = ensureCoreBuildings(ctx, player.age, profile, afford);
    }

    // Fazendas substituem a comida natural conforme a cidade cresce.
    if (!startedBuilding && !savingForRequiredBuilding) {
      startedBuilding = ensureFarms(ctx, player.age, afford);
    }

    // Torres ficam na periferia, priorizando o lado do inimigo.
    if (!startedBuilding && !savingForRequiredBuilding && player.age >= 2) {
      const desiredTowers = Math.min(profile.maxTowers, Math.max(1, player.age - 1));
      if (countType(buildings, 'watch_tower') < desiredTowers && afford(BUILDING_DEFS.watch_tower.cost)) {
        startedBuilding = issueBuild(ctx, 'watch_tower', {
          role: 'tower', minRadius: profile.wallRadius - 3, maxRadius: profile.wallRadius + 1,
        }, 1);
      }
    }
  }

  // Muralha gradual. Como ainda nao existe BuildingType "gate", as vias
  // reservadas atravessam o perimetro em aberturas de tres tiles.
  const wallWip = wip.some((b) => b.type === 'wall');
  if (!startedBuilding && !advancingNow && !wallWip && player.age >= profile.wallAge
    && coreReadyForWalls(buildings, player.age)
    && afford(BUILDING_DEFS.wall.cost, { stone: profile.stoneReserve })) {
    const wallSpot = nextWallSpot(ctx, profile.wallRadius);
    if (wallSpot) startedBuilding = issueExactBuild(ctx, 'wall', wallSpot, 1);
  }

  // Pesquisa apenas quando nenhuma obra/era importante consumiu recursos agora.
  if (!startedBuilding && !advancingNow && !preparingAge) {
    for (const b of buildings) {
      if (b.progress < 1 || b.research) continue;
      const tech = TECH_DEFS.find(
        (t) => t.building === b.type && !player.techs.has(t.id) && t.ageReq <= player.age
          && (!t.prereq || player.techs.has(t.prereq)) && afford(t.cost),
      );
      if (tech) {
        game.enqueueCommand(botId, { kind: 'research', buildingId: b.id, techId: tech.id });
        break;
      }
    }
  }

  // Composicao simples, mas cada personalidade tem um momento de ataque.
  if (!advancingNow && !preparingAge && pop < popCap) {
    const trainFrom: [BuildingType, UnitType][] = [
      ['barracks', 'swordsman'], ['archery_range', 'archer'], ['stable', 'knight'],
    ];
    for (const [buildingType, unitType] of trainFrom) {
      if ((UNIT_AGE_REQ[unitType] ?? 1) > player.age) continue;
      const producer = buildings.find(
        (b) => b.type === buildingType && b.progress >= 1 && b.queue.length < 2 && !b.research,
      );
      if (producer && afford(UNIT_DEFS[unitType].cost)) {
        game.enqueueCommand(botId, { kind: 'train', buildingId: producer.id, unit: unitType });
      }
    }
  }

  // Fácil (initiatesAttacks=false) nunca parte pro ataque — só revida (o motor
  // faz o auto-aggro dos soldados ociosos). Os outros níveis atacam ao juntar
  // o exército do nível.
  if (diff.initiatesAttacks && military.length >= diff.attackArmy) {
    const target = nearestEnemyBuilding(game, botId, base.x, base.y);
    const ready = military.filter((u) => u.state === 'idle');
    if (target && ready.length) {
      game.enqueueCommand(botId, { kind: 'attack', unitIds: ready.map((u) => u.id), targetId: target.id });
    }
  }
}

function profileFor(botId: number): BotProfile {
  return PROFILES[Math.abs(botId) % PROFILES.length];
}

function assignIdleVillagers(
  game: Game,
  botId: number,
  villagers: Unit[],
  buildings: Building[],
  nodes: ResNode[],
  age: number,
  resources: Record<ResourceType, number>,
  profile: BotProfile,
): void {
  const idle = villagers.filter((u) => u.state === 'idle' && u.carryAmount === 0);
  const farms = buildings.filter((b) => b.type === 'farm' && b.progress >= 1 && (b.foodLeft ?? 1) > 0);
  const assigned: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
  for (const villager of villagers) {
    if (villager.state !== 'idle' && villager.gatherResource) assigned[villager.gatherResource]++;
  }
  const weights: Record<ResourceType, number> = age <= 1
    ? { food: 0.48, wood: 0.36, gold: 0.11, stone: 0.05 }
    : age === 2
      ? { food: 0.46, wood: 0.32, gold: 0.17, stone: 0.05 }
      : { food: 0.42, wood: 0.25, gold: 0.26, stone: 0.07 };
  if (resources.food < 500) weights.food += 0.12;
  if (resources.wood < 250) weights.wood += 0.1;
  const needsWallStone = age >= profile.wallAge && resources.stone < profile.stoneReserve + 180;
  if (needsWallStone) weights.stone += 0.16;

  for (const villager of idle) {
    const wanted = (Object.keys(weights) as ResourceType[])
      .sort((a, b) => (weights[b] * villagers.length - assigned[b]) - (weights[a] * villagers.length - assigned[a]))[0];
    let targetId: number | null = null;
    if (wanted === 'food') {
      // Ovelha próxima (selvagem ou já do bot) = comida rápida do início; abater
      // também "rouba" a selvagem pro bot. Preferida sobre frutas/fazenda perto.
      const sheep = nearestSheep(game, villager.x, villager.y, 12, botId);
      if (sheep) targetId = sheep.id;
    }
    if (targetId === null && wanted === 'food' && farms.length > 0) {
      const berry = nearestNode(nodes, villager.x, villager.y, 'berry_bush');
      const farm = nearestBuilding(farms, villager.x, villager.y);
      if (farm && (!berry || distanceToNode(berry, villager.x, villager.y) > 12)) {
        targetId = farm.id;
      }
    }
    if (targetId === null) {
      const nodeType: NodeType = wanted === 'food' ? 'berry_bush' : wanted === 'wood' ? 'tree' : wanted === 'gold' ? 'gold_mine' : 'stone_mine';
      const target = nearestNode(nodes, villager.x, villager.y, nodeType) ?? nearestNode(nodes, villager.x, villager.y);
      targetId = target?.id ?? null;
    }
    if (targetId !== null) {
      game.enqueueCommand(botId, { kind: 'gather', unitIds: [villager.id], targetId });
      assigned[wanted]++;
    }
  }


  // Construir uma torre pode consumir toda a pedra inicial. Se nenhum aldeao
  // estiver mais na pedra, realoca ate dois trabalhadores e depois os deixa
  // seguir normalmente; sem isso a muralha jamais comecaria.
  const desiredStoneWorkers = needsWallStone ? (villagers.length >= 12 ? 2 : 1) : 0;
  const home = buildings.find((b) => b.type === 'town_center');
  const homeCenter = home ? buildingCenter(home) : { x: villagers[0]?.x ?? 0, y: villagers[0]?.y ?? 0 };
  const stoneTarget = desiredStoneWorkers > assigned.stone
    ? nearestNode(nodes, homeCenter.x, homeCenter.y, 'stone_mine')
    : null;
  if (stoneTarget) {
    const candidates = villagers
      .filter((u) => u.gatherResource !== 'stone' && u.state !== 'building' && u.state !== 'movingToBuild' && u.state !== 'movingToGarrison')
      .sort((a, b) => {
        const aSurplus = a.gatherResource ? assigned[a.gatherResource] - weights[a.gatherResource] * villagers.length : 10;
        const bSurplus = b.gatherResource ? assigned[b.gatherResource] - weights[b.gatherResource] * villagers.length : 10;
        return bSurplus - aSurplus;
      });
    for (const worker of candidates.slice(0, desiredStoneWorkers - assigned.stone)) {
      game.enqueueCommand(botId, { kind: 'gather', unitIds: [worker.id], targetId: stoneTarget.id });
      assigned.stone++;
    }
  }
}

/** Ovelha mais próxima que o bot pode comer (selvagem ou já dele) dentro do raio. */
function nearestSheep(game: Game, x: number, y: number, maxDist: number, botId: number): Sheep | null {
  let best: Sheep | null = null;
  let bestD = maxDist;
  for (const s of game.sheep.values()) {
    if (s.owner !== SHEEP_WILD_OWNER && s.owner !== botId) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function ensureEconomicBuildings(
  ctx: PlanContext,
  age: number,
  afford: (cost: Partial<Record<ResourceType, number>>) => boolean,
): boolean {
  const existing = ctx.buildings;
  const wants: { type: BuildingType; count: number; nodeTypes: NodeType[] }[] = [
    { type: 'mill', count: 1, nodeTypes: ['berry_bush'] },
    { type: 'lumber_camp', count: age >= 3 ? 2 : 1, nodeTypes: ['tree'] },
    { type: 'mining_camp', count: age >= 3 ? 2 : 1, nodeTypes: ['gold_mine', 'stone_mine'] },
  ];
  for (const want of wants) {
    if (countType(existing, want.type) >= want.count) continue;
    if (!canBuildType(ctx, want.type) || !afford(BUILDING_DEFS[want.type].cost)) continue;
    const targetNode = bestUnservedResource(ctx, want.nodeTypes, want.type);
    const target = targetNode ? { x: targetNode.tileX + 0.5, y: targetNode.tileY + 0.5 } : undefined;
    if (issueBuild(ctx, want.type, { role: 'resource', target, minRadius: 4, maxRadius: 30, clearance: 0 }, 1)) return true;
  }
  return false;
}

function ensureCoreBuildings(
  ctx: PlanContext,
  age: number,
  profile: BotProfile,
  afford: (cost: Partial<Record<ResourceType, number>>) => boolean,
): boolean {
  const desired: { type: BuildingType; count: number }[] = [
    { type: 'barracks', count: 1 + profile.extraBarracks },
    { type: 'blacksmith', count: 1 },
    { type: 'market', count: 1 },
    { type: 'archery_range', count: 1 },
    { type: 'stable', count: profile.name === 'aggressive' && age >= 4 ? 2 : 1 },
  ];
  for (const want of desired) {
    if (countType(ctx.buildings, want.type) >= want.count) continue;
    if (!canBuildType(ctx, want.type) || !afford(BUILDING_DEFS[want.type].cost)) continue;
    if (issueBuild(ctx, want.type, requestForType(ctx, want.type), want.type === 'barracks' ? 2 : 1)) return true;
  }
  return false;
}

function ensureFarms(
  ctx: PlanContext,
  age: number,
  afford: (cost: Partial<Record<ResourceType, number>>) => boolean,
): boolean {
  if (!canBuildType(ctx, 'farm')) return false;
  const localBerries = ctx.nodes
    .filter((n) => n.type === 'berry_bush' && Math.hypot(n.tileX + 0.5 - ctx.base.x, n.tileY + 0.5 - ctx.base.y) <= 18)
    .reduce((sum, n) => sum + n.amount, 0);
  const desired = localBerries > 500 && age <= 1
    ? 0
    : Math.min(6, Math.max(1, Math.ceil((ctx.villagers.length - 7) / 3)));
  if (countType(ctx.buildings, 'farm') >= desired || !afford(BUILDING_DEFS.farm.cost)) return false;
  const mill = ctx.buildings.find((b) => b.type === 'mill' && b.progress >= 1) ?? ctx.tc;
  return issueBuild(ctx, 'farm', {
    role: 'farm', target: buildingCenter(mill), minRadius: 4, maxRadius: 13, clearance: 0,
  }, 1);
}

function nextAgeRequirement(age: number, buildings: Building[]): BuildingType | null {
  const preferred: Record<number, BuildingType[]> = {
    1: ['barracks', 'mill', 'lumber_camp', 'mining_camp'],
    2: ['blacksmith', 'market', 'archery_range', 'watch_tower'],
    3: ['stable'],
  };
  const completed = new Set(
    buildings.filter((b) => b.progress >= 1 && countsForAgeUp(b.type, age)).map((b) => b.type),
  );
  const pending = new Set(
    buildings.filter((b) => b.progress < 1 && countsForAgeUp(b.type, age)).map((b) => b.type),
  );
  for (const type of preferred[age] ?? []) {
    if (completed.has(type) || pending.has(type)) continue;
    const req = BUILDING_DEFS[type].requires;
    if (req && !buildings.some((b) => b.type === req && b.progress >= 1)) continue;
    return type;
  }
  return null;
}

function requestForType(ctx: PlanContext, type: BuildingType): SpotRequest {
  if (type === 'house') return { role: 'house', minRadius: 6, maxRadius: 13 };
  if (type === 'barracks' || type === 'archery_range' || type === 'stable') {
    return { role: 'military', minRadius: 8, maxRadius: 15 };
  }
  if (type === 'watch_tower') return { role: 'tower', minRadius: 10, maxRadius: 16 };
  if (type === 'mill' || type === 'lumber_camp' || type === 'mining_camp') {
    const nodeTypes: NodeType[] = type === 'mill' ? ['berry_bush'] : type === 'lumber_camp' ? ['tree'] : ['gold_mine', 'stone_mine'];
    const node = bestUnservedResource(ctx, nodeTypes, type);
    return {
      role: 'resource',
      target: node ? { x: node.tileX + 0.5, y: node.tileY + 0.5 } : undefined,
      minRadius: 4, maxRadius: 30, clearance: 0,
    };
  }
  return { role: 'civic', minRadius: 7, maxRadius: 14 };
}

function canBuildType(ctx: PlanContext, type: BuildingType): boolean {
  const player = ctx.game.players.get(ctx.botId);
  if (!player || player.age < BUILDING_DEFS[type].ageReq) return false;
  const req = BUILDING_DEFS[type].requires;
  return !req || ctx.buildings.some((b) => b.type === req && b.progress >= 1);
}

function issueBuild(ctx: PlanContext, type: BuildingType, request: SpotRequest, builderCount: number): boolean {
  if (!canBuildType(ctx, type)) return false;
  const spot = findPlannedBuildSpot(ctx, type, request);
  return spot ? issueExactBuild(ctx, type, spot, builderCount) : false;
}

function issueExactBuild(ctx: PlanContext, type: BuildingType, spot: Pt, builderCount: number): boolean {
  const builders = chooseBuilders(ctx.villagers, spot, builderCount);
  if (builders.length === 0) return false;
  ctx.game.enqueueCommand(ctx.botId, {
    kind: 'build', unitIds: builders.map((u) => u.id), building: type, tileX: spot.x, tileY: spot.y,
  });
  return true;
}

function chooseBuilders(villagers: Unit[], spot: Pt, count: number): Unit[] {
  return villagers
    .filter((u) => u.state !== 'building' && u.state !== 'movingToBuild' && u.state !== 'movingToGarrison')
    .sort((a, b) => builderScore(a, spot) - builderScore(b, spot))
    .slice(0, count);
}

function builderScore(unit: Unit, spot: Pt): number {
  const busy = unit.state === 'idle' ? 0 : 20;
  return busy + Math.hypot(unit.x - spot.x, unit.y - spot.y);
}

function findPlannedBuildSpot(ctx: PlanContext, type: BuildingType, request: SpotRequest): Pt | null {
  const size = BUILDING_DEFS[type].size;
  const minRadius = request.minRadius ?? 5;
  const maxRadius = request.maxRadius ?? 16;
  const clearance = request.clearance ?? 1;
  const searchCenter = request.role === 'resource' && request.target ? request.target : ctx.base;
  const reach = request.role === 'resource' && request.target ? 7 : maxRadius + size;
  const x0 = Math.max(0, Math.floor(searchCenter.x - reach));
  const y0 = Math.max(0, Math.floor(searchCenter.y - reach));
  const x1 = Math.min(ctx.game.grid.size - size, Math.ceil(searchCenter.x + reach));
  const y1 = Math.min(ctx.game.grid.size - size, Math.ceil(searchCenter.y + reach));
  const candidates: { p: Pt; score: number }[] = [];

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const center = { x: tx + size / 2, y: ty + size / 2 };
      const radius = Math.hypot(center.x - ctx.base.x, center.y - ctx.base.y);
      if (radius < minRadius || radius > maxRadius) continue;
      if (!footprintFree(ctx.game.grid, tx, ty, size)) continue;
      if (overlapsUnit(ctx.units, tx, ty, size)) continue;
      if (overlapsTownApron(ctx.tc, tx, ty, size)) continue;
      if (footprintHitsRoad(ctx.base, tx, ty, size)) continue;
      if (!enoughClearance(ctx.game.grid, tx, ty, size, clearance)) continue;
      if (!hasOpenSides(ctx.game.grid, tx, ty, size, request.role === 'resource' || request.role === 'farm' ? 2 : 3)) continue;
      candidates.push({ p: { x: tx, y: ty }, score: placementScore(ctx, type, request, center, radius) });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates.slice(0, MAX_CONNECTIVITY_CHECKS)) {
    if (safeAfterPlacement(ctx, candidate.p.x, candidate.p.y, size)) return candidate.p;
  }
  return null;
}

function placementScore(ctx: PlanContext, type: BuildingType, request: SpotRequest, center: Pt, radius: number): number {
  const idealByRole: Record<BuildRole, number> = {
    house: 8.5, civic: 9, military: 12, resource: radius, farm: 7, tower: 12,
  };
  let score = Math.abs(radius - idealByRole[request.role]) * 2;
  const rel = { x: center.x - ctx.base.x, y: center.y - ctx.base.y };
  const forward = rel.x * ctx.enemyDir.x + rel.y * ctx.enemyDir.y;
  const side = Math.abs(rel.x * -ctx.enemyDir.y + rel.y * ctx.enemyDir.x);

  if (request.role === 'military') score -= forward * 1.25;
  else if (request.role === 'tower') score -= forward * 1.65;
  else if (request.role === 'house') score += forward * 0.45 - side * 0.08;
  else if (request.role === 'civic') score += Math.abs(forward) * 0.12;

  if (request.target) score += Math.hypot(center.x - request.target.x, center.y - request.target.y) * 4;

  const edgeDistance = Math.min(center.x, center.y, ctx.game.grid.size - center.x, ctx.game.grid.size - center.y);
  if (edgeDistance < 4) score += (4 - edgeDistance) * 12;

  for (const building of ctx.buildings) {
    const other = buildingCenter(building);
    const d = Math.hypot(center.x - other.x, center.y - other.y);
    if (building.type === type) score += Math.max(0, 5 - d) * 2.5;
    else score += Math.max(0, 3.5 - d) * 1.5;
  }
  score += stableNoise(center.x, center.y, ctx.botId) * 0.75;
  return score;
}

function safeAfterPlacement(ctx: PlanContext, tx: number, ty: number, size: number): boolean {
  if (!ctx.anchor) return true;
  // Calcula a alcancabilidade "antes" uma unica vez por tick (preguicoso).
  if (!ctx.reachableBefore) ctx.reachableBefore = flood(ctx.game.grid, ctx.anchor);
  const grid = ctx.game.grid;
  const blocked = grid.blocked;
  const gridSize = grid.size;

  // Carimba a pegada NO PROPRIO grid (sem clonar ~20k bytes por candidato) e
  // guarda os tiles alterados para desfaze-los logo apos o flood.
  const stamped: number[] = [];
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      const i = idx(x, y, gridSize);
      if (blocked[i] === 0) { blocked[i] = 1; stamped.push(i); }
    }
  }
  const after = flood(grid, ctx.anchor);
  for (const i of stamped) blocked[i] = 0; // desfaz o carimbo antes de qualquer retorno

  // Nenhuma unidade que hoje pertence a cidade pode virar prisioneira da obra.
  for (const unit of ctx.units) {
    const ux = Math.floor(unit.x);
    const uy = Math.floor(unit.y);
    if (ux < 0 || uy < 0 || ux >= gridSize || uy >= gridSize) continue;
    const i = idx(ux, uy, gridSize);
    if (ctx.reachableBefore[i] && !after[i]) return false;
  }

  // Todo tile livre de nascimento/trabalho ao redor do novo predio precisa
  // continuar ligado a cidade; isso evita unidades nascendo em bolsos fechados.
  for (const p of rectangleRing(tx - 1, ty - 1, tx + size, ty + size)) {
    if (!inside(grid, p.x, p.y)) continue;
    const i = idx(p.x, p.y, gridSize);
    if (!blocked[i] && !after[i]) return false;
  }
  return true;
}

function nextWallSpot(ctx: PlanContext, radius: number): Pt | null {
  const grid = ctx.game.grid;
  const x0 = Math.max(1, Math.floor(ctx.base.x - radius));
  const y0 = Math.max(1, Math.floor(ctx.base.y - radius));
  const x1 = Math.min(grid.size - 2, Math.ceil(ctx.base.x + radius));
  const y1 = Math.min(grid.size - 2, Math.ceil(ctx.base.y + radius));
  const existing = new Set(
    ctx.buildings.filter((b) => b.type === 'wall').map((b) => `${b.tileX}:${b.tileY}`),
  );
  const points = rectangleRing(x0, y0, x1, y1)
    .filter((p) => !isRoadTile(ctx.base, p.x, p.y))
    .filter((p) => !existing.has(`${p.x}:${p.y}`))
    .map((p) => {
      const rel = { x: p.x + 0.5 - ctx.base.x, y: p.y + 0.5 - ctx.base.y };
      const forward = rel.x * ctx.enemyDir.x + rel.y * ctx.enemyDir.y;
      return { p, score: -forward + stableNoise(p.x, p.y, ctx.botId) * 0.2 };
    })
    .sort((a, b) => a.score - b.score);

  // Limita as checagens caras de conectividade (cada uma faz um flood do mapa).
  // Os pontos ja vem ordenados pelo melhor lado; se os primeiros nao servem,
  // espera o proximo tick (a muralha e gradual de qualquer forma).
  let checks = 0;
  for (const { p } of points) {
    if (!footprintFree(grid, p.x, p.y, 1)) continue; // agua/arvore/predio vira obstaculo natural
    if (overlapsUnit(ctx.units, p.x, p.y, 1)) continue;
    if (!hasOpenSides(grid, p.x, p.y, 1, 2)) continue;
    if (safeAfterPlacement(ctx, p.x, p.y, 1)) return p;
    if (++checks >= MAX_WALL_CHECKS) break;
  }
  return null;
}

function coreReadyForWalls(buildings: Building[], age: number): boolean {
  const needed: BuildingType[] = ['barracks', 'mill'];
  if (age >= 2) needed.push('blacksmith');
  return needed.every((type) => buildings.some((b) => b.type === type && b.progress >= 1));
}

function bestUnservedResource(ctx: PlanContext, types: NodeType[], campType: BuildingType): ResNode | null {
  const camps = ctx.buildings.filter((b) => b.type === campType);
  let best: ResNode | null = null;
  let bestScore = Infinity;
  for (const node of ctx.nodes) {
    if (!types.includes(node.type)) continue;
    const dBase = Math.hypot(node.tileX + 0.5 - ctx.base.x, node.tileY + 0.5 - ctx.base.y);
    if (dBase > 34) continue;
    const served = camps.some((camp) => {
      const c = buildingCenter(camp);
      return Math.hypot(node.tileX + 0.5 - c.x, node.tileY + 0.5 - c.y) <= 7;
    });
    if (served) continue;
    let neighbors = 0;
    for (const other of ctx.nodes) {
      if (!types.includes(other.type)) continue;
      if (Math.hypot(other.tileX - node.tileX, other.tileY - node.tileY) <= 4.5) neighbors++;
    }
    const score = dBase * 1.55 - neighbors * 1.9;
    if (score < bestScore) { best = node; bestScore = score; }
  }
  return best;
}

function nearestNode(nodes: ResNode[], x: number, y: number, type?: NodeType): ResNode | null {
  let best: ResNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (type && node.type !== type) continue;
    const d = distanceToNode(node, x, y);
    if (d < bestDistance) { best = node; bestDistance = d; }
  }
  return best;
}

function nearestBuilding(buildings: Building[], x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestDistance = Infinity;
  for (const building of buildings) {
    const c = buildingCenter(building);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDistance) { best = building; bestDistance = d; }
  }
  return best;
}

function nearestEnemyBuilding(game: Game, botId: number, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestDistance = Infinity;
  for (const building of game.buildings.values()) {
    if (building.owner === botId || game.players.get(building.owner)?.defeated) continue;
    const c = buildingCenter(building);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDistance) { best = building; bestDistance = d; }
  }
  return best;
}

function countType(buildings: Building[], type: BuildingType): number {
  return buildings.filter((b) => b.type === type).length;
}

function buildingCenter(building: Building): Pt {
  const size = BUILDING_DEFS[building.type].size;
  return { x: building.tileX + size / 2, y: building.tileY + size / 2 };
}

function distanceToNode(node: ResNode, x: number, y: number): number {
  return Math.hypot(node.tileX + 0.5 - x, node.tileY + 0.5 - y);
}

function normalized(x: number, y: number): Pt {
  const length = Math.hypot(x, y);
  return length > 0.001 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

function stableNoise(x: number, y: number, seed: number): number {
  let h = (Math.imul(Math.floor(x), 374761393) + Math.imul(Math.floor(y), 668265263) + Math.imul(seed, 69069)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function footprintFree(grid: Grid, tx: number, ty: number, size: number): boolean {
  if (tx < 0 || ty < 0 || tx + size > grid.size || ty + size > grid.size) return false;
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      const i = idx(x, y, grid.size);
      if (grid.tiles[i] !== TILE_GRASS || grid.blocked[i] !== 0) return false;
    }
  }
  return true;
}

function overlapsUnit(units: Unit[], tx: number, ty: number, size: number): boolean {
  return units.some((u) => {
    const x = Math.floor(u.x);
    const y = Math.floor(u.y);
    return x >= tx && x < tx + size && y >= ty && y < ty + size;
  });
}

function overlapsTownApron(tc: Building, tx: number, ty: number, size: number): boolean {
  const tcSize = BUILDING_DEFS.town_center.size;
  return rectanglesOverlap(
    tx, ty, size, size,
    tc.tileX - BASE_APRON, tc.tileY - BASE_APRON, tcSize + BASE_APRON * 2, tcSize + BASE_APRON * 2,
  );
}

function rectanglesOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function footprintHitsRoad(base: Pt, tx: number, ty: number, size: number): boolean {
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) if (isRoadTile(base, x, y)) return true;
  }
  return false;
}

function isRoadTile(base: Pt, x: number, y: number): boolean {
  const px = x + 0.5;
  const py = y + 0.5;
  const dx = Math.abs(px - base.x);
  const dy = Math.abs(py - base.y);
  if (Math.max(dx, dy) > ROAD_RADIUS) return false;
  return dx <= 1.05 || dy <= 1.05; // vias de tres tiles: passagem folgada para grupos
}

function enoughClearance(grid: Grid, tx: number, ty: number, size: number, clearance: number): boolean {
  if (clearance <= 0) return true;
  const ring = rectangleRing(tx - clearance, ty - clearance, tx + size - 1 + clearance, ty + size - 1 + clearance);
  let valid = 0;
  let open = 0;
  for (const p of ring) {
    if (!inside(grid, p.x, p.y)) continue;
    valid++;
    if (!grid.blocked[idx(p.x, p.y, grid.size)] && grid.tiles[idx(p.x, p.y, grid.size)] === TILE_GRASS) open++;
  }
  return valid > 0 && open / valid >= 0.72;
}

function hasOpenSides(grid: Grid, tx: number, ty: number, size: number, minimum: number): boolean {
  const sides = [
    range(tx, tx + size - 1).some((x) => walkable(grid, x, ty - 1)),
    range(tx, tx + size - 1).some((x) => walkable(grid, x, ty + size)),
    range(ty, ty + size - 1).some((y) => walkable(grid, tx - 1, y)),
    range(ty, ty + size - 1).some((y) => walkable(grid, tx + size, y)),
  ];
  return sides.filter(Boolean).length >= minimum;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

function walkable(grid: Grid, x: number, y: number): boolean {
  return inside(grid, x, y) && !grid.blocked[idx(x, y, grid.size)];
}

function inside(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.size && y < grid.size;
}

function findBaseAnchor(grid: Grid, tc: Building): Pt | null {
  const size = BUILDING_DEFS.town_center.size;
  for (const p of rectangleRing(tc.tileX - 1, tc.tileY - 1, tc.tileX + size, tc.tileY + size)) {
    if (walkable(grid, p.x, p.y)) return p;
  }
  return null;
}

function rectangleRing(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const out: Pt[] = [];
  for (let x = x0; x <= x1; x++) {
    out.push({ x, y: y0 });
    if (y1 !== y0) out.push({ x, y: y1 });
  }
  for (let y = y0 + 1; y < y1; y++) {
    out.push({ x: x0, y });
    if (x1 !== x0) out.push({ x: x1, y });
  }
  return out;
}

function flood(grid: Grid, start: Pt): Uint8Array {
  const visited = new Uint8Array(grid.size * grid.size);
  if (!walkable(grid, start.x, start.y)) return visited;
  const queue: number[] = [idx(start.x, start.y, grid.size)];
  visited[queue[0]] = 1;
  let head = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (head < queue.length) {
    const cur = queue[head++];
    const x = cur % grid.size;
    const y = (cur - x) / grid.size;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(grid, nx, ny)) continue;
      const ni = idx(nx, ny, grid.size);
      if (visited[ni]) continue;
      visited[ni] = 1;
      queue.push(ni);
    }
  }
  return visited;
}
