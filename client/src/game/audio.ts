// Áudio do jogo. Toca ARQUIVOS de som (mp3/ogg/wav) colocados em
// client/public/sounds/ — cada ação/objeto tem seu arquivo. Se um arquivo não
// existir, cai num som sintetizado de reserva (para o jogo nunca ficar mudo).
// Assim dá pra ir adicionando os sons "de verdade" um a um.
//
// IMPORTANTE: usar sons LIVRES (CC0 / freesound / gerados por IA) — nunca
// arquivos extraídos do AoE2 ou de jogos comerciais (direito autoral).

import type { BuildingType, NodeType, UnitType } from '@age/shared';

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  glideTo?: number;
  delay?: number;
}
interface NoiseOpts {
  filter?: number;
  filterTo?: number; // varre o corte do filtro (ex.: "fum" do ataque)
  gain?: number;
  delay?: number;
  type?: BiquadFilterType;
}

// Slot lógico -> nome do arquivo em /public/sounds/. Baixe/gere e coloque lá.
const SAMPLE_FILES: Record<string, string> = {
  select_villager: 'select_villager.mp3',
  select_swordsman: 'select_swordsman.mp3',
  select_archer: 'select_archer.mp3',
  select_knight: 'select_knight.mp3',      // ex.: cavalo relinchando
  select_building: 'select_building.mp3',
  select_resource: 'select_resource.mp3',
  move: 'move.mp3',
  attack: 'attack.mp3',                    // ex.: espada
  gather: 'gather.mp3',
  build: 'build.mp3',
  place: 'place.mp3',
  ui: 'ui.mp3',
  trained: 'trained.mp3',
  ageup: 'ageup.mp3',
  research: 'research.mp3',
  death: 'death.mp3',
  wreck: 'wreck.mp3',
  hit: 'hit.mp3',                          // ex.: choque de espada
  owl: 'owl.mp3',                          // pio da coruja
  music: 'music.mp3',                      // trilha de fundo (loop) — opcional
};

export class Sfx {
  muted = false;
  private vol = 0.5;        // volume dos efeitos (0..1), ajustável pelo menu de opções
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<string, AudioBuffer>();
  private lastHitAt = 0;
  // música de fundo (trilha própria, gerada; ou arquivo music.mp3 em loop)
  private musicGain: GainNode | null = null;
  private musicOn = false;
  private musicStep = 0;
  private musicTimer: number | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;

  /** Contexto de áudio (criado sob demanda; retomado num gesto do usuário). */
  private ac(): AudioContext | null {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.vol;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  resume(): void {
    const c = this.ac();
    if (c && c.state === 'suspended') void c.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted && this.ctx) void this.ctx.suspend();
    else if (!this.muted) this.resume();
    return this.muted;
  }

