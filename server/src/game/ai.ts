// IA de oponente (bot): coleta recursos, cresce a economia, ergue um quartel,
// treina militares e ataca. Roda como um "jogador" — apenas enfileira comandos
// (GameCommand) que passam pela MESMA validação dos comandos humanos.
// É intencionalmente simples e sem estado: reavalia tudo a partir do estado atual.

import { AGE_COSTS, BUILDING_DEFS, buildingsToAdvance, countsForAgeUp, MAX_AGE, POP_CAP_MAX, TECH_DEFS, TILE_GRASS, TRAIN_QUEUE_MAX, UNIT_AGE_REQ, UNIT_DEFS } from '@age/shared';
import type { BuildingType, NodeType, ResourceType, UnitType } from '@age/shared';
import { idx, type Grid } from './path';
import type { Game } from './room';
import type { Building, ResNode, Unit } from './state';

const TARGET_VILLAGERS = 16;
const ATTACK_ARMY = 6;

export function runBotAI(game: Game, botId: number): void {
  const p = game.players.get(botId);
  if (!p || p.defeated) return;

  const myUnits: Unit[] = [];
  for (const u of game.units.values()) if (u.owner === botId) myUnits.push(u);
  const myBuildings: Building[] = [];
  for (const b of game.buildings.values()) if (b.owner === botId) myBuildings.push(b);

  const tc = myBuildings.find((b) => b.type === 'town_center');
  if (!tc) return; // sem Centro da Cidade não há o que gerir

  const villagers = myUnits.filter((u) => u.type === 'villager');
  const military = myUnits.filter((u) => u.type !== 'villager');
  const res = p.resources;
  const afford = (cost: Partial<Record<ResourceType, number>>): boolean => {
    for (const [k, v] of Object.entries(cost) as [ResourceType, number][]) {
      if ((res[k] ?? 0) < (v ?? 0)) return false;
    }
    return true;
  };

  let pop = 0;
  for (const u of myUnits) pop += UNIT_DEFS[u.type]?.pop ?? 1;
  let popCap = 0;
  for (const b of myBuildings) if ((b.progress ?? 1) >= 1) popCap += BUILDING_DEFS[b.type].popProvided;
  popCap = Math.min(POP_CAP_MAX, popCap);

  const nodes = [...game.nodes.values()];

  // 1) aldeões ociosos -> coletar (mistura de recursos)
  const idle = villagers.filter((u) => u.state === 'idle' && u.carryAmount === 0);
  const order: NodeType[] = ['berry_bush', 'tree', 'gold_mine', 'tree', 'berry_bush', 'stone_mine'];
  let oi = 0;
  for (const v of idle) {
    const want = order[oi % order.length];
    oi++;
    const target = nearestNode(nodes, v.x, v.y, want) ?? nearestNode(nodes, v.x, v.y);
    if (target) game.enqueueCommand(botId, { kind: 'gather', unitIds: [v.id], targetId: target.id });
  }

  // 2) treinar aldeão no Centro da Cidade
  if ((tc.progress ?? 1) >= 1 && villagers.length < TARGET_VILLAGERS && pop < popCap
    && tc.queue.length < TRAIN_QUEUE_MAX && afford(UNIT_DEFS.villager.cost)) {
    game.enqueueCommand(botId, { kind: 'train', buildingId: tc.id, unit: 'villager' });
  }

  // 3) casa quando perto do limite de população
  const houseWip = myBuildings.some((b) => b.type === 'house' && (b.progress ?? 1) < 1);
  if (pop >= popCap - 1 && popCap < POP_CAP_MAX && !houseWip && afford(BUILDING_DEFS.house.cost)) {
    const spot = findBuildSpot(game.grid, tc, 2);
    const builder = villagers.find((u) => u.state === 'idle') ?? villagers[0];
    if (spot && builder) {
      game.enqueueCommand(botId, { kind: 'build', unitIds: [builder.id], building: 'house', tileX: spot.x, tileY: spot.y });
    }
  }

  // 4) quartel (uma vez) quando já há economia
  const hasBarracks = myBuildings.some((b) => b.type === 'barracks');
  if (!hasBarracks && villagers.length >= 7 && afford(BUILDING_DEFS.barracks.cost)) {
    const spot = findBuildSpot(game.grid, tc, 3);
    const builders = villagers.filter((u) => u.state === 'idle').slice(0, 2);
    const ids = (builders.length ? builders : villagers.slice(0, 1)).map((u) => u.id);
    if (spot && ids.length) {
      game.enqueueCommand(botId, { kind: 'build', unitIds: ids, building: 'barracks', tileX: spot.x, tileY: spot.y });
    }
  }

  // 4.5) avançar de era quando a economia sustenta (prioriza antes de exército grande)
  if (!p.ageResearch && p.age < MAX_AGE && villagers.length >= 6 + (p.age - 1) * 3) {
    const cost = AGE_COSTS[p.age + 1] ?? {};
    // regra do AoE2: N prédios DIFERENTES da era atual (casa/fazenda/muralha não contam)
    const have = new Set<BuildingType>();
    for (const b of myBuildings) if ((b.progress ?? 1) >= 1 && countsForAgeUp(b.type, p.age)) have.add(b.type);
    if (have.size >= buildingsToAdvance(p.age) && afford(cost)) game.enqueueCommand(botId, { kind: 'advanceAge' });
  }

  // 4.6) prédios militares/upgrade liberados pela era (um de cada)
  const buildOnce = (type: BuildingType, size: number): void => {
    if (myBuildings.some((b) => b.type === type)) return;
    if (p.age < BUILDING_DEFS[type].ageReq) return;
    // pré-requisito de prédio (árvore do AoE2): espera o requisito ficar pronto
    const req = BUILDING_DEFS[type].requires;
    if (req && !myBuildings.some((b) => b.type === req && (b.progress ?? 1) >= 1)) return;
    if (!afford(BUILDING_DEFS[type].cost)) return;
    const spot = findBuildSpot(game.grid, tc, size);
    const builder = villagers.find((u) => u.state === 'idle') ?? villagers[0];
    if (spot && builder) {
      game.enqueueCommand(botId, { kind: 'build', unitIds: [builder.id], building: type, tileX: spot.x, tileY: spot.y });
    }
  };
  if (villagers.length >= 8) {
    buildOnce('mill', 2);          // 2º prédio das Trevas (com o Quartel) → libera avançar de era
    buildOnce('blacksmith', 2);
    buildOnce('market', 2);
    buildOnce('archery_range', 3);
    buildOnce('stable', 3);
  }

  // 4.7) pesquisar um upgrade disponível (nos prédios concluídos e ociosos)
  for (const b of myBuildings) {
    if ((b.progress ?? 1) < 1 || b.research) continue;
    const tech = TECH_DEFS.find(
      (t) => t.building === b.type && !p.techs.has(t.id) && t.ageReq <= p.age
        && (!t.prereq || p.techs.has(t.prereq)) && afford(t.cost),
    );
    if (tech) { game.enqueueCommand(botId, { kind: 'research', buildingId: b.id, techId: tech.id }); break; }
  }

  // 5) treinar militares nos prédios (cada unidade no seu prédio, conforme a era)
  const trainFrom: [BuildingType, UnitType][] = [
    ['barracks', 'swordsman'], ['archery_range', 'archer'], ['stable', 'knight'],
  ];
  if (pop < popCap) {
    for (const [btype, unit] of trainFrom) {
      if ((UNIT_AGE_REQ[unit] ?? 1) > p.age) continue;
      const bld = myBuildings.find((b) => b.type === btype && (b.progress ?? 1) >= 1 && b.queue.length < 2);
      if (bld && afford(UNIT_DEFS[unit].cost)) {
        game.enqueueCommand(botId, { kind: 'train', buildingId: bld.id, unit });
      }
    }
  }

  // 6) atacar quando o exército for grande o bastante
  if (military.length >= ATTACK_ARMY) {
    const target = nearestEnemyBuilding(game, botId, tc.tileX, tc.tileY);
    const ready = military.filter((u) => u.state === 'idle');
    if (target && ready.length) {
      game.enqueueCommand(botId, { kind: 'attack', unitIds: ready.map((u) => u.id), targetId: target.id });
    }
  }
}

