import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import type { TextureLayer } from '../textures';
import { crickets, distantBirds, katydids, trill } from './nature';
import { birdActivity, dawnChorus, nightInsects } from './schedules';
import { Soundscape } from './Soundscape';
import { rand } from '../../core/random';

/**
 * The deep forest: the canopy's low roar and the bright shimmer of leaves,
 * both swelling with each gust; trunks creaking; calls echoing from birds
 * out of sight and a wash of far-off song at dawn; after dark, crickets, the
 * rasp of katydids and the soft endless trill of tree crickets.
 */
export class ForestSoundscape extends Soundscape {
  private readonly roar: GainNode;
  private readonly roarBand: BiquadFilterNode;
  private readonly leaves: GainNode;
  private readonly chorus: TextureLayer;
  private readonly crickets: TextureLayer;
  private readonly katydids: TextureLayer;
  private readonly trill: TextureLayer;
  private creakTimer = rand(6, 20);
  private callTimer = rand(4, 10);

  constructor(engine: AudioEngine, bed?: AudioBuffer) {
    super(engine);
    if (bed) this.loop(bed).connect(this.gain(0.85)).connect(this.bed);
    // The canopy: a low roar of the whole wood, and leaves fluttering high up.
    this.roarBand = this.filter('bandpass', 380, 0.5);
    this.roar = this.gain();
    this.noise('pink').connect(this.roarBand).connect(this.flutter(0.35, 0.15)).connect(this.roar).connect(this.bed);
    this.leaves = this.gain();
    this.noise('white').connect(this.filter('bandpass', 4200, 0.6)).connect(this.flutter(0.6, 2)).connect(this.leaves).connect(this.bed);
    this.chorus = this.texture(distantBirds());
    this.crickets = this.texture(crickets(6));
    this.katydids = this.texture(katydids(3));
    this.trill = this.texture(trill());
  }

  update(dt: number, env: Environment): void {
    if (!this.engine.running || this.isDisposed) return;
    const now = this.engine.context.currentTime;
    const hours = env.lighting.hours;
    const wind = Math.abs(env.weather.wind);
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;
    const snow = env.weather.kind === 'snow' ? env.weather.precipitation : 0;
    const quiet = (1 - Math.min(1, rain * 1.6)) * (1 - snow);

    this.roar.gain.setTargetAtTime(0.04 + 0.3 * wind ** 1.3, now, 1);
    this.roarBand.frequency.setTargetAtTime(300 + 500 * wind, now, 1.5);
    this.leaves.gain.setTargetAtTime((0.004 + 0.05 * wind ** 1.5) * (1 - snow * 0.8), now, 0.8);

    const night = nightInsects(env.lighting.darkness) * quiet;
    this.chorus.set(0.2 * dawnChorus(hours) * quiet, 4);
    this.crickets.set(0.22 * night, 4);
    this.katydids.set(0.14 * night, 5);
    this.trill.set(0.05 * night, 6);

    this.creakTimer -= dt;
    if (this.creakTimer <= 0) {
      this.creakTimer = rand(10, 35) / (0.3 + wind);
      if (wind > 0.15) this.engine.playSpatialSound('wood-creak', rand(-0.9, 0.9), rand(0.2, 0.7), 'ambience');
    }

    this.callTimer -= dt;
    if (this.callTimer <= 0) {
      const birds = birdActivity(hours) * quiet;
      this.callTimer = rand(8, 24) / Math.max(0.1, birds);
      if (birds > 0.05) {
        const calls: SoundId[] = ['chickadee-call', 'jay-call', 'woodpecker-drum', 'robin-song'];
        this.engine.playSpatialSound(calls[Math.floor(Math.random() * calls.length)], rand(-1, 1), rand(0.75, 1), 'ambience');
      } else if (env.lighting.darkness > 0.7 && Math.random() < 0.3) {
        this.engine.playSpatialSound('owl-hoot', rand(-1, 1), 0.95, 'ambience');
      }
    }
  }
}
