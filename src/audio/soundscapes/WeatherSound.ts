import type { Environment } from '../../scene/Environment';
import type { AcousticsId } from '../acoustics';
import type { AudioEngine } from '../AudioEngine';
import { GLASS, GRASS, LEAVES, rainOn, runoff, SAND, sampled, scattered, STREET, TextureLayer, type Surface } from '../textures';
import { thunderParams } from '../spatial';
import { rand } from '../../core/random';

/** Optional recorded loops / one-shots that replace the synthesized weather. */
export interface WeatherRecordings {
  rain?: AudioBuffer;
  wind?: AudioBuffer;
  thunder?: AudioBuffer[];
}

/** What the rain lands on, per landscape. */
const SURFACES: Record<AcousticsId, Surface> = {
  city: STREET,
  forest: LEAVES,
  meadows: GRASS,
  beach: SAND,
};

/** Drops per second in the light patter and the heavy downpour layers. */
const PATTER_DENSITY = 45;
const DOWNPOUR_DENSITY = 220;

/**
 * Weather audio:
 * - rain as a distant wash plus seamless drop textures for whatever it falls
 *   on (leaves, grass, streets, sand), light patter rising into a downpour;
 * - rain striking the glass and running down it, heard indoors with the
 *   window shut;
 * - wind that follows the weather's gusts, with a whistle in strong ones;
 * - thunder after each flash, delayed by distance, rolling around the sky;
 * - snow: a deep hush over everything outside.
 */
