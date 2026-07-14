// Teste do posicionamento de spawn: no 1v1 os jogadores nascem em cantos OPOSTOS
// (diagonal), nunca vizinhos — convenção de RTS (AoE): maximizar a distância
// entre inimigos. No minimapa (losango) isso é topo x baixo, não topo x direita.
// Roda: npx tsx scripts/spawn_test.ts
import { generateMap } from '../server/src/game/mapgen.ts';
import { MAP_SIZE } from '../shared/src/index.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const tcsOf = (playerCount: number, seed: number): { x: number; y: number }[] => {
  const g = generateMap(playerCount, seed);
  return g.buildings
    .filter((b) => b.type === 'town_center')
    .map((b) => ({ x: b.tileX + 1, y: b.tileY + 1 }));
};

const half = MAP_SIZE / 2;

// ---------- 1v1: cantos diagonalmente OPOSTOS ----------
const two = tcsOf(2, 12345);
check('1v1 tem 2 Centros', two.length === 2);
const dx = Math.abs(two[0].x - two[1].x);
const dy = Math.abs(two[0].y - two[1].y);
check(`1v1 separado na horizontal (dx ${dx} > ${half})`, dx > half);
check(`1v1 separado na vertical (dy ${dy} > ${half})`, dy > half);
// se caíssem em cantos VIZINHOS, um dos eixos seria ~0 (topo-esq x topo-dir = mesmo y).
check('1v1 NÃO cai em cantos vizinhos (os dois eixos afastados)', dx > half && dy > half);
// prova que é o par mais distante possível: a diagonal supera o lado do quadrado.
const diag = Math.hypot(dx, dy);
const side = MAP_SIZE - 2 * 9; // ~lado entre cantos vizinhos (inset 9)
check(`1v1 usa a DIAGONAL do mapa (dist ${diag.toFixed(0)} > lado ${side})`, diag > side);

// determinístico entre seeds diferentes (cantos não dependem do seed)
const two2 = tcsOf(2, 98765);
check('1v1 é sempre diagonal (outro seed)', Math.abs(two2[0].x - two2[1].x) > half && Math.abs(two2[0].y - two2[1].y) > half);

// ---------- 4 jogadores: um em cada quadrante ----------
const four = tcsOf(4, 777);
check('4 jogadores = 4 Centros', four.length === 4);
const quads = new Set(four.map((t) => `${t.x < half ? 'L' : 'R'}${t.y < half ? 'T' : 'B'}`));
check('4 jogadores: um Centro em cada quadrante do mapa', quads.size === 4);

// ---------- 3 jogadores: 3 cantos distintos ----------
const three = tcsOf(3, 555);
check(
  '3 jogadores = 3 Centros distintos',
  three.length === 3 && new Set(three.map((t) => `${t.x},${t.y}`)).size === 3,
);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE SPAWN PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
