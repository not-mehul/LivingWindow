import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import { Crickets } from './nature';
import { birdActivity } from './schedules';
import { Soundscape } from './Soundscape';

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The meadows: a babbling stream, grass hissing in the breeze, songbirds out
 * of sight by day and a chorus of crickets at night.
 */
export class MeadowSoundscape extends Soundscape {
  private readonly stream: GainNode;
  private readonly streamBand: BiquadFilterNode;
  private readonly gurgle: GainNode;
  private readonly grass: GainNode;
  private readonly crickets: Crickets;
  private callTimer = rand(4, 10);

  constructor(engine: AudioEngine, bed?: AudioBuffer) {
    super(engine);
    this.streamBand = this.filter('bandpass', 1800, 0.8);
    this.stream = this.gain();
    (bed ? this.loop(bed) : this.noise('white')).connect(this.streamBand).connect(this.stream).connect(this.bed);
    this.gurgle = this.gain();
    this.noise('pink').connect(this.filter('bandpass', 420, 3)).connect(this.gurgle).connect(this.bed);
    this.grass = this.gain();
    this.noise('pink').connect(this.filter('highpass', 3000)).connect(this.grass).connect(this.bed);
    this.crickets = new Crickets(engine, this.bed, 7);
  }

  update(dt: number, env: Environment): void {
    if (!this.engine.running || this.isDisposed) return;
    const now = this.engine.context.currentTime;
    const wind = Math.abs(env.weather.wind);
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;
    // Babble: the stream's level and colour flicker constantly.
    this.stream.gain.setTargetAtTime(0.09 * (0.6 + Math.random() * 0.8), now, 0.04);
    this.streamBand.frequency.setTargetAtTime(1400 + Math.random() * 1400, now, 0.05);
    this.gurgle.gain.setTargetAtTime(0.1 * (0.4 + Math.random()), now, 0.06);
    this.grass.gain.setTargetAtTime((0.01 + 0.08 * wind) * (0.6 + Math.random() * 0.6), now, 0.1);

    this.callTimer -= dt;
    if (this.callTimer <= 0) {
      const birds = birdActivity(env.lighting.hours) * (1 - Math.min(1, rain * 1.5));
      this.callTimer = rand(5, 15) / Math.max(0.1, birds);
      if (birds > 0.05) {
        const calls: SoundId[] = ['robin-song', 'finch-song', 'bluebird-song', 'sparrow-chirp'];
        this.engine.playSpatialSound(calls[Math.floor(Math.random() * calls.length)], rand(-1, 1), rand(0.8, 1), 'ambience');
      } else if (env.lighting.darkness > 0.7 && Math.random() < 0.25) {
        this.engine.playSpatialSound('owl-hoot', rand(-1, 1), 0.95, 'ambience');
      }
    }
    this.crickets.update(dt, env.lighting.darkness > 0.55 ? (1 - rain) : 0);
  }
}
