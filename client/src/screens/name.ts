// Tela 1: Nome — título, campo de nome e botão "Entrar".

import { el } from '../ui';
import { t } from '../i18n';

export interface NameScreenDeps {
  onEnter: (name: string) => void;
  initialName?: string; // nome salvo (localStorage) p/ pré-preencher após refresh
}

export class NameScreen {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private status: HTMLElement;

  constructor(private deps: NameScreenDeps) {
    this.el = el('div', 'screen');

    // Moldura de quadro dourada com tudo dentro (primeira coisa que a pessoa vê).
    const frame = el('div', 'entry-frame');
    frame.appendChild(el('p', 'entry-kicker', t('name.welcome_to')));
    frame.appendChild(el('h1', 'title entry-title', 'Age of AI'));
    frame.appendChild(el('p', 'subtitle', t('name.subtitle')));
    frame.appendChild(el('hr', 'entry-rule'));
    frame.appendChild(el('p', 'entry-welcome', t('name.blurb')));

    const card = el('div', 'entry-card');
    card.appendChild(el('h2', '', t('name.join_heading')));

    this.input = el('input', 'txt');
    this.input.type = 'text';
    this.input.maxLength = 20;
    this.input.placeholder = t('name.placeholder');
    if (this.deps.initialName) this.input.value = this.deps.initialName;
    card.appendChild(this.input);

    const btn = el('button', 'btn primary', t('name.enter'));
    btn.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    card.appendChild(btn);

    this.status = el('div', 'status-line');
    card.appendChild(this.status);
    frame.appendChild(card);

    frame.appendChild(el('p', 'entry-foot', t('name.footer')));

    this.el.appendChild(frame);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  focus(): void {
    this.input.focus();
    this.input.select(); // seleciona o nome pré-preenchido p/ trocar fácil
  }

  private submit(): void {
    const name = this.input.value.trim();
    if (!name) {
      this.setStatus(t('name.empty'));
      this.input.focus();
      return;
    }
    this.deps.onEnter(name);
  }
}
