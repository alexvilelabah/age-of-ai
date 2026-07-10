// Teste headless: reconexão/refresh reassume o mesmo nome via clientId (takeover),
// e um usuário DIFERENTE (outro clientId) continua barrado.
// Roda: npx tsx scripts/reconnect_test.ts
import { Lobby } from '../server/src/lobby.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Lobby();
let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };
const sent = (out: { type: string }[], t: string) => out.some((m) => m.type === t);

const CID1 = 'cid-alex-111';
const CID2 = 'cid-outro-222';

// A entra como "alex" com o clientId 1
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outA: any[] = [];
const a = g.connect((m: unknown) => outA.push(m));
g.handleMessage(a.id, { type: 'setName', name: 'alex', clientId: CID1 });
check('A "alex" (cid1) ACEITO', a.name === 'alex' && a.clientId === CID1 && sent(outA, 'nameOk'));

// A cria uma sala (pra provar que o takeover também limpa a sala da conexão antiga)
g.handleMessage(a.id, { type: 'createRoom' });
check('A criou uma sala', g.roomSummaries().length === 1);

// --- REFRESH: a MESMA pessoa (mesmo clientId) reconecta como B, SEM o close de A ter chegado ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outB: any[] = [];
const b = g.connect((m: unknown) => outB.push(m));
g.handleMessage(b.id, { type: 'setName', name: 'alex', clientId: CID1 });
check('B "alex" (mesmo cid1) ACEITO via takeover', b.name === 'alex' && sent(outB, 'nameOk') && !sent(outB, 'nameTaken'));
check('conexão antiga A foi despejada (fora do conns)', g.conns.has(a.id) === false);
check('a sala da conexão antiga foi limpa', g.roomSummaries().length === 0);

// --- Outro usuário (clientId diferente) NÃO pode roubar "alex" ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outC: any[] = [];
const c = g.connect((m: unknown) => outC.push(m));
g.handleMessage(c.id, { type: 'setName', name: 'alex', clientId: CID2 });
check('C "alex" (cid2 diferente) REJEITADO (nameTaken)', sent(outC, 'nameTaken') && c.name !== 'alex');

// --- Sem clientId (compat): comportamento antigo — duplicado é barrado ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outD: any[] = [];
const d = g.connect((m: unknown) => outD.push(m));
g.handleMessage(d.id, { type: 'setName', name: 'alex' }); // sem clientId
check('D "alex" (sem clientId) REJEITADO', sent(outD, 'nameTaken') && d.name !== 'alex');

console.log(fail === 0 ? '\nTODOS OS TESTES DE RECONEXÃO PASSARAM' : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
