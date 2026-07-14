// Tela 4: Jogo — canvas fullscreen + HUD, câmera, input e renderização.

import type { GameCommand, MapData, PlayerInfo } from '@age/shared';
import { BUILDING_DEFS } from '@age/shared';
import { GameState } from '../state';
import { el } from '../ui';
import { t } from '../i18n';
import { Camera } from '../game/camera';
import { Hud, type HudDeps } from '../game/hud';
import { GameInput } from '../game/input';
import { Sfx } from '../game/audio';
import { music } from '../music';
import { settings } from '../settings';
import { Minimap } from '../game/minimap';
import { Renderer } from '../game/renderer';
import { createUIState } from '../game/uistate';
import { ConnLostOverlay } from './connlost';

export interface GameScreenDeps {
  onCommand: (cmd: GameCommand) => void;
  onChat: (text: string) => void;
  onTogglePause: () => void;
  onPing: (x: number, y: number) => void;
  onBackToLobby: () => void;
}

export class GameScreen {
  readonly el: HTMLElement;
  readonly state: GameState;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private cam: Camera;
  private renderer: Renderer;
  private minimap: Minimap;
  private hud!: Hud;
  private hudDeps!: HudDeps;
  private input: GameInput;
  private connLost: ConnLostOverlay;
  private pauseOverlay!: HTMLElement;
  private pauseBy!: HTMLElement;

  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private didCenter = false;
  private sfx = new Sfx();
  private renderScale = settings.renderScale; // qualidade/desempenho (menu de opções)
  private sndAge = 1;
  private sndTechs = 0;
  private sndUnits = -1;
  private sndCombatAt = 0;
  private lastBaseAlertAt = -Infinity;
  private nextOwl = 0;
  private nextWorkSound = 0;
  private workListenX = Number.NaN;
  private workListenY = Number.NaN;
  private workListenSince = 0;

  constructor(map: MapData, players: PlayerInfo[], you: number, private deps: GameScreenDeps, fogEnabled = false) {
    this.state = new GameState(map, players, you, fogEnabled);
    const gs = this.state;

    this.el = el('div', 'screen');
    this.el.style.cursor = 'default';
    const root = el('div', '');
    root.id = 'game-root';

    this.canvas = el('canvas');
    this.canvas.id = 'game-canvas';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.cam = new Camera(map.size);

    this.hudDeps = {
      onBuild: (type) => this.input.startPlacement(type),
      onTrain: (buildingId, unit) => this.deps.onCommand({ kind: 'train', buildingId, unit }),
      onCancelTrain: (buildingId, index) => this.deps.onCommand({ kind: 'cancelTrain', buildingId, index }),
      onAdvanceAge: () => this.deps.onCommand({ kind: 'advanceAge' }),
      onResearch: (buildingId, techId) => this.deps.onCommand({ kind: 'research', buildingId, techId }),
      onTrade: (action, resource) => this.deps.onCommand({ kind: 'trade', action, resource }),
      onChat: (text) => this.deps.onChat(text),
      onIdleVillager: () => this.selectNextIdleVillager(),
      onUnload: (transportId) => this.deps.onCommand({ kind: 'unload', buildingId: transportId }),
      getPlacement: () => this.input.ui.placement,
    };
    this.createHud();
    root.appendChild(this.hud.el);

    this.minimap = new Minimap(gs, this.cam, {
      onOrderMove: (wx, wy, queue) => this.input.orderMoveTo(wx, wy, queue),
      onSelectArmy: () => this.selectAllMilitary(),
      onCenterHome: () => this.centerOnHome(),
      onIdleVillager: () => this.selectNextIdleVillager(),
      onPing: (wx, wy) => this.deps.onPing(wx, wy),
    });
    this.hud.minimapSlot.appendChild(this.minimap.el);

    this.connLost = new ConnLostOverlay({ onBackToLobby: () => this.deps.onBackToLobby() });
    root.appendChild(this.connLost.el);

    // Overlay de PAUSA (aparece pra todos quando alguém aperta P).
    this.pauseOverlay = el('div', 'pause-overlay hidden');
    const pbox = el('div', 'pause-box');
    pbox.appendChild(el('div', 'pause-title', t('pause.title')));
    this.pauseBy = el('div', 'pause-by', '');
    pbox.appendChild(this.pauseBy);
    pbox.appendChild(el('div', 'pause-hint', t('pause.hint')));
    this.pauseOverlay.appendChild(pbox);
    root.appendChild(this.pauseOverlay);

    this.renderer = new Renderer(gs);

    const uiState = createUIState();
    this.input = new GameInput(this.canvas, this.cam, gs, uiState, {
      onCommand: (cmd) => this.deps.onCommand(cmd),
      onBuildCommand: (type, tileX, tileY, unitIds, queue) => {
        this.deps.onCommand({ kind: 'build', unitIds, building: type, tileX, tileY, queue });
      },
      onCenterHome: () => this.centerOnHome(),
      onIdleVillager: (all) => all ? this.selectAllIdleVillagers() : this.selectNextIdleVillager(),
      onTogglePause: () => this.deps.onTogglePause(),
      isChatOpen: () => this.hud.isChatOpen(),
      openChat: () => this.hud.openChat(),
    }, this.sfx);

    // primeiro gesto do usuário destrava o áudio no navegador (SFX e trilha)
    this.canvas.addEventListener('mousedown', () => { this.sfx.resume(); music.unlock(); }, { once: true });
    // carrega os arquivos de som presentes em /public/sounds/ (ausentes usam reserva)
    this.sfx.setVolume(settings.sfxVol); // aplica o volume salvo no menu de opções
    void this.sfx.preload();

    this.el.appendChild(root);
    this.setupResize(root);

    const tc = gs.myTownCenter();
    if (tc) {
      const size = BUILDING_DEFS.town_center.size;
      this.cam.centerOn(tc.tileX + size / 2, tc.tileY + size / 2);
    } else {
      this.cam.centerOn(map.size / 2, map.size / 2);
    }

    this.startLoop();
  }

