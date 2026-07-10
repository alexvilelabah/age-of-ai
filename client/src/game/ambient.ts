// Vida ambiente (puramente decorativa, sem lógica de jogo): a coruja que cruza
// o céu (e pia ~1x/min), gaivotas circulando sobre a água e cardumes de peixe
// sob a superfície dos lagos. Tudo em coordenadas de mundo, então acompanha o
// pan da câmera.

import { TILE_WATER } from '@age/shared';
import type { GameState } from '../state';
import type { Camera } from './camera';

interface Owl {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alt: number; // altura visual (px em zoom 1)
  phase: number;
  flap: number; // velocidade do bater de asas
  size: number;
}

interface WaterBody {
  cx: number;
  cy: number;
  tiles: number; // quantidade de tiles (tamanho)
}

interface Gull {
  bodyIdx: number;
  angle: number;
  radius: number;
  spin: number;
  alt: number;
}

interface Fish {
  hx: number; // "casa" (tile de água) — peixe vagueia em volta
  hy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

export class Ambient {
  private owls: Owl[] = [];
  private owlTimer = 2 + Math.random() * 4; // primeira coruja em ~2-6s
  private bodies: WaterBody[] = [];
  private gulls: Gull[] = [];
  private fish: Fish[] = [];
  private lastT = 0;

  constructor(private gs: GameState) {
    this.findWater();
  }

