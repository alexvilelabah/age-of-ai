// Entrada do jogo: câmera (WASD/setas + arrasto botão do meio + rolagem pela
// borda da tela; zoom é FIXO, sem roda), seleção (clique/arrasto com caixa,
// Shift/Ctrl), comandos (botão direito) e posicionamento de prédios.

import type { BuildingType, GameCommand } from '@age/shared';
import { BUILDING_DEFS, GARRISON_CAP, TILE_WATER } from '@age/shared';
import type { GameState } from '../state';
import { music } from '../music';
import type { Sfx } from './audio';
import type { Camera } from './camera';
import type { UIState } from './uistate';
import { ghostTile, wallLineTiles } from './uistate';

export interface InputDeps {
  onCommand: (cmd: GameCommand) => void;
  onBuildCommand: (type: BuildingType, tileX: number, tileY: number, unitIds: number[], queue: boolean) => void;
  onCenterHome: () => void;
  onIdleVillager: (all?: boolean) => void;
  isChatOpen: () => boolean;
  openChat: () => void;
}

const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, -1], ArrowUp: [0, -1],
  s: [0, 1], ArrowDown: [0, 1],
  a: [-1, 0], ArrowLeft: [-1, 0],
  d: [1, 0], ArrowRight: [1, 0],
};

const PAN_SPEED = 12; // tiles/segundo em zoom 1
const EDGE_MARGIN = 26; // px da borda que ativam a rolagem
const EDGE_SPEED = 620; // px/segundo da rolagem pela borda

export class GameInput {
  readonly ui: UIState;

