// Ponto de entrada: orquestra transições de tela, rede e o toast global de erros.

import type { GameCommand, RoomPlayer, ServerMessage } from '@age/shared';
import { Net } from './net';
import { music } from './music';
import { toast } from './ui';
import { settings, saveSettings } from './settings';
import { t, AGE_NAMES, BUILDING_NAMES } from './i18n';
import type { BuildingType } from '@age/shared';
import { getClientId, getSavedName, saveName } from './identity';
import { NameScreen } from './screens/name';
import { LobbyScreen } from './screens/lobby';
import { RoomScreen } from './screens/room';
import { GameScreen } from './screens/game';
import { GameOverScreen } from './screens/gameover';
import { SettingsOverlay } from './screens/settings';
import './style.css';

type ScreenName = 'name' | 'lobby' | 'room' | 'game';

const app = document.getElementById('app');
if (!app) throw new Error('elemento #app não encontrado');

// idioma da página (acessibilidade/SEO) conforme a preferência detectada/salva
document.documentElement.lang = settings.lang;

const connBadge = document.createElement('div');
connBadge.id = 'conn-badge';
connBadge.textContent = '';
document.body.appendChild(connBadge);

const net = new Net();

let current: ScreenName = 'name';
let myPlayerId = -1;
let lastRoomPlayers: RoomPlayer[] = [];
let pendingName = ''; // nome sendo confirmado (salvo no localStorage quando o servidor aceita)

let gameScreen: GameScreen | null = null;
const gameOverScreen = new GameOverScreen({
  onBackToLobby: () => {
    gameOverScreen.hide();
    teardownGame();
    showScreen('lobby');
    net.send({ type: 'listRooms' });
  },
});
document.body.appendChild(gameOverScreen.el);

// Menu de OPÇÕES (global): engrenagem no canto + overlay, disponível em toda tela.
// Música é singleton (aplica sempre); efeitos/resolução aplicam se há partida.
const settingsOverlay = new SettingsOverlay({
  onMusicVol: (v) => { music.setVolume(v); settings.musicVol = v; saveSettings(); },
  onSfxVol: (v) => { gameScreen?.setSfxVolume(v); settings.sfxVol = v; saveSettings(); },
  onRenderScale: (s) => { gameScreen?.setRenderScale(s); settings.renderScale = s; saveSettings(); },
});
document.body.appendChild(settingsOverlay.el);

const gearBtn = document.createElement('button');
gearBtn.id = 'settings-gear';
gearBtn.title = t('opt.title');
gearBtn.setAttribute('aria-label', t('opt.title'));
gearBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
gearBtn.addEventListener('click', () => settingsOverlay.show());
document.body.appendChild(gearBtn);

// ---------------------------------------------------------------- telas

const nameScreen = new NameScreen({
  initialName: getSavedName(),
  onEnter: (name) => {
    // não vai pro lobby na hora: espera o servidor confirmar o nome (nameOk) ou
    // avisar que já está em uso (nameTaken).
    nameScreen.setStatus(t('name.entering'));
    pendingName = name;
    net.send({ type: 'setName', name, clientId: getClientId() });
  },
});

const lobbyScreen = new LobbyScreen({
  onCreateRoom: () => net.send({ type: 'createRoom' }),
  onJoinRoom: (roomId) => net.send({ type: 'joinRoom', roomId }),
  onRefresh: () => net.send({ type: 'listRooms' }),
});

const roomScreen = new RoomScreen({
  onToggleReady: () => {
    const me = lastRoomPlayers.find((p) => p.id === myPlayerId);
    net.send({ type: 'setReady', ready: !(me?.ready ?? false) });
  },
  onStartGame: () => net.send({ type: 'startGame' }),
  onLeaveRoom: () => {
    net.send({ type: 'leaveRoom' });
    showScreen('lobby');
    net.send({ type: 'listRooms' });
  },
  onChat: (text) => net.send({ type: 'chat', text }),
  onAddBot: () => net.send({ type: 'addBot' }),
  onRemoveBot: () => net.send({ type: 'removeBot' }),
  onSetMode: (mode) => net.send({ type: 'setMode', mode }),
});

function screenEl(name: ScreenName): HTMLElement {
  switch (name) {
    case 'name': return nameScreen.el;
    case 'lobby': return lobbyScreen.el;
    case 'room': return roomScreen.el;
    case 'game': return gameScreen?.el ?? document.createElement('div');
  }
}

function showScreen(name: ScreenName): void {
  current = name;
  app!.innerHTML = '';
  app!.appendChild(screenEl(name));
  if (name === 'name') nameScreen.focus();
  // trilha por tela: abertura nos menus, faixas de fundo dentro da partida
  music.setState(name === 'game' ? 'game' : 'menu');
}

