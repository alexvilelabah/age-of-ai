// Geração de mapa: terreno, spawns nos cantos e clusters de recursos.
// PRNG com seed (mulberry32) para reprodutibilidade — o seed é logado.

import {
  BUILDING_DEFS,
  MAP_SIZE,
  NODE_DEFS,
  START_VILLAGERS,
  TILE_GRASS,
  TILE_WATER,
} from '@age/shared';
import type { NodeType } from '@age/shared';
import { idx, inBounds, nearestWalkableTile, type Grid } from './path';
import type { Building, ResNode, Unit } from './state';
import { createUnit } from './state';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GenResult {
  grid: Grid;
  units: Unit[];
  buildings: Building[];
  nodes: ResNode[];
  nextId: number;
  seed: number;
}

const CORNER_INSET = 9;

function cornerFor(size: number, i: number): { x: number; y: number } {
  // 0: topo-esq, 1: topo-dir, 2: baixo-dir, 3: baixo-esq
  const lo = CORNER_INSET;
  const hi = size - 1 - CORNER_INSET;
  switch (i % 4) {
    case 0:
      return { x: lo, y: lo };
    case 1:
      return { x: hi, y: lo };
    case 2:
      return { x: hi, y: hi };
    default:
      return { x: lo, y: hi };
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function generateMap(playerCount: number, forcedSeed?: number): GenResult {
  const maxAttempts = 20;
  let seed = forcedSeed ?? Math.floor(Math.random() * 0xffffffff);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = tryGenerate(playerCount, seed);
    if (result) {
      console.log(`[mapgen] seed=${seed} attempt=${attempt + 1} OK`);
      return result;
    }
    console.log(`[mapgen] seed=${seed} attempt=${attempt + 1} falhou reachability, tentando novo seed`);
    seed = (seed * 2654435761 + attempt + 1) >>> 0;
  }
  // Última tentativa: gera mesmo assim e depois carve caminhos retos entre spawns.
  console.log(`[mapgen] esgotadas ${maxAttempts} tentativas — forçando geração com carve de caminhos`);
  const forced = tryGenerate(playerCount, seed, true);
  if (!forced) throw new Error('mapgen: falha irrecuperável');
  return forced;
}

function tryGenerate(playerCount: number, seed: number, forceCarve = false): GenResult | null {
  const size = MAP_SIZE;
  const rng = mulberry32(seed);
  const tiles = new Array<number>(size * size).fill(TILE_GRASS);
  const blocked = new Uint8Array(size * size);

  const spawns: { x: number; y: number }[] = [];
  for (let i = 0; i < playerCount; i++) spawns.push(cornerFor(size, i));

  // --- Lagos (evitar perto de spawns) ---
  const lakeCount = 2 + Math.floor(rng() * 2); // 2..3
  for (let l = 0; l < lakeCount; l++) {
    let cx = 0;
    let cy = 0;
    let ok = false;
    for (let tries = 0; tries < 50 && !ok; tries++) {
      cx = Math.floor(rng() * size);
      cy = Math.floor(rng() * size);
      ok = spawns.every((s) => dist(cx, cy, s.x, s.y) > 12);
    }
    if (!ok) continue;
    const lakeSize = 10 + Math.floor(rng() * 16); // 10..25
    blobify(tiles, size, cx, cy, lakeSize, TILE_WATER, rng);
  }

  const nextIdBox = { v: 1 };
  const units: Unit[] = [];
  const buildings: Building[] = [];
  const nodes: ResNode[] = [];

  const markBlocked = (x: number, y: number): void => {
    if (inBounds({ size, tiles, blocked } as Grid, x, y)) blocked[idx(x, y, size)] = 1;
  };

  const placeNode = (type: NodeType, x: number, y: number): boolean => {
    if (!inBounds({ size, tiles, blocked } as Grid, x, y)) return false;
    const i = idx(x, y, size);
    if (tiles[i] !== TILE_GRASS || blocked[i]) return false;
    const id = nextIdBox.v++;
    nodes.push({ id, type, tileX: x, tileY: y, amount: NODE_DEFS[type].amount });
    blocked[i] = 1;
    return true;
  };

  // --- Spawns: TC + villagers + clusters próximos ---
  for (let p = 0; p < playerCount; p++) {
    const s = spawns[p];
    const tcDef = BUILDING_DEFS.town_center;
    const half = Math.floor(tcDef.size / 2);
    const tcX = s.x - half;
    const tcY = s.y - half;

    // Garante grama sob o TC e ao redor (anel livre).
    for (let yy = tcY - 2; yy <= tcY + tcDef.size + 1; yy++) {
      for (let xx = tcX - 2; xx <= tcX + tcDef.size + 1; xx++) {
        if (!inBounds({ size, tiles, blocked } as Grid, xx, yy)) continue;
        tiles[idx(xx, yy, size)] = TILE_GRASS;
      }
    }

    const tcId = nextIdBox.v++;
    buildings.push({
      id: tcId,
      owner: p,
      type: 'town_center',
      tileX: tcX,
      tileY: tcY,
      hp: tcDef.hp,
      progress: 1,
      queue: [],
    });
    for (let yy = tcY; yy < tcY + tcDef.size; yy++) {
      for (let xx = tcX; xx < tcX + tcDef.size; xx++) markBlocked(xx, yy);
    }

    // Villagers adjacentes ao TC.
    const adjSpots = ringSpots(tcX, tcY, tcDef.size, size);
    for (let v = 0; v < START_VILLAGERS; v++) {
      const spot = adjSpots[v % adjSpots.length];
      const uid = nextIdBox.v++;
      const u = createUnit(uid, p, 'villager', spot.x + 0.5, spot.y + 0.5);
      units.push(u);
    }

    // Clusters de recursos a 5-9 tiles do spawn, em direções variadas.
    const clusterSpecs: { type: NodeType; count: number }[] = [
      { type: 'berry_bush', count: 6 },
      { type: 'tree', count: 14 },
      { type: 'gold_mine', count: 4 },
      { type: 'stone_mine', count: 4 },
    ];
    const angleBase = rng() * Math.PI * 2;
    clusterSpecs.forEach((spec, ci) => {
      const angle = angleBase + (ci * Math.PI * 2) / clusterSpecs.length + (rng() - 0.5) * 0.5;
      const dist2 = 5 + rng() * 4; // 5..9
      const centerX = Math.round(s.x + Math.cos(angle) * dist2);
      const centerY = Math.round(s.y + Math.sin(angle) * dist2);
      placeClusterNodes(spec.type, spec.count, centerX, centerY, size, rng, placeNode);
    });
  }

  // --- Recursos espalhados pelo resto do mapa ---
  const forestClusters = 22; // ~2x florestas espalhadas (mais madeira pelo mapa)
  for (let i = 0; i < forestClusters; i++) {
    const c = randomFarPoint(rng, size, spawns, 10);
    placeClusterNodes('tree', 8 + Math.floor(rng() * 7), c.x, c.y, size, rng, placeNode); // 8..14
  }
  const goldClusters = 4 + Math.floor(rng() * 2); // 4..5
  for (let i = 0; i < goldClusters; i++) {
    const c = randomFarPoint(rng, size, spawns, 10);
    placeClusterNodes('gold_mine', 3, c.x, c.y, size, rng, placeNode);
  }
  const stoneClusters = 4 + Math.floor(rng() * 2); // 4..5
  for (let i = 0; i < stoneClusters; i++) {
    const c = randomFarPoint(rng, size, spawns, 10);
    placeClusterNodes('stone_mine', 3, c.x, c.y, size, rng, placeNode);
  }

  const grid: Grid = { size, tiles, blocked };

  // --- Verificação de conectividade entre TCs ---
  // O centro do TC está dentro do próprio footprint (bloqueado); usamos o tile
  // caminhável mais próximo (ponto de entrada real para unidades) no teste.
  const tcCenters = buildings
    .filter((b) => b.type === 'town_center')
    .map((b) => nearestWalkableTile(grid, b.tileX + 1, b.tileY + 1) ?? { x: b.tileX + 1, y: b.tileY + 1 });

  if (!forceCarve) {
    if (!allMutuallyReachable(grid, tcCenters)) return null;
  } else {
    carveStraightPaths(grid, tcCenters);
  }

  return { grid, units, buildings, nodes, nextId: nextIdBox.v, seed };
}

function ringSpots(tcX: number, tcY: number, size: number, mapSize: number): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (let x = tcX - 1; x <= tcX + size; x++) {
    spots.push({ x, y: tcY - 1 });
    spots.push({ x, y: tcY + size });
  }
  for (let y = tcY; y < tcY + size; y++) {
    spots.push({ x: tcX - 1, y });
    spots.push({ x: tcX + size, y });
  }
  return spots.filter((p) => p.x >= 0 && p.y >= 0 && p.x < mapSize && p.y < mapSize);
}

