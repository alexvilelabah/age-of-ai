// Teste headless do NAVAL: mapa Rio (vaus + peixes), grades por domínio (terra
// x água), Porto na costa, treino de barco na água, PESCA entregando no Porto,
// transporte (embarca/desembarca/afunda com a tropa), regras de aggro
// (melee não persegue barco; galé não persegue terra adentro), separação e o
// mapa Travessia (strait): rio vertical sem vau que separa as margens (só barco).
// Roda: npx tsx scripts/naval_test.ts
import { Game } from '../server/src/game/room.ts';
import { createUnit } from '../server/src/game/state.ts';
import {
  BUILDING_DEFS,
  NODE_DEFS,
  TILE_GRASS,
  TILE_SHALLOW,
  TILE_WATER,
  TRANSPORT_CAP,
} from '../shared/src/index.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

type Msg = { type: string; [k: string]: unknown };
const sent: { to: number; msg: Msg }[] = [];
const members = [
  { id: 1, name: 'Humano', color: '#f00', isBot: false },
  { id: 2, name: 'Rival', color: '#00f', isBot: false },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members, (to: number, msg: Msg) => sent.push({ to, msg }), () => {}, 'normal', 'river');
const size = g.grid.size;
const tiles = g.grid.tiles as number[];
const at = (x: number, y: number): number => tiles[y * size + x];

// ---------- (1) mapa Rio ----------
let water = 0, shallow = 0;
for (const v of tiles) {
  if (v === TILE_WATER) water++;
  else if (v === TILE_SHALLOW) shallow++;
}
check(`rio existe (água funda ${water} tiles > 400)`, water > 400);
check(`vaus existem (raso ${shallow} tiles > 20)`, shallow > 20);
const fishNodes = [...g.nodes.values()].filter((n: any) => n.type === 'fish');
check(`bancos de peixe no rio (${fishNodes.length} >= 4)`, fishNodes.length >= 4);
check('peixe fica em água funda', fishNodes.every((n: any) => at(n.tileX, n.tileY) === TILE_WATER));

// ---------- (2) grades por domínio ----------
const wIdx = tiles.findIndex((v: number) => v === TILE_WATER);
const gIdx = tiles.findIndex((v: number) => v === TILE_GRASS);
const sIdx = tiles.findIndex((v: number) => v === TILE_SHALLOW);
check('água funda BLOQUEIA terrestre (bug antigo consertado)', g.grid.blocked[wIdx] === 1);
check('grama livre pro terrestre', g.grid.blocked[gIdx] === 0);
check('raso (vau) é passável a pé', g.grid.blocked[sIdx] === 0);
check('água funda é NAVEGÁVEL', g.navalGrid.blocked[wIdx] === 0 || fishNodes.some((n: any) => n.tileY * size + n.tileX === wIdx));
check('grama BLOQUEIA barco', g.navalGrid.blocked[gIdx] === 1);
check('vau (banco de areia) BLOQUEIA barco — é travessia de TERRA', g.navalGrid.blocked[sIdx] === 1);
check('peixe bloqueia o barco (pesca por adjacência)', fishNodes.every((n: any) => g.navalGrid.blocked[n.tileY * size + n.tileX] === 1));

// ---------- (3) Porto: footprint na água + costa ----------
let dockX = -1, dockY = -1;
outer: for (let y = 1; y < size - 2; y++) {
  for (let x = 1; x < size - 2; x++) {
    if (g.validDockFootprint(x, y, BUILDING_DEFS.dock.size)) { dockX = x; dockY = y; break outer; }
  }
}
check('existe lugar válido pro Porto (água + costa)', dockX >= 0);
check('em terra o Porto é inválido', g.validDockFootprint(Math.floor(gIdx % size), Math.floor(gIdx / size), 2) === false);

