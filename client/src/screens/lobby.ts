// Tela 2: Lobby — lista de salas (atualizada por pushes roomList),
// "Criar sala" e "Entrar" por sala.

import type { RoomSummary } from '@age/shared';
import { el } from '../ui';

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

    const title = el('h1', 'title', 'Age of AI');
    const card = el('div', 'panel card wide');
    const header = el('div', 'row');
    header.appendChild(el('h2', '', 'Salas'));
    card.appendChild(header);

    this.listEl = el('div', 'room-list');
    card.appendChild(this.listEl);

    const actions = el('div', 'row');
    const createBtn = el('button', 'btn primary', 'Criar sala');
    createBtn.addEventListener('click', () => this.deps.onCreateRoom());
    const refreshBtn = el('button', 'btn', 'Atualizar');
    refreshBtn.addEventListener('click', () => this.deps.onRefresh());
    actions.appendChild(createBtn);
    actions.appendChild(refreshBtn);
    card.appendChild(actions);

    this.el.appendChild(title);
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
      this.listEl.appendChild(el('div', 'empty', 'Nenhuma sala aberta. Crie uma!'));
      return;
    }
    for (const room of this.rooms) {
      const item = el('div', 'room-item');
      item.appendChild(el('span', 'name', `Sala de ${room.hostName}`));
      item.appendChild(el('span', 'info', `${room.playerCount}/${room.maxPlayers} jogadores`));
      const badge = el('span', `badge ${room.inGame ? 'ingame' : 'waiting'}`, room.inGame ? 'em jogo' : 'aguardando');
      item.appendChild(badge);
      const full = room.playerCount >= room.maxPlayers;
      const joinBtn = el('button', 'btn', 'Entrar');
      joinBtn.disabled = full || room.inGame;
      joinBtn.addEventListener('click', () => this.deps.onJoinRoom(room.id));
      item.appendChild(joinBtn);
      this.listEl.appendChild(item);
    }
  }
}
