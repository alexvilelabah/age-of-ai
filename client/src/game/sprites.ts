// Carregador de SPRITES de prédio (PNGs em /public/sprites/). Se existir um
// sprite pro tipo (e opcionalmente pra era), o renderer desenha a imagem no
// lugar da arte procedural; se não existir, cai no desenho por código.
// Mesmo espírito do sistema de sons (arquivo-ou-reserva).
//
// IMPORTANTE: usar só arte LIVRE ou gerada por IA que é do usuário — nunca
// assets extraídos do AoE2 ou de jogos comerciais.
//
// VARIANTES POR ERA: cada prédio pode evoluir de visual por era (estilo AoE2).
// Arquivo base `<type>.png` serve todas as eras (reserva). Se existir
// `<type>_<era>.png` (ex.: house_2.png), ele é usado quando o dono está naquela
// era; sem o arquivo daquela era, usa a era inferior mais próxima e, por fim, o
// base. Só se tenta carregar as eras em que o prédio pode existir (>= ageReq).

import type { BuildingType } from '@age/shared';
import { BUILDING_DEFS, MAX_AGE } from '@age/shared';

/** Ajuste de encaixe do sprite no tile (por tipo). Tudo afinável por print. */
export interface SpriteFit {
  file: string;
  /** Largura desenhada = largura do losango do footprint × scale. */
  scale: number;
  /** Deslocamento vertical da base, em frações da meia-altura do tile (+ desce). */
  dropY: number;
}

/** Exportada pro `scripts/sprite_height_test.ts` conferir contra os PNGs de
 *  verdade que nenhuma caixa de clique passou da altura do sprite. */
export const BUILDING_SPRITES: Partial<Record<BuildingType, SpriteFit>> = {
  // TORRE: a arte é altíssima (PNG ~276×890 => razão 3.2). Sendo 1×1, a 1.25 ela
  // desenhava 8.1 alturas de tile — o DOBRO do Centro da Cidade, que é 3×3 e
  // desenha 4.15. Ficava um espeto no meio da base. 0.9375 = 1.25 × 0.75, ou seja
  // 25% menor MANTENDO A FORMA.
  //
  // Já tentamos cortar o pé da imagem (era mais tentador: encurtava sem afinar).
  // Não presta: o corte é uma linha RETA e horizontal, mas no isométrico a base
  // do prédio é um LOSANGO — a quina da frente desce mais que os lados. A torre
  // ficava com a borda de baixo reta, parecendo torta/enfiada no chão, enquanto
  // o vizinho tinha base com profundidade. Encolher preserva a base que o
  // desenhista já fez na perspectiva certa. Não voltar pro corte.
  watch_tower: { file: 'watch_tower.png', scale: 0.9375, dropY: 0.4 },
  market: { file: 'market.png', scale: 1.15, dropY: 0.3 },
  house: { file: 'house.png', scale: 1.3, dropY: 0.28 },
  stable: { file: 'stable.png', scale: 1.1, dropY: 0.3 },
  // CC calibrado por MEDIÇÃO dos PNGs (conteúdo ocupa ~97,4% da largura, ~1,5%
  // de folga embaixo, consistente nas 4 eras): scale 1.0 => base casa com os
  // cantos do losango; dropY 0.15 => base no canto frontal (antes afundava).
  town_center: { file: 'town_center.png', scale: 1.0, dropY: 0.15 },
  barracks: { file: 'barracks.png', scale: 1.1, dropY: 0.3 },
  blacksmith: { file: 'blacksmith.png', scale: 1.35, dropY: 0.22 },
  archery_range: { file: 'archery_range.png', scale: 1.15, dropY: 0.3 },
  mill: { file: 'mill.png', scale: 1.3, dropY: 0.28 },
  lumber_camp: { file: 'lumber_camp.png', scale: 1.3, dropY: 0.28 },
  mining_camp: { file: 'mining_camp.png', scale: 1.3, dropY: 0.28 },
  // PORTO: fica na água (2×2 encostado na costa); a arte é larga (o cais estende
  // pro lado), então escala um pouco maior. Calibrado por print no jogo.
  dock: { file: 'dock.png', scale: 1.35, dropY: 0.3 },
  // FAZENDA e MURO ficam PROCEDURAIS (a pedido): a fazenda desenhada por código já
  // estava boa; o muro é tile 1×1 que se repete/conecta em qualquer direção — sprite
  // reto só bateria numa diagonal (precisaria de set direcional + lógica de vizinho).
};

export class Sprites {
  // por tipo: mapa era->img (era 0 = arquivo base, reserva universal)
  private imgs = new Map<BuildingType, Map<number, HTMLImageElement>>();
  private fits = new Map<BuildingType, SpriteFit>();

  /** Dispara o carregamento dos PNGs presentes. Ausentes ficam sem sprite. */
  preload(base = '/sprites/'): void {
    for (const [type, fit] of Object.entries(BUILDING_SPRITES) as [BuildingType, SpriteFit][]) {
      this.fits.set(type, fit);
      const perEra = new Map<number, HTMLImageElement>();
      this.imgs.set(type, perEra);
      const load = (era: number, file: string): void => {
        const img = new Image();
        img.onload = () => { perEra.set(era, img); };
        img.onerror = () => { /* arquivo ausente: usa reserva/procedural */ };
        img.src = base + file;
      };
      // base (sem sufixo) = reserva pra qualquer era
      load(0, fit.file);
      // variantes por era: <type>_<era>.png, só das eras em que o prédio existe
      const dot = fit.file.lastIndexOf('.');
      const stem = fit.file.slice(0, dot), ext = fit.file.slice(dot);
      const ageReq = BUILDING_DEFS[type].ageReq;
      for (let a = ageReq; a <= MAX_AGE; a++) load(a, `${stem}_${a}${ext}`);
    }
  }

  /** Sprite pra este tipo na era dada, ou null (então usa o desenho por código).
   *  Preferência: era exata → era inferior mais próxima → base. */
  get(type: BuildingType, age = 1): { img: HTMLImageElement; fit: SpriteFit } | null {
    const perEra = this.imgs.get(type);
    const fit = this.fits.get(type);
    if (!perEra || !fit) return null;
    // Sem crescimento por era: o prédio preenche o footprint em TODAS as eras
    // (fit.scale já é o tamanho "cheio"). Antes ele encolhia na Era 1 e ficava
    // menor que o quadrado de seleção. A ARTE ainda pode mudar por era abaixo
    // (variantes <type>_<era>.png); só o encolhimento saiu.
    for (let a = age; a >= 1; a--) { const img = perEra.get(a); if (img) return { img, fit }; }
    const b = perEra.get(0);
    return b ? { img: b, fit } : null;
  }
}

/** Sprites de ÁRVORE (variações sorteadas por posição). Estáticas, sem era.
 *  tree_1.png, tree_2.png, ... — se nenhuma existir, o renderer usa a árvore
 *  procedural. Mesmo espírito do fallback dos prédios. */
export class TreeSprites {
  private imgs: (HTMLImageElement | undefined)[] = [];

  preload(base = '/sprites/', count = 8): void {
    for (let i = 1; i <= count; i++) {
      const img = new Image();
      img.onload = () => { this.imgs[i - 1] = img; };
      img.onerror = () => { /* ausente: usa árvore procedural */ };
      img.src = `${base}tree_${i}.png`;
    }
  }

  /** Uma variação estável para o seed dado (posição da árvore), ou null. */
  get(seed: number): HTMLImageElement | null {
    const list = this.imgs.filter((x): x is HTMLImageElement => !!x);
    if (!list.length) return null;
    return list[Math.abs(seed) % list.length];
  }
}