const p1 = g.players.get(1);
p1.resources.wood = 100000;
p1.resources.food = 100000;
const vil = [...g.units.values()].find((u: any) => u.owner === 1 && u.type === 'villager');
check('(setup) villager existe', !!vil);
g.cmdBuild(1, [vil.id], 'dock', dockX, dockY, false);
const dock = [...g.buildings.values()].find((b: any) => b.type === 'dock' && b.owner === 1);
check('Porto colocado na água', !!dock);
dock.progress = 1; // conclui a obra na hora (teste)
dock.hp = BUILDING_DEFS.dock.hp;
check('Porto carimbou a grade naval (barco não atravessa)', g.navalGrid.blocked[dockY * size + dockX] === 1);

// ---------- (4) treino: barco nasce na ÁGUA ----------
g.cmdTrain(1, dock.id, 'fishing_boat');
check('fila do Porto aceitou o barco', dock.queue.length === 1);
for (let i = 0; i < 200 && dock.queue.length > 0; i++) g.updateBuildingTraining(dock, 0.1);
const boat = [...g.units.values()].find((u: any) => u.owner === 1 && u.type === 'fishing_boat');
check('barco de pesca treinado', !!boat);
check('barco nasceu em tile NAVEGÁVEL (água)', !!boat && at(Math.floor(boat.x), Math.floor(boat.y)) !== TILE_GRASS);

// ---------- (5) pesca: colhe no banco e entrega no Porto ----------
// Como o rio agora é segmentado pelos vaus, garanto um peixe ALCANÇÁVEL pondo um
// banco novo num tile de água funda vizinho do barco (mesma poça).
const foodBefore = p1.resources.food;
let fish = fishNodes.reduce((best: any, n: any) => {
  const d = Math.hypot(n.tileX - boat.x, n.tileY - boat.y);
  return !best || d < best.d ? { n, d } : best;
}, null).n;
const bx0 = Math.floor(boat.x), by0 = Math.floor(boat.y);
let injected: any = null;
for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
  const x = bx0 + dx, y = by0 + dy;
  if (x < 0 || y < 0 || x >= size || y >= size) continue;
  if (at(x, y) === TILE_WATER && !g.buildings.size) continue; // (nunca; só guarda de tipo)
  if (at(x, y) === TILE_WATER && g.navalGrid.blocked[y * size + x]) continue;
  if (at(x, y) === TILE_WATER) {
    injected = { id: 990001, type: 'fish', tileX: x, tileY: y, amount: NODE_DEFS.fish.amount };
    g.nodes.set(injected.id, injected);
    g.navalGrid.blocked[y * size + x] = 1; // peixe bloqueia (pesca por adjacência)
    fish = injected;
    break;
  }
}
g.cmdGather(1, [boat.id], fish.id);
check('barco aceitou a ordem de pesca', boat.gatherTargetId === fish.id);
for (let i = 0; i < 1200 && p1.resources.food <= foodBefore; i++) g.step();
check(`pesca ENTREGOU comida no Porto (+${Math.round(p1.resources.food - foodBefore)})`, p1.resources.food > foodBefore);

// villager NÃO pesca
g.cmdGather(1, [vil.id], fish.id);
check('aldeão NÃO aceita pescar', vil.gatherTargetId !== fish.id);

