// Nomes e ícones em pt-BR para tipos do jogo.
import type { BuildingType, NodeType, ResourceType, UnitType } from '@age/shared';
import { NODE_DEFS } from '@age/shared';

export const UNIT_NAMES: Record<UnitType, string> = {
  villager: 'Aldeão',
  swordsman: 'Espadachim',
  archer: 'Arqueiro',
  knight: 'Cavaleiro',
};

export const BUILDING_NAMES: Record<BuildingType, string> = {
  town_center: 'Centro da Cidade',
  house: 'Casa',
  barracks: 'Quartel',
  farm: 'Fazenda',
  archery_range: 'Arquearia',
  stable: 'Estábulo',
  blacksmith: 'Ferraria',
  market: 'Mercado',
  wall: 'Muralha',
  watch_tower: 'Torre de Vigia',
  mill: 'Moinho',
  lumber_camp: 'Madeireira',
  mining_camp: 'Campo de Mineração',
};

export const NODE_NAMES: Record<NodeType, string> = {
  tree: 'Árvore',
  berry_bush: 'Arbusto de frutas',
  gold_mine: 'Mina de ouro',
  stone_mine: 'Mina de pedra',
};

export const RESOURCE_NAMES: Record<ResourceType, string> = {
  food: 'comida',
  wood: 'madeira',
  gold: 'ouro',
  stone: 'pedra',
};

/** "Pra que serve" de cada prédio (caixa de ajuda ao passar o mouse, estilo AoE2). */
export const BUILDING_DESCS: Record<BuildingType, string> = {
  town_center: 'O coração da vila: treina aldeões, recebe recursos coletados e pesquisa o avanço de era.',
  house: 'Abriga sua população: cada casa aumenta o limite em +5.',
  barracks: 'Treina espadachins. Libera a Arquearia, o Estábulo e a Ferraria.',
  farm: 'Fonte de comida: mande aldeões colherem nela (esgota com o tempo). Requer um Moinho.',
  archery_range: 'Treina arqueiros, que atacam à distância.',
  stable: 'Treina cavaleiros, a cavalaria rápida e pesada.',
  blacksmith: 'Pesquisa melhorias de ataque e armadura para suas tropas.',
  market: 'Pesquisa melhorias econômicas: coleta mais rápida e mais carga por viagem.',
  wall: 'Bloqueia a passagem de inimigos. Barata — cerque sua vila (Ctrl+clique emenda vários trechos).',
  watch_tower: 'Atira flechas nos inimigos próximos. Fica mais forte (e mais imponente) a cada era.',
  mill: 'Depósito de COMIDA. Libera a Fazenda e o Mercado. Construa perto da comida.',
  lumber_camp: 'Depósito de MADEIRA. Construa junto à floresta pra encurtar a viagem dos lenhadores.',
  mining_camp: 'Depósito de OURO e PEDRA. Construa ao lado das minas.',
};

/** "Pra que serve" de cada unidade. */
export const UNIT_DESCS: Record<UnitType, string> = {
  villager: 'Coleta recursos, constrói e conserta — a base da sua economia.',
  swordsman: 'Infantaria corpo a corpo, equilibrada e barata.',
  archer: 'Ataca de longe, mas é frágil de perto — proteja-o.',
  knight: 'Cavalaria veloz com muito dano e vida; cara de treinar.',
};

// ATENÇÃO: usar apenas emojis antigos (Unicode <= 12). Os de madeira/ouro/pedra
// (🪵🪙🪨, Unicode 13) não existem no Windows 10 — apareciam só os números.
export const RESOURCE_ICONS: Record<ResourceType, string> = {
  food: '🍖',
  wood: '🌲',
  gold: '💰',
  stone: '⛰️',
};

export const UNIT_ICONS: Record<UnitType, string> = {
  villager: '👨‍🌾',
  swordsman: '⚔️',
  archer: '🏹',
  knight: '🏇',
};

export const BUILDING_ICONS: Record<BuildingType, string> = {
  town_center: '🏰',
  house: '🏠',
  barracks: '🛡️',
  farm: '🌾',
  archery_range: '🏹',
  stable: '🐴',
  blacksmith: '⚒️',
  market: '⚖️',
  wall: '🧱',
  watch_tower: '🗼',
  mill: '🍞',
  lumber_camp: '🪓',
  mining_camp: '⛏️',
};

export const NODE_ICONS: Record<NodeType, string> = {
  tree: '🌳',
  berry_bush: '🍓',
  gold_mine: '⛏️',
  stone_mine: '⛰️',
};

/** Ícone do recurso produzido por um nó. */
export function nodeResourceIcon(type: NodeType): string {
  const def = NODE_DEFS[type];
  return def ? RESOURCE_ICONS[def.resource] : '';
}

/** Texto curto de custo, ex.: "50 🪵  20 🪙". */
export function costText(cost: Partial<Record<ResourceType, number>>): string {
  const parts: string[] = [];
  for (const [res, val] of Object.entries(cost) as [ResourceType, number][]) {
    if (val && val > 0) parts.push(`${val} ${RESOURCE_ICONS[res]}`);
  }
  return parts.join('  ');
}

/** Texto longo de custo, ex.: "50 madeira, 20 ouro". */
export function costLongText(cost: Partial<Record<ResourceType, number>>): string {
  const parts: string[] = [];
  for (const [res, val] of Object.entries(cost) as [ResourceType, number][]) {
    if (val && val > 0) parts.push(`${val} ${RESOURCE_NAMES[res]}`);
  }
  return parts.join(', ');
}
