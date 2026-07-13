// Teste headless das salas-vitrine (social proof): quantidade 4..6, nomes
// distintos, "em jogo", lotação válida, e o STAGGERING — cada sala troca de
// nome no seu próprio minuto (defasado 10 min), nunca todas juntas.
// Roda: npx tsx scripts/fakerooms_test.ts
import { generateFakeRooms } from '../server/src/lobby.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

const HOUR = 3_600_000;
const MIN = 60_000;
const MAX = 4;

// --- invariantes (varre 500 horas em minutos variados) ---
let allInRange = true, allDistinct = true, allInGame = true, allLotOk = true, allIdsTagged = true;
for (let h = 0; h < 500; h++) {
  const rooms = generateFakeRooms(h * HOUR + (h % 60) * MIN, MAX);
  if (rooms.length < 4 || rooms.length > 6) allInRange = false;
  if (new Set(rooms.map((r) => r.hostName)).size !== rooms.length) allDistinct = false;
  for (const r of rooms) {
    if (!r.inGame) allInGame = false;
    if (r.playerCount < 2 || r.playerCount > MAX) allLotOk = false;
    if (!r.id.startsWith('live-')) allIdsTagged = false;
  }
}
check('quantidade sempre entre 4 e 6', allInRange);
check('nomes sempre distintos dentro da mesma leitura', allDistinct);
check('todas "em jogo" (Entrar desabilitado no cliente)', allInGame);
check('lotação sempre 2..max', allLotOk);
check('ids marcados (live-) — não colidem com sala real', allIdsTagged);

// determinístico: mesmo instante -> mesma saída
const a = generateFakeRooms(1000 * HOUR + 123, MAX);
const b = generateFakeRooms(1000 * HOUR + 123, MAX);
check('determinístico no mesmo instante', JSON.stringify(a) === JSON.stringify(b));

// --- STAGGERING: cada vaga base (0-3) troca no seu minuto (0/10/20/30) ---
const T = 1000 * HOUR;
const at = (min: number): ReturnType<typeof generateFakeRooms> => generateFakeRooms(T + min * MIN, MAX);
const slot = (rooms: ReturnType<typeof generateFakeRooms>, i: number): string | undefined =>
  rooms.find((r) => r.id.startsWith(`live-${i}-`))?.hostName;
const nameAt = (min: number, i: number): string | undefined => slot(at(min), i);

let staggerOk = true, stableOk = true;
for (let i = 0; i < 4; i++) {
  const m = i * 10; // minuto de troca da vaga i
  if (nameAt(m - 1, i) === nameAt(m + 1, i)) staggerOk = false; // deveria trocar em i*10
  if (nameAt(m + 1, i) !== nameAt(m + 9, i)) stableOk = false;  // estável entre trocas
}
check('cada sala troca no SEU minuto (0/10/20/30)', staggerOk);
check('nome fica estável entre as trocas da própria sala', stableOk);

// ao virar a hora (:00) só a vaga 0 muda; as outras NÃO trocam junto
const before = at(-1), after = at(1);
let othersStable = true;
for (let i = 1; i < 4; i++) if (slot(before, i) !== slot(after, i)) othersStable = false;
check('no :00 as outras salas NÃO trocam junto (staggered)', othersStable);
check('no :00 a sala 0 troca', slot(before, 0) !== slot(after, 0));

// --- oscilação real do total: aparecem 4, 5 E 6 ao longo do tempo ---
const counts = new Set<number>();
for (let h = 0; h < 400; h++) counts.add(generateFakeRooms(h * HOUR + 5 * MIN, MAX).length);
check('total oscila e inclui 4, 5 e 6 (não fica preso em 5/6)', counts.has(4) && counts.has(5) && counts.has(6));

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DE SALAS-VITRINE PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
