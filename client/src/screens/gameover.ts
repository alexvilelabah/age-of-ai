// Tela 5: Fim de jogo — overlay "Vitória!" (dourado) ou "Derrota" com nome
// do vencedor e botão "Voltar ao lobby".

import { el } from '../ui';
import { t } from '../i18n';

export interface GameOverDeps {
  onBackToLobby: () => void;
}

export class GameOverScreen {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private infoEl: HTMLElement;

  constructor(private deps: GameOverDeps) {
    this.el = el('div', 'overlay hidden');
    const card = el('div', 'panel card');
    this.titleEl = el('h1', 'result-title');
    this.infoEl = el('p', 'subtitle');
    const btn = el('button', 'btn primary', t('common.back_lobby'));
    btn.addEventListener('click', () => this.deps.onBackToLobby());
    card.appendChild(this.titleEl);
    card.appendChild(this.infoEl);
    card.appendChild(btn);
    this.el.appendChild(card);
  }

  show(youWon: boolean, winnerName: string): void {
    if (youWon) {
      this.titleEl.textContent = t('over.victory');
      this.titleEl.className = 'result-title win';
      this.infoEl.textContent = t('over.victory_desc');
    } else {
      this.titleEl.textContent = t('over.defeat');
      this.titleEl.className = 'result-title lose';
      this.infoEl.textContent = t('over.defeat_desc', { winner: winnerName });
    }
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
