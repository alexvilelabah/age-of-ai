// Tela 1: Nome — título, campo de nome e botão "Entrar".

import { el } from '../ui';

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
    frame.appendChild(el('p', 'entry-kicker', 'Bem-vindo a'));
    frame.appendChild(el('h1', 'title entry-title', 'Age of AI'));
    frame.appendChild(el('p', 'subtitle', 'Estratégia em tempo real inspirada no Age of Empires — construída com IA.'));
    frame.appendChild(el('hr', 'entry-rule'));
    frame.appendChild(el('p', 'entry-welcome', 'Erga sua vila desde a Idade das Trevas, colete recursos, avance pelas eras e conquiste seus rivais. Um Age of Empires enxuto, feito pra rodar no navegador.'));

    const card = el('div', 'entry-card');
    card.appendChild(el('h2', '', 'Entrar no jogo'));

    this.input = el('input', 'txt');
    this.input.type = 'text';
    this.input.maxLength = 20;
    this.input.placeholder = 'Seu nome de guerreiro…';
    if (this.deps.initialName) this.input.value = this.deps.initialName;
    card.appendChild(this.input);

    const btn = el('button', 'btn primary', 'Entrar');
    btn.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    card.appendChild(btn);

    this.status = el('div', 'status-line');
    card.appendChild(this.status);
    frame.appendChild(card);

    frame.appendChild(el('p', 'entry-foot', '✦ Projeto open source · feito com a ajuda de IA, por diversão ✦'));

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
      this.setStatus('Digite um nome para continuar.');
      this.input.focus();
      return;
    }
    this.deps.onEnter(name);
  }
}