// autoplay do navegador: a música destrava no primeiro gesto do usuário
document.addEventListener('pointerdown', () => music.unlock(), { once: true });
music.setVolume(settings.musicVol); // volume salvo no menu de opções
music.setState('menu');

// ---------------------------------------------------------------- rede

net.onStatus = (status) => {
  if (status === 'open') {
    connBadge.textContent = '';
    connBadge.classList.remove('hidden');
    // Se estávamos no meio de uma partida quando a conexão caiu e reconectou,
    // o servidor reenviará o estado apropriado (roomList/roomState) — o app
    // permanece na tela atual até novo comando do servidor.
  } else if (status === 'connecting') {
    connBadge.textContent = current === 'name' || current === 'lobby' ? t('conn.connecting') : '';
  } else if (status === 'closed') {
    if (current === 'game') {
      gameScreen?.showConnLost();
    } else {
      connBadge.textContent = t('conn.lost_retry');
    }
  }
};

net.onMessage = (msg: ServerMessage) => {
  try {
    dispatch(msg);
  } catch (err) {
    console.error('Erro ao tratar mensagem do servidor:', err);
  }
};

function dispatch(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome': {
      myPlayerId = msg.playerId;
      break;
    }
    case 'nameOk': {
      // nome aceito -> lembra o nome e só AGORA vai pro lobby
      nameScreen.setStatus('');
      if (pendingName) saveName(pendingName);
      if (current === 'name') {
        net.send({ type: 'listRooms' });
        showScreen('lobby');
      }
      break;
    }
    case 'nameTaken': {
      nameScreen.setStatus(t('name.taken'));
      nameScreen.focus();
      break;
    }
    case 'roomList': {
      lobbyScreen.setRooms(msg.rooms);
      break;
    }
    case 'roomState': {
      lastRoomPlayers = Array.isArray(msg.players) ? msg.players : [];
      roomScreen.setState(msg.roomId, lastRoomPlayers, myPlayerId, msg.mode);
      // Ignora troca de tela enquanto o overlay de fim de jogo está visível: o
      // servidor manda 'roomState' logo após 'gameOver' (reset do lobby), mas o
      // jogador ainda não confirmou "Voltar ao lobby" — trocar de tela agora
      // destruiria a tela de jogo silenciosamente por baixo do overlay.
      if (current !== 'room' && current !== 'game') {
        roomScreen.reset();
        showScreen('room');
      }
      break;
    }
    case 'leftRoom': {
      lastRoomPlayers = [];
      showScreen('lobby');
      net.send({ type: 'listRooms' });
      break;
    }
    case 'error': {
      // Erro do servidor: traduz o código. `age` (número) e `building` (tipo)
      // viram o nome no idioma do jogador aqui. `message` é reserva (texto pronto).
      if (msg.code) {
        const params: Record<string, string | number> = { ...(msg.params ?? {}) };
        if (typeof params.age === 'number') params.age = AGE_NAMES[params.age] ?? params.age;
        if (typeof params.building === 'string') params.building = BUILDING_NAMES[params.building as BuildingType] ?? params.building;
        toast(t(msg.code, params), 'error');
      } else if (msg.message) {
        toast(msg.message, 'error');
      }
      break;
    }
    case 'chat': {
      if (current === 'game') gameScreen?.addChat(msg.from, msg.text);
      else if (current === 'room') roomScreen.addChat(msg.from, msg.text);
      break;
    }
    case 'gameStart': {
      teardownGame();
      gameOverScreen.hide();
      gameScreen = new GameScreen(msg.map, msg.players, msg.you, {
        onCommand: (cmd: GameCommand) => net.send({ type: 'cmd', cmd }),
        onChat: (text) => net.send({ type: 'chat', text }),
        onBackToLobby: () => {
          teardownGame();
          showScreen('lobby');
          net.send({ type: 'listRooms' });
        },
      });
      showScreen('game');
      break;
    }
    case 'snapshot': {
      if (gameScreen) {
        gameScreen.state.applySnapshot({
          tick: msg.tick,
          units: msg.units,
          buildings: msg.buildings,
          nodes: msg.nodes,
          players: msg.players,
          market: msg.market,
        });
      }
      break;
    }
    case 'gameOver': {
      const youWon = msg.winner === myPlayerId;
      gameOverScreen.show(youWon, msg.winnerName);
      music.setState('end'); // música de fim de jogo
      break;
    }
    default:
      // Tipo desconhecido: ignora silenciosamente.
      break;
  }
}

function teardownGame(): void {
  if (gameScreen) {
    gameScreen.destroy();
    gameScreen = null;
  }
}

// ---------------------------------------------------------------- início

showScreen('name');
net.connect();

// F5/fechar aba: fecha o socket na hora pra o servidor liberar o nome
// imediatamente (sem esperar o timeout). O clientId ainda garante reassumir.
window.addEventListener('pagehide', () => net.close());
