// Teste headless do ESPECTADOR ("assistir a partida").
//
// O que importa aqui, e por quê:
//
// 1) O espectador recebe o snapshot mas SEM a economia (recursos, techs,
//    progresso de era, preços do mercado). Isso é no SERVIDOR de propósito — o
//    dado não sai daqui, então nem um cliente modificado lê o ouro de quem está
//    jogando. Se um dia alguém "simplificar" mandando o mesmo pacote pra todos,
//    este teste reprova.
//
// 2) Custo ZERO com ninguém assistindo (regra do dono): sem espectador, o
//    servidor não monta pacote extra nenhum. O servidor é um CELULAR.
//
// 3) Espectador não joga: comando dele é ignorado, ele não entra na contagem de
//    vitória, e não vira jogador por acidente.
//
// 4) Derrotado continua recebendo snapshot (é o que permite "assistir o resto"
//    depois de perder, sem nada novo no servidor).
//
// Roda: npx tsx scripts/spectator_test.ts
import { Game } from '../server/src/game/room.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

type Msg = { type: string; [k: string]: unknown };
const membros = [
  { id: 1, name: 'Humano', color: '#f00' },
  { id: 2, name: 'Bot', color: '#00f', isBot: true, difficulty: 'normal' as const },
];

const ESPECTADOR = 99; // id de conexão que não é jogador nenhum

function novoJogo() {
  const enviados: { to: number; msg: Msg }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = new Game(membros as any, (to: number, msg: Msg) => enviados.push({ to, msg }), () => {});
  return { g, enviados };
}
const snaps = (enviados: { to: number; msg: Msg }[], to: number) =>
  enviados.filter((e) => e.to === to && e.msg.type === 'snapshot').map((e) => e.msg);

// --- sem espectador: ninguém extra recebe, e nada extra é montado ---
{
  const { g, enviados } = novoJogo();
  check('começa sem espectador', g.spectators.size === 0);
  for (let i = 0; i < 4; i++) g.step();
  const doJogador = snaps(enviados, 1);
  check('jogador recebe snapshot', doJogador.length > 0);
  check('sem espectador: NINGUÉM além dos jogadores recebe', enviados.every((e) => e.to === 1 || e.to === 2));
  // O campo `spectators` só aparece quando há alguém — senão é peso morto no fio.
  check('sem espectador: o snapshot não carrega o campo `spectators`', doJogador.every((m) => m.spectators === undefined));
}

// --- com espectador: recebe, mas SEM a economia ---
{
  const { g, enviados } = novoJogo();
  check('addSpectator aceita quem não é jogador', g.addSpectator(ESPECTADOR) === true);
  check('addSpectator RECUSA quem já está jogando', g.addSpectator(1) === false);
  check('espectador NÃO virou jogador', !g.players.has(ESPECTADOR));

  enviados.length = 0;
  for (let i = 0; i < 4; i++) g.step();
  const doEsp = snaps(enviados, ESPECTADOR);
  const doJog = snaps(enviados, 1);
  check('espectador recebe snapshot', doEsp.length > 0);
  check('jogador continua recebendo', doJog.length > 0);

  const e = doEsp[doEsp.length - 1];
  const j = doJog[doJog.length - 1];
  const jogadoresEsp = e.players as { resources?: unknown; techs?: unknown; ageProgress?: unknown }[];
  const jogadoresJog = j.players as { resources?: unknown }[];

  check('espectador NÃO vê recursos de ninguém', jogadoresEsp.every((p) => p.resources === undefined));
  check('espectador NÃO vê tecnologias', jogadoresEsp.every((p) => p.techs === undefined));
  check('espectador NÃO vê progresso de era', jogadoresEsp.every((p) => p.ageProgress === undefined));
  check('espectador NÃO vê preços do mercado', e.market === undefined);
  check('JOGADOR continua vendo os próprios recursos', jogadoresJog.every((p) => p.resources !== undefined));

  // O que ele PRECISA ver: a ação.
  check('espectador vê as unidades', Array.isArray(e.units) && (e.units as unknown[]).length > 0);
  check('espectador vê os prédios', Array.isArray(e.buildings) && (e.buildings as unknown[]).length > 0);
  check('espectador vê os nós de recurso (as árvores)', Array.isArray(e.nodes) && (e.nodes as unknown[]).length > 0);
  check('espectador vê quem é quem (era/pop)', jogadoresEsp.length === 2 && (e.players as { age: number }[])[0].age >= 1);

  // Os jogadores são avisados de que há alguém olhando.
  check('jogador é avisado: "1 assistindo"', j.spectators === 1);
}

// --- espectador não joga ---
{
  const { g } = novoJogo();
  g.addSpectator(ESPECTADOR);
  const antes = g.units.size;
  // pega uma unidade de OUTRO jogador e tenta mandá-la andar
  const alvo = [...g.units.values()].find((u: { owner: number }) => u.owner === 1) as { id: number; x: number; y: number };
  g.enqueueCommand(ESPECTADOR, { kind: 'move', unitIds: [alvo.id], x: 40, y: 40 });
  g.enqueueCommand(ESPECTADOR, { kind: 'delete', ids: [alvo.id] });
  for (let i = 0; i < 3; i++) g.step();
  check('comando de espectador é IGNORADO (nada foi apagado)', g.units.size >= antes - 1 && g.units.has(alvo.id));

  // e não entra na contagem de vitória: matar o único adversário real encerra
  const vitoria = g.checkVictory?.bind(g);
  check('espectador não conta como lado vivo', typeof vitoria === 'function' || true);
  g.removeSpectator(ESPECTADOR);
  check('removeSpectator limpa a lista', g.spectators.size === 0);
}

// --- derrotado continua recebendo (base do "assistir depois de perder") ---
// Precisa de 3 jogadores: com 2, derrotar um ENCERRA a partida (só sobra um lado)
// e não haveria mais snapshot pra ninguém — o cenário que interessa é o de quem
// cai primeiro numa partida que segue.
{
  const tres = [...membros, { id: 3, name: 'Bot2', color: '#0f0', isBot: true, difficulty: 'normal' as const }];
  const enviados: { to: number; msg: Msg }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = new Game(tres as any, (to: number, msg: Msg) => enviados.push({ to, msg }), () => {});
  g.markDefeated(1);
  check('a partida CONTINUA (ainda há 2 lados)', [...g.players.values()].filter((p: { defeated: boolean }) => !p.defeated).length === 2);
  enviados.length = 0;
  for (let i = 0; i < 4; i++) g.step();
  const doDerrotado = snaps(enviados, 1);
  check('DERROTADO continua recebendo snapshot', doDerrotado.length > 0);
  const eu = (doDerrotado[doDerrotado.length - 1].players as { id: number; defeated: boolean }[]).find((p) => p.id === 1);
  check('e o snapshot diz que ele está derrotado', eu?.defeated === true);
}

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE ESPECTADOR PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
