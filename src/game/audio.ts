/**
 * Procedural Web Audio synthesizer for Caldera Castaway.
 * Generates continuous ocean wave surf, deep volcanic rumble, tropical bird calls
 * (seagulls, parrots, toucans), footsteps, swimming splashes, pickup chimes, and lava sizzle.
 */

export class IslandAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private isRunning = false;

  private waveGain: GainNode | null = null;
  private volcanoGain: GainNode | null = null;
  private streamGain: GainNode | null = null;
  private waterfallGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private birdTimer = 0;

  public init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : 0.45;
      this.masterGain.connect(this.ctx.destination);

      this.setupOceanSurf();
      this.setupVolcanoRumble();
      this.setupFreshwaterStream();
      this.setupWaterfall();
      this.isRunning = true;
    } catch {
      // Ignore Web Audio errors in headless environments
    }
  }

  private createNoiseBuffer(durationSec = 3): AudioBuffer | null {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * durationSec;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Pink/brownish filtered noise
      data[i] = (lastOut + 0.04 * white) / 1.04;
      lastOut = data[i];
      data[i] *= 2.5;
    }
    return buffer;
  }

  private setupOceanSurf(): void {
    if (!this.ctx || !this.masterGain) return;
    const noiseBuffer = this.createNoiseBuffer(4);
    if (!noiseBuffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.9;

    this.waveGain = this.ctx.createGain();
    this.waveGain.gain.value = 0.08;

    source.connect(filter);
    filter.connect(this.waveGain);
    this.waveGain.connect(this.masterGain);
    source.start();
  }

  private setupVolcanoRumble(): void {
    if (!this.ctx || !this.masterGain) return;
    const noiseBuffer = this.createNoiseBuffer(4);
    if (!noiseBuffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 78;
    filter.Q.value = 2.2;

    this.volcanoGain = this.ctx.createGain();
    this.volcanoGain.gain.value = 0.05;

    source.connect(filter);
    filter.connect(this.volcanoGain);
    this.volcanoGain.connect(this.masterGain);
    source.start();
  }

  private setupFreshwaterStream(): void {
    if (!this.ctx || !this.masterGain) return;
    const noiseBuffer = this.createNoiseBuffer(3);
    if (!noiseBuffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 850;
    filter.Q.value = 1.4;

    this.streamGain = this.ctx.createGain();
    this.streamGain.gain.value = 0.0;

    source.connect(filter);
    filter.connect(this.streamGain);
    this.streamGain.connect(this.masterGain);
    source.start();
  }

  private setupWaterfall(): void {
    if (!this.ctx || !this.masterGain) return;
    const noiseBuffer = this.createNoiseBuffer(4);
    if (!noiseBuffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 1.1;

    this.waterfallGain = this.ctx.createGain();
    this.waterfallGain.gain.value = 0.0;

    source.connect(filter);
    filter.connect(this.waterfallGain);
    this.waterfallGain.connect(this.masterGain);
    source.start();
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.08);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setPaused(paused: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const target = paused || this.isMuted ? 0 : 0.45;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  /**
   * Updates spatial ambient volume based on player distance from center volcano, beach shoreline,
   * freshwater stream, and roaring waterfall grotto.
   */
  public updateAmbience(
    dt: number,
    timeElapsed: number,
    distFromCenter: number,
    daylightFactor: number,
    distToStream = 999,
    distToWaterfall = 999
  ): void {
    if (!this.ctx || !this.isRunning || this.isMuted) return;

    // Ocean wave swell LFO (stronger near shoreline r > 52)
    if (this.waveGain) {
      const coastProximity = Math.max(0.15, Math.min(1, (distFromCenter - 25) / 50));
      const swell = 0.55 + 0.45 * Math.sin(timeElapsed * 0.85);
      const targetWave = coastProximity * swell * 0.22;
      this.waveGain.gain.setTargetAtTime(targetWave, this.ctx.currentTime, 0.15);
    }

    // Volcano rumble (stronger near central crater r < 45)
    if (this.volcanoGain) {
      const volcanoProximity = Math.max(0.1, Math.min(1, 1 - (distFromCenter - 10) / 58));
      const tremor = 0.7 + 0.3 * Math.sin(timeElapsed * 2.3 + Math.cos(timeElapsed * 1.1));
      const targetRumble = volcanoProximity * tremor * 0.32;
      this.volcanoGain.gain.setTargetAtTime(targetRumble, this.ctx.currentTime, 0.15);
    }

    // Freshwater stream trickling / rushing audio (audible within ~18m of stream)
    if (this.streamGain) {
      const streamProximity = Math.max(0, Math.min(1, 1 - distToStream / 18.0));
      const streamFlutter = 0.8 + 0.2 * Math.sin(timeElapsed * 4.2);
      const targetStream = streamProximity * streamFlutter * 0.26;
      this.streamGain.gain.setTargetAtTime(targetStream, this.ctx.currentTime, 0.15);
    }

    // Waterfall roaring rumble (audible within ~24m of waterfall at -12, 34)
    if (this.waterfallGain) {
      const wfProximity = Math.max(0, Math.min(1, 1 - distToWaterfall / 24.0));
      const wfRoar = 0.85 + 0.15 * Math.sin(timeElapsed * 2.1);
      const targetWaterfall = wfProximity * wfRoar * 0.34;
      this.waterfallGain.gain.setTargetAtTime(targetWaterfall, this.ctx.currentTime, 0.15);
    }

    // Periodic tropical bird calls during daytime
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && daylightFactor > 0.25) {
      this.birdTimer = 2.8 + Math.random() * 4.5;
      if (distFromCenter > 56) {
        this.playSeagullCry();
      } else {
        if (Math.random() > 0.45) {
          this.playParrotChirp();
        } else {
          this.playToucanCall();
        }
      }
    }
  }

  public playWaterDrink(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const t = now + i * 0.11;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440 + i * 90, t);
      osc.frequency.exponentialRampToValueAtTime(780 + i * 110, t + 0.08);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.06, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  private playSeagullCry(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1450, now);
    osc.frequency.exponentialRampToValueAtTime(1820, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.45);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.48);
  }

  private playParrotChirp(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const base = 1700 + Math.random() * 400;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.35, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(base * 0.9, now + 0.18);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  private playToucanCall(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.03, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playFootstep(isSwimming: boolean): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const pitchVar = 0.92 + Math.random() * 0.16;

    if (isSwimming) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220 * pitchVar, now);
      osc.frequency.exponentialRampToValueAtTime(420 * pitchVar, now + 0.14);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.16);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(115 * pitchVar, now);
      osc.frequency.exponentialRampToValueAtTime(55 * pitchVar, now + 0.07);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.09);
    }
  }

  public playJump(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(390, now + 0.15);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playPickup(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.055);
      gain.gain.setValueAtTime(0.001, now + idx * 0.055);
      gain.gain.linearRampToValueAtTime(0.07, now + idx * 0.055 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.055);
      osc.stop(now + idx * 0.055 + 0.19);
    });
  }

  public playLavaBurn(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.22);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
