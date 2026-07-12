// Renderização ISOMÉTRICA em Canvas 2D (estilo Age of Empires 2, dimetro 2:1).
// Etapa 1: foco no TERRENO (losangos de grama/água). Unidades, prédios e nós são
// desenhados como blocos/marcadores isométricos simples (placeholders) que serão
// substituídos por arte dedicada nas próximas etapas.

import type { BuildingSnap, BuildingType, NodeSnap, NodeType, ResourceType, SheepSnap, UnitSnap } from '@age/shared';
import { BUILDING_DEFS, DEFENSE_DEFS, SHEEP_FOOD, TILE_WATER, UNIT_DEFS, techBonus } from '@age/shared';
import type { GameState } from '../state';
import type { Camera } from './camera';
import { ISO_HH, ISO_HW } from './camera';
import { Ambient } from './ambient';
import { Sprites, TreeSprites, type SpriteFit } from './sprites';
import type { UIState } from './uistate';
import { ghostTile, wallLineTiles } from './uistate';

export const RESOURCE_COLORS: Record<ResourceType, string> = {
  food: '#d3625c',
  wood: '#8b5e34',
  gold: '#ecc73e',
  stone: '#a8adb4',
};

export const MINIMAP_NODE_COLORS: Record<NodeType, string> = {
  tree: '#2f7a33',
  berry_bush: '#c9414d',
  gold_mine: '#ecc73e',
  stone_mine: '#a8adb4',
};

/** Materiais por era (1=Trevas, 2=Feudal, 3=Castelos, 4=Imperial). Cada era não
 *  muda só a cor: os prédios trocam de FORMA (cabana de palha -> casa de vigas ->
 *  pedra com ameias -> pedra nobre com torres). Estas são as paletas base. */
interface AgeMat {
  wood: string;    // madeira estrutural (vigas, postes, cercas)
  wall: string;    // parede de madeira/taipa
  plaster: string; // reboco claro
  stone: string;   // pedra
  thatch: string;  // palha
  tile: string;    // telha
  slate: string;   // ardósia
  h: number;       // multiplicador geral de altura
}
const AGE_MATS: AgeMat[] = [
  null as unknown as AgeMat,
  { wood: '#7d6038', wall: '#8a6f48', plaster: '#c9b78e', stone: '#8f8a80', thatch: '#b89b4a', tile: '#b06a48', slate: '#6d7f92', h: 0.85 },
  { wood: '#6f5638', wall: '#a98d5e', plaster: '#d3ba8e', stone: '#93918a', thatch: '#c2a34e', tile: '#bd5a44', slate: '#5d6f84', h: 1.0 },
  { wood: '#5e4a30', wall: '#9a815a', plaster: '#cfc4a4', stone: '#9a988f', thatch: '#b3944a', tile: '#9c4536', slate: '#54667c', h: 1.12 },
  { wood: '#54432c', wall: '#8f7850', plaster: '#e0d6bc', stone: '#c0bdb2', thatch: '#b3944a', tile: '#8e3f31', slate: '#46586e', h: 1.25 },
];

interface Pt {
  x: number;
  y: number;
}

/** Contexto de desenho de um prédio (cantos da base já projetados na tela). */
interface BSite {
  px: (x: number, y: number) => number;
  py: (x: number, y: number) => number;
  T: Pt;
  R: Pt;
  B: Pt;
  L: Pt;
  hh: number;
  th: number;
  s: number;
  age: number;
  m: AgeMat;
  owner: string;
  under: boolean;
  prog: number;
  b: BuildingSnap;
  now: number;
}

/** Hash determinístico 0..1 por coordenada de tile. */
function hash01(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ruído de valor suave (interpolação bilinear de hash01), 0..1.
 * Varia devagar no espaço, então tiles vizinhos têm cor quase igual
 * (sem o efeito de xadrez do hash por tile). */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const tl = hash01(xi, yi);
  const tr = hash01(xi + 1, yi);
  const bl = hash01(xi, yi + 1);
  const br = hash01(xi + 1, yi + 1);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function shadeHex(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const adj = (c: number): number => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f);
  return `rgb(${adj((n >> 16) & 255)},${adj((n >> 8) & 255)},${adj(n & 255)})`;
}

function hpColor(frac: number): string {
  return frac > 0.6 ? '#58c25e' : frac > 0.3 ? '#e0b23e' : '#e05b52';
}

export class Renderer {
  private ambient: Ambient;
  private sprites = new Sprites();
  private trees = new TreeSprites();
  /** Campo 0..1 de "chão de floresta" ao redor das árvores (terra + folhas). */
  private forest: Float32Array | null = null;
  private forestSig = '';

  constructor(private gs: GameState) {
    this.ambient = new Ambient(gs);
    this.sprites.preload();
    this.trees.preload();
  }

