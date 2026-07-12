// Estado da partida no cliente: mapas por id derivados do último snapshot,
// snapshot anterior para interpolação visual e seleção atual.
// O servidor é autoritativo — aqui só se armazena e se lê.

import type {
  BuildingSnap,
  BuildingType,
  MapData,
  MarketPrices,
  NodeSnap,
  NodeType,
  PlayerInfo,
  PlayerSnap,
  SheepSnap,
  UnitSnap,
  UnitType,
} from '@age/shared';
import { BUILDING_DEFS, SHEEP_WILD_OWNER, SNAPSHOT_TICKS, TICK_MS, TILE_GRASS } from '@age/shared';

export const SNAP_INTERVAL_MS = SNAPSHOT_TICKS * TICK_MS;

export interface SnapshotData {
  tick: number;
  units: UnitSnap[];
  buildings: BuildingSnap[];
  nodes: NodeSnap[];
  sheep: SheepSnap[];
  players: PlayerSnap[];
  /** Preços do mercado (ouro por lote de 100) — globais da sala. */
  market?: MarketPrices;
}

export type PickResult =
  | { kind: 'unit'; unit: UnitSnap }
  | { kind: 'building'; building: BuildingSnap }
  | { kind: 'node'; node: NodeSnap }
  | { kind: 'sheep'; sheep: SheepSnap };

/** Raio visual/de clique de uma unidade, em tiles. */
export function unitRadius(type: UnitType): number {
  if (type === 'villager') return 0.28;
  if (type === 'knight') return 0.44;
  return 0.35;
}

export class GameState {
  readonly map: MapData;
  readonly players: PlayerInfo[];
  readonly you: number;

  units = new Map<number, UnitSnap>();
  buildings = new Map<number, BuildingSnap>();
  nodes = new Map<number, NodeSnap>();
  sheep = new Map<number, SheepSnap>();
  playerSnaps = new Map<number, PlayerSnap>();
  /** Preços do mercado (ouro por lote de 100), atualizados por snapshot. */
  marketPrices: MarketPrices = { food: 100, wood: 100, stone: 100 };

  /** Ids selecionados (unidades próprias, ou 1 prédio, ou 1 entidade para info). */
  selection = new Set<number>();

  tick = 0;
  hasSnapshot = false;
  /** performance.now() de quando o último/penúltimo snapshot chegou. */
  snapTime = 0;

  private prevPos = new Map<number, { x: number; y: number }>();
  /** Nós que sumiram do snapshot (recurso esgotou) — para a animação de queda. */
  removedNodes: { node: NodeSnap; at: number }[] = [];
  /** Ovelhas que sumiram (comidas) — para o "poof". */
  removedSheep: { sheep: SheepSnap; at: number }[] = [];
  /** Números de dano flutuantes (x,y em tile; quantidade; timestamp ms). */
  hits: { x: number; y: number; amount: number; at: number }[] = [];
  /** id -> timestamp do último dano recebido (para o flash de impacto). */
  lastHit = new Map<number, number>();
  /** Unidades que morreram (sumiram do snapshot) — para a animação de morte. */
  deaths: { unit: UnitSnap; at: number }[] = [];
  /** Prédios destruídos — para escombros + fumaça. */
  wrecks: { building: BuildingSnap; at: number }[] = [];
  /** Prédios que já levaram dano — distingue destruição real de fazenda esgotada
   *  (que some sem dano e NÃO deve fumegar). */
  private hurtBuildings = new Set<number>();

  constructor(map: MapData, players: PlayerInfo[], you: number) {
    this.map = map;
    this.players = Array.isArray(players) ? players : [];
    this.you = you;
  }

  colorOf(owner: number): string {
    return this.players.find((p) => p.id === owner)?.color ?? '#9ca3af';
  }

  nameOf(owner: number): string {
    return this.players.find((p) => p.id === owner)?.name ?? '???';
  }

  me(): PlayerSnap | undefined {
    return this.playerSnaps.get(this.you);
  }

