// Teste headless do PING do minimapa: o sinal chega só pros ALIADOS (inclui o
// próprio autor), nunca pros inimigos; em FFA cai só no próprio; coordenada
// fora do mapa é ignorada; a cor é a do autor.
// Roda: npx tsx scripts/ping_test.ts
import { Game } from '../server/src/game/room.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

type Msg = { type: string; [k: string]: unknown };
let sent: { to: number; msg: Msg }[] = [];

// Time 1 = humano(1) + bot(2); Time 2 = bot(3). Bot 4 sozinho (FFA).
const members = [
  { id: 1, name: 'Humano', color: '#f00', isBot: false, team: 1 },
  { id: 2, name: 'BotAmigo', color: '#00f', isBot: true, difficulty: 'normal' as const, team: 1 },
  { id: 3, name: 'BotInimigo', color: '#0f0', isBot: true, difficulty: 'normal' as const, team: 2 },
  { id: 4, name: 'BotSolo', color: '#ff0', isBot: true, difficulty: 'normal' as const },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members, (to: number, msg: Msg) => sent.push({ to, msg }), () => {}, 'normal');

// (1) humano (time 1) sinaliza -> chega no humano e no BotAmigo; NÃO no inimigo/solo
sent = [];
g.signalPing(1, 60, 60);
const pings = sent.filter((s) => s.msg.type === 'ping');
const recips = new Set(pings.map((s) => s.to));
check('ping do humano chega no PRÓPRIO (1)', recips.has(1));
check('ping do humano chega no ALIADO (2)', recips.has(2));
check('ping do humano NÃO chega no inimigo (3)', !recips.has(3));
check('ping do humano NÃO chega no solo (4)', !recips.has(4));
check('ping carrega a cor do autor (#f00)', (pings[0]?.msg as any)?.color === '#f00');
check('ping carrega as coordenadas', (pings[0]?.msg as any)?.x === 60 && (pings[0]?.msg as any)?.y === 60);

// (2) FFA: o solo (4) sinaliza -> cai só nele mesmo
sent = [];
g.signalPing(4, 40, 40);
const soloRecips = new Set(sent.filter((s) => s.msg.type === 'ping').map((s) => s.to));
check('ping do solo cai só nele (4)', soloRecips.size === 1 && soloRecips.has(4));

// (3) coordenada fora do mapa é ignorada (nenhum ping)
sent = [];
g.signalPing(1, -5, 60);
g.signalPing(1, 60, 999999);
g.signalPing(1, NaN, 60);
check('coordenada inválida/fora do mapa não gera ping', sent.filter((s) => s.msg.type === 'ping').length === 0);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE PING PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
