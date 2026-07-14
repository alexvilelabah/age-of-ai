// Tela 2: Lobby — lista de salas (atualizada por pushes roomList), "Criar sala"
// e "Entrar" por sala. Visual ornamentado (molduras de ouro), fundo de pedra
// com um emblema heráldico sutil — mesma vibe da tela de Sala.

import type { RoomSummary } from '@age/shared';
import { el } from '../ui';
import { t } from '../i18n';

export interface LobbyScreenDeps {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onRefresh: () => void;
}

// Ícone do cabeçalho (castelo) e o emblema de fundo (escudo + coroa, bem sutil).
const IC_SALAS = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 21V11l2-1V7h2v2l2-1V6h2v2l2 1V7h2v3l2 1v10h-6v-5H9v5z"/></svg>';
const EMBLEM = '<svg viewBox="0 0 200 224" fill="none" stroke="#d8b25a" stroke-width="3"><path d="M24 24H176V120C176 168 138 196 100 214 62 196 24 168 24 120Z"/><path d="M58 98 66 54 88 76 100 46 112 76 134 54 142 98Z"/><circle cx="66" cy="50" r="4" fill="#d8b25a"/><circle cx="100" cy="42" r="4.5" fill="#d8b25a"/><circle cx="134" cy="50" r="4" fill="#d8b25a"/></svg>';

/** Moldura de quadro com os 4 cantos ornamentados (igual à tela de Sala). */
function gframe(cls: string): HTMLElement {
  const f = el('div', `gframe ${cls}`);
  for (const c of ['tl', 'tr', 'bl', 'br']) f.appendChild(el('i', `gcnr ${c}`));
  return f;
}
/** Cabeçalho de painel: ícone dourado + rótulo + filete. */
function phead(icon: string, label: string): HTMLElement {
  const h = el('h2', 'sala-head');
  const ic = el('span', 'sala-hic'); ic.innerHTML = icon;
  h.appendChild(ic);
  h.appendChild(el('span', 'sala-htx', label));
  return h;
}

export class LobbyScreen {
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private rooms: RoomSummary[] = [];

  constructor(private deps: LobbyScreenDeps) {
    this.el = el('div', 'screen lobby-screen');

    // Emblema heráldico de fundo (sutil, atrás do painel).
    const emblem = el('div', 'lobby-emblem');
    emblem.innerHTML = EMBLEM;
    this.el.appendChild(emblem);

    const panel = gframe('lobby-panel');
    panel.appendChild(phead(IC_SALAS, t('lobby.rooms')));

    this.listEl = el('div', 'room-list');
    panel.appendChild(this.listEl);

    const actions = el('div', 'lobby-actions');
    const createBtn = el('button', 'btn primary lobby-create', t('lobby.create'));
    createBtn.addEventListener('click', () => this.deps.onCreateRoom());
    const refreshBtn = el('button', 'btn lobby-refresh', t('lobby.refresh'));
    refreshBtn.addEventListener('click', () => this.deps.onRefresh());
    actions.appendChild(createBtn);
    actions.appendChild(refreshBtn);
    panel.appendChild(actions);

    this.el.appendChild(panel);
    this.renderList();
  }

  setRooms(rooms: RoomSummary[]): void {
    this.rooms = Array.isArray(rooms) ? rooms : [];
    this.renderList();
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    if (this.rooms.length === 0) {
      this.listEl.appendChild(el('div', 'empty', t('lobby.empty')));
      return;
    }
    for (const room of this.rooms) {
      const item = el('div', 'room-item');
      const main = el('div', 'lr-main');
      main.appendChild(el('span', 'name', t('lobby.room_of', { host: room.hostName })));
      main.appendChild(el('span', 'info', t('lobby.players_count', { n: room.playerCount, max: room.maxPlayers })));
      item.appendChild(main);
      const badge = el('span', `badge ${room.inGame ? 'ingame' : 'waiting'}`, room.inGame ? t('lobby.ingame') : t('lobby.waiting'));
      item.appendChild(badge);
      const full = room.playerCount >= room.maxPlayers;
      const joinBtn = el('button', 'btn', t('lobby.join'));
      joinBtn.disabled = full || room.inGame;
      joinBtn.addEventListener('click', () => this.deps.onJoinRoom(room.id));
      item.appendChild(joinBtn);
      this.listEl.appendChild(item);
    }
  }
}
