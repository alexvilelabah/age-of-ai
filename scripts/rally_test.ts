// Teste headless do bug do RALLY na comida: aldeão nascido com ponto de reunião
// num recurso deve SAIR COLHENDO (antes o round errava o tile e ele ficava parado).
// Roda: npx tsx scripts/rally_test.ts
import { Game } from '../server/src/game/room.ts';

const members = [{ id: 1, name: 'A', color: '#f00' }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members as any, () => {}, () => {});
const p = g.players.get(1);
p.resources = { food: 9999, wood: 9999, gold: 9999, stone: 9999 };

g.buildings.clear(); g.units.clear(); g.nodes.clear();
const tc = { id: 1, owner: 1, type: 'town_center', tileX: 5, tileY: 5, hp: 1000, progress: 1, queue: [] as unknown[] };
g.buildings.set(tc.id, tc);
const bush = { id: 50, type: 'berry_bush', tileX: 12, tileY: 12, amount: 200 };
g.nodes.set(bush.id, bush);

let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };

// spawna um aldeão com rally em (rx,ry) e devolve o aldeão criado
const trial = (rx: number, ry: number) => {
  g.units.clear();
  tc.rallyX = rx; tc.rallyY = ry;
  tc.queue = [{ unit: 'villager', progress: 1 }];
  g.updateBuildingTraining(tc, 0.1);
  return [...g.units.values()].find((u: { type: string }) => u.type === 'villager');
};

// centro do arbusto (12.5) — o caso que quebrava: round(12.5)=13 (nó não existe)
let v = trial(12.5, 12.5);
check('rally no centro (12.5): aldeão colhe COMIDA', !!v && v.gatherResource === 'food' && v.gatherTargetId === bush.id);

// metade direita/baixo (12.8) — round arredondava pra 13 e falhava
v = trial(12.8, 12.9);
check('rally na borda (12.8): aldeão colhe COMIDA', !!v && v.gatherResource === 'food' && v.gatherTargetId === bush.id);

// metade esquerda/cima (12.1) — já funcionava, mas confirma que não quebrou
v = trial(12.1, 12.2);
check('rally na borda (12.1): aldeão colhe COMIDA', !!v && v.gatherResource === 'food' && v.gatherTargetId === bush.id);

// rally num ponto SEM recurso: aldeão só anda (não inventa coleta)
v = trial(30.5, 30.5);
check('rally em chão vazio: NÃO tenta colher', !!v && v.gatherResource === undefined);

console.log(fail === 0 ? '\nTODOS OS TESTES DE RALLY PASSARAM' : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