  /** Volume dos efeitos (0..1). Aplica na hora se o áudio já foi criado. */
  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.vol;
  }

  getVolume(): number {
    return this.vol;
  }

  /** Baixa e decodifica os arquivos de som presentes em /sounds/. Ausentes são
   *  ignorados (o slot usa o som sintetizado de reserva). */
  async preload(base = '/sounds/'): Promise<void> {
    const ctx = this.ac();
    if (!ctx) return;
    await Promise.all(
      Object.entries(SAMPLE_FILES).map(async ([slot, file]) => {
        try {
          const res = await fetch(base + file);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.samples.set(slot, buf);
        } catch {
          /* arquivo ausente/ inválido: usa a reserva sintetizada */
        }
      }),
    );
  }

  // ---------------------------------------------------------------- toca arquivo

  /** Toca um arquivo de som se ele existir. Retorna true se tocou. */
  private play(slot: string, gain = 1): boolean {
    if (this.muted) return true; // "tratado" (silêncio), sem cair na reserva
    const ctx = this.ac();
    if (!ctx || !this.master) return false;
    const buf = this.samples.get(slot);
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
    return true;
  }

  // ---------------------------------------------------------------- síntese (reserva)

  private tone(freq: number, dur: number, o: ToneOpts = {}): void {
    if (this.muted) return;
    const ctx = this.ac();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glideTo), t0 + dur);
    const gain = o.gain ?? 0.4;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, o: NoiseOpts = {}): void {
    if (this.muted) return;
    const ctx = this.ac();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type ?? 'lowpass';
    filt.frequency.setValueAtTime(o.filter ?? 1200, t0);
    if (o.filterTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, o.filterTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------------------------------------------------------------- timbres
  // Blocos reutilizáveis para dar "material" ao som sintetizado.

  /** Tinido metálico: parciais inarmônicos (tipo sino/metal) + transiente seco.
   *  Usado em pedra/ouro (perro batendo em ferro) e armadura. */
  private clink(base: number, gain: number): void {
    this.tone(base, 0.13, { type: 'square', gain: gain });
    this.tone(base * 2.76, 0.1, { type: 'triangle', gain: gain * 0.5 });
    this.tone(base * 5.4, 0.07, { type: 'sine', gain: gain * 0.3 });
    this.noise(0.025, { filter: 5000, type: 'highpass', gain: gain * 0.6 });
  }

  /** Batida seca de madeira (tronco/tábua). */
  private knock(base: number, gain: number): void {
    this.noise(0.05, { filter: 1000, gain: gain * 0.7 });
    this.tone(base, 0.08, { type: 'triangle', gain: gain, glideTo: base * 0.7 });
  }

  // ---------------------------------------------------------------- eventos
  // Cada método tenta o arquivo do slot; se faltar, usa a reserva sintetizada.

  selectUnit(type: UnitType): void {
    if (this.play(`select_${type}`)) return;
    switch (type) {
      case 'villager':  this.tone(600, 0.09, { type: 'triangle', gain: 0.34, glideTo: 780 }); break; // "sim?" curtinho
      case 'swordsman': this.clink(440, 0.16); break;                                                 // tinido de armadura
      case 'archer':    this.tone(280, 0.05, { type: 'sine', gain: 0.18 }); this.noise(0.07, { filter: 3200, type: 'highpass', gain: 0.16 }); break; // corda de arco
      case 'knight':    this.tone(150, 0.2, { type: 'sawtooth', gain: 0.26, glideTo: 108 }); this.noise(0.13, { filter: 520, gain: 0.13 }); break;   // bufar do cavalo
      default:          this.tone(500, 0.08, {});
    }
  }

  /** Seleção de prédio: baque de pedra (Centro/Ferraria) ou de madeira (resto),
   *  com um leve deslocamento de tom por tipo pra "cada prédio um som". */
  selectBuilding(type?: BuildingType): void {
    if (this.play('select_building')) return;
    const pitch: Partial<Record<BuildingType, number>> = {
      town_center: 0.9, house: 1.16, barracks: 0.98, farm: 1.28, archery_range: 1.08, stable: 0.86, blacksmith: 0.8,
      market: 1.2, wall: 0.72, watch_tower: 0.78,
      mill: 1.24, lumber_camp: 1.04, mining_camp: 0.92,
    };
    const p = (type && pitch[type]) || 1;
    const stone = type === 'town_center' || type === 'blacksmith' || type === 'wall' || type === 'watch_tower';
    if (stone) {
      this.tone(120 * p, 0.16, { type: 'sine', gain: 0.34 });
      this.noise(0.1, { filter: 520, gain: 0.22 });
    } else {
      this.knock(190 * p, 0.3);
      this.tone(150 * p, 0.12, { type: 'sine', gain: 0.18 });
    }
  }

  /** Seleção de recurso: metálico p/ pedra/ouro, madeira p/ árvore, folhagem p/ arbusto. */
  selectNode(type?: NodeType): void {
    if (this.play('select_resource')) return;
    switch (type) {
      case 'gold_mine':  this.clink(1500, 0.16); break;                                                   // metálico brilhante
      case 'stone_mine': this.clink(720, 0.15); this.noise(0.05, { filter: 1500, gain: 0.16 }); break;    // pedra + metal
      case 'tree':       this.knock(150, 0.32); break;                                                    // madeira
      case 'berry_bush': this.noise(0.1, { filter: 2600, type: 'highpass', gain: 0.13 }); this.tone(520, 0.05, { type: 'sine', gain: 0.13 }); break; // folhagem
      default:           this.tone(430, 0.07, { type: 'triangle', gain: 0.24 });
    }
  }

  cmdMove(): void { if (this.play('move')) return; this.noise(0.05, { filter: 1500, filterTo: 620, gain: 0.18 }); this.tone(360, 0.05, { type: 'sine', gain: 0.14, glideTo: 300 }); }
  cmdAttack(): void {
    if (this.play('attack')) return;
    // "fum" — investida: sopro varrendo de agudo p/ grave (bandpass) + rosnado grave
    this.noise(0.15, { filter: 1900, filterTo: 380, type: 'bandpass', gain: 0.32 });
    this.tone(180, 0.13, { type: 'sawtooth', gain: 0.16, glideTo: 88 });
  }
  cmdGather(): void { if (this.play('gather')) return; this.tone(560, 0.07, { type: 'sine', gain: 0.24, glideTo: 650 }); this.noise(0.04, { filter: 1400, gain: 0.1 }); }
  cmdBuild(): void { if (this.play('build')) return; this.knock(240, 0.28); this.noise(0.08, { filter: 1100, gain: 0.16, delay: 0.09 }); }
  place(): void { if (this.play('place')) return; this.noise(0.14, { filter: 480, gain: 0.34 }); this.tone(150, 0.13, { type: 'sine', gain: 0.26, glideTo: 110 }); }

  uiClick(): void { if (this.play('ui', 0.7)) return; this.tone(880, 0.03, { type: 'square', gain: 0.12 }); this.tone(1250, 0.03, { type: 'square', gain: 0.06, delay: 0.015 }); }
  trained(): void { if (this.play('trained')) return; this.tone(700, 0.08, { type: 'sine', gain: 0.26 }); this.tone(1050, 0.11, { type: 'sine', gain: 0.24, delay: 0.08 }); }
  research(): void { if (this.play('research')) return; this.tone(880, 0.12, { type: 'sine', gain: 0.24 }); this.tone(1320, 0.16, { type: 'triangle', gain: 0.14, delay: 0.05 }); }
  ageUp(): void {
    if (this.play('ageup')) return;
    // fanfarra: tríade maior ascendente + oitava, encorpada
    [392, 494, 587, 784].forEach((f, i) => {
      this.tone(f, 0.42, { type: 'triangle', gain: 0.24, delay: i * 0.13 });
      this.tone(f / 2, 0.42, { type: 'sine', gain: 0.12, delay: i * 0.13 });
    });
  }
  death(): void { if (this.play('death')) return; this.tone(220, 0.18, { type: 'sawtooth', gain: 0.22, glideTo: 88 }); this.noise(0.1, { filter: 500, gain: 0.13 }); }
  wreck(): void { if (this.play('wreck')) return; this.noise(0.4, { filter: 800, filterTo: 200, gain: 0.34 }); this.tone(120, 0.32, { type: 'sawtooth', gain: 0.2, glideTo: 55 }); }
  hit(now: number): void {
    if (now - this.lastHitAt < 80) return;
    this.lastHitAt = now;
    if (this.play('hit', 0.8)) return;
    // choque metálico curto (clangor de lâmina)
    this.clink(900, 0.11);
    this.noise(0.035, { filter: 3200, type: 'highpass', gain: 0.12 });
  }

  /** Pio da coruja que cruza o céu (~1x/min). */
  owl(): void {
    if (this.play('owl')) return;
    this.tone(400, 0.16, { type: 'sine', gain: 0.22, glideTo: 340 });
    this.tone(360, 0.2, { type: 'sine', gain: 0.2, glideTo: 300, delay: 0.24 });
  }

  // ---------------------------------------------------------------- música de fundo
  // Trilha calma. Se existir /sounds/music.mp3, toca em loop; senão, gera uma
  // sequência de acordes suaves em Lá menor com melodia esparsa (pad ambiente).

  startMusic(): void {
    const ctx = this.ac();
    if (!ctx || this.musicOn) return;
    this.musicOn = true;
    if (!this.musicGain) {
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(ctx.destination); // trilha própria (não passa pelo master de SFX)
    }
    const t = ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0.12, t + 2.5);
    const buf = this.samples.get('music');
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.musicSrc = src;
    } else {
      this.scheduleMusic();
    }
  }

  stopMusic(): void {
    this.musicOn = false;
    if (this.musicTimer !== null) { clearTimeout(this.musicTimer); this.musicTimer = null; }
    if (this.musicGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
      this.musicGain.gain.linearRampToValueAtTime(0, t + 1.2);
    }
    if (this.musicSrc && this.ctx) {
      try { this.musicSrc.stop(this.ctx.currentTime + 1.3); } catch { /* já parado */ }
      this.musicSrc = null;
    }
  }

  toggleMusic(): boolean {
    if (this.musicOn) this.stopMusic();
    else this.startMusic();
    return this.musicOn;
  }

  /** Agenda o próximo acorde da trilha gerada (recursivo por setTimeout). */
  private scheduleMusic(): void {
    if (!this.ctx || !this.musicGain || !this.musicOn) return;
    const ctx = this.ctx;
    // pausa a geração enquanto mudo/suspenso (evita empilhar notas no mesmo t)
    if (this.muted || ctx.state === 'suspended') {
      this.musicTimer = window.setTimeout(() => this.scheduleMusic(), 1000);
      return;
    }
    // progressão calma em Lá menor: Am – F – C – G (~7s cada)
    const chords = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [261.63, 329.63, 392.0],
      [196.0, 246.94, 293.66],
    ];
    const dur = 7;
    const t0 = ctx.currentTime + 0.05;
    const chord = chords[this.musicStep % chords.length];
    for (const f of chord) this.pad(f, dur, t0, 1);
    this.pad(chord[0] / 2, dur, t0, 0.6); // baixo suave uma oitava abaixo
    // melodia esparsa (a cada 2 acordes), pentatônica de Lá menor uma oitava acima
    if (this.musicStep % 2 === 1) {
      const scale = [440, 523.25, 587.33, 659.25, 783.99];
      this.melody(scale[(this.musicStep * 7) % scale.length], t0 + 1.6);
      this.melody(scale[(this.musicStep * 3 + 2) % scale.length], t0 + 4.1);
    }
    this.musicStep++;
    this.musicTimer = window.setTimeout(() => this.scheduleMusic(), dur * 1000 - 250);
  }

  /** Voz de "pad" longa e suave (dois osciladores levemente desafinados + LP). */
  private pad(freq: number, dur: number, t0: number, gainMul: number): void {
    if (!this.ctx || !this.musicGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = freq;
    osc2.type = 'sine'; osc2.frequency.value = freq * 1.006;
    lp.type = 'lowpass'; lp.frequency.value = 1500;
    const peak = 0.16 * gainMul;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 1.8);
    g.gain.linearRampToValueAtTime(peak * 0.8, t0 + dur - 2);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(this.musicGain);
    osc.start(t0); osc2.start(t0);
    osc.stop(t0 + dur + 0.1); osc2.stop(t0 + dur + 0.1);
  }

  /** Nota de melodia curta e doce sobre a trilha. */
  private melody(freq: number, t0: number): void {
    if (!this.ctx || !this.musicGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.085, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.9);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t0); osc.stop(t0 + 2);
  }
}
