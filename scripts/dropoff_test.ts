// Teste headless do roteamento de depósito por recurso (findNearestDropOff).
// Roda: npx tsx scripts/dropoff_test.ts
import { Game } from '../server/src/game/room.ts';

const members = [{ id: 1, name: 'A', color: '#f00' }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members as any, () => {}, () => {});

// cenário controlado: Centro da Cidade LONGE; os 3 camps PERTO da origem.
g.buildings.clear();
let id = 500;
const addB = (type: string, tileX: number, tileY: number) => {
  const b = { id: ++id, owner: 1, type, tileX, tileY, hp: 999, progress: 1, queue: [] };
  g.buildings.set(b.id, b);
  return b;
};
const tc = addB('town_center', 60, 60);
const lumber = addB('lumber_camp', 5, 5);
const mill = addB('mill', 7, 5);
const mining = addB('mining_camp', 5, 7);

let pass = 0, fail = 0;
const check = (label: string, got: { id: number; type: string } | null, wantId: number) => {
  const ok = !!got && got.id === wantId;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}  (veio: ${got ? got.type + '#' + got.id : 'null'})`);
  ok ? pass++ : fail++;
};

// aldeão perto da origem (4,4) carregando cada recurso
check('madeira -> Madeireira', g.findNearestDropOff(1, 4, 4, 'wood'), lumber.id);
check('comida  -> Moinho', g.findNearestDropOff(1, 4, 4, 'food'), mill.id);
check('ouro    -> Campo de Mineração', g.findNearestDropOff(1, 4, 4, 'gold'), mining.id);
check('pedra   -> Campo de Mineração', g.findNearestDropOff(1, 4, 4, 'stone'), mining.id);

// mesmo com o Moinho MAIS PERTO, madeira NÃO vai pro Moinho (especializado)
check('madeira ignora Moinho perto -> Madeireira', g.findNearestDropOff(1, 6, 5, 'wood'), lumber.id);

// sem Madeireira: madeira cai no Centro da Cidade (aceita tudo), não no Moinho
g.buildings.delete(lumber.id);
check('madeira sem Madeireira -> Centro da Cidade', g.findNearestDropOff(1, 4, 4, 'wood'), tc.id);

console.log(fail === 0 ? '\nTODOS OS TESTES DE DROP-OFF PASSARAM' : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
