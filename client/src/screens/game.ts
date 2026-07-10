// Tela 4: Jogo — canvas fullscreen + HUD, câmera, input e renderização.

import type { GameCommand, MapData, PlayerInfo } from '@age/shared';
import { BUILDING_DEFS } from '@age/shared';
import { GameState } from '../state';
import { el } from '../ui';
import { Camera } from '../game/camera';
import { Hud } from '../game/hud';
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
  private hud: Hud;
  private input: GameInput;
  private connLost: ConnLostOverlay;

  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private didCenter = false;
  private sfx = new Sfx();
  private renderScale = settings.renderScale; // qualidade/desempenho (menu de opções)
  private sndAge = 1;
  private sndTechs = 0;
  private sndUnits = -1;
  private sndCombatAt = 0;
  private nextOwl = 0;

  constructor(map: MapData, players: PlayerInfo[], you: number, private deps: GameScreenDeps) {
    this.state = new GameState(map, players, you);
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

    this.hud = new Hud(gs, {
      onBuild: (type) => this.input.startPlacement(type),
      onTrain: (buildingId, unit) => this.deps.onCommand({ kind: 'train', buildingId, unit }),
      onCancelTrain: (buildingId, index) => this.deps.onCommand({ kind: 'cancelTrain', buildingId, index }),
      onAdvanceAge: () => this.deps.onCommand({ kind: 'advanceAge' }),
      onResearch: (buildingId, techId) => this.deps.onCommand({ kind: 'research', buildingId, techId }),
      onTrade: (action, resource) => this.deps.onCommand({ kind: 'trade', action, resource }),
      onChat: (text) => this.deps.onChat(text),
      onIdleVillager: () => this.selectNextIdleVillager(),
      getPlacement: () => this.input.ui.placement,
    });
    root.appendChild(this.hud.el);

    this.minimap = new Minimap(gs, this.cam);
    this.hud.minimapSlot.appendChild(this.minimap.el);

    this.connLost = new ConnLostOverlay({ onBackToLobby: () => this.deps.onBackToLobby() });
    root.appendChild(this.connLost.el);

    this.renderer = new Renderer(gs);

    const uiState = createUIState();
    this.input = new GameInput(this.canvas, this.cam, gs, uiState, {
      onCommand: (cmd) => this.deps.onCommand(cmd),
      onBuildCommand: (type, tileX, tileY, unitIds, queue) => {
        this.deps.onCommand({ kind: 'build', unitIds, building: type, tileX, tileY, queue });
      },
      onCenterHome: () => this.centerOnHome(),
      onIdleVillager: () => this.selectNextIdleVillager(),
      isChatOpen: () => this.hud.isChatOpen(),
      openChat: () => this.hud.openChat(),
    }, this.sfx);

    // clique nos botões do HUD => som de UI (delegado)
    this.hud.el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement)?.closest('button')) this.sfx.uiClick();
    });
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

  /** Toca sons de eventos detectando mudanças entre snapshots (era, pesquisa,
   *  treino concluído). Comparação barata por frame. */
  private playEventSounds(now: number): void {
    // coruja cruzando o céu: pio ocasional (~1x/min)
    if (this.nextOwl === 0) this.nextOwl = now + 20000 + Math.random() * 25000;
    else if (now >= this.nextOwl) {
      this.sfx.owl();
      this.nextOwl = now + 45000 + Math.random() * 45000;
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

    // combate: sons de golpe/morte/destruição para o que surgiu desde o último frame
    let newHit = false;
    let newDeath = false;
    let newWreck = false;
    for (const h of this.state.hits) if (h.at > this.sndCombatAt) newHit = true;
    for (const d of this.state.deaths) if (d.at > this.sndCombatAt) newDeath = true;
    for (const w of this.state.wrecks) if (w.at > this.sndCombatAt) newWreck = true;
    if (newHit) this.sfx.hit(performance.now());
    if (newDeath) this.sfx.death();
    if (newWreck) this.sfx.wreck();
    this.sndCombatAt = performance.now();

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
