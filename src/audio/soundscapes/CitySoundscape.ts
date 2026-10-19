import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import { birdActivity, cityBusyness } from './schedules';
import { Soundscape } from './Soundscape';
import { rand } from '../../core/random';

/**
 * Landscape ambience for the downtown rooftop: a low city hum, cars passing
 * on the street below (busier at rush hour, hissing on wet roads), the odd
 * distant horn, and background birdsong by day.
 *
 * Visible birds voice themselves; the background birdsong here is the
 * occasional off-screen bird, far away. A crowd murmur rises with the
 * number of people on the street.
 */
export class CitySoundscape extends Soundscape {
  private readonly hum: GainNode;
  private readonly wash: GainNode;
  private readonly murmur: GainNode;
  private readonly murmurFilter: BiquadFilterNode;
  private carTimer = rand(1, 4);
  private hornTimer = rand(20, 60);
  private birdTimer = rand(2, 6);

  constructor(engine: AudioEngine, city?: AudioBuffer) {
    super(engine);
    // Distant voices from the street: a band of noise whose colour wanders.
    this.murmurFilter = this.filter('bandpass', 650, 1.2);
    this.murmur = this.gain();
    this.noise('pink').connect(this.murmurFilter).connect(this.murmur).connect(this.bed);

    this.hum = this.gain();
    this.wash = this.gain();
    if (city) {
      this.loop(city).connect(this.wash).connect(this.bed);
    } else {
      this.noise('brown').connect(this.filter('lowpass', 150)).connect(this.hum).connect(this.bed);
      this.noise('pink').connect(this.filter('bandpass', 480, 0.5)).connect(this.wash).connect(this.bed);
    }
  }

  update(dt: number, env: Environment, crowd = 0.5): void {
    if (!this.engine.running) return;
    const now = this.engine.context.currentTime;
    const hours = env.lighting.hours;
    const busy = cityBusyness(hours);
    const snow = env.weather.kind === 'snow' ? env.weather.precipitation : 0;
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;

    // Snow blankets the city in quiet.
    if (!this.isDisposed) this.bed.gain.setTargetAtTime(1 - 0.45 * snow, now, 1);
    this.hum.gain.setTargetAtTime(0.35 + 0.25 * busy, now, 1);
    this.wash.gain.setTargetAtTime(0.03 + 0.12 * busy, now, 1);

    this.murmur.gain.setTargetAtTime((0.02 + 0.16 * crowd) * (1 - rain * 0.6), now, 1.5);
    this.murmurFilter.frequency.setTargetAtTime(520 + Math.random() * 300, now, 0.4);

    this.carTimer -= dt;
    if (this.carTimer <= 0) {
      this.carTimer = rand(0.6, 2.2) / Math.max(0.05, busy);
      this.carPass(rain);
    }

    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = rand(25, 90) / Math.max(0.1, busy);
      if (busy > 0.3) this.engine.playSpatialSound('car-horn', rand(-1, 1), rand(0.6, 1), 'ambience');
    }

    const birds = birdActivity(hours) * (1 - Math.min(1, rain * 1.5)) * (1 - snow * 0.7);
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rand(6, 20) / Math.max(0.05, birds);
      if (birds > 0.02) {
        const roll = Math.random();
        const id: SoundId = roll < 0.6 ? 'sparrow-chirp' : roll < 0.9 ? 'pigeon-coo' : 'crow-caw';
        this.engine.playSpatialSound(id, rand(-1, 1), rand(0.75, 1));
      }
    }
  }

  /** A car passing below: a band-passed swoosh that pans across with a slight Doppler dip. */
  private carPass(wetRoad: number): void {
    const ctx = this.engine.context;
    const when = ctx.currentTime + 0.05;
    const duration = rand(2.2, 4.5);
    const direction = Math.random() < 0.5 ? -1 : 1;
    const level = rand(0.08, 0.2);

    const src = ctx.createBufferSource();
    src.buffer = this.engine.noise.get('pink');
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(650, when);
    band.frequency.linearRampToValueAtTime(900, when + duration * 0.5);
    band.frequency.linearRampToValueAtTime(520, when + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + duration * 0.5);
    amp.gain.linearRampToValueAtTime(0, when + duration);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.9 * direction, when);
    pan.pan.linearRampToValueAtTime(0.9 * direction, when + duration);
    src.connect(band).connect(amp).connect(pan).connect(this.bed);

    // Tyres on a wet road add a bright hiss.
    if (wetRoad > 0.05) {
      const hiss = ctx.createBiquadFilter();
      hiss.type = 'highpass';
      hiss.frequency.value = 2500;
      const hissAmp = ctx.createGain();
      hissAmp.gain.setValueAtTime(0, when);
      hissAmp.gain.linearRampToValueAtTime(level * 0.6 * Math.min(1, wetRoad * 2), when + duration * 0.5);
      hissAmp.gain.linearRampToValueAtTime(0, when + duration);
      src.connect(hiss).connect(hissAmp).connect(pan);
    }
    src.start(when, Math.random() * 5, duration + 0.1);
    window.setTimeout(() => pan.disconnect(), (duration + 1) * 1000);
  }
}
