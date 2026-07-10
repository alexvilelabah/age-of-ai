// Grade de tiles + A* 8-direcional (sem cortar quinas) e utilitários de busca.

export interface Grid {
  size: number;
  tiles: number[]; // TILE_GRASS | TILE_WATER, row-major
  blocked: Uint8Array; // 1 = intransponível (água, prédio ou nó de recurso)
}

export interface Pt {
  x: number;
  y: number;
}

export const idx = (x: number, y: number, size: number): number => y * size + x;

export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.size && y < g.size;
}

export function isWalkable(g: Grid, x: number, y: number): boolean {
  return inBounds(g, x, y) && g.blocked[idx(x, y, g.size)] === 0;
}

// Borda (inclusive) do retângulo x0..x1 / y0..y1 — usada para anéis ao redor de prédios.
export function ringTiles(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const out: Pt[] = [];
  for (let x = x0; x <= x1; x++) {
    out.push({ x, y: y0 });
    if (y1 !== y0) out.push({ x, y: y1 });
  }
  for (let y = y0 + 1; y <= y1 - 1; y++) {
    out.push({ x: x0, y });
    if (x1 !== x0) out.push({ x: x1, y });
  }
  return out;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// A* do tile (sx,sy) até QUALQUER tile do conjunto `goals` (índices row-major).
// Retorna a lista de tiles do caminho (sem incluir o inicial) ou null.
// O tile inicial pode estar bloqueado (unidade sob um prédio recém-colocado).
export function findPath(g: Grid, sx: number, sy: number, goals: ReadonlySet<number>): Pt[] | null {
  const size = g.size;
  if (goals.size === 0 || !inBounds(g, sx, sy)) return null;
  const start = idx(sx, sy, size);
  if (goals.has(start)) return [];

  const goalPts: Pt[] = [];
  goals.forEach((i) => goalPts.push({ x: i % size, y: Math.floor(i / size) }));
  const heur = (x: number, y: number): number => {
    let best = Infinity;
    for (const p of goalPts) {
      const dx = Math.abs(x - p.x);
      const dy = Math.abs(y - p.y);
      const d = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
      if (d < best) best = d;
    }
    return best;
  };

  const gScore = new Float64Array(size * size).fill(Infinity);
  const cameFrom = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);

  // heap binário (min-heap por f)
  const hIdx: number[] = [];
  const hF: number[] = [];
  const push = (i: number, f: number): void => {
    hIdx.push(i);
    hF.push(f);
    let c = hIdx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hF[p] <= hF[c]) break;
      [hF[p], hF[c]] = [hF[c], hF[p]];
      [hIdx[p], hIdx[c]] = [hIdx[c], hIdx[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = hIdx[0];
    const li = hIdx.pop() as number;
    const lf = hF.pop() as number;
    if (hIdx.length > 0) {
      hIdx[0] = li;
      hF[0] = lf;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < hF.length && hF[l] < hF[m]) m = l;
        if (r < hF.length && hF[r] < hF[m]) m = r;
        if (m === p) break;
        [hF[p], hF[m]] = [hF[m], hF[p]];
        [hIdx[p], hIdx[m]] = [hIdx[m], hIdx[p]];
        p = m;
      }
    }
    return top;
  };

  gScore[start] = 0;
  push(start, heur(sx, sy));
  let found = -1;

  while (hIdx.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (goals.has(cur)) {
      found = cur;
      break;
    }
    const cx = cur % size;
    const cy = (cur - cx) / size;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (g.blocked[ni]) continue;
      if (dx !== 0 && dy !== 0) {
        // diagonal só se os dois ortogonais estiverem livres (sem cortar quinas)
        if (g.blocked[cy * size + nx] || g.blocked[ny * size + cx]) continue;
      }
      const cost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const ng = gScore[cur] + cost;
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        cameFrom[ni] = cur;
        push(ni, ng + heur(nx, ny));
      }
    }
  }

  if (found < 0) return null;
  const path: Pt[] = [];
  let cur = found;
  while (cur !== start) {
    path.push({ x: cur % size, y: Math.floor(cur / size) });
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}

// Garante um inteiro finito dentro de [0, size-1]; entradas não finitas (NaN/Infinity)
// caem em 0 em vez de produzir NaN, que quebraria o clamp e o BFS abaixo.
function clampTile(v: number, size: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(size - 1, Math.round(v)));
}

// BFS a partir de (tx,ty) atravessando tudo, até achar o tile caminhável mais próximo.
export function nearestWalkableTile(g: Grid, tx: number, ty: number): Pt | null {
  const size = g.size;
  const cx = clampTile(tx, size);
  const cy = clampTile(ty, size);
  const visited = new Uint8Array(size * size);
  const queue: Pt[] = [{ x: cx, y: cy }];
  visited[idx(cx, cy, size)] = 1;
  let head = 0;
  while (head < queue.length) {
    const t = queue[head++];
    if (g.blocked[idx(t.x, t.y, size)] === 0) return t;
    for (const [dx, dy] of DIRS) {
      const nx = t.x + dx;
      const ny = t.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = idx(nx, ny, size);
      if (!visited[ni]) {
        visited[ni] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return null;
}

// Coleta até `count` tiles caminháveis mais próximos de (tx,ty) — usados para
// espalhar destinos de grupos em movimento.
export function collectSpreadTiles(g: Grid, tx: number, ty: number, count: number): Pt[] {
  const size = g.size;
  const cx = clampTile(tx, size);
  const cy = clampTile(ty, size);
  const visited = new Uint8Array(size * size);
  const queue: Pt[] = [{ x: cx, y: cy }];
  visited[idx(cx, cy, size)] = 1;
  const out: Pt[] = [];
  let head = 0;
  while (head < queue.length && out.length < count) {
    const t = queue[head++];
    if (g.blocked[idx(t.x, t.y, size)] === 0) out.push(t);
    for (const [dx, dy] of DIRS) {
      const nx = t.x + dx;
      const ny = t.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = idx(nx, ny, size);
      if (!visited[ni]) {
        visited[ni] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return out;
}
