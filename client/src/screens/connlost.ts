// Overlay "Conexão perdida" exibido quando o WebSocket cai durante o jogo.

import { el } from '../ui';

export interface ConnLostDeps {
  onBackToLobby: () => void;
}

export class ConnLostOverlay {
  readonly el: HTMLElement;

  constructor(deps: ConnLostDeps) {
    this.el = el('div', 'overlay hidden');
    const card = el('div', 'panel card');
    card.appendChild(el('h2', '', 'Conexão perdida'));
    card.appendChild(el('p', 'subtitle', 'A ligação com o servidor foi interrompida.'));
    const btn = el('button', 'btn primary', 'Voltar ao lobby');
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