  applySnapshot(snap: SnapshotData): void {
    // Guarda posições atuais para interpolar até as novas.
    this.prevPos.clear();
    for (const u of this.units.values()) this.prevPos.set(u.id, { x: u.x, y: u.y });
    for (const s of this.sheep.values()) this.prevPos.set(s.id, { x: s.x, y: s.y });
    this.snapTime = performance.now();

    this.tick = typeof snap.tick === 'number' ? snap.tick : this.tick;
    if (snap.market) this.marketPrices = snap.market;

    // --- deltas de combate (dano/morte) comparando com o snapshot anterior ---
    const now = this.snapTime;
    const newUnits = new Map<number, UnitSnap>();
    for (const u of Array.isArray(snap.units) ? snap.units : []) {
      if (u && typeof u.id === 'number') newUnits.set(u.id, u);
    }
    for (const [id, old] of this.units) {
      const nu = newUnits.get(id);
      if (!nu) {
        this.deaths.push({ unit: old, at: now });
      } else if (nu.hp < old.hp) {
        this.hits.push({ x: nu.x, y: nu.y, amount: old.hp - nu.hp, at: now });
        this.lastHit.set(id, now);
      }
    }
    const newBuildings = new Map<number, BuildingSnap>();
    for (const b of Array.isArray(snap.buildings) ? snap.buildings : []) {
      if (b && typeof b.id === 'number') newBuildings.set(b.id, b);
    }
    for (const [id, old] of this.buildings) {
      const nb = newBuildings.get(id);
      if (!nb) {
        // só é "destruído" (escombros/fumaça) se levou dano; fazenda que esgota
        // some sem nunca perder hp e não deve fumegar.
        if (this.hurtBuildings.has(id)) this.wrecks.push({ building: old, at: now });
        this.hurtBuildings.delete(id);
      } else if (nb.hp < old.hp) {
        const sz = BUILDING_DEFS[nb.type]?.size ?? 1;
        this.hits.push({ x: nb.tileX + sz / 2, y: nb.tileY + sz / 2, amount: old.hp - nb.hp, at: now });
        this.lastHit.set(id, now);
        this.hurtBuildings.add(id);
      }
    }
    // envelhece as listas de efeitos (curtas — nada acumula)
    if (this.hits.length) this.hits = this.hits.filter((h) => h.at > now - 850);
    if (this.deaths.length) this.deaths = this.deaths.filter((d) => d.at > now - 1200);
    if (this.wrecks.length) this.wrecks = this.wrecks.filter((w) => w.at > now - 2400);
    for (const [id, t] of this.lastHit) if (t <= now - 220) this.lastHit.delete(id);

    this.units.clear();
    for (const u of Array.isArray(snap.units) ? snap.units : []) {
      if (u && typeof u.id === 'number') this.units.set(u.id, u);
    }
    this.buildings.clear();
    for (const b of Array.isArray(snap.buildings) ? snap.buildings : []) {
      if (b && typeof b.id === 'number') this.buildings.set(b.id, b);
    }
    // Detecta nós que sumiram (esgotaram) comparando com o snapshot anterior,
    // para a animação de queda/afundar. Envelhece a lista (mantém ~1,3s).
    const newNodeIds = new Set<number>();
    for (const n of Array.isArray(snap.nodes) ? snap.nodes : []) {
      if (n && typeof n.id === 'number') newNodeIds.add(n.id);
    }
    for (const [id, n] of this.nodes) {
      if (!newNodeIds.has(id)) this.removedNodes.push({ node: n, at: this.snapTime });
    }
    this.removedNodes = this.removedNodes.filter((r) => r.at > this.snapTime - 1300);

    this.nodes.clear();
    for (const n of Array.isArray(snap.nodes) ? snap.nodes : []) {
      if (n && typeof n.id === 'number') this.nodes.set(n.id, n);
    }
    // Ovelhas que sumiram (comidas) → "poof".
    const newSheepIds = new Set<number>();
    for (const s of Array.isArray(snap.sheep) ? snap.sheep : []) {
      if (s && typeof s.id === 'number') newSheepIds.add(s.id);
    }
    for (const [id, s] of this.sheep) {
      if (!newSheepIds.has(id)) this.removedSheep.push({ sheep: s, at: this.snapTime });
    }
    this.removedSheep = this.removedSheep.filter((r) => r.at > this.snapTime - 900);
    this.sheep.clear();
    for (const s of Array.isArray(snap.sheep) ? snap.sheep : []) {
      if (s && typeof s.id === 'number') this.sheep.set(s.id, s);
    }
    this.playerSnaps.clear();
    for (const p of Array.isArray(snap.players) ? snap.players : []) {
      if (p && typeof p.id === 'number') this.playerSnaps.set(p.id, p);
    }

    // Remove da seleção entidades que deixaram de existir.
    for (const id of [...this.selection]) {
      if (!this.units.has(id) && !this.buildings.has(id) && !this.nodes.has(id) && !this.sheep.has(id)) {
        this.selection.delete(id);
      }
    }

    this.hasSnapshot = true;
  }

