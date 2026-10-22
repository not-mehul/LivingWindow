import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import type { TextureLayer } from '../textures';
import { murmur } from './nature';
import { birdActivity, cityBusyness } from './schedules';
import { Soundscape } from './Soundscape';
import { rand } from '../../core/random';

/** Speed of sound and of a car on the street below (m/s), for the Doppler glide. */
const SOUND_SPEED = 343;
const CAR_SPEED = 13;

/**
 * Landscape ambience for the downtown rooftop, heard from high up: the far,
 * soft rumble of traffic across the whole city, cars passing on the street
 * below (busier at rush hour, hissing on wet roads), the murmur of people
 * when the street fills, a rare soft horn and, very rarely, a siren many
 * streets away. Background birds by day.
 */
export class CitySoundscape extends Soundscape {
  private readonly rumble: GainNode;
  private readonly traffic: GainNode;
  private readonly recorded: GainNode | null = null;
  private readonly murmur: TextureLayer;
  private carTimer = rand(1, 4);
  private hornTimer = rand(60, 150);
  private sirenTimer = rand(500, 1200);
  private birdTimer = rand(2, 6);

  constructor(engine: AudioEngine, city?: AudioBuffer) {
    super(engine);
    this.rumble = this.gain();
    this.traffic = this.gain();
    if (city) {
      this.recorded = this.gain();
      this.loop(city).connect(this.recorded).connect(this.bed);
    } else {
      // The whole city's traffic, far off: a deep rumble and a softer, wider roar.
      this.noise('brown').connect(this.filter('lowpass', 140, 0.5)).connect(this.flutter(0.2, 0.08)).connect(this.rumble).connect(this.bed);
      this.noise('pink').connect(this.filter('bandpass', 420, 0.5)).connect(this.flutter(0.3, 0.12)).connect(this.traffic).connect(this.bed);
    }
    this.murmur = this.texture(murmur());
  }

  update(dt: number, env: Environment, crowd = 0.5): void {
    if (!this.engine.running || this.isDisposed) return;
    const now = this.engine.context.currentTime;
    const hours = env.lighting.hours;
    const busy = cityBusyness(hours);
    const snow = env.weather.kind === 'snow' ? env.weather.precipitation : 0;
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;

    // Snow blankets the city in quiet.
    this.bed.gain.setTargetAtTime(1 - 0.45 * snow, now, 2);
    this.rumble.gain.setTargetAtTime(0.1 + 0.08 * busy, now, 3);
    this.traffic.gain.setTargetAtTime(0.012 + 0.03 * busy + 0.02 * rain, now, 3);
    this.recorded?.gain.setTargetAtTime(0.5 + 0.35 * busy, now, 3);
    this.murmur.set((0.04 + 0.3 * crowd) * (1 - rain * 0.7) * (1 - snow * 0.5), 2);

    this.carTimer -= dt;
    if (this.carTimer <= 0) {
      this.carTimer = rand(2.5, 7) / Math.max(0.08, busy);
      this.carPass(rain);
    }

    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = rand(90, 240) / Math.max(0.1, busy);
      if (busy > 0.4) this.engine.playSpatialSound('car-horn', rand(-1, 1), rand(0.7, 1), 'ambience');
    }

    this.sirenTimer -= dt;
    if (this.sirenTimer <= 0) {
      this.sirenTimer = rand(700, 1600);
      this.engine.playSpatialSound('siren-far', rand(-1, 1), 1, 'ambience');
    }

    const birds = birdActivity(env.lighting.solarHours) * (1 - Math.min(1, rain * 1.5)) * (1 - snow * 0.7);
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rand(10, 28) / Math.max(0.05, birds);
      if (birds > 0.02) {
        const roll = Math.random();
        const id: SoundId = roll < 0.6 ? 'sparrow-chirp' : roll < 0.9 ? 'pigeon-coo' : 'crow-caw';
        this.engine.playSpatialSound(id, rand(-1, 1), rand(0.75, 1), 'ambience');
      }
    }
  }

  /**
   * A car passing on the street below: tyres on the road and a low engine
   * (or the faint whine of an electric one), swelling as it nears and
   * panning across, its pitch gliding down as it goes by.
   */
  private carPass(wetRoad: number): void {
    const ctx = this.engine.context;
    const when = ctx.currentTime + 0.05;
    const duration = rand(3, 5.5);
    const mid = when + duration * rand(0.42, 0.58);
    const direction = Math.random() < 0.5 ? -1 : 1;
    const far = Math.random() < 0.5;
    const level = rand(0.05, 0.11) * (far ? 0.6 : 1);
    const up = SOUND_SPEED / (SOUND_SPEED - CAR_SPEED);
    const down = SOUND_SPEED / (SOUND_SPEED + CAR_SPEED);
    // Most of the glide happens in the moment it passes.
    const glide = (param: AudioParam, base: number) => {
      param.setValueAtTime(base * up, when);
      param.setTargetAtTime(base * down, mid - 0.15, 0.25);
    };

    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.85 * direction, when);
    pan.pan.linearRampToValueAtTime(0.85 * direction, when + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.setTargetAtTime(level, when, duration * 0.18);
    amp.gain.setTargetAtTime(0, mid + 0.2, duration * 0.14);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = far ? 1800 : 3500;
    amp.connect(air).connect(pan).connect(this.bed);

    // Tyres: a band of noise, brighter and louder on a wet road.
    const tyres = ctx.createBufferSource();
    tyres.buffer = this.engine.noise.get('pink');
    // The noise loops seamlessly, so a long sound started late in it never cuts out.
    tyres.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.7;
    glide(band.frequency, 700 + 900 * wetRoad);
    const tyreAmp = ctx.createGain();
    tyreAmp.gain.value = 1 + 1.2 * wetRoad;
    tyres.connect(band).connect(tyreAmp).connect(amp);
    tyres.start(when, Math.random() * 8, duration + 0.2);

    const sources: AudioScheduledSourceNode[] = [tyres];
    if (Math.random() < 0.45) {
      // An electric car: just a faint, rising-then-falling whine.
      const whine = ctx.createOscillator();
      glide(whine.frequency, rand(380, 620));
      const whineAmp = ctx.createGain();
      whineAmp.gain.value = 0.05;
      whine.connect(whineAmp).connect(amp);
      sources.push(whine);
    } else {
      // A combustion engine: a low, buzzy firing note, kept soft and muffled.
      const engine = ctx.createOscillator();
      engine.type = 'sawtooth';
      glide(engine.frequency, rand(42, 70));
      const muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 320;
      const engineAmp = ctx.createGain();
      engineAmp.gain.value = 0.35;
      engine.connect(muffle).connect(engineAmp).connect(amp);
      sources.push(engine);
    }
    for (const s of sources.slice(1)) {
      s.start(when);
      s.stop(when + duration + 0.2);
    }
    window.setTimeout(() => pan.disconnect(), (duration + 1) * 1000);
  }
}
