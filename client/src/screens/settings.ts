// Overlay do menu de OPÇÕES (volume de música/efeitos + resolução). Global —
// aberto pela engrenagem em qualquer tela. Modelado no ConnLostOverlay.

import { el } from '../ui';
import { settings, RENDER_SCALES } from '../settings';

export interface SettingsDeps {
  onMusicVol: (v: number) => void;   // 0..1
  onSfxVol: (v: number) => void;     // 0..1
  onRenderScale: (s: number) => void; // 1 | 0.75 | 0.5
}

export class SettingsOverlay {
  readonly el: HTMLElement;
  private scaleBtns: { s: number; btn: HTMLButtonElement }[] = [];

  constructor(private deps: SettingsDeps) {
    this.el = el('div', 'overlay hidden');
    const card = el('div', 'panel card opt-card');
    card.appendChild(el('h2', '', 'Opções'));

    card.appendChild(this.volumeRow('Música', settings.musicVol, (v) => this.deps.onMusicVol(v)));
    card.appendChild(this.volumeRow('Efeitos', settings.sfxVol, (v) => this.deps.onSfxVol(v)));

    // Resolução (qualidade/desempenho)
    const res = el('div', 'opt-row');
    res.appendChild(el('span', 'opt-label', 'Resolução'));
    const scales = el('div', 'opt-scales');
    for (const s of RENDER_SCALES) {
      const btn = el('button', 'btn scale-btn', `${Math.round(s * 100)}%`);
      btn.addEventListener('click', () => { this.deps.onRenderScale(s); this.markScale(s); });
      this.scaleBtns.push({ s, btn });
      scales.appendChild(btn);
    }
    res.appendChild(scales);
    card.appendChild(res);
    this.markScale(settings.renderScale);

    const hint = el('p', 'opt-hint', '75% ou 50% deixam o jogo mais leve (menos nítido).');
    card.appendChild(hint);

    const close = el('button', 'btn primary', 'Fechar');
    close.addEventListener('click', () => this.hide());
    card.appendChild(close);

    this.el.appendChild(card);
    // clicar fora do card fecha
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.hide(); });
  }

  private volumeRow(label: string, initial: number, onChange: (v: number) => void): HTMLElement {
    const row = el('div', 'opt-row');
    row.appendChild(el('span', 'opt-label', label));
    const slider = el('input', 'opt-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(initial * 100));
    const pct = el('span', 'opt-pct', `${slider.value}%`);
    slider.addEventListener('input', () => {
      pct.textContent = `${slider.value}%`;
      onChange(Number(slider.value) / 100);
    });
    row.appendChild(slider);
    row.appendChild(pct);
    return row;
  }

  private markScale(s: number): void {
    for (const { s: bs, btn } of this.scaleBtns) btn.classList.toggle('active', Math.abs(bs - s) < 0.001);
  }

  show(): void {
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