  private keysDown = new Set<string>();
  /** Grupos de controle (Ctrl+1..9 salva; 1..9 seleciona; 2x centraliza). */
  private groups = new Map<number, number[]>();
  private lastGroupKey = -1;
  private lastGroupAt = 0;
  private mmDragging = false;
  private lastMouse = { x: 0, y: 0 };
  private leftDown = false;
  private leftDownAt = { x: 0, y: 0 };
  private dragSelecting = false;
  private dragAdditive = false;
  private lastFrameT = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
    private gs: GameState,
    ui: UIState,
    private deps: InputDeps,
    private sfx: Sfx,
  ) {
    this.ui = ui;
    this.bind();
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    c.addEventListener('mouseleave', () => {
      this.ui.hasMouse = false;
    });
    c.addEventListener('mouseenter', () => {
      this.ui.hasMouse = true;
    });
    // duplo clique numa unidade própria: seleciona todas do mesmo tipo na tela (AoE2)
    c.addEventListener('dblclick', (e) => {
      if (this.deps.isChatOpen() || this.ui.placement) return;
      this.selectAllOfTypeAt(this.canvasPos(e));
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onBlur = (): void => {
    this.keysDown.clear();
    this.mmDragging = false;
    this.leftDown = false;
    this.dragSelecting = false;
  };

  destroy(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Chamado a cada frame para aplicar o pan por teclado. */
  tick(now: number): void {
    if (this.lastFrameT === 0) this.lastFrameT = now;
    const dt = Math.min(0.1, (now - this.lastFrameT) / 1000);
    this.lastFrameT = now;
    if (this.deps.isChatOpen()) return;

    let dx = 0;
    let dy = 0;
    for (const k of this.keysDown) {
      const v = PAN_KEYS[k];
      if (v) {
        dx += v[0];
        dy += v[1];
      }
    }
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      this.cam.x += (dx / len) * PAN_SPEED * dt;
      this.cam.y += (dy / len) * PAN_SPEED * dt;
      this.cam.clampToMap();
    }

    // rolagem pela borda da tela (estilo AoE2): a câmera anda no sentido da
    // borda onde o mouse encosta — as QUATRO bordas iguais, inclusive a de
    // baixo, que dispara no fundo da tela (não acima da barra). Desligada
    // durante seleção (botão esquerdo) e arrasto do meio.
    if (this.ui.hasMouse && !this.leftDown && !this.mmDragging) {
      let ex = 0;
      let ey = 0;
      if (this.ui.mouseX < EDGE_MARGIN) ex = -1;
      else if (this.ui.mouseX > this.cam.viewW - EDGE_MARGIN) ex = 1;
      if (this.ui.mouseY < EDGE_MARGIN) ey = -1;
      else if (this.ui.mouseY > this.cam.viewH - EDGE_MARGIN) ey = 1;
      if (ex !== 0 || ey !== 0) {
        // panPx move o CONTEÚDO; para a câmera ir no sentido da borda, o
        // conteúdo desliza pro lado oposto — daí o sinal negativo.
        const step = EDGE_SPEED * dt;
        this.cam.panPx(-ex * step, -ey * step);
      }
    }
  }

  private canvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (this.deps.isChatOpen()) return;
    const pos = this.canvasPos(e);
    this.lastMouse = pos;

    if (e.button === 1) {
      e.preventDefault();
      this.mmDragging = true;
      return;
    }

    if (e.button === 0) {
      if (this.ui.placement) {
        if (this.ui.placement === 'wall') {
          // muralha: inicia o ARRASTO — a linha inteira é construída ao soltar
          this.ui.wallDrag = ghostTile(this.ui, this.cam, 'wall');
        } else {
          // Ctrl/Shift segurado: continua no modo de construção (várias casas seguidas)
          this.tryPlaceAt(pos, e.ctrlKey || e.shiftKey);
        }
        return;
      }
      this.leftDown = true;
      this.leftDownAt = pos;
      this.dragSelecting = false;
      this.dragAdditive = e.shiftKey || e.ctrlKey;
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (this.ui.placement) {
        this.ui.placement = null;
        this.ui.wallDrag = null;
        return;
      }
      // Shift: adiciona WAYPOINT (fila de destinos) em vez de substituir a ordem
      this.handleRightClick(pos, e.shiftKey);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    const pos = this.canvasPos(e);
    this.ui.mouseX = pos.x;
    this.ui.mouseY = pos.y;
    this.ui.hasMouse = true;

    if (this.mmDragging) {
      const dx = pos.x - this.lastMouse.x;
      const dy = pos.y - this.lastMouse.y;
      this.cam.panPx(-dx, -dy);
    } else if (this.leftDown && !this.ui.placement) {
      const dx = pos.x - this.leftDownAt.x;
      const dy = pos.y - this.leftDownAt.y;
      if (!this.dragSelecting && Math.hypot(dx, dy) > 4) {
        this.dragSelecting = true;
      }
      if (this.dragSelecting) {
        this.ui.boxRect = { x0: this.leftDownAt.x, y0: this.leftDownAt.y, x1: pos.x, y1: pos.y };
      }
    }
    this.lastMouse = pos;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) {
      this.mmDragging = false;
      return;
    }
    if (e.button === 0 && this.ui.wallDrag) {
      // soltou o arrasto de muralha: constrói a linha inteira
      this.finishWallDrag();
      return;
    }
    if (e.button === 0 && this.leftDown) {
      this.leftDown = false;
      const pos = this.canvasPos(e);
      if (this.dragSelecting && this.ui.boxRect) {
        this.finishBoxSelect(this.ui.boxRect, this.dragAdditive);
      } else {
        this.handleLeftClick(pos, e.shiftKey || e.ctrlKey);
      }
      this.dragSelecting = false;
      this.ui.boxRect = null;
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.deps.isChatOpen()) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.deps.openChat();
      return;
    }
    if (e.key === 'Escape') {
      if (this.ui.placement) {
        this.ui.placement = null;
        this.ui.wallDrag = null;
      } else if (this.gs.selection.size > 0) {
        this.gs.selection.clear();
      }
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      this.deps.onCenterHome();
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      const muted = this.sfx.toggleMute();
      music.setMuted(muted); // o mudo geral também cala a trilha
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      music.toggle();
      return;
    }
    if (e.key === '.') {
      e.preventDefault();
      this.deps.onIdleVillager(e.ctrlKey || e.shiftKey);
      return;
    }
    // Parar (X): interrompe mover/coletar/atacar das unidades selecionadas.
    // (o 'S' já é a câmera; por isso X.)
    if (e.key === 'x' || e.key === 'X') {
      const ids = this.gs.selectedOwnUnits().map((u) => u.id);
      if (ids.length) {
        this.deps.onCommand({ kind: 'stop', unitIds: ids });
        this.sfx.uiClick();
      }
      return;
    }
    // Apagar (Delete): remove as próprias unidades/prédio selecionados.
    if (e.key === 'Delete') {
      const ids = this.gs.selectedOwnUnits().map((u) => u.id);
      const b = this.gs.selectedBuilding();
      if (b && b.owner === this.gs.you) ids.push(b.id);
      if (ids.length) {
        this.deps.onCommand({ kind: 'delete', ids });
        this.gs.selection.clear();
        this.sfx.wreck(); // som de destruição
      }
      return;
    }
    // Ejetar (U): tira as unidades guarnecidas do prédio selecionado de volta ao mapa.
    if (e.key === 'u' || e.key === 'U') {
      const b = this.gs.selectedBuilding();
      if (b && b.owner === this.gs.you && b.garrison) {
        this.deps.onCommand({ kind: 'unload', buildingId: b.id });
        this.sfx.uiClick();
      }
      return;
    }
    // grupos de controle: Ctrl+1..9 salva a seleção; 1..9 seleciona o grupo;
    // apertar o número de novo em seguida centraliza a câmera nele (AoE2)
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const n = Number(e.key);
      if (e.ctrlKey) this.saveGroup(n);
      else this.recallGroup(n);
      return;
    }
    if (e.key in PAN_KEYS) {
      this.keysDown.add(e.key);
    }
  };

  private saveGroup(n: number): void {
    const ids = this.gs.selectedOwnUnits().map((u) => u.id);
    if (ids.length === 0) return;
    this.groups.set(n, ids);
    this.sfx.uiClick();
  }

  private recallGroup(n: number): void {
    const saved = this.groups.get(n);
    if (!saved) return;
    // filtra unidades que morreram desde que o grupo foi salvo
    const alive = saved.filter((id) => this.gs.units.has(id));
    if (alive.length === 0) {
      this.groups.delete(n);
      return;
    }
    this.groups.set(n, alive);
    this.gs.selection.clear();
    for (const id of alive) this.gs.selection.add(id);
    const first = this.gs.units.get(alive[0]);
    if (first) this.sfx.selectUnit(first.type);
    // segundo toque no mesmo número (até 500ms): centraliza no grupo
    const now = performance.now();
    if (this.lastGroupKey === n && now - this.lastGroupAt < 500) {
      let sx = 0;
      let sy = 0;
      for (const id of alive) {
        const u = this.gs.units.get(id);
        if (u) {
          const p = this.gs.unitPos(u, now);
          sx += p.x;
          sy += p.y;
        }
      }
      this.cam.centerOn(sx / alive.length, sy / alive.length);
    }
    this.lastGroupKey = n;
    this.lastGroupAt = now;
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.key);
  };

  // ---------------------------------------------------------------- seleção

  private handleLeftClick(pos: { x: number; y: number }, shift: boolean): void {
    const w = this.cam.screenToWorld(pos.x, pos.y);
    const pick = this.gs.pickAt(w.x, w.y, performance.now());
    if (!pick) {
      const tx = Math.floor(w.x), ty = Math.floor(w.y);
      const inside = tx >= 0 && ty >= 0 && tx < this.gs.map.size && ty < this.gs.map.size;
      this.sfx.selectTerrain(inside && this.gs.map.tiles[ty * this.gs.map.size + tx] === TILE_WATER);
      if (!shift) this.gs.selection.clear();
      return;
    }
    const id = pick.kind === 'unit' ? pick.unit.id : pick.kind === 'building' ? pick.building.id : pick.node.id;

    // som de seleção específico para cada tipo de objeto
    if (pick.kind === 'unit') this.sfx.selectUnit(pick.unit.type);
    else if (pick.kind === 'building') this.sfx.selectBuilding(pick.building.type);
    else this.sfx.selectNode(pick.node.type);

    if (shift) {
      if (this.gs.selection.has(id)) this.gs.selection.delete(id);
      else {
        // Não mistura unidade própria com prédio/nó numa seleção múltipla.
        if (pick.kind === 'unit' && pick.unit.owner === this.gs.you) {
          this.pruneToOwnUnitsOnly();
          this.gs.selection.add(id);
        } else {
          this.gs.selection.clear();
          this.gs.selection.add(id);
        }
      }
      return;
    }

    this.gs.selection.clear();
    this.gs.selection.add(id);
  }

  /** Duplo clique: seleciona todas as unidades próprias do MESMO tipo visíveis
   *  na tela (atalho clássico do AoE2 pra juntar o exército). */
  private selectAllOfTypeAt(pos: { x: number; y: number }): void {
    const w = this.cam.screenToWorld(pos.x, pos.y);
    const now = performance.now();
    const pick = this.gs.pickAt(w.x, w.y, now);
    if (pick?.kind !== 'unit' || pick.unit.owner !== this.gs.you) return;
    const type = pick.unit.type;
    this.gs.selection.clear();
    for (const u of this.gs.units.values()) {
      if (u.owner !== this.gs.you || u.type !== type) continue;
      const p = this.gs.unitPos(u, now);
      const s = this.cam.worldToScreen(p.x, p.y);
      if (s.x >= 0 && s.y >= 0 && s.x <= this.cam.viewW && s.y <= this.cam.viewH) {
        this.gs.selection.add(u.id);
      }
    }
    this.sfx.selectUnit(type);
  }

  private pruneToOwnUnitsOnly(): void {
    for (const id of [...this.gs.selection]) {
      const u = this.gs.units.get(id);
      if (!u || u.owner !== this.gs.you) this.gs.selection.delete(id);
    }
  }

  private finishBoxSelect(box: { x0: number; y0: number; x1: number; y1: number }, additive: boolean): void {
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const y1 = Math.max(box.y0, box.y1);
    const now = performance.now();
    const found: number[] = [];
    for (const u of this.gs.units.values()) {
      if (u.owner !== this.gs.you) continue;
      const p = this.gs.unitPos(u, now);
      const s = this.cam.worldToScreen(p.x, p.y);
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) found.push(u.id);
    }
    if (!additive) this.gs.selection.clear();
    else this.pruneToOwnUnitsOnly();
    for (const id of found) this.gs.selection.add(id);
    const first = found.length ? this.gs.units.get(found[0]) : undefined;
    if (first) this.sfx.selectUnit(first.type);
  }

  // ---------------------------------------------------------------- comandos

  /** Despacha um comando e toca o som correspondente à ação. */
  private cmd(c: GameCommand): void {
    switch (c.kind) {
      case 'attack': this.sfx.cmdAttack(); break;
      case 'gather': this.sfx.cmdGather(); break;
      case 'build': this.sfx.cmdBuild(); break;
      default: this.sfx.cmdMove(); break; // move / setRally
    }
    this.deps.onCommand(c);
  }

  /** Registra o feedback visual da ordem (anel no chão / pulso no alvo). */
  private mark(kind: 'move' | 'gather' | 'attack' | 'build', x: number, y: number, targetId?: number): void {
    this.ui.orders.push({ kind, x, y, targetId, at: performance.now() });
    if (this.ui.orders.length > 10) this.ui.orders.shift();
  }

  private handleRightClick(pos: { x: number; y: number }, queue = false): void {
    const w = this.cam.screenToWorld(pos.x, pos.y);
    const ownUnits = this.gs.selectedOwnUnits();

    if (ownUnits.length > 0) {
      const pick = this.gs.pickAt(w.x, w.y, performance.now());
      const unitIds = ownUnits.map((u) => u.id);
      const hasVillager = ownUnits.some((u) => u.type === 'villager');

      if (pick?.kind === 'node') {
        if (hasVillager) {
          this.mark('gather', w.x, w.y, pick.node.id);
          this.cmd({ kind: 'gather', unitIds, targetId: pick.node.id });
        }
        return;
      }
      if (pick?.kind === 'building') {
        const b = pick.building;
        if (b.owner === this.gs.you) {
          if ((b.progress ?? 1) < 1 && hasVillager) {
            this.mark('build', w.x, w.y, b.id);
            this.cmd({ kind: 'build', unitIds, building: b.type, tileX: b.tileX, tileY: b.tileY });
            return;
          }
          if (b.type === 'farm' && (b.progress ?? 1) >= 1 && hasVillager) {
            this.mark('gather', w.x, w.y, b.id);
            this.cmd({ kind: 'gather', unitIds, targetId: b.id });
            return;
          }
          // prédio próprio pronto e DANIFICADO + aldeão → reparar (recupera a vida)
          if (hasVillager && (b.progress ?? 1) >= 1 && b.hp < (BUILDING_DEFS[b.type]?.hp ?? b.hp)) {
            this.mark('build', w.x, w.y, b.id);
            this.cmd({ kind: 'repair', unitIds, targetId: b.id });
            return;
          }
          // torre/Centro próprio pronto + unidades → GUARNECER (entram dentro)
          if ((b.progress ?? 1) >= 1 && GARRISON_CAP[b.type]) {
            this.mark('build', w.x, w.y, b.id);
            this.cmd({ kind: 'garrison', unitIds, targetId: b.id });
            return;
          }
          // prédio próprio completo sem ação de gather/build: cai para mover
          this.mark('move', w.x, w.y);
          this.cmd({ kind: 'move', unitIds, x: w.x, y: w.y, queue });
          return;
        }
        // prédio inimigo
        this.mark('attack', w.x, w.y, b.id);
        this.cmd({ kind: 'attack', unitIds, targetId: b.id });
        return;
      }
      if (pick?.kind === 'unit') {
        if (pick.unit.owner !== this.gs.you) {
          this.mark('attack', w.x, w.y, pick.unit.id);
          this.cmd({ kind: 'attack', unitIds, targetId: pick.unit.id });
          return;
        }
        // unidade própria sob o cursor: move até a posição (comportamento simples)
        this.mark('move', w.x, w.y);
        this.cmd({ kind: 'move', unitIds, x: w.x, y: w.y, queue });
        return;
      }
      this.mark('move', w.x, w.y);
      this.cmd({ kind: 'move', unitIds, x: w.x, y: w.y, queue });
      return;
    }

    // Nenhuma unidade selecionada: prédio de produção próprio selecionado -> setRally
    const b = this.gs.selectedBuilding();
    if (b && b.owner === this.gs.you) {
      const def = BUILDING_DEFS[b.type];
      if (def && def.trains.length > 0) {
        this.cmd({ kind: 'setRally', buildingId: b.id, x: w.x, y: w.y });
      }
    }
  }

  // ---------------------------------------------------------------- posicionamento

  startPlacement(type: BuildingType): void {
    this.ui.placement = type;
    this.ui.wallDrag = null;
  }

  /** Fim do arrasto de muralha: constrói uma LINHA de muros do início ao cursor.
   *  Tiles ocupados (prédio/torre no meio, ou água) são PULADOS — o que já existe
   *  vira parte da muralha sem quebrar a linha. Limita ao que dá pra pagar. */
  private finishWallDrag(): void {
    const start = this.ui.wallDrag;
    this.ui.wallDrag = null;
    if (!start) return;
    const end = ghostTile(this.ui, this.cam, 'wall');
    const villagers = this.gs.selectedOwnUnits().filter((u) => u.type === 'villager');
    const unitIds = villagers.map((u) => u.id);
    const cost = BUILDING_DEFS.wall.cost.stone ?? 10;
    let budget = Math.floor((this.gs.me()?.resources?.stone ?? 0) / cost);
    let built = 0;
    for (const t of wallLineTiles(start, end)) {
      if (budget <= 0) break;
      if (!this.gs.canPlace('wall', t.x, t.y)) continue; // ocupado/água: pula
      this.deps.onBuildCommand('wall', t.x, t.y, unitIds, true); // enfileira em sequência
      budget--;
      built++;
    }
    if (built > 0) this.sfx.place();
    // a ferramenta de muralha segue ativa (desenhar outro trecho); sai com botão
    // direito ou Esc — igual ao Age of Empires.
  }

  private tryPlaceAt(pos: { x: number; y: number }, keepPlacing = false): void {
    const type = this.ui.placement;
    if (!type) return;
    const t = ghostTile(this.ui, this.cam, type);
    if (!this.gs.canPlace(type, t.x, t.y)) return;
    const villagers = this.gs.selectedOwnUnits().filter((u) => u.type === 'villager');
    const unitIds = villagers.map((u) => u.id);
    // Ctrl/Shift (keepPlacing): enfileira a obra no aldeão em vez de substituir
    this.deps.onBuildCommand(type, t.x, t.y, unitIds, keepPlacing);
    this.sfx.place();
    // com Ctrl/Shift o modo continua ativo pra emendar a próxima construção
    if (!keepPlacing) this.ui.placement = null;
  }
}
