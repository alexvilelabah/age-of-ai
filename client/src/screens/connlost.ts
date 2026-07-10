// Overlay "Conexão perdida" exibido quando o WebSocket cai durante o jogo.

import { el } from '../ui';
import { t } from '../i18n';

export interface ConnLostDeps {
  onBackToLobby: () => void;
}

export class ConnLostOverlay {
  readonly el: HTMLElement;

  constructor(deps: ConnLostDeps) {
    this.el = el('div', 'overlay hidden');
    const card = el('div', 'panel card');
    card.appendChild(el('h2', '', t('conn.lost')));
    card.appendChild(el('p', 'subtitle', t('conn.lost_desc')));
    const btn = el('button', 'btn primary', t('common.back_lobby'));
    btn.addEventListener('click', () => deps.onBackToLobby());
    card.appendChild(btn);
    this.el.appendChild(card);
  }

  show(): void {
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