  /** Posição interpolada da unidade para renderização. */
  unitPos(u: UnitSnap, now: number): { x: number; y: number } {
    const prev = this.prevPos.get(u.id);
    if (!prev) return { x: u.x, y: u.y }; // entidade nova: já na posição atual
    let t = (now - this.snapTime) / SNAP_INTERVAL_MS;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: prev.x + (u.x - prev.x) * t, y: prev.y + (u.y - prev.y) * t };
  }

  /** Posição interpolada de uma ovelha (parada na Fase 1; anda na Fase 2). */
  sheepPos(s: SheepSnap, now: number): { x: number; y: number } {
    const prev = this.prevPos.get(s.id);
    if (!prev) return { x: s.x, y: s.y };
    let t = (now - this.snapTime) / SNAP_INTERVAL_MS;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: prev.x + (s.x - prev.x) * t, y: prev.y + (s.y - prev.y) * t };
  }

  /** true se a ovelha é selvagem (branca, sem dono). */
  isWildSheep(s: SheepSnap): boolean {
    return s.owner === SHEEP_WILD_OWNER;
  }

  tileAt(tx: number, ty: number): number {
    const size = this.map.size;
    if (tx < 0 || ty < 0 || tx >= size || ty >= size) return -1;
    const v = this.map.tiles[ty * size + tx];
    return typeof v === 'number' ? v : -1;
  }

  myTownCenter(): BuildingSnap | undefined {
    for (const b of this.buildings.values()) {
      if (b.owner === this.you && b.type === 'town_center') return b;
    }
    return undefined;
  }

  /** Unidades selecionadas que existem e são do próprio jogador. */
  selectedOwnUnits(): UnitSnap[] {
    const out: UnitSnap[] = [];
    for (const id of this.selection) {
      const u = this.units.get(id);
      if (u && u.owner === this.you) out.push(u);
    }
    return out;
  }

  /** Prédio selecionado (a seleção de prédio é sempre única). */
  selectedBuilding(): BuildingSnap | undefined {
    for (const id of this.selection) {
      const b = this.buildings.get(id);
      if (b) return b;
    }
    return undefined;
  }

  selectedNode(): NodeSnap | undefined {
    for (const id of this.selection) {
      const n = this.nodes.get(id);
      if (n) return n;
    }
    return undefined;
  }

  /** Ovelha selecionada (para o painel de info). */
  selectedSheep(): SheepSnap | undefined {
    for (const id of this.selection) {
      const s = this.sheep.get(id);
      if (s) return s;
    }
    return undefined;
  }

  /** Ovelhas próprias selecionadas (pastoreio, Fase 2). */
  selectedOwnSheep(): SheepSnap[] {
    const out: SheepSnap[] = [];
    for (const id of this.selection) {
      const s = this.sheep.get(id);
      if (s && s.owner === this.you) out.push(s);
    }
    return out;
  }

  /** A seleção atual contém apenas unidades do próprio jogador? */
  selectionIsOwnUnits(): boolean {
    if (this.selection.size === 0) return false;
    for (const id of this.selection) {
      const u = this.units.get(id);
      if (!u || u.owner !== this.you) return false;
    }
    return true;
  }

  /** Entidade sob o ponto do mundo (unidade > prédio > nó) — clique "VISUAL":
   *  os objetos são desenhados PARA CIMA a partir da base e, na projeção
   *  isométrica 2:1, subir na tela equivale a andar na diagonal (+x,+y) do
   *  mundo. Então o clique acerta um objeto se a linha (wx+k, wy+k), com k de
   *  0 até a altura visual dele, passa pela base — dá pra clicar no corpo do
   *  boneco e na copa da árvore, não só no pezinho. */
  pickAt(wx: number, wy: number, now: number): PickResult | null {
    const UNIT_H = 1.4; // altura visual das unidades (em k do mundo)
    let bestUnit: UnitSnap | null = null;
    let bestD2 = Infinity;
    for (const u of this.units.values()) {
      const pos = this.unitPos(u, now);
      const r = unitRadius(u.type) + 0.2;
      // ponto da linha diagonal mais próximo do pé do boneco
      const t = Math.max(0, Math.min(UNIT_H, ((pos.x - wx) + (pos.y - wy)) / 2));
      const dx = pos.x - (wx + t);
      const dy = pos.y - (wy + t);
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bestD2) {
        bestD2 = d2;
        bestUnit = u;
      }
    }
    if (bestUnit) return { kind: 'unit', unit: bestUnit };

    // Ovelhas (depois das unidades: um boneco em cima tem prioridade de clique).
    let bestSheep: SheepSnap | null = null;
    let bestSD2 = Infinity;
    for (const s of this.sheep.values()) {
      const pos = this.sheepPos(s, now);
      const r = 0.55;
      const t = Math.max(0, Math.min(0.6, ((pos.x - wx) + (pos.y - wy)) / 2));
      const dx = pos.x - (wx + t);
      const dy = pos.y - (wy + t);
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bestSD2) {
        bestSD2 = d2;
        bestSheep = s;
      }
    }
    if (bestSheep) return { kind: 'sheep', sheep: bestSheep };

    // a linha diagonal cruza o retângulo [x0..x1]×[y0..y1] para algum k ≤ maxK?
    const diagHit = (x0: number, y0: number, x1: number, y1: number, maxK: number): boolean => {
      const lo = Math.max(x0 - wx, y0 - wy, -0.05);
      const hi = Math.min(x1 - wx, y1 - wy, maxK);
      return lo <= hi;
    };

    const B_H: Partial<Record<BuildingType, number>> = { farm: 0.2, house: 1.7, town_center: 3.2, wall: 0.9, watch_tower: 3.4, market: 2.0, mill: 1.6, lumber_camp: 1.4, mining_camp: 1.4 };
    for (const b of this.buildings.values()) {
      const size = BUILDING_DEFS[b.type]?.size ?? 1;
      if (diagHit(b.tileX, b.tileY, b.tileX + size, b.tileY + size, B_H[b.type] ?? 2.5)) {
        return { kind: 'building', building: b };
      }
    }

    const N_H: Record<NodeType, number> = { tree: 1.9, berry_bush: 0.4, gold_mine: 0.9, stone_mine: 0.9 };
    for (const n of this.nodes.values()) {
      if (diagHit(n.tileX, n.tileY, n.tileX + 1, n.tileY + 1, N_H[n.type] ?? 0.5)) {
        return { kind: 'node', node: n };
      }
    }
    return null;
  }

  /**
   * Pré-validação de posicionamento de prédio (o servidor revalida):
   * dentro do mapa, todos os tiles de grama, sem sobrepor prédios ou nós.
   */
  canPlace(type: BuildingType, tileX: number, tileY: number): boolean {
    const def = BUILDING_DEFS[type];
    if (!def) return false;
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return false;
    const s = def.size;
    const mapSize = this.map.size;
    if (tileX < 0 || tileY < 0 || tileX + s > mapSize || tileY + s > mapSize) return false;
    for (let ty = tileY; ty < tileY + s; ty++) {
      for (let tx = tileX; tx < tileX + s; tx++) {
        if (this.tileAt(tx, ty) !== TILE_GRASS) return false;
      }
    }
    for (const b of this.buildings.values()) {
      const bs = BUILDING_DEFS[b.type]?.size ?? 1;
      if (tileX < b.tileX + bs && b.tileX < tileX + s && tileY < b.tileY + bs && b.tileY < tileY + s) {
        return false;
      }
    }
    for (const n of this.nodes.values()) {
      if (n.tileX >= tileX && n.tileX < tileX + s && n.tileY >= tileY && n.tileY < tileY + s) {
        return false;
      }
    }
    return true;
  }
}
