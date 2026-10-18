import type { AudioEngine } from '../AudioEngine';

/**
 * A field of crickets: several voices at slightly different pitches and
 * tempos, each chirping in short pulse trains. Call `update` every frame
 * with the desired loudness (0 by day).
 */
export class Crickets {
  private readonly voices: Array<{ pitch: number; pan: number; timer: number; period: number }> = [];

  constructor(
    private readonly engine: AudioEngine,
    private readonly out: AudioNode,
    count = 4,
  ) {
    for (let i = 0; i < count; i++) {
      this.voices.push({
        pitch: 4000 + Math.random() * 900,
        pan: Math.random() * 1.8 - 0.9,
        timer: Math.random(),
        period: 0.55 + Math.random() * 0.6,
      });
    }
  }

  update(dt: number, loudness: number): void {
    if (loudness <= 0.01) return;
    const ctx = this.engine.context;
    for (const v of this.voices) {
      v.timer -= dt;
      if (v.timer > 0) continue;
      v.timer = v.period * (0.9 + Math.random() * 0.2);
      const when = ctx.currentTime + 0.02;
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan;
      pan.connect(this.out);
      // One chirp: three quick pulses.
      for (let p = 0; p < 3; p++) {
        const osc = ctx.createOscillator();
        osc.frequency.value = v.pitch;
        const amp = ctx.createGain();
        const t = when + p * 0.035;
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.02 * loudness, t + 0.004);
        amp.gain.linearRampToValueAtTime(0, t + 0.022);
        osc.connect(amp).connect(pan);
        osc.start(t);
        osc.stop(t + 0.03);
      }
      window.setTimeout(() => pan.disconnect(), 400);
    }
  }
}
