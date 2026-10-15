import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import { Crickets } from './nature';
import { birdActivity } from './schedules';
import { Soundscape } from './Soundscape';

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The deep forest: wind through the canopy, leaves rustling with every
 * gust, trunks creaking, calls echoing from birds out of sight, and
 * crickets after dark.
 */
export class ForestSoundscape extends Soundscape {
  private readonly windGain: GainNode;
  private readonly windBand: BiquadFilterNode;
  private readonly rustle: GainNode;
  private readonly crickets: Crickets;
  private creakTimer = rand(6, 20);
  private callTimer = rand(4, 10);

  constructor(engine: AudioEngine, bed?: AudioBuffer) {
    super(engine);
    this.windBand = this.filter('bandpass', 450, 0.5);
    this.windGain = this.gain();
    (bed ? this.loop(bed) : this.noise('pink')).connect(this.windBand).connect(this.windGain).connect(this.bed);
    this.rustle = this.gain();
    this.noise('white').connect(this.filter('highpass', 2600)).connect(this.rustle).connect(this.bed);
    this.crickets = new Crickets(engine, this.bed, 5);
  }

  update(dt: number, env: Environment): void {
    if (!this.engine.running || this.isDisposed) return;
    const now = this.engine.context.currentTime;
    const wind = Math.abs(env.weather.wind);
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;
    this.windGain.gain.setTargetAtTime(0.06 + 0.4 * wind, now, 0.8);
    this.windBand.frequency.setTargetAtTime(320 + 700 * wind, now, 0.8);
    // Leaves flutter: a level that jitters with the gusts.
    this.rustle.gain.setTargetAtTime((0.015 + 0.14 * wind) * (0.4 + Math.random() * 0.9), now, 0.05);

    this.creakTimer -= dt;
    if (this.creakTimer <= 0) {
      this.creakTimer = rand(8, 30) / (0.3 + wind);
      this.creak(0.3 + wind);
    }

    this.callTimer -= dt;
    if (this.callTimer <= 0) {
      const birds = birdActivity(env.lighting.hours) * (1 - Math.min(1, rain * 1.5));
      this.callTimer = rand(6, 18) / Math.max(0.1, birds);
      if (birds > 0.05) {
        const calls: SoundId[] = ['chickadee-call', 'jay-call', 'woodpecker-drum', 'robin-song'];
        this.engine.playSpatialSound(calls[Math.floor(Math.random() * calls.length)], rand(-1, 1), rand(0.8, 1), 'ambience');
      } else if (env.lighting.darkness > 0.7 && Math.random() < 0.3) {
        this.engine.playSpatialSound('owl-hoot', rand(-1, 1), 0.95, 'ambience');
      }
    }

    this.crickets.update(dt, env.lighting.darkness > 0.6 ? (1 - rain) * 0.8 : 0);
  }

  /** A trunk groaning in the wind: a slow, resonant, falling tone. */
  private creak(strength: number): void {
    const ctx = this.engine.context;
    const when = ctx.currentTime + 0.05;
    const length = rand(1.2, 2.6);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(rand(70, 95), when);
    osc.frequency.linearRampToValueAtTime(rand(48, 62), when + length);
    const resonance = ctx.createBiquadFilter();
    resonance.type = 'lowpass';
    resonance.frequency.setValueAtTime(rand(380, 520), when);
    resonance.Q.value = 9;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(0.05 * Math.min(1.2, strength), when + length * 0.3);
    amp.gain.linearRampToValueAtTime(0, when + length);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    osc.connect(resonance).connect(amp).connect(pan).connect(this.bed);
    osc.start(when);
    osc.stop(when + length + 0.1);
  }
}
