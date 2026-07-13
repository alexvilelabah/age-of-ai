// Névoa de guerra (só cliente, estilo Age of Empires): três estados por tile —
// nunca visto (PRETO), já explorado mas fora de vista (ESCURECIDO) e à vista
// (claro). A lógica (arrays por tile) é separada da apresentação (um canvas de
// 1 pixel por tile que o renderer/minimapa esticam com suavização bilinear — o
// mesmo truque afim do terreno do minimapa), o que dá borda de névoa MACIA sem
// quadriculado e deixa a lógica testável headless (sem DOM).

export interface VisionSource {
  x: number; // centro da visão em coordenadas de tile (pode ser fracionário)
  y: number;
  r: number; // raio de visão em tiles
}

// Alphas do overlay (0..255): preto total no nunca-visto, meia-luz no explorado.
const ALPHA_UNEXPLORED = 255;
const ALPHA_EXPLORED = 128;

export class FogOfWar {
  readonly size: number;
  /** 1 = à vista AGORA (recalculado a cada snapshot). Índice ty*size+tx. */
  visible: Uint8Array;
  /** 1 = já explorado alguma vez (persiste a partida inteira). */
  explored: Uint8Array;
  /** Canvas 1px-por-tile com o escuro; null fora do navegador (testes). */
  readonly canvas: HTMLCanvasElement | null = null;
  private ictx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private revealed = false;

  constructor(size: number) {
    this.size = size;
    this.visible = new Uint8Array(size * size);
    this.explored = new Uint8Array(size * size);
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = size;
      this.canvas.height = size;
      this.ictx = this.canvas.getContext('2d');
      if (this.ictx) this.img = this.ictx.createImageData(size, size);
    }
    this.updateImage(); // começa tudo preto
  }

  isVisible(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return false;
    return this.visible[ty * this.size + tx] === 1;
  }

  isExplored(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return false;
    return this.explored[ty * this.size + tx] === 1;
  }

  /** Fim de jogo (estilo AoE): revela o mapa inteiro de vez. */
  revealAll(): void {
    this.revealed = true;
    this.visible.fill(1);
    this.explored.fill(1);
    this.updateImage();
  }

  /**
   * Recalcula o "à vista" a partir das fontes (unidades/prédios/ovelhas do
   * jogador e aliados) e acumula o "explorado". Um tile conta como visto se o
   * CENTRO dele (tx+0.5, ty+0.5) cai dentro do círculo da fonte.
   */
  recompute(sources: VisionSource[]): void {
    if (this.revealed) return;
    this.visible.fill(0);
    const n = this.size;
    for (const s of sources) {
      if (s.r <= 0) continue;
      const r2 = s.r * s.r;
      const ty0 = Math.max(0, Math.ceil(s.y - s.r - 0.5));
      const ty1 = Math.min(n - 1, Math.floor(s.y + s.r - 0.5));
      for (let ty = ty0; ty <= ty1; ty++) {
        const dy = ty + 0.5 - s.y;
        const hw = Math.sqrt(Math.max(0, r2 - dy * dy));
        const tx0 = Math.max(0, Math.ceil(s.x - hw - 0.5));
        const tx1 = Math.min(n - 1, Math.floor(s.x + hw - 0.5));
        const row = ty * n;
        for (let tx = tx0; tx <= tx1; tx++) {
          this.visible[row + tx] = 1;
          this.explored[row + tx] = 1;
        }
      }
    }
    this.updateImage();
  }

  /** Regrava o canvas (preto/alpha) a partir dos arrays. Barato: size² px. */
  private updateImage(): void {
    if (!this.ictx || !this.img) return;
    const d = this.img.data;
    const total = this.size * this.size;
    for (let i = 0; i < total; i++) {
      // RGB preto; só o alpha varia por estado.
      const a = this.visible[i] ? 0 : this.explored[i] ? ALPHA_EXPLORED : ALPHA_UNEXPLORED;
      d[i * 4 + 3] = a;
    }
    this.ictx.putImageData(this.img, 0, 0);
  }
}
