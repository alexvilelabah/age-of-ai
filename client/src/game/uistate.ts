// Estado de UI compartilhado entre input e renderer (modo de posicionamento,
// posição do mouse, retângulo de seleção em arrasto).

import type { BuildingType } from '@age/shared';
import { BUILDING_DEFS } from '@age/shared';
import type { Camera } from './camera';

/** Marcador visual de ORDEM dada (feedback do botão direito): anel no chão
 *  (mover) ou pulso no alvo (coletar/atacar/construir). Some sozinho. */
export interface OrderMarker {
  kind: 'move' | 'gather' | 'attack' | 'build';
  /** Ponto no mundo (mover) ou fallback quando o alvo some. */
  x: number;
  y: number;
  /** Objeto alvo (o pulso acompanha ele), se houver. */
  targetId?: number;
  /** performance.now() de quando a ordem foi dada. */
  at: number;
}

export interface UIState {
  /** Tipo de prédio em modo de posicionamento, ou null. */
  placement: BuildingType | null;
  /** Posição do mouse em pixels CSS relativos ao canvas. */
  mouseX: number;
  mouseY: number;
  hasMouse: boolean;
  /** Retângulo de seleção (pixels de tela) durante arrasto, ou null. */
  boxRect: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Ao arrastar pra construir MURALHA: tile de início do arrasto, ou null.
   *  Enquanto setado, a prévia mostra a linha inteira e ao soltar constrói. */
  wallDrag: { x: number; y: number } | null;
  /** Marcadores de ordem recentes (podados pelo renderer). */
  orders: OrderMarker[];
}

export function createUIState(): UIState {
  return { placement: null, mouseX: 0, mouseY: 0, hasMouse: false, boxRect: null, wallDrag: null, orders: [] };
}

/** Tiles (1x1) de uma linha de muralha do início do arrasto até o cursor. Segue
 *  a reta pelo eixo dominante (contíguo, sem repetir) — reta em X/Y ou diagonal,
 *  como no Age of Empires. */
export function wallLineTiles(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) || 0;
  const tiles: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const f = steps === 0 ? 0 : i / steps;
    const x = Math.round(start.x + dx * f);
    const y = Math.round(start.y + dy * f);
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Tile superior-esquerdo do fantasma de posicionamento (centrado no cursor). */
export function ghostTile(
  ui: UIState,
  cam: Camera,
  type: BuildingType,
): { x: number; y: number } {
  const w = cam.screenToWorld(ui.mouseX, ui.mouseY);
  const size = BUILDING_DEFS[type]?.size ?? 1;
  return { x: Math.round(w.x - size / 2), y: Math.round(w.y - size / 2) };
}
