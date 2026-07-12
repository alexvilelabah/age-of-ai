// Teste headless dos TIMES/aliança: aliado não é atacável nem perseguido,
// torres poupam aliados, ovelha de aliado não é "roubada", vitória em DUPLA
// (won pra ambos), e o bot ALIADO PROTETOR socorre a base do amigo.
// Roda: npx tsx scripts/team_test.ts
import { Game } from '../server/src/game/room.ts';
import { createUnit } from '../server/src/game/state.ts';
import { runBotAI } from '../server/src/game/ai.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

type Msg = { type: string; [k: string]: unknown };
const sent: { to: number; msg: Msg }[] = [];

// Time 1 = humano(1) + bot(2); Time 2 = bot(3). Bot 4 sozinho (FFA).
const members = [
  { id: 1, name: 'Humano', color: '#f00', isBot: false, team: 1 },
  { id: 2, name: 'BotAmigo', color: '#00f', isBot: true, difficulty: 'normal' as const, team: 1 },
  { id: 3, name: 'BotInimigo', color: '#0f0', isBot: true, difficulty: 'normal' as const, team: 2 },
  { id: 4, name: 'BotSolo', color: '#ff0', isBot: true, difficulty: 'normal' as const },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members, (to: number, msg: Msg) => sent.push({ to, msg }), () => {}, 'normal');

// (1) allied()
check('humano e BotAmigo são aliados (time 1)', g.allied(1, 2) === true);
check('humano e BotInimigo NÃO são aliados', g.allied(1, 3) === false);
check('solo não é aliado de ninguém', g.allied(4, 1) === false && g.allied(4, 3) === false);
check('todo mundo é aliado de si mesmo', g.allied(3, 3) === true);

// (2) cmdAttack recusa alvo aliado, aceita inimigo
const soldierH = createUnit(910000, 1, 'swordsman', 60, 60);
const allyVil = createUnit(910001, 2, 'villager', 61, 60);
const enemyVil = createUnit(910002, 3, 'villager', 62, 60);
g.units.set(soldierH.id, soldierH);
g.units.set(allyVil.id, allyVil);
g.units.set(enemyVil.id, enemyVil);
g.cmdAttack(1, [soldierH.id], allyVil.id);
check('cmdAttack IGNORA alvo aliado', soldierH.attackTargetId === undefined);
g.cmdAttack(1, [soldierH.id], enemyVil.id);
check('cmdAttack aceita alvo inimigo', soldierH.attackTargetId === enemyVil.id);
g.clearTasks(soldierH); soldierH.state = 'idle';

// (3) auto-aggro pula aliado e pega inimigo mais próximo
soldierH.aggroTimer = 0;
allyVil.x = soldierH.x + 0.5; // aliado COLADO
enemyVil.x = soldierH.x + 3;  // inimigo mais longe (dentro da visão)
g.updateAutoAggro(soldierH, 0.5);
check('auto-aggro pula o aliado colado e persegue o INIMIGO', soldierH.attackTargetId === enemyVil.id);
g.clearTasks(soldierH); soldierH.state = 'idle';

// (4) torre não atira em aliado
const tower = [...g.buildings.values()].find((b: any) => b.owner === 1 && b.type === 'town_center');
if (tower) {
  // usa o TC (atira como defesa): aliado dentro do alcance, inimigo fora
  allyVil.x = tower.tileX + 1; allyVil.y = tower.tileY + 1;
  enemyVil.x = tower.tileX + 40; enemyVil.y = tower.tileY + 40;
  tower.targetId = undefined;
  tower.attackTimer = 0;
  g.updateTowers(0.1);
  check('TC/torre NÃO mira aliado no alcance', tower.targetId === undefined || tower.targetId !== allyVil.id);
} else {
  check('(sem TC p/ teste de torre)', false);
}

// (5) ovelha de aliado não é roubada; de inimigo sim
const sh = [...g.sheep.values()][0];
if (sh) {
  sh.owner = 1; sh.food = 100; sh.path = [];
  for (const u of g.units.values()) u.gatherTargetId = undefined;
  // aliado colado, mais ninguém perto
  allyVil.x = sh.x + 0.2; allyVil.y = sh.y;
  enemyVil.x = sh.x + 50; enemyVil.y = sh.y + 50;
  soldierH.x = sh.x + 50; soldierH.y = sh.y + 50;
  g.tick = 0; g.updateSheep(0.1);
  check('ALIADO perto NÃO rouba a ovelha (continua do humano)', sh.owner === 1);
  // inimigo mais perto que todos -> rouba
  enemyVil.x = sh.x + 0.1; enemyVil.y = sh.y;
  g.tick = 0; g.updateSheep(0.1);
  check('INIMIGO perto ROUBA a ovelha', sh.owner === 3);
} else {
  check('(sem ovelha p/ teste)', false);
}

// (6) SOCORRO: base do humano apanha -> BotAmigo manda soldados ociosos
const rescuerA = createUnit(910010, 2, 'swordsman', 100, 100);
const rescuerB = createUnit(910011, 2, 'swordsman', 101, 100);
const rescuerC = createUnit(910012, 2, 'swordsman', 102, 100);
g.units.set(rescuerA.id, rescuerA);
g.units.set(rescuerB.id, rescuerB);
g.units.set(rescuerC.id, rescuerC);
const humanTC = [...g.buildings.values()].find((b: any) => b.owner === 1 && b.type === 'town_center');
if (humanTC) {
  // inimigo bate no TC do humano (registra recentAttacks)
  const attacker = createUnit(910013, 3, 'swordsman', humanTC.tileX, humanTC.tileY);
  g.units.set(attacker.id, attacker);
  g.dealDamage(attacker, humanTC.id);
  check('dano em prédio registra o "apanhando"', g.recentAttacks.has(1));
  // roda a IA do BotAmigo — deve enfileirar MOVE dos 3 ociosos pro local
  runBotAI(g, 2);
  const cmds = g.queue as { playerId: number; cmd: any }[];
  const rescue = cmds.find((c) => c.playerId === 2 && c.cmd.kind === 'move'
    && c.cmd.unitIds.includes(rescuerA.id) && c.cmd.unitIds.includes(rescuerB.id));
  check('BotAmigo manda os soldados ociosos SOCORRER a base do humano', !!rescue);
} else {
  check('(sem TC humano p/ teste de socorro)', false);
}

// (7) vitória em DUPLA: derrota o time 2 e o solo -> time 1 vence JUNTO
sent.length = 0;
g.markDefeated(3);
g.markDefeated(4);
const overMsgs = sent.filter((s) => s.msg.type === 'gameOver');
const toHuman = overMsgs.find((s) => s.to === 1)?.msg as any;
const toAlly = overMsgs.find((s) => s.to === 2)?.msg as any;
const toLoser = overMsgs.find((s) => s.to === 3)?.msg as any;
check('gameOver enviado a todos', overMsgs.length === 4);
check('humano VENCEU (won=true)', toHuman?.won === true);
check('BotAmigo TAMBÉM venceu (won=true) — vitória em dupla', toAlly?.won === true);
check('inimigo perdeu (won=false)', toLoser?.won === false);
check('winnerName junta a dupla', typeof toHuman?.winnerName === 'string' && toHuman.winnerName.includes('+'));

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE TIME PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
