// Teste headless da Fase 1 das ovelhas (fiel ao AoE): selvagens, conversão por
// proximidade ("roubo"), abate que some, e regressões (não é atacada, não conta
// pop, não bloqueia tile). Roda: npx tsx scripts/sheep_test.ts
import { SHEEP_WILD_OWNER, SHEEP_FOOD, SHEEP_FOOD_MAX, START_VILLAGERS, UNIT_DEFS } from '@age/shared';
import { Game } from '../server/src/game/room.ts';
import { createUnit } from '../server/src/game/state.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const members = [
  { id: 1, name: 'A', color: '#f00', isBot: false },
  { id: 2, name: 'B', color: '#00f', isBot: false },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members, () => {}, () => {}, 'normal');
const size = g.grid.size;
const bidx = (x: number, y: number) => Math.floor(y) * size + Math.floor(x);

// (1) existem e são todas selvagens
const sheepList = [...g.sheep.values()];
check(`geradas ${sheepList.length} ovelhas`, sheepList.length > 0);
check('todas selvagens (owner -1) no início', sheepList.every((s: any) => s.owner === SHEEP_WILD_OWNER));

// helper: força a varredura de conversão (updateSheep roda quando tick%5==0)
const runConvert = () => { g.tick = 0; g.updateSheep(0.1); };

// pega um aldeão de cada jogador
const villA = [...g.units.values()].find((u: any) => u.owner === 1 && u.type === 'villager');
const villB = [...g.units.values()].find((u: any) => u.owner === 2 && u.type === 'villager');
const S = sheepList[0];

// (2) unidade do jogador 1 chega perto -> converte
villA.x = S.x; villA.y = S.y;
villB.x = S.x + 50; villB.y = S.y + 50; // longe
runConvert();
check('unidade perto converte a ovelha (vira do jogador 1)', S.owner === 1);

// (3) unidade do jogador 2 chega MAIS perto -> rouba
villA.x = S.x + 2; villA.y = S.y; // ~2 tiles
villB.x = S.x + 0.3; villB.y = S.y; // mais perto
runConvert();
check('inimigo mais perto ROUBA a ovelha (vira do jogador 2)', S.owner === 2);

// (4) abate: comida cai e a ovelha some; tile nunca bloqueia
const S2 = sheepList[1] ?? sheepList[0];
const tileBlockedBefore = g.grid.blocked[bidx(S2.x, S2.y)];
const v = villA;
v.x = S2.x; v.y = S2.y;
v.state = 'gathering';
v.gatherResource = 'food';
v.gatherTargetId = S2.id;
v.carryType = undefined;
v.carryAmount = 0;
let guard = 0;
while (g.sheep.has(S2.id) && guard++ < 2000) {
  g.updateGathering(v, 0.5);
  if (v.state === 'returning' || v.state === 'idle') { v.state = 'gathering'; v.carryAmount = 0; } // reengata p/ esvaziar
}
check('abate consome a comida e a ovelha SOME', !g.sheep.has(S2.id));
check('tile da ovelha nunca bloqueou (passável)', tileBlockedBefore === 0 && g.grid.blocked[bidx(S2.x, S2.y)] === 0);

// (5a) regressão: soldado ao lado de ovelha selvagem NÃO a ataca (categorias separadas)
const S3 = [...g.sheep.values()].find((s: any) => s.owner === SHEEP_WILD_OWNER) ?? [...g.sheep.values()][0];
const sword = createUnit(g.nextId ? g.nextId++ : 99999, 1, 'swordsman', S3.x + 0.5, S3.y);
g.units.set(sword.id, sword);
for (let i = 0; i < 20; i++) g.updateAutoAggro(sword, 0.1);
check('soldado NÃO mira/ataca ovelha (aggro só vê units)', sword.attackTargetId === undefined && g.sheep.has(S3.id));

// (5b) regressão: ovelha não conta população
const expectedPop = START_VILLAGERS * (UNIT_DEFS.villager.pop ?? 1) + (UNIT_DEFS.swordsman.pop ?? 1);
check(`popOf ignora ovelhas (esperado ${expectedPop})`, g.popOf(1) === expectedPop);

// (5c) nenhuma ovelha vazou pra dentro de units
check('nenhuma ovelha em game.units', ![...g.units.values()].some((u: any) => g.sheep.has(u.id)));

// (6) FASE 2 — pastoreio: ovelha própria recebe caminho e anda
const S4 = [...g.sheep.values()][0];
if (S4) {
  S4.owner = 1;
  const fromX = S4.x, fromY = S4.y;
  g.pathSheepTo(S4, S4.x + 8, S4.y);
  check('pastoreio: pathSheepTo dá um caminho', S4.path.length > 0);
  for (let i = 0; i < 60; i++) g.advanceSheep(S4, 0.5);
  check('pastoreio: a ovelha anda quando mandada (e continua sua)',
    Math.hypot(S4.x - fromX, S4.y - fromY) > 3 && S4.owner === 1);
} else {
  check('pastoreio: (sem ovelha p/ testar)', false);
}

