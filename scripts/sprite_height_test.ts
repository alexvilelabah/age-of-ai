// Guarda contra ALTURA VISUAL DEFASADA — a família de bug que mais mordeu neste
// projeto. A caixa de clique do prédio (`B_H`, em client/src/state.ts) e a arte
// (o PNG) moram em arquivos diferentes: trocar o desenho não avisa ninguém, e o
// número velho fica mentindo calado.
//
// Já aconteceu duas vezes:
//   - o Centro ficou com B_H 3.2 (altura da arte PROCEDURAL) quando o PNG dele
//     só sobe 1.15 => ele engolia o clique de árvore/mina que aparecia atrás e
//     acima, e o aldeão entrava no prédio em vez de cortar lenha;
//   - a flecha da torre nascia em `hh*3.2` (idem) => saía do pé da torre.
//
// A DIREÇÃO DO ERRO é o que importa: B_H BAIXO demais é inofensivo (só não dá
// pra clicar no alto do prédio); ALTO demais é o veneno. Então o teste reprova
// só o lado perigoso — B_H maior que o sprite.
//
// Lê apenas o cabeçalho IHDR do PNG (largura/altura nos bytes 16..24), sem
// descompactar pixel nenhum.
//
// Roda: npx tsx scripts/sprite_height_test.ts
import { readFileSync, existsSync } from 'node:fs';
import { BUILDING_DEFS, MAX_AGE } from '../shared/src/index.ts';
import { BUILDING_SPRITES } from '../client/src/game/sprites.ts';
import { B_H } from '../client/src/state.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const DIR = 'client/public/sprites/';
/** Folga: B_H é afinado no olho, arredondar 1.15 pra 1.2 não é o bug que caçamos. */
const TOL = 0.1;
/** Mesmo default do pickAt pra tipo fora da tabela. */
const B_H_DEFAULT = 2.5;

/** Largura/altura do PNG direto do IHDR (primeiro chunk, offset fixo). */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

let checked = 0;
for (const [type, fit] of Object.entries(BUILDING_SPRITES)) {
  const def = BUILDING_DEFS[type as keyof typeof BUILDING_DEFS];
  if (!def) continue;
  const size = def.size;
  const claimed = B_H[type as keyof typeof B_H] ?? B_H_DEFAULT;

  // arquivo base + variantes por era, iguais às que o Sprites.preload() tenta
  const dot = fit.file.lastIndexOf('.');
  const stem = fit.file.slice(0, dot), ext = fit.file.slice(dot);
  const files = [fit.file];
  for (let a = def.ageReq; a <= MAX_AGE; a++) files.push(`${stem}_${a}${ext}`);

  for (const f of files) {
    const path = DIR + f;
    if (!existsSync(path)) continue; // era sem arte própria: usa a inferior
    const { w, h } = pngSize(path);
    // Mesma conta do buildingSpriteBox (renderer), em unidades de diagonal:
    // desenha largura = losango*scale, altura = largura * razão do PNG.
    const realH = 2 * size * fit.scale * (h / w) - size;
    checked++;
    check(
      `${f}: caixa de clique ${claimed} nao passa do sprite (${realH.toFixed(2)})`,
      claimed <= realH + TOL,
    );
  }
}

check('conferiu pelo menos um PNG (senao o teste nao esta olhando nada)', checked > 0);

// A TORRE foi encolhida (scale 1.25 -> 0.9375) porque, sendo 1x1, ela desenhava
// o DOBRO da altura do Centro (3x3) e virava um espeto no meio da base. Trava o
// nerf pra ele nao sumir calado numa refatoracao.
//
// Nao encurtar a torre CORTANDO a imagem: o corte deixa a borda de baixo reta e
// no isometrico a base e um LOSANGO, entao ela fica parecendo torta. Ja tentamos.
{
  /** Altura DESENHADA, em alturas de tile: drawH/th = 2*size*scale*(imgH/imgW).
   *  (Nao confundir com a altura de CLIQUE acima, que desconta o footprint.) */
  const alturaDesenhada = (type: 'watch_tower' | 'town_center', png: string): number => {
    const fit = BUILDING_SPRITES[type]!;
    const { w, h } = pngSize(DIR + png);
    return 2 * BUILDING_DEFS[type].size * fit.scale * (h / w);
  };
  const torre = alturaDesenhada('watch_tower', 'watch_tower_2.png');
  const centro = alturaDesenhada('town_center', 'town_center_1.png');
  check(`torre era 2 encolhida: ${torre.toFixed(2)} alturas de tile (era 8.06 na scale 1.25)`, torre < 6.5);
  check(
    `torre 1x1 nao volta a ser o dobro do Centro 3x3 (${torre.toFixed(2)} vs ${centro.toFixed(2)})`,
    torre <= centro * 1.6,
  );
}

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE ALTURA DE SPRITE PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
