// Tela 3: Sala — layout "tabuleiro" emoldurado em ouro (estilo AoE): duas colunas
// (Jogadores | Configuração da partida), ações centrais e chat embaixo. Foco desktop.

import type { BotDifficulty, GameMode, RoomPlayer, TerrainKind } from '@age/shared';
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START } from '@age/shared';
import { el } from '../ui';
import { t } from '../i18n';
import { TERRAIN_THUMB_SVG } from './terrainThumbs';

export interface RoomScreenDeps {
  onToggleReady: () => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onChat: (text: string) => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
  onSetTeam: (playerId: number, team: number) => void;
  onSetMode: (mode: GameMode) => void;
  onSetFog: (fog: boolean) => void;
  onSetTerrain: (terrain: TerrainKind) => void;
  onSetBotDifficulty: (botId: number, difficulty: BotDifficulty) => void;
}

const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard', 'expert'];

// --- Ícones SVG (gravados em ouro; não dependem da fonte de emoji do sistema) ---
const IC_PLAYERS = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 11a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v2h11v-2c0-1.7 1-3.1 2.5-4.1-1.5-.6-3.2-.9-5.5-.9zm7.5 0c-.7 0-1.5.1-2.3.3 1.7 1 2.8 2.5 2.8 4.6V20H23v-2c0-3-4.3-5-6.5-5zm-.5-2a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/></svg>';
const IC_SWORDS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M14.5 4.5l-11 11M20 20l-6-6"/></svg>';
const IC_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.5 7.2L3 21l1.8-6.5A8 8 0 1121 12z"/></svg>';
const IC_MODE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3l4 6-4 6-4-6zM18 3l4 6-4 6-4-6zM12 9l4 6-4 6-4-6z"/></svg>';
const IC_MAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>';
const IC_TERRAIN = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9 6 6 9 6 13a6 6 0 0012 0c0-4-3-7-6-11z"/></svg>';
const CREST = '<svg class="sala-crest" viewBox="0 0 52 58" aria-hidden="true"><path d="M6 6H46V32C46 44 36 50 26 56 16 50 6 44 6 32Z" fill="#22385a" stroke="#d8b25a" stroke-width="2.4"/><path d="M13 34 15 20 20.5 27 26 16 31.5 27 37 20 39 34Z" fill="#f6e7b4"/><circle cx="15" cy="18" r="1.7" fill="#f6e7b4"/><circle cx="26" cy="14" r="1.8" fill="#f6e7b4"/><circle cx="37" cy="18" r="1.7" fill="#f6e7b4"/></svg>';
const GLYPH_HOST = '<svg viewBox="0 0 40 40" fill="#f6e7b4"><path d="M7 30 10 14 16 22 20 11 24 22 30 14 33 30Z"/><rect x="7" y="30.5" width="26" height="3.5" rx="1"/></svg>';
const GLYPH_BOT = '<svg viewBox="0 0 40 40" fill="none" stroke="#f6e7b4" stroke-width="2.3"><rect x="8" y="13" width="24" height="17" rx="4"/><circle cx="16" cy="21" r="2.4" fill="#f6e7b4" stroke="none"/><circle cx="24" cy="21" r="2.4" fill="#f6e7b4" stroke="none"/><path d="M20 13V8M20 8h-3.5"/></svg>';
const GLYPH_PERSON = '<svg viewBox="0 0 24 24" fill="#c9b48a"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6z"/></svg>';