export class WeatherSound {
  private readonly wash: GainNode;
  private readonly washFilter: BiquadFilterNode;
  private readonly sizzle: GainNode;
  private readonly snowHush: GainNode;
  private readonly wind: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly windPan: StereoPannerNode;
  private readonly whistle: GainNode;
  private readonly whistleFilter: BiquadFilterNode;
  private readonly glass: TextureLayer;
  private readonly trickle: TextureLayer;
  private surface: AcousticsId | null = null;
  private patter: TextureLayer | null = null;
  private downpour: TextureLayer | null = null;
  private rain = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly recordings: WeatherRecordings = {},
  ) {
    const ctx = engine.context;
    const out = engine.inputs.weather;
    const mod = engine.modulators;
    const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = q;
      return f;
    };

    // Rain far and wide: a soft roar that swells and eases on its own.
    this.washFilter = filter('lowpass', 1400, 0.5);
    this.wash = this.silentGain();
    const washSource = recordings.rain ? this.loop(recordings.rain) : engine.noise.source('pink');
    washSource
      .connect(filter('highpass', recordings.rain ? 20 : 180))
      .connect(this.washFilter)
      .connect(mod.flutter(0.18, 0.15))
      .connect(this.wash)
      .connect(out);
    // The fine sizzle of countless drops close by.
    this.sizzle = this.silentGain();
    engine.noise.source('white').connect(filter('bandpass', 6500, 0.4)).connect(mod.flutter(0.3, 0.6)).connect(this.sizzle).connect(out);

    // Falling snow is nearly silent: just a soft, dampened hush.
    this.snowHush = this.silentGain();
    engine.noise.source('pink').connect(filter('bandpass', 700, 0.5)).connect(mod.flutter(0.3, 0.1)).connect(this.snowHush).connect(out);

    // Wind: band-passed noise that brightens and swells with the gusts; on
    // top, a slow wander in colour and strength of its own.
    this.windFilter = filter('bandpass', 300, 0.55);
    mod.wander(this.windFilter.detune, 450, 0.2);
    this.windPan = ctx.createStereoPanner();
    mod.wander(this.windPan.pan, 0.25, 0.08);
    this.wind = this.silentGain();
    const windSource = recordings.wind ? this.loop(recordings.wind) : engine.noise.source('brown');
    windSource.connect(this.windFilter).connect(mod.flutter(0.35, 0.18)).connect(this.wind).connect(this.windPan).connect(out);
    // A thin whistle that only appears in strong wind.
    this.whistleFilter = filter('bandpass', 700, 16);
    mod.wander(this.whistleFilter.detune, 300, 0.35);
    this.whistle = this.silentGain();
    engine.noise.source('white').connect(this.whistleFilter).connect(mod.flutter(0.6, 0.3)).connect(this.whistle).connect(this.windPan);

    // On the pane itself: drops, and water running down.
    // Recorded glass taps, if the manifest lists any, are scattered into the same texture.
    const taps = engine.sounds.samplesOf('glass-tap');
    this.glass = new TextureLayer(ctx, engine.inputs.glass, taps.length > 0 ? sampled(60, taps) : rainOn(60, GLASS, 0.85), 31);
    this.trickle = new TextureLayer(ctx, engine.inputs.glass, scattered(7, runoff, 0.7), 47);
  }

  /** Change what the rain falls on (when the landscape changes). */
  setSurface(id: AcousticsId): void {
    if (id === this.surface) return;
    this.surface = id;
    const ctx = this.engine.context;
    for (const old of [this.patter, this.downpour]) {
      if (!old) continue;
      old.set(0, 0.3);
      window.setTimeout(() => old.stop(), 2000);
    }
    const surface = SURFACES[id];
    const out = this.engine.inputs.weather;
    this.patter = new TextureLayer(ctx, out, rainOn(PATTER_DENSITY, surface), 11 + id.length);
    this.downpour = new TextureLayer(ctx, out, rainOn(DOWNPOUR_DENSITY, surface), 23 + id.length);
    this.applyRain(this.rain, 0.5);
  }

  update(_dt: number, env: Environment, glassExposure: number): void {
    if (!this.engine.running) return;
    const { weather } = env;
    const now = this.engine.context.currentTime;
    const smooth = (param: AudioParam, value: number, tau = 0.6) => param.setTargetAtTime(value, now, tau);

    this.rain = weather.kind === 'rain' ? weather.precipitation : 0;
    const snow = weather.kind === 'snow' ? weather.precipitation : 0;
    this.applyRain(this.rain);
    smooth(this.washFilter.frequency, 900 + 2600 * this.rain, 1.5);
    smooth(this.snowHush.gain, 0.035 * snow, 2);
    this.engine.setHush(snow);

    const wind = Math.abs(weather.wind);
    smooth(this.wind.gain, 0.4 * wind ** 1.5 + 0.012, 0.8);
    smooth(this.windFilter.frequency, 200 + 650 * wind, 0.9);
    smooth(this.windPan.pan, Math.max(-0.5, Math.min(0.5, weather.wind * 0.5)), 2);
    smooth(this.whistle.gain, 0.05 * Math.max(0, wind - 0.6) ** 1.2, 1);
    smooth(this.whistleFilter.frequency, 650 + 500 * wind, 1.2);

    // The pane only gets wet where it faces the rain, and is only heard shut.
    const onGlass = this.rain * glassExposure;
    this.glass.set(0.9 * onGlass ** 0.6, 0.5);
    this.trickle.set(0.35 * Math.min(1, Math.max(0, onGlass - 0.1) * 2), 2);
  }

  private applyRain(rain: number, tau = 1.2): void {
    const now = this.engine.context.currentTime;
    this.wash.gain.setTargetAtTime(0.3 * rain ** 0.8, now, tau);
    this.sizzle.gain.setTargetAtTime(0.018 * rain ** 1.3, now, tau);
    this.patter?.set(0.6 * Math.min(1, rain * 2.2) ** 0.8, tau);
    this.downpour?.set(0.75 * Math.max(0, (rain - 0.35) / 0.65) ** 1.2, tau);
  }

  /**
   * Thunder after a flash, delayed by its distance. A strike is many
   * stretches of lightning at different distances, so the rumble is built
   * from overlapping bursts, each further one later, duller and softer,
   * rolling across the sky; close strikes open with a tearing crack.
   */
  thunder(intensity: number, distance: number, pan: number): void {
    if (!this.engine.running) return;
    const ctx = this.engine.context;
    const p = thunderParams(intensity, distance);
    const when = ctx.currentTime + p.delay;

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.engine.inputs.weather);
    const send = ctx.createGain();
    send.gain.value = 0.35 + 0.5 * distance;
    out.connect(send).connect(this.engine.sends.weather);

    const recorded = this.recordings.thunder;
    if (recorded && recorded.length > 0) {
      const src = ctx.createBufferSource();
      src.buffer = recorded[Math.floor(Math.random() * recorded.length)];
      src.playbackRate.value = rand(0.92, 1.08);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = p.cutoff * 4;
      const amp = ctx.createGain();
      amp.gain.value = p.gain;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan * 0.8;
      src.connect(lowpass).connect(amp).connect(panner).connect(out);
      src.start(when);
      window.setTimeout(() => out.disconnect(), (p.delay + src.buffer.duration + 4) * 1000);
      return;
    }

    // The rolling rumble.
    const bursts = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < bursts; i++) {
      const lag = (i / bursts) * p.duration * 0.55 + rand(0, 0.4);
      const far = Math.min(1, distance + (i / bursts) * 0.4);
      const t = when + lag;
      const length = rand(1.2, 2.6) + far * 1.5;
      const src = ctx.createBufferSource();
      src.buffer = this.engine.noise.get('brown');
      // The noise loops seamlessly, so a long sound started late in it never cuts out.
      src.loop = true;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.Q.value = 0.6;
      lowpass.frequency.setValueAtTime(p.cutoff * (1 - 0.5 * (far - distance)), t);
      lowpass.frequency.exponentialRampToValueAtTime(Math.max(70, p.cutoff * 0.3), t + length);
      const amp = ctx.createGain();
      const peak = p.gain * 0.75 * (1 - 0.55 * (i / bursts)) * rand(0.6, 1);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + rand(0.08, 0.35));
      amp.gain.setTargetAtTime(0, t + length * 0.3, length * 0.3);
      const panner = ctx.createStereoPanner();
      const from = Math.max(-1, Math.min(1, pan * 0.8 + rand(-0.3, 0.3)));
      panner.pan.setValueAtTime(from, t);
      panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, from + rand(-0.5, 0.5))), t + length);
      src.connect(lowpass).connect(amp).connect(panner).connect(out);
      src.start(t, Math.random() * 8, length * 1.6 + 0.2);
    }

    // The deep sub of a big strike, felt more than heard.
    const sub = ctx.createBufferSource();
    sub.buffer = this.engine.noise.get('brown');
    // The noise loops seamlessly, so a long sound started late in it never cuts out.
    sub.loop = true;
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.value = 70;
    const subAmp = ctx.createGain();
    subAmp.gain.setValueAtTime(0, when);
    subAmp.gain.linearRampToValueAtTime(p.gain * 0.9, when + 0.3);
    subAmp.gain.setTargetAtTime(0, when + 0.6, p.duration * 0.25);
    sub.connect(subFilter).connect(subAmp).connect(out);
    sub.start(when, Math.random() * 8, p.duration + 0.5);

    // Close strikes tear the air first: a ragged crack of a few rapid snaps.
    if (distance < 0.35) {
      const nearness = 1 - distance / 0.35;
      for (let i = 0; i < 4; i++) {
        const t = when + i * rand(0.015, 0.05);
        const crack = ctx.createBufferSource();
        crack.buffer = this.engine.noise.get('white');
        // The noise loops seamlessly, so a long sound started late in it never cuts out.
        crack.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = rand(1200, 3200);
        band.Q.value = 0.5;
        const crackAmp = ctx.createGain();
        crackAmp.gain.setValueAtTime(p.gain * 0.35 * nearness * (1 - i * 0.18), t);
        crackAmp.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.12, 0.3));
        crack.connect(band).connect(crackAmp).connect(out);
        crack.start(t, Math.random() * 8, 0.35);
      }
    }
    window.setTimeout(() => out.disconnect(), (p.delay + p.duration * 2 + 4) * 1000);
  }

  private silentGain(): GainNode {
    const g = this.engine.context.createGain();
    g.gain.value = 0;
    return g;
  }

  private loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const src = this.engine.context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(0, Math.random() * buffer.duration);
    return src;
  }
}
