// Tela 2: Lobby — lista de salas (atualizada por pushes roomList),
// "Criar sala" e "Entrar" por sala.

import type { RoomSummary } from '@age/shared';
import { el } from '../ui';
import { t } from '../i18n';

export interface LobbyScreenDeps {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onRefresh: () => void;
}

export class LobbyScreen {
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private rooms: RoomSummary[] = [];

  constructor(private deps: LobbyScreenDeps) {
    this.el = el('div', 'screen');

    // (sem título "Age of AI" aqui — ele já vem do banner na arte de fundo)
    const card = el('div', 'panel card wide');
    const header = el('div', 'row');
    header.appendChild(el('h2', '', t('lobby.rooms')));
    card.appendChild(header);

    this.listEl = el('div', 'room-list');
    card.appendChild(this.listEl);

    const actions = el('div', 'row');
    const createBtn = el('button', 'btn primary', t('lobby.create'));
    createBtn.addEventListener('click', () => this.deps.onCreateRoom());
    const refreshBtn = el('button', 'btn', t('lobby.refresh'));
    refreshBtn.addEventListener('click', () => this.deps.onRefresh());
    actions.appendChild(createBtn);
    actions.appendChild(refreshBtn);
    card.appendChild(actions);

    this.el.appendChild(card);
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
      item.appendChild(el('span', 'name', t('lobby.room_of', { host: room.hostName })));
      item.appendChild(el('span', 'info', t('lobby.players_count', { n: room.playerCount, max: room.maxPlayers })));
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
