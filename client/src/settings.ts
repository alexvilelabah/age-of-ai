// Preferências do jogador (volume de música/efeitos e resolução), persistidas no
// localStorage. Primeiro uso de persistência no cliente.

export interface Settings {
  musicVol: number;    // 0..1
  sfxVol: number;      // 0..1
  renderScale: number; // 1 | 0.75 | 0.5 (qualidade/desempenho)
}

const KEY = 'ageofai:settings';
const DEFAULTS: Settings = { musicVol: 0.35, sfxVol: 0.5, renderScale: 1 };
export const RENDER_SCALES = [1, 0.75, 0.5] as const;

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      musicVol: clamp01(p.musicVol, DEFAULTS.musicVol),
      sfxVol: clamp01(p.sfxVol, DEFAULTS.sfxVol),
      renderScale: (RENDER_SCALES as readonly number[]).includes(p.renderScale as number)
        ? (p.renderScale as number)
        : DEFAULTS.renderScale,
    };
  } catch {
    return { ...DEFAULTS };
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
