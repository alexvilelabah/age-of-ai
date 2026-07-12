// Câmera 2D ISOMÉTRICA (dimetro 2:1, estilo Age of Empires 2).
// Mantém a MESMA interface pública da câmera antiga, para que input.ts e
// state.pickAt() (que trabalham em coordenadas de mundo/tile) não mudem.
//
// Projeção (tile -> tela), com metades de tile HW e HH (proporção 2:1 => HH = HW/2):
//   isoX = (wx - wy) * HW ;  isoY = (wx + wy) * HH
// A câmera centraliza o alvo (x, y) no meio da viewport e aplica o zoom.
//   screen.x = (wx - wy) * HW*z + cx ;  screen.y = (wx + wy) * HH*z + cy
//   onde cx = viewW/2 - (x - y)*HW*z  e  cy = viewH/2 - (x + y)*HH*z
// A inversa (tela -> mundo) resolve o sistema para permitir clique/seleção.

export const TILE_PX = 32; // legado; mantido só por compatibilidade de imports

// Meia-largura / meia-altura de um tile em pixels (zoom 1). Losango 2:1: HW = 2*HH.
export const ISO_HW = 32;
export const ISO_HH = 16;

// Zoom FIXO (como no Age of Empires 2 clássico — sem zoom por roda do mouse).
// Manter fixo também limita a quantidade de tiles desenhados por frame
// (sem zoom-out não existe o pior caso de milhares de tiles), o que ajuda o
// desempenho. Ajuste este único número se quiser a câmera mais perto/longe.
export const VIEW_ZOOM = 1.1;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Camera {
  /** Alvo da câmera no mundo (tile X). */
  x = 0;
  /** Alvo da câmera no mundo (tile Y). */
  y = 0;
  /** Zoom fixo (não muda em jogo). */
  readonly zoom = VIEW_ZOOM;
  /** Tamanho da viewport em pixels CSS. */
  viewW = 1;
  viewH = 1;

  constructor(private mapSize: number) {
    this.x = mapSize / 2;
    this.y = mapSize / 2;
  }

  /** Aproximação de pixels CSS por tile (largura), para usos legados. */
  get scale(): number {
    return 2 * ISO_HW * this.zoom;
  }

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.clampToMap();
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const hw = ISO_HW * this.zoom;
    const hh = ISO_HH * this.zoom;
    const cx = this.viewW / 2 - (this.x - this.y) * hw;
    const cy = this.viewH / 2 - (this.x + this.y) * hh;
    return { x: (wx - wy) * hw + cx, y: (wx + wy) * hh + cy };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const hw = ISO_HW * this.zoom;
    const hh = ISO_HH * this.zoom;
    const cx = this.viewW / 2 - (this.x - this.y) * hw;
    const cy = this.viewH / 2 - (this.x + this.y) * hh;
    const dx = sx - cx; // = (wx - wy) * hw
    const dy = sy - cy; // = (wx + wy) * hh
    const a = dx / hw; // wx - wy
    const b = dy / hh; // wx + wy
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
    this.clampToMap();
  }

  /** Arrasta o mundo pela viewport (dxPx/dyPx = -delta do mouse, vindo do input). */
  panPx(dxPx: number, dyPx: number): void {
    // Converte o deslocamento de tela para deslocamento de mundo e move o alvo.
    const center = this.screenToWorld(this.viewW / 2, this.viewH / 2);
    const shifted = this.screenToWorld(this.viewW / 2 + dxPx, this.viewH / 2 + dyPx);
    this.x += center.x - shifted.x;
    this.y += center.y - shifted.y;
    this.clampToMap();
  }

  clampToMap(): void {
    const m = 4;
    this.x = clamp(this.x, -m, this.mapSize + m);
    this.y = clamp(this.y, -m, this.mapSize + m);
  }
}
