// Tela 3: Sala — lista de jogadores (cor, pronto, coroa de host), toggle
// "Pronto", "Iniciar partida" (só host), "Sair da sala" e chat.

import type { BotDifficulty, GameMode, RoomPlayer } from '@age/shared';
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START } from '@age/shared';
import { el } from '../ui';
import { t } from '../i18n';

export interface RoomScreenDeps {
  onToggleReady: () => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onChat: (text: string) => void;
  onAddBot: (difficulty: BotDifficulty) => void;
  onRemoveBot: () => void;
  onSetMode: (mode: GameMode) => void;
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
  private mode: GameMode = 'normal';
  private modeBtns: { m: GameMode; btn: HTMLButtonElement }[] = [];
  // Dificuldade do PRÓXIMO bot a ser adicionado (só o host escolhe).
  private selectedBotDifficulty: BotDifficulty = 'normal';
  private diffRow!: HTMLElement;
  private diffBtns: { d: BotDifficulty; btn: HTMLButtonElement }[] = [];

  constructor(private deps: RoomScreenDeps) {
    this.el = el('div', 'screen');

    const card = el('div', 'panel card wide');
    this.roomTitle = el('h2', '', t('room.title'));
    card.appendChild(this.roomTitle);

    this.rowsEl = el('div', 'player-rows');
    card.appendChild(this.rowsEl);

    // Modo de jogo (só o host muda): Normal x Batalha/Rápido.
    const modeRow = el('div', 'row mode-row');
    modeRow.appendChild(el('span', 'mode-label', t('room.mode')));
    const modeOpts: { m: GameMode; label: string; title: string }[] = [
      { m: 'normal', label: t('room.mode_normal'), title: t('room.mode_normal_desc') },
      { m: 'batalha', label: t('room.mode_battle'), title: t('room.mode_battle_desc') },
    ];
    for (const o of modeOpts) {
      const btn = el('button', 'btn mode-btn', o.label);
      btn.title = o.title;
      btn.addEventListener('click', () => this.deps.onSetMode(o.m));
      this.modeBtns.push({ m: o.m, btn });
      modeRow.appendChild(btn);
    }
    card.appendChild(modeRow);

    // Dificuldade do próximo bot (só o host; estilo Age of Mythology).
    const diffRow = el('div', 'row mode-row diff-row');
    diffRow.appendChild(el('span', 'mode-label', t('room.difficulty')));
    const diffOpts: { d: BotDifficulty; label: string; title: string }[] = [
      { d: 'easy', label: t('room.diff_easy'), title: t('room.diff_easy_desc') },
      { d: 'normal', label: t('room.diff_normal'), title: t('room.diff_normal_desc') },
      { d: 'hard', label: t('room.diff_hard'), title: t('room.diff_hard_desc') },
      { d: 'expert', label: t('room.diff_expert'), title: t('room.diff_expert_desc') },
    ];
    for (const o of diffOpts) {
      const btn = el('button', 'btn mode-btn', o.label);
      btn.title = o.title;
      btn.addEventListener('click', () => {
        this.selectedBotDifficulty = o.d;
        this.updateDiffButtons();
      });
      this.diffBtns.push({ d: o.d, btn });
      diffRow.appendChild(btn);
    }
    this.diffRow = diffRow;
    this.updateDiffButtons();
    card.appendChild(diffRow);

    const actions = el('div', 'row');
    this.readyBtn = el('button', 'btn primary', t('room.ready'));
    this.readyBtn.addEventListener('click', () => this.deps.onToggleReady());
    this.startBtn = el('button', 'btn primary', t('room.start'));
    this.startBtn.disabled = true;
    this.startBtn.addEventListener('click', () => this.deps.onStartGame());
    this.addBotBtn = el('button', 'btn', t('room.add_bot'));
    this.addBotBtn.title = t('room.add_bot_desc');
    this.addBotBtn.addEventListener('click', () => this.deps.onAddBot(this.selectedBotDifficulty));
    this.removeBotBtn = el('button', 'btn', t('room.remove_bot'));
    this.removeBotBtn.addEventListener('click', () => this.deps.onRemoveBot());
    const leaveBtn = el('button', 'btn danger', t('room.leave'));
    leaveBtn.addEventListener('click', () => this.deps.onLeaveRoom());
    actions.appendChild(this.readyBtn);
    actions.appendChild(this.addBotBtn);
    actions.appendChild(this.removeBotBtn);
    actions.appendChild(this.startBtn);
    actions.appendChild(leaveBtn);
    card.appendChild(actions);

    const chatPanel = el('div', 'chat-panel');
    chatPanel.appendChild(el('h2', '', t('room.chat')));
    this.chatLog = el('div', 'chat-log');
    chatPanel.appendChild(this.chatLog);
    this.chatInput = el('input', 'txt');
    this.chatInput.placeholder = t('room.chat_placeholder');
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

  setState(roomId: string, players: RoomPlayer[], myId: number, mode: GameMode = 'normal'): void {
    this.players = Array.isArray(players) ? players : [];
    this.myId = myId;
    this.mode = mode;
    const host = this.players.find((p) => p.isHost);
    this.roomTitle.textContent = host ? t('lobby.room_of', { host: host.name }) : t('room.room_n', { id: roomId });
    this.renderRows();

    const me = this.players.find((p) => p.id === myId);
    const isHost = me?.isHost ?? false;

    // Modo de jogo: destaca o ativo; só o host pode trocar.
    for (const { m, btn } of this.modeBtns) {
      btn.classList.toggle('primary', m === this.mode);
      btn.disabled = !isHost;
    }
    this.readyBtn.textContent = me?.ready ? t('room.not_ready') : t('room.ready');
    this.readyBtn.classList.toggle('hidden', isHost);

    const nonHostReady = this.players.filter((p) => !p.isHost).every((p) => p.ready);
    const enoughPlayers = this.players.length >= MIN_PLAYERS_TO_START;
    this.startBtn.classList.toggle('hidden', !isHost);
    this.startBtn.disabled = !(isHost && enoughPlayers && nonHostReady);

    this.addBotBtn.classList.toggle('hidden', !isHost || this.players.length >= MAX_PLAYERS_PER_ROOM);
    this.diffRow.classList.toggle('hidden', !isHost || this.players.length >= MAX_PLAYERS_PER_ROOM);
    this.removeBotBtn.classList.toggle('hidden', !isHost || !this.players.some((p) => p.isBot));
  }

  /** Destaca o botão da dificuldade escolhida pro próximo bot. */
  private updateDiffButtons(): void {
    for (const { d, btn } of this.diffBtns) btn.classList.toggle('primary', d === this.selectedBotDifficulty);
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
      row.appendChild(el('span', 'pname', p.name + (p.id === this.myId ? t('common.you_suffix') : '')));
      if (p.isBot) {
        row.appendChild(el('span', '', '🤖'));
        row.appendChild(el('span', 'bot-diff', t(`room.diff_${p.difficulty ?? 'normal'}`)));
      }
      if (p.isHost) row.appendChild(el('span', '', '👑'));
      const tag = el('span', `ready-tag ${p.ready ? 'yes' : 'no'}`, p.ready ? t('room.tag_ready') : t('room.tag_waiting'));
      row.appendChild(tag);
      this.rowsEl.appendChild(row);
    }
  }
}
