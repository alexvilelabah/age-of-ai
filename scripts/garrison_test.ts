// Teste headless do GUARNECER: unidades entram em Centro/Torre próprios (ficam
// protegidas e o prédio atira +1 flecha por unidade dentro) — INCLUSIVE o aldeão,
// que é como se esconde a economia num ataque.
//
// Histórico (pra não regredir de novo): o aldeão chegou a ser BLOQUEADO como
// contorno, porque clicar numa árvore perto do Centro o enfiava lá dentro. A causa
// real era outra — a altura visual do Centro no clique (B_H em client/src/state.ts)
// estava 3.2 sendo que o telhado sobe ~1.15, então o prédio comia o clique de quem
// estava VISÍVEL acima dele. Corrigida a altura, o bloqueio virou desnecessário e
// o recurso voltou.
//
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
/** Aceitou o comando? (mira o alvo, ou já entrou na hora se estava colado) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entrou = (u: any, b: any): boolean =>
  u.garrisonTargetId === b.id || (b.garrison?.some((x: { id: number }) => x.id === u.id) ?? false);

// --- ALDEÃO entra no Centro (o recurso que voltou) ---
const vil = mkUnit(1, 'villager');
g.cmdGarrison(1, [1], tc.id);
check('aldeão GUARNECE o Centro', entrou(vil, tc));

// --- ALDEÃO entra na Torre ---
const vil2 = mkUnit(2, 'villager');
g.cmdGarrison(1, [2], tower.id);
check('aldeão GUARNECE a Torre', entrou(vil2, tower));

// --- TROPA entra ---
const sw = mkUnit(3, 'swordsman');
g.cmdGarrison(1, [3], tc.id);
check('tropa guarnece o Centro', entrou(sw, tc));

// --- seleção MISTA: TODOS entram ---
const vil3 = mkUnit(4, 'villager');
const ar = mkUnit(5, 'archer');
g.cmdGarrison(1, [4, 5], tower.id);
check('mista: aldeão E tropa entram', entrou(vil3, tower) && entrou(ar, tower));

// --- BARCO não entra em prédio ---
const boat2 = mkUnit(7, 'war_galley');
g.cmdGarrison(1, [7], tc.id);
check('barco NÃO entra em prédio', !entrou(boat2, tc));

// --- prédio de OUTRO dono não aceita ---
const inimigo = { id: 902, owner: 2, type: 'town_center', tileX: 60, tileY: 60, hp: 999, progress: 1, queue: [] };
g.buildings.set(inimigo.id, inimigo);
const vil5 = mkUnit(8, 'villager');
g.cmdGarrison(1, [8], inimigo.id);
check('não guarnece prédio inimigo', !entrou(vil5, inimigo));

// --- NÃO regrediu: aldeão ainda EMBARCA no transporte (cruzar o rio) ---
const boat = { id: 800, owner: 1, type: 'transport', x: 21, y: 21, hp: 100, state: 'idle', path: [], cargo: [] };
g.units.set(boat.id, boat);
const vil4 = mkUnit(6, 'villager');
g.cmdGarrison(1, [6], boat.id);
check('aldeão AINDA embarca no transporte', vil4.garrisonTargetId === boat.id);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE GUARNECER PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
