// Tela 2: Lobby — lista de salas (atualizada por pushes roomList), "Criar sala"
// e "Entrar" por sala. Visual ornamentado (molduras de ouro) sobre fundo de
// pedra escura — mesma vibe da tela de Sala.

import type { RoomSummary } from '@age/shared';
import { el } from '../ui';
import { t } from '../i18n';

export interface LobbyScreenDeps {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onRefresh: () => void;
}

// Ícone do cabeçalho (castelo).
const IC_SALAS = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 21V11l2-1V7h2v2l2-1V6h2v2l2 1V7h2v3l2 1v10h-6v-5H9v5z"/></svg>';

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
  private panel: HTMLElement;
  private listEl!: HTMLElement;
  private rooms: RoomSummary[] = [];

  constructor(private deps: LobbyScreenDeps) {
    this.el = el('div', 'screen lobby-screen');
    this.panel = this.build();
    this.el.appendChild(this.panel);
    this.renderList();
  }

  /** Troca de idioma AO VIVO (sem recarregar): remonta o painel no idioma novo
   *  e redesenha a lista de salas já em memória. */
  retranslate(): void {
    const fresh = this.build();
    this.panel.replaceWith(fresh);
    this.panel = fresh;
    this.renderList();
  }

  /** Monta (ou remonta) o painel "Salas" no idioma atual. */
  private build(): HTMLElement {
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
    return panel;
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
