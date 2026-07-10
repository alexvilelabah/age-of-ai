// Tela 3: Sala — lista de jogadores (cor, pronto, coroa de host), toggle
// "Pronto", "Iniciar partida" (só host), "Sair da sala" e chat.

import type { RoomPlayer } from '@age/shared';
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START } from '@age/shared';
import { el } from '../ui';

export interface RoomScreenDeps {
  onToggleReady: () => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onChat: (text: string) => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
}

export class RoomScreen {
  readonly el: HTMLElement;
  private roomTitle: HTMLElement;
  private rowsEl: HTMLElement;
  private readyBtn: HTMLButtonElement;
  private startBtn: HTMLButtonElement;
  private addBotBtn: HTMLButtonElement;
  private removeBotBtn: HTMLButtonElement;
  private chatLog: HTMLElement;
  private chatInput: HTMLInputElement;

  private players: RoomPlayer[] = [];
  private myId = -1;

  constructor(private deps: RoomScreenDeps) {
    this.el = el('div', 'screen');

    const card = el('div', 'panel card wide');
    this.roomTitle = el('h2', '', 'Sala');
    card.appendChild(this.roomTitle);

    this.rowsEl = el('div', 'player-rows');
    card.appendChild(this.rowsEl);

    const actions = el('div', 'row');
    this.readyBtn = el('button', 'btn primary', 'Pronto');
    this.readyBtn.addEventListener('click', () => this.deps.onToggleReady());
    this.startBtn = el('button', 'btn primary', 'Iniciar partida');
    this.startBtn.disabled = true;
    this.startBtn.addEventListener('click', () => this.deps.onStartGame());
    this.addBotBtn = el('button', 'btn', '+ Bot');
    this.addBotBtn.title = 'Adicionar um oponente de IA (jogue sozinho)';
    this.addBotBtn.addEventListener('click', () => this.deps.onAddBot());
    this.removeBotBtn = el('button', 'btn', '− Bot');
    this.removeBotBtn.addEventListener('click', () => this.deps.onRemoveBot());
    const leaveBtn = el('button', 'btn danger', 'Sair da sala');
    leaveBtn.addEventListener('click', () => this.deps.onLeaveRoom());
    actions.appendChild(this.readyBtn);
    actions.appendChild(this.addBotBtn);
    actions.appendChild(this.removeBotBtn);
    actions.appendChild(this.startBtn);
    actions.appendChild(leaveBtn);
    card.appendChild(actions);

    const chatPanel = el('div', 'chat-panel');
    chatPanel.appendChild(el('h2', '', 'Chat'));
    this.chatLog = el('div', 'chat-log');
    chatPanel.appendChild(this.chatLog);
    this.chatInput = el('input', 'txt');
    this.chatInput.placeholder = 'Escreva uma mensagem… (Enter envia)';
    this.chatInput.maxLength = 200;
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) {
          this.deps.onChat(text);
          this.chatInput.value = '';
        }
      }
    });
    chatPanel.appendChild(this.chatInput);
    card.appendChild(chatPanel);

    this.el.appendChild(card);
  }

  reset(): void {
    this.chatLog.innerHTML = '';
    this.chatInput.value = '';
  }

  setState(roomId: string, players: RoomPlayer[], myId: number): void {
    this.players = Array.isArray(players) ? players : [];
    this.myId = myId;
    const host = this.players.find((p) => p.isHost);
    this.roomTitle.textContent = host ? `Sala de ${host.name}` : `Sala ${roomId}`;
    this.renderRows();

    const me = this.players.find((p) => p.id === myId);
    const isHost = me?.isHost ?? false;
    this.readyBtn.textContent = me?.ready ? 'Não estou pronto' : 'Pronto';
    this.readyBtn.classList.toggle('hidden', isHost);

    const nonHostReady = this.players.filter((p) => !p.isHost).every((p) => p.ready);
    const enoughPlayers = this.players.length >= MIN_PLAYERS_TO_START;
    this.startBtn.classList.toggle('hidden', !isHost);
    this.startBtn.disabled = !(isHost && enoughPlayers && nonHostReady);

    this.addBotBtn.classList.toggle('hidden', !isHost || this.players.length >= MAX_PLAYERS_PER_ROOM);
    this.removeBotBtn.classList.toggle('hidden', !isHost || !this.players.some((p) => p.isBot));
  }

  addChat(from: string, text: string): void {
    const line = el('div', '');
    line.appendChild(el('span', 'chat-from', `${from}: `));
    line.append(text);
    this.chatLog.appendChild(line);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private renderRows(): void {
    this.rowsEl.innerHTML = '';
    for (const p of this.players) {
      const row = el('div', 'player-row');
      const swatch = el('span', 'swatch');
      swatch.style.background = p.color;
      row.appendChild(swatch);
      row.appendChild(el('span', 'pname', p.name + (p.id === this.myId ? ' (você)' : '')));
      if (p.isBot) row.appendChild(el('span', '', '🤖'));
      if (p.isHost) row.appendChild(el('span', '', '👑'));
      const tag = el('span', `ready-tag ${p.ready ? 'yes' : 'no'}`, p.ready ? 'Pronto' : 'Aguardando');
      row.appendChild(tag);
      this.rowsEl.appendChild(row);
    }
  }
}
