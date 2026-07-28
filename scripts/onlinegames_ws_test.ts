// Teste headless do multiplayer da coleção /online-games: os TEMPORIZADORES só
// existem enquanto alguém está jogando.
//
// Por que isto virou teste (pedido do dono, 2026-07-27): o servidor mora num
// CELULAR. Antes, o laço de broadcast era um `setInterval(…, 50ms)` de topo de
// módulo — acordava o processo 20x por segundo, 24h por dia, pra iterar um mapa
// VAZIO. Medido no aparelho: ~0,85% de um núcleo com NINGUÉM jogando, e era o
// único temporizador de alta frequência ligado com o servidor parado.
//
// O risco que este teste cobre é o do conserto, não o do bug: se algum caminho
// de entrada/saída esquecer de chamar `ajustarLaços()`, o laço nunca liga e o
// multiplayer quebra EM SILÊNCIO (ninguém vê ninguém se mexer). Por isso as duas
// direções são afirmadas: liga quando precisa e desliga quando não precisa.
//
// Roda: npx tsx scripts/onlinegames_ws_test.ts
import { conectarJogo, slugDoPath, estadoDasSalas } from '../server/src/online-games-ws.ts';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

/** WebSocket de mentira: guarda o que foi enviado e deixa o teste disparar os eventos. */
class FakeWS {
  readyState = 1; // OPEN
  enviados: Record<string, unknown>[] = [];
  private handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  send(raw: string): void { this.enviados.push(JSON.parse(raw)); }
  on(evt: string, fn: (...a: unknown[]) => void): this {
    const lista = this.handlers.get(evt) ?? [];
    lista.push(fn);
    this.handlers.set(evt, lista);
    return this;
  }
  emitir(evt: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(evt) ?? []) fn(...args);
  }
  /** Fecha como o 'ws' faria: dispara o handler de close que o serviço registrou. */
  fechar(): void { this.readyState = 3; this.emitir('close'); }
  close(): void { this.fechar(); }
  ping(): void { /* no-op */ }
  terminate(): void { this.fechar(); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const conectar = (slug: string): FakeWS => { const ws = new FakeWS(); conectarJogo(ws as any, slug); return ws; };
const laços = () => estadoDasSalas().laços;

// --- o estado de partida: nada ligado ---
check('sem ninguém: broadcast DESLIGADO', laços().estados === false);
check('sem ninguém: ping DESLIGADO', laços().ping === false);

// --- 1 jogador: ping sim, broadcast não (sozinho não tem pra quem transmitir) ---
const a = conectar('cube-range');
check('1 jogador: ping LIGADO', laços().ping === true);
check('1 jogador: broadcast ainda DESLIGADO', laços().estados === false);
check('1 jogador: recebeu o welcome', a.enviados.some((m) => m.t === 'welcome'));

// --- 2 jogadores: aí sim o broadcast ---
const b = conectar('cube-range');
check('2 jogadores: broadcast LIGADO', laços().estados === true);
check('2 jogadores: o 1º foi avisado que alguém entrou', a.enviados.some((m) => m.t === 'join'));

// --- um sai: volta a não precisar de broadcast, mas o ping continua ---
b.fechar();
check('sobrou 1: broadcast DESLIGADO de novo', laços().estados === false);
check('sobrou 1: ping continua LIGADO', laços().ping === true);
check('sobrou 1: o que ficou foi avisado da saída', a.enviados.some((m) => m.t === 'leave'));

// --- sala em OUTRO jogo não pode segurar o laço do primeiro ---
const c1 = conectar('outro-jogo');
const c2 = conectar('outro-jogo');
check('2 jogadores em outro slug: broadcast LIGADO', laços().estados === true);
check('salas são isoladas por slug', estadoDasSalas().salas.length === 2);
c1.fechar();
c2.fechar();
check('outro slug esvaziou: broadcast DESLIGADO (o 1º jogo tem só 1)', laços().estados === false);

// --- todos saem: NENHUM temporizador sobra (o pedido do dono virando teste) ---
a.fechar();
check('todos saíram: broadcast DESLIGADO', laços().estados === false);
check('todos saíram: ping DESLIGADO', laços().ping === false);
check('todos saíram: nenhuma sala sobrando', estadoDasSalas().salas.length === 0);

// --- não regrediu: o roteamento por slug continua valendo ---
check('slug válido é aceito', slugDoPath('/online-games/ws/cube-range', '/online-games/ws') === 'cube-range');
check('path base vira sala "default"', slugDoPath('/online-games/ws', '/online-games/ws') === 'default');
check('slug inválido é recusado', slugDoPath('/online-games/ws/../etc', '/online-games/ws') === null);
check('path de fora da coleção é recusado', slugDoPath('/ws', '/online-games/ws') === null);

console.log(fail === 0 ? `\nTODOS OS ${pass} TESTES DO MULTIPLAYER DA COLEÇÃO PASSARAM` : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