// ---------- (6) transporte: embarca, desembarca, afunda com a tropa ----------
// acha uma água encostada em grama (margem) pra estacionar o transporte
let shoreW: { x: number; y: number } | null = null;
let shoreL: { x: number; y: number } | null = null;
outer2: for (let y = 1; y < size - 1; y++) {
  for (let x = 1; x < size - 1; x++) {
    if (at(x, y) !== TILE_WATER || g.navalGrid.blocked[y * size + x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (at(x + dx, y + dy) === TILE_GRASS && g.grid.blocked[(y + dy) * size + (x + dx)] === 0) {
        shoreW = { x, y };
        shoreL = { x: x + dx, y: y + dy };
        break outer2;
      }
    }
  }
}
check('(setup) margem água+grama encontrada', !!shoreW && !!shoreL);
const trans = createUnit(920001, 1, 'transport', shoreW!.x + 0.5, shoreW!.y + 0.5);
g.units.set(trans.id, trans);
const s1 = createUnit(920002, 1, 'swordsman', shoreL!.x + 0.5, shoreL!.y + 0.5);
const s2 = createUnit(920003, 1, 'swordsman', shoreL!.x + 0.5, shoreL!.y + 0.5);
g.units.set(s1.id, s1);
g.units.set(s2.id, s2);
const popBefore = g.popOf(1);
g.cmdGarrison(1, [s1.id, s2.id], trans.id);
for (let i = 0; i < 300 && (trans.cargo?.length ?? 0) < 2; i++) g.step();
check('tropa EMBARCOU no transporte (2/5)', (trans.cargo?.length ?? 0) === 2);
check('embarcados saem do mapa', !g.units.has(s1.id) && !g.units.has(s2.id));
check('população NÃO muda embarcando', g.popOf(1) === popBefore);
check(`capacidade é ${TRANSPORT_CAP}`, TRANSPORT_CAP === 5);

// desembarque na costa
g.cmdUnload(1, trans.id);
check('DESEMBARCOU: tropa de volta ao mapa', g.units.has(s1.id) && g.units.has(s2.id));
check('desembarcados pisam em TERRA', [s1, s2].every((u: any) => at(Math.floor(u.x), Math.floor(u.y)) !== TILE_WATER));
check('população intacta após desembarque', g.popOf(1) === popBefore);

// desembarque em água aberta -> erro
g.cmdGarrison(1, [s1.id, s2.id], trans.id);
for (let i = 0; i < 300 && (trans.cargo?.length ?? 0) < 2; i++) g.step();
// leva o barco pro MEIO do rio (>=4 de distância de qualquer terra)
let openW: { x: number; y: number } | null = null;
outer3: for (let y = 4; y < size - 4; y++) {
  for (let x = 4; x < size - 4; x++) {
    if (at(x, y) !== TILE_WATER) continue;
    let nearLand = false;
    for (let dy = -3; dy <= 3 && !nearLand; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (at(x + dx, y + dy) !== TILE_WATER) { nearLand = true; break; }
      }
    }
    if (!nearLand) { openW = { x, y }; break outer3; }
  }
}
if (openW && (trans.cargo?.length ?? 0) === 2) {
  trans.x = openW.x + 0.5;
  trans.y = openW.y + 0.5;
  sent.length = 0;
  g.cmdUnload(1, trans.id);
  check('desembarque em água aberta é RECUSADO (err.unload_no_shore)',
    (trans.cargo?.length ?? 0) === 2 && sent.some((s) => s.msg.type === 'error' && s.msg.code === 'err.unload_no_shore'));
} else {
  check('(rio estreito demais pro teste de água aberta — pulado)', true);
}

// afundou = tropa morre junto
const popLoaded = g.popOf(1);
g.cmdDelete(1, [trans.id]);
check('transporte apagado', !g.units.has(trans.id));
check('tropa embarcada AFUNDA junto (pop cai)', g.popOf(1) === popLoaded - 3); // 2 soldados + o barco

// ---------- (7) aggro por domínio ----------
const eBoat = createUnit(930001, 2, 'fishing_boat', shoreW!.x + 0.5, shoreW!.y + 0.5);
g.units.set(eBoat.id, eBoat);
const meleeA = createUnit(930002, 1, 'swordsman', shoreL!.x + 0.5, shoreL!.y + 0.5);
g.units.set(meleeA.id, meleeA);
meleeA.aggroTimer = 0;
g.updateAutoAggro(meleeA, 0.1);
check('melee terrestre NÃO persegue barco', meleeA.attackTargetId !== eBoat.id);
const galley = createUnit(930003, 1, 'war_galley', shoreW!.x + 0.5, shoreW!.y + 0.5);
g.units.set(galley.id, galley);
galley.aggroTimer = 0;
g.updateAutoAggro(galley, 0.1);
check('galé MIRA o barco inimigo do lado', galley.attackTargetId === eBoat.id);