  /** Mancha suave de chão de floresta sob/ao redor de cada árvore. Recalculada
   *  apenas quando o conjunto de árvores muda (derrubar árvore encolhe a mancha). */
  private getForestField(): Float32Array {
    const size = this.gs.map.size;
    let count = 0;
    let sum = 0;
    for (const n of this.gs.nodes.values()) {
      if (n.type === 'tree') { count++; sum = (sum + n.id) % 0xfffffff; }
    }
    const sig = `${count}:${sum}`;
    if (this.forest && sig === this.forestSig) return this.forest;
    this.forestSig = sig;
    const f = this.forest?.length === size * size ? this.forest.fill(0) : new Float32Array(size * size);
    const R = 2.4; // raio da mancha em tiles
    for (const n of this.gs.nodes.values()) {
      if (n.type !== 'tree') continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = n.tileX + dx;
          const y = n.tileY + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const v = 1 - Math.hypot(dx, dy) / R;
          if (v <= 0) continue;
          const i = y * size + x;
          if (v > f[i]) f[i] = v;
        }
      }
    }
    this.forest = f;
    return f;
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, ui: UIState, dpr: number, now: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e0a';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    const size = this.gs.map.size;
    const z = cam.zoom;
    const hw = ISO_HW * z;
    const hh = ISO_HH * z;
    const cx = cam.viewW / 2 - (cam.x - cam.y) * hw;
    const cy = cam.viewH / 2 - (cam.x + cam.y) * hh;
    const px = (wx: number, wy: number): number => (wx - wy) * hw + cx;
    const py = (wx: number, wy: number): number => (wx + wy) * hh + cy;

    // --- alcance de tiles visíveis (culling) ---
    const cw = [
      cam.screenToWorld(0, 0),
      cam.screenToWorld(cam.viewW, 0),
      cam.screenToWorld(0, cam.viewH),
      cam.screenToWorld(cam.viewW, cam.viewH),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of cw) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const tx0 = Math.max(0, Math.floor(minX) - 1);
    const tx1 = Math.min(size - 1, Math.ceil(maxX) + 1);
    const ty0 = Math.max(0, Math.floor(minY) - 1);
    const ty1 = Math.min(size - 1, Math.ceil(maxY) + 1);

    // --- terreno (losangos) ---
    const tiles = this.gs.map.tiles;
    const forest = this.getForestField();
    const isWater = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < size && y < size && tiles[y * size + x] === TILE_WATER;
    // Losango levemente expandido: as bordas se sobrepõem e escondem as
    // emendas de anti-aliasing entre tiles (some a "grade").
    const ex = hw + 0.75;
    const ey = hh + 0.4;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const v = tiles[ty * size + tx];
        const ax = (tx - ty) * hw + cx;
        const ac = (tx + ty) * hh + cy + hh; // centro vertical do losango
        ctx.beginPath();
        ctx.moveTo(ax, ac - ey);
        ctx.lineTo(ax + ex, ac);
        ctx.lineTo(ax, ac + ey);
        ctx.lineTo(ax - ex, ac);
        ctx.closePath();
        let dirtT = 0;
        let forestT = 0;
        if (v === TILE_WATER) {
          // água lisa (como antes), com o ruído deslizando bem devagar no tempo
          // pra "mexer" de leve — sem virar quadradinhos nem gradiente por tile.
          const t = now * 0.00018;
          const wn = vnoise(tx / 4.5 + 3 + t, ty / 4.5 + 9 - t * 0.6);
          ctx.fillStyle = `hsl(202, 46%, ${41 + wn * 9}%)`;
        } else {
          // grama adjacente à água vira areia (praia de 1 tile em volta do lago)
          const beach =
            isWater(tx + 1, ty) || isWater(tx - 1, ty) || isWater(tx, ty + 1) || isWater(tx, ty - 1) ||
            isWater(tx + 1, ty + 1) || isWater(tx - 1, ty - 1) || isWater(tx + 1, ty - 1) || isWater(tx - 1, ty + 1);
          if (beach) {
            const sn = vnoise(tx / 3 + 20, ty / 3 + 20);
            // areia molhada (encostando na água, 4-dir) mais escura que a seca
            const wet = isWater(tx + 1, ty) || isWater(tx - 1, ty) || isWater(tx, ty + 1) || isWater(tx, ty - 1);
            ctx.fillStyle = wet ? `hsl(41, 40%, ${46 + sn * 6}%)` : `hsl(45, 42%, ${63 + sn * 7}%)`;
          } else {
            // cor por ruído suave (varia devagar) => sem xadrez, sem bordas
            const n = vnoise(tx / 6.5, ty / 6.5);
            const n2 = vnoise(tx / 2.4 + 11, ty / 2.4 + 7);
            // bioma em escala LARGA (transição gradual, nunca por tile):
            // capim seco/amarelado numa região, verde exuberante noutra
            const bio = vnoise(tx / 24 + 71, ty / 24 + 71);
            const dryT = clamp01((0.42 - bio) * 2.4);
            const lushT = clamp01((bio - 0.62) * 2.6);
            ctx.fillStyle = `hsl(${95 + (n - 0.5) * 8 - dryT * 16 + lushT * 7}, ${33 - dryT * 7 + lushT * 5}%, ${30 + n * 7 + (n2 - 0.5) * 2.5 + dryT * 5 - lushT * 1.5}%)`;
            // manchas de terra batida (noise de baixa freq., borda suave)
            const dn = vnoise(tx / 8.5 + 40, ty / 8.5 + 40);
            if (dn > 0.66) dirtT = Math.min(0.72, ((dn - 0.66) / 0.2) * 0.72);
            // chão de floresta: terra escura e folhas sob as árvores
            forestT = forest[ty * size + tx];
          }
        }
        ctx.fill();
        if (dirtT > 0) {
          ctx.fillStyle = `rgba(150,118,74,${dirtT})`;
          ctx.fill();
        }
        if (forestT > 0.05) {
          ctx.fillStyle = `rgba(56,46,26,${forestT * 0.34})`;
          ctx.fill();
        }
      }
    }

    // --- costa: quebra a borda "quadrada" água/terra com uma franja ondulada ---
    this.drawCoast(ctx, px, py, tiles, size, tx0, tx1, ty0, ty1);

    // --- terra batida ao redor dos prédios + detalhes do chão ---
    this.drawBuildingDirt(ctx, px, py, hw, hh);
    this.drawScatter(ctx, tx0, tx1, ty0, ty1, px, py, cam.zoom, tiles, size);

    // --- vida ambiente sob a água (peixes), logo após o terreno ---
    this.ambient.drawWater(ctx, cam, now);

    // --- entidades ordenadas por profundidade (x+y crescente) ---
    interface Item {
      depth: number;
      kind: 'node' | 'building' | 'unit' | 'sheep';
      node?: NodeSnap;
      building?: BuildingSnap;
      unit?: UnitSnap;
      sheep?: SheepSnap;
      ux?: number;
      uy?: number;
    }
    // nós sendo coletados agora (para balançar a árvore que está sendo cortada)
    const gathered = new Set<number>();
    for (const u of this.gs.units.values()) {
      if (u.state === 'gathering' && u.targetId != null) gathered.add(u.targetId);
    }

    const items: Item[] = [];
    for (const n of this.gs.nodes.values()) {
      if (n.tileX < minX - 2 || n.tileX > maxX + 2 || n.tileY < minY - 2 || n.tileY > maxY + 2) continue;
      items.push({ depth: n.tileX + n.tileY, kind: 'node', node: n });
    }
    for (const b of this.gs.buildings.values()) {
      const s = BUILDING_DEFS[b.type]?.size ?? 1;
      items.push({ depth: b.tileX + b.tileY + s, kind: 'building', building: b });
    }
    for (const u of this.gs.units.values()) {
      const pos = this.gs.unitPos(u, now);
      if (pos.x < minX - 2 || pos.x > maxX + 2 || pos.y < minY - 2 || pos.y > maxY + 2) continue;
      items.push({ depth: pos.x + pos.y, kind: 'unit', unit: u, ux: pos.x, uy: pos.y });
    }
    for (const s of this.gs.sheep.values()) {
      const pos = this.gs.sheepPos(s, now);
      if (pos.x < minX - 2 || pos.x > maxX + 2 || pos.y < minY - 2 || pos.y > maxY + 2) continue;
      items.push({ depth: pos.x + pos.y, kind: 'sheep', sheep: s, ux: pos.x, uy: pos.y });
    }
    items.sort((a, b) => a.depth - b.depth);

    for (const it of items) {
      if (it.kind === 'node' && it.node) {
        this.drawNode(ctx, px, py, it.node, this.gs.selection.has(it.node.id), now, gathered.has(it.node.id));
      } else if (it.kind === 'building' && it.building) {
        this.drawBuilding(ctx, px, py, hh, it.building, this.gs.selection.has(it.building.id), now);
      } else if (it.kind === 'unit' && it.unit) {
        this.drawUnit(ctx, px, py, hh, it.unit, it.ux!, it.uy!, this.gs.selection.has(it.unit.id), now);
      } else if (it.kind === 'sheep' && it.sheep) {
        this.drawSheep(ctx, px, py, hh, it.sheep, it.ux!, it.uy!, this.gs.selection.has(it.sheep.id));
      }
    }

    // --- árvores caindo (nós que acabaram de esgotar), tombando da base ---
    for (const r of this.gs.removedNodes) {
      if (r.node.type !== 'tree') continue;
      const age = (now - r.at) / 900;
      if (age < 0 || age >= 1) continue;
      const bx = px(r.node.tileX + 0.5, r.node.tileY + 0.5);
      const by = py(r.node.tileX + 0.5, r.node.tileY + 0.5);
      const dir = hash01(r.node.tileX, r.node.tileY) < 0.5 ? -1 : 1;
      const ease = 1 - (1 - Math.min(1, age * 1.15)) ** 2; // ease-out
      ctx.save();
      ctx.globalAlpha = 1 - clamp01((age - 0.7) / 0.3); // some no fim
      ctx.translate(bx, by);
      ctx.rotate(dir * ease * 1.45); // tomba até ~83°
      ctx.translate(-bx, -by);
      this.drawTree(ctx, bx, by, hh, r.node.tileX, r.node.tileY);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // --- ovelhas comidas: puff de lã que sobe e some ---
    for (const r of this.gs.removedSheep) {
      const age = (now - r.at) / 900;
      if (age < 0 || age >= 1) continue;
      const bx = px(r.sheep.x, r.sheep.y);
      const by = py(r.sheep.x, r.sheep.y) - hh * age * 0.8;
      ctx.globalAlpha = 0.7 * (1 - age);
      this.blob(ctx, bx, by, hh * (0.3 + age * 0.3), hh * (0.24 + age * 0.24), '#f4f2ee');
    }
    ctx.globalAlpha = 1;

    // --- efeitos de combate (flechas, mortes, escombros, números de dano) ---
    this.drawCombatFx(ctx, px, py, hh, cam, now);

    // --- bandeiras de reunião ---
    for (const id of this.gs.selection) {
      const b = this.gs.buildings.get(id);
      if (b && b.owner === this.gs.you) this.drawRally(ctx, px, py, hh, b);
    }

    // --- feedback das ordens do botão direito ---
    this.drawOrders(ctx, px, py, hh, ui, now);

    // --- fantasma de posicionamento ---
    this.drawGhost(ctx, px, py, hh, cam, ui, now);

    // --- caixa de seleção (espaço de tela) ---
    const box = ui.boxRect;
    if (box) {
      const rx = Math.min(box.x0, box.x1);
      const ry = Math.min(box.y0, box.y1);
      const rw = Math.abs(box.x1 - box.x0);
      const rh = Math.abs(box.y1 - box.y0);
      ctx.fillStyle = 'rgba(150,210,255,0.12)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(190,230,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    }

    // --- vida ambiente por cima de tudo (pássaros, borboletas, gaivotas) ---
    this.ambient.drawSky(ctx, cam, now);
  }

  // ---------- detalhes do chão (terra, grama ralinha, pedras, tronco caído) ----------

  /** Terra batida (halo marrom suave) sob cada prédio, como no AoE2. */
  /** Franja de costa: para cada tile de TERRA encostado na água, desenha uma
   *  língua de areia molhada por cima do tile de água vizinho com a borda
   *  externa ONDULADA — quebra o ziguezague reto das arestas de losango. A
   *  profundidade é amostrada por vnoise na POSIÇÃO DE MUNDO do canto, então
   *  cantos compartilhados entre arestas vizinhas batem e a costa flui contínua.
   *  Água continua lisa; nada de xadrez nem espuma de LED. */
  private drawCoast(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    tiles: number[],
    size: number,
    tx0: number, tx1: number, ty0: number, ty1: number,
  ): void {
    const isWater = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < size && y < size && tiles[y * size + x] === TILE_WATER;
    // profundidade (em tiles) da franja num ponto de mundo — contínua e suave
    // (vnoise varia devagar no espaço => cantos vizinhos batem, costa flui).
    const prof = (wx: number, wy: number, base: number, amp: number): number =>
      Math.max(0.03, base + (vnoise(wx * 0.55 + 50, wy * 0.55 + 50) - 0.5) * amp);
    // [dx,dy do vizinho de água] -> [cantoA, cantoB] da aresta (coords de mundo
    // relativas a tx,ty). -y=sup-dir, +x=inf-dir, +y=inf-esq, -x=sup-esq.
    const edges: [number, number, [number, number], [number, number]][] = [
      [0, -1, [0, 0], [1, 0]],
      [1, 0, [1, 0], [1, 1]],
      [0, 1, [1, 1], [0, 1]],
      [-1, 0, [0, 1], [0, 0]],
    ];
    // traça a franja de uma aresta: base (na terra) A->B, e borda externa
    // ondulada de B de volta a A (subdividida), empurrada dx,dy para a água.
    const band = (
      tx: number, ty: number, dx: number, dy: number,
      ca: [number, number], cb: [number, number],
      base: number, amp: number,
    ): void => {
      const aWx = tx + ca[0], aWy = ty + ca[1];
      const bWx = tx + cb[0], bWy = ty + cb[1];
      ctx.beginPath();
      ctx.moveTo(px(aWx, aWy), py(aWx, aWy));
      ctx.lineTo(px(bWx, bWy), py(bWx, bWy));
      const N = 3; // pontos na borda externa (mais = curva mais suave)
      for (let k = 0; k <= N; k++) {
        const t = 1 - k / N; // de B (t=1) até A (t=0)
        const wx = aWx + (bWx - aWx) * t;
        const wy = aWy + (bWy - aWy) * t;
        const d = prof(wx, wy, base, amp);
        ctx.lineTo(px(wx + dx * d, wy + dy * d), py(wx + dx * d, wy + dy * d));
      }
      ctx.closePath();
      ctx.fill();
    };
    // 1ª passada: halo de água rasa (translúcido, mais fundo) — suaviza a
    // transição sem linha dura nem espuma de LED.
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isWater(tx, ty)) continue;
        // sedimento de areia na água rasa (quente e translúcido — não é espuma)
        ctx.fillStyle = 'rgba(196,174,120,0.17)';
        for (const [dx, dy, ca, cb] of edges) {
          if (isWater(tx + dx, ty + dy)) band(tx, ty, dx, dy, ca, cb, 0.55, 0.5);
        }
      }
    }
    // 2ª passada: areia molhada opaca (mais rasa) — quebra o ziguezague reto.
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isWater(tx, ty)) continue;
        for (const [dx, dy, ca, cb] of edges) {
          if (!isWater(tx + dx, ty + dy)) continue;
          const mn = vnoise((tx + 0.5) * 1.3 + 8, (ty + 0.5) * 1.3 + 8);
          ctx.fillStyle = `hsl(42, 39%, ${46 + (mn - 0.5) * 9}%)`;
          band(tx, ty, dx, dy, ca, cb, 0.3, 0.5);
        }
      }
    }
  }

  private drawBuildingDirt(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hw: number,
    hh: number,
  ): void {
    const flat = hh / hw; // 0.5 (achata o círculo na proporção iso 2:1)
    for (const b of this.gs.buildings.values()) {
      const s = BUILDING_DEFS[b.type]?.size ?? 1;
      const sx = px(b.tileX + s / 2, b.tileY + s / 2);
      const sy = py(b.tileX + s / 2, b.tileY + s / 2);
      const r = (s / 2 + 1.4) * hw;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(1, flat);
      const grad = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
      grad.addColorStop(0, 'rgba(150,118,74,0.5)');
      grad.addColorStop(1, 'rgba(150,118,74,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Espalha detalhes decorativos por tile (determinístico via hash, sem piscar). */
  private drawScatter(
    ctx: CanvasRenderingContext2D,
    tx0: number, tx1: number, ty0: number, ty1: number,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    z: number,
    tiles: number[],
    size: number,
  ): void {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tiles[ty * size + tx] === TILE_WATER) continue;
        const h = hash01(tx, ty);
        const dirt = vnoise(tx / 8.5 + 40, ty / 8.5 + 40) > 0.66;
        const ox = tx + 0.28 + hash01(tx * 7 + 1, ty * 3 + 2) * 0.44;
        const oy = ty + 0.28 + hash01(tx * 5 + 3, ty * 9 + 4) * 0.44;
        const sx = px(ox, oy);
        const sy = py(ox, oy);
        const ff = this.forest ? this.forest[ty * size + tx] : 0;
        if (ff > 0.25) {
          // chão de floresta: folhas caídas discretas (nada de flores/grama)
          if (h < ff * 0.5) this.leaves(ctx, sx, sy, z, tx, ty);
        } else if (dirt) {
          if (h < 0.2) this.tuft(ctx, sx, sy, z, true); // grama ralinha (seca) na terra
          else if (h < 0.215) this.rock(ctx, sx, sy, 2.4 * z, 1.7 * z, '#8a8d86', '#a8aaa4');
        } else {
          if (h < 0.09) this.tuft(ctx, sx, sy, z, false);
          else if (h < 0.115) this.rock(ctx, sx, sy, 2.4 * z, 1.7 * z, '#8a8d86', '#a8aaa4');
          else if (h < 0.127) this.flower(ctx, sx, sy, z, tx, ty);
        }
        // raros (qualquer chão)
        if (h >= 0.9 && h < 0.902) this.decoRock(ctx, sx, sy, z);
        else if (h >= 0.902 && h < 0.9032) this.fallenLog(ctx, sx, sy, z, tx, ty);
        else if (h >= 0.9032 && h < 0.904) this.bones(ctx, sx, sy, z);
      }
    }
  }

  /** Folhas caídas no chão de floresta (2-3 pontinhos terrosos). */
  private leaves(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number, tx: number, ty: number): void {
    const cols = ['#7a5c30', '#8a6a36', '#6c5a2c'];
    const n = 2 + ((hash01(tx * 11 + 2, ty * 13 + 5) * 2) | 0);
    for (let k = 0; k < n; k++) {
      const a = hash01(tx * 3 + k * 17, ty * 7 + k * 29);
      const b = hash01(tx * 9 + k * 31, ty * 5 + k * 23);
      ctx.fillStyle = cols[(a * cols.length) | 0];
      ctx.beginPath();
      ctx.ellipse(sx + (a - 0.5) * 9 * z, sy + (b - 0.5) * 5 * z, 1.5 * z, 0.9 * z, a * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private tuft(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number, dry: boolean): void {
    ctx.strokeStyle = dry ? '#95924f' : '#42933f';
    ctx.lineWidth = Math.max(1, z * 0.5);
    ctx.lineCap = 'round';
    const n = dry ? 3 : 4;
    const len = (dry ? 3.2 : 4.6) * z;
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * 0.34;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.sin(a) * len * 0.6, sy - Math.cos(a) * len);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  private flower(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number, tx: number, ty: number): void {
    const len = 4.5 * z;
    ctx.strokeStyle = '#3c7a3f';
    ctx.lineWidth = Math.max(1, z * 0.4);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - len);
    ctx.stroke();
    const cols = ['#eee6d2', '#f0c34a', '#d9635c', '#c98fd0'];
    const c = cols[(hash01(tx * 3 + 7, ty * 5 + 1) * cols.length) | 0];
    this.blob(ctx, sx, sy - len, 1.7 * z, 1.7 * z, c);
    this.blob(ctx, sx, sy - len, 0.6 * z, 0.6 * z, '#e8c95d');
  }

  private decoRock(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number): void {
    this.rock(ctx, sx, sy, 8 * z, 5 * z, '#7f8286', '#a4a7ab');
    this.rock(ctx, sx + 6 * z, sy + 2 * z, 5 * z, 3.4 * z, '#75787c', '#989ba0');
    this.rock(ctx, sx - 5 * z, sy + 2.5 * z, 4 * z, 2.8 * z, '#82858a', '#abaeb2');
  }

  /** Tronco caído (a "árvore caída" do AoE2). */
  private fallenLog(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number, tx: number, ty: number): void {
    const len = 24 * z;
    const th = 6.5 * z;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((hash01(tx, ty) - 0.5) * 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(0, th * 0.5, len * 0.52, th * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4a2c';
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.5, th * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(58,38,20,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, th * 0.2, len * 0.5, th * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9a744a'; // ponta cortada
    ctx.beginPath();
    ctx.ellipse(len * 0.47, 0, th * 0.22, th * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b4a2c';
    ctx.lineWidth = Math.max(1, z * 0.5);
    ctx.beginPath();
    ctx.ellipse(len * 0.47, 0, th * 0.11, th * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private bones(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number): void {
    ctx.strokeStyle = '#d8d2c0';
    ctx.lineWidth = Math.max(1, z * 0.55);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - 5 * z, sy);
    ctx.lineTo(sx + 5 * z, sy - z);
    ctx.stroke();
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(sx + k * 3 * z, sy - 0.5 * z, 2.2 * z, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    this.blob(ctx, sx - 7 * z, sy, 2.2 * z, 2 * z, '#e2ddce', 'rgba(0,0,0,0.2)');
  }

  // ---------- helpers isométricos ----------

  /** Desenha um losango (footprint) entre os tiles [tileX,tileY]..[+w,+w]. */
  private isoDiamond(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    tx: number,
    ty: number,
    w: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(px(tx, ty), py(tx, ty));
    ctx.lineTo(px(tx + w, ty), py(tx + w, ty));
    ctx.lineTo(px(tx + w, ty + w), py(tx + w, ty + w));
    ctx.lineTo(px(tx, ty + w), py(tx, ty + w));
    ctx.closePath();
  }

  // ---------- nós de recurso (árvore, arbusto, pedra, ouro) ----------

  /** Pedregulho isométrico: corpo (face lateral) + topo iluminado. */
  private rock(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, side: string, top: string): void {
    this.blob(ctx, cx, cy, rx, ry, side, shadeHex(side, -0.5));
    this.blob(ctx, cx, cy - ry * 0.35, rx * 0.72, ry * 0.6, top);
  }

  /** Árvore grande estilo AoE2: tronco cônico + copa em camadas com luz. */
  private drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, U: number, tx: number, ty: number): void {
    const j = hash01(tx * 2 + 1, ty * 2 + 1);
    const T = U * (1.25 + j * 0.45); // escala base, com variação por árvore
    const tw = T * 0.12; // tronco fino
    const th = T * 2.4; // tronco alto (árvore mais alta)
    // tronco (trapézio) com lado iluminado
    this.poly(
      ctx,
      [{ x: sx - tw, y: sy }, { x: sx + tw, y: sy }, { x: sx + tw * 0.5, y: sy - th }, { x: sx - tw * 0.5, y: sy - th }],
      '#6b4726',
    );
    this.poly(
      ctx,
      [{ x: sx - tw, y: sy }, { x: sx - tw * 0.3, y: sy }, { x: sx - tw * 0.2, y: sy - th }, { x: sx - tw * 0.5, y: sy - th }],
      '#835d38',
    );
    // copa MAGRA e ALTA: pilha vertical de tufos arredondados, estreitando no
    // topo (Rx pequeno = largura; Ry grande = altura). Estilo low-poly.
    const ccx = sx;
    const base = sy - th; // topo do tronco
    const Rx = T * 0.6;
    const Ry = T * 1.55;
    this.blob(ctx, ccx, base - Ry * 0.5, Rx * 1.02, Ry * 0.56, '#1e4a23'); // silhueta escura alongada
    const shades = ['#255a2a', '#2f6b34', '#3c8340', '#4c9a4b', '#5cab57'];
    // [dx (em Rx), up (0 base .. 1 topo), r (raio em Rx), tom]
    const clusters: [number, number, number, number][] = [
      [0.0, 0.1, 0.98, 1], [-0.55, 0.2, 0.6, 1], [0.55, 0.22, 0.58, 2],
      [0.0, 0.34, 0.92, 2], [-0.42, 0.46, 0.56, 2], [0.44, 0.5, 0.54, 3],
      [0.0, 0.58, 0.82, 3], [-0.28, 0.7, 0.5, 3], [0.3, 0.74, 0.48, 4],
      [0.0, 0.84, 0.6, 4], [0.0, 1.0, 0.36, 4],
    ];
    for (let i = 0; i < clusters.length; i++) {
      const [dx, up, r, si] = clusters[i];
      const jr = 0.88 + hash01(tx * 3 + i, ty * 2 + i * 5) * 0.24;
      this.blob(ctx, ccx + dx * Rx, base - up * Ry, r * Rx * jr, r * Rx * jr * 0.98, shades[si]);
    }
  }

  private drawNode(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    n: NodeSnap,
    selected: boolean,
    now: number,
    chopped: boolean,
  ): void {
    const sx = px(n.tileX + 0.5, n.tileY + 0.5);
    const sy = py(n.tileX + 0.5, n.tileY + 0.5);
    const z = (px(n.tileX + 1, n.tileY) - px(n.tileX, n.tileY)) / ISO_HW; // ~zoom
    const U = ISO_HH * z; // escala base

    // sombra (só árvore/arbusto — as minas têm a própria mancha de brita,
    // e a elipse escura por baixo parecia um buraco no chão)
    if (n.type === 'tree' || n.type === 'berry_bush') {
      this.blob(ctx, sx, sy, U * 0.9, U * 0.42, 'rgba(0,0,0,0.2)');
    }

    // destaque de seleção: losango na base do recurso (como no AoE2)
    if (selected) {
      this.isoDiamond(ctx, px, py, n.tileX + 0.02, n.tileY + 0.02, 0.96);
      ctx.strokeStyle = '#f5f0e0';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (n.type === 'tree') {
      // sprite (se houver) ancorado com a BASE do tronco em (sx, sy); variação
      // estável sorteada pela posição. Sem sprite → árvore procedural.
      const timg = this.trees.get(n.tileX * 7 + n.tileY * 13);
      const paint = (): void => {
        if (timg) {
          const drawW = U * 3.6;
          const drawH = drawW * (timg.height / timg.width);
          ctx.drawImage(timg, sx - drawW / 2, sy - drawH, drawW, drawH);
        } else {
          this.drawTree(ctx, sx, sy, U, n.tileX, n.tileY);
        }
      };
      if (chopped) {
        // balança de leve enquanto está sendo cortada (pivô na base)
        const sway = Math.sin(now * 0.02 + hash01(n.tileX, n.tileY) * 6.28) * 0.05;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(sway);
        ctx.translate(-sx, -sy);
        paint();
        ctx.restore();
      } else {
        paint();
      }
    } else if (n.type === 'berry_bush') {
      this.blob(ctx, sx - U * 0.34, sy - U * 0.4, U * 0.42, U * 0.4, '#2f6b34', '#1e4d22');
      this.blob(ctx, sx + U * 0.34, sy - U * 0.4, U * 0.42, U * 0.4, '#2f6b34', '#1e4d22');
      this.blob(ctx, sx, sy - U * 0.62, U * 0.5, U * 0.46, '#3a7a3e', '#245229');
      const berry = (dx: number, dy: number): void => this.blob(ctx, sx + dx * U, sy - dy * U, U * 0.11, U * 0.11, '#d23b46', '#8f2630');
      berry(-0.3, 0.55); berry(0.15, 0.7); berry(0.42, 0.5); berry(-0.05, 0.42); berry(0.3, 0.32);
    } else if (n.type === 'gold_mine') {
      this.mineCluster(ctx, sx, sy, U, n.tileX, n.tileY, 'gold');
    } else if (n.type === 'stone_mine') {
      this.mineCluster(ctx, sx, sy, U, n.tileX, n.tileY, 'stone');
    }
  }

  /** Mina "chapada": monte BAIXO de pedras espalhadas preenchendo o tile
   *  (nada de bolinhas empilhadas), com brita/terra por baixo — o chão fica
   *  preenchido como o da fazenda. Determinístico por tile (não pisca).
   *  kind muda a paleta; o ouro ganha pepitas douradas cintilando. */
  private mineCluster(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number, U: number,
    tx: number, ty: number,
    kind: 'gold' | 'stone',
  ): void {
    const cy = sy - U * 0.06;
    // mancha de brita/terra cobrindo o tile
    const grad = ctx.createRadialGradient(sx, cy, U * 0.2, sx, cy, U * 2.2);
    if (kind === 'gold') {
      grad.addColorStop(0, 'rgba(134,112,78,0.6)');
      grad.addColorStop(1, 'rgba(134,112,78,0)');
    } else {
      grad.addColorStop(0, 'rgba(112,114,116,0.55)');
      grad.addColorStop(1, 'rgba(112,114,116,0)');
    }
    ctx.fillStyle = grad;
    ctx.save();
    ctx.translate(sx, cy);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, U * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // pedrinhas soltas na beirada da mancha
    const pebbleC = kind === 'gold' ? '#6e6152' : '#7d7f83';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + hash01(tx + i, ty * 3 + i) * 0.7;
      const rr = 1.35 + hash01(tx * 5 + i, ty + i) * 0.5;
      const s = U * (0.05 + hash01(tx + i * 7, ty + i * 3) * 0.05);
      this.blob(ctx, sx + Math.cos(a) * U * rr * 1.3, cy + Math.sin(a) * U * rr * 0.55, s, s * 0.7, pebbleC);
    }

    // pedras baixas espalhadas: maiores no centro, menores na borda; desenhadas
    // de trás pra frente (painter) para o monte "assentar" no chão
    const side = kind === 'gold' ? '#6e675e' : '#75777b';
    const top = kind === 'gold' ? '#948a7c' : '#a4a6aa';
    const rocks: { x: number; y: number; rx: number; ry: number; c: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const h1 = hash01(tx * 13 + i * 7, ty * 17 + i * 3);
      const h2 = hash01(tx * 29 + i * 11, ty * 7 + i * 5);
      const h3 = hash01(tx * 3 + i * 17, ty * 23 + i * 13);
      const ang = h1 * Math.PI * 2;
      const rad = Math.sqrt(h2);              // 0 centro .. 1 borda
      const c = 1 - rad;                      // "centralidade"
      const s = U * (0.16 + 0.2 * c + 0.07 * h3);
      rocks.push({
        x: sx + Math.cos(ang) * U * rad * 1.85,
        y: cy + Math.sin(ang) * U * rad * 0.88,
        rx: s,
        ry: s * (0.62 + 0.14 * h3),
        c,
      });
    }
    rocks.sort((a, b) => a.y - b.y);
    for (const r of rocks) {
      const vary = (r.c - 0.4) * 0.18; // centro um tico mais claro/alto
      this.rock(ctx, r.x, r.y, r.rx, r.ry, shadeHex(side, vary), shadeHex(top, vary));
    }

    if (kind === 'gold') {
      // pepitas douradas nas pedras do miolo (com pontinho de brilho)
      for (let i = 0; i < 6; i++) {
        const h1 = hash01(tx * 31 + i * 19, ty * 37 + i * 7);
        const h2 = hash01(tx * 41 + i * 5, ty * 11 + i * 23);
        const ang = h1 * Math.PI * 2;
        const rad = Math.sqrt(h2) * 0.62;
        const gx = sx + Math.cos(ang) * U * rad * 1.5;
        const gy = cy - U * (0.12 + h2 * 0.22) + Math.sin(ang) * U * rad * 0.6;
        const s = U * (0.07 + h1 * 0.05);
        this.blob(ctx, gx, gy, s, s * 0.85, '#f0c93e', '#a8862a');
        ctx.fillStyle = '#fbe98d';
        ctx.fillRect(gx - s * 0.3, gy - s * 0.45, Math.max(1, s * 0.5), Math.max(1, s * 0.5));
      }
    } else {
      // fendas discretas nas pedras do miolo
      for (let i = 0; i < 3; i++) {
        const h1 = hash01(tx * 43 + i * 13, ty * 19 + i * 29);
        const h2 = hash01(tx * 7 + i * 31, ty * 47 + i * 11);
        const fx = sx + (h1 - 0.5) * U * 1.4;
        const fy = cy - U * 0.18 + (h2 - 0.5) * U * 0.5;
        this.limb(ctx, fx, fy, fx + U * 0.2, fy + U * 0.16, U * 0.035, 'rgba(30,32,34,0.3)');
      }
    }
  }

  // ---------- prédios (arte medieval isométrica) ----------

  private poly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string, stroke?: string): void {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Duas faces frontais de parede (altura H) a partir da base; devolve o topo. */
  private walls(
    ctx: CanvasRenderingContext2D,
    T: Pt, R: Pt, B: Pt, L: Pt,
    H: number,
    color: string,
  ): { T2: Pt; R2: Pt; B2: Pt; L2: Pt } {
    const up = (p: Pt): Pt => ({ x: p.x, y: p.y - H });
    const T2 = up(T), R2 = up(R), B2 = up(B), L2 = up(L);
    this.poly(ctx, [L, B, B2, L2], shadeHex(color, -0.4)); // frontal-esquerda (escura)
    this.poly(ctx, [R, B, B2, R2], shadeHex(color, -0.2)); // frontal-direita
    return { T2, R2, B2, L2 };
  }

  /** Telhado de quatro águas sobre o topo das paredes. */
  private hipRoof(
    ctx: CanvasRenderingContext2D,
    top: { T2: Pt; R2: Pt; B2: Pt; L2: Pt },
    peakH: number,
    color: string,
  ): void {
    const { T2, R2, B2, L2 } = top;
    const peak: Pt = { x: (T2.x + B2.x) / 2, y: (T2.y + B2.y) / 2 - peakH };
    this.poly(ctx, [T2, R2, peak], shadeHex(color, 0.12));  // fundo-direita (clara)
    this.poly(ctx, [T2, L2, peak], shadeHex(color, 0.0));   // fundo-esquerda
    this.poly(ctx, [R2, B2, peak], shadeHex(color, -0.14)); // frente-direita
    this.poly(ctx, [L2, B2, peak], shadeHex(color, -0.32)); // frente-esquerda (escura)
  }

  private banner(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string): void {
    ctx.strokeStyle = '#efe8d8';
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.stroke();
    this.poly(
      ctx,
      [{ x, y: y - h }, { x: x + h * 0.6, y: y - h * 0.82 }, { x, y: y - h * 0.58 }],
      color,
      shadeHex(color, -0.4),
    );
  }

  /** Porta na face frontal-direita (entre a base B e a base R). */
  private door(ctx: CanvasRenderingContext2D, B: Pt, R: Pt, H: number): void {
    const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const p1 = lerp(B, R, 0.24);
    const p2 = lerp(B, R, 0.5);
    const dh = H * 0.62;
    this.poly(ctx, [p1, p2, { x: p2.x, y: p2.y - dh }, { x: p1.x, y: p1.y - dh }], '#3a2a1a');
  }

  /** Telhado de DUAS águas (cumeeira entre os meios de duas arestas opostas).
   *  flip=false: cumeeira da aresta T-L à R-B; flip=true: da T-R à L-B. */
  private gableRoof(
    ctx: CanvasRenderingContext2D,
    top: { T2: Pt; R2: Pt; B2: Pt; L2: Pt },
    peakH: number,
    color: string,
    flip = false,
  ): void {
    const { T2, R2, B2, L2 } = top;
    const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - peakH });
    const g1 = flip ? mid(T2, R2) : mid(T2, L2);
    const g2 = flip ? mid(L2, B2) : mid(R2, B2);
    if (flip) {
      this.poly(ctx, [T2, L2, g2, g1], shadeHex(color, 0.1));   // água do fundo
      this.poly(ctx, [T2, R2, g1], shadeHex(color, -0.05));     // oitão do fundo
      this.poly(ctx, [L2, B2, g2], shadeHex(color, -0.34));     // oitão da frente
      this.poly(ctx, [R2, B2, g2, g1], shadeHex(color, -0.18)); // água da frente
    } else {
      this.poly(ctx, [T2, R2, g2, g1], shadeHex(color, 0.1));
      this.poly(ctx, [T2, L2, g1], shadeHex(color, -0.05));
      this.poly(ctx, [R2, B2, g2], shadeHex(color, -0.18));
      this.poly(ctx, [L2, B2, g2, g1], shadeHex(color, -0.34));
    }
    ctx.strokeStyle = shadeHex(color, 0.28);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(g1.x, g1.y);
    ctx.lineTo(g2.x, g2.y);
    ctx.stroke();
  }

  /** Ameias (merlões) nas quatro arestas do topo — visual de fortaleza. */
  private crenels(
    ctx: CanvasRenderingContext2D,
    top: { T2: Pt; R2: Pt; B2: Pt; L2: Pt },
    h: number,
    color: string,
  ): void {
    const edge = (a: Pt, b: Pt, dark: number): void => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(2, Math.round(len / 13));
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.12) / n;
        const t1 = (i + 0.58) / n;
        const p0: Pt = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
        const p1: Pt = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
        this.poly(ctx, [p0, p1, { x: p1.x, y: p1.y - h }, { x: p0.x, y: p0.y - h }], shadeHex(color, dark));
      }
    };
    edge(top.T2, top.R2, 0.06); // fundo-direita (vista por cima, clara)
    edge(top.T2, top.L2, 0.0);  // fundo-esquerda
    edge(top.L2, top.B2, -0.38); // frente-esquerda (escura)
    edge(top.B2, top.R2, -0.16); // frente-direita
  }

  /** Torreão cilíndrico (espaço de tela) com telhado cônico. */
  private turret(
    ctx: CanvasRenderingContext2D,
    x: number, yBase: number,
    w: number, h: number,
    wall: string, roof: string,
  ): void {
    const r = w / 2;
    ctx.fillStyle = shadeHex(wall, -0.3);
    ctx.fillRect(x - r, yBase - h, r, h);
    ctx.fillStyle = shadeHex(wall, -0.06);
    ctx.fillRect(x, yBase - h, r, h);
    ctx.fillStyle = shadeHex(wall, 0.12);
    ctx.beginPath();
    ctx.ellipse(x, yBase - h, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    const rh = h * 0.7;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.18, yBase - h);
    ctx.lineTo(x, yBase - h - rh);
    ctx.lineTo(x + r * 1.18, yBase - h);
    ctx.closePath();
    ctx.fillStyle = shadeHex(roof, -0.15);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, yBase - h - rh);
    ctx.lineTo(x + r * 1.18, yBase - h);
    ctx.lineTo(x + r * 0.3, yBase - h);
    ctx.closePath();
    ctx.fillStyle = shadeHex(roof, 0.06);
    ctx.fill();
  }

  /** Cabana redonda (era das Trevas): parede cilíndrica + porta. */
  private roundHut(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    r: number, H: number,
    wall: string,
  ): void {
    const ey = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - H);
    ctx.lineTo(cx - r, cy);
    ctx.ellipse(cx, cy, r, ey, 0, Math.PI, 0, true); // meia-elipse frontal
    ctx.lineTo(cx + r, cy - H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, shadeHex(wall, -0.4));
    grad.addColorStop(0.55, shadeHex(wall, -0.08));
    grad.addColorStop(1, shadeHex(wall, -0.3));
    ctx.fillStyle = grad;
    ctx.fill();
    // porta (arco escuro na frente)
    const dw = r * 0.26;
    const dh = H * 0.75;
    ctx.fillStyle = '#33261a';
    ctx.beginPath();
    ctx.moveTo(cx - dw, cy + ey * 0.72);
    ctx.lineTo(cx - dw, cy + ey * 0.72 - dh);
    ctx.quadraticCurveTo(cx, cy + ey * 0.72 - dh - dw, cx + dw, cy + ey * 0.72 - dh);
    ctx.lineTo(cx + dw, cy + ey * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  /** Telhado cônico de palha (para a cabana redonda). */
  private coneRoof(
    ctx: CanvasRenderingContext2D,
    cx: number, cyTop: number,
    r: number, peakH: number,
    color: string,
  ): void {
    const ey = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - r, cyTop);
    ctx.lineTo(cx, cyTop - peakH);
    ctx.lineTo(cx + r, cyTop);
    ctx.ellipse(cx, cyTop, r, ey, 0, 0, Math.PI, false); // barriga frontal
    ctx.closePath();
    const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, shadeHex(color, -0.32));
    grad.addColorStop(0.5, shadeHex(color, 0.04));
    grad.addColorStop(1, shadeHex(color, -0.2));
    ctx.fillStyle = grad;
    ctx.fill();
    // riscos de palha
    ctx.strokeStyle = 'rgba(60,44,20,0.3)';
    ctx.lineWidth = 1;
    for (const t of [-0.6, -0.2, 0.25, 0.65]) {
      ctx.beginPath();
      ctx.moveTo(cx, cyTop - peakH);
      ctx.lineTo(cx + r * t, cyTop + ey * Math.sqrt(Math.max(0, 1 - t * t)) * 0.9);
      ctx.stroke();
    }
  }

  /** Fumaça subindo (chaminé). Animação barata, determinística por seed. */
  private smoke(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, seed: number): void {
    for (let i = 0; i < 3; i++) {
      const t = (now / 2600 + i / 3 + seed) % 1;
      const a = (1 - t) * 0.26 * Math.min(1, t * 6);
      if (a <= 0.01) continue;
      const sy = y - t * 26;
      const sx = x + Math.sin(t * 5 + i * 2.1 + seed * 7) * 3.5;
      const r = 2.2 + t * 4.5;
      ctx.fillStyle = `rgba(226,224,218,${a})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Linhas horizontais numa face de parede (tábuas ou fiadas de pedra);
   *  joints=true adiciona juntas verticais alternadas (aparelho de cantaria). */
  private wallLines(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, H: number, rows: number, joints: boolean): void {
    ctx.strokeStyle = 'rgba(40,28,16,0.26)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= rows; i++) {
      const y = (H * i) / (rows + 1);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y - y);
      ctx.lineTo(B.x, B.y - y);
      ctx.stroke();
    }
    if (joints) {
      for (let i = 1; i <= rows + 1; i++) {
        const y0 = (H * (i - 1)) / (rows + 1);
        const y1 = (H * i) / (rows + 1);
        for (let j = 0; j < 3; j++) {
          const t = (j + (i % 2 ? 0.33 : 0.66)) / 3;
          const x = A.x + (B.x - A.x) * t;
          const yb = A.y + (B.y - A.y) * t;
          ctx.beginPath();
          ctx.moveTo(x, yb - y0);
          ctx.lineTo(x, yb - y1);
          ctx.stroke();
        }
      }
    }
  }

  /** Vigas de enxaimel (madeira aparente sobre reboco claro). */
  private timberFrame(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, H: number, wood: string): void {
    ctx.strokeStyle = shadeHex(wood, -0.35);
    ctx.lineWidth = 1.6;
    for (const t of [0.22, 0.5, 0.78]) {
      const x = A.x + (B.x - A.x) * t;
      const y = A.y + (B.y - A.y) * t;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - H);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(A.x, A.y - H * 0.52);
    ctx.lineTo(B.x, B.y - H * 0.52);
    ctx.stroke();
  }

  /** Janela escura numa face de parede (t = posição 0..1 ao longo da base). */
  private windowOn(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, H: number, t: number): void {
    const x = A.x + (B.x - A.x) * t;
    const y = A.y + (B.y - A.y) * t;
    const w = Math.max(2, H * 0.13);
    const h = Math.max(3, H * 0.24);
    ctx.fillStyle = '#2e2418';
    ctx.fillRect(x - w / 2, y - H * 0.64, w, h);
  }

  /** Cerca de madeira (curral): postes + duas travessas ao longo dos pontos. */
  private fence(
    ctx: CanvasRenderingContext2D,
    pts: Pt[],
    h: number,
    wood: string,
  ): void {
    ctx.strokeStyle = shadeHex(wood, -0.2);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.8;
    for (const p of pts) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - h);
      ctx.stroke();
    }
    ctx.lineWidth = 1.2;
    for (const f of [0.45, 0.82]) {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y - h * f) : ctx.lineTo(p.x, p.y - h * f)));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /** Alvo de arco e flecha sobre um poste (campo de arqueiros). */
  private archeryTarget(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.strokeStyle = '#6e552f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - r * 1.5);
    ctx.stroke();
    const cy = y - r * 1.5 - r * 0.85;
    const ring = (rr: number, c: string): void => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    };
    ring(r, '#e8e0cc');
    ring(r * 0.62, '#bf4a38');
    ring(r * 0.26, '#e8e0cc');
  }

  /** Bigorna sobre um cepo (ferraria). */
  private anvil(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.fillStyle = '#6b4a2c';
    ctx.fillRect(x - s * 0.28, y - s * 0.5, s * 0.56, s * 0.5); // cepo
    ctx.fillStyle = '#494a50';
    ctx.fillRect(x - s * 0.55, y - s * 0.85, s * 1.1, s * 0.38); // corpo
    ctx.fillStyle = '#5a5b62';
    ctx.fillRect(x - s * 0.55, y - s * 0.85, s * 1.1, s * 0.12); // topo claro
  }

  /** Brilho quente (fornalha da ferraria). */
  private glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number): void {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,150,60,${a})`);
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Escudo redondo decorativo na parede (quartel). */
  private shieldDecor(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d8cfa8';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#caa96a';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Lanças cruzadas fincadas no chão (quartel primitivo). */
  private weaponRack(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
    ctx.strokeStyle = '#6e552f';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * h * 0.28, y);
      ctx.lineTo(x - dx * h * 0.14, y - h);
      ctx.stroke();
      ctx.fillStyle = '#b8bcc2';
      ctx.beginPath();
      const tx = x - dx * h * 0.14;
      ctx.moveTo(tx - 2, y - h);
      ctx.lineTo(tx, y - h - 5);
      ctx.lineTo(tx + 2, y - h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  /** Monte de feno (estábulo). */
  private hayPile(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.fillStyle = '#c9a84c';
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.3, r, r * 0.55, 0, Math.PI, 0, false);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,94,36,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y - r * 0.5);
    ctx.lineTo(x - r * 0.2, y - r * 0.25);
    ctx.moveTo(x + r * 0.15, y - r * 0.6);
    ctx.lineTo(x + r * 0.45, y - r * 0.3);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- prédios por era

  /** Cantos na tela do sub-retângulo [fx0..fx1]×[fy0..fy1] (frações 0..1 do
   *  terreno do prédio), elevados por dy pixels. */
  private siteRect(
    st: BSite,
    fx0: number, fy0: number, fx1: number, fy1: number,
    dy = 0,
  ): { T: Pt; R: Pt; B: Pt; L: Pt } {
    const { px, py, b, s } = st;
    const X0 = b.tileX + fx0 * s;
    const Y0 = b.tileY + fy0 * s;
    const X1 = b.tileX + fx1 * s;
    const Y1 = b.tileY + fy1 * s;
    return {
      T: { x: px(X0, Y0), y: py(X0, Y0) - dy },
      R: { x: px(X1, Y0), y: py(X1, Y0) - dy },
      B: { x: px(X1, Y1), y: py(X1, Y1) - dy },
      L: { x: px(X0, Y1), y: py(X0, Y1) - dy },
    };
  }

  /** Centro do topo de um telhado de duas águas (para fincar a bandeira). */
  private ridgeTop(top: { T2: Pt; R2: Pt; B2: Pt; L2: Pt }, peakH: number): Pt {
    return {
      x: (top.T2.x + top.R2.x + top.B2.x + top.L2.x) / 4,
      y: (top.T2.y + top.R2.y + top.B2.y + top.L2.y) / 4 - peakH,
    };
  }

  /** Fazenda: campo arado em faixas com brotos verdes. */
  private drawFarm(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { px, py, b, s, T, R, B, L, th } = st;
    this.poly(ctx, [T, R, B, L], '#7e6039', '#5e4326');
    for (let i = 0; i < 5; i++) {
      const f0 = (i / 5) * s;
      const f1 = ((i + 0.55) / 5) * s;
      this.poly(ctx, [
        { x: px(b.tileX + f0, b.tileY), y: py(b.tileX + f0, b.tileY) },
        { x: px(b.tileX + f1, b.tileY), y: py(b.tileX + f1, b.tileY) },
        { x: px(b.tileX + f1, b.tileY + s), y: py(b.tileX + f1, b.tileY + s) },
        { x: px(b.tileX + f0, b.tileY + s), y: py(b.tileX + f0, b.tileY + s) },
      ], '#8d6c40');
    }
    if (!st.under) {
      ctx.fillStyle = 'rgba(96,140,58,0.9)';
      for (let i = 0; i < 5; i++) {
        const fx = ((i + 0.28) / 5) * s;
        for (let j = 0; j < 6; j++) {
          const fy = ((j + 0.5) / 6) * s;
          const x = px(b.tileX + fx, b.tileY + fy);
          const y = py(b.tileX + fx, b.tileY + fy);
          ctx.fillRect(x - 1, y - 2.5, 2, 2.5);
        }
      }
    }
    return py(b.tileX + s / 2, b.tileY + s / 2) - th * 0.2;
  }

  /** Centro da Cidade: pavilhão de palha -> salão feudal -> fortim -> paço com torres. */
  private drawTownCenter(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, age, m, owner, under, prog, now } = st;

    if (age === 1) {
      // TREVAS: plataforma de pedra rústica + telhadão de palha sobre postes.
      const Hp = Math.max(4, th * 0.24) * prog;
      const base = this.walls(ctx, T, R, B, L, Hp, m.stone);
      this.poly(ctx, [base.T2, base.R2, base.B2, base.L2], shadeHex(m.stone, 0.14), shadeHex(m.stone, -0.3));
      const postH = th * 0.85 * prog;
      ctx.strokeStyle = shadeHex(m.wood, -0.15);
      ctx.lineWidth = Math.max(1.6, hh * 0.14);
      const pr = this.siteRect(st, 0.16, 0.16, 0.84, 0.84, Hp);
      for (const c of [pr.T, pr.L, pr.R, pr.B]) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x, c.y - postH);
        ctx.stroke();
      }
      // fogueira central sob o telhado
      if (!under) {
        const cx = (pr.T.x + pr.B.x) / 2;
        const cy = (pr.T.y + pr.B.y) / 2;
        this.glow(ctx, cx, cy, hh * 0.9, 0.22 + 0.05 * Math.sin(now / 260));
      }
      const rr = this.siteRect(st, 0.02, 0.02, 0.98, 0.98, Hp + postH);
      const roofH = s * hh * 0.95;
      this.hipRoof(ctx, { T2: rr.T, R2: rr.R, B2: rr.B, L2: rr.L }, roofH, m.thatch);
      const ry = (rr.T.y + rr.B.y) / 2 - roofH;
      if (!under) this.banner(ctx, (rr.T.x + rr.B.x) / 2, ry, th, owner);
      return ry - th;
    }

    if (age === 2) {
      // FEUDAL: base de tábuas + sobrado de taipa com vigas + telhado de telha.
      const H1 = th * 0.8 * prog;
      const t1 = this.walls(ctx, T, R, B, L, H1, m.wall);
      this.wallLines(ctx, L, B, H1, 2, false);
      this.wallLines(ctx, B, R, H1, 2, false);
      this.poly(ctx, [t1.T2, t1.R2, t1.B2, t1.L2], shadeHex(m.wall, 0.18), shadeHex(m.wall, -0.3));
      if (!under) this.door(ctx, B, R, H1);
      const u = this.siteRect(st, 0.2, 0.2, 0.8, 0.8, H1);
      const H2 = th * 0.62 * prog;
      const t2 = this.walls(ctx, u.T, u.R, u.B, u.L, H2, m.plaster);
      this.timberFrame(ctx, u.L, u.B, H2, m.wood);
      this.timberFrame(ctx, u.B, u.R, H2, m.wood);
      const roofH = s * hh * 0.8;
      this.gableRoof(ctx, t2, roofH, m.tile);
      const peak = this.ridgeTop(t2, roofH);
      if (!under) this.banner(ctx, peak.x, peak.y, th * 1.05, owner);
      return peak.y - th * 1.05;
    }

    if (age === 3) {
      // CASTELOS: fortim de pedra com ameias + torreta central de ardósia.
      const H1 = th * 0.95 * prog;
      const t1 = this.walls(ctx, T, R, B, L, H1, m.stone);
      this.wallLines(ctx, L, B, H1, 3, true);
      this.wallLines(ctx, B, R, H1, 3, true);
      this.poly(ctx, [t1.T2, t1.R2, t1.B2, t1.L2], shadeHex(m.stone, 0.16), shadeHex(m.stone, -0.3));
      this.crenels(ctx, t1, th * 0.2, m.stone);
      if (!under) {
        this.door(ctx, B, R, H1);
        this.windowOn(ctx, B, R, H1, 0.74);
        this.windowOn(ctx, L, B, H1, 0.45);
      }
      const u = this.siteRect(st, 0.24, 0.24, 0.76, 0.76, H1);
      const H2 = th * 0.68 * prog;
      const t2 = this.walls(ctx, u.T, u.R, u.B, u.L, H2, shadeHex(m.stone, 0.1));
      const roofH = s * hh * 0.62;
      this.hipRoof(ctx, t2, roofH, m.slate);
      const rx = (t2.T2.x + t2.B2.x) / 2;
      const ry = (t2.T2.y + t2.B2.y) / 2 - roofH;
      if (!under) this.banner(ctx, rx, ry, th * 1.1, owner);
      return ry - th * 1.1;
    }

    // IMPERIAL: paço de pedra clara, ameias, torreões nos cantos e ardósia alta.
    const H1 = th * 1.1 * prog;
    const t1 = this.walls(ctx, T, R, B, L, H1, m.stone);
    this.wallLines(ctx, L, B, H1, 3, true);
    this.wallLines(ctx, B, R, H1, 3, true);
    this.poly(ctx, [t1.T2, t1.R2, t1.B2, t1.L2], shadeHex(m.stone, 0.16), shadeHex(m.stone, -0.3));
    this.crenels(ctx, t1, th * 0.2, m.stone);
    if (!under) {
      this.door(ctx, B, R, H1);
      this.windowOn(ctx, B, R, H1, 0.72);
      this.windowOn(ctx, B, R, H1, 0.86);
      this.windowOn(ctx, L, B, H1, 0.35);
      this.windowOn(ctx, L, B, H1, 0.55);
    }
    this.turret(ctx, L.x, L.y - H1 * 0.1, hh * 0.62, H1 * 1.28, m.stone, m.slate);
    this.turret(ctx, R.x, R.y - H1 * 0.1, hh * 0.62, H1 * 1.28, m.stone, m.slate);
    const u = this.siteRect(st, 0.24, 0.24, 0.76, 0.76, H1);
    const H2 = th * 0.78 * prog;
    const t2 = this.walls(ctx, u.T, u.R, u.B, u.L, H2, m.plaster);
    if (!under) {
      this.windowOn(ctx, u.B, u.R, H2, 0.5);
      this.windowOn(ctx, u.L, u.B, H2, 0.5);
    }
    const roofH = s * hh * 0.72;
    this.hipRoof(ctx, t2, roofH, m.slate);
    const rx = (t2.T2.x + t2.B2.x) / 2;
    const ry = (t2.T2.y + t2.B2.y) / 2 - roofH;
    if (!under) this.banner(ctx, rx, ry, th * 1.25, owner);
    return ry - th * 1.25;
  }

  /** Casa: cabana redonda -> casinha de taipa -> sobrado enxaimel -> pedra com chaminé. */
  private drawHouse(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, age, m, under, prog, now, px, py, b } = st;
    const up = (p: Pt, d: number): Pt => ({ x: p.x, y: p.y - d });

    if (age === 1) {
      // TREVAS: cabana redonda de pau-a-pique com cone de palha.
      const cx = px(b.tileX + s / 2, b.tileY + s / 2);
      const cy = py(b.tileX + s / 2, b.tileY + s / 2);
      const r = s * hh * 0.78;
      const H = th * 0.48 * prog;
      this.roundHut(ctx, cx, cy, r, H, m.wall);
      const roofH = th * 0.85 * prog;
      this.coneRoof(ctx, cx, cy - H, r * 1.16, roofH, m.thatch);
      return cy - H - roofH;
    }

    if (age === 2) {
      // FEUDAL: casinha de taipa com telhado de telha de duas águas.
      const H = Math.max(5, th * 0.5) * prog;
      const top = this.walls(ctx, T, R, B, L, H, m.plaster);
      if (!under) {
        this.door(ctx, B, R, H);
        this.windowOn(ctx, L, B, H, 0.42);
      }
      const roofH = s * hh * 1.0;
      this.gableRoof(ctx, top, roofH, m.tile, true);
      return this.ridgeTop(top, roofH).y;
    }

    if (age === 3) {
      // CASTELOS: sobrado enxaimel — rodapé de pedra, vigas aparentes, telhado alto.
      const H = Math.max(6, th * 0.72) * prog;
      const top = this.walls(ctx, T, R, B, L, H, m.plaster);
      const bandH = H * 0.42;
      this.poly(ctx, [L, B, up(B, bandH), up(L, bandH)], shadeHex(m.stone, -0.35));
      this.poly(ctx, [B, R, up(R, bandH), up(B, bandH)], shadeHex(m.stone, -0.18));
      this.timberFrame(ctx, up(L, bandH), up(B, bandH), H - bandH, m.wood);
      this.timberFrame(ctx, up(B, bandH), up(R, bandH), H - bandH, m.wood);
      if (!under) {
        this.door(ctx, B, R, H);
        this.windowOn(ctx, B, R, H, 0.78);
      }
      const roofH = s * hh * 1.15;
      this.gableRoof(ctx, top, roofH, m.tile, true);
      return this.ridgeTop(top, roofH).y;
    }

    // IMPERIAL: casa de pedra clara com ardósia e chaminé fumegando.
    const H = Math.max(6, th * 0.8) * prog;
    const top = this.walls(ctx, T, R, B, L, H, m.stone);
    this.wallLines(ctx, L, B, H, 2, true);
    this.wallLines(ctx, B, R, H, 2, true);
    if (!under) {
      this.door(ctx, B, R, H);
      this.windowOn(ctx, B, R, H, 0.78);
      this.windowOn(ctx, L, B, H, 0.42);
    }
    const roofH = s * hh * 1.05;
    this.gableRoof(ctx, top, roofH, m.slate, true);
    const chX = (top.T2.x + top.R2.x) / 2;
    const chY = (top.T2.y + top.R2.y) / 2 - roofH * 0.66;
    ctx.fillStyle = shadeHex(m.stone, -0.25);
    ctx.fillRect(chX - hh * 0.11, chY - th * 0.38, hh * 0.22, th * 0.38);
    if (!under) this.smoke(ctx, chX, chY - th * 0.38, now, (b.id % 7) / 7);
    return this.ridgeTop(top, roofH).y - th * 0.2;
  }

  /** Quartel: cabana de guerra -> salão de tábuas -> forte ameado -> fortaleza. */
  private drawBarracks(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, age, m, owner, under, prog } = st;
    const lerp = (a: Pt, c: Pt, t: number): Pt => ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t });

    if (age === 1) {
      // TREVAS: cabana comprida de madeira + palha, lanças fincadas na porta.
      const H = Math.max(5, th * 0.5) * prog;
      const top = this.walls(ctx, T, R, B, L, H, m.wall);
      this.wallLines(ctx, L, B, H, 2, false);
      this.wallLines(ctx, B, R, H, 2, false);
      if (!under) this.door(ctx, B, R, H);
      const roofH = s * hh * 0.85;
      this.hipRoof(ctx, top, roofH, m.thatch);
      const rp = lerp(B, R, 0.72);
      if (!under) this.weaponRack(ctx, rp.x + hh * 0.5, rp.y + hh * 0.28, th * 0.55);
      const ry = (top.T2.y + top.B2.y) / 2 - roofH;
      if (!under) this.banner(ctx, (top.T2.x + top.B2.x) / 2, ry, th * 0.9, owner);
      return ry - th * 0.9;
    }

    if (age === 2) {
      // FEUDAL: salão de tábuas com telhado de madeira e escudo na fachada.
      const H = Math.max(6, th * 0.62) * prog;
      const top = this.walls(ctx, T, R, B, L, H, m.wall);
      this.wallLines(ctx, L, B, H, 3, false);
      this.wallLines(ctx, B, R, H, 3, false);
      if (!under) this.door(ctx, B, R, H);
      const roofH = s * hh * 0.9;
      this.gableRoof(ctx, top, roofH, shadeHex(m.wood, 0.18));
      const sp = lerp(B, R, 0.75);
      if (!under) this.shieldDecor(ctx, sp.x, sp.y - H * 0.55, hh * 0.32, owner);
      const peak = this.ridgeTop(top, roofH);
      if (!under) this.banner(ctx, peak.x, peak.y, th, owner);
      return peak.y - th;
    }

    // CASTELOS/IMPERIAL: forte de pedra de topo plano com ameias (+ torreão na 4).
    const tall = age >= 4;
    const H = th * (tall ? 1.0 : 0.85) * prog;
    const t1 = this.walls(ctx, T, R, B, L, H, tall ? m.stone : shadeHex(m.stone, -0.06));
    this.wallLines(ctx, L, B, H, 3, true);
    this.wallLines(ctx, B, R, H, 3, true);
    this.poly(ctx, [t1.T2, t1.R2, t1.B2, t1.L2], shadeHex(m.stone, 0.16), shadeHex(m.stone, -0.3));
    this.crenels(ctx, t1, th * 0.2, m.stone);
    if (!under) {
      this.door(ctx, B, R, H);
      this.windowOn(ctx, L, B, H, 0.5);
    }
    const sp = lerp(B, R, 0.75);
    if (!under) this.shieldDecor(ctx, sp.x, sp.y - H * 0.55, hh * 0.34, owner);
    // torre de menagem no fundo
    const u = this.siteRect(st, 0.12, 0.12, 0.55, 0.55, H);
    const H2 = th * (tall ? 0.55 : 0.42) * prog;
    const t2 = this.walls(ctx, u.T, u.R, u.B, u.L, H2, shadeHex(m.stone, 0.08));
    this.poly(ctx, [t2.T2, t2.R2, t2.B2, t2.L2], shadeHex(m.stone, 0.22), shadeHex(m.stone, -0.3));
    this.crenels(ctx, t2, th * 0.16, m.stone);
    if (tall) this.turret(ctx, B.x, B.y, hh * 0.7, H + th * 0.3, m.stone, m.slate);
    const bx = (t2.T2.x + t2.B2.x) / 2;
    const by = (t2.T2.y + t2.B2.y) / 2;
    if (!under) this.banner(ctx, bx, by, th * 1.05, owner);
    return by - th * 1.05;
  }

  /** Campo de arqueiros: galpão no fundo + pátio com alvo de treino. */
  private drawArcheryRange(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { th, hh, s, m, owner, under, prog, px, py, b } = st;
    const a = Math.max(2, st.age);
    const lodge = this.siteRect(st, 0, 0, 1, 0.6);
    const H = th * (a === 2 ? 0.55 : a === 3 ? 0.62 : 0.7) * prog;
    const wallColor = a >= 4 ? m.stone : a === 3 ? m.plaster : m.wall;
    const top = this.walls(ctx, lodge.T, lodge.R, lodge.B, lodge.L, H, wallColor);
    if (a === 2) {
      this.wallLines(ctx, lodge.L, lodge.B, H, 2, false);
      this.wallLines(ctx, lodge.B, lodge.R, H, 2, false);
    } else if (a === 3) {
      this.timberFrame(ctx, lodge.L, lodge.B, H, m.wood);
      this.timberFrame(ctx, lodge.B, lodge.R, H, m.wood);
    } else {
      this.wallLines(ctx, lodge.L, lodge.B, H, 2, true);
      this.wallLines(ctx, lodge.B, lodge.R, H, 2, true);
    }
    if (!under) this.door(ctx, lodge.B, lodge.R, H);
    const roofH = s * hh * (a === 2 ? 0.55 : 0.62);
    if (a === 2) this.hipRoof(ctx, top, roofH, m.thatch);
    else this.gableRoof(ctx, top, roofH, a >= 4 ? m.slate : m.tile);
    const peak = this.ridgeTop(top, roofH);
    if (!under) this.banner(ctx, peak.x, peak.y, th * 0.95, owner);
    // pátio de treino: alvo
    if (!under) {
      const tx = px(b.tileX + s * 0.28, b.tileY + s * 0.84);
      const ty = py(b.tileX + s * 0.28, b.tileY + s * 0.84);
      this.archeryTarget(ctx, tx, ty, hh * 0.42);
    }
    return peak.y - th * 0.95;
  }

  /** Estábulo: celeiro com curral cercado, feno e porteira. */
  private drawStable(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { th, hh, s, m, owner, under, prog, px, py, b } = st;
    const a = Math.max(3, st.age);
    const barn = this.siteRect(st, 0, 0, 1, 0.58);
    const H = th * (a >= 4 ? 0.72 : 0.62) * prog;
    const top = this.walls(ctx, barn.T, barn.R, barn.B, barn.L, H, a >= 4 ? m.stone : m.wall);
    if (a >= 4) {
      this.wallLines(ctx, barn.L, barn.B, H, 2, true);
      this.wallLines(ctx, barn.B, barn.R, H, 2, true);
    } else {
      this.wallLines(ctx, barn.L, barn.B, H, 3, false);
      this.wallLines(ctx, barn.B, barn.R, H, 3, false);
    }
    if (!under) this.door(ctx, barn.B, barn.R, H);
    const roofH = s * hh * 0.7;
    this.gableRoof(ctx, top, roofH, a >= 4 ? m.slate : shadeHex(m.wood, -0.08));
    const peak = this.ridgeTop(top, roofH);
    if (!under) this.banner(ctx, peak.x, peak.y, th * 0.95, owner);
    // curral na frente (cerca com porteira aberta + feno)
    if (!under) {
      const f = (fx: number, fy: number): Pt => ({
        x: px(b.tileX + fx * s, b.tileY + fy * s),
        y: py(b.tileX + fx * s, b.tileY + fy * s),
      });
      this.fence(ctx, [f(0.06, 0.62), f(0.06, 0.94), f(0.55, 0.94)], hh * 0.5, m.wood);
      this.fence(ctx, [f(0.94, 0.62), f(0.94, 0.86)], hh * 0.5, m.wood);
      this.hayPile(ctx, f(0.3, 0.8).x, f(0.3, 0.8).y, hh * 0.55);
    }
    return peak.y - th * 0.95;
  }

  /** Muralha: segmento de muro de pedra com ameias baixas — bloqueia passagem. */
  private drawWall(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, m, prog } = st;
    const H = Math.max(8, th * 1.05) * prog; // muralha mais ALTA (era 0.6, ficava baixinha)
    const t1 = this.walls(ctx, T, R, B, L, H, m.stone);
    this.wallLines(ctx, L, B, H, 2, true);
    this.wallLines(ctx, B, R, H, 2, true);
    this.poly(ctx, [t1.T2, t1.R2, t1.B2, t1.L2], shadeHex(m.stone, 0.14), shadeHex(m.stone, -0.3));
    this.crenels(ctx, t1, th * 0.14, m.stone);
    return (t1.T2.y + t1.B2.y) / 2 - th * 0.2;
  }

  /** Torre de vigia: atalaia de madeira (Feudal) -> torre de pedra ameada
   *  (Castelos) -> fortim alto com telhado (Imperial). Atira flechas. */
  private drawWatchTower(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, m, owner, under, prog } = st;
    const a = Math.max(2, st.age);

    if (a === 2) {
      // atalaia de madeira: base estreita + plataforma no alto com guarda-corpo e telhadinho
      const H = th * 1.35 * prog;
      const bpts = this.siteRect(st, 0.2, 0.2, 0.8, 0.8);
      const t1 = this.walls(ctx, bpts.T, bpts.R, bpts.B, bpts.L, H, m.wall);
      this.wallLines(ctx, bpts.L, bpts.B, H, 4, false);
      this.wallLines(ctx, bpts.B, bpts.R, H, 4, false);
      // plataforma mais larga que o corpo
      const p = this.siteRect(st, 0.05, 0.05, 0.95, 0.95, H);
      this.poly(ctx, [p.T, p.R, p.B, p.L], shadeHex(m.wood, 0.2), shadeHex(m.wood, -0.3));
      // guarda-corpo
      this.fence(ctx, [p.L, p.B, p.R], hh * 0.4, m.wood);
      // telhadinho de palha
      const rt = this.siteRect(st, 0.14, 0.14, 0.86, 0.86, H + th * 0.5);
      this.hipRoof(ctx, { T2: rt.T, R2: rt.R, B2: rt.B, L2: rt.L }, th * 0.5, m.thatch);
      const ry = (rt.T.y + rt.B.y) / 2 - th * 0.5;
      if (!under) this.banner(ctx, (rt.T.x + rt.B.x) / 2, ry, th * 0.8, owner);
      return ry - th * 0.8;
    }

    // pedra (Castelos/Imperial): torre alta com ameias; Imperial ganha telhado cônico
    const tall = a >= 4;
    const H = th * (tall ? 1.9 : 1.6) * prog;
    const t1 = this.walls(ctx, T, R, B, L, H, tall ? m.stone : shadeHex(m.stone, -0.05));
    this.wallLines(ctx, L, B, H, 5, true);
    this.wallLines(ctx, B, R, H, 5, true);
    this.poly(ctx, [t1.T2, t1.R2, t1.B2, t1.L2], shadeHex(m.stone, 0.16), shadeHex(m.stone, -0.3));
    this.crenels(ctx, t1, th * 0.18, m.stone);
    if (!under) {
      this.door(ctx, B, R, H * 0.45);
      // seteiras (fendas de flecha)
      ctx.fillStyle = '#221a10';
      const mid = (p1: Pt, p2: Pt, t: number): Pt => ({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
      for (const f of [0.35, 0.65]) {
        const p1 = mid(B, R, f);
        ctx.fillRect(p1.x - 1, p1.y - H * 0.75, 2, H * 0.2);
      }
    }
    let topY = (t1.T2.y + t1.B2.y) / 2 - th * 0.2;
    if (tall) {
      // Imperial: telhado cônico de ardósia no topo
      const cx = (t1.T2.x + t1.B2.x) / 2;
      const cy = (t1.T2.y + t1.B2.y) / 2;
      this.coneRoof(ctx, cx, cy - th * 0.1, hh * 0.85, th * 0.85, m.slate);
      topY = cy - th * 0.1 - th * 0.85;
    }
    if (!under) this.banner(ctx, (t1.T2.x + t1.B2.x) / 2, topY, th * 0.75, owner);
    return topY - th * 0.75;
  }

  /** Mercado: banca de feira — paredes baixas, toldo listrado e caixotes. */
  private drawMarket(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, m, owner, under, prog } = st;
    const a = Math.max(2, st.age);
    const H = Math.max(5, th * 0.5) * prog;
    const top = this.walls(ctx, T, R, B, L, H, a >= 4 ? m.stone : m.plaster);
    if (a >= 4) {
      this.wallLines(ctx, L, B, H, 2, true);
      this.wallLines(ctx, B, R, H, 2, true);
    } else {
      this.timberFrame(ctx, L, B, H, m.wood);
      this.timberFrame(ctx, B, R, H, m.wood);
    }
    if (!under) this.door(ctx, B, R, H);
    // toldo de feira: telhado de duas águas com LISTRAS (tecido, não telha)
    const roofH = s * hh * 0.85;
    const awning = '#c8b691';
    this.gableRoof(ctx, top, roofH, awning, true);
    // listras na água frontal-direita (entre a aresta R-B e a cumeeira)
    const g1 = { x: (top.T2.x + top.R2.x) / 2, y: (top.T2.y + top.R2.y) / 2 - roofH };
    const g2 = { x: (top.L2.x + top.B2.x) / 2, y: (top.L2.y + top.B2.y) / 2 - roofH };
    ctx.strokeStyle = 'rgba(160,70,55,0.85)';
    ctx.lineWidth = Math.max(2, hh * 0.22);
    for (const f of [0.22, 0.5, 0.78]) {
      const e1 = { x: top.R2.x + (top.B2.x - top.R2.x) * f, y: top.R2.y + (top.B2.y - top.R2.y) * f };
      const r1 = { x: g1.x + (g2.x - g1.x) * f, y: g1.y + (g2.y - g1.y) * f };
      ctx.beginPath();
      ctx.moveTo(r1.x, r1.y);
      ctx.lineTo(e1.x, e1.y);
      ctx.stroke();
    }
    if (!under) {
      // caixotes e saco de mercadoria no pátio da frente
      const cxp = (L.x + B.x) / 2 - hh * 0.5;
      const cyp = (L.y + B.y) / 2 + hh * 0.4;
      ctx.fillStyle = '#8a6a3f';
      ctx.fillRect(cxp - hh * 0.35, cyp - hh * 0.5, hh * 0.7, hh * 0.5);
      ctx.strokeStyle = '#5e4326';
      ctx.lineWidth = 1;
      ctx.strokeRect(cxp - hh * 0.35, cyp - hh * 0.5, hh * 0.7, hh * 0.5);
      this.blob(ctx, cxp + hh * 0.6, cyp - hh * 0.18, hh * 0.28, hh * 0.24, '#c8a05a', '#8a6a3f'); // saco
    }
    const peak = this.ridgeTop(top, roofH);
    if (!under) this.banner(ctx, peak.x, peak.y, th * 0.9, owner);
    return peak.y - th * 0.9;
  }

  /** Ferraria: oficina de pedra com chaminé fumegando, fornalha acesa e bigorna. */
  private drawBlacksmith(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, m, under, prog, now, b } = st;
    const a = Math.max(2, st.age);
    const H = Math.max(6, th * (0.52 + a * 0.05)) * prog;
    const top = this.walls(ctx, T, R, B, L, H, m.stone);
    this.wallLines(ctx, L, B, H, 2, true);
    this.wallLines(ctx, B, R, H, 2, true);
    if (!under) {
      this.door(ctx, B, R, H);
      this.windowOn(ctx, L, B, H, 0.4);
    }
    const roofH = s * hh * 0.72;
    this.gableRoof(ctx, top, roofH, a >= 3 ? m.slate : shadeHex(m.wood, 0.12), true);
    // chaminé no oitão do fundo, sempre fumegando (oficina acesa)
    const chX = (top.T2.x + top.R2.x) / 2;
    const chY = (top.T2.y + top.R2.y) / 2 - roofH * 0.6;
    ctx.fillStyle = '#5a5652';
    ctx.fillRect(chX - hh * 0.13, chY - th * 0.5, hh * 0.26, th * 0.5);
    if (!under) {
      this.smoke(ctx, chX, chY - th * 0.5, now, (b.id % 5) / 5);
      // fornalha: brilho quente pulsando na porta
      const dp = { x: B.x + (R.x - B.x) * 0.37, y: B.y + (R.y - B.y) * 0.37 };
      this.glow(ctx, dp.x, dp.y - H * 0.25, hh * 0.85, 0.28 + 0.07 * Math.sin(now / 280));
      // bigorna no pátio da frente
      this.anvil(ctx, (L.x + B.x) / 2 - hh * 0.45, (L.y + B.y) / 2 + hh * 0.5, hh * 0.42);
    }
    return this.ridgeTop(top, roofH).y - th * 0.5;
  }

  /** Moinho (depósito de comida): casinha de enxaimel, telhado e sacos de grão. */
  private drawMill(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, m, owner, under, prog } = st;
    const H = Math.max(5, th * 0.5) * prog;
    const top = this.walls(ctx, T, R, B, L, H, m.plaster);
    this.timberFrame(ctx, L, B, H, m.wood);
    this.timberFrame(ctx, B, R, H, m.wood);
    if (!under) this.door(ctx, B, R, H);
    const roofH = s * hh * 0.72;
    this.gableRoof(ctx, top, roofH, st.age >= 3 ? m.tile : m.thatch, true);
    if (!under) {
      // sacos de grão empilhados no pátio da frente
      const fx = (L.x + B.x) / 2, fy = (L.y + B.y) / 2 + hh * 0.4;
      this.blob(ctx, fx - hh * 0.32, fy, hh * 0.3, hh * 0.34, '#cbb079', '#8a6a3f');
      this.blob(ctx, fx + hh * 0.22, fy + hh * 0.08, hh * 0.3, hh * 0.34, '#c2a568', '#8a6a3f');
      this.blob(ctx, fx - hh * 0.04, fy - hh * 0.34, hh * 0.27, hh * 0.3, '#d3ba86', '#8a6a3f');
    }
    const peak = this.ridgeTop(top, roofH);
    if (!under) this.banner(ctx, peak.x, peak.y, th * 0.55, owner);
    return peak.y - th * 0.55;
  }

  /** Madeireira (depósito de madeira): alpendre aberto de madeira + pilha de TORAS empilhadas. */
  private drawLumberCamp(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, m, owner, under, prog } = st;
    const H = Math.max(5, th * 0.52) * prog;
    const post = (p: Pt): void => { ctx.strokeStyle = shadeHex(m.wood, -0.12); ctx.lineWidth = Math.max(2, hh * 0.17); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - H); ctx.stroke(); };
    post(T); post(L); post(R); post(B);
    const top = { T2: { x: T.x, y: T.y - H }, R2: { x: R.x, y: R.y - H }, B2: { x: B.x, y: B.y - H }, L2: { x: L.x, y: L.y - H } };
    const roofH = s * hh * 0.55;
    this.gableRoof(ctx, top, roofH, m.wood, true);
    if (!under) {
      // pilha de TORAS empilhadas (pirâmide 3-2-1) na frente — cada tora = corpo + topo claro
      const fx = (L.x + B.x) / 2, fy = (L.y + B.y) / 2 + hh * 0.58;
      const lw = hh * 0.64, lh = hh * 0.3;
      const body = shadeHex(m.wood, 0.32), edge = shadeHex(m.wood, -0.28), cap = shadeHex(m.wood, 0.62);
      const log = (lx: number, ly: number): void => {
        this.blob(ctx, lx, ly, lw * 0.5, lh * 0.5, body, edge);
        ctx.fillStyle = cap; ctx.strokeStyle = edge; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(lx - lw * 0.42, ly, lh * 0.3, lh * 0.46, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      };
      for (let i = 0; i < 3; i++) log(fx + (i - 1) * lw * 0.6, fy);
      for (let i = 0; i < 2; i++) log(fx + (i - 0.5) * lw * 0.6, fy - lh * 0.66);
      log(fx, fy - lh * 1.32);
    }
    const peak = this.ridgeTop(top, roofH);
    if (!under) this.banner(ctx, peak.x, peak.y, th * 0.5, owner);
    return peak.y - th * 0.5;
  }

  /** Campo de Mineração (depósito de ouro/pedra): abrigo de PEDRA + pilha de minério com ouro. */
  private drawMiningCamp(ctx: CanvasRenderingContext2D, st: BSite): number {
    const { T, R, B, L, th, hh, s, m, owner, under, prog } = st;
    const H = Math.max(6, th * 0.5) * prog;
    const top = this.walls(ctx, T, R, B, L, H, m.stone); // base de PEDRA — diferencia da madeireira de madeira
    this.wallLines(ctx, L, B, H, 2, true);
    this.wallLines(ctx, B, R, H, 2, true);
    this.poly(ctx, [top.T2, top.R2, top.B2, top.L2], shadeHex(m.stone, 0.12), shadeHex(m.stone, -0.3));
    const roofH = s * hh * 0.5;
    this.gableRoof(ctx, top, roofH, shadeHex(m.wood, -0.04), true);
    if (!under) this.door(ctx, B, R, H);
    if (!under) {
      // pilha de MINÉRIO (pedras) com pepitas de OURO na frente
      const fx = (L.x + B.x) / 2, fy = (L.y + B.y) / 2 + hh * 0.5;
      for (const [dx, dy, sh] of [[-0.52, 0.1, 0.06], [0.0, 0.2, -0.06], [0.52, 0.08, 0.12], [-0.26, -0.08, 0.0], [0.3, -0.05, -0.1]] as [number, number, number][]) {
        this.blob(ctx, fx + dx * hh, fy + dy * hh, hh * 0.27, hh * 0.22, shadeHex(m.stone, sh), shadeHex(m.stone, -0.4));
      }
      ctx.fillStyle = '#e8c24a';
      for (const [dx, dy] of [[-0.46, 0.06], [0.04, 0.16], [0.5, 0.05], [-0.22, -0.1]] as [number, number][]) { ctx.beginPath(); ctx.arc(fx + dx * hh, fy + dy * hh, Math.max(1.2, hh * 0.07), 0, Math.PI * 2); ctx.fill(); }
    }
    const peak = this.ridgeTop(top, roofH);
    if (!under) this.banner(ctx, peak.x, peak.y, th * 0.5, owner);
    return peak.y - th * 0.5;
  }

  /** Desenha um PNG de prédio ancorado no tile: base no canto frontal do
   *  footprint, centrado; largura = losango × fit.scale. Retorna o topo (px)
   *  aproximado para a barra de vida. */
  private drawBuildingSprite(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    b: BuildingSnap,
    s: number,
    img: HTMLImageElement,
    fit: SpriteFit,
  ): number {
    const hw = 2 * hh; // ISO_HW = 2 * ISO_HH
    const groundW = 2 * s * hw; // largura do losango do footprint em px
    const drawW = groundW * fit.scale;
    const drawH = drawW * (img.height / img.width);
    const cx = px(b.tileX + s / 2, b.tileY + s / 2);
    const baseY = py(b.tileX + s, b.tileY + s) + hh * fit.dropY; // canto frontal + ajuste
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, cx - drawW / 2, baseY - drawH, drawW, drawH);
    ctx.imageSmoothingEnabled = prevSmooth;
    return baseY - drawH;
  }

  private drawBuilding(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    b: BuildingSnap,
    selected: boolean,
    now: number,
    alphaMul = 1, // < 1 => fantasma de posicionamento
  ): void {
    const def = BUILDING_DEFS[b.type];
    if (!def) return;
    const s = def.size;
    const owner = this.gs.colorOf(b.owner);
    const under = (b.progress ?? 1) < 1;
    const prog = under ? clamp01(b.progress) : 1;
    const th = 2 * hh; // altura de 1 tile em px
    // era do dono define o estilo (prédios ficam mais robustos a cada era)
    const age = Math.min(4, Math.max(1, this.gs.playerSnaps.get(b.owner)?.age ?? 1));

    const T: Pt = { x: px(b.tileX, b.tileY), y: py(b.tileX, b.tileY) };
    const R: Pt = { x: px(b.tileX + s, b.tileY), y: py(b.tileX + s, b.tileY) };
    const B: Pt = { x: px(b.tileX + s, b.tileY + s), y: py(b.tileX + s, b.tileY + s) };
    const L: Pt = { x: px(b.tileX, b.tileY + s), y: py(b.tileX, b.tileY + s) };
    const cxTile = b.tileX + s / 2;
    const cyTile = b.tileY + s / 2;

    if (selected) {
      this.isoDiamond(ctx, px, py, b.tileX - 0.05, b.tileY - 0.05, s + 0.1);
      ctx.strokeStyle = b.owner === this.gs.you ? '#f5f0e0' : '#e08585';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // sombra no chão (fantasma não projeta sombra)
    if (alphaMul >= 1) this.poly(ctx, [T, R, B, L], 'rgba(0,0,0,0.13)');

    ctx.globalAlpha = (under ? 0.6 : 1) * alphaMul;
    let topY: number;
    // Se há um SPRITE (PNG) pra este prédio e ele está concluído, desenha a
    // imagem no lugar da arte procedural (obra em andamento usa a procedural,
    // pra mostrar o andaime). Ausente => cai no desenho por código.
    const spr = under ? null : this.sprites.get(b.type, age);
    if (spr) {
      topY = this.drawBuildingSprite(ctx, px, py, hh, b, s, spr.img, spr.fit);
    } else {
      const site: BSite = { px, py, T, R, B, L, hh, th, s, age, m: AGE_MATS[age], owner, under, prog, b, now };
      switch (b.type) {
        case 'farm': topY = this.drawFarm(ctx, site); break;
        case 'town_center': topY = this.drawTownCenter(ctx, site); break;
        case 'barracks': topY = this.drawBarracks(ctx, site); break;
        case 'archery_range': topY = this.drawArcheryRange(ctx, site); break;
        case 'stable': topY = this.drawStable(ctx, site); break;
        case 'blacksmith': topY = this.drawBlacksmith(ctx, site); break;
        case 'market': topY = this.drawMarket(ctx, site); break;
        case 'wall': topY = this.drawWall(ctx, site); break;
        case 'watch_tower': topY = this.drawWatchTower(ctx, site); break;
        case 'mill': topY = this.drawMill(ctx, site); break;
        case 'lumber_camp': topY = this.drawLumberCamp(ctx, site); break;
        case 'mining_camp': topY = this.drawMiningCamp(ctx, site); break;
        default: topY = this.drawHouse(ctx, site); break;
      }
    }
    ctx.globalAlpha = 1;

    // flash de dano no prédio (losango da base pisca em vermelho, some em ~200ms)
    const hitT = this.gs.lastHit.get(b.id);
    if (hitT !== undefined) {
      const f = 1 - (now - hitT) / 200;
      if (f > 0) {
        this.isoDiamond(ctx, px, py, b.tileX, b.tileY, s);
        ctx.fillStyle = `rgba(255,90,70,${0.3 * f * f})`;
        ctx.fill();
      }
    }

    // andaimes de madeira enquanto está em obra: postes nos cantos + travessa
    if (under) {
      const poleH = th * 0.95;
      ctx.strokeStyle = '#8a6a3f';
      ctx.lineWidth = Math.max(1.4, hh * 0.16);
      ctx.lineCap = 'round';
      for (const c of [T, R, B, L]) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x, c.y - poleH);
        ctx.stroke();
      }
      const crossY = poleH * 0.62;
      ctx.beginPath();
      ctx.moveTo(T.x, T.y - crossY);
      ctx.lineTo(R.x, R.y - crossY);
      ctx.lineTo(B.x, B.y - crossY);
      ctx.lineTo(L.x, L.y - crossY);
      ctx.closePath();
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // barra de progresso / vida (acima do ponto mais alto); prédio selecionado
    // mostra a vida SEMPRE, mesmo intacto (como no AoE2)
    const topx = px(cxTile, cyTile);
    const barY = topY - 8;
    const bw = Math.max(20, s * hh * 1.6);
    if (under) {
      this.bar(ctx, topx - bw / 2, barY, bw, 5, prog, '#e8c95d');
    } else if (selected || b.hp < def.hp) {
      const frac = clamp01(b.hp / def.hp);
      this.bar(ctx, topx - bw / 2, barY, bw, 5, frac, hpColor(frac));
    }
  }

  private drawRally(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    b: BuildingSnap,
  ): void {
    if (b.rallyX === undefined || b.rallyY === undefined) return;
    const def = BUILDING_DEFS[b.type];
    if (!def || def.trains.length === 0) return;
    const fx = px(b.rallyX, b.rallyY);
    const fy = py(b.rallyX, b.rallyY);
    ctx.strokeStyle = '#efe8d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - hh * 2.2);
    ctx.stroke();
    ctx.fillStyle = this.gs.colorOf(b.owner);
    ctx.beginPath();
    ctx.moveTo(fx, fy - hh * 2.2);
    ctx.lineTo(fx + hh * 1.1, fy - hh * 1.9);
    ctx.lineTo(fx, fy - hh * 1.6);
    ctx.closePath();
    ctx.fill();
  }

  /** Efeitos de combate: flechas em voo, mortes (tombo + sangue), escombros de
   *  prédio e números de dano. Tudo leve, dirigido pelos deltas de snapshot e
   *  pelo relógio `now` (nada acumula: as listas são podadas no applySnapshot). */
  private drawCombatFx(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    cam: Camera,
    now: number,
  ): void {
    const onScreen = (sx: number, sy: number): boolean =>
      sx > -70 && sy > -90 && sx < cam.viewW + 70 && sy < cam.viewH + 70;

    // --- mortes: poça de sangue no chão + boneco tombando e sumindo ---
    for (const d of this.gs.deaths) {
      const u = d.unit;
      const age = (now - d.at) / 1100;
      if (age < 0 || age >= 1) continue;
      const sx = px(u.x, u.y);
      const sy = py(u.x, u.y);
      if (!onScreen(sx, sy)) continue;
      const U = hh * (u.type === 'knight' ? 1.15 : u.type === 'villager' ? 0.82 : 0.95);
      const bloodA = 0.5 * (1 - age) * Math.min(1, age * 6);
      ctx.fillStyle = `rgba(120,22,20,${bloodA})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, U * (0.5 + age * 0.9), U * (0.22 + age * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
      const ease = 1 - (1 - Math.min(1, age * 2.2)) ** 2; // tomba rápido, depois some
      const dir = u.id & 1 ? 1 : -1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 0.45) / 0.55);
      ctx.translate(sx, sy);
      // ~49° (não 86°): lê como corpo caindo, não "cabeça no chão".
      ctx.rotate(dir * ease * 0.85);
      ctx.translate(-sx, -sy);
      this.drawUnitBody(ctx, u, sx, sy, U, now);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // --- prédios destruídos: escombros + baforadas de fumaça subindo ---
    for (const w of this.gs.wrecks) {
      const b = w.building;
      const age = (now - w.at) / 2300;
      if (age < 0 || age >= 1) continue;
      const s = BUILDING_DEFS[b.type]?.size ?? 1;
      const sx = px(b.tileX + s / 2, b.tileY + s / 2);
      const sy = py(b.tileX + s / 2, b.tileY + s / 2);
      if (!onScreen(sx, sy)) continue;
      const U = hh * s;
      ctx.globalAlpha = 1 - age;
      this.rock(ctx, sx - U * 0.3, sy - U * 0.08, U * 0.34, U * 0.26, '#7d7a74', '#9c988f');
      this.rock(ctx, sx + U * 0.28, sy, U * 0.3, U * 0.22, '#726f69', '#948f86');
      this.rock(ctx, sx, sy - U * 0.02, U * 0.36, U * 0.26, '#83807a', '#a6a199');
      ctx.globalAlpha = 1;
      for (let i = 0; i < 3; i++) {
        const t = (age + i * 0.33) % 1;
        const smA = 0.32 * (1 - t) * Math.min(1, t * 5) * (1 - age);
        if (smA <= 0) continue;
        ctx.fillStyle = `rgba(70,66,60,${smA})`;
        ctx.beginPath();
        ctx.ellipse(sx + (i - 1) * U * 0.22, sy - t * U * 2.4 - U * 0.3, U * (0.28 + t * 0.4), U * (0.24 + t * 0.36), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // --- flechas em voo (arco parabólico) — desenha uma flecha em progresso p ---
    const flight = 280;
    const drawArrow = (ax: number, ay: number, bxp: number, byp: number, p: number): void => {
      const arcAt = (q: number): [number, number] => [
        ax + (bxp - ax) * q,
        ay + (byp - ay) * q - Math.sin(q * Math.PI) * hh * 1.6,
      ];
      const [cxp, cyp] = arcAt(p);
      if (!onScreen(cxp, cyp)) return;
      const [cx2, cy2] = arcAt(Math.min(1, p + 0.05));
      const ang = Math.atan2(cy2 - cyp, cx2 - cxp);
      const len = hh * 0.6;
      ctx.strokeStyle = '#33291b';
      ctx.lineWidth = Math.max(1, hh * 0.09);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cxp - Math.cos(ang) * len, cyp - Math.sin(ang) * len);
      ctx.lineTo(cxp, cyp);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#e6e0cf';
      ctx.beginPath();
      ctx.arc(cxp, cyp, Math.max(1, hh * 0.1), 0, Math.PI * 2);
      ctx.fill();
    };

    // arqueiros atacando disparam periodicamente
    const archerCd = (UNIT_DEFS.archer?.attackCooldown ?? 2) * 1000;
    for (const u of this.gs.units.values()) {
      if (u.state !== 'attacking' || u.type !== 'archer' || u.targetId == null) continue;
      const tgt = this.gs.units.get(u.targetId) ?? this.gs.buildings.get(u.targetId);
      if (!tgt) continue;
      const phase = (now + u.id * 137) % archerCd;
      if (phase >= flight) continue;
      const a = this.gs.unitPos(u, now);
      let txw: number;
      let tyw: number;
      if ('tileX' in tgt) {
        const ts = BUILDING_DEFS[tgt.type]?.size ?? 1;
        txw = tgt.tileX + ts / 2;
        tyw = tgt.tileY + ts / 2;
      } else {
        const tp = this.gs.unitPos(tgt, now);
        txw = tp.x;
        tyw = tp.y;
      }
      drawArrow(px(a.x, a.y), py(a.x, a.y) - hh * 0.9, px(txw, tyw), py(txw, tyw) - hh * 0.7, phase / flight);
    }

    // prédios de defesa atirando (torre de vigia + Centro da Cidade; alvo vem no
    // snapshot em b.targetId; a flecha sai do alto do prédio). Guarnecido = uma
    // salva de 1+N flechas (N = unidades dentro).
    for (const b of this.gs.buildings.values()) {
      const def = DEFENSE_DEFS[b.type];
      if (!def || (b.progress ?? 1) < 1 || b.targetId == null) continue;
      const tgt = this.gs.units.get(b.targetId);
      if (!tgt) continue;
      const tp = this.gs.unitPos(tgt, now);
      const size = BUILDING_DEFS[b.type]?.size ?? 1;
      const ax = px(b.tileX + size / 2, b.tileY + size / 2);
      // topo do prédio (o Centro da Cidade é bem maior que a torre)
      const ay = py(b.tileX + size / 2, b.tileY + size / 2) - hh * (b.type === 'town_center' ? 3.6 : 3.2);
      const cd = def.cooldown * 1000;
      const arrows = 1 + (b.garrison ?? 0);
      for (let k = 0; k < arrows; k++) {
        const phase = (now + b.id * 137 + k * 90) % cd; // defasa a salva
        if (phase >= flight) continue;
        drawArrow(ax, ay, px(tp.x, tp.y), py(tp.x, tp.y) - hh * 0.7, phase / flight);
      }
    }

    // badge de GUARNIÇÃO: quantas unidades estão dentro da torre/Centro
    for (const b of this.gs.buildings.values()) {
      if (!b.garrison) continue;
      const size = BUILDING_DEFS[b.type]?.size ?? 1;
      const bx = px(b.tileX + size / 2, b.tileY + size / 2);
      const by = py(b.tileX + size / 2, b.tileY + size / 2) - hh * (b.type === 'town_center' ? 3.3 : 2.9);
      ctx.fillStyle = 'rgba(20,16,10,0.82)';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(7, hh * 0.55), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(230,190,90,0.9)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#f4e4c8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.max(9, Math.round(hh * 0.72))}px Georgia, serif`;
      ctx.fillText(String(b.garrison), bx, by + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // --- números de dano flutuantes ---
    if (this.gs.hits.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.max(10, Math.round(hh * 0.85))}px Georgia, serif`;
      ctx.lineWidth = 2;
      for (const h of this.gs.hits) {
        const age = (now - h.at) / 800;
        if (age < 0 || age >= 1) continue;
        const sx = px(h.x, h.y);
        const sy = py(h.x, h.y) - hh * 1.6 - age * hh * 1.4; // subida proporcional ao zoom
        if (!onScreen(sx, sy)) continue;
        ctx.globalAlpha = 0.9 * (1 - age);
        const txt = `-${Math.max(1, Math.round(h.amount))}`;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(txt, sx, sy);
        ctx.fillStyle = '#f2e4d8';
        ctx.fillText(txt, sx, sy);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /** Era do dono (1..4) — controla o "equipamento" visual das unidades. */
  private ownerAge(owner: number): number {
    return Math.min(4, Math.max(1, this.gs.playerSnaps.get(owner)?.age ?? 1));
  }

  /** Só o "corpo" da unidade (sem sombra/seleção/vida), reusado na morte. */
  private drawUnitBody(ctx: CanvasRenderingContext2D, u: UnitSnap, sx: number, sy: number, U: number, now: number): void {
    const color = this.gs.colorOf(u.owner);
    const dark = shadeHex(color, -0.45);
    const skin = '#e2b48a';
    const steel = '#c9ccd2';
    const age = this.ownerAge(u.owner);
    if (u.type === 'villager') this.figVillager(ctx, sx, sy, U, color, dark, skin, u, now, false, 1, null, age);
    else if (u.type === 'swordsman') this.figSwordsman(ctx, sx, sy, U, color, dark, skin, steel, age);
    else if (u.type === 'archer') this.figArcher(ctx, sx, sy, U, color, dark, skin, age);
    else if (u.type === 'knight') this.figKnight(ctx, sx, sy, U, color, dark, skin, steel, age);
  }

  // ---------- unidades (figuras isométricas) ----------

  private limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, w);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string, stroke?: string): void {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private block(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, fill: string, stroke?: string): void {
    ctx.fillStyle = fill;
    ctx.fillRect(cx - w / 2, cy - h / 2, Math.max(1, w), Math.max(1, h));
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(cx - w / 2, cy - h / 2, Math.max(1, w), Math.max(1, h)); }
  }

  private faceDetail(ctx: CanvasRenderingContext2D, cx: number, cy: number, U: number, dir = 1): void {
    if (U < 10) return;
    const r = Math.max(0.65, U * 0.035);
    ctx.fillStyle = '#251d18'; ctx.beginPath();
    ctx.arc(cx + dir * U * 0.06, cy - U * 0.025, r, 0, Math.PI * 2);
    ctx.arc(cx + dir * U * 0.17, cy - U * 0.015, r, 0, Math.PI * 2); ctx.fill();
  }

  /** Ovelha (estilo AoE): lã branca; selvagem sem dono, anel da cor do dono
   *  quando convertida; barrinha de comida quando sendo abatida. */
  private drawSheep(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    s: SheepSnap,
    wx: number,
    wy: number,
    selected: boolean,
  ): void {
    const sx = px(wx, wy);
    const sy = py(wx, wy);
    const U = hh * 0.62;
    const wild = this.gs.isWildSheep(s);

    this.blob(ctx, sx, sy, U * 0.7, U * 0.32, 'rgba(0,0,0,0.22)'); // sombra

    if (!wild) {
      // anel da cor do dono (posse) — some no selvagem (branca neutra)
      ctx.strokeStyle = this.gs.colorOf(s.owner);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, U * 0.8, U * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, U * 0.94, U * 0.46, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // patas
    for (const dx of [-0.3, -0.1, 0.1, 0.3]) {
      this.block(ctx, sx + dx * U, sy - U * 0.02, Math.max(1, U * 0.08), U * 0.22, '#4a4038');
    }

    // corpo de lã (branco) — vários blobs sobrepostos
    const bodyY = sy - U * 0.42;
    const wool = '#f4f2ee';
    const woolSh = '#d6d2ca';
    this.blob(ctx, sx - U * 0.32, bodyY + U * 0.05, U * 0.26, U * 0.24, wool, woolSh);
    this.blob(ctx, sx + U * 0.28, bodyY + U * 0.03, U * 0.28, U * 0.26, wool, woolSh);
    this.blob(ctx, sx - U * 0.04, bodyY - U * 0.22, U * 0.3, U * 0.24, wool, woolSh);
    this.blob(ctx, sx, bodyY, U * 0.52, U * 0.4, wool, woolSh);

    // cabeça escura voltada pra +x
    const hx = sx + U * 0.5;
    const hy = bodyY + U * 0.05;
    this.blob(ctx, hx, hy, U * 0.2, U * 0.17, '#3a332c');
    this.blob(ctx, hx + U * 0.13, hy + U * 0.03, U * 0.08, U * 0.09, '#2b251f');

    // barra de comida quando sendo abatida
    if (s.food < SHEEP_FOOD - 0.5) {
      const w = U * 1.1;
      const h = Math.max(2, U * 0.12);
      const bx = sx - w / 2;
      const by = bodyY - U * 0.6;
      const r = Math.max(0, Math.min(1, s.food / SHEEP_FOOD));
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, by, w, h);
      ctx.fillStyle = '#6bbf59';
      ctx.fillRect(bx, by, w * r, h);
    }
  }

  private drawUnit(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    u: UnitSnap,
    wx: number,
    wy: number,
    selected: boolean,
    now: number,
  ): void {
    const sx = px(wx, wy);
    const sy = py(wx, wy);
    const mounted = u.type === 'knight';
    const U = hh * (mounted ? 1.15 : u.type === 'villager' ? 0.82 : 0.95);
    const color = this.gs.colorOf(u.owner);
    const dark = shadeHex(color, -0.45);
    const skin = '#e2b48a';
    const steel = '#c9ccd2';

    const moving =
      u.state === 'moving' || u.state === 'movingToGather' || u.state === 'movingToBuild' ||
      u.state === 'movingToAttack' || u.state === 'returning';
    const attacking = u.state === 'attacking';

    // direção que a unidade encara (para onde trabalha/ataca), em X de tela
    let face = 1;
    if (u.targetId != null) {
      const nd = this.gs.nodes.get(u.targetId);
      const bd = this.gs.buildings.get(u.targetId);
      const tu = this.gs.units.get(u.targetId);
      let tsx = sx;
      if (nd) tsx = px(nd.tileX + 0.5, nd.tileY + 0.5);
      else if (bd) { const bs = BUILDING_DEFS[bd.type]?.size ?? 1; tsx = px(bd.tileX + bs / 2, bd.tileY + bs / 2); }
      else if (tu) tsx = px(tu.x, tu.y);
      face = tsx >= sx ? 1 : -1;
    }
    // ferramenta conforme a ação
    let tool: 'axe' | 'pick' | 'hand' | 'hammer' | null = null;
    if (u.state === 'gathering') {
      const nd = this.gs.nodes.get(u.targetId ?? -1);
      tool = nd?.type === 'gold_mine' || nd?.type === 'stone_mine' ? 'pick' : nd?.type === 'tree' ? 'axe' : 'hand';
    } else if (u.state === 'building') {
      tool = 'hammer';
    }

    // sombra
    this.blob(ctx, sx, sy, U * (mounted ? 1.35 : 0.85), U * 0.42, 'rgba(0,0,0,0.24)');

    // anel de seleção
    if (selected) {
      ctx.strokeStyle = u.owner === this.gs.you ? '#f8f4e6' : '#e08585';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, U * (mounted ? 1.55 : 1.1), U * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const age = this.ownerAge(u.owner);
    if (u.type === 'villager') {
      this.figVillager(ctx, sx, sy, U, color, dark, skin, u, now, moving, face, tool, age);
    } else {
      // militares: leve saltito ao andar e avanço ao atacar (corpo inteiro)
      let fx = sx;
      let fy = sy;
      if (moving) fy = sy - Math.abs(Math.sin(now * 0.012 + u.id)) * 0.14 * U;
      if (attacking) fx = sx + face * Math.max(0, Math.sin(now * 0.011 + u.id)) * 0.3 * U;
      if (u.type === 'swordsman') this.figSwordsman(ctx, fx, fy, U, color, dark, skin, steel, age);
      else if (u.type === 'archer') this.figArcher(ctx, fx, fy, U, color, dark, skin, age);
      else if (u.type === 'knight') this.figKnight(ctx, fx, fy, U, color, dark, skin, steel, age);
    }

    // flash claro de impacto ao levar dano (some em ~200ms)
    const hitT = this.gs.lastHit.get(u.id);
    if (hitT !== undefined) {
      const f = 1 - (now - hitT) / 200;
      if (f > 0) {
        // tinta quente breve (não branco), com ease-out (f*f) => pico curto
        ctx.fillStyle = `rgba(255,176,132,${0.3 * f * f})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy - U * 1.05, U * 0.5, U * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // barra de vida (vida máxima inclui os upgrades do dono); selecionado
    // mostra SEMPRE, mesmo com vida cheia (como no AoE2)
    const ownerTechs = this.gs.playerSnaps.get(u.owner)?.techs;
    const maxHp = (UNIT_DEFS[u.type]?.hp ?? u.hp) + (ownerTechs ? techBonus(ownerTechs, u.type).hp : 0);
    if (selected || u.hp < maxHp) {
      const bw = Math.max(16, U * 2.2);
      const frac = clamp01(u.hp / maxHp);
      this.bar(ctx, sx - bw / 2, sy - U * (mounted ? 3.4 : 2.7), bw, 4, frac, hpColor(frac));
    }
  }

  private figVillager(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number, U: number,
    color: string, dark: string, skin: string,
    u: UnitSnap, now: number, moving: boolean,
    face: number, tool: 'axe' | 'pick' | 'hand' | 'hammer' | null,
    age: number,
  ): void {
    const ph = now * 0.012 + u.id * 1.7; // fase da passada (offset por unidade)
    const working = tool !== null;

    // pernas: passada ao andar (pés no chão, deslize alternado)
    const legC = age <= 1 ? '#6b5340' : age === 2 ? '#5a4632' : age === 3 ? '#4c3e30' : '#3f3a34';
    const stride = moving ? Math.sin(ph) * 0.16 * U : 0;
    this.limb(ctx, sx - 0.16 * U, sy - 0.72 * U, sx - 0.18 * U + stride, sy, 0.15 * U, legC);
    this.limb(ctx, sx + 0.16 * U, sy - 0.72 * U, sx + 0.18 * U - stride, sy, 0.15 * U, legC);

    // tronco com leve balanço vertical ao andar (pés ficam, corpo sobe/desce)
    const by = sy - (moving ? Math.abs(Math.sin(ph)) * 0.07 * U : 0);
    // túnica: trapos rústicos na era 1, tecido tingido depois
    const tunic = age <= 1 ? shadeHex(color, -0.18) : color;
    this.block(ctx, sx, by - 1.0 * U, 0.66 * U, 0.92 * U, tunic, dark);
    if (age >= 3) {
      // cinto de couro
      this.limb(ctx, sx - 0.28 * U, by - 0.88 * U, sx + 0.28 * U, by - 0.88 * U, 0.09 * U, '#4a3520');
    }
    if (age >= 4) {
      // gola clara (roupa de cidade)
      this.blob(ctx, sx, by - 1.4 * U, 0.18 * U, 0.08 * U, '#e8e0cc');
    }

    // braço esquerdo (parado)
    this.limb(ctx, sx - 0.28 * U, by - 1.2 * U, sx - 0.38 * U, by - 0.82 * U, 0.13 * U, tunic);

    // braço direito + ferramenta
    const shX = sx + face * 0.16 * U;
    const shY = by - 1.22 * U;
    if (working) {
      // golpe: ângulo phi a partir do "pra cima", girando na direção do rosto
      const swing = Math.sin(now * 0.009 + u.id * 2.3); // -1..1
      const phi = -0.5 + 2.25 * ((swing + 1) / 2); // -0.5 (erguido) .. 1.75 (batido)
      const armLen = 0.42 * U;
      const toolLen = 0.5 * U;
      const handX = shX + face * Math.sin(phi) * armLen;
      const handY = shY - Math.cos(phi) * armLen;
      this.limb(ctx, shX, shY, handX, handY, 0.13 * U, tunic); // braço
      if (tool === 'hand') {
        this.blob(ctx, handX, handY, 0.1 * U, 0.1 * U, skin, dark); // mão colhendo
      } else {
        const tipX = handX + face * Math.sin(phi) * toolLen;
        const tipY = handY - Math.cos(phi) * toolLen;
        this.limb(ctx, handX, handY, tipX, tipY, 0.09 * U, '#6b4a2f'); // cabo
        const head = tool === 'hammer' ? '#8a8f97' : '#b8bcc4';
        this.blob(ctx, tipX, tipY, 0.14 * U, 0.12 * U, head, '#6a6e76'); // cabeça
      }
    } else {
      // parado/andando: picareta encostada no ombro (pose de descanso)
      this.limb(ctx, shX, shY, sx + face * 0.42 * U, by - 0.95 * U, 0.13 * U, tunic);
      this.limb(ctx, sx + face * 0.42 * U, by - 0.95 * U, sx + face * 0.5 * U, by - 1.7 * U, 0.08 * U, '#6b4a2f');
      this.limb(ctx, sx + face * 0.4 * U, by - 1.68 * U, sx + face * 0.62 * U, by - 1.62 * U, 0.08 * U, '#8a8f97');
    }

    // cabeça
    this.block(ctx, sx, by - 1.5 * U, 0.44 * U, 0.48 * U, skin, dark);
    this.faceDetail(ctx, sx, by - 1.5 * U, U, face);
    // cobertura por era: cabelo -> chapéu de palha -> touca de couro -> feltro
    if (age <= 1) {
      this.blob(ctx, sx, by - 1.66 * U, 0.22 * U, 0.13 * U, '#5a4328');
    } else if (age === 2) {
      this.blob(ctx, sx, by - 1.62 * U, 0.34 * U, 0.12 * U, '#c8a05a');
      this.blob(ctx, sx, by - 1.72 * U, 0.16 * U, 0.14 * U, '#c8a05a');
    } else if (age === 3) {
      this.blob(ctx, sx, by - 1.64 * U, 0.25 * U, 0.16 * U, '#7a5836', '#4a3520');
    } else {
      this.blob(ctx, sx, by - 1.62 * U, 0.3 * U, 0.09 * U, '#3f3a34');
      this.blob(ctx, sx, by - 1.73 * U, 0.16 * U, 0.14 * U, '#3f3a34');
    }

    // carga ao voltar com recurso (do lado oposto ao trabalho)
    if ((u.carryAmount ?? 0) > 0 && u.carryType) {
      this.blob(ctx, sx - face * 0.42 * U, by - 1.35 * U, 0.17 * U, 0.17 * U, RESOURCE_COLORS[u.carryType] ?? '#fff', 'rgba(0,0,0,0.4)');
    }
  }

  /** Espadachim — linha de milícia do AoE2: milícia (sem elmo, escudo de
   *  madeira) -> homem de armas (elmo de aço) -> espada longa (cota de malha,
   *  escudo grande) -> campeão (placas, ombreiras e pluma). */
  private figSwordsman(ctx: CanvasRenderingContext2D, sx: number, sy: number, U: number, color: string, dark: string, skin: string, steel: string, age: number): void {
    const steelD = '#8a8f97';
    const legC = age >= 3 ? '#3a3a40' : '#4a3c2e';
    this.limb(ctx, sx - 0.2 * U, sy - 0.7 * U, sx - 0.24 * U, sy, 0.16 * U, legC);
    this.limb(ctx, sx + 0.2 * U, sy - 0.7 * U, sx + 0.24 * U, sy, 0.16 * U, legC);

    // torso por era
    if (age <= 1) {
      this.block(ctx, sx, sy - 1.05 * U, 0.72 * U, 0.98 * U, color, dark); // túnica simples
    } else if (age === 2) {
      this.block(ctx, sx, sy - 1.05 * U, 0.76 * U, 1.02 * U, color, dark); // gambesão
      this.limb(ctx, sx, sy - 1.32 * U, sx, sy - 0.76 * U, 0.14 * U, shadeHex(color, -0.25)); // faixa
    } else if (age === 3) {
      this.block(ctx, sx, sy - 1.05 * U, 0.76 * U, 1.02 * U, '#9aa0a8', '#6a6e76'); // cota de malha
      this.limb(ctx, sx, sy - 1.36 * U, sx, sy - 0.72 * U, 0.26 * U, color); // tabardo
    } else {
      this.block(ctx, sx, sy - 1.05 * U, 0.8 * U, 1.06 * U, steel, '#6a6e76'); // placas
      this.limb(ctx, sx, sy - 1.38 * U, sx, sy - 0.7 * U, 0.24 * U, color); // tabardo
      this.blob(ctx, sx - 0.36 * U, sy - 1.36 * U, 0.14 * U, 0.12 * U, steel, steelD); // ombreiras
      this.blob(ctx, sx + 0.36 * U, sy - 1.36 * U, 0.14 * U, 0.12 * U, steel, steelD);
    }

    // Escudo angular: aro, umbo e faixa heráldica sem aumentar sua área.
    const shx = sx - 0.45 * U, shy = sy - 1.02 * U;
    const shieldEdge = age <= 1 ? '#5e4326' : steelD;
    this.poly(ctx, [
      { x: shx - 0.23 * U, y: shy - 0.31 * U }, { x: shx + 0.23 * U, y: shy - 0.31 * U },
      { x: shx + 0.21 * U, y: shy + 0.12 * U }, { x: shx, y: shy + 0.36 * U },
      { x: shx - 0.21 * U, y: shy + 0.12 * U },
    ], age <= 1 ? '#8a6a3f' : shadeHex(color, 0.08), shieldEdge);
    this.limb(ctx, shx - 0.15 * U, shy - 0.17 * U, shx + 0.14 * U, shy + 0.16 * U, 0.055 * U, age <= 1 ? '#b18a50' : steel);
    this.blob(ctx, shx, shy, 0.065 * U, 0.075 * U, age <= 1 ? '#6c5232' : steel, shieldEdge);

    // braço + espada (lâmina cresce com a era)
    const armC = age >= 4 ? steel : age === 3 ? '#9aa0a8' : color;
    this.limb(ctx, sx + 0.3 * U, sy - 1.2 * U, sx + 0.5 * U, sy - 1.5 * U, 0.14 * U, armC);
    const blade = age <= 1 ? 0.6 : age === 2 ? 0.8 : age === 3 ? 0.95 : 1.1;
    this.limb(ctx, sx + 0.5 * U, sy - 1.45 * U, sx + (0.5 + 0.12 * blade / 0.8) * U, sy - (1.45 + blade) * U, 0.11 * U, steel); // lâmina
    this.limb(ctx, sx + 0.4 * U, sy - 1.5 * U, sx + 0.62 * U, sy - 1.42 * U, 0.09 * U, '#5a4632'); // guarda

    // cabeça por era: cabelo -> capacete -> elmo com nasal -> elmo com pluma
    this.blob(ctx, sx, sy - 1.6 * U, 0.24 * U, 0.26 * U, skin, dark);
    this.faceDetail(ctx, sx, sy - 1.6 * U, U);
    if (age <= 1) {
      this.blob(ctx, sx, sy - 1.74 * U, 0.22 * U, 0.13 * U, '#5a4328'); // cabelo
    } else if (age === 2) {
      this.blob(ctx, sx, sy - 1.72 * U, 0.28 * U, 0.2 * U, steel, dark); // capacete
    } else {
      this.blob(ctx, sx, sy - 1.72 * U, 0.28 * U, 0.22 * U, steel, steelD); // elmo fechado
      this.limb(ctx, sx, sy - 1.68 * U, sx, sy - 1.48 * U, 0.05 * U, '#9aa0a8'); // nasal
      if (age >= 4) this.limb(ctx, sx, sy - 1.9 * U, sx + 0.1 * U, sy - 2.14 * U, 0.09 * U, color); // pluma
    }
  }

  /** Arqueiro: capuz e arco simples -> besteiro de couro -> arbalesteiro com
   *  elmo, pluma e arco recurvo reforçado. (Só existe a partir do Feudal.) */
  private figArcher(ctx: CanvasRenderingContext2D, sx: number, sy: number, U: number, color: string, dark: string, skin: string, age: number): void {
    const a = Math.max(2, age);
    const steel = '#c9ccd2';
    this.limb(ctx, sx - 0.16 * U, sy - 0.7 * U, sx - 0.2 * U, sy, 0.14 * U, '#4a4033');
    this.limb(ctx, sx + 0.16 * U, sy - 0.7 * U, sx + 0.2 * U, sy, 0.14 * U, '#4a4033');

    // corpo: tecido -> couro com faixa -> couro com ombreira de aço
    if (a === 2) {
      this.block(ctx, sx, sy - 1.02 * U, 0.62 * U, 0.98 * U, color, dark);
    } else {
      this.block(ctx, sx, sy - 1.02 * U, 0.64 * U, 1.0 * U, '#7a5836', '#4a3520'); // couro
      this.limb(ctx, sx - 0.24 * U, sy - 1.34 * U, sx + 0.24 * U, sy - 0.86 * U, 0.12 * U, color); // faixa a tiracolo
      if (a >= 4) this.blob(ctx, sx - 0.3 * U, sy - 1.32 * U, 0.13 * U, 0.11 * U, steel, '#8a8f97'); // ombreira
    }

    // aljava nas costas
    this.limb(ctx, sx + 0.22 * U, sy - 1.5 * U, sx + 0.32 * U, sy - 0.9 * U, 0.12 * U, '#6b4a2f');
    this.limb(ctx, sx + 0.26 * U, sy - 1.55 * U, sx + 0.24 * U, sy - 1.7 * U, 0.05 * U, '#d8d2c0');
    this.limb(ctx, sx + 0.31 * U, sy - 1.52 * U, sx + 0.31 * U, sy - 1.68 * U, 0.05 * U, '#d8d2c0');

    // cabeça: capuz -> touca de couro -> elmo com pluma
    this.blob(ctx, sx, sy - 1.55 * U, 0.23 * U, 0.25 * U, skin, dark);
    this.faceDetail(ctx, sx, sy - 1.55 * U, U, -1);
    if (a === 2) {
      this.blob(ctx, sx - 0.02 * U, sy - 1.66 * U, 0.27 * U, 0.18 * U, shadeHex(color, -0.2));
    } else if (a === 3) {
      this.blob(ctx, sx, sy - 1.66 * U, 0.25 * U, 0.16 * U, '#7a5836', '#4a3520');
      this.limb(ctx, sx + 0.18 * U, sy - 1.78 * U, sx + 0.3 * U, sy - 1.9 * U, 0.05 * U, color); // pena
    } else {
      this.blob(ctx, sx, sy - 1.68 * U, 0.26 * U, 0.19 * U, steel, '#8a8f97');
      this.limb(ctx, sx, sy - 1.84 * U, sx + 0.1 * U, sy - 2.06 * U, 0.08 * U, color); // pluma
    }

    // arco: simples -> maior -> recurvo com pontas de aço
    const bowR = a === 2 ? 0.5 : a === 3 ? 0.56 : 0.6;
    ctx.strokeStyle = a >= 4 ? '#4a3520' : '#6b4a2f';
    ctx.lineWidth = Math.max(1.4, (a >= 3 ? 0.11 : 0.09) * U);
    ctx.beginPath();
    ctx.arc(sx - 0.34 * U, sy - 1.05 * U, bowR * U, -1.15, 1.15);
    ctx.stroke();
    if (a >= 4) {
      // pontas recurvas de aço
      const bx = sx - 0.34 * U;
      const byc = sy - 1.05 * U;
      this.limb(ctx, bx + Math.cos(-1.15) * bowR * U, byc + Math.sin(-1.15) * bowR * U, bx + Math.cos(-1.35) * (bowR + 0.08) * U, byc + Math.sin(-1.35) * (bowR + 0.08) * U, 0.06 * U, steel);
      this.limb(ctx, bx + Math.cos(1.15) * bowR * U, byc + Math.sin(1.15) * bowR * U, bx + Math.cos(1.35) * (bowR + 0.08) * U, byc + Math.sin(1.35) * (bowR + 0.08) * U, 0.06 * U, steel);
    }
    this.limb(ctx, sx - 0.14 * U, sy - 1.5 * U, sx - 0.14 * U, sy - 0.6 * U, 0.03 * U, '#efe8d8'); // corda
  }

  /** Cavaleiro (Castelos): cavalo com manta na cor do dono. Paladino
   *  (Imperial): cavalo blindado — caparazão completo, testeira de aço,
   *  cavaleiro de placas e flâmula na lança. (Só existe a partir de Castelos.) */
  private figKnight(ctx: CanvasRenderingContext2D, sx: number, sy: number, U: number, color: string, dark: string, skin: string, steel: string, age: number): void {
    const a = Math.max(3, age);
    const paladin = a >= 4;
    const horse = '#6b4a2f';
    const horseD = '#4e3620';
    const bodyC = paladin ? color : horse;   // caparazão cobre o corpo no Imperial
    const bodyD = paladin ? dark : horseD;
    this.limb(ctx, sx - 0.5 * U, sy - 0.55 * U, sx - 0.55 * U, sy, 0.12 * U, horseD); // perna tras.
    this.limb(ctx, sx - 0.28 * U, sy - 0.5 * U, sx - 0.3 * U, sy, 0.12 * U, horseD);
    this.limb(ctx, sx - 0.72 * U, sy - 0.85 * U, sx - 0.95 * U, sy - 0.15 * U, 0.1 * U, horseD); // rabo
    this.blob(ctx, sx - 0.05 * U, sy - 0.78 * U, 0.72 * U, 0.4 * U, bodyC, bodyD); // corpo do cavalo
    if (paladin) {
      // barra clara do caparazão (bainha)
      ctx.strokeStyle = '#e8e0cc';
      ctx.lineWidth = Math.max(1, 0.06 * U);
      ctx.beginPath();
      ctx.ellipse(sx - 0.05 * U, sy - 0.78 * U, 0.72 * U, 0.4 * U, 0, 0.35, Math.PI - 0.35);
      ctx.stroke();
    }
    this.limb(ctx, sx + 0.45 * U, sy - 0.55 * U, sx + 0.5 * U, sy, 0.12 * U, horse); // perna diant.
    this.limb(ctx, sx + 0.23 * U, sy - 0.5 * U, sx + 0.25 * U, sy, 0.12 * U, horse);
    this.limb(ctx, sx + 0.55 * U, sy - 0.95 * U, sx + 0.82 * U, sy - 1.35 * U, 0.22 * U, paladin ? color : horse); // pescoço
    this.blob(ctx, sx + 0.9 * U, sy - 1.42 * U, 0.22 * U, 0.14 * U, horse, horseD); // cabeça
    if (paladin) {
      // testeira de aço (chanfron)
      this.blob(ctx, sx + 0.94 * U, sy - 1.44 * U, 0.16 * U, 0.1 * U, steel, '#8a8f97');
    }
    this.limb(ctx, sx + 0.82 * U, sy - 1.5 * U, sx + 0.86 * U, sy - 1.62 * U, 0.05 * U, horseD); // orelha
    if (!paladin) {
      // manta de sela na cor do dono (Castelos)
      this.blob(ctx, sx - 0.05 * U, sy - 1.02 * U, 0.42 * U, 0.2 * U, color, dark);
    }
    this.blob(ctx, sx - 0.05 * U, sy - 1.1 * U, 0.3 * U, 0.12 * U, paladin ? '#3a3a40' : dark); // sela
    // cavaleiro: tabardo (Castelos) ou placas de aço (Imperial)
    this.blob(ctx, sx - 0.1 * U, sy - 1.5 * U, 0.3 * U, 0.42 * U, paladin ? steel : color, paladin ? '#8a8f97' : dark);
    if (paladin) this.limb(ctx, sx - 0.1 * U, sy - 1.66 * U, sx - 0.1 * U, sy - 1.3 * U, 0.14 * U, color); // tabardo
    this.limb(ctx, sx + 0.05 * U, sy - 1.6 * U, sx + 0.2 * U, sy - 1.45 * U, 0.12 * U, paladin ? steel : color); // braço
    this.limb(ctx, sx - 0.2 * U, sy - 1.4 * U, sx + 1.0 * U, sy - 2.05 * U, 0.07 * U, '#8a6a3f'); // lança
    this.limb(ctx, sx + 0.95 * U, sy - 2.0 * U, sx + 1.05 * U, sy - 2.12 * U, 0.06 * U, steel); // ponta
    if (paladin) {
      // flâmula na lança
      this.poly(ctx, [
        { x: sx + 0.74 * U, y: sy - 1.92 * U },
        { x: sx + 0.98 * U, y: sy - 2.14 * U },
        { x: sx + 0.98 * U, y: sy - 1.92 * U },
      ], color, dark);
    }
    this.blob(ctx, sx - 0.1 * U, sy - 1.95 * U, 0.22 * U, 0.24 * U, skin, dark); // cabeça
    this.blob(ctx, sx - 0.1 * U, sy - 2.06 * U, 0.26 * U, 0.18 * U, steel, paladin ? '#8a8f97' : dark); // elmo
    const plume = paladin ? 0.34 : 0.25;
    this.limb(ctx, sx - 0.1 * U, sy - 2.2 * U, sx - 0.02 * U, sy - (2.2 + plume) * U, 0.09 * U, color); // pluma
  }

  // ---------- extras ----------

  /** Feedback visual das ordens do botão direito: anéis que encolhem no chão
   *  (mover) e pulso colorido acompanhando o alvo (coletar=verde,
   *  construir=amarelo, atacar=vermelho). Cada marcador dura ~0,9s. */
  private drawOrders(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    ui: UIState,
    now: number,
  ): void {
    const DUR = 900;
    const orders = ui.orders;
    for (let i = orders.length - 1; i >= 0; i--) {
      if (now - orders[i].at >= DUR) orders.splice(i, 1);
    }
    for (const o of orders) {
      const t = (now - o.at) / DUR;
      const a = 1 - t;
      if (o.kind === 'move') {
        // dois anéis concêntricos encolhendo até o ponto de destino
        const sx = px(o.x, o.y);
        const sy = py(o.x, o.y);
        ctx.strokeStyle = `rgba(240,244,230,${0.85 * a})`;
        ctx.lineWidth = 2;
        for (const ph of [0, 0.35]) {
          const q = Math.min(1, t + ph);
          const r = hh * 1.7 * (1 - q);
          if (r <= 1) continue;
          ctx.beginPath();
          ctx.ellipse(sx, sy, r * 2, r, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }
      // pulso no alvo (acompanha o alvo enquanto ele existir)
      const color = o.kind === 'attack' ? '255,107,94' : o.kind === 'build' ? '232,201,93' : '143,220,122';
      ctx.strokeStyle = `rgba(${color},${0.95 * a})`;
      ctx.lineWidth = 2.5;
      const pulse = 1 + 0.22 * Math.sin(t * Math.PI * 3) * (1 - t);
      const bld = o.targetId !== undefined ? this.gs.buildings.get(o.targetId) : undefined;
      const nd = bld ? undefined : o.targetId !== undefined ? this.gs.nodes.get(o.targetId) : undefined;
      const un = bld || nd ? undefined : o.targetId !== undefined ? this.gs.units.get(o.targetId) : undefined;
      if (bld) {
        const s = BUILDING_DEFS[bld.type]?.size ?? 1;
        const half = (s / 2) * pulse;
        this.isoDiamond(ctx, px, py, bld.tileX + s / 2 - half, bld.tileY + s / 2 - half, half * 2);
        ctx.stroke();
      } else if (nd) {
        const half = 0.62 * pulse;
        this.isoDiamond(ctx, px, py, nd.tileX + 0.5 - half, nd.tileY + 0.5 - half, half * 2);
        ctx.stroke();
      } else if (un) {
        const p = this.gs.unitPos(un, now);
        ctx.beginPath();
        ctx.ellipse(px(p.x, p.y), py(p.x, p.y), hh * 1.25 * pulse, hh * 0.62 * pulse, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // alvo sumiu: pulso no ponto clicado mesmo
        const half = 0.5 * pulse;
        this.isoDiamond(ctx, px, py, o.x - half, o.y - half, half * 2);
        ctx.stroke();
      }
    }
  }

  /** Fantasma de posicionamento: o terreno ocupado pintado de verde/vermelho e
   *  o PRÓPRIO prédio translúcido em cima — o que você vê é o que será
   *  construído, exatamente naquele lugar. */
  private drawGhost(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    cam: Camera,
    ui: UIState,
    now: number,
  ): void {
    const type = ui.placement;
    if (!type || !ui.hasMouse) return;
    if (!BUILDING_DEFS[type]) return;

    // Muralha em ARRASTO: prévia da LINHA inteira (só nos tiles livres — os
    // ocupados por prédio/água são pulados, viram parte do muro).
    if (type === 'wall' && ui.wallDrag) {
      for (const t of wallLineTiles(ui.wallDrag, ghostTile(ui, cam, 'wall'))) {
        if (this.gs.canPlace('wall', t.x, t.y)) this.drawGhostAt(ctx, px, py, hh, 'wall', t.x, t.y, now);
      }
      return;
    }

    const t = ghostTile(ui, cam, type);
    this.drawGhostAt(ctx, px, py, hh, type, t.x, t.y, now);
  }

  /** Um fantasma de posicionamento num tile: diamante verde/vermelho + o prédio
   *  translúcido em cima. */
  private drawGhostAt(
    ctx: CanvasRenderingContext2D,
    px: (x: number, y: number) => number,
    py: (x: number, y: number) => number,
    hh: number,
    type: BuildingType,
    tileX: number,
    tileY: number,
    now: number,
  ): void {
    const def = BUILDING_DEFS[type];
    if (!def) return;
    const valid = this.gs.canPlace(type, tileX, tileY);

    // terreno ocupado (embaixo do prédio, mostra válido/inválido)
    this.isoDiamond(ctx, px, py, tileX, tileY, def.size);
    ctx.fillStyle = valid ? 'rgba(90,205,100,0.3)' : 'rgba(225,75,60,0.38)';
    ctx.fill();
    ctx.strokeStyle = valid ? 'rgba(120,230,130,0.95)' : 'rgba(240,95,80,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // prédio real translúcido (mesma arte do jogo, na era atual)
    const ghost: BuildingSnap = {
      id: -1,
      owner: this.gs.you,
      type,
      tileX,
      tileY,
      hp: def.hp,
      progress: 1,
      queue: [],
    };
    this.drawBuilding(ctx, px, py, hh, ghost, false, now, valid ? 0.55 : 0.35);
  }

  private bar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    frac: number,
    color: string,
  ): void {
    ctx.fillStyle = 'rgba(10,8,6,0.8)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a3128';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp01(frac), h);
  }
}
