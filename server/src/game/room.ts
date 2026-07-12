// Simulação de uma partida: estado, tick loop e aplicação de comandos.
// Autoritativo — o cliente só manda intenções (GameCommand) e recebe snapshots.

import {
  AGE_COSTS,
  AGE_RESEARCH_TIME,
  BUILDING_DEFS,
  buildingsToAdvance,
  countsForAgeUp,
  FARM_FOOD,
  GATHER_RATE,
  MAX_AGE,
  NODE_DEFS,
  POP_CAP_MAX,
  SNAPSHOT_TICKS,
  STARTING_RESOURCES,
  BATTLE_STARTING_RESOURCES,
  BATTLE_STARTING_AGE,
  TECH_DEFS,
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  MARKET_PRICE_STEP,
  MARKET_START_PRICE,
  TICK_MS,
  DEFENSE_DEFS,
  GARRISON_CAP,
  buildingRange,
  buildingAttack,
  TRADE_LOT,
  TRAIN_QUEUE_MAX,
  UNIT_AGE_REQ,
  UNIT_DEFS,
  SHEEP_CONVERT_RANGE,
  SHEEP_CONVERT_EVERY_TICKS,
  SHEEP_DECAY_PER_S,
  SHEEP_FOOD,
  SHEEP_WILD_OWNER,
  SHEEP_SPEED,
  carryCapacity,
  gatherMultiplier,
  techBonus,
  tradeBuyCost,
  tradeSellGain,
} from '@age/shared';
import type {
  BotDifficulty,
  BuildingSnap,
  BuildingType,
  GameCommand,
  GameMode,
  MapData,
  MarketPrices,
  NodeSnap,
  PlayerInfo,
  PlayerSnap,
  ResourceType,
  ServerMessage,
  SheepSnap,
  UnitSnap,
  UnitType,
} from '@age/shared';
import { DIFFICULTY, runBotAI } from './ai';
import { generateMap } from './mapgen';
import { collectSpreadTiles, findPath, idx, isWalkable, nearestWalkableTile, ringTiles, type Grid } from './path';
import { createUnit, type Building, type GamePlayer, type ResNode, type Sheep, type Unit } from './state';

interface QueuedCmd {
  playerId: number;
  cmd: GameCommand;
}

export interface RoomMember {
  id: number;
  name: string;
  color: string;
  isBot?: boolean;
  difficulty?: BotDifficulty; // só bots
}

export type SendFn = (playerId: number, msg: ServerMessage) => void;

