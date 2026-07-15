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
import {
  BUILDING_DEFS,
  BUILDING_VISION,
  BUILDING_VISION_DEFAULT,
  POP_CAP_MAX,
  SHEEP_VISION,
  SHEEP_WILD_OWNER,
  SNAPSHOT_TICKS,
  TICK_MS,
  TILE_GRASS,
  TILE_WATER,
  UNIT_DEFS,
  isNavalUnit,
} from '@age/shared';
import { FogOfWar } from './game/fog';

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
  private sheepFacingDirs = new Map<number, { x: number; y: number }>();
  private unitFacings = new Map<number, 1 | -1>();
  /** Direção de movimento dos BARCOS (vetor no mundo): a proa gira de verdade
   *  (nada de andar de lado). O ângulo desenhado é suavizado no renderer. */
  private boatFacingDirs = new Map<number, { x: number; y: number }>();
  /** Nós que sumiram do snapshot (recurso esgotou) — para a animação de queda. */
  removedNodes: { node: NodeSnap; at: number }[] = [];
  /** Ovelhas que sumiram (comidas) — para o "poof". */
  removedSheep: { sheep: SheepSnap; at: number }[] = [];
  /** Sinalizações (ping) recebidas de aliados — anel pulsante no minimapa. */
  pings: { x: number; y: number; at: number; color: string }[] = [];
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

  /** Névoa de guerra (só apresentação; o servidor continua mandando tudo). */
  readonly fog: FogOfWar;
  /** Donos cuja visão eu compartilho: eu + aliados do mesmo time (>0). */
  readonly alliedOwners: Set<number>;

  constructor(map: MapData, players: PlayerInfo[], you: number, fogEnabled = false) {
    this.map = map;
    this.players = Array.isArray(players) ? players : [];
    this.you = you;
    this.fog = new FogOfWar(map.size);
    // Mapa ABERTO (padrão): revela tudo de uma vez. Aí toda a lógica de névoa
    // continua funcionando, só que sempre "à vista" — custo e efeito zero.
    if (!fogEnabled) this.fog.revealAll();
    this.alliedOwners = new Set([you]);
    const myTeam = this.players.find((p) => p.id === you)?.team ?? 0;
    if (myTeam > 0) {
      for (const p of this.players) if (p.team === myTeam) this.alliedOwners.add(p.id);
    }
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

  // ------------------------------------------------------------- névoa
  // Regras de aparição (usadas por renderer, minimapa e clique):
  // unidades/ovelhas móveis exigem tile À VISTA; prédios/nós valem com
  // EXPLORADO (ficam como "lembrança" escurecida, estilo AoE).

  unitVisible(u: UnitSnap): boolean {
    if (this.alliedOwners.has(u.owner)) return true;
    return this.fog.isVisible(Math.floor(u.x), Math.floor(u.y));
  }

  sheepVisible(s: SheepSnap): boolean {
    if (!this.isWildSheep(s) && this.alliedOwners.has(s.owner)) return true;
    return this.fog.isVisible(Math.floor(s.x), Math.floor(s.y));
  }

  buildingVisible(b: BuildingSnap): boolean {
    if (this.alliedOwners.has(b.owner)) return true;
    const s = BUILDING_DEFS[b.type]?.size ?? 1;
    return this.fog.isExplored(Math.floor(b.tileX + s / 2), Math.floor(b.tileY + s / 2));
  }

  nodeVisible(n: NodeSnap): boolean {
    return this.fog.isExplored(n.tileX, n.tileY);
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
      if (u && typeof u.id === 'number') {
        newUnits.set(u.id, u);
        const prev = this.prevPos.get(u.id);
        if (prev) {
          const dx = u.x - prev.x;
          const dy = u.y - prev.y;
          const screenDx = dx - dy;
          const screenDy = (dx + dy) * 0.5;
          // Quase vertical na tela mantém a orientação anterior, evitando piscar.
          if (Math.abs(screenDx) > Math.max(0.0001, Math.abs(screenDy) * 0.2)) {
            this.unitFacings.set(u.id, screenDx > 0 ? 1 : -1);
          }
          // Barcos: guarda o VETOR do deslocamento (a proa aponta pra onde vai).
          if (isNavalUnit(u.type) && dx * dx + dy * dy > 0.000001) {
            const f = this.boatFacingDirs.get(u.id);
            if (f) { f.x = dx; f.y = dy; }
            else this.boatFacingDirs.set(u.id, { x: dx, y: dy });
          }
        }
      }
    }
    for (const [id, old] of this.units) {
      const nu = newUnits.get(id);
      if (!nu) {
        this.deaths.push({ unit: old, at: now });
        this.unitFacings.delete(id);
        this.boatFacingDirs.delete(id);
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
      if (s && typeof s.id === 'number') {
        newSheepIds.add(s.id);
        const prev = this.prevPos.get(s.id);
        if (prev) {
          const dx = s.x - prev.x;
          const dy = s.y - prev.y;
          if (dx * dx + dy * dy > 0.000001) {
            const facing = this.sheepFacingDirs.get(s.id);
            if (facing) { facing.x = dx; facing.y = dy; }
            else this.sheepFacingDirs.set(s.id, { x: dx, y: dy });
          }
        }
      }
    }
    for (const [id, s] of this.sheep) {
      if (!newSheepIds.has(id)) {
        this.removedSheep.push({ sheep: s, at: this.snapTime });
        this.sheepFacingDirs.delete(id);
      }
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

    // --- névoa de guerra: recalcula a visão a partir do snapshot novo ---
    const sources: { x: number; y: number; r: number }[] = [];
    for (const u of this.units.values()) {
      if (!this.alliedOwners.has(u.owner)) continue;
      sources.push({ x: u.x, y: u.y, r: UNIT_DEFS[u.type]?.sight ?? 5 });
    }
    for (const b of this.buildings.values()) {
      if (!this.alliedOwners.has(b.owner)) continue;
      const sz = BUILDING_DEFS[b.type]?.size ?? 1;
      // canteiro de obra enxerga pouco; prédio pronto usa o raio da tabela
      const r = (b.progress ?? 1) >= 1 ? BUILDING_VISION[b.type] ?? BUILDING_VISION_DEFAULT : 2;
      sources.push({ x: b.tileX + sz / 2, y: b.tileY + sz / 2, r });
    }
    for (const sp of this.sheep.values()) {
      if (this.isWildSheep(sp) || !this.alliedOwners.has(sp.owner)) continue;
      sources.push({ x: sp.x, y: sp.y, r: SHEEP_VISION });
    }
    this.fog.recompute(sources);

    // Poda da seleção quem ficou escondido pela névoa (sem painel espião).
    // Prédio inimigo segue a regra do clique: só continua selecionado À VISTA.
    for (const id of [...this.selection]) {
      const su = this.units.get(id);
      if (su && !this.unitVisible(su)) { this.selection.delete(id); continue; }
      const ss = this.sheep.get(id);
      if (ss && !this.sheepVisible(ss)) { this.selection.delete(id); continue; }
      const sb = this.buildings.get(id);
      if (sb && !this.alliedOwners.has(sb.owner)) {
        const bsz = BUILDING_DEFS[sb.type]?.size ?? 1;
        if (!this.fog.isVisible(Math.floor(sb.tileX + bsz / 2), Math.floor(sb.tileY + bsz / 2))) {
          this.selection.delete(id);
          continue;
        }
      }
      const sn = this.nodes.get(id);
      if (sn && !this.nodeVisible(sn)) this.selection.delete(id);
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

  /** Último lado horizontal claro para o qual a unidade caminhou na tela. */
  unitFacing(u: UnitSnap): 1 | -1 | undefined {
    return this.unitFacings.get(u.id);
  }

  /** Direção de movimento do barco (vetor no mundo; mantida quando ele para). */
  boatFacing(u: UnitSnap): { x: number; y: number } | undefined {
    return this.boatFacingDirs.get(u.id);
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

  /** Última direção de movimento, mantida enquanto a ovelha está parada. */
  sheepFacing(s: SheepSnap): { x: number; y: number } | undefined {
    return this.sheepFacingDirs.get(s.id);
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

  /** Prédio selecionado (representante do painel; a seleção pode ter vários do
   *  mesmo tipo via duplo-clique). */
  selectedBuilding(): BuildingSnap | undefined {
    for (const id of this.selection) {
      const b = this.buildings.get(id);
      if (b) return b;
    }
    return undefined;
  }

  /** Prédios próprios selecionados (multi-seleção pra treinar/produzir em massa). */
  selectedOwnBuildings(): BuildingSnap[] {
    const out: BuildingSnap[] = [];
    for (const id of this.selection) {
      const b = this.buildings.get(id);
      if (b && b.owner === this.you) out.push(b);
    }
    return out;
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
      if (!this.unitVisible(u)) continue; // escondido na névoa não é clicável
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
      if (!this.sheepVisible(s)) continue; // escondida na névoa
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

    // Altura VISUAL do prédio em unidades de diagonal (k) — até onde o sprite
    // cobre o clique. TEM que bater com o desenho: pra prédio com PNG a conta é
    // `2*size*fit.scale*(imgH/imgW) - size` (ver drawBuildingSprite no renderer).
    // Estes números são da época do desenho PROCEDURAL e ficaram defasados quando
    // entraram os sprites. O Centro estava em 3.2 sendo que o telhado dele sobe só
    // ~1.15 (PNG 467x323, size 3, scale 1.0): ele COMIA o clique de árvore/mina
    // que ficavam VISÍVEIS acima do telhado — dava pra ver e não dava pra clicar.
    // Os demais erram pro lado inofensivo (assumem MENOS que o sprite: dá pra
    // clicar só a parte de baixo do prédio), então ficam como estão por ora.
    const B_H: Partial<Record<BuildingType, number>> = { farm: 0.2, house: 1.7, town_center: 1.2, wall: 0.9, watch_tower: 3.4, market: 2.0, mill: 1.6, lumber_camp: 1.4, mining_camp: 1.4 };
    // Margem MORTA na borda do prédio, em tiles (a caixa de clique encolhe por
    // todos os lados). Só o CENTRO usa: ele é grande (3x3), fica no meio da base
    // cercado de árvore/mina, e clicar de raspão nele fazia o aldeão entrar sem
    // querer. Com 0.25 de margem o alvo vira 2.5x2.5 (~30% menos área) e o clique
    // de raspão "vaza" pra árvore atrás em vez de pegar o prédio. Ainda dá pra
    // clicar no Centro à vontade — só não na casquinha da borda.
    const B_INSET: Partial<Record<BuildingType, number>> = { town_center: 0.25 };
    for (const b of this.buildings.values()) {
      const size = BUILDING_DEFS[b.type]?.size ?? 1;
      // Inimigo só é SELECIONÁVEL com o tile à vista (o "lembrado" na névoa
      // aparece mas não dá pra clicar — senão vazaria o HP ao vivo, e no AoE
      // também é assim). Meus/aliados sempre.
      if (!this.alliedOwners.has(b.owner) &&
          !this.fog.isVisible(Math.floor(b.tileX + size / 2), Math.floor(b.tileY + size / 2))) continue;
      const ins = B_INSET[b.type] ?? 0;
      if (diagHit(b.tileX + ins, b.tileY + ins, b.tileX + size - ins, b.tileY + size - ins, B_H[b.type] ?? 2.5)) {
        return { kind: 'building', building: b };
      }
    }

    const N_H: Record<NodeType, number> = { tree: 1.9, berry_bush: 0.4, gold_mine: 0.9, stone_mine: 0.9, fish: 0.5 };
    for (const n of this.nodes.values()) {
      if (!this.nodeVisible(n)) continue; // ainda não explorado
      if (diagHit(n.tileX, n.tileY, n.tileX + 1, n.tileY + 1, N_H[n.type] ?? 0.5)) {
        return { kind: 'node', node: n };
      }
    }
    return null;
  }

  /**
   * Pré-validação de posicionamento de prédio (o servidor revalida):
   * dentro do mapa, todos os tiles de grama JÁ EXPLORADOS (estilo AoE — não se
   * constrói no escuro), sem sobrepor prédios ou nós.
   */
  /** Moradia minha somada (popProvided), contando obras em andamento — elas vão
   *  prover quando prontas, então já "reservam" o teto. */
  housingProvided(): number {
    let total = 0;
    for (const b of this.buildings.values()) {
      if (b.owner === this.you) total += BUILDING_DEFS[b.type]?.popProvided ?? 0;
    }
    return total;
  }

  canPlace(type: BuildingType, tileX: number, tileY: number): boolean {
    const def = BUILDING_DEFS[type];
    if (!def) return false;
    // Casa além do teto de população (POP_CAP_MAX) é madeira jogada fora: o
    // fantasma fica VERMELHO e o clique não cola — feedback imediato de que o
    // limite chegou (o botão do menu também apaga; o servidor valida igual).
    if (type === 'house' && this.housingProvided() >= POP_CAP_MAX) return false;
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return false;
    const s = def.size;
    const mapSize = this.map.size;
    if (tileX < 0 || tileY < 0 || tileX + s > mapSize || tileY + s > mapSize) return false;
    if (type === 'dock') {
      // Porto: TODO o footprint em água FUNDA explorada + encostado na costa
      // (>=1 vizinho de terra/raso). O servidor valida a mesma regra.
      let coast = false;
      for (let ty = tileY - 1; ty <= tileY + s; ty++) {
        for (let tx = tileX - 1; tx <= tileX + s; tx++) {
          const inside = tx >= tileX && tx < tileX + s && ty >= tileY && ty < tileY + s;
          const t = this.tileAt(tx, ty);
          if (inside) {
            if (t !== TILE_WATER) return false;
            if (!this.fog.isExplored(tx, ty)) return false;
          } else if (t !== TILE_WATER && t !== -1) {
            coast = true;
          }
        }
      }
      if (!coast) return false;
    } else {
      for (let ty = tileY; ty < tileY + s; ty++) {
        for (let tx = tileX; tx < tileX + s; tx++) {
          if (this.tileAt(tx, ty) !== TILE_GRASS) return false;
          if (!this.fog.isExplored(tx, ty)) return false;
        }
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