  // --- localiza corpos d'água (flood fill) e semeia gaivotas + peixes ---
  private findWater(): void {
    const size = this.gs.map.size;
    const tiles = this.gs.map.tiles;
    const isW = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < size && y < size && tiles[y * size + x] === TILE_WATER;
    const seen = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (seen[i] || !isW(x, y)) continue;
        // BFS do corpo
        const stack = [[x, y]];
        seen[i] = 1;
        let sx = 0, sy = 0, n = 0;
        const bodyTiles: [number, number][] = [];
        while (stack.length) {
          const [cx, cy] = stack.pop() as [number, number];
          sx += cx; sy += cy; n++;
          bodyTiles.push([cx, cy]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy, ni = ny * size + nx;
            if (isW(nx, ny) && !seen[ni]) { seen[ni] = 1; stack.push([nx, ny]); }
          }
        }
        if (n < 4) continue; // ignora poças minúsculas
        const bodyIdx = this.bodies.length;
        this.bodies.push({ cx: sx / n + 0.5, cy: sy / n + 0.5, tiles: n });
        // gaivotas: 1 + tamanho, cap 3 por corpo
        const gulls = Math.min(3, 1 + Math.floor(n / 14));
        for (let g = 0; g < gulls; g++) {
          this.gulls.push({
            bodyIdx,
            angle: Math.random() * Math.PI * 2,
            radius: 1.2 + Math.random() * Math.max(1, Math.min(3, n / 8)),
            spin: (0.3 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1),
            alt: 26 + Math.random() * 14,
          });
        }
        // peixes: ~1 a cada 3 tiles, cap 8 por corpo e ~40 no total
        const fishCount = Math.min(8, Math.max(1, Math.floor(n / 3)));
        for (let f = 0; f < fishCount && this.fish.length < 40; f++) {
          const [tx, ty] = bodyTiles[(Math.random() * bodyTiles.length) | 0];
          this.fish.push({
            hx: tx + 0.5, hy: ty + 0.5, x: tx + 0.5, y: ty + 0.5,
            vx: 0, vy: 0, phase: Math.random() * 6,
          });
        }
      }
    }
  }

  private freshOwl(nearX: number, nearY: number, viewR: number): Owl {
    const a = Math.random() * Math.PI * 2;
    const speed = 2.0 + Math.random() * 1.4; // coruja voa calmo
    // entra por uma borda do "raio de vista" apontando para dentro
    const edge = Math.random() * Math.PI * 2;
    return {
      x: nearX + Math.cos(edge) * (viewR + 3),
      y: nearY + Math.sin(edge) * (viewR + 3),
      vx: -Math.cos(edge) * speed + Math.cos(a) * 0.5,
      vy: -Math.sin(edge) * speed + Math.sin(a) * 0.5,
      alt: 34 + Math.random() * 22,
      phase: Math.random() * 6,
      flap: 4.5 + Math.random() * 2, // batida lenta, com planagem
      size: 1.3 + Math.random() * 0.4,
    };
  }

  private update(cam: Camera, now: number): void {
    if (this.lastT === 0) this.lastT = now;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    // centro do mundo visível + raio aproximado
    const ctr = cam.screenToWorld(cam.viewW / 2, cam.viewH / 2);
    const edge = cam.screenToWorld(0, 0);
    const viewR = Math.max(6, Math.hypot(ctr.x - edge.x, ctr.y - edge.y));

    // uma única coruja ocasional: só nasce outra depois que a anterior sai da tela
    this.owlTimer -= dt;
    if (this.owls.length === 0 && this.owlTimer <= 0) {
      this.owls.push(this.freshOwl(ctr.x, ctr.y, viewR));
      this.owlTimer = 12 + Math.random() * 16; // próxima daqui a ~12-28s
    }
    for (let i = this.owls.length - 1; i >= 0; i--) {
      const b = this.owls[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.phase += b.flap * dt;
      if (Math.hypot(b.x - ctr.x, b.y - ctr.y) > viewR + 8) this.owls.splice(i, 1);
    }

    for (const g of this.gulls) g.angle += g.spin * dt;

    for (const f of this.fish) {
      f.vx += (Math.random() - 0.5) * 3 * dt - (f.x - f.hx) * 0.8 * dt;
      f.vy += (Math.random() - 0.5) * 3 * dt - (f.y - f.hy) * 0.8 * dt;
      const sp = Math.hypot(f.vx, f.vy), max = 0.7;
      if (sp > max) { f.vx = (f.vx / sp) * max; f.vy = (f.vy / sp) * max; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.phase += 4 * dt;
    }
  }

  private onScreen(cam: Camera, sx: number, sy: number, m = 40): boolean {
    return sx > -m && sy > -m && sx < cam.viewW + m && sy < cam.viewH + m;
  }

  // --- peixes (sob a água) — desenhar logo após o terreno ---
  drawWater(ctx: CanvasRenderingContext2D, cam: Camera, now: number): void {
    this.update(cam, now);
    const z = cam.zoom;
    for (const f of this.fish) {
      const s = cam.worldToScreen(f.x, f.y);
      if (!this.onScreen(cam, s.x, s.y, 10)) continue;
      const len = 7 * z;
      const ang = Math.atan2(f.vy, f.vx);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);
      // corpo
      ctx.fillStyle = 'rgba(15,35,50,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.5, len * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // cauda
      ctx.beginPath();
      ctx.moveTo(-len * 0.45, 0);
      ctx.lineTo(-len * 0.7, -len * 0.18);
      ctx.lineTo(-len * 0.7, len * 0.18);
      ctx.closePath();
      ctx.fill();
      // brilho
      ctx.fillStyle = 'rgba(210,235,245,0.28)';
      ctx.beginPath();
      ctx.ellipse(len * 0.1 + Math.sin(f.phase) * len * 0.1, -len * 0.05, len * 0.16, len * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- borboletas, gaivotas e pássaros (por cima de tudo) ---
  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, _now: number): void {
    const z = cam.zoom;

    // gaivotas (brancas, circulando sobre a água)
    for (const g of this.gulls) {
      const body = this.bodies[g.bodyIdx];
      const wx = body.cx + Math.cos(g.angle) * g.radius;
      const wy = body.cy + Math.sin(g.angle) * g.radius * 0.7;
      const s = cam.worldToScreen(wx, wy);
      const y = s.y - g.alt * z;
      if (!this.onScreen(cam, s.x, y)) continue;
      this.wing(ctx, s.x, y, 6 * z, 0.6 + Math.abs(Math.sin(g.angle * 6)) * 0.7, 'rgba(240,244,250,0.9)', 1.4 * z);
    }

    // coruja (silhueta parda com cabeça grande e tufos; bate as asas e plana)
    for (const b of this.owls) {
      const s = cam.worldToScreen(b.x, b.y);
      const y = s.y - b.alt * z;
      if (!this.onScreen(cam, s.x, y, 50)) continue;
      // sombra sutil no chão
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 4.5 * z * b.size, 1.8 * z * b.size, 0, 0, Math.PI * 2);
      ctx.fill();
      const w = 8 * z * b.size;
      const dir = b.vx >= 0 ? 1 : -1;
      // planagem: períodos com as asas estendidas, sem bater
      const gliding = Math.sin(b.phase * 0.21) > 0.35;
      const flap = gliding ? 0.28 : 0.45 + Math.abs(Math.sin(b.phase)) * 0.85;
      const body = 'rgba(64,50,32,0.85)';
      // asas
      this.wing(ctx, s.x, y, w, flap, 'rgba(52,40,26,0.8)', 2 * z * b.size);
      // corpo atarracado + cauda curta
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(s.x, y + w * 0.06, w * 0.32, w * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s.x - dir * w * 0.26, y + w * 0.02);
      ctx.lineTo(s.x - dir * w * 0.48, y + w * 0.14);
      ctx.lineTo(s.x - dir * w * 0.3, y + w * 0.18);
      ctx.closePath();
      ctx.fill();
      // cabeça grande e redonda (marca registrada da coruja) + tufos
      const hx = s.x + dir * w * 0.34;
      const hy = y - w * 0.02;
      ctx.beginPath();
      ctx.arc(hx, hy, w * 0.19, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = body;
      ctx.lineWidth = Math.max(1, 1.1 * z * b.size);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx - w * 0.1, hy - w * 0.14);
      ctx.lineTo(hx - w * 0.16, hy - w * 0.28);
      ctx.moveTo(hx + w * 0.1, hy - w * 0.14);
      ctx.lineTo(hx + w * 0.16, hy - w * 0.28);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // olhos claros (2 pontinhos — visíveis só de perto, baratos)
      ctx.fillStyle = 'rgba(240,220,150,0.9)';
      ctx.beginPath();
      ctx.arc(hx - w * 0.07, hy - w * 0.02, Math.max(0.6, w * 0.04), 0, Math.PI * 2);
      ctx.arc(hx + w * 0.07, hy - w * 0.02, Math.max(0.6, w * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Desenha um par de asas em "M" (pássaro/gaivota). */
  private wing(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, flap: number, color: string, lw: number): void {
    const h = w * 0.5 * flap;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, lw);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w * 0.4, y - h, x, y - h * 0.15);
    ctx.quadraticCurveTo(x + w * 0.4, y - h, x + w, y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}
