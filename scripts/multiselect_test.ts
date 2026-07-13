// Teste headless da MULTI-SELEÇÃO de prédios (treinar em massa). Cobre o miolo
// puro: selectedOwnBuildings() só devolve prédios PRÓPRIOS da seleção, e o filtro
// por tipo do representante (usado no fan-out do treino) mira o conjunto certo.
// A parte de duplo-clique/HUD é DOM e é verificada no navegador/telefone.
// Roda: npx tsx scripts/multiselect_test.ts
import { GameState } from '../client/src/state.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const map: any = { size: 16, tiles: new Uint8Array(16 * 16) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const players: any = [
  { id: 0, name: 'Eu', color: '#f00' },
  { id: 1, name: 'Inimigo', color: '#00f' },
];
const gs = new GameState(map, players, 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const b = (id: number, owner: number, type: string, progress = 1): any => ({ id, owner, type, tileX: 0, tileY: 0, hp: 100, progress, queue: [] });
gs.buildings.set(1, b(1, 0, 'barracks'));
gs.buildings.set(2, b(2, 0, 'barracks'));
gs.buildings.set(3, b(3, 0, 'barracks'));
gs.buildings.set(4, b(4, 1, 'barracks')); // inimigo
gs.buildings.set(5, b(5, 0, 'town_center'));
gs.buildings.set(6, b(6, 0, 'barracks', 0.4)); // meu, EM OBRA

// (1) seleção vazia -> nada
check('seleção vazia -> selectedOwnBuildings vazio', gs.selectedOwnBuildings().length === 0);

// (2) meus 3 barracks selecionados -> devolve os 3
gs.selection.add(1); gs.selection.add(2); gs.selection.add(3);
const own = gs.selectedOwnBuildings();
check('3 barracks meus selecionados -> devolve 3', own.length === 3);
check('todos são barracks meus (owner 0)', own.every((x) => x.owner === 0 && x.type === 'barracks'));

// (3) fan-out do treino: filtra pelo tipo do representante E prontos -> mira os 3
// (mesmo filtro do hud.ts: type igual + progress >= 1)
const fanout = (): number[] => {
  const rep = gs.selectedBuilding();
  if (!rep) return [];
  return gs.selectedOwnBuildings()
    .filter((x) => x.type === rep.type && (x.progress ?? 1) >= 1)
    .map((x) => x.id);
};
check('representante é barracks', gs.selectedBuilding()?.type === 'barracks');
check('fan-out mira os 3 barracks', fanout().sort().join(',') === '1,2,3');

// (4) prédio inimigo na seleção é ignorado
gs.selection.add(4);
check('barracks inimigo na seleção é ignorado', gs.selectedOwnBuildings().length === 3);

// (4b) barracks EM OBRA na seleção: conta como "meu" mas fica FORA do fan-out/×N
gs.selection.add(6);
check('em obra entra em selectedOwnBuildings (é meu)', gs.selectedOwnBuildings().length === 4);
check('fan-out/×N excluem o em obra', fanout().sort().join(',') === '1,2,3');
gs.selection.delete(4);
gs.selection.delete(6);

// (5) seleção com tipos misturados: fan-out treina só o tipo do representante
gs.selection.clear();
gs.selection.add(5); // TC primeiro -> vira o representante
gs.selection.add(1); // + um barracks
const rep2 = gs.selectedBuilding();
const t2 = gs.selectedOwnBuildings().filter((x) => x.type === rep2!.type);
check('representante do misto é o TC(5)', rep2?.id === 5 && rep2?.type === 'town_center');
check('fan-out do TC mira só o TC, não o barracks', t2.length === 1 && t2[0].id === 5);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE MULTI-SELEÇÃO PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
