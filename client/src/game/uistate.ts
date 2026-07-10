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
  /** Marcadores de ordem recentes (podados pelo renderer). */
  orders: OrderMarker[];
}

export function createUIState(): UIState {
  return { placement: null, mouseX: 0, mouseY: 0, hasMouse: false, boxRect: null, orders: [] };
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