// (7) BUG FIX — depois de DEPOSITAR, o aldeão volta pra MESMA ovelha
{
  const S = [...g.sheep.values()][0];
  const tc = [...g.buildings.values()].find((b: any) => b.type === 'town_center' && b.owner === 1);
  if (S && tc) {
    S.owner = 1;
    S.food = SHEEP_FOOD; // inteira
    const v2 = [...g.units.values()].find((u: any) => u.owner === 1 && u.type === 'villager');
    v2.x = tc.tileX + 1;
    v2.y = tc.tileY + 1;
    v2.path = [];
    v2.state = 'returning';
    v2.dropOffId = tc.id;
    v2.carryType = 'food';
    v2.carryAmount = 7;
    v2.gatherTargetId = S.id;
    v2.gatherResource = 'food';
    const foodBefore = g.players.get(1).resources.food;
    g.updateReturning(v2, 0.1);
    check('depósito credita a comida', g.players.get(1).resources.food === foodBefore + 7);
    check('depois de depositar, VOLTA pra ovelha (não pras frutas)',
      v2.gatherTargetId === S.id && (v2.state === 'movingToGather' || v2.state === 'gathering'));
  } else {
    check('(setup do teste de retorno falhou)', false);
  }
}

// (8) carcaça largada APODRECE até sumir; ovelha inteira não apodrece
{
  const all = [...g.sheep.values()];
  const whole = all[0];
  const bitten = all[1];
  if (whole && bitten) {
    // ninguém cuidando de nenhuma:
    for (const u of g.units.values()) u.gatherTargetId = undefined;
    whole.food = SHEEP_FOOD;
    bitten.food = 30;
    const id = bitten.id;
    let iters = 0;
    while (g.sheep.has(id) && iters++ < 100) g.updateSheep(0.5); // 2/s * 0.5 = 1 por chamada
    check('carcaça largada apodrece até VIRAR PÓ (some)', !g.sheep.has(id) && iters < 100);
    // inteira não apodrece (não perde comida); pode ter ENGORDADO parada => food >= 100
    check('ovelha inteira NÃO apodrece (food >= 100)', whole.food >= SHEEP_FOOD);
  } else {
    check('(sem ovelhas p/ teste de apodrecer)', false);
  }
}

// (9) carcaça não anda nem é roubável
{
  const S = [...g.sheep.values()][0];
  if (S) {
    S.owner = 1;
    S.food = 50;
    g.pathSheepTo(S, S.x + 6, S.y);
    check('carcaça NÃO anda (pastoreio ignorado)', S.path.length === 0);
    const thief = [...g.units.values()].find((u: any) => u.owner === 2);
    if (thief) {
      thief.x = S.x + 0.2;
      thief.y = S.y;
      thief.gatherTargetId = undefined;
      g.tick = 0;
      g.updateSheep(0.1);
      check('carcaça NÃO é roubável (dono congelado)', S.owner === 1);
    } else {
      check('(sem inimigo p/ teste de roubo de carcaça)', false);
    }
  } else {
    check('(sem ovelha p/ teste de carcaça)', false);
  }
}

// (10) ENGORDA: ovelha saudável e PARADA ganha comida até o teto, sem passar dele.
{
  const sh = [...g.sheep.values()][0];
  if (sh) {
    // limpa qualquer aldeão que estivesse cuidando dela (senão conta como "tended")
    for (const u of g.units.values()) u.gatherTargetId = undefined;
    sh.owner = 1; sh.food = SHEEP_FOOD; sh.path = [];
    const antes = sh.food;
    for (let i = 0; i < 40; i++) g.updateSheep(1); // 40s parada
    check(`parada engorda acima de ${SHEEP_FOOD} (era ${antes}, virou ${Math.round(sh.food)})`, sh.food > antes + 5);
    for (let i = 0; i < 400; i++) g.updateSheep(1); // muito tempo
    check(`engorda TRAVA no teto ${SHEEP_FOOD_MAX} (ficou ${Math.round(sh.food)})`, Math.abs(sh.food - SHEEP_FOOD_MAX) < 0.001);
  } else {
    check('(sem ovelha p/ teste de engorda)', false);
  }
}

// (11) NÃO engorda: andando (pastoreio), sendo comida, ou já carcaça.
{
  const all = [...g.sheep.values()];
  const moving = all[0], carcass = all[1];
  if (moving && carcass) {
    for (const u of g.units.values()) u.gatherTargetId = undefined;
    // andando: path setado + comida abaixo do teto
    moving.owner = 1; moving.food = SHEEP_FOOD; moving.path = [{ x: moving.x + 5, y: moving.y }];
    const fMov = moving.food;
    g.updateSheep(2);
    check('ovelha ANDANDO não engorda', moving.food <= fMov + 0.001);
    // sendo comida (tended): um aldeão coletando ela
    const eater = [...g.units.values()].find((u: any) => u.type === 'villager');
    moving.path = []; moving.food = SHEEP_FOOD;
    eater.gatherTargetId = moving.id; eater.state = 'gathering';
    const fEat = moving.food;
    g.updateSheep(2);
    check('ovelha sendo comida não engorda', moving.food <= fEat + 0.001);
    eater.gatherTargetId = undefined;
    // carcaça (<100): apodrece, não engorda
    carcass.owner = 1; carcass.food = 40; carcass.path = [];
    g.updateSheep(1);
    check('carcaça (<100) apodrece, não engorda', carcass.food < 40);
  } else {
    check('(sem ovelhas p/ teste de não-engorda)', false);
  }
}

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE OVELHA PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
