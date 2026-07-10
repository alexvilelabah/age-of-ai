// Overlay do menu de OPÇÕES (volume de música/efeitos + resolução). Global —
// aberto pela engrenagem em qualquer tela. Modelado no ConnLostOverlay.

import { el } from '../ui';
import { settings, RENDER_SCALES, LANGS, type Lang } from '../settings';
import { t } from '../i18n';

/** Rótulo de cada idioma no seletor (sempre no próprio idioma — assim qualquer
 *  um se reconhece, independente de quem está lendo). */
const LANG_LABELS: Record<Lang, string> = { pt: 'Português', en: 'English', es: 'Español' };

export interface SettingsDeps {
  onMusicVol: (v: number) => void;   // 0..1
  onSfxVol: (v: number) => void;     // 0..1
  onRenderScale: (s: number) => void; // 1 | 0.75 | 0.5
  onLang: (lang: Lang) => void;       // troca de idioma (main decide reload x ao vivo)
}

export class SettingsOverlay {
  readonly el: HTMLElement;
  private scaleBtns: { s: number; btn: HTMLButtonElement }[] = [];
  private card: HTMLElement;

  constructor(private deps: SettingsDeps) {
    this.el = el('div', 'overlay hidden');
    this.card = this.buildCard();
    this.el.appendChild(this.card);
    // clicar fora do card fecha
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.hide(); });
  }

  /** Monta (ou remonta) o cartão de opções no idioma atual. */
  private buildCard(): HTMLElement {
    this.scaleBtns = [];
    const card = el('div', 'panel card opt-card');
    card.appendChild(el('h2', '', t('opt.title')));

    // Idioma da interface. A troca vai pro main via onLang: fora do jogo ele
    // recarrega (reconecta ao lobby); no jogo, troca ao vivo sem derrubar a partida.
    const langRow = el('div', 'opt-row');
    langRow.appendChild(el('span', 'opt-label', t('opt.language')));
    const langBtns = el('div', 'opt-scales');
    for (const l of LANGS) {
      const btn = el('button', 'btn scale-btn', LANG_LABELS[l]);
      btn.classList.toggle('active', l === settings.lang);
      btn.addEventListener('click', () => {
        if (l === settings.lang) return;
        this.deps.onLang(l);
      });
      langBtns.appendChild(btn);
    }
    langRow.appendChild(langBtns);
    card.appendChild(langRow);

    card.appendChild(this.volumeRow(t('opt.music'), settings.musicVol, (v) => this.deps.onMusicVol(v)));
    card.appendChild(this.volumeRow(t('opt.sfx'), settings.sfxVol, (v) => this.deps.onSfxVol(v)));

    // Resolução (qualidade/desempenho)
    const res = el('div', 'opt-row');
    res.appendChild(el('span', 'opt-label', t('opt.resolution')));
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

    const hint = el('p', 'opt-hint', t('opt.res_hint'));
    card.appendChild(hint);

    const close = el('button', 'btn primary', t('opt.close'));
    close.addEventListener('click', () => this.hide());
    card.appendChild(close);
    return card;
  }

  /** Re-traduz o próprio menu ao vivo (usado quando o idioma muda no jogo, sem reload). */
  retranslate(): void {
    const fresh = this.buildCard();
    this.card.replaceWith(fresh);
    this.card = fresh;
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
