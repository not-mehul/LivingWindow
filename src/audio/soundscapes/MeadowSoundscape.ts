import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import type { TextureLayer } from '../textures';
import { creek, crickets, distantBirds, frogs, grasshoppers } from './nature';
import { birdActivity, dawnChorus, dayInsects, frogChorus, nightInsects } from './schedules';
import { Soundscape } from './Soundscape';
import { rand } from '../../core/random';

/**
 * The meadows: a babbling creek over the stones, grass hissing in the
 * gusts, grasshoppers and the odd bee in the warm middle of the day,
 * songbirds out of sight and a wash of far-off birdsong at dawn; frogs by
 * the water at dusk and a field of crickets through the night.
 */
export class MeadowSoundscape extends Soundscape {
  private readonly grass: GainNode;
  private readonly trickle: GainNode | null = null;
  private readonly bubbles: TextureLayer | null = null;
  private readonly recorded: GainNode | null = null;
  private readonly hoppers: TextureLayer;
  private readonly frogs: TextureLayer;
  private readonly crickets: TextureLayer;
  private readonly chorus: TextureLayer;
  private callTimer = rand(4, 10);
  private beeTimer = rand(20, 50);

  constructor(engine: AudioEngine, bed?: AudioBuffer) {
    super(engine);
    if (bed) {
      // A recording of the place stands in for the synthesized creek.
      this.recorded = this.gain(0.85);
      this.loop(bed).connect(this.recorded).connect(this.bed);
    } else {
      // The creek: a low run of water with bubbles of every size over the stones.
      this.trickle = this.gain(0.05);
      this.noise('pink').connect(this.filter('bandpass', 650, 0.6)).connect(this.flutter(0.3, 0.6)).connect(this.trickle).connect(this.bed);
      this.bubbles = this.texture(creek());
      this.bubbles.set(0.32, 2);
    }
    this.grass = this.gain();
    this.noise('pink').connect(this.filter('highpass', 2800)).connect(this.flutter(0.5, 1.4)).connect(this.grass).connect(this.bed);
    this.hoppers = this.texture(grasshoppers());
    this.frogs = this.texture(frogs(6));
    this.crickets = this.texture(crickets(9));
    this.chorus = this.texture(distantBirds());
  }

  update(dt: number, env: Environment): void {
    if (!this.engine.running || this.isDisposed) return;
    const now = this.engine.context.currentTime;
    // Nature keeps the sun's time.
    const hours = env.lighting.solarHours;
    const wind = Math.abs(env.weather.wind);
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;
    const snow = env.weather.kind === 'snow' ? env.weather.precipitation : 0;
    const quiet = (1 - Math.min(1, rain * 1.6)) * (1 - snow);

    this.grass.gain.setTargetAtTime(0.008 + 0.05 * wind ** 1.3, now, 1.2);
    // A creek running full after rain.
    this.trickle?.gain.setTargetAtTime(0.05 + 0.04 * rain, now, 5);
    this.bubbles?.set(0.32 + 0.12 * rain, 5);
    this.hoppers.set(0.22 * dayInsects(hours) * quiet * (1 - wind * 0.6), 3);
    this.frogs.set(0.26 * frogChorus(hours) * (1 - snow), 4);
    this.crickets.set(0.24 * nightInsects(env.lighting.darkness) * quiet, 4);
    this.chorus.set(0.16 * dawnChorus(hours) * quiet, 4);

    this.callTimer -= dt;
    if (this.callTimer <= 0) {
      const birds = birdActivity(hours) * quiet;
      this.callTimer = rand(8, 22) / Math.max(0.1, birds);
      if (birds > 0.05) {
        const calls: SoundId[] = ['robin-song', 'finch-song', 'bluebird-song', 'sparrow-chirp'];
        this.engine.playSpatialSound(calls[Math.floor(Math.random() * calls.length)], rand(-1, 1), rand(0.75, 1), 'ambience');
      } else if (env.lighting.darkness > 0.7 && Math.random() < 0.25) {
        this.engine.playSpatialSound('owl-hoot', rand(-1, 1), 0.95, 'ambience');
      }
    }

    this.beeTimer -= dt;
    if (this.beeTimer <= 0) {
      this.beeTimer = rand(30, 90);
      if (dayInsects(hours) > 0.5 && quiet > 0.9 && wind < 0.5) this.engine.playSpatialSound('bee-buzz', rand(-0.8, 0.8), rand(0.15, 0.4), 'ambience');
    }
  }
}
