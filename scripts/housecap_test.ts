// Teste headless do TETO DE MORADIA (POP_CAP_MAX): casa nova além do teto é
// recusada no SERVIDOR (obra em andamento conta), volta a poder quando uma casa
// cai, o reaproveitamento de obra já paga não é bloqueado, e no CLIENTE o
// canPlace('house') fica falso no teto (fantasma vermelho / clique não cola).
// Roda: npx tsx scripts/housecap_test.ts
import { Game } from '../server/src/game/room.ts';
import { GameState } from '../client/src/state.ts';
import { BUILDING_DEFS, POP_CAP_MAX } from '../shared/src/index.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

type Msg = { type: string; [k: string]: unknown };
const sent: { to: number; msg: Msg }[] = [];
const members = [{ id: 1, name: 'Humano', color: '#f00', isBot: false }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members, (to: number, msg: Msg) => sent.push({ to, msg }), () => {}, 'normal');

const HOUSE_POP = BUILDING_DEFS.house.popProvided; // 5
const houses = (): number => [...g.buildings.values()].filter((b: any) => b.type === 'house' && b.owner === 1).length;
const provided = (): number =>
  [...g.buildings.values()].reduce((t: number, b: any) => (b.owner === 1 ? t + BUILDING_DEFS[b.type as 'house'].popProvided : t), 0);

// villager do jogador e um lugar válido pra colar casa (varre o mapa)
const vil = [...g.units.values()].find((u: any) => u.owner === 1 && u.type === 'villager');
check('(setup) villager inicial existe', !!vil);
function findSpot(): { x: number; y: number } {
  for (let y = 2; y < g.grid.size - 3; y++) {
    for (let x = 2; x < g.grid.size - 3; x++) {
      if (g.validFootprint(x, y, BUILDING_DEFS.house.size)) return { x, y };
    }
  }
  throw new Error('sem lugar pra casa');
}
const p1 = g.players.get(1);
p1.resources.wood = 100000; // madeira de sobra: as recusas têm que ser pelo TETO

// clona o TC pra fabricar casas prontas (só owner/type/progress importam)
const tc = [...g.buildings.values()].find((b: any) => b.owner === 1 && b.type === 'town_center');
check('(setup) TC inicial existe (5 de moradia)', !!tc && BUILDING_DEFS.town_center.popProvided === 5);
let fakeId = 800000;
const addHouse = (progress = 1): number => {
  const id = fakeId++;
  g.buildings.set(id, { ...tc, id, type: 'house', tileX: 200 + fakeId, tileY: 200, progress, queue: [] });
  return id;
};

// (1) enche até o teto: TC(5) + 14 casas prontas = 75 = POP_CAP_MAX
while (provided() < POP_CAP_MAX) addHouse(1);
check(`moradia chegou no teto (${POP_CAP_MAX})`, provided() === POP_CAP_MAX);

// casa nova -> RECUSADA com err.house_cap, sem criar obra nem gastar madeira
sent.length = 0;
const woodBefore = p1.resources.wood;
const spot = findSpot();
const housesBefore = houses();
g.cmdBuild(1, [vil.id], 'house', spot.x, spot.y, false);
check('casa nova no teto é RECUSADA (nenhuma obra criada)', houses() === housesBefore);
check('recusa manda o erro err.house_cap', sent.some((s) => s.msg.type === 'error' && s.msg.code === 'err.house_cap'));
check('recusa não gasta madeira', p1.resources.wood === woodBefore);

// (2) outros prédios continuam liberados no teto (só casa trava)
sent.length = 0;
g.cmdBuild(1, [vil.id], 'barracks', spot.x, spot.y, false);
const barracksMade = [...g.buildings.values()].some((b: any) => b.owner === 1 && b.type === 'barracks');
check('barracks no teto de moradia continua PERMITIDO', barracksMade);

// (3) obra em andamento CONTA: tira 1 pronta (70) e põe 1 em obra (75) -> recusa
const anyHouse = [...g.buildings.values()].find((b: any) => b.type === 'house' && b.owner === 1);
g.buildings.delete(anyHouse.id); // "caiu" uma casa pronta
addHouse(0.3); // em obra
check('(setup) teto de novo com 13 prontas + 1 em obra', provided() === POP_CAP_MAX);
sent.length = 0;
g.cmdBuild(1, [vil.id], 'house', spot.x, spot.y, false);
check('em obra conta no teto: casa nova ainda RECUSADA', sent.some((s) => s.msg.type === 'error' && s.msg.code === 'err.house_cap'));

// (4) derrubou uma casa -> pode construir de novo (o botão "acende")
const another = [...g.buildings.values()].find((b: any) => b.type === 'house' && b.owner === 1);
g.buildings.delete(another.id);
sent.length = 0;
const before4 = houses();
const spot4 = findSpot();
g.cmdBuild(1, [vil.id], 'house', spot4.x, spot4.y, false);
check('casa caiu -> casa nova é ACEITA de novo', houses() === before4 + 1);
check('aceita sem erro de teto', !sent.some((s) => s.msg.type === 'error' && s.msg.code === 'err.house_cap'));

// (5) reaproveitar obra JÁ PAGA no teto não é bloqueado (dispatch, sem erro)
while (provided() < POP_CAP_MAX) addHouse(1); // volta pro teto (a obra do passo 4 conta)
const wip = [...g.buildings.values()].find((b: any) => b.type === 'house' && b.owner === 1 && b.progress < 1);
check('(setup) existe obra de casa em andamento', !!wip);
sent.length = 0;
g.cmdBuild(1, [vil.id], 'house', wip.tileX, wip.tileY, false);
check('mandar aldeão pra obra EXISTENTE no teto não dá erro', !sent.some((s) => s.msg.type === 'error'));

// ---------------- cliente: canPlace ----------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const map: any = { size: 64, tiles: new Uint8Array(64 * 64) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const players: any = [{ id: 0, name: 'Eu', color: '#f00' }];
const gs = new GameState(map, players, 0); // mapa aberto (fog revelada)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cb = (id: number, type: string, tileX: number, progress = 1): any => ({ id, owner: 0, type, tileX, tileY: 50, hp: 100, progress, queue: [] });
let cid = 1;
for (let provided = 0; provided < POP_CAP_MAX; provided += 5) gs.buildings.set(cid, cb(cid++, 'house', cid * 3));
check('(cliente) housingProvided no teto', gs.housingProvided() === POP_CAP_MAX);
check('(cliente) canPlace(house) no teto = FALSE (fantasma vermelho)', gs.canPlace('house', 2, 2) === false);
check('(cliente) canPlace(barracks) no teto = true (só casa trava)', gs.canPlace('barracks', 2, 2) === true);
gs.buildings.delete(1); // caiu uma casa
check('(cliente) caiu casa -> canPlace(house) volta a true', gs.canPlace('house', 2, 2) === true);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DO TETO DE MORADIA PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
