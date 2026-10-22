import type { BeachScene } from '../../scene/beach/BeachScene';
import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { TextureLayer } from '../textures';
import { crickets, foam, shingle } from './nature';
import { nightInsects } from './schedules';
import { Soundscape } from './Soundscape';
import { rand } from '../../core/random';

/**
 * The shore: the low, breathing roar of the open sea, and every breaking
 * wave in layers: the curl crashing over with a deep thump, foam fizzing as
 * it spreads up the sand, then the backwash dragging back down through the
 * shingle. A coastal breeze and far-off gulls by day; after dark, crickets
 * in the dunes and the surf a little hushed.
 */
export class BeachSoundscape extends Soundscape {
  private readonly surf: GainNode;
  private readonly surfHiss: GainNode;
  private readonly foam: TextureLayer;
  private readonly shingle: TextureLayer;
  private readonly unsubscribe: () => void;
  private readonly crickets: TextureLayer;
  /** How dark it is (the night surf sounds softer). */
  private darkness = 0;
  private gullTimer = rand(8, 20);

  constructor(engine: AudioEngine, scene: BeachScene, bed?: AudioBuffer) {
    super(engine);
    this.surf = this.gain();
    if (bed) this.loop(bed).connect(this.surf).connect(this.bed);
    else this.noise('brown').connect(this.filter('lowpass', 360, 0.5)).connect(this.flutter(0.3, 0.1)).connect(this.surf).connect(this.bed);
    // The far line of breakers: a soft hiss along the whole horizon.
    this.surfHiss = this.gain();
    this.noise('pink').connect(this.filter('bandpass', 1100, 0.4)).connect(this.flutter(0.35, 0.12)).connect(this.surfHiss).connect(this.bed);
    this.foam = this.texture(foam());
    this.shingle = this.texture(shingle());
    this.crickets = this.texture(crickets(4));
    this.unsubscribe = scene.on('break', ({ amplitude, pan }) => this.wave(amplitude, pan));
  }

  override dispose(): void {
    this.unsubscribe();
    super.dispose();
  }

  update(_dt: number, env: Environment): void {
    if (!this.engine.running || this.isDisposed) return;
    const now = this.engine.context.currentTime;
    const wind = Math.abs(env.weather.wind);
    this.surf.gain.setTargetAtTime((0.2 + 0.15 * wind) * (1 - this.darkness * 0.25), now, 2);
    this.surfHiss.gain.setTargetAtTime(0.07 + 0.05 * wind, now, 2);
    this.darkness = env.lighting.darkness;
    const rain = env.weather.kind === 'rain' ? Math.min(1, env.weather.precipitation * 2) : 0;
    this.crickets.set(0.16 * nightInsects(env.lighting.darkness) * (1 - rain) * (1 - wind), 4);

    this.gullTimer -= _dt;
    if (this.gullTimer <= 0) {
      this.gullTimer = rand(12, 40);
      if (env.lighting.darkness < 0.5) this.engine.playSpatialSound('gull-cry', rand(-1, 1), rand(0.8, 1), 'ambience');
    }
  }

  /** A breaking wave, in layers: crash and thump, the foam's fizz, then the backwash. */
  private wave(amplitude: number, pan: number): void {
    if (!this.engine.running || this.isDisposed) return;
    const ctx = this.engine.context;
    const when = ctx.currentTime + 0.02;
    const size = Math.min(1, amplitude / 26);
    const level = size * (1 - this.darkness * 0.35);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.bed);

    // The curl falling over: a roar that surges up, then darkens and draws out as it
    // spends itself (after a recording: a rise of most of a second, a long fall).
    const crash = ctx.createBufferSource();
    crash.buffer = this.engine.noise.get('pink');
    // The noise loops seamlessly, so a long sound started late in it never cuts out.
    crash.loop = true;
    const crashFilter = ctx.createBiquadFilter();
    crashFilter.type = 'lowpass';
    crashFilter.Q.value = 0.5;
    crashFilter.frequency.setValueAtTime(700, when);
    crashFilter.frequency.linearRampToValueAtTime(1600 + 2400 * size, when + 0.7);
    crashFilter.frequency.exponentialRampToValueAtTime(450, when + 4);
    const crashAmp = ctx.createGain();
    crashAmp.gain.setValueAtTime(0, when);
    crashAmp.gain.setTargetAtTime(0.75 * level, when, 0.25);
    crashAmp.gain.setTargetAtTime(0, when + 0.8, 1.1);
    crash.connect(crashFilter).connect(crashAmp).connect(panner);
    crash.start(when, Math.random() * 8, 6);

    // The weight of water landing: a low thump under the crash.
    const thump = ctx.createBufferSource();
    thump.buffer = this.engine.noise.get('brown');
    // The noise loops seamlessly, so a long sound started late in it never cuts out.
    thump.loop = true;
    const thumpFilter = ctx.createBiquadFilter();
    thumpFilter.type = 'lowpass';
    thumpFilter.frequency.value = 160;
    const thumpAmp = ctx.createGain();
    thumpAmp.gain.setValueAtTime(0, when + 0.2);
    thumpAmp.gain.linearRampToValueAtTime(0.4 * level * size, when + 0.55);
    thumpAmp.gain.setTargetAtTime(0, when + 0.6, 0.45);
    thump.connect(thumpFilter).connect(thumpAmp).connect(panner);
    thump.start(when, Math.random() * 8, 2);

    // Foam spreading up the sand, then the backwash rattling back down.
    swell(this.foam.gain.gain, when + 0.6, 0.7 * level, 1, 1.6);
    swell(this.shingle.gain.gain, when + 2.4, 0.5 * level, 1.2, 1.4);
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.engine.noise.get('white');
    // The noise loops seamlessly, so a long sound started late in it never cuts out.
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.Q.value = 0.6;
    const start = when + 2.2;
    hissFilter.frequency.setValueAtTime(3200, start);
    hissFilter.frequency.exponentialRampToValueAtTime(1200, start + 3);
    const hissAmp = ctx.createGain();
    hissAmp.gain.setValueAtTime(0, start);
    hissAmp.gain.linearRampToValueAtTime(0.12 * level, start + 0.8);
    hissAmp.gain.linearRampToValueAtTime(0, start + 3.2);
    hiss.connect(hissFilter).connect(hissAmp).connect(panner);
    hiss.start(start, Math.random() * 8, 3.4);
    window.setTimeout(() => panner.disconnect(), 8000);
  }
}

/** Raise a texture's level to `peak` over `rise` s from `when`, then let it ease away. */
function swell(param: AudioParam, when: number, peak: number, rise: number, fall: number): void {
  // A newer wave takes over from wherever the last one's swell has got to.
  param.cancelScheduledValues(when);
  param.setTargetAtTime(peak, when, rise / 3);
  param.setTargetAtTime(0, when + rise, fall);
}
