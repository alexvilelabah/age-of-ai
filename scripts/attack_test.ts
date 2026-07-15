// Teste headless de ATACAR PRÉDIO INIMIGO (corpo a corpo).
//
// Bug que isto trava (achado pelo dono em 15/07/2026): `distToTarget` media a
// distância até um prédio misturando ÍNDICE de tile com coordenada float —
// clampava `u.x/u.y` no intervalo dos índices e depois somava 0.5 como se fosse
// índice. Resultado: apontava pro tile errado e INFLAVA a distância (~1.4 onde a
// parede estava a 0.8). Como o espadachim tem alcance 1, ele NUNCA alcançava:
// ficava "movingToAttack" pra sempre sem encostar um dedo no prédio. Na prática,
// unidade CORPO A CORPO não conseguia derrubar prédio nenhum (arqueiro, com
// alcance maior, disfarçava o problema).
//
// Roda: npx tsx scripts/attack_test.ts
import { Game } from '../server/src/game/room.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const members = [{ id: 1, name: 'A', color: '#f00' }, { id: 2, name: 'B', color: '#00f' }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkGame = (): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = new Game(members as any, () => {}, () => {});
  g.buildings.clear();
  g.units.clear();
  return g;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const casaInimiga = (g: any, id: number, tx: number, ty: number): any => {
  const b = { id, owner: 2, type: 'house', tileX: tx, tileY: ty, hp: 250, progress: 1, queue: [] };
  g.buildings.set(id, b);
  return b;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const soldado = (g: any, id: number, x: number, y: number, owner = 1): any => {
  const u = { id, owner, type: 'swordsman', x, y, hp: 100, state: 'idle', path: [], attackCooldown: 0, carryAmount: 0 };
  g.units.set(id, u);
  return u;
};

// --- a distância até o prédio é medida na BORDA (não inflada) ---
{
  const g = mkGame();
  const casa = casaInimiga(g, 900, 20, 20); // ocupa [20..22] (size 2 => borda em x=20)
  const u = soldado(g, 500, 19.2, 20.5);    // 0.8 da parede oeste
  const d = g.distToTarget(u, casa.id);
  check(`distância até a parede ≈ 0.8 (medido ${d.toFixed(2)}, não pode inflar)`, Math.abs(d - 0.8) < 0.05);
  check('fica dentro do alcance do corpo a corpo', d <= g.unitRange(u));
}

// --- colado na parede: bate ---
{
  const g = mkGame();
  const casa = casaInimiga(g, 900, 20, 20);
  const u = soldado(g, 500, 19.2, 20.5);
  g.cmdAttack(1, [500], casa.id);
  const hp0 = casa.hp;
  for (let i = 0; i < 50; i++) g.step();
  check('espadachim colado DANIFICA a casa inimiga', casa.hp < hp0);
  check('e entra no estado "attacking"', u.state === 'attacking');
}

// --- diagonal: o caso que travava feio (dist 1.41 > alcance 1) ---
{
  const g = mkGame();
  const casa = casaInimiga(g, 901, 20, 20);
  soldado(g, 501, 19.4, 19.4);
  g.cmdAttack(1, [501], casa.id);
  const hp0 = casa.hp;
  for (let i = 0; i < 50; i++) g.step();
  check('espadachim na DIAGONAL também danifica', casa.hp < hp0);
}

// --- longe: anda até lá e destrói ---
{
  const g = mkGame();
  const casa = casaInimiga(g, 902, 30, 30);
  soldado(g, 502, 24, 30.5);
  g.cmdAttack(1, [502], casa.id);
  for (let i = 0; i < 900; i++) g.step(); // ~90s
  check('soldado longe anda até lá e DESTRÓI a casa', !g.buildings.has(902));
}

// --- não ataca prédio ALIADO/próprio ---
{
  const g = mkGame();
  const minha = { id: 903, owner: 1, type: 'house', tileX: 20, tileY: 20, hp: 250, progress: 1, queue: [] };
  g.buildings.set(minha.id, minha);
  const u = soldado(g, 503, 19.2, 20.5);
  g.cmdAttack(1, [503], minha.id);
  const hp0 = minha.hp;
  for (let i = 0; i < 50; i++) g.step();
  check('NÃO ataca prédio próprio', minha.hp === hp0 && u.attackTargetId === undefined);
}

// --- não regrediu: ainda bate em UNIDADE inimiga ---
{
  const g = mkGame();
  const alvo = soldado(g, 600, 20, 20, 2);
  soldado(g, 504, 19.2, 20);
  g.cmdAttack(1, [504], alvo.id);
  const hp0 = alvo.hp;
  for (let i = 0; i < 50; i++) g.step();
  check('ainda danifica UNIDADE inimiga (não regrediu)', alvo.hp < hp0);
}

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE ATAQUE PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
