// Minimapa em LOSANGO (dimetro isométrico, estilo Age of Empires 2): o mapa
// aparece como um losango (cantos pra cima/baixo e pros lados), não um quadrado.
// Mostra terreno, entidades nas cores dos donos e o retângulo da câmera;
// clique/arrasto move a câmera.

import { BUILDING_DEFS, TILE_WATER } from '@age/shared';
import { t } from '../i18n';
import type { GameState } from '../state';
import { el } from '../ui';
import type { Camera } from './camera';
import { MINIMAP_NODE_COLORS } from './renderer';

// Dimensões do minimapa (px CSS). O losango preenche a área com uma margem.
const MINI_W = 240;
const MINI_H = 150;
const MARGIN = 6;
const HWm = MINI_W / 2 - MARGIN; // meia-largura do losango
const HHm = MINI_H / 2 - MARGIN; // meia-altura do losango
const CXM = MINI_W / 2;
const CYM = MINI_H / 2;
const PING_MS = 2500; // duração do anel de ping no minimapa

export interface MinimapDeps {
  /** Botão direito no minimapa: manda a seleção pra lá. */
  onOrderMove?: (worldX: number, worldY: number, queue?: boolean) => void;
  /** Canto ⚔: reunir todo o exército. */
  onSelectArmy?: () => void;
  /** Canto 🏠: centralizar na base (Centro da Cidade). */
  onCenterHome?: () => void;
  /** Canto 👷: selecionar o próximo aldeão ocioso. */
  onIdleVillager?: () => void;
  /** Canto 🚩: sinalizar (ping) um ponto pros aliados. */
  onPing?: (worldX: number, worldY: number) => void;
}

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private terrain: HTMLCanvasElement;
  private dragging = false;
  private pingMode = false;
  private pingBtn: HTMLButtonElement | null = null;
  private onWinMove = (e: MouseEvent): void => {
    if (this.dragging) this.jump(e);
  };
  private onWinUp = (): void => {
    this.dragging = false;
  };

  constructor(
    private gs: GameState,
    private cam: Camera,
    private deps: MinimapDeps = {},
  ) {
    this.el = el('div', 'minimap-wrap');
    this.canvas = el('canvas');
    this.canvas.id = 'minimap';
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(MINI_W * dpr);
    this.canvas.height = Math.round(MINI_H * dpr);
    this.canvas.style.width = `${MINI_W}px`;
    this.canvas.style.height = `${MINI_H}px`;
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.terrain = this.buildTerrain();

    this.buildCornerButtons();

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        if (this.pingMode) {
          // modo ping ligado: o clique esquerdo sinaliza o ponto pros aliados
          const w = this.eventToWorld(e);
          if (w) this.deps.onPing?.(w.x, w.y);
          this.setPingMode(false);
          return;
        }
        // esquerdo: leva a câmera pra lá (arrasto move junto)
        this.dragging = true;
        this.jump(e);
      } else if (e.button === 2) {
        // direito: manda as unidades selecionadas pra lá (estilo AoE)
        e.preventDefault();
        const w = this.eventToWorld(e);
        if (w) this.deps.onOrderMove?.(w.x, w.y, e.shiftKey);
      }
    });
    window.addEventListener('mousemove', this.onWinMove);
    window.addEventListener('mouseup', this.onWinUp);
  }

  /** 4 atalhos nos cantos triangulares vazios do quadro (estilo AoE). */
  private buildCornerButtons(): void {
    const make = (cls: string, icon: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = el('button', `mini-corner ${cls}`) as HTMLButtonElement;
      b.type = 'button';
      b.textContent = icon;
      b.title = title;
      // não deixa o clique no botão virar jump/ping no canvas
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        onClick();
      });
      this.el.appendChild(b);
      return b;
    };
    make('tl', '⚔', t('mini.army'), () => this.deps.onSelectArmy?.());
    make('tr', '👷', t('mini.idle'), () => this.deps.onIdleVillager?.());
    make('bl', '🏠', t('mini.base'), () => this.deps.onCenterHome?.());
    this.pingBtn = make('br', '🚩', t('mini.ping'), () => this.setPingMode(!this.pingMode));
  }

  private setPingMode(on: boolean): void {
    this.pingMode = on;
    this.pingBtn?.classList.toggle('active', on);
    this.canvas.style.cursor = on ? 'crosshair' : '';
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.onWinMove);
    window.removeEventListener('mouseup', this.onWinUp);
  }

  /** Imagem quadrada NxN do terreno (1 px por tile); é distorcida em losango no draw. */
  private buildTerrain(): HTMLCanvasElement {
    const size = this.gs.map.size;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return c;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = this.gs.map.tiles[y * size + x];
        ctx.fillStyle = v === TILE_WATER ? '#2b5e8c' : '#3b5528';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  /** Tile do mundo (tx, ty) -> ponto no minimapa (px CSS). */
  private project(tx: number, ty: number): { x: number; y: number } {
    const n = this.gs.map.size;
    const u = (tx - ty) / n; // -1 (esq) .. 1 (dir)
    const v = (tx + ty) / n - 1; // -1 (topo) .. 1 (base)
    return { x: CXM + u * HWm, y: CYM + v * HHm };
  }

  /** Ponto no minimapa (px CSS) -> tile do mundo. Inversa de project. */
  private unproject(mx: number, my: number): { x: number; y: number } {
    const n = this.gs.map.size;
    const a = ((mx - CXM) / HWm) * n; // tx - ty
    const b = ((my - CYM) / HHm + 1) * n; // tx + ty
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** Ponto do MUNDO (tile) correspondente ao clique no minimapa. */
  private eventToWorld(e: MouseEvent): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const mx = ((e.clientX - rect.left) / rect.width) * MINI_W;
    const my = ((e.clientY - rect.top) / rect.height) * MINI_H;
    return this.unproject(mx, my);
  }

  private jump(e: MouseEvent): void {
    const w = this.eventToWorld(e);
    if (w) this.cam.centerOn(w.x, w.y);
  }

  draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINI_W, MINI_H); // fora do losango fica transparente (fundo preto do quadro)

    // --- terreno: desenha a imagem NxN distorcida no losango (transformada afim) ---
    const n = this.gs.map.size;
    const a = HWm / n, d = HHm / n;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(a, d, -a, d, CXM, CYM - HHm); // (ix,iy) -> losango
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // escala aproximada de px por tile (pro tamanho dos pontos)
    const kk = Math.max(2, (2 * HWm) / n);

    for (const nd of this.gs.nodes.values()) {
      const p = this.project(nd.tileX + 0.5, nd.tileY + 0.5);
      ctx.fillStyle = MINIMAP_NODE_COLORS[nd.type] ?? '#888888';
      ctx.fillRect(p.x - kk / 2, p.y - kk / 2, kk, kk);
    }
    for (const b of this.gs.buildings.values()) {
      const s = BUILDING_DEFS[b.type]?.size ?? 1;
      const p = this.project(b.tileX + s / 2, b.tileY + s / 2);
      const r = Math.max(3, kk * s * 0.7);
      ctx.fillStyle = this.gs.colorOf(b.owner);
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }
    for (const u of this.gs.units.values()) {
      const pos = this.gs.unitPos(u, now);
      const p = this.project(pos.x, pos.y);
      ctx.fillStyle = this.gs.colorOf(u.owner);
      ctx.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
    }
    for (const s of this.gs.sheep.values()) {
      const p = this.project(s.x, s.y);
      ctx.fillStyle = this.gs.isWildSheep(s) ? '#f4f2ee' : this.gs.colorOf(s.owner);
      ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
    }

    // --- borda do losango ---
    const top = this.project(0, 0), right = this.project(n, 0);
    const bot = this.project(n, n), left = this.project(0, n);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.stroke();

    // --- área visível da câmera (quadrilátero dos 4 cantos da tela) ---
    const corners = [
      this.cam.screenToWorld(0, 0),
      this.cam.screenToWorld(this.cam.viewW, 0),
      this.cam.screenToWorld(this.cam.viewW, this.cam.viewH),
      this.cam.screenToWorld(0, this.cam.viewH),
    ];
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, i) => {
      const p = this.project(c.x, c.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();

    // --- pings dos aliados: anel que expande e some (~2.5s), na cor do dono ---
    const pings = this.gs.pings;
    if (pings.length) {
      for (const ping of pings) {
        const k = (now - ping.at) / PING_MS; // 0..1
        if (k < 0 || k > 1) continue;
        const p = this.project(ping.x, ping.y);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = ping.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + k * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // poda os que já sumiram (a lista só cresce por cliques manuais)
      if (pings.some((pg) => now - pg.at > PING_MS)) {
        this.gs.pings = pings.filter((pg) => now - pg.at <= PING_MS);
      }
    }
  }
}