export class Game {
  readonly grid: Grid;
  readonly map: MapData;
  units = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  nodes = new Map<number, ResNode>();
  sheep = new Map<number, Sheep>();
  players = new Map<number, GamePlayer>();
  private nextId: number;
  private tick = 0;
  private queue: QueuedCmd[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  readonly botIds = new Set<number>();
  /** Preços do mercado (ouro por lote de 100) — da SALA, movem com as trocas. */
  private marketPrices: MarketPrices = {
    food: MARKET_START_PRICE,
    wood: MARKET_START_PRICE,
    stone: MARKET_START_PRICE,
  };

  constructor(
    members: RoomMember[],
    private readonly send: SendFn,
    private readonly onGameOver: (winner: number, winnerName: string) => void,
    mode: GameMode = 'normal',
  ) {
    const gen = generateMap(members.length);
    this.grid = gen.grid;
    this.map = { size: gen.grid.size, tiles: gen.grid.tiles };
    this.nextId = gen.nextId;

    const battle = mode === 'batalha';
    const baseRes = battle ? BATTLE_STARTING_RESOURCES : STARTING_RESOURCES;
    members.forEach((m) => {
      // Muito difícil (Titã): o bot começa com um bônus de recursos.
      const mult = m.isBot && m.difficulty ? DIFFICULTY[m.difficulty].resourceMult : 1;
      this.players.set(m.id, {
        id: m.id,
        name: m.name,
        color: m.color,
        resources: {
          food: Math.round(baseRes.food * mult),
          wood: Math.round(baseRes.wood * mult),
          gold: Math.round(baseRes.gold * mult),
          stone: Math.round(baseRes.stone * mult),
        },
        defeated: false,
        age: battle ? BATTLE_STARTING_AGE : 1,
        techs: new Set<string>(),
        difficulty: m.difficulty,
      });
      if (m.isBot) this.botIds.add(m.id);
    });

    // Unidades/prédios gerados vêm com owner = índice do jogador (0..n-1); remapeia para playerId real.
    for (const b of gen.buildings) {
      const owner = members[b.owner]?.id;
      if (owner === undefined) continue;
      b.owner = owner;
      this.buildings.set(b.id, b);
    }
    for (const u of gen.units) {
      const owner = members[u.owner]?.id;
      if (owner === undefined) continue;
      u.owner = owner;
      this.units.set(u.id, u);
    }
    for (const n of gen.nodes) this.nodes.set(n.id, n);
    for (const s of gen.sheep) this.sheep.set(s.id, s); // selvagens (owner -1), sem remap
  }

  start(): void {
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueueCommand(playerId: number, cmd: GameCommand): void {
    this.queue.push({ playerId, cmd });
  }

  /** Marca um jogador como derrotado (desconexão) e remove suas entidades. */
  markDefeated(playerId: number): void {
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    p.defeated = true;
    this.removeAllEntitiesOf(playerId);
    this.checkVictory();
  }

  private removeAllEntitiesOf(playerId: number): void {
    for (const [id, u] of this.units) {
      if (u.owner === playerId) this.units.delete(id);
    }
    for (const [id, b] of this.buildings) {
      if (b.owner === playerId) {
        this.unblockFootprint(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
        this.buildings.delete(id);
      }
    }
    // Ovelhas do derrotado voltam a ser selvagens (neutras) — não somem.
    for (const s of this.sheep.values()) {
      if (s.owner === playerId) {
        s.owner = SHEEP_WILD_OWNER;
        s.path = [];
      }
    }
  }

  private errorTo(playerId: number, code: string, params?: Record<string, string | number>): void {
    this.send(playerId, { type: 'error', code, params });
  }

  // ---------------- Tick ----------------

  private step(): void {
    if (this.ended) return;
    const dt = TICK_MS / 1000;
    this.tick++;

    // IA dos bots (~1x/s): enfileira comandos que são aplicados neste mesmo tick.
    if (this.botIds.size > 0 && this.tick % 10 === 0) {
      for (const id of this.botIds) {
        const bp = this.players.get(id);
        if (bp && !bp.defeated) runBotAI(this, id);
      }
    }

    this.applyQueuedCommands();

    for (const u of this.units.values()) this.updateUnit(u, dt);
    this.freeTrappedUnits();
    this.separateIdleUnits(dt);
    this.updateSheep(dt);
    this.updateTowers(dt);
    for (const b of this.buildings.values()) this.updateBuildingTraining(b, dt);

    // pesquisa de era em andamento
    for (const p of this.players.values()) {
      if (p.defeated || !p.ageResearch) continue;
      p.ageResearch.elapsed += dt;
      if (p.ageResearch.elapsed >= (AGE_RESEARCH_TIME[p.ageResearch.target] ?? 0)) {
        p.age = p.ageResearch.target;
        p.ageResearch = undefined;
      }
    }

    // pesquisa de tecnologias nos prédios
    for (const b of this.buildings.values()) {
      if (!b.research) continue;
      const tech = TECH_DEFS.find((t) => t.id === b.research!.id);
      if (!tech) { b.research = undefined; continue; }
      b.research.elapsed += dt;
      if (b.research.elapsed >= tech.time) {
        this.completeTech(b.owner, tech.id);
        b.research = undefined;
      }
    }

    this.checkVictory();

    if (this.tick % SNAPSHOT_TICKS === 0) this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    const unitsSnap: UnitSnap[] = [];
    for (const u of this.units.values()) unitsSnap.push(this.unitToSnap(u));
    const buildingsSnap: BuildingSnap[] = [];
    for (const b of this.buildings.values()) buildingsSnap.push(this.buildingToSnap(b));
    const nodesSnap: NodeSnap[] = [];
    for (const n of this.nodes.values()) nodesSnap.push({ id: n.id, type: n.type, tileX: n.tileX, tileY: n.tileY, amount: n.amount });
    const sheepSnap: SheepSnap[] = [];
    for (const s of this.sheep.values()) sheepSnap.push({ id: s.id, owner: s.owner, x: s.x, y: s.y, food: s.food });
    const playersSnap: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      playersSnap.push({
        id: p.id,
        resources: { ...p.resources },
        pop: this.popOf(p.id),
        popCap: this.popCapOf(p.id),
        defeated: p.defeated,
        age: p.age,
        ageProgress: p.ageResearch
          ? Math.min(1, p.ageResearch.elapsed / (AGE_RESEARCH_TIME[p.ageResearch.target] || 1))
          : undefined,
        techs: [...p.techs],
      });
    }
    const msg: ServerMessage = {
      type: 'snapshot',
      tick: this.tick,
      units: unitsSnap,
      buildings: buildingsSnap,
      nodes: nodesSnap,
      sheep: sheepSnap,
      players: playersSnap,
      market: { ...this.marketPrices },
    };
    for (const p of this.players.values()) this.send(p.id, msg);
  }

  private unitToSnap(u: Unit): UnitSnap {
    const s: UnitSnap = { id: u.id, owner: u.owner, type: u.type, x: u.x, y: u.y, hp: u.hp, state: u.state };
    if (u.carryType) s.carryType = u.carryType;
    if (u.carryAmount) s.carryAmount = u.carryAmount;
    if (u.attackTargetId !== undefined) s.targetId = u.attackTargetId;
    else if (u.gatherTargetId !== undefined) s.targetId = u.gatherTargetId;
    else if (u.buildTargetId !== undefined) s.targetId = u.buildTargetId;
    return s;
  }

  private buildingToSnap(b: Building): BuildingSnap {
    const s: BuildingSnap = {
      id: b.id,
      owner: b.owner,
      type: b.type,
      tileX: b.tileX,
      tileY: b.tileY,
      hp: b.hp,
      progress: b.progress,
      queue: b.queue.map((q) => ({ ...q })),
    };
    if (b.rallyX !== undefined) s.rallyX = b.rallyX;
    if (b.rallyY !== undefined) s.rallyY = b.rallyY;
    if (b.foodLeft !== undefined) s.foodLeft = b.foodLeft;
    if (b.research) {
      const tech = TECH_DEFS.find((t) => t.id === b.research!.id);
      s.research = { id: b.research.id, progress: tech ? Math.min(1, b.research.elapsed / (tech.time || 1)) : 0 };
    }
    if (b.targetId !== undefined) s.targetId = b.targetId; // torre atirando
    if (b.garrison?.length) s.garrison = b.garrison.length; // unidades dentro
    return s;
  }

  private popOf(playerId: number): number {
    let total = 0;
    for (const u of this.units.values()) if (u.owner === playerId) total += UNIT_DEFS[u.type].pop;
    // unidades GUARNECIDAS dentro de prédios ainda contam na população (AoE2)
    for (const b of this.buildings.values()) {
      if (b.garrison) for (const u of b.garrison) if (u.owner === playerId) total += UNIT_DEFS[u.type].pop;
    }
    return total;
  }

  private popCapOf(playerId: number): number {
    let total = 0;
    for (const b of this.buildings.values()) {
      if (b.owner === playerId && b.progress >= 1) total += BUILDING_DEFS[b.type].popProvided;
    }
    return Math.min(POP_CAP_MAX, total);
  }

  private checkVictory(): void {
    if (this.ended) return;
    const alive = [...this.players.values()].filter((p) => !p.defeated);
    // Solo (sandbox/treino): o jogo só termina se o único jogador for derrotado
    // (senão ele ficaria preso num mapa vazio sem tela de fim).
    const over = this.players.size > 1 ? alive.length <= 1 : alive.length === 0;
    if (over) {
      this.ended = true;
      const winner = alive[0];
      const msg: ServerMessage = winner
        ? { type: 'gameOver', winner: winner.id, winnerName: winner.name }
        : { type: 'gameOver', winner: -1, winnerName: '' };
      for (const p of this.players.values()) this.send(p.id, msg);
      this.onGameOver(winner ? winner.id : -1, winner ? winner.name : '');
    }
  }

  /** Verifica derrota por perda de todos os town_centers (concluídos ou em obra). */
  private checkTownCenterLoss(playerId: number): void {
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    const hasTC = [...this.buildings.values()].some((b) => b.owner === playerId && b.type === 'town_center');
    if (!hasTC) this.markDefeated(playerId);
  }

  // ---------------- Comandos ----------------

  private applyQueuedCommands(): void {
    const cmds = this.queue;
    this.queue = [];
    for (const { playerId, cmd } of cmds) {
      const p = this.players.get(playerId);
      if (!p || p.defeated) continue;
      try {
        this.applyCommand(playerId, cmd);
      } catch (err) {
        console.error('[room] erro aplicando comando', cmd.kind, err);
      }
    }
  }

  private applyCommand(playerId: number, cmd: GameCommand): void {
    switch (cmd.kind) {
      case 'move':
        this.cmdMove(playerId, cmd.unitIds, cmd.x, cmd.y, cmd.queue ?? false);
        break;
      case 'stop':
        this.cmdStop(playerId, cmd.unitIds);
        break;
      case 'delete':
        this.cmdDelete(playerId, cmd.ids);
        break;
      case 'repair':
        this.cmdRepair(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'garrison':
        this.cmdGarrison(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'unload':
        this.cmdUnload(playerId, cmd.buildingId);
        break;
      case 'gather':
        this.cmdGather(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'build':
        this.cmdBuild(playerId, cmd.unitIds, cmd.building, cmd.tileX, cmd.tileY, cmd.queue ?? false);
        break;
      case 'train':
        this.cmdTrain(playerId, cmd.buildingId, cmd.unit);
        break;
      case 'cancelTrain':
        this.cmdCancelTrain(playerId, cmd.buildingId, cmd.index);
        break;
      case 'attack':
        this.cmdAttack(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'setRally':
        this.cmdSetRally(playerId, cmd.buildingId, cmd.x, cmd.y);
        break;
      case 'advanceAge':
        this.cmdAdvanceAge(playerId);
        break;
      case 'research':
        this.cmdResearch(playerId, cmd.buildingId, cmd.techId);
        break;
      case 'trade':
        this.cmdTrade(playerId, cmd.action, cmd.resource);
        break;
    }
  }

  /** Mercado: compra/venda de 1 lote (100) de recurso por ouro. O preço é da
   *  SALA: comprar encarece, vender barateia — para todos os jogadores. */
  private cmdTrade(playerId: number, action: 'buy' | 'sell', resource: 'food' | 'wood' | 'stone'): void {
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    if (this.marketPrices[resource] === undefined) return;
    const hasMarket = [...this.buildings.values()].some(
      (b) => b.owner === playerId && b.type === 'market' && b.progress >= 1,
    );
    if (!hasMarket) {
      this.errorTo(playerId, 'err.need_market');
      return;
    }
    const price = this.marketPrices[resource];
    if (action === 'buy') {
      const cost = tradeBuyCost(price);
      if (p.resources.gold < cost) {
        this.errorTo(playerId, 'err.no_gold');
        return;
      }
      p.resources.gold -= cost;
      p.resources[resource] += TRADE_LOT;
      this.marketPrices[resource] = Math.min(MARKET_PRICE_MAX, price + MARKET_PRICE_STEP);
    } else {
      if (p.resources[resource] < TRADE_LOT) {
        this.errorTo(playerId, 'err.no_resource_sell');
        return;
      }
      p.resources[resource] -= TRADE_LOT;
      p.resources.gold += tradeSellGain(price);
      this.marketPrices[resource] = Math.max(MARKET_PRICE_MIN, price - MARKET_PRICE_STEP);
    }
  }

  private cmdResearch(playerId: number, buildingId: number, techId: string): void {
    const p = this.players.get(playerId);
    const b = this.buildings.get(buildingId);
    if (!p || p.defeated || !b || b.owner !== playerId || b.progress < 1) return;
    const tech = TECH_DEFS.find((t) => t.id === techId);
    if (!tech || tech.building !== b.type) return;
    if (p.techs.has(techId)) return;
    if (b.research) {
      this.errorTo(playerId, 'err.building_researching');
      return;
    }
    if (p.age < tech.ageReq) {
      this.errorTo(playerId, 'err.requires_age', { age: tech.ageReq });
      return;
    }
    if (tech.prereq && !p.techs.has(tech.prereq)) {
      this.errorTo(playerId, 'err.requires_prev_upgrade');
      return;
    }
    if (!this.canAfford(p, tech.cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, tech.cost);
    b.research = { id: techId, elapsed: 0 };
  }

  /** Aplica uma tecnologia concluída: registra e reforça as unidades existentes. */
  private completeTech(playerId: number, techId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.techs.has(techId)) return;
    p.techs.add(techId);
    const tech = TECH_DEFS.find((t) => t.id === techId);
    if (!tech || !tech.addHp) return;
    // upgrades de vida valem para unidades já existentes (sobem hp atual e máximo)
    for (const u of this.units.values()) {
      if (u.owner === playerId && tech.units.includes(u.type)) u.hp += tech.addHp;
    }
  }

  private cmdAdvanceAge(playerId: number): void {
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    if (p.ageResearch) {
      this.errorTo(playerId, 'err.age_researching');
      return;
    }
    if (p.age >= MAX_AGE) return;
    let hasTC = false;
    for (const b of this.buildings.values()) {
      if (b.owner === playerId && b.type === 'town_center' && b.progress >= 1) { hasTC = true; break; }
    }
    if (!hasTC) {
      this.errorTo(playerId, 'err.requires_tc');
      return;
    }
    // regra do AoE2: 2 prédios DIFERENTES da era atual concluídos
    // (Casa/Fazenda/Muralha não contam; duas cópias do mesmo valem uma).
    const needB = buildingsToAdvance(p.age);
    if (needB > 0) {
      const have = new Set<BuildingType>();
      for (const b of this.buildings.values()) {
        if (b.owner === playerId && b.progress >= 1 && countsForAgeUp(b.type, p.age)) have.add(b.type);
      }
      if (have.size < needB) {
        this.errorTo(playerId, 'err.requires_buildings', { n: needB, age: p.age, have: have.size });
        return;
      }
    }
    const cost = AGE_COSTS[p.age + 1] ?? {};
    if (!this.canAfford(p, cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, cost);
    p.ageResearch = { target: p.age + 1, elapsed: 0 };
  }

  private ownedUnits(playerId: number, unitIds: number[]): Unit[] {
    const out: Unit[] = [];
    for (const id of unitIds) {
      const u = this.units.get(id);
      if (u && u.owner === playerId) out.push(u);
    }
    return out;
  }

  private cmdMove(playerId: number, unitIds: number[], x: number, y: number, queue = false): void {
    const units = this.ownedUnits(playerId, unitIds);
    // Pastoreio (Fase 2): ovelhas PRÓPRIAS entre os ids também recebem a ordem.
    const herd = unitIds
      .map((id) => this.sheep.get(id))
      .filter((s): s is Sheep => !!s && s.owner === playerId);
    if (units.length === 0 && herd.length === 0) return;
    const spots = collectSpreadTiles(this.grid, Math.round(x), Math.round(y), Math.max(units.length + herd.length, 1));
    units.forEach((u, i) => {
      const target = spots[i] ?? spots[spots.length - 1] ?? { x: Math.round(x), y: Math.round(y) };
      const wx = target.x + 0.5;
      const wy = target.y + 0.5;
      // Shift (queue) e já se movendo: ENFILEIRA o waypoint (segue depois de chegar).
      if (queue && (u.state === 'moving' || (u.moveQueue?.length ?? 0) > 0)) {
        (u.moveQueue ??= []).push({ x: wx, y: wy });
      } else {
        this.clearTasks(u); // zera tarefas E a fila de waypoints
        this.pathUnitTo(u, wx, wy);
        u.state = u.path.length > 0 ? 'moving' : 'idle';
      }
    });
    herd.forEach((s, i) => {
      const target = spots[units.length + i] ?? spots[spots.length - 1] ?? { x: Math.round(x), y: Math.round(y) };
      this.pathSheepTo(s, target.x + 0.5, target.y + 0.5);
    });
  }

  /** Traça o caminho de uma ovelha pastoreada até (tx,ty) do mundo. */
  private pathSheepTo(s: Sheep, tx: number, ty: number): void {
    if (s.food < SHEEP_FOOD) return; // carcaça não anda
    const gx = Math.round(tx - 0.5);
    const gy = Math.round(ty - 0.5);
    let goalX = gx;
    let goalY = gy;
    if (!isWalkable(this.grid, gx, gy)) {
      const near = nearestWalkableTile(this.grid, gx, gy);
      if (!near) {
        s.path = [];
        return;
      }
      goalX = near.x;
      goalY = near.y;
    }
    const path = findPath(this.grid, Math.floor(s.x), Math.floor(s.y), new Set([idx(goalX, goalY, this.grid.size)]));
    s.path = path ?? [];
    s.pathTargetX = goalX + 0.5;
    s.pathTargetY = goalY + 0.5;
  }

  private cmdStop(playerId: number, unitIds: number[]): void {
    for (const u of this.ownedUnits(playerId, unitIds)) {
      this.clearTasks(u);
      u.state = 'idle';
    }
  }

  /** Apaga as PRÓPRIAS unidades/prédios selecionados (tecla Delete). Sem reembolso,
   *  igual ao Age of Empires — só remove e libera o espaço. Apagar o último Centro
   *  da Cidade conta como derrota. */
  private cmdDelete(playerId: number, ids: number[]): void {
    for (const id of ids) {
      const u = this.units.get(id);
      if (u && u.owner === playerId) {
        this.units.delete(id);
        this.retargetAttackersOf(id);
        continue;
      }
      const b = this.buildings.get(id);
      if (b && b.owner === playerId) {
        this.ejectGarrison(b); // libera quem estava dentro (não perde as unidades)
        this.unblockFootprint(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
        this.buildings.delete(id);
        this.retargetAttackersOf(id);
        if (b.type === 'town_center') this.checkTownCenterLoss(playerId);
      }
    }
  }

  /** Reparar um prédio PRÓPRIO pronto e danificado com aldeões: reusa o fluxo de
   *  construção — o updateBuilding detecta prédio pronto+ferido e recupera a vida. */
  private cmdRepair(playerId: number, unitIds: number[], targetId: number): void {
    const b = this.buildings.get(targetId);
    if (!b || b.owner !== playerId || b.progress < 1) return;
    if (b.hp >= BUILDING_DEFS[b.type].hp) return; // já com vida cheia
    for (const u of this.ownedUnits(playerId, unitIds)) {
      if (u.type === 'villager') this.assignBuilder(u, b);
    }
  }

  /** Guarnecer: mandar unidades ENTRAREM numa torre/Centro próprio (some do mapa,
   *  protegidas; o prédio atira +1 flecha por unidade dentro). */
  private cmdGarrison(playerId: number, unitIds: number[], targetId: number): void {
    const b = this.buildings.get(targetId);
    if (!b || b.owner !== playerId || b.progress < 1 || !GARRISON_CAP[b.type]) return;
    for (const u of this.ownedUnits(playerId, unitIds)) {
      this.clearTasks(u);
      u.garrisonTargetId = targetId;
      if (this.pathUnitAdjacentTo(u, b.tileX, b.tileY, BUILDING_DEFS[b.type].size)) {
        u.state = 'movingToGarrison';
      } else {
        this.enterGarrison(u, b); // já colado no prédio → entra na hora
      }
    }
  }

  /** Unidade entra no prédio (removida do mapa, guardada em b.garrison). Respeita
   *  a capacidade — excedente fica de fora, ocioso. */
  private enterGarrison(u: Unit, b: Building): void {
    const cap = GARRISON_CAP[b.type] ?? 0;
    u.garrisonTargetId = undefined;
    if ((b.garrison?.length ?? 0) >= cap) {
      u.state = 'idle';
      return;
    }
    this.units.delete(u.id);
    this.retargetAttackersOf(u.id); // quem mirava nela desiste
    (b.garrison ??= []).push(u);
  }

  /** Ejetar: devolve TODAS as unidades guarnecidas ao mapa, ao redor do prédio. */
  private cmdUnload(playerId: number, buildingId: number): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId) return;
    this.ejectGarrison(b);
  }

  private ejectGarrison(b: Building): void {
    const g = b.garrison;
    if (!g || g.length === 0) return;
    const size = BUILDING_DEFS[b.type].size;
    const cx = Math.round(b.tileX + size / 2);
    const cy = Math.round(b.tileY + size / 2);
    const spots = collectSpreadTiles(this.grid, cx, cy, g.length);
    g.forEach((u, i) => {
      const t = spots[i] ?? spots[spots.length - 1] ?? { x: cx, y: cy };
      u.x = t.x + 0.5;
      u.y = t.y + 0.5;
      this.clearTasks(u);
      u.state = 'idle';
      this.units.set(u.id, u);
    });
    b.garrison = [];
  }

  private updateMovingToGarrison(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const b = this.buildings.get(u.garrisonTargetId ?? -1);
    if (!b || b.progress < 1 || !GARRISON_CAP[b.type]) {
      u.garrisonTargetId = undefined;
      u.state = 'idle';
      return;
    }
    const size = BUILDING_DEFS[b.type].size;
    const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
    const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
    const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    if (d <= 1.6) {
      this.enterGarrison(u, b);
    } else if (!this.pathUnitAdjacentTo(u, b.tileX, b.tileY, size)) {
      u.state = 'idle';
      u.garrisonTargetId = undefined;
    }
  }

  private clearTasks(u: Unit): void {
    u.path = [];
    u.moveQueue = [];
    u.gatherTargetId = undefined;
    u.gatherResource = undefined;
    u.dropOffId = undefined;
    u.buildTargetId = undefined;
    u.buildQueue = [];
    u.attackTargetId = undefined;
    u.garrisonTargetId = undefined;
  }

  private pathUnitTo(u: Unit, tx: number, ty: number): void {
    const gx = Math.round(tx - 0.5);
    const gy = Math.round(ty - 0.5);
    let goalX = gx;
    let goalY = gy;
    if (!isWalkable(this.grid, gx, gy)) {
      const near = nearestWalkableTile(this.grid, gx, gy);
      if (!near) {
        u.path = [];
        return;
      }
      goalX = near.x;
      goalY = near.y;
    }
    const startX = Math.floor(u.x);
    const startY = Math.floor(u.y);
    const goals = new Set<number>([idx(goalX, goalY, this.grid.size)]);
    const path = findPath(this.grid, startX, startY, goals);
    u.path = path ?? [];
    u.pathTargetX = goalX + 0.5;
    u.pathTargetY = goalY + 0.5;
  }

  /** Como pathUnitAdjacentTo, mas EVITA tiles do anel já ocupados/reservados
   *  por outros coletores do mesmo alvo — espalha os aldeões em volta da
   *  árvore/mina/fazenda em vez de empilhar todos no mesmo tile (AoE2). */
  private pathUnitAdjacentToSpread(u: Unit, bx: number, by: number, size: number, targetId: number): boolean {
    const ring = ringTiles(bx - 1, by - 1, bx + size, by + size).filter((p) =>
      isWalkable(this.grid, p.x, p.y),
    );
    if (ring.length === 0) return false;
    // tiles "reservados": onde cada outro coletor deste alvo está (ou vai parar)
    const taken = new Set<number>();
    for (const o of this.units.values()) {
      if (o.id === u.id || o.owner !== u.owner || o.gatherTargetId !== targetId) continue;
      const gx = o.path.length > 0 ? Math.round((o.pathTargetX ?? o.x) - 0.5) : Math.floor(o.x);
      const gy = o.path.length > 0 ? Math.round((o.pathTargetY ?? o.y) - 0.5) : Math.floor(o.y);
      taken.add(idx(gx, gy, this.grid.size));
    }
    const free = ring.filter((p) => !taken.has(idx(p.x, p.y, this.grid.size)));
    const goalsArr = free.length > 0 ? free : ring;
    const startX = Math.floor(u.x);
    const startY = Math.floor(u.y);
    const goals = new Set<number>(goalsArr.map((p) => idx(p.x, p.y, this.grid.size)));
    const path = findPath(this.grid, startX, startY, goals);
    if (!path) {
      // já pode estar num tile do anel (livre ou não — não expulsa quem chegou)
      const cur = idx(startX, startY, this.grid.size);
      if (ring.some((p) => idx(p.x, p.y, this.grid.size) === cur)) {
        u.path = [];
        return true;
      }
      return false;
    }
    u.path = path;
    const last = path.length > 0 ? path[path.length - 1] : { x: startX, y: startY };
    u.pathTargetX = last.x + 0.5;
    u.pathTargetY = last.y + 0.5;
    return true;
  }

  /** Caminha até um tile caminhável adjacente ao footprint (bx,by,size). */
  private pathUnitAdjacentTo(u: Unit, bx: number, by: number, size: number): boolean {
    const ring = ringTiles(bx - 1, by - 1, bx + size, by + size).filter((p) =>
      isWalkable(this.grid, p.x, p.y),
    );
    if (ring.length === 0) return false;
    const startX = Math.floor(u.x);
    const startY = Math.floor(u.y);
    const goals = new Set<number>(ring.map((p) => idx(p.x, p.y, this.grid.size)));
    const path = findPath(this.grid, startX, startY, goals);
    if (!path) {
      // já pode estar em um tile do anel
      const cur = idx(startX, startY, this.grid.size);
      if (goals.has(cur)) {
        u.path = [];
        return true;
      }
      return false;
    }
    u.path = path;
    const last = path.length > 0 ? path[path.length - 1] : { x: startX, y: startY };
    u.pathTargetX = last.x + 0.5;
    u.pathTargetY = last.y + 0.5;
    return true;
  }

  // ---------------- Coleta ----------------

  private cmdGather(playerId: number, unitIds: number[], targetId: number): void {
    const units = this.ownedUnits(playerId, unitIds).filter((u) => u.type === 'villager');
    if (units.length === 0) return;
    const node = this.nodes.get(targetId);
    const farm = this.buildings.get(targetId);
    const sheep = this.sheep.get(targetId);
    if (node) {
      for (const u of units) this.startGatherNode(u, node);
    } else if (farm && farm.type === 'farm' && farm.owner === playerId && farm.progress >= 1) {
      for (const u of units) this.startGatherFarm(u, farm);
    } else if (sheep && (sheep.owner === playerId || sheep.owner === SHEEP_WILD_OWNER)) {
      for (const u of units) this.startGatherSheep(u, sheep);
    } else {
      this.errorTo(playerId, 'err.bad_gather_target');
    }
  }

  private startGatherNode(u: Unit, node: ResNode): void {
    const resource = NODE_DEFS[node.type].resource;
    if (u.gatherResource !== resource) u.carryAmount = 0;
    this.clearTasks(u);
    u.gatherTargetId = node.id;
    u.gatherResource = resource;
    if (this.pathUnitAdjacentToSpread(u, node.tileX, node.tileY, 1, node.id)) {
      u.state = 'movingToGather';
    } else {
      u.state = 'idle';
    }
  }

  private startGatherFarm(u: Unit, farm: Building): void {
    const resource: ResourceType = 'food';
    if (u.gatherResource !== resource) u.carryAmount = 0;
    this.clearTasks(u);
    u.gatherTargetId = farm.id;
    u.gatherResource = resource;
    if (this.pathUnitAdjacentToSpread(u, farm.tileX, farm.tileY, BUILDING_DEFS.farm.size, farm.id)) {
      u.state = 'movingToGather';
    } else {
      u.state = 'idle';
    }
  }

  /** Manda o aldeão abater/comer uma ovelha. Ela é passável (sem footprint):
   *  caminha até o tile dela. Abater = fixa o dono da ovelha no comedor. */
  private startGatherSheep(u: Unit, sheep: Sheep): void {
    const resource: ResourceType = 'food';
    if (u.gatherResource !== resource) u.carryAmount = 0;
    this.clearTasks(u);
    u.gatherTargetId = sheep.id;
    u.gatherResource = resource;
    sheep.owner = u.owner; // sob abate, a ovelha vira sua na hora
    this.pathUnitTo(u, sheep.x, sheep.y);
    u.state = 'movingToGather';
  }

  private findNearestDropOff(playerId: number, x: number, y: number, resource?: ResourceType): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      const def = BUILDING_DEFS[b.type];
      if (b.owner !== playerId || b.progress < 1 || !def.isDropOff) continue;
      // depósito especializado: só aceita seu(s) recurso(s). accepts ausente = aceita tudo (Centro da Cidade).
      if (resource !== undefined && def.accepts && !def.accepts.includes(resource)) continue;
      const cx = b.tileX + def.size / 2;
      const cy = b.tileY + def.size / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private findNearestNodeOfResource(resource: ResourceType, x: number, y: number, maxDist: number): ResNode | null {
    let best: ResNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes.values()) {
      if (NODE_DEFS[n.type].resource !== resource) continue;
      const d = Math.hypot(n.tileX - x, n.tileY - y);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // ---------------- Construção ----------------

  private cmdBuild(playerId: number, unitIds: number[], type: BuildingType, tileX: number, tileY: number, queue = false): void {
    const units = this.ownedUnits(playerId, unitIds).filter((u) => u.type === 'villager');
    if (units.length === 0) return;
    const p = this.players.get(playerId)!;
    const def = Object.prototype.hasOwnProperty.call(BUILDING_DEFS, type) ? BUILDING_DEFS[type] : undefined;
    if (!def) {
      this.errorTo(playerId, 'err.bad_building_type');
      return;
    }
    if (p.age < def.ageReq) {
      this.errorTo(playerId, 'err.requires_age', { age: def.ageReq });
      return;
    }
    // pré-requisito de prédio (árvore do AoE2): Fazenda/Mercado ← Moinho; etc.
    if (def.requires) {
      let hasReq = false;
      for (const b of this.buildings.values()) {
        if (b.owner === playerId && b.type === def.requires && b.progress >= 1) { hasReq = true; break; }
      }
      if (!hasReq) {
        this.errorTo(playerId, 'err.requires_building', { building: def.requires });
        return;
      }
    }

    // queue=true (Ctrl/Shift): enfileira em quem já está ocupado com obra;
    // quem está livre começa agora. queue=false: substitui a tarefa atual.
    const dispatch = (b: Building): void => {
      for (const u of units) {
        if (queue && (u.buildTargetId !== undefined || (u.buildQueue?.length ?? 0) > 0)) {
          (u.buildQueue ??= []).push(b.id);
        } else {
          this.assignBuilder(u, b);
        }
      }
    };

    // Reaproveita obra existente do mesmo tipo/tile do mesmo jogador.
    const existing = [...this.buildings.values()].find(
      (b) => b.owner === playerId && b.type === type && b.tileX === tileX && b.tileY === tileY && b.progress < 1,
    );
    if (existing) {
      dispatch(existing);
      return;
    }

    if (!this.validFootprint(tileX, tileY, def.size)) {
      this.errorTo(playerId, 'err.bad_build_location');
      return;
    }
    if (!this.canAfford(p, def.cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, def.cost);

    const id = this.nextId++;
    const building: Building = {
      id,
      owner: playerId,
      type,
      tileX,
      tileY,
      hp: Math.max(1, Math.round(def.hp * 0.1)),
      progress: 0,
      queue: [],
    };
    this.buildings.set(id, building);
    for (let yy = tileY; yy < tileY + def.size; yy++) {
      for (let xx = tileX; xx < tileX + def.size; xx++) this.grid.blocked[idx(xx, yy, this.grid.size)] = 1;
    }
    dispatch(building);
  }

  /** Manda o aldeão ir construir ESTE prédio (sem mexer na fila de obras). */
  private startBuildTask(u: Unit, building: Building): void {
    u.buildTargetId = building.id;
    if (this.pathUnitAdjacentTo(u, building.tileX, building.tileY, BUILDING_DEFS[building.type].size)) {
      u.state = 'movingToBuild';
    } else {
      u.state = 'building'; // já está colado no prédio
    }
  }

  /** Nova ordem de obra: zera as tarefas atuais (inclusive a fila) e começa. */
  private assignBuilder(u: Unit, building: Building): void {
    this.clearTasks(u);
    this.startBuildTask(u, building);
  }

  /** Pega a próxima obra válida da fila do aldeão e começa. true se achou. */
  private advanceBuildQueue(u: Unit): boolean {
    while (u.buildQueue && u.buildQueue.length > 0) {
      const nextId = u.buildQueue.shift()!;
      const nb = this.buildings.get(nextId);
      if (nb && nb.progress < 1) {
        this.startBuildTask(u, nb);
        return true;
      }
      // prédio já concluído/removido: pula pro próximo da fila
    }
    return false;
  }

  private validFootprint(tileX: number, tileY: number, size: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX + size > this.grid.size || tileY + size > this.grid.size) return false;
    for (let yy = tileY; yy < tileY + size; yy++) {
      for (let xx = tileX; xx < tileX + size; xx++) {
        const i = idx(xx, yy, this.grid.size);
        if (this.grid.tiles[i] !== 0 /* TILE_GRASS */) return false;
        if (this.grid.blocked[i]) return false;
      }
    }
    return true;
  }

  private unblockFootprint(tileX: number, tileY: number, size: number): void {
    for (let yy = tileY; yy < tileY + size; yy++) {
      for (let xx = tileX; xx < tileX + size; xx++) {
        if (isWithinGrid(this.grid, xx, yy)) this.grid.blocked[idx(xx, yy, this.grid.size)] = 0;
      }
    }
  }

  // ---------------- Treinamento ----------------

  private cmdTrain(playerId: number, buildingId: number, unit: UnitType): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId || b.progress < 1) return;
    const def = BUILDING_DEFS[b.type];
    if (!def.trains.includes(unit)) return;
    if (b.queue.length >= TRAIN_QUEUE_MAX) {
      this.errorTo(playerId, 'err.queue_full');
      return;
    }
    const p = this.players.get(playerId)!;
    const req = UNIT_AGE_REQ[unit] ?? 1;
    if (p.age < req) {
      this.errorTo(playerId, 'err.requires_age', { age: req });
      return;
    }
    const cost = UNIT_DEFS[unit].cost;
    if (!this.canAfford(p, cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, cost);
    b.queue.push({ unit, progress: 0 });
  }

  private cmdCancelTrain(playerId: number, buildingId: number, index: number): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId) return;
    if (index < 0 || index >= b.queue.length) return;
    const item = b.queue.splice(index, 1)[0];
    const p = this.players.get(playerId);
    if (p) this.refund(p, UNIT_DEFS[item.unit].cost);
  }

  private cmdSetRally(playerId: number, buildingId: number, x: number, y: number): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId) return;
    b.rallyX = x;
    b.rallyY = y;
  }

  private updateBuildingTraining(b: Building, dt: number): void {
    if (b.progress < 1 || b.queue.length === 0) return;
    const head = b.queue[0];
    const def = UNIT_DEFS[head.unit];
    if (head.progress < 1) {
      head.progress = Math.min(1, head.progress + dt / this.trainTimeFor(b));
      if (head.progress < 1) return;
    }
    // pronto: verifica pop cap
    const pop = this.popOf(b.owner);
    const cap = this.popCapOf(b.owner);
    if (pop + def.pop > cap) return; // segura na fila até liberar espaço

    const spot = this.findFreeSpotNear(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
    if (!spot) return; // sem espaço livre ainda; tenta no próximo tick

    b.queue.shift();
    const id = this.nextId++;
    const newUnit = createUnit(id, b.owner, head.unit, spot.x + 0.5, spot.y + 0.5);
    newUnit.hp = this.unitMaxHp(newUnit); // nasce já com o bônus de vida dos upgrades
    this.units.set(id, newUnit);

    if (b.rallyX !== undefined && b.rallyY !== undefined) {
      // tile que CONTÉM o ponto de reunião (floor, não round: round(tile+0.5)
      // arredondava pra cima e errava o nó de recurso -> aldeão parava sem colher)
      const rx = Math.floor(b.rallyX);
      const ry = Math.floor(b.rallyY);
      const nodeAt = [...this.nodes.values()].find((n) => n.tileX === rx && n.tileY === ry);
      const fs = BUILDING_DEFS.farm.size;
      const farmAt = [...this.buildings.values()].find(
        (fb) =>
          fb.type === 'farm' && fb.owner === b.owner && fb.progress >= 1 &&
          rx >= fb.tileX && rx < fb.tileX + fs && ry >= fb.tileY && ry < fb.tileY + fs,
      );
      if (nodeAt && newUnit.type === 'villager') {
        this.startGatherNode(newUnit, nodeAt);
      } else if (farmAt && newUnit.type === 'villager') {
        // ponto de reunião numa fazenda: aldeão novo já sai colhendo (AoE2)
        this.startGatherFarm(newUnit, farmAt);
      } else {
        this.pathUnitTo(newUnit, b.rallyX, b.rallyY);
        newUnit.state = newUnit.path.length > 0 ? 'moving' : 'idle';
      }
    }
  }

  private trainTimeFor(b: Building): number {
    // trainTime vem de BUILDING_DEFS via unit? Não — está em UNIT_DEFS? Checamos ambos.
    const head = b.queue[0];
    return UNIT_TRAIN_TIME[head.unit];
  }

  private findFreeSpotNear(bx: number, by: number, size: number): { x: number; y: number } | null {
    const ring = ringTiles(bx - 1, by - 1, bx + size, by + size);
    for (const p of ring) {
      if (isWalkable(this.grid, p.x, p.y)) return p;
    }
    return null;
  }

  // ---------------- Combate ----------------

  private cmdAttack(playerId: number, unitIds: number[], targetId: number): void {
    const units = this.ownedUnits(playerId, unitIds);
    if (units.length === 0) return;
    const targetUnit = this.units.get(targetId);
    const targetBuilding = this.buildings.get(targetId);
    const isEnemyUnit = targetUnit && targetUnit.owner !== playerId;
    const isEnemyBuilding = targetBuilding && targetBuilding.owner !== playerId;
    if (!isEnemyUnit && !isEnemyBuilding) return;
    for (const u of units) {
      this.clearTasks(u);
      u.attackTargetId = targetId;
      u.state = 'movingToAttack';
      u.repathTimer = 0;
    }
  }

  private targetPos(id: number): { x: number; y: number } | null {
    const u = this.units.get(id);
    if (u) return { x: u.x, y: u.y };
    const b = this.buildings.get(id);
    if (b) {
      const size = BUILDING_DEFS[b.type].size;
      return { x: b.tileX + size / 2, y: b.tileY + size / 2 };
    }
    return null;
  }

  private distToTarget(u: Unit, targetId: number): number {
    const tu = this.units.get(targetId);
    if (tu) return Math.hypot(tu.x - u.x, tu.y - u.y);
    const b = this.buildings.get(targetId);
    if (b) {
      const size = BUILDING_DEFS[b.type].size;
      const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
      const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
      return Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    }
    return Infinity;
  }

  /** Ataque efetivo da unidade (base + upgrades do dono). */
  private unitAttack(u: Unit): number {
    const p = this.players.get(u.owner);
    return UNIT_DEFS[u.type].attack + (p ? techBonus(p.techs, u.type).attack : 0);
  }

  /** Blindagem efetiva (redução de dano) da unidade. */
  private unitArmor(u: Unit): number {
    const p = this.players.get(u.owner);
    return p ? techBonus(p.techs, u.type).armor : 0;
  }

  /** Vida máxima efetiva (base + upgrades do dono). */
  private unitMaxHp(u: Unit): number {
    const p = this.players.get(u.owner);
    return UNIT_DEFS[u.type].hp + (p ? techBonus(p.techs, u.type).hp : 0);
  }

  /** Alcance efetivo (base + upgrades do dono). */
  private unitRange(u: Unit): number {
    const p = this.players.get(u.owner);
    return UNIT_DEFS[u.type].range + (p ? techBonus(p.techs, u.type).range : 0);
  }

  private dealDamage(u: Unit, targetId: number): void {
    const atk = this.unitAttack(u);
    const tu = this.units.get(targetId);
    if (tu) {
      tu.hp -= Math.max(1, atk - this.unitArmor(tu)); // dano mínimo 1
      if (tu.hp <= 0) {
        this.units.delete(targetId);
        this.retargetAttackersOf(targetId);
      }
      return;
    }
    const b = this.buildings.get(targetId);
    if (b) {
      b.hp -= atk; // prédios não têm blindagem de upgrade
      if (b.hp <= 0) {
        this.unblockFootprint(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
        this.buildings.delete(targetId);
        this.retargetAttackersOf(targetId);
        this.checkTownCenterLoss(b.owner);
      }
    }
  }

  private retargetAttackersOf(deadId: number): void {
    for (const u of this.units.values()) {
      if (u.attackTargetId === deadId) {
        this.clearTasks(u);
        u.state = 'idle';
      }
    }
  }

  // ---------------- Update de unidade por tick ----------------

  private updateUnit(u: Unit, dt: number): void {
    switch (u.state) {
      case 'idle':
        this.updateAutoAggro(u, dt);
        break;
      case 'moving':
        this.advanceAlongPath(u, dt);
        if (u.path.length === 0) {
          // chegou: se há waypoints enfileirados (Shift+clique), segue pro próximo
          const next = u.moveQueue?.shift();
          if (next) {
            this.pathUnitTo(u, next.x, next.y);
            if (u.path.length === 0) u.state = 'idle'; // waypoint inalcançável
          } else {
            u.state = 'idle';
          }
        }
        break;
      case 'movingToGather':
        this.updateMovingToGather(u, dt);
        break;
      case 'gathering':
        this.updateGathering(u, dt);
        break;
      case 'returning':
        this.updateReturning(u, dt);
        break;
      case 'movingToBuild':
        this.updateMovingToBuild(u, dt);
        break;
      case 'building':
        this.updateBuilding(u, dt);
        break;
      case 'movingToGarrison':
        this.updateMovingToGarrison(u, dt);
        break;
      case 'movingToAttack':
        this.updateMovingToAttack(u, dt);
        break;
      case 'attacking':
        this.updateAttacking(u, dt);
        break;
    }
    u.aggroTimer -= dt;
  }

  /** Afasta suavemente unidades PARADAS que ficaram umas em cima das outras
   *  (recém-treinadas no ponto de reunião, exército parado etc.) — dá o
   *  espaçamento de "formação" do AoE2 sem interferir em quem está andando
   *  ou trabalhando. */
  private separateIdleUnits(dt: number): void {
    const idle: Unit[] = [];
    for (const u of this.units.values()) {
      if (u.state === 'idle' && u.path.length === 0) idle.push(u);
    }
    if (idle.length < 2) return;
    const MIN_D = 0.6;   // distância mínima entre centros (tiles)
    const PUSH = 1.4;    // velocidade máxima de afastamento (tiles/s)
    for (let i = 0; i < idle.length; i++) {
      const a = idle[i];
      for (let j = i + 1; j < idle.length; j++) {
        const b = idle[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN_D) continue;
        if (d < 1e-4) {
          // exatamente empilhadas: separa num ângulo determinístico pelos ids
          const ang = ((a.id * 37 + b.id * 61) % 360) * (Math.PI / 180);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const step = Math.min((MIN_D - d) / 2, PUSH * dt);
        const ux = (dx / d) * step;
        const uy = (dy / d) * step;
        this.nudge(a, -ux, -uy);
        this.nudge(b, ux, uy);
      }
    }
  }

  /** Solta unidades presas EM CIMA de um tile bloqueado (ex.: um prédio foi
   *  colocado por cima delas): teleporta pro tile caminhável mais próximo. Uma
   *  unidade PARADA (sem caminho) num tile bloqueado só existe se está presa —
   *  os waypoints de um caminho são sempre caminháveis — então é seguro. Cura
   *  o bug de "5 aldeões travados na fazenda que não movem nem colhem". */
  private freeTrappedUnits(): void {
    for (const u of this.units.values()) {
      if (u.path.length > 0) continue;
      const tx = Math.floor(u.x);
      const ty = Math.floor(u.y);
      if (isWalkable(this.grid, tx, ty)) continue;
      const spot = nearestWalkableTile(this.grid, tx, ty);
      if (!spot) continue;
      u.x = spot.x + 0.5;
      u.y = spot.y + 0.5;
      this.clearTasks(u);
      u.state = 'idle';
    }
  }

  /** Ovelhas: pastoreio (Fase 2) + conversão por proximidade ("roubo", estilo
   *  AoE) 2x/s + apodrecimento da carcaça. Some sozinho no late-game (ovelhas
   *  comidas somem) — early-out quando não há nenhuma. */
  private updateSheep(dt: number): void {
    if (this.sheep.size === 0) return;

    // Quem está cuidando de qual ovelha AGORA (comendo ou a caminho dela):
    // trava o dono e PAUSA o apodrecimento (só carcaça largada apodrece).
    const eating = new Map<number, number>(); // sheepId -> owner
    for (const u of this.units.values()) {
      if (u.type !== 'villager' || u.gatherTargetId === undefined) continue;
      if (u.state !== 'gathering' && u.state !== 'movingToGather' && u.state !== 'returning') continue;
      if (this.sheep.has(u.gatherTargetId)) eating.set(u.gatherTargetId, u.owner);
    }

    for (const s of this.sheep.values()) {
      // Fase 2: avança quem foi mandada pastorear (carcaça não anda).
      if (s.path.length > 0 && s.food >= SHEEP_FOOD) this.advanceSheep(s, dt);
      // Carcaça (já mordida) sem ninguém cuidando: apodrece até virar pó (AoE).
      if (s.food < SHEEP_FOOD && !eating.has(s.id)) {
        s.food -= SHEEP_DECAY_PER_S * dt;
        if (s.food <= 0) this.sheep.delete(s.id);
      }
    }

    if (this.tick % SHEEP_CONVERT_EVERY_TICKS !== 0) return;

    const R = SHEEP_CONVERT_RANGE;
    for (const s of this.sheep.values()) {
      // Carcaça tem dono congelado (quem abateu); não é roubável.
      if (s.food < SHEEP_FOOD) continue;
      const pinned = eating.get(s.id);
      if (pinned !== undefined) {
        s.owner = pinned;
        continue;
      }
      // dono = jogador com a UNIDADE mais próxima dentro do raio (broad-phase por eixo)
      let bestOwner = SHEEP_WILD_OWNER;
      let bestId = Infinity;
      let bestD2 = R * R;
      for (const u of this.units.values()) {
        const dx = u.x - s.x;
        if (dx > R || dx < -R) continue;
        const dy = u.y - s.y;
        if (dy > R || dy < -R) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2 || (d2 === bestD2 && u.id < bestId)) {
          bestD2 = d2;
          bestId = u.id;
          bestOwner = u.owner;
        }
      }
      // sem unidade no raio: mantém o dono (fica sua até alguém chegar mais perto)
      if (bestOwner !== SHEEP_WILD_OWNER && bestOwner !== s.owner) s.owner = bestOwner;
    }
  }

  /** Avança uma ovelha pastoreada pelo seu path (Fase 2). */
  private advanceSheep(s: Sheep, dt: number): void {
    let remaining = SHEEP_SPEED * dt;
    while (remaining > 0 && s.path.length > 0) {
      const wp = s.path[0];
      const dx = wp.x + 0.5 - s.x;
      const dy = wp.y + 0.5 - s.y;
      const d = Math.hypot(dx, dy);
      if (d <= remaining) {
        s.x = wp.x + 0.5;
        s.y = wp.y + 0.5;
        remaining -= d;
        s.path.shift();
      } else {
        s.x += (dx / d) * remaining;
        s.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
  }

  /** Move a unidade se o destino continuar em chão caminhável. */
  private nudge(u: Unit, dx: number, dy: number): void {
    const nx = u.x + dx;
    const ny = u.y + dy;
    if (isWalkable(this.grid, Math.floor(nx), Math.floor(ny))) {
      u.x = nx;
      u.y = ny;
    }
  }

  private advanceAlongPath(u: Unit, dt: number): void {
    if (u.path.length === 0) return;
    let remaining = UNIT_DEFS[u.type].speed * dt;
    while (remaining > 0 && u.path.length > 0) {
      const wp = u.path[0];
      const dx = wp.x + 0.5 - u.x;
      const dy = wp.y + 0.5 - u.y;
      const d = Math.hypot(dx, dy);
      if (d <= remaining) {
        u.x = wp.x + 0.5;
        u.y = wp.y + 0.5;
        remaining -= d;
        u.path.shift();
      } else {
        u.x += (dx / d) * remaining;
        u.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
  }

  private updateAutoAggro(u: Unit, dt: number): void {
    if (u.type === 'villager') {
      // Aldeão parado segurando carga (drop-off destruído/indisponível quando
      // ficou 'idle' em updateGathering/updateReturning): reusa aggroTimer para
      // tentar reentregar periodicamente em vez de travar ocioso para sempre.
      if (u.carryAmount > 0 && u.aggroTimer <= 0) {
        u.aggroTimer = 1; // ~1x/s, evita varredura de prédios a cada tick
        const drop = this.findNearestDropOff(u.owner, u.x, u.y, u.carryType);
        if (drop) {
          u.dropOffId = drop.id;
          if (this.pathUnitAdjacentTo(u, drop.tileX, drop.tileY, BUILDING_DEFS[drop.type].size)) {
            u.state = 'returning';
          }
        }
      }
      return;
    }
    if (u.aggroTimer > 0) return;
    u.aggroTimer = 0.5; // ~2x/s
    const sight = UNIT_DEFS[u.type].sight;
    let bestId: number | null = null;
    let bestD = Infinity;
    for (const other of this.units.values()) {
      if (other.owner === u.owner) continue;
      const d = Math.hypot(other.x - u.x, other.y - u.y);
      if (d <= sight && d < bestD) {
        bestD = d;
        bestId = other.id;
      }
    }
    if (bestId === null) {
      for (const b of this.buildings.values()) {
        if (b.owner === u.owner) continue;
        const size = BUILDING_DEFS[b.type].size;
        const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
        const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
        const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
        if (d <= sight && d < bestD) {
          bestD = d;
          bestId = b.id;
        }
      }
    }
    if (bestId !== null) {
      u.attackTargetId = bestId;
      u.state = 'movingToAttack';
      u.repathTimer = 0;
    }
  }

  private updateMovingToGather(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const targetId = u.gatherTargetId;
    if (targetId === undefined) {
      u.state = 'idle';
      return;
    }
    const node = this.nodes.get(targetId);
    const farm = this.buildings.get(targetId);
    const sheep = this.sheep.get(targetId);
    const pos = node
      ? { x: node.tileX + 0.5, y: node.tileY + 0.5 }
      : sheep
        ? { x: sheep.x, y: sheep.y }
        : farm
          ? this.nearestFarmTile(farm, u)
          : null;
    if (!pos) {
      // a fonte acabou enquanto vinha a caminho: emenda na próxima mais perto
      this.retargetGather(u);
      return;
    }
    const d = Math.hypot(pos.x - u.x, pos.y - u.y);
    if (d <= 1.6) {
      u.state = 'gathering';
    } else {
      // repath (alvo pode ter sido removido/mudou/andado)
      if (node && this.pathUnitAdjacentToSpread(u, node.tileX, node.tileY, 1, node.id)) return;
      if (farm && this.pathUnitAdjacentToSpread(u, farm.tileX, farm.tileY, BUILDING_DEFS.farm.size, farm.id)) return;
      if (sheep) {
        this.pathUnitTo(u, sheep.x, sheep.y);
        if (u.path.length > 0) return;
      }
      u.state = 'idle';
    }
  }

  private nearestFarmTile(farm: Building, u: Unit): { x: number; y: number } {
    const size = BUILDING_DEFS.farm.size;
    const nx = Math.max(farm.tileX, Math.min(u.x, farm.tileX + size - 1));
    const ny = Math.max(farm.tileY, Math.min(u.y, farm.tileY + size - 1));
    return { x: nx + 0.5, y: ny + 0.5 };
  }

  private updateGathering(u: Unit, dt: number): void {
    const targetId = u.gatherTargetId;
    if (targetId === undefined) {
      u.state = 'idle';
      return;
    }
    const node = this.nodes.get(targetId);
    const farm = this.buildings.get(targetId);
    const sheep = this.sheep.get(targetId);
    if (!node && !(farm && farm.type === 'farm') && !sheep) {
      // fonte sumiu: tenta retarget mesmo recurso
      this.retargetGather(u);
      return;
    }
    const resource = u.gatherResource!;
    const amountAvail = node ? node.amount : sheep ? sheep.food : farm!.foodLeft ?? 0;
    // techs econômicas do Mercado: coleta mais rápida e mais capacidade de carga
    const techs = this.players.get(u.owner)?.techs ?? [];
    const cap = carryCapacity(techs);
    const capacity = cap - (u.carryType === resource ? u.carryAmount : 0);
    if (u.carryType !== resource) {
      u.carryType = resource;
      u.carryAmount = 0;
    }
    const gathered = Math.min(GATHER_RATE * gatherMultiplier(techs, resource) * dt, capacity, amountAvail);
    u.carryAmount += gathered;
    if (node) {
      node.amount -= gathered;
      if (node.amount <= 0) {
        this.unblockFootprint(node.tileX, node.tileY, 1);
        this.nodes.delete(node.id);
      }
    } else if (sheep) {
      sheep.owner = u.owner; // abatendo = ovelha continua sua
      sheep.food -= gathered;
      if (sheep.food <= 0) this.sheep.delete(sheep.id); // sem unblock (ovelha não bloqueia)
    } else if (farm) {
      farm.foodLeft = (farm.foodLeft ?? 0) - gathered;
      if (farm.foodLeft <= 0) {
        this.unblockFootprint(farm.tileX, farm.tileY, BUILDING_DEFS.farm.size);
        this.buildings.delete(farm.id);
      }
    }

    const full = u.carryAmount >= cap - 1e-6;
    const sourceGone = node
      ? !this.nodes.has(node.id)
      : sheep
        ? !this.sheep.has(sheep.id)
        : !this.buildings.has(farm!.id);
    if (full) {
      this.sendToDropOff(u);
      return;
    }
    if (sourceGone) {
      // fonte esgotou antes de encher: EMENDA na próxima do mesmo recurso
      // (AoE2) — só vai entregar quando encher; sem outra fonte, entrega o
      // que tem (se algo) e para.
      const resource = u.gatherResource;
      const near = resource ? this.findNearestNodeOfResource(resource, u.x, u.y, 10) : null;
      if (near) {
        this.startGatherNode(u, near);
        return;
      }
      if (resource === 'food') {
        const nextFarm = this.findNearestOwnFarm(u.owner, u.x, u.y, 10);
        if (nextFarm) {
          this.startGatherFarm(u, nextFarm);
          return;
        }
      }
      if (u.carryAmount > 0) this.sendToDropOff(u);
      else u.state = 'idle';
    }
  }

  /** Prédios de defesa (torre de vigia + Centro da Cidade): atiram flechas no
   *  inimigo mais próximo dentro do alcance. Alcance E dano crescem com a era do
   *  dono e com as pesquisas de defesa (Balística/Frestas). */
  private updateTowers(dt: number): void {
    for (const b of this.buildings.values()) {
      const def = DEFENSE_DEFS[b.type];
      if (!def || b.progress < 1) continue;
      b.attackTimer = (b.attackTimer ?? 0) - dt;
      const p = this.players.get(b.owner);
      const age = p?.age ?? 1;
      const range = buildingRange(b.type, age, p?.techs);
      const size = BUILDING_DEFS[b.type].size;
      const cx = b.tileX + size / 2;
      const cy = b.tileY + size / 2;
      // mantém o alvo atual enquanto vivo e no alcance; senão procura outro
      let target = b.targetId !== undefined ? this.units.get(b.targetId) : undefined;
      if (!target || target.owner === b.owner || Math.hypot(target.x - cx, target.y - cy) > range) {
        target = undefined;
        b.targetId = undefined;
        let bestD = range;
        for (const u of this.units.values()) {
          if (u.owner === b.owner) continue;
          const d = Math.hypot(u.x - cx, u.y - cy);
          if (d <= bestD) {
            bestD = d;
            target = u;
          }
        }
        if (target) b.targetId = target.id;
      }
      if (target && b.attackTimer <= 0) {
        b.attackTimer = def.cooldown;
        const dmg = buildingAttack(b.type, age, p?.techs);
        const arrows = 1 + (b.garrison?.length ?? 0); // +1 flecha por unidade dentro
        if (arrows <= 1) {
          target.hp -= Math.max(1, dmg - this.unitArmor(target));
          if (target.hp <= 0) {
            this.units.delete(target.id);
            this.retargetAttackersOf(target.id);
            b.targetId = undefined;
          }
        } else {
          // guarnecido: dispara nos N inimigos mais próximos (defesa de área)
          const enemies = [...this.units.values()]
            .filter((e) => e.owner !== b.owner)
            .map((e) => ({ e, d: Math.hypot(e.x - cx, e.y - cy) }))
            .filter((o) => o.d <= range)
            .sort((a, z) => a.d - z.d)
            .slice(0, arrows);
          for (const { e } of enemies) {
            e.hp -= Math.max(1, dmg - this.unitArmor(e));
            if (e.hp <= 0) {
              this.units.delete(e.id);
              this.retargetAttackersOf(e.id);
            }
          }
          if (!this.units.has(target.id)) b.targetId = undefined;
        }
      }
    }
  }

  /** Manda o aldeão entregar a carga no drop-off mais próximo (ou fica idle). */
  private sendToDropOff(u: Unit): void {
    const drop = this.findNearestDropOff(u.owner, u.x, u.y, u.carryType);
    if (!drop) {
      u.state = 'idle';
      return;
    }
    u.dropOffId = drop.id;
    if (this.pathUnitAdjacentTo(u, drop.tileX, drop.tileY, BUILDING_DEFS[drop.type].size)) {
      u.state = 'returning';
    } else {
      u.state = 'idle';
    }
  }

  /** Fazenda própria pronta e com comida mais próxima (para emendar a colheita). */
  private findNearestOwnFarm(owner: number, x: number, y: number, maxDist: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || b.type !== 'farm' || b.progress < 1 || (b.foodLeft ?? 0) <= 0) continue;
      const d = Math.hypot(b.tileX + 1 - x, b.tileY + 1 - y);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private retargetGather(u: Unit): void {
    const resource = u.gatherResource;
    if (!resource) {
      u.state = 'idle';
      return;
    }
    const near = this.findNearestNodeOfResource(resource, u.x, u.y, 10);
    if (near) {
      this.startGatherNode(u, near);
      return;
    }
    if (resource === 'food') {
      const farm = this.findNearestOwnFarm(u.owner, u.x, u.y, 10);
      if (farm) {
        this.startGatherFarm(u, farm);
        return;
      }
    }
    u.state = 'idle';
  }

  private updateReturning(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const drop = this.buildings.get(u.dropOffId ?? -1);
    if (!drop || drop.progress < 1) {
      u.state = 'idle';
      return;
    }
    const size = BUILDING_DEFS[drop.type].size;
    const nx = Math.max(drop.tileX, Math.min(u.x, drop.tileX + size - 1));
    const ny = Math.max(drop.tileY, Math.min(u.y, drop.tileY + size - 1));
    const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    if (d > 1.6) {
      if (!this.pathUnitAdjacentTo(u, drop.tileX, drop.tileY, size)) u.state = 'idle';
      return;
    }
    const p = this.players.get(u.owner);
    if (p && u.carryType) {
      p.resources[u.carryType] += u.carryAmount;
    }
    u.carryAmount = 0;
    // volta à mesma fonte, ou retarget
    const targetId = u.gatherTargetId;
    const node = targetId !== undefined ? this.nodes.get(targetId) : undefined;
    const farm = targetId !== undefined ? this.buildings.get(targetId) : undefined;
    const sheepT = targetId !== undefined ? this.sheep.get(targetId) : undefined;
    if (node) {
      this.startGatherNode(u, node);
    } else if (sheepT) {
      // volta pra MESMA ovelha (senão ela ficava largada apodrecendo)
      this.startGatherSheep(u, sheepT);
    } else if (farm && farm.type === 'farm') {
      this.startGatherFarm(u, farm);
    } else {
      this.retargetGather(u);
    }
  }

  private updateMovingToBuild(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const b = this.buildings.get(u.buildTargetId ?? -1);
    if (!b) {
      // obra sumiu antes de chegar: emenda na próxima da fila (se houver)
      u.buildTargetId = undefined;
      if (this.advanceBuildQueue(u)) return;
      u.state = 'idle';
      return;
    }
    const size = BUILDING_DEFS[b.type].size;
    const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
    const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
    const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    if (d <= 1.6) {
      u.state = 'building';
    } else if (!this.pathUnitAdjacentTo(u, b.tileX, b.tileY, size)) {
      u.state = 'idle';
    }
  }

  private updateBuilding(u: Unit, dt: number): void {
    const b = this.buildings.get(u.buildTargetId ?? -1);
    const def = b ? BUILDING_DEFS[b.type] : undefined;
    // nada a fazer: obra sumiu, ou está pronta E com vida cheia → segue a fila
    if (!b || !def || (b.progress >= 1 && b.hp >= def.hp)) {
      u.buildTargetId = undefined;
      if (this.advanceBuildQueue(u)) return;
      u.state = 'idle';
      return;
    }
    if (b.progress >= 1) {
      // REPARO: prédio pronto porém danificado — recupera vida gastando recurso.
      this.repairTick(u, b, dt);
      return;
    }
    b.progress = Math.min(1, b.progress + dt / def.buildTime);
    b.hp = Math.round(def.hp * (0.1 + 0.9 * b.progress));
    if (b.progress >= 1) {
      if (b.type === 'farm') {
        b.foodLeft = FARM_FOOD;
        // fazenda pronta: quem construiu segue a fila; sem fila, colhe na hora (AoE2)
        for (const worker of this.units.values()) {
          if (worker.owner === b.owner && worker.buildTargetId === b.id) {
            worker.buildTargetId = undefined;
            if (this.advanceBuildQueue(worker)) continue;
            this.startGatherFarm(worker, b);
          }
        }
        return;
      }
      // prédio comum pronto: próxima obra da fila tem prioridade
      u.buildTargetId = undefined;
      if (this.advanceBuildQueue(u)) return;
      u.state = 'idle';
    }
  }

  /** Um aldeão consertando um prédio pronto: recupera vida na velocidade de
   *  construção, gastando 50% do custo da obra proporcional ao HP recuperado.
   *  Sem recurso pra pagar o próximo tiquinho, para. */
  private repairTick(u: Unit, b: Building, dt: number): void {
    const def = BUILDING_DEFS[b.type];
    const p = this.players.get(u.owner);
    const gain = Math.min((def.hp / def.buildTime) * dt, def.hp - b.hp);
    if (!p || gain <= 0) {
      u.buildTargetId = undefined;
      if (!this.advanceBuildQueue(u)) u.state = 'idle';
      return;
    }
    const frac = (gain / def.hp) * 0.5; // reparo = metade da obra, proporcional ao HP
    const entries = Object.entries(def.cost) as [ResourceType, number][];
    for (const [res, amt] of entries) {
      if ((p.resources[res] ?? 0) < (amt ?? 0) * frac) {
        u.state = 'idle';
        u.buildTargetId = undefined;
        return;
      }
    }
    for (const [res, amt] of entries) p.resources[res] -= (amt ?? 0) * frac;
    b.hp = Math.min(def.hp, b.hp + gain);
  }

  private updateMovingToAttack(u: Unit, dt: number): void {
    const targetId = u.attackTargetId;
    if (targetId === undefined || (!this.units.has(targetId) && !this.buildings.has(targetId))) {
      u.state = 'idle';
      return;
    }
    u.repathTimer -= dt;
    const pos = this.targetPos(targetId);
    if (pos && u.repathTimer <= 0) {
      u.repathTimer = 1;
      const moved = Math.hypot(pos.x - u.pathTargetX, pos.y - u.pathTargetY);
      if (moved > 1 || u.path.length === 0) {
        const tb = this.buildings.get(targetId);
        if (tb) {
          this.pathUnitAdjacentTo(u, tb.tileX, tb.tileY, BUILDING_DEFS[tb.type].size);
        } else {
          this.pathUnitTo(u, pos.x, pos.y);
        }
      }
    }
    this.advanceAlongPath(u, dt);
    const range = this.unitRange(u);
    const d = this.distToTarget(u, targetId);
    if (d <= range) {
      u.state = 'attacking';
      u.attackCooldown = 0;
    }
  }

  private updateAttacking(u: Unit, dt: number): void {
    const targetId = u.attackTargetId;
    if (targetId === undefined || (!this.units.has(targetId) && !this.buildings.has(targetId))) {
      u.state = 'idle';
      return;
    }
    const range = this.unitRange(u);
    const d = this.distToTarget(u, targetId);
    if (d > range) {
      u.state = 'movingToAttack';
      u.repathTimer = 0;
      return;
    }
    u.attackCooldown -= dt;
    if (u.attackCooldown <= 0) {
      u.attackCooldown = UNIT_DEFS[u.type].attackCooldown;
      this.dealDamage(u, targetId);
    }
  }

  // ---------------- Recursos/economia ----------------

  private canAfford(p: GamePlayer, cost: Partial<Record<ResourceType, number>>): boolean {
    for (const key of Object.keys(cost) as ResourceType[]) {
      if (p.resources[key] < (cost[key] ?? 0)) return false;
    }
    return true;
  }

  private deduct(p: GamePlayer, cost: Partial<Record<ResourceType, number>>): void {
    for (const key of Object.keys(cost) as ResourceType[]) {
      p.resources[key] -= cost[key] ?? 0;
    }
  }

  private refund(p: GamePlayer, cost: Partial<Record<ResourceType, number>>): void {
    for (const key of Object.keys(cost) as ResourceType[]) {
      p.resources[key] += cost[key] ?? 0;
    }
  }

  toPlayerInfos(): PlayerInfo[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color }));
  }
}

function isWithinGrid(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.size && y < g.size;
}

// Tempo de treino: vem de UNIT_DEFS (trainTime), não de BUILDING_DEFS.
const UNIT_TRAIN_TIME: Record<UnitType, number> = {
  villager: UNIT_DEFS.villager.trainTime,
  swordsman: UNIT_DEFS.swordsman.trainTime,
  archer: UNIT_DEFS.archer.trainTime,
  knight: UNIT_DEFS.knight.trainTime,
};
