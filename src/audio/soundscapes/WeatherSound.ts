import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import { thunderParams } from '../spatial';
import { rand } from '../../core/random';

/** Optional recorded loops / one-shots that replace the synthesized weather. */
export interface WeatherRecordings {
  rain?: AudioBuffer;
  wind?: AudioBuffer;
  thunder?: AudioBuffer[];
}

/**
 * Weather audio: rain and wind beds outside (muffled by the window), thunder
 * that follows each flash, and — when the window is shut — rain tapping on
 * the glass, which is heard indoors and stays crisp.
 */
export class WeatherSound {
  private readonly rainBody: GainNode;
  private readonly rainBodyFilter: BiquadFilterNode;
  private readonly rainPatter: GainNode;
  private readonly snowHush: GainNode;
  private readonly wind: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly windPan: StereoPannerNode;
  private readonly whistle: GainNode;
  private readonly whistleFilter: BiquadFilterNode;
  private tapBudget = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly recordings: WeatherRecordings = {},
  ) {
    const ctx = engine.context;
    const out = engine.inputs.weather;
    const node = <T extends AudioNode>(n: T) => n;

    // Rain: a broad wash plus a crackly high patter whose level jitters.
    this.rainBodyFilter = node(ctx.createBiquadFilter());
    this.rainBodyFilter.type = 'lowpass';
    this.rainBodyFilter.frequency.value = 1400;
    this.rainBody = this.silentGain();
    const rainSource = recordings.rain ? this.loop(recordings.rain) : engine.noise.source('pink');
    rainSource.connect(this.rainBodyFilter).connect(this.rainBody).connect(out);

    const patterFilter = ctx.createBiquadFilter();
    patterFilter.type = 'highpass';
    patterFilter.frequency.value = 3500;
    this.rainPatter = this.silentGain();
    engine.noise.source('white').connect(patterFilter).connect(this.rainPatter).connect(out);

    // Falling snow is nearly silent: just a soft, dampened hush.
    const hushFilter = ctx.createBiquadFilter();
    hushFilter.type = 'bandpass';
    hushFilter.frequency.value = 900;
    hushFilter.Q.value = 0.5;
    this.snowHush = this.silentGain();
    engine.noise.source('pink').connect(hushFilter).connect(this.snowHush).connect(out);

    // Wind: band-passed brown noise that brightens and swells with gusts.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windFilter.frequency.value = 300;
    this.windPan = ctx.createStereoPanner();
    this.wind = this.silentGain();
    const windSource = recordings.wind ? this.loop(recordings.wind) : engine.noise.source('brown');
    windSource.connect(this.windFilter).connect(this.wind).connect(this.windPan).connect(out);

    // A thin whistle that only appears in strong wind.
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = 'bandpass';
    this.whistleFilter.Q.value = 14;
    this.whistle = this.silentGain();
    engine.noise.source('white').connect(this.whistleFilter).connect(this.whistle).connect(this.windPan);
  }

  update(dt: number, env: Environment, glassExposure: number): void {
    if (!this.engine.running) return;
    const { weather } = env;
    const now = this.engine.context.currentTime;
    const smooth = (param: AudioParam, value: number, tau = 0.4) => param.setTargetAtTime(value, now, tau);

    const rain = weather.kind === 'rain' ? weather.precipitation : 0;
    const snow = weather.kind === 'snow' ? weather.precipitation : 0;
    smooth(this.rainBody.gain, 0.55 * rain ** 0.7);
    smooth(this.rainBodyFilter.frequency, 900 + 2200 * rain);
    // Fast random jitter gives the patter its texture of individual drops.
    smooth(this.rainPatter.gain, 0.12 * rain * (0.3 + Math.random()), 0.02);
    smooth(this.snowHush.gain, 0.05 * snow);

    const wind = Math.abs(weather.wind);
    smooth(this.wind.gain, 0.45 * wind ** 1.4 + 0.015);
    smooth(this.windFilter.frequency, 220 + 700 * wind, 0.6);
    smooth(this.windPan.pan, Math.max(-0.5, Math.min(0.5, weather.wind * 0.5)), 1.5);
    smooth(this.whistle.gain, 0.12 * Math.max(0, wind - 0.5));
    smooth(this.whistleFilter.frequency, 650 + 600 * wind, 0.8);

    // Drops tapping the pane, only where glass faces the rain.
    this.tapBudget += dt * 26 * rain * glassExposure;
    while (this.tapBudget >= 1) {
      this.tapBudget -= 1;
      this.glassTap(now + Math.random() * dt);
    }
  }

  /** Thunder after a flash: delayed and softened by distance, panned to the strike. */
  thunder(intensity: number, distance: number, pan: number): void {
    if (!this.engine.running) return;
    const ctx = this.engine.context;
    const p = thunderParams(intensity, distance);
    const when = ctx.currentTime + p.delay;

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan * 0.8;
    panner.connect(this.engine.inputs.weather);
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
      src.connect(lowpass).connect(amp).connect(panner);
      src.start(when);
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = this.engine.noise.get('brown');
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(p.cutoff, when);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(120, p.cutoff * 0.35), when + p.duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    // A rolling rumble: a few overlapping swells, each weaker than the last.
    const swells = 3 + Math.floor(Math.random() * 3);
    let t = when;
    for (let i = 0; i < swells; i++) {
      const peak = p.gain * 1.6 * (1 - i / (swells + 1));
      amp.gain.linearRampToValueAtTime(peak, t + rand(0.05, 0.25));
      t += rand(0.4, 1.1);
      amp.gain.linearRampToValueAtTime(peak * 0.35, t);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, when + p.duration);
    src.connect(lowpass).connect(amp).connect(panner);
    src.start(when, Math.random() * 5, p.duration + 0.2);

    // Close strikes start with a sharp crack.
    if (distance < 0.35) {
      const crack = ctx.createBufferSource();
      crack.buffer = this.engine.noise.get('white');
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const crackAmp = ctx.createGain();
      crackAmp.gain.setValueAtTime(p.gain * 0.5, when);
      crackAmp.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
      crack.connect(hp).connect(crackAmp).connect(panner);
      crack.start(when, Math.random() * 5, 0.4);
    }
    window.setTimeout(() => panner.disconnect(), (p.delay + p.duration + 1) * 1000);
  }

  private glassTap(when: number): void {
    const ctx = this.engine.context;
    const panner = ctx.createStereoPanner();
    panner.pan.value = rand(-0.85, 0.85);
    panner.connect(this.engine.inputs.glass);
    this.engine.sounds.play('glass-tap', panner, when, rand(0.15, 0.5), rand(0.85, 1.2));
    window.setTimeout(() => panner.disconnect(), 500);
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