/** Adiciona os 4 cantos ornamentados (colchetes de ouro) a uma moldura. */
function gframe(cls: string): HTMLElement {
  const f = el('div', `gframe ${cls}`);
  for (const c of ['tl', 'tr', 'bl', 'br']) f.appendChild(el('i', `gcnr ${c}`));
  return f;
}
/** Cabeçalho de painel: ícone dourado + rótulo + filete que se estende. */
function phead(icon: string, label: string): HTMLElement {
  const h = el('h2', 'sala-head');
  const ic = el('span', 'sala-hic'); ic.innerHTML = icon;
  h.appendChild(ic);
  h.appendChild(el('span', 'sala-htx', label));
  return h;
}
/** Rótulo de controle (Modo/Mapa/Terreno) com ícone. */
function ctlLabel(icon: string, label: string): HTMLElement {
  const s = el('span', 'ctl-label');
  const ic = el('span', 'ctl-ic'); ic.innerHTML = icon;
  s.appendChild(ic);
  s.appendChild(el('span', '', label));
  return s;
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
  private fog = false;
  private terrain: TerrainKind = 'classic';
  private modeBtns: { m: GameMode; btn: HTMLButtonElement }[] = [];
  private fogBtns: { closed: boolean; btn: HTMLButtonElement }[] = [];
  private terrainBtns: { tr: TerrainKind; btn: HTMLButtonElement }[] = [];

  constructor(private deps: RoomScreenDeps) {
    this.el = el('div', 'screen room-screen');
    const sala = el('div', 'sala');

    // ---- Cabeçalho (brasão + título) ----
    const top = gframe('sala-top');
    const crest = el('span', 'sala-crest-wrap'); crest.innerHTML = CREST;
    top.appendChild(crest);
    this.roomTitle = el('h1', 'sala-title', t('room.title'));
    top.appendChild(this.roomTitle);
    sala.appendChild(top);

    // ---- Tabuleiro (2 colunas) ----
    const board = el('div', 'sala-board');

    // Coluna JOGADORES
    const pcol = gframe('sala-panel sala-players');
    pcol.appendChild(phead(IC_PLAYERS, t('room.players')));
    this.rowsEl = el('div', 'player-rows');
    pcol.appendChild(this.rowsEl);
    const botbtns = el('div', 'sala-botbtns');
    this.addBotBtn = el('button', 'btn add-bot', t('room.add_bot'));
    this.addBotBtn.title = t('room.add_bot_desc');
    this.addBotBtn.addEventListener('click', () => this.deps.onAddBot());
    this.removeBotBtn = el('button', 'btn rem-bot', t('room.remove_bot'));
    this.removeBotBtn.addEventListener('click', () => this.deps.onRemoveBot());
    botbtns.appendChild(this.addBotBtn);
    botbtns.appendChild(this.removeBotBtn);
    pcol.appendChild(botbtns);
    board.appendChild(pcol);

    // Coluna CONFIGURAÇÃO
    const ccol = gframe('sala-panel sala-config');
    ccol.appendChild(phead(IC_SWORDS, t('room.config')));

    // Modo (Normal x Batalha) — só host
    const modeCtl = el('div', 'sala-ctl');
    modeCtl.appendChild(ctlLabel(IC_MODE, t('room.mode')));
    const modeSeg = el('div', 'seg');
    const modeOpts: { m: GameMode; label: string; title: string }[] = [
      { m: 'normal', label: t('room.mode_normal'), title: t('room.mode_normal_desc') },
      { m: 'batalha', label: t('room.mode_battle'), title: t('room.mode_battle_desc') },
    ];
    for (const o of modeOpts) {
      const btn = el('button', 'btn seg-btn', o.label);
      btn.title = o.title;
      btn.addEventListener('click', () => this.deps.onSetMode(o.m));
      this.modeBtns.push({ m: o.m, btn });
      modeSeg.appendChild(btn);
    }
    modeCtl.appendChild(modeSeg);
    ccol.appendChild(modeCtl);

    // Mapa aberto x fechado (névoa) — só host
    const mapCtl = el('div', 'sala-ctl');
    mapCtl.appendChild(ctlLabel(IC_MAP, t('room.map')));
    const mapSeg = el('div', 'seg');
    const mapOpts: { closed: boolean; label: string; title: string }[] = [
      { closed: false, label: t('room.map_open'), title: t('room.map_open_desc') },
      { closed: true, label: t('room.map_closed'), title: t('room.map_closed_desc') },
    ];
    for (const o of mapOpts) {
      const btn = el('button', 'btn seg-btn', o.label);
      btn.title = o.title;
      btn.addEventListener('click', () => this.deps.onSetFog(o.closed));
      this.fogBtns.push({ closed: o.closed, btn });
      mapSeg.appendChild(btn);
    }
    mapCtl.appendChild(mapSeg);
    ccol.appendChild(mapCtl);

    // Terreno (Clássico / Rio / Travessia) — só host
    const terrCtl = el('div', 'sala-ctl terrain');
    terrCtl.appendChild(ctlLabel(IC_TERRAIN, t('room.terrain')));
    const terrCards = el('div', 'terrain-cards');
    const terrOpts: { tr: TerrainKind; label: string; desc: string }[] = [
      { tr: 'classic', label: t('room.terrain_classic'), desc: t('room.terrain_classic_desc') },
      { tr: 'river', label: t('room.terrain_river'), desc: t('room.terrain_river_desc') },
      { tr: 'strait', label: t('room.terrain_strait'), desc: t('room.terrain_strait_desc') },
    ];
    for (const o of terrOpts) {
      const btn = el('button', 'btn terrain-card');
      const thumb = el('span', 'terrain-thumb');
      thumb.innerHTML = TERRAIN_THUMB_SVG[o.tr];
      btn.appendChild(thumb);
      btn.appendChild(el('span', 'terrain-name', o.label));
      btn.appendChild(el('span', 'terrain-desc', o.desc));
      btn.addEventListener('click', () => this.deps.onSetTerrain(o.tr));
      this.terrainBtns.push({ tr: o.tr, btn });
      terrCards.appendChild(btn);
    }
    terrCtl.appendChild(terrCards);
    ccol.appendChild(terrCtl);

    board.appendChild(ccol);
    sala.appendChild(board);

    // ---- Ações centrais ----
    const actions = el('div', 'sala-actions');
    this.readyBtn = el('button', 'btn primary sala-act', t('room.ready'));
    this.readyBtn.addEventListener('click', () => this.deps.onToggleReady());
    this.startBtn = el('button', 'btn primary sala-act start', t('room.start'));
    this.startBtn.disabled = true;
    this.startBtn.addEventListener('click', () => this.deps.onStartGame());
    const leaveBtn = el('button', 'btn danger sala-act', t('room.leave'));
    leaveBtn.addEventListener('click', () => this.deps.onLeaveRoom());
    actions.appendChild(this.readyBtn);
    actions.appendChild(this.startBtn);
    actions.appendChild(leaveBtn);
    sala.appendChild(actions);

    // ---- Chat ----
    const chatPanel = gframe('sala-chat');
    chatPanel.appendChild(phead(IC_CHAT, t('room.chat')));
    this.chatLog = el('div', 'chat-log');
    chatPanel.appendChild(this.chatLog);
    const chatBar = el('div', 'chat-bar');
    this.chatInput = el('input', 'txt chat-in');
    this.chatInput.placeholder = t('room.chat_placeholder');
    this.chatInput.maxLength = 200;
    const sendChat = (): void => {
      const text = this.chatInput.value.trim();
      if (text) { this.deps.onChat(text); this.chatInput.value = ''; }
    };
    this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    const sendBtn = el('button', 'btn chat-send', t('room.send'));
    sendBtn.addEventListener('click', sendChat);
    chatBar.appendChild(this.chatInput);
    chatBar.appendChild(sendBtn);
    chatPanel.appendChild(chatBar);
    sala.appendChild(chatPanel);

    this.el.appendChild(sala);
  }

  reset(): void {
    this.chatLog.innerHTML = '';
    this.chatInput.value = '';
  }

  setState(roomId: string, players: RoomPlayer[], myId: number, mode: GameMode = 'normal', fog = false, terrain: TerrainKind = 'classic'): void {
    this.players = Array.isArray(players) ? players : [];
    this.myId = myId;
    this.mode = mode;
    this.fog = fog;
    this.terrain = terrain;
    const host = this.players.find((p) => p.isHost);
    this.roomTitle.textContent = host ? t('lobby.room_of', { host: host.name }) : t('room.room_n', { id: roomId });
    this.renderRows();

    const me = this.players.find((p) => p.id === myId);
    const isHost = me?.isHost ?? false;

    for (const { m, btn } of this.modeBtns) {
      btn.classList.toggle('primary', m === this.mode);
      btn.disabled = !isHost;
    }
    for (const { closed, btn } of this.fogBtns) {
      btn.classList.toggle('primary', closed === this.fog);
      btn.disabled = !isHost;
    }
    for (const { tr, btn } of this.terrainBtns) {
      btn.classList.toggle('primary', tr === this.terrain);
      btn.disabled = !isHost;
    }
    this.readyBtn.textContent = me?.ready ? t('room.not_ready') : t('room.ready');
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
    const meHost = this.players.find((x) => x.id === this.myId)?.isHost ?? false;
    for (const p of this.players) {
      const role = p.isHost ? 'host' : p.isBot ? 'bot' : 'human';
      const card = el('div', `pcard ${role}`);

      // X pra remover bot (só host)
      if (p.isBot && meHost) {
        const x = el('button', 'pcard-x', '✕');
        x.title = t('room.remove_bot');
        x.addEventListener('click', () => this.deps.onRemoveBot());
        card.appendChild(x);
      }

      // Retrato (tingido pela cor do jogador)
      const port = el('span', 'pcard-port');
      port.style.setProperty('--pc', p.color);
      port.innerHTML = p.isHost ? GLYPH_HOST : p.isBot ? GLYPH_BOT : GLYPH_PERSON;
      card.appendChild(port);

      const info = el('div', 'pcard-info');
      const nameRow = el('div', 'pcard-name');
      const sw = el('span', 'swatch'); sw.style.background = p.color;
      nameRow.appendChild(sw);
      nameRow.appendChild(el('span', 'nm', p.name + (p.id === this.myId ? t('common.you_suffix') : '')));
      if (p.isBot) {
        const diff = p.difficulty ?? 'normal';
        const db = el('button', 'badge diff-chip', t(`room.diff_${diff}`));
        db.title = t('room.bot_diff_tip');
        db.disabled = !meHost;
        db.addEventListener('click', () => {
          const next = DIFFICULTIES[(DIFFICULTIES.indexOf(diff) + 1) % DIFFICULTIES.length];
          this.deps.onSetBotDifficulty(p.id, next);
        });
        nameRow.appendChild(db);
      } else if (p.isHost) {
        nameRow.appendChild(el('span', 'badge host-badge', t('room.host')));
      }
      info.appendChild(nameRow);

      const meta = el('div', 'pcard-meta');
      meta.appendChild(el('span', 'meta-lbl', `${t('room.team')}:`));
      const team = p.team ?? 0;
      const tb = el('button', `team-chip t${team}`, `${team === 0 ? '—' : team} ▾`);
      tb.title = t('room.team_tip');
      tb.disabled = !meHost;
      tb.addEventListener('click', () => this.deps.onSetTeam(p.id, (team + 1) % 3));
      meta.appendChild(tb);
      if (p.isHost) {
        meta.appendChild(el('span', 'crown', '♛'));
      } else {
        meta.appendChild(el('span', `ready-pill ${p.ready ? 'yes' : 'no'}`, p.ready ? t('room.tag_ready') : t('room.tag_waiting')));
      }
      info.appendChild(meta);
      card.appendChild(info);
      this.rowsEl.appendChild(card);
    }

    // Vaga livre (se a sala não estiver cheia)
    if (this.players.length < MAX_PLAYERS_PER_ROOM) {
      const slot = el('div', 'pcard empty');
      const port = el('span', 'pcard-port'); port.innerHTML = GLYPH_PERSON;
      slot.appendChild(port);
      slot.appendChild(el('span', 'empty-lbl', t('room.empty_slot')));
      this.rowsEl.appendChild(slot);
    }
  }
}
