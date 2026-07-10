// Preferências do jogador (idioma, volume de música/efeitos e resolução),
// persistidas no localStorage. Primeiro uso de persistência no cliente.

/** Idiomas suportados. Adicionar um novo = mais uma coluna nos dicionários do i18n. */
export type Lang = 'pt' | 'en' | 'es';
export const LANGS: readonly Lang[] = ['pt', 'en', 'es'] as const;

/** Detecta o idioma pela região do navegador (pt/es/en). Fallback: inglês —
 *  o público internacional é o padrão; quem estiver no Brasil cai em pt. A
 *  detecção mora aqui (e não no i18n) pra evitar import circular: o i18n
 *  depende do settings, nunca o contrário. */
export function detectLang(): Lang {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const raw of list) {
      const code = (raw || '').toLowerCase();
      if (code.startsWith('pt')) return 'pt';
      if (code.startsWith('es')) return 'es';
      if (code.startsWith('en')) return 'en';
    }
  } catch {
    /* navigator indisponível: cai no fallback */
  }
  return 'en';
}

export interface Settings {
  lang: Lang;          // idioma da interface
  musicVol: number;    // 0..1
  sfxVol: number;      // 0..1
  renderScale: number; // 1 | 0.75 | 0.5 (qualidade/desempenho)
}

const KEY = 'ageofai:settings';
const DEFAULTS: Omit<Settings, 'lang'> = { musicVol: 0.35, sfxVol: 0.5, renderScale: 1 };
export const RENDER_SCALES = [1, 0.75, 0.5] as const;

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback;
}

function load(): Settings {
  const lang = detectLang(); // padrão até o jogador escolher nas Opções
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, lang };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      lang: LANGS.includes(p.lang as Lang) ? (p.lang as Lang) : lang,
      musicVol: clamp01(p.musicVol, DEFAULTS.musicVol),
      sfxVol: clamp01(p.sfxVol, DEFAULTS.sfxVol),
      renderScale: (RENDER_SCALES as readonly number[]).includes(p.renderScale as number)
        ? (p.renderScale as number)
        : DEFAULTS.renderScale,
    };
  } catch {
    return { ...DEFAULTS, lang };
  }
}

/** Preferências atuais (carregadas do localStorage no boot). Mutável — edite os
 *  campos e chame saveSettings(). */
export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* localStorage indisponível/cheio: só não persiste */
  }
}
