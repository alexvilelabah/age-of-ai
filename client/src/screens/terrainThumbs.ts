// Miniaturas SVG estáticas dos 3 mapas (Terreno) — mostram a FORMA típica de
// cada terreno pra escolher na sala, sem depender de dados reais gerados pelo
// servidor. Paleta igual à do minimapa (client/src/game/minimap.ts) pra bater
// com a cor real do jogo.
import type { TerrainKind } from '@age/shared';

const GRASS = '#3b5528';
const WATER = '#2b5e8c';
const SAND = '#c2b184';
const FISH = '#bfe3f2';
const HULL = '#4a3421';
const HULL2 = '#6b4a2c';

export const TERRAIN_THUMB_SVG: Record<TerrainKind, string> = {
  classic: `
    <svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="40" fill="${GRASS}"/>
      <ellipse cx="30" cy="21" rx="16" ry="10" fill="${SAND}"/>
      <ellipse cx="30" cy="21" rx="12" ry="7" fill="${WATER}"/>
    </svg>`,
  river: `
    <svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="40" fill="${GRASS}"/>
      <polygon points="0,4 16,0 60,32 60,40 44,40 0,12" fill="${WATER}"/>
      <rect x="10" y="6" width="7" height="14" transform="rotate(28 13.5 13)" fill="${SAND}"/>
      <rect x="38" y="20" width="7" height="14" transform="rotate(28 41.5 27)" fill="${SAND}"/>
      <circle cx="30" cy="18" r="1.6" fill="${FISH}"/>
    </svg>`,
  strait: `
    <svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="40" fill="${GRASS}"/>
      <polygon points="0,0 22,0 60,34 60,40 38,40 0,6" fill="${WATER}"/>
      <path d="M25 17 q4 -3 8 0 l-1.5 3 q-2.5 -2 -5 0 z" fill="${HULL}"/>
      <rect x="25.5" y="15" width="7" height="2" fill="${HULL2}"/>
    </svg>`,
};