function nearestNode(nodes: ResNode[], x: number, y: number, type?: NodeType): ResNode | null {
  let best: ResNode | null = null;
  let bd = Infinity;
  for (const n of nodes) {
    if (type && n.type !== type) continue;
    const dx = n.tileX + 0.5 - x;
    const dy = n.tileY + 0.5 - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function nearestEnemyBuilding(game: Game, botId: number, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of game.buildings.values()) {
    if (b.owner === botId) continue;
    if (game.players.get(b.owner)?.defeated) continue;
    const dx = b.tileX - x;
    const dy = b.tileY - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Primeiro footprint size×size livre (grama, desbloqueado) em anéis ao redor do CC. */
function findBuildSpot(g: Grid, tc: Building, size: number): { x: number; y: number } | null {
  const cx = tc.tileX + 1;
  const cy = tc.tileY + 1;
  for (let r = 3; r <= 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // apenas o anel
        const tx = cx + dx;
        const ty = cy + dy;
        if (footprintFree(g, tx, ty, size)) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

function footprintFree(g: Grid, tx: number, ty: number, size: number): boolean {
  if (tx < 0 || ty < 0 || tx + size > g.size || ty + size > g.size) return false;
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      const i = idx(x, y, g.size);
      if (g.tiles[i] !== TILE_GRASS || g.blocked[i] !== 0) return false;
    }
  }
  return true;
}