function blobify(
  tiles: number[],
  size: number,
  cx: number,
  cy: number,
  count: number,
  value: number,
  rng: () => number,
): void {
  const visited = new Set<number>();
  const frontier: { x: number; y: number }[] = [{ x: cx, y: cy }];
  let placed = 0;
  while (frontier.length > 0 && placed < count) {
    const pickIdx = Math.floor(rng() * frontier.length);
    const t = frontier.splice(pickIdx, 1)[0];
    if (t.x < 0 || t.y < 0 || t.x >= size || t.y >= size) continue;
    const i = t.y * size + t.x;
    if (visited.has(i)) continue;
    visited.add(i);
    tiles[i] = value;
    placed++;
    const neighbors = [
      { x: t.x + 1, y: t.y },
      { x: t.x - 1, y: t.y },
      { x: t.x, y: t.y + 1 },
      { x: t.x, y: t.y - 1 },
    ];
    for (const n of neighbors) {
      if (rng() < 0.7) frontier.push(n);
    }
  }
}

function placeClusterNodes(
  type: NodeType,
  count: number,
  centerX: number,
  centerY: number,
  size: number,
  rng: () => number,
  place: (type: NodeType, x: number, y: number) => boolean,
): void {
  let placed = 0;
  let ring = 0;
  let guard = 0;
  while (placed < count && guard < 400) {
    guard++;
    const angle = rng() * Math.PI * 2;
    const r = ring * 0.8 + rng() * 1.5;
    const x = Math.round(centerX + Math.cos(angle) * r);
    const y = Math.round(centerY + Math.sin(angle) * r);
    if (x < 0 || y < 0 || x >= size || y >= size) {
      ring += 0.2;
      continue;
    }
    if (place(type, x, y)) {
      placed++;
    }
    if (guard % 8 === 0) ring += 0.5;
  }
}

