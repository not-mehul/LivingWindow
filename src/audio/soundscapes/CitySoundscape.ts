import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { SoundId } from '../sounds/SoundBank';
import { birdActivity, cityBusyness } from './schedules';

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Landscape ambience for the downtown rooftop: a low city hum, cars passing
 * on the street below (busier at rush hour, hissing on wet roads), the odd
 * distant horn, and background birdsong by day.
 *
 * Background birds are a placeholder until the bird state machine (Step 4)
 * voices its own visible birds through `playSpatialSound`.
 */
export class CitySoundscape {
  private readonly bed: GainNode;
  private readonly hum: GainNode;
  private readonly wash: GainNode;
  private carTimer = rand(1, 4);
  private hornTimer = rand(20, 60);
  private birdTimer = rand(2, 6);

  constructor(
    private readonly engine: AudioEngine,
    city?: AudioBuffer,
  ) {
    const ctx = engine.context;
    this.bed = ctx.createGain();
    this.bed.connect(engine.inputs.ambience);

    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    this.wash = ctx.createGain();
    this.wash.gain.value = 0;
    if (city) {
      const src = ctx.createBufferSource();
      src.buffer = city;
      src.loop = true;
      src.start(0, Math.random() * city.duration);
      src.connect(this.wash).connect(this.bed);
    } else {
      const humFilter = ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 150;
      engine.noise.source('brown').connect(humFilter).connect(this.hum).connect(this.bed);
      const washFilter = ctx.createBiquadFilter();
      washFilter.type = 'bandpass';
      washFilter.frequency.value = 480;
      washFilter.Q.value = 0.5;
      engine.noise.source('pink').connect(washFilter).connect(this.wash).connect(this.bed);
    }
  }

  update(dt: number, env: Environment): void {
    if (!this.engine.running) return;
    const now = this.engine.context.currentTime;
    const hours = env.lighting.hours;
    const busy = cityBusyness(hours);
    const snow = env.weather.kind === 'snow' ? env.weather.precipitation : 0;
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;

    // Snow blankets the city in quiet.
    this.bed.gain.setTargetAtTime(1 - 0.45 * snow, now, 1);
    this.hum.gain.setTargetAtTime(0.35 + 0.25 * busy, now, 1);
    this.wash.gain.setTargetAtTime(0.03 + 0.12 * busy, now, 1);

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
      this.birdTimer = rand(1.5, 6) / Math.max(0.05, birds);
      if (birds > 0.02) {
        const roll = Math.random();
        const id: SoundId = roll < 0.6 ? 'sparrow-chirp' : roll < 0.9 ? 'pigeon-coo' : 'crow-caw';
        this.engine.playSpatialSound(id, rand(-1, 1), rand(0.35, 0.9));
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
