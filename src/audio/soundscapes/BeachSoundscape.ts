import type { BeachScene } from '../../scene/beach/BeachScene';
import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import { Soundscape } from './Soundscape';

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The shore: a low roar of distant swells, every breaking wave as a crash
 * followed by the hiss of the backwash, a coastal breeze and far-off gulls.
 */
export class BeachSoundscape extends Soundscape {
  private readonly swell: GainNode;
  private readonly breeze: GainNode;
  private readonly unsubscribe: () => void;
  private time = 0;
  private gullTimer = rand(8, 20);

  constructor(engine: AudioEngine, scene: BeachScene, bed?: AudioBuffer) {
    super(engine);
    this.swell = this.gain();
    (bed ? this.loop(bed) : this.noise('brown')).connect(this.filter('lowpass', bed ? 20000 : 300)).connect(this.swell).connect(this.bed);
    this.breeze = this.gain();
    this.noise('pink').connect(this.filter('bandpass', 1000, 0.5)).connect(this.breeze).connect(this.bed);
    this.unsubscribe = scene.on('break', ({ amplitude, pan }) => this.wave(amplitude, pan));
  }

  override dispose(): void {
    this.unsubscribe();
    super.dispose();
  }

  update(dt: number, env: Environment): void {
    if (!this.engine.running || this.isDisposed) return;
    this.time += dt;
    const now = this.engine.context.currentTime;
    const wind = Math.abs(env.weather.wind);
    // The distant sea breathes on a slow cycle.
    this.swell.gain.setTargetAtTime(0.5 + 0.18 * Math.sin(this.time * 0.55) + 0.3 * wind, now, 0.8);
    this.breeze.gain.setTargetAtTime(0.04 + 0.22 * wind, now, 1);

    this.gullTimer -= dt;
    if (this.gullTimer <= 0) {
      this.gullTimer = rand(10, 30);
      if (env.lighting.darkness < 0.5) this.engine.playSpatialSound('gull-cry', rand(-1, 1), rand(0.8, 1), 'ambience');
    }
  }

  /** A breaking wave: a filtered crash, then the backwash fizzing back down the sand. */
  private wave(amplitude: number, pan: number): void {
    if (!this.engine.running || this.isDisposed) return;
    const ctx = this.engine.context;
    const when = ctx.currentTime + 0.02;
    const level = Math.min(1, amplitude / 26);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.bed);

    const crash = ctx.createBufferSource();
    crash.buffer = this.engine.noise.get('pink');
    const crashFilter = ctx.createBiquadFilter();
    crashFilter.type = 'lowpass';
    crashFilter.frequency.setValueAtTime(2800, when);
    crashFilter.frequency.exponentialRampToValueAtTime(500, when + 1.8);
    const crashAmp = ctx.createGain();
    crashAmp.gain.setValueAtTime(0, when);
    crashAmp.gain.linearRampToValueAtTime(0.7 * level, when + 0.15);
    crashAmp.gain.exponentialRampToValueAtTime(0.0001, when + 2.2);
    crash.connect(crashFilter).connect(crashAmp).connect(panner);
    crash.start(when, Math.random() * 5, 2.4);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.engine.noise.get('white');
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 1800;
    const hissAmp = ctx.createGain();
    const start = when + 1.4;
    hissAmp.gain.setValueAtTime(0, start);
    hissAmp.gain.linearRampToValueAtTime(0.14 * level, start + 0.6);
    hissAmp.gain.linearRampToValueAtTime(0, start + 3.4);
    hiss.connect(hissFilter).connect(hissAmp).connect(panner);
    hiss.start(start, Math.random() * 5, 3.6);
    window.setTimeout(() => panner.disconnect(), 6000);
  }
}