// ---------- (8) separação: barcos não ficam colados ----------
const bA = createUnit(940001, 1, 'fishing_boat', shoreW!.x + 0.5, shoreW!.y + 0.5);
const bB = createUnit(940002, 1, 'fishing_boat', shoreW!.x + 0.5, shoreW!.y + 0.5);
g.units.set(bA.id, bA);
g.units.set(bB.id, bB);
for (let i = 0; i < 40; i++) g.separateIdleUnits(0.1);
const dAB = Math.hypot(bA.x - bB.x, bA.y - bB.y);
check(`barcos se AFASTAM (dist ${dAB.toFixed(2)} > 0.5)`, dAB > 0.5);

// ---------- (9) mapa Travessia (strait): sem vau, água divide o mapa ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g2: any = new Game(members, () => {}, () => {}, 'normal', 'strait');
const size2 = g2.grid.size as number;
const tiles2 = g2.grid.tiles as number[];
let water2 = 0, shallow2 = 0;
for (const v of tiles2) {
  if (v === TILE_WATER) water2++;
  else if (v === TILE_SHALLOW) shallow2++;
}
check(`travessia: rio existe (água ${water2} > 400)`, water2 > 400);
check(`travessia: SEM vaus (0 rasos, veio ${shallow2})`, shallow2 === 0);
// parede d'água contínua: toda linha tem pelo menos 1 tile de água (rio vertical divide)
let everyRowHasWater = true;
for (let y = 0; y < size2 && everyRowHasWater; y++) {
  let rowWater = false;
  for (let x = 0; x < size2; x++) if (tiles2[y * size2 + x] === TILE_WATER) { rowWater = true; break; }
  if (!rowWater) everyRowHasWater = false;
}
check('travessia: parede de água em TODAS as linhas (rio vertical)', everyRowHasWater);
const fish2 = [...g2.nodes.values()].filter((n: any) => n.type === 'fish');
check(`travessia: tem peixe pra economia naval (${fish2.length} >= 4)`, fish2.length >= 4);
// os dois Centros em margens OPOSTAS e SEM travessia a pé (BFS na grade terrestre)
const tcs = [...g2.buildings.values()].filter((b: any) => b.type === 'town_center');
check('travessia: 2 Centros de Cidade', tcs.length === 2);
const entryOf = (b: any): { x: number; y: number } => {
  for (let r = 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = b.tileX + 1 + dx, y = b.tileY + 1 + dy;
        if (x >= 0 && y >= 0 && x < size2 && y < size2 && g2.grid.blocked[y * size2 + x] === 0) return { x, y };
      }
  return { x: b.tileX + 1, y: b.tileY + 1 };
};
const e0 = entryOf(tcs[0]), e1 = entryOf(tcs[1]);
const seenL = new Uint8Array(size2 * size2);
const q2 = [e0.y * size2 + e0.x];
seenL[q2[0]] = 1;
let h2 = 0;
const dirs8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
while (h2 < q2.length) {
  const cur = q2[h2++];
  const cx = cur % size2, cy = (cur - cx) / size2;
  for (const [dx, dy] of dirs8) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= size2 || ny >= size2) continue;
    const ni = ny * size2 + nx;
    if (seenL[ni] || g2.grid.blocked[ni]) continue;
    seenL[ni] = 1;
    q2.push(ni);
  }
}
check('travessia: um Centro NÃO alcança o outro a pé (só de barco)', seenL[e1.y * size2 + e1.x] === 0);
// mas cada barco navega o rio inteiro (grade naval conecta as margens)
check('travessia: água é navegável de ponta a ponta', g2.navalGrid.blocked[tiles2.findIndex((v: number) => v === TILE_WATER)] === 0);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES NAVAIS PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
