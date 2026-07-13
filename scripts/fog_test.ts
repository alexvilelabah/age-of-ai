// Teste headless da NÉVOA DE GUERRA (lógica pura, sem DOM): carimbo do círculo
// de visão, clamp nas bordas, "explorado" persistente vs "à vista" volátil,
// união de fontes, revealAll e checagens fora do mapa.
// Roda: npx tsx scripts/fog_test.ts
import { FogOfWar } from '../client/src/game/fog.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const N = 32;
const fog = new FogOfWar(N);

// (1) começa tudo escuro
check('começa sem nada à vista', fog.visible.every((v) => v === 0));
check('começa sem nada explorado', fog.explored.every((v) => v === 0));
check('canvas é null fora do navegador (teste headless)', fog.canvas === null);

// (2) carimbo: fonte no centro com raio 5 — centro visto, além do raio não
fog.recompute([{ x: 16, y: 16, r: 5 }]);
check('tile no centro da fonte fica à vista', fog.isVisible(16, 16) && fog.isVisible(15, 15));
check('tile na borda do raio (dist ~4.9) fica à vista', fog.isVisible(16, 20) && fog.isVisible(20, 16));
check('tile além do raio NÃO fica à vista', !fog.isVisible(16, 22) && !fog.isVisible(22, 22));
check('o que está à vista também vira explorado', fog.isExplored(16, 20));

// círculo, não quadrado: o canto (16+4, 16+4) dista ~5.66 > 5 → escuro
check('carimbo é circular (canto do quadrado fica fora)', !fog.isVisible(20, 20));

// (3) a fonte anda: o lugar antigo fica explorado mas SAI de vista
fog.recompute([{ x: 4, y: 4, r: 3 }]);
check('lugar antigo não está mais à vista', !fog.isVisible(16, 16));
check('lugar antigo continua explorado (lembrança)', fog.isExplored(16, 16));
check('lugar novo está à vista', fog.isVisible(4, 4));

// (4) clamp na borda do mapa: fonte no canto não estoura os arrays
fog.recompute([{ x: 0, y: 0, r: 6 }]);
check('fonte no canto ilumina o canto', fog.isVisible(0, 0) && fog.isVisible(3, 0));
check('fora do mapa nunca é visível/explorado', !fog.isVisible(-1, 0) && !fog.isExplored(0, -1) && !fog.isVisible(N, 5));

// (5) união de duas fontes separadas
fog.recompute([{ x: 5, y: 5, r: 3 }, { x: 25, y: 25, r: 3 }]);
check('duas fontes: as duas áreas à vista ao mesmo tempo', fog.isVisible(5, 5) && fog.isVisible(25, 25));
check('o vale entre elas fica escuro', !fog.isVisible(15, 15));

// (6) raio 0 ou negativo não faz nada
fog.recompute([{ x: 10, y: 10, r: 0 }]);
check('raio 0 não ilumina nada', fog.visible.every((v) => v === 0));

// (7) revealAll: tudo aberto e recompute posterior não re-esconde
fog.revealAll();
check('revealAll deixa tudo à vista e explorado', fog.isVisible(31, 31) && fog.isExplored(0, 31));
fog.recompute([{ x: 5, y: 5, r: 2 }]);
check('depois do revealAll o recompute não re-esconde (fim de jogo)', fog.isVisible(31, 31));

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE NÉVOA PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
