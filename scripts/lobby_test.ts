// Teste headless: nome DUPLICADO é rejeitado (avisa "já em uso") + nome do host
// na lista de salas. Roda: npx tsx scripts/lobby_test.ts
import { Lobby } from '../server/src/lobby.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Lobby();
let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const outA: any[] = [], outB: any[] = [];
const a = g.connect((m: unknown) => outA.push(m));
const b = g.connect((m: unknown) => outB.push(m));
const sent = (out: { type: string }[], t: string) => out.some((m) => m.type === t);

// A escolhe "alex" -> aceito
outA.length = 0; g.handleMessage(a.id, { type: 'setName', name: 'alex' });
check('A "alex" ACEITO (nameOk)', a.name === 'alex' && sent(outA, 'nameOk'));

// B tenta "alex" -> REJEITADO, nome não muda
outB.length = 0; g.handleMessage(b.id, { type: 'setName', name: 'alex' });
check('B "alex" REJEITADO (nameTaken)', sent(outB, 'nameTaken') && b.name !== 'alex');

// B tenta "ALEX" (maiúsculo) -> também rejeitado
outB.length = 0; g.handleMessage(b.id, { type: 'setName', name: 'ALEX' });
check('B "ALEX" REJEITADO (case-insensitive)', sent(outB, 'nameTaken'));

// B escolhe outro nome -> aceito
outB.length = 0; g.handleMessage(b.id, { type: 'setName', name: 'bruno' });
check('B "bruno" ACEITO', b.name === 'bruno' && sent(outB, 'nameOk'));

// A sai -> "alex" fica livre pra B
g.disconnect(a.id);
outB.length = 0; g.handleMessage(b.id, { type: 'setName', name: 'alex' });
check('após A sair, B pode usar "alex"', b.name === 'alex' && sent(outB, 'nameOk'));

// a lista de salas mostra o NOME do host
g.handleMessage(b.id, { type: 'createRoom' });
const sums = g.roomSummaries();
check('sala tem hostName = "alex"', sums.length === 1 && sums[0].hostName === 'alex');
check('sala ainda tem um id interno', typeof sums[0].id === 'string' && sums[0].id.length > 0);

console.log(fail === 0 ? '\nTODOS OS TESTES DE SALA/NOME PASSARAM' : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
