// Teste headless do GUARNECER: o ALDEÃO não entra em prédio (Centro/torre).
// Motivo: o sprite do Centro é alto e o pickAt do cliente testa prédio ANTES de
// árvore, então mandar o aldeão cortar uma árvore perto do Centro roubava o
// clique e enfiava ele lá dentro. Tropa continua guarnecendo, e o aldeão
// CONTINUA podendo embarcar no transporte (é outro ramo — vital no mapa Travessia).
// Roda: npx tsx scripts/garrison_test.ts
import { Game } from '../server/src/game/room.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const members = [{ id: 1, name: 'A', color: '#f00' }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members as any, () => {}, () => {});
g.buildings.clear();
g.units.clear();

// Centro da Cidade próprio e pronto
const tc = { id: 900, owner: 1, type: 'town_center', tileX: 10, tileY: 10, hp: 999, progress: 1, queue: [] };
g.buildings.set(tc.id, tc);
// Torre própria e pronta (mesma regra)
const tower = { id: 901, owner: 1, type: 'watch_tower', tileX: 30, tileY: 30, hp: 999, progress: 1, queue: [] };
g.buildings.set(tower.id, tower);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkUnit = (id: number, type: string): any => {
  const u = { id, owner: 1, type, x: 20, y: 20, hp: 50, state: 'idle', path: [], carryAmount: 0 };
  g.units.set(id, u);
  return u;
};

// --- ALDEÃO não entra no Centro ---
const vil = mkUnit(1, 'villager');
g.cmdGarrison(1, [1], tc.id);
check('aldeão NÃO some do mapa ao clicar no Centro', g.units.has(1));
check('aldeão não fica mirando o Centro (sem garrisonTargetId)', vil.garrisonTargetId === undefined);
check('aldeão não entra em movingToGarrison', vil.state !== 'movingToGarrison');
check('Centro fica sem ninguém dentro', (tc.garrison?.length ?? 0) === 0);

// --- ALDEÃO também não entra na Torre ---
const vil2 = mkUnit(2, 'villager');
g.cmdGarrison(1, [2], tower.id);
check('aldeão NÃO guarnece a Torre', vil2.garrisonTargetId === undefined && (tower.garrison?.length ?? 0) === 0);

// --- TROPA continua guarnecendo ---
const sw = mkUnit(3, 'swordsman');
g.cmdGarrison(1, [3], tc.id);
check('tropa AINDA guarnece o Centro', sw.garrisonTargetId === tc.id || (tc.garrison?.length ?? 0) > 0);

// --- seleção MISTA: só a tropa entra, o aldeão fica de fora ---
const vil3 = mkUnit(4, 'villager');
const sw2 = mkUnit(5, 'archer');
g.cmdGarrison(1, [4, 5], tower.id);
check('mista: tropa entra e aldeão fica fora', vil3.garrisonTargetId === undefined && sw2.garrisonTargetId === tower.id);

// --- NÃO regrediu: aldeão ainda EMBARCA no transporte (cruzar o rio) ---
const boat = { id: 800, owner: 1, type: 'transport', x: 21, y: 21, hp: 100, state: 'idle', path: [], cargo: [] };
g.units.set(boat.id, boat);
const vil4 = mkUnit(6, 'villager');
g.cmdGarrison(1, [6], boat.id);
check('aldeão AINDA pode embarcar no transporte', vil4.garrisonTargetId === boat.id);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE GUARNECER PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
