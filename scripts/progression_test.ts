// Teste headless das REGRAS DE PROGRESSÃO (padrão AoE2):
//  - avançar de era exige N prédios DIFERENTES da era atual (casa/fazenda/muralha NÃO contam);
//  - prédio acima da era é bloqueado no servidor;
//  - pré-requisito de prédio (Fazenda/Mercado ← Moinho; Arquearia/Estábulo/Ferraria ← Quartel).
// Roda: npx tsx scripts/progression_test.ts
import { Game } from '../server/src/game/room.ts';
import { buildingsToAdvance, countsForAgeUp } from '../shared/src/constants.ts';

// O servidor manda o erro como CÓDIGO + params (traduzido no cliente via i18n),
// não como texto pronto — então capturamos {code, params} e conferimos o código.
type ErrEntry = { code: string; params?: Record<string, string | number> };
const errors: ErrEntry[] = [];
const members = [{ id: 1, name: 'A', color: '#f00' }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members as any, (_pid: number, msg: { type: string; code?: string; params?: Record<string, string | number> }) => { if (msg.type === 'error' && msg.code) errors.push({ code: msg.code, params: msg.params }); }, () => {});

const p = g.players.get(1);
p.age = 1;
p.resources = { food: 9999, wood: 9999, gold: 9999, stone: 9999 };
g.buildings.clear();
let id = 100;
const addB = (type: string) => { const b = { id: ++id, owner: 1, type, tileX: 5, tileY: 5, hp: 999, progress: 1, queue: [] }; g.buildings.set(b.id, b); return b; };

let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };
const tryAdvance = () => { errors.length = 0; p.ageResearch = undefined; g.cmdAdvanceAge(1); return p.ageResearch !== undefined; };

// exigências por era (estilo AoM: 1 / 2 / 1 — tipos distintos elegíveis)
check('buildingsToAdvance(1) = 1', buildingsToAdvance(1) === 1);
check('buildingsToAdvance(2) = 2', buildingsToAdvance(2) === 2);
check('buildingsToAdvance(3) = 1 (só Estábulo)', buildingsToAdvance(3) === 1);
check('casa NÃO conta', !countsForAgeUp('house', 1));
check('fazenda NÃO conta', !countsForAgeUp('farm', 1));
check('muralha NÃO conta', !countsForAgeUp('wall', 1));
check('quartel conta (era 1)', countsForAgeUp('barracks', 1));
check('moinho conta (era 1)', countsForAgeUp('mill', 1));

// só Centro da Cidade → NÃO avança
addB('town_center');
check('só TC: NÃO avança', !tryAdvance());

// CASAS não bastam (casa não conta — era o que estava errado antes)
addB('house'); addB('house');
check('2 casas: NÃO avança (casa não conta)', !tryAdvance());

// 1 prédio elegível (quartel) basta pra sair da era 1 (estilo AoM)
addB('barracks');
check('1 quartel: AVANÇA (era 1 pede 1)', tryAdvance());
p.ageResearch = undefined;

// era 2 pede 2 DIFERENTES: 2 arquearias não bastam; arquearia + ferraria sim
p.age = 2;
addB('archery_range'); addB('archery_range');
check('era 2 com 2 arquearias: NÃO avança (mesmo tipo vale 1)', !tryAdvance());
addB('blacksmith');
check('era 2 com arquearia + ferraria: AVANÇA', tryAdvance());
p.age = 1; p.ageResearch = undefined;
for (const b of [...g.buildings.values()]) if (b.type === 'archery_range' || b.type === 'blacksmith') g.buildings.delete(b.id);
addB('mill');

// pré-requisito: FAZENDA sem Moinho é bloqueada
g.units.set(500, { id: 500, owner: 1, type: 'villager', x: 5, y: 5, hp: 30, state: 'idle', path: [], carryAmount: 0 });
const mill = [...g.buildings.values()].find((b: { type: string }) => b.type === 'mill');
g.buildings.delete(mill.id);
errors.length = 0; g.cmdBuild(1, [500], 'farm', 30, 30, false);
check('fazenda SEM moinho: BLOQUEADA', errors.some(e => e.code === 'err.requires_building' && e.params?.building === 'mill'));

// com Moinho de volta, fazenda passa a valer
addB('mill');
errors.length = 0; g.cmdBuild(1, [500], 'farm', 30, 30, false);
check('fazenda COM moinho: LIBERADA', !errors.some(e => e.code === 'err.requires_building' && e.params?.building === 'mill'));

// pré-requisito: ARQUEARIA sem Quartel (na era 2) é bloqueada
p.age = 2;
for (const b of [...g.buildings.values()]) if (b.type === 'barracks') g.buildings.delete(b.id);
errors.length = 0; g.cmdBuild(1, [500], 'archery_range', 40, 40, false);
check('arquearia SEM quartel: BLOQUEADA', errors.some(e => e.code === 'err.requires_building' && e.params?.building === 'barracks'));

// prédio acima da era segue bloqueado (Estábulo na era 1)
p.age = 1;
addB('barracks');
errors.length = 0; g.cmdBuild(1, [500], 'stable', 44, 44, false);
check('estábulo na era 1: BLOQUEADO (era)', errors.some(e => e.code === 'err.requires_age'));

console.log(fail === 0 ? '\nTODOS OS TESTES DE PROGRESSÃO PASSARAM' : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
