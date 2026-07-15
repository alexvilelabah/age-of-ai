// Tela 1: Nome — título, campo de nome e botão "Entrar".

import { el } from '../ui';
import { t } from '../i18n';

export interface NameScreenDeps {
  onEnter: (name: string) => void;
  initialName?: string; // nome salvo (localStorage) p/ pré-preencher após refresh
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class NameScreen {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private status: HTMLElement;
  private titleEl: HTMLElement;
  private enterBtn: HTMLButtonElement;
  private footEl: HTMLElement;

  constructor(private deps: NameScreenDeps) {
    this.el = el('div', 'screen entry-screen');

    // (o fundo com a arte vem da classe .screen, via CSS — vale p/ todas as telas)

    // Brasas subindo (o castelo em chamas) — vida leve e temática. Sempre ligadas:
    // é a identidade da tela e um efeito bem suave, então NÃO seguimos o
    // prefers-reduced-motion aqui (senão somem no PC com "reduzir animações" ligado,
    // que no Windows costuma vir ligado sem a pessoa perceber).
    const embers = el('div', 'entry-embers');
    for (let i = 0; i < 36; i++) {
      const e = el('div', 'ember');
      e.style.cssText =
        `--x:${Math.round(rand(0, 100))}%;` +
        `--size:${rand(2, 5).toFixed(1)}px;` +
        `--dur:${rand(7, 15).toFixed(1)}s;` +
        `--delay:${(-rand(0, 15)).toFixed(1)}s;` +
        `--drift:${Math.round(rand(-38, 38))}px;` +
        `--sway:${rand(2.5, 5).toFixed(1)}s`;
      embers.appendChild(e);
    }
    this.el.appendChild(embers);

    // Login mínimo sobre a arte — a moldura e o título "Age of AI" já vêm da imagem.
    const login = el('div', 'entry-login');
    this.titleEl = el('h2', 'entry-login-title', t('name.join_heading'));
    login.appendChild(this.titleEl);

    this.input = el('input', 'txt');
    this.input.type = 'text';
    this.input.maxLength = 20;
    this.input.placeholder = t('name.placeholder');
    if (this.deps.initialName) this.input.value = this.deps.initialName;
    login.appendChild(this.input);

    this.enterBtn = el('button', 'btn primary', t('name.enter'));
    this.enterBtn.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    login.appendChild(this.enterBtn);

    this.status = el('div', 'status-line');
    login.appendChild(this.status);

    this.footEl = el('p', 'entry-login-foot', t('name.footer'));
    login.appendChild(this.footEl);

    this.el.appendChild(login);
  }

  /** Troca de idioma AO VIVO (sem recarregar): só os textos mudam — o nome já
   *  digitado e as brasas continuam de pé. */
  retranslate(): void {
    this.titleEl.textContent = t('name.join_heading');
    this.input.placeholder = t('name.placeholder');
    this.enterBtn.textContent = t('name.enter');
    this.footEl.textContent = t('name.footer');
    this.status.textContent = ''; // a mensagem antiga ficaria no idioma velho
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
