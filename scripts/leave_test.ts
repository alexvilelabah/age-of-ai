// Teste headless do "Sair da sala": (1) createRoom quando já preso numa sala NÃO
// recusa — sai da velha e cria a nova; (2) sair EM JOGO = desistir: o adversário
// humano recebe gameOver won:true e quem saiu fica livre pra criar sala de novo.
// Roda: npx tsx scripts/leave_test.ts
import { Lobby } from '../server/src/lobby.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Lobby();
let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sent = (out: any[], t: string) => out.some((m) => m.type === t);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastOf = (out: any[], t: string) => [...out].reverse().find((m) => m.type === t);

// --- (1) Rede de segurança: createRoom já estando numa sala troca de sala (não recusa) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outA: any[] = [];
const a = g.connect((m: unknown) => outA.push(m));
g.handleMessage(a.id, { type: 'setName', name: 'Ana', clientId: 'cid-ana' });
g.handleMessage(a.id, { type: 'createRoom' });
const room1 = a.roomId;
outA.length = 0;
g.handleMessage(a.id, { type: 'createRoom' }); // já está em room1
check('2º createRoom NÃO dá err.already_in_room', !outA.some((m) => m.type === 'error' && m.code === 'err.already_in_room'));
check('2º createRoom troca pra uma sala nova', a.roomId != null && a.roomId !== room1);

// --- (2) Sair EM JOGO = desistir: adversário humano recebe gameOver won:true ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outB: any[] = [];
const b = g.connect((m: unknown) => outB.push(m));
g.handleMessage(b.id, { type: 'setName', name: 'Bia', clientId: 'cid-bia' });
// A monta uma sala só com humanos: cria (vem com 1 bot), tira o bot, B entra
g.handleMessage(a.id, { type: 'leaveRoom' });
g.handleMessage(a.id, { type: 'createRoom' });
g.handleMessage(a.id, { type: 'removeBot' });
const roomId = a.roomId;
g.handleMessage(b.id, { type: 'joinRoom', roomId });
g.handleMessage(b.id, { type: 'setReady', ready: true });
outA.length = 0; outB.length = 0;
g.handleMessage(a.id, { type: 'startGame' });
check('partida começou (A e B receberam gameStart)', sent(outA, 'gameStart') && sent(outB, 'gameStart'));

// A desiste pela engrenagem (leaveRoom em jogo)
outA.length = 0; outB.length = 0;
g.handleMessage(a.id, { type: 'leaveRoom' });
check('A saiu da sala (recebeu leftRoom)', sent(outA, 'leftRoom'));
check('A não fica preso (roomId = null)', a.roomId == null);
const go = lastOf(outB, 'gameOver');
check('B recebeu gameOver', !!go);
check('B venceu por desistência (won:true)', !!go && go.won === true);

// Depois de sair, A consegue criar sala nova
outA.length = 0;
g.handleMessage(a.id, { type: 'createRoom' });
check('A cria sala nova após sair', a.roomId != null && !outA.some((m) => m.type === 'error'));

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE SAIR-DA-SALA PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