  /** Mostra/esconde o overlay de PAUSA e bloqueia o input do jogo enquanto pausado. */
  setPaused(paused: boolean, by: string): void {
    this.pauseOverlay.classList.toggle('hidden', !paused);
    this.pauseBy.textContent = paused && by ? t('pause.by', { name: by }) : '';
    this.input.setPaused(paused);
  }

  /** (Re)cria o HUD com os deps atuais + o som de clique dos botões. */
  private createHud(): void {
    this.hud = new Hud(this.state, this.hudDeps);
    // clique nos botões do HUD => som de UI (delegado)
    this.hud.el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement)?.closest('button')) this.sfx.uiClick();
    });
  }

  /** Troca de idioma no meio da partida: reconstrói o HUD (que monta texto no
   *  construtor) já no novo idioma, SEM recarregar — canvas, câmera, estado e
   *  conexão continuam. O minimapa mora no slot do HUD, então é re-anexado. */
  retranslate(): void {
    const old = this.hud.el;
    this.createHud();
    old.replaceWith(this.hud.el);
    this.hud.minimapSlot.appendChild(this.minimap.el);
  }

  private setupResize(root: HTMLElement): void {
    const resize = (): void => {
      const rect = root.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // backing store escalado pela resolução escolhida (75%/50% = mais leve);
      // o CSS size e o viewport da câmera ficam em px reais (input/pick/HUD intactos).
      this.canvas.width = Math.round(w * dpr * this.renderScale);
      this.canvas.height = Math.round(h * dpr * this.renderScale);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.cam.setViewport(w, h);
    };
    resize();
    // no construtor o elemento ainda não está no DOM (mede 0x0) — remede após o mount
    setTimeout(resize, 0);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(resize);
      this.resizeObserver.observe(root);
    }
    window.addEventListener('resize', resize);
    this.onWindowResize = resize;
  }

  private onWindowResize: (() => void) | null = null;

  private centerOnHome(): void {
    const tc = this.state.myTownCenter();
    if (!tc) return;
    const size = BUILDING_DEFS.town_center.size;
    this.cam.centerOn(tc.tileX + size / 2, tc.tileY + size / 2);
  }

  private idleCycle = 0;

  /** Seleciona e centraliza o próximo aldeão ocioso (botão do HUD / tecla "."). */
  private selectNextIdleVillager(): void {
    const gs = this.state;
    const idle = [...gs.units.values()]
      .filter((u) => u.owner === gs.you && u.type === 'villager' && u.state === 'idle')
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) return;
    const u = idle[this.idleCycle++ % idle.length];
    gs.selection.clear();
    gs.selection.add(u.id);
    const p = gs.unitPos(u, performance.now());
    this.cam.centerOn(p.x, p.y);
    this.sfx.selectUnit('villager');
  }

  /** Reunir o exército: seleciona toda a tropa militar própria (não-aldeões). */
  private selectAllMilitary(): void {
    const army = [...this.state.units.values()]
      .filter((u) => u.owner === this.state.you && u.type !== 'villager')
      .sort((a, b) => a.id - b.id);
    if (army.length === 0) return;
    this.state.selection.clear();
    for (const u of army) this.state.selection.add(u.id);
    this.sfx.selectUnit(army[0].type);
  }

  private selectAllIdleVillagers(): void {
    const idle = [...this.state.units.values()]
      .filter((u) => u.owner === this.state.you && u.type === 'villager' && u.state === 'idle')
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) return;
    this.state.selection.clear();
    for (const u of idle) this.state.selection.add(u.id);
    this.sfx.selectUnit('villager');
  }

  /** Toca sons de eventos detectando mudanças entre snapshots (era, pesquisa,
   *  treino concluído). Comparação barata por frame. */
  private playEventSounds(now: number): void {
    // coruja cruzando o céu: pio ocasional (~1x/min)
    if (this.nextOwl === 0) this.nextOwl = now + 25000 + Math.random() * 35000;
    else if (now >= this.nextOwl) {
      this.sfx.owl();
      // Em média uma vez por minuto, mas nunca num intervalo mecânico.
      this.nextOwl = now + 35000 + Math.random() * 55000;
    }
    if (now >= this.nextWorkSound) {
      // Ao chegar a uma região, a atividade se apresenta; se a câmera fica ali,
      // o ouvido se acostuma e esses impactos somem suavemente, devolvendo a paz.
      const moved = !Number.isFinite(this.workListenX) || Math.hypot(this.cam.x - this.workListenX, this.cam.y - this.workListenY) > 1.2;
      if (moved) {
        this.workListenX = this.cam.x;
        this.workListenY = this.cam.y;
        this.workListenSince = now;
      }
      const settledFor = now - this.workListenSince;
      const attention = settledFor < 2800 ? 1 : Math.max(0, 1 - (settledFor - 2800) / 6500);
      let best: { type: import('@age/shared').NodeType | 'building'; d: number; pan: number } | null = null;
      for (const u of this.state.units.values()) {
        if (u.state !== 'gathering' && u.state !== 'building') continue;
        const p = this.state.unitPos(u, now);
        const d = Math.hypot(p.x - this.cam.x, p.y - this.cam.y);
        if (d > 15 || (best && d >= best.d)) continue;
        const node = u.targetId == null ? undefined : this.state.nodes.get(u.targetId);
        const type = u.state === 'building' ? 'building' : node?.type;
        if (!type) continue;
        const screen = this.cam.worldToScreen(p.x, p.y);
        best = { type, d, pan: (screen.x / Math.max(1, this.cam.viewW) - 0.5) * 1.7 };
      }
      if (best && attention > 0) this.sfx.work(best.type, Math.max(0, 1 - best.d / 15) ** 1.7 * 0.78 * attention, best.pan);
      // Intervalo irregular e mais espaçado, especialmente importante nas minas.
      this.nextWorkSound = now + 680 + Math.random() * 520;
    }
    const me = this.state.me();
    if (!me) return;
    if (me.age > this.sndAge) this.sfx.ageUp();
    this.sndAge = me.age;
    const techCount = me.techs?.length ?? 0;
    if (techCount > this.sndTechs && this.sndTechs >= 0) this.sfx.research();
    this.sndTechs = techCount;
    let mine = 0;
    for (const u of this.state.units.values()) if (u.owner === this.state.you) mine++;
    if (this.sndUnits >= 0 && mine > this.sndUnits) this.sfx.trained();
    this.sndUnits = mine;

    // combate: sons de golpe/morte/destruição para o que surgiu desde o último
    // frame — só do que está À VISTA (batalha escondida na névoa não faz som)
    const fogVis = (wx: number, wy: number): boolean =>
      this.state.fog.isVisible(Math.floor(wx), Math.floor(wy));
    let newHit = false;
    let newDeath = false;
    let newWreck = false;
    for (const h of this.state.hits) if (h.at > this.sndCombatAt && fogVis(h.x, h.y)) newHit = true;
    for (const d of this.state.deaths) if (d.at > this.sndCombatAt && fogVis(d.unit.x, d.unit.y)) newDeath = true;
    for (const w of this.state.wrecks) {
      if (w.at <= this.sndCombatAt) continue;
      const sz = BUILDING_DEFS[w.building.type]?.size ?? 1;
      if (fogVis(w.building.tileX + sz / 2, w.building.tileY + sz / 2)) newWreck = true;
    }
    if (newHit) this.sfx.hit(performance.now());
    if (newDeath) this.sfx.death();
    if (newWreck) this.sfx.wreck();
    this.sndCombatAt = performance.now();

    if (now - this.lastBaseAlertAt >= 5000) {
      for (const [id] of this.state.lastHit) {
        const u = this.state.units.get(id);
        const b = this.state.buildings.get(id);
        if ((!u || u.owner !== this.state.you) && (!b || b.owner !== this.state.you)) continue;
        let wx: number, wy: number;
        if (u) {
          const p = this.state.unitPos(u, now);
          wx = p.x; wy = p.y;
        } else if (b) {
          const size = BUILDING_DEFS[b.type]?.size ?? 1;
          wx = b.tileX + size / 2; wy = b.tileY + size / 2;
        } else continue;
        const s = this.cam.worldToScreen(wx, wy);
        if (s.x >= 0 && s.y >= 0 && s.x <= this.cam.viewW && s.y <= this.cam.viewH) continue;
        this.sfx.baseUnderAttack();
        this.lastBaseAlertAt = now;
        break;
      }
    }

    // música de batalha: entra quando EU estou envolvido em combate (minhas
    // unidades atacando, ou minhas unidades/prédios levando dano)
    const gsNow = performance.now();
    const you = this.state.you;
    let inBattle = false;
    for (const u of this.state.units.values()) {
      if (u.owner === you && (u.state === 'attacking' || u.state === 'movingToAttack')) { inBattle = true; break; }
    }
    if (!inBattle) {
      for (const [id, t] of this.state.lastHit) {
        if (gsNow - t > 1200) continue;
        const u = this.state.units.get(id);
        const b = this.state.buildings.get(id);
        if ((u && u.owner === you) || (b && b.owner === you)) { inBattle = true; break; }
      }
    }
    if (inBattle) music.battlePulse();
    music.tick(gsNow);
  }

  private startLoop(): void {
    const frame = (now: number): void => {
      // Centraliza na base assim que o primeiro snapshot com o Centro da Cidade chega.
      if (!this.didCenter && this.state.myTownCenter()) {
        this.centerOnHome();
        this.didCenter = true;
      }
      this.input.tick(now);
      this.playEventSounds(now);
      this.hud.update();
      if (this.ctx) {
        const dpr = (window.devicePixelRatio || 1) * this.renderScale;
        this.renderer.draw(this.ctx, this.cam, this.input.ui, dpr, now);
      }
      this.minimap.draw(now);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  addChat(from: string, text: string): void {
    this.hud.addChat(from, text);
  }

  showConnLost(): void {
    this.connLost.show();
  }

  /** Menu de opções: volume dos efeitos (0..1). */
  setSfxVolume(v: number): void {
    this.sfx.setVolume(v);
  }

  /** Menu de opções: resolução (1 / 0.75 / 0.5) — reescala o canvas na hora. */
  setRenderScale(s: number): void {
    this.renderScale = s;
    this.onWindowResize?.();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.sfx.stopMusic();
    this.input.destroy();
    this.minimap.destroy();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
  }
}