function randomFarPoint(
  rng: () => number,
  size: number,
  spawns: { x: number; y: number }[],
  minDist: number,
): { x: number; y: number } {
  for (let tries = 0; tries < 100; tries++) {
    const x = Math.floor(4 + rng() * (size - 8));
    const y = Math.floor(4 + rng() * (size - 8));
    if (spawns.every((s) => dist(x, y, s.x, s.y) > minDist)) return { x, y };
  }
  return { x: Math.floor(size / 2), y: Math.floor(size / 2) };
}

function allMutuallyReachable(grid: Grid, points: { x: number; y: number }[]): boolean {
  if (points.length < 2) return true;
  const size = grid.size;
  const visited = new Uint8Array(size * size);
  const start = points[0];
  const startI = idx(
    Math.max(0, Math.min(size - 1, start.x)),
    Math.max(0, Math.min(size - 1, start.y)),
    size,
  );
  if (grid.blocked[startI]) return false;
  const queue: number[] = [startI];
  visited[startI] = 1;
  let head = 0;
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % size;
    const cy = (cur - cx) / size;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (visited[ni] || grid.blocked[ni]) continue;
      if (dx !== 0 && dy !== 0) {
        if (grid.blocked[cy * size + nx] || grid.blocked[ny * size + cx]) continue;
      }
      visited[ni] = 1;
      queue.push(ni);
    }
  }
  return points.every((p) => {
    const px = Math.max(0, Math.min(size - 1, p.x));
    const py = Math.max(0, Math.min(size - 1, p.y));
    return visited[idx(px, py, size)] === 1;
  });
}

// Fallback final: abre um corredor reto (linha) de grama livre entre cada par
// consecutivo de spawns, garantindo conectividade mesmo em mapas hostis.
function carveStraightPaths(grid: Grid, points: { x: number; y: number }[]): void {
  const size = grid.size;
  for (let i = 1; i < points.length; i++) {
    carveLine(grid, points[i - 1], points[i]);
  }
  // Fecha o ciclo para robustez extra.
  if (points.length > 2) carveLine(grid, points[points.length - 1], points[0]);

  function carveLine(g: Grid, a: { x: number; y: number }, b: { x: number; y: number }): void {
    let x = a.x;
    let y = a.y;
    const dx = Math.sign(b.x - x);
    const dy = Math.sign(b.y - y);
    let guard = 0;
    while ((x !== b.x || y !== b.y) && guard < size * 4) {
      guard++;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = idx(nx, ny, size);
          g.tiles[ni] = TILE_GRASS;
          g.blocked[ni] = 0;
        }
      }
      if (x !== b.x) x += dx;
      if (y !== b.y) y += dy;
    }
  }
}
