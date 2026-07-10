// Trilha sonora por ESTADO do jogo, tocando os MP3 de /public/music/:
//   menu   -> musicaabertura.mp3 (loop)
//   game   -> musicafundojogo2 / musicafundojogo3 (revezando)
//   battle -> musicaataque.mp3 (loop enquanto houver combate; volta pro fundo
//             sozinho depois de ~8s sem briga)
//   end    -> fimdejogo.mp3 (uma vez, no fim da partida)
// Usa HTMLAudio (streaming — não precisa decodificar o arquivo inteiro) com
// crossfade suave entre estados. Tecla N liga/desliga; M (mudo geral) também
// silencia a música.

type MusicState = 'off' | 'menu' | 'game' | 'battle' | 'end';

const TRACKS = {
  menu: ['musicaabertura.mp3'],
  // musicadefundodojogo.mp3 foi removida do rodízio: tinha um clique agudo
  // metronômico (~3/s, tipo "tec tec tec") gravado dentro do próprio arquivo.
  game: ['musicafundojogo2.mp3', 'musicafundojogo3.mp3'],
  battle: ['musicaataque.mp3'],
  end: ['fimdejogo.mp3'],
} as const;

const VOLUME = 0.35;      // volume alvo da música (SFX ficam por cima)
const FADE_MS = 1200;     // duração do crossfade
const BATTLE_HOLD = 8000; // ms sem combate para voltar do 'battle' pro 'game'

class MusicPlayer {
  private state: MusicState = 'off';
  private cur: HTMLAudioElement | null = null;
  private fading: HTMLAudioElement | null = null;
  private fadeTimer: number | null = null;
  private gameIdx = 0;
  private lastBattleAt = 0;
  private unlocked = false; // navegador só deixa tocar depois de um gesto
  private enabled = true;   // tecla N
  private muted = false;    // tecla M (mudo geral)
  private vol = VOLUME;     // volume alvo (0..1), ajustável pelo menu de opções
  private broken = new Set<string>(); // arquivos que falharam (404 etc.)

  /** Chamar no primeiro gesto do usuário (destrava o autoplay). */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.apply();
  }

  setState(s: MusicState): void {
    if (s === this.state) return;
    this.state = s;
    if (s === 'battle') this.lastBattleAt = performance.now();
    this.apply();
  }

  /** Sinaliza combate agora — entra na música de ataque e segura ela. */
  battlePulse(): void {
    this.lastBattleAt = performance.now();
    if (this.state === 'game') this.setState('battle');
  }

  /** Chamar por frame durante a partida: decai de 'battle' de volta pra 'game'. */
  tick(now: number): void {
    if (this.state === 'battle' && now - this.lastBattleAt > BATTLE_HOLD) {
      this.setState('game');
    }
  }

  /** Tecla N: liga/desliga só a música. Devolve o novo estado. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    this.apply();
    return this.enabled;
  }

  /** Acompanha o mudo geral (tecla M). */
  setMuted(m: boolean): void {
    this.muted = m;
    if (this.cur) this.cur.muted = m;
    if (this.fading) this.fading.muted = m;
  }

  /** Volume da música (0..1) — aplica NA HORA (fora de um fade, seta o elemento
   *  atual direto; durante o fade, a rampa já usa `this.vol`). */
  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.fadeTimer === null && this.cur) this.cur.volume = this.vol;
  }

  getVolume(): number {
    return this.vol;
  }

  // ------------------------------------------------------------------ interno

  private apply(): void {
    if (!this.unlocked) return;
    if (!this.enabled || this.state === 'off') {
      this.crossfadeTo(null);
      return;
    }
    const list = TRACKS[this.state];
    const file = this.state === 'game' ? this.pickGameTrack() : list.find((f) => !this.broken.has(f)) ?? null;
    this.crossfadeTo(file);
  }

  private pickGameTrack(): string | null {
    const ok = TRACKS.game.filter((f) => !this.broken.has(f));
    if (ok.length === 0) return null;
    return ok[this.gameIdx % ok.length];
  }

  private crossfadeTo(file: string | null): void {
    // já está tocando esse arquivo? não mexe
    if (file && this.cur && this.cur.src.endsWith('/' + encodeURIComponent(file))) return;
    if (!file && !this.cur) return;

    // o atual vira "saindo" (interrompe fade anterior, se houver)
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.fading) {
      this.fading.pause();
      this.fading = null;
    }
    this.fading = this.cur;
    this.cur = null;

    if (file) {
      const a = new Audio('/music/' + file);
      a.volume = 0;
      a.muted = this.muted;
      a.loop = this.state !== 'game' && this.state !== 'end'; // menu/batalha em loop
      if (this.state === 'game') {
        // fim da faixa: passa pra próxima do revezamento
        a.addEventListener('ended', () => {
          if (this.state !== 'game' || this.cur !== a) return;
          this.gameIdx++;
          this.cur = null; // força a troca
          this.apply();
        });
      }
      a.addEventListener('error', () => {
        this.broken.add(file);
        if (this.cur === a) {
          this.cur = null;
          this.apply(); // tenta a próxima disponível
        }
      });
      void a.play().catch(() => {
        /* autoplay bloqueado: o próximo gesto/unlock resolve */
      });
      this.cur = a;
    }

    // rampa: sobe o novo, desce o antigo, ~FADE_MS
    const outEl = this.fading;
    const inEl = this.cur;
    const steps = Math.max(1, Math.round(FADE_MS / 50));
    let i = 0;
    this.fadeTimer = window.setInterval(() => {
      i++;
      const t = i / steps;
      if (inEl) inEl.volume = Math.min(this.vol, this.vol * t);
      if (outEl) outEl.volume = Math.max(0, this.vol * (1 - t));
      if (i >= steps) {
        if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        if (outEl) outEl.pause();
        if (this.fading === outEl) this.fading = null;
      }
    }, 50);
  }
}

/** Instância única da trilha (importe e use direto). */
export const music = new MusicPlayer();
