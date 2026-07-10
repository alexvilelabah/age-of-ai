// Tela 5: Fim de jogo — overlay "Vitória!" (dourado) ou "Derrota" com nome
// do vencedor e botão "Voltar ao lobby".

import { el } from '../ui';

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
    const btn = el('button', 'btn primary', 'Voltar ao lobby');
    btn.addEventListener('click', () => this.deps.onBackToLobby());
    card.appendChild(this.titleEl);
    card.appendChild(this.infoEl);
    card.appendChild(btn);
    this.el.appendChild(card);
  }

  show(youWon: boolean, winnerName: string): void {
    if (youWon) {
      this.titleEl.textContent = 'Vitória!';
      this.titleEl.className = 'result-title win';
      this.infoEl.textContent = 'Seu império prevaleceu.';
    } else {
      this.titleEl.textContent = 'Derrota';
      this.titleEl.className = 'result-title lose';
      this.infoEl.textContent = `${winnerName} venceu a partida.`;
    }
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
