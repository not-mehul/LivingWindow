import { WINDOW_CLOSED_CUTOFF_HZ, WINDOW_CLOSED_GAIN_DB, WINDOW_OPEN_CUTOFF_HZ } from '../config';
import { Emitter } from '../core/Emitter';
import { BUS_IDS, dbToGain, volumeToGain, type AudioSettings, type BusId } from './mixer';
import { NoiseBank } from './noise';
import { SoundBank, type SoundId } from './sounds/SoundBank';
import { spatialParams } from './spatial';

export interface AudioEngineEvents {
  /** The context started or stopped running (e.g. after the first user gesture). */
  state: { running: boolean };
  volume: { bus: BusId; volume: number };
  mute: { muted: boolean };
}

/** Time constant used for smooth parameter changes (seconds). */
const SMOOTHING = 0.05;
/** Fixed boost ahead of the limiter so default slider positions sit at a comfortable level. */
const MAKEUP_GAIN = 2.2;

/**
 * Web Audio mixer, structured as two acoustic zones:
 *
 *   exterior: wildlife ─┐
 *             ambience ─┼─▶ window low-pass + gain ─┐
 *             weather  ─┘                           ├─▶ master ─▶ limiter ─▶ out
 *   interior: radio, rain-on-glass, UI foley ───────┘
 *
 * Closing the window sweeps the exterior low-pass from 20 kHz to 450 Hz and
 * drops it 8 dB, muffling the outside while the radio stays clear.
 */
export class AudioEngine extends Emitter<AudioEngineEvents> {
  readonly context: AudioContext;
  readonly noise: NoiseBank;
  readonly sounds: SoundBank;

  /** Inputs for sound sources, by acoustic role. */
  readonly inputs: {
    wildlife: GainNode;
    ambience: GainNode;
    weather: GainNode;
    /** Rain tapping the glass: part of the Weather slider, but indoors. */
    glass: GainNode;
    radio: GainNode;
    ui: GainNode;
  };

  readonly analyser: AnalyserNode;

  private readonly busGains: Record<Exclude<BusId, 'master'>, GainNode[]>;
  private readonly master: GainNode;
  private readonly windowFilter: BiquadFilterNode;
  private readonly windowGain: GainNode;
  private readonly settings: AudioSettings;

  constructor(settings: AudioSettings, context: AudioContext = new AudioContext({ latencyHint: 'playback' })) {
    super();
    this.context = context;
    this.settings = settings;
    this.noise = new NoiseBank(context);
    this.sounds = new SoundBank(context, this.noise);

    const ctx = context;
    const gain = (value = 1) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };

    // Output stage: a gentle limiter keeps thunder and storms from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master = gain();
    this.master.connect(gain(MAKEUP_GAIN)).connect(limiter).connect(this.analyser).connect(ctx.destination);

    // Exterior zone, through the window.
    this.windowFilter = ctx.createBiquadFilter();
    this.windowFilter.type = 'lowpass';
    this.windowFilter.frequency.value = WINDOW_OPEN_CUTOFF_HZ;
    this.windowFilter.Q.value = 0.7;
    this.windowGain = gain();
    this.windowFilter.connect(this.windowGain).connect(this.master);

    const wildlife = gain();
    const ambience = gain();
    const weather = gain();
    for (const bus of [wildlife, ambience, weather]) bus.connect(this.windowFilter);

    // Interior zone: never muffled by the window.
    const glass = gain();
    const radio = gain();
    const ui = gain(0.8);
    for (const bus of [glass, radio, ui]) bus.connect(this.master);

    this.inputs = { wildlife, ambience, weather, glass, radio, ui };
    this.busGains = { wildlife: [wildlife], ambience: [ambience], weather: [weather, glass], radio: [radio] };

    for (const id of BUS_IDS) this.applyVolume(id, true);
    context.addEventListener('statechange', () => this.emit('state', { running: this.running }));
  }

  get running(): boolean {
    return this.context.state === 'running';
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  volume(bus: BusId): number {
    return this.settings.volumes[bus];
  }

  /**
   * Browsers only allow audio after a user gesture: call this from one
   * (synchronously, before any await, as iOS requires).
   */
  async unlock(): Promise<void> {
    // iOS Safari 16.4+: play through the ringer's silent switch, like a music app.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'playback') {
      try {
        session.type = 'playback';
      } catch {
        // Not supported here.
      }
    }
    if (this.context.state === 'running') return;
    // Older iOS only fully unlocks once a sound has started inside the gesture.
    try {
      const silent = this.context.createBufferSource();
      silent.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      silent.connect(this.context.destination);
      silent.start(0);
    } catch {
      // Harmless if it fails.
    }
    try {
      await this.context.resume();
    } catch {
      // Not allowed yet; the next gesture will try again.
    }
  }

  setVolume(bus: BusId, volume: number): void {
    this.settings.volumes[bus] = Math.min(1, Math.max(0, volume));
    this.applyVolume(bus);
    this.emit('volume', { bus, volume: this.settings.volumes[bus] });
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyVolume('master');
    this.emit('mute', { muted });
  }

  /** Sweep the exterior filter as the sash slides. */
  setWindowOpen(open: boolean, durationSeconds: number): void {
    const now = this.context.currentTime;
    const end = now + Math.max(0.01, durationSeconds);
    const freq = this.windowFilter.frequency;
    const level = this.windowGain.gain;
    for (const param of [freq, level]) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    // Exponential ramps sound even across the huge frequency range.
    freq.exponentialRampToValueAtTime(open ? WINDOW_OPEN_CUTOFF_HZ : WINDOW_CLOSED_CUTOFF_HZ, end);
    level.linearRampToValueAtTime(open ? 1 : dbToGain(WINDOW_CLOSED_GAIN_DB), end);
  }

  /** Jump straight to a window state without a sweep (e.g. at start-up). */
  snapWindow(open: boolean): void {
    this.windowFilter.frequency.value = open ? WINDOW_OPEN_CUTOFF_HZ : WINDOW_CLOSED_CUTOFF_HZ;
    this.windowGain.gain.value = open ? 1 : dbToGain(WINDOW_CLOSED_GAIN_DB);
  }

  /**
   * Play a one-shot positioned in the scene: `screenX` ∈ [-1, 1] pans it,
   * `depthZ` ∈ [0, 1] (0 = windowsill, 1 = horizon) sets its distance. Every
   * play gets a small random pitch (±8%) and gain (±15%) variation.
   */
  playSpatialSound(id: SoundId, screenX: number, depthZ: number, bus: 'wildlife' | 'ambience' | 'weather' = 'wildlife'): void {
    if (!this.running) return;
    const params = spatialParams(screenX, depthZ);
    const ctx = this.context;
    const panner = ctx.createStereoPanner();
    panner.pan.value = params.pan;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = params.cutoff;
    air.connect(panner).connect(this.inputs[bus]);
    const duration = this.sounds.play(id, air, ctx.currentTime, params.gain, params.playbackRate);
    // Tidy up the per-voice nodes once the sound has finished.
    window.setTimeout(() => {
      air.disconnect();
      panner.disconnect();
    }, (duration + 0.5) * 1000);
  }

  /** Room sounds (seed, sash): interior, centred, with gentle variation. */
  playUi(id: SoundId, pan = 0): void {
    if (!this.running) return;
    const ctx = this.context;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.inputs.ui);
    const { gain, playbackRate } = spatialParams(pan, 0);
    const duration = this.sounds.play(id, panner, ctx.currentTime, gain, playbackRate);
    window.setTimeout(() => panner.disconnect(), (duration + 0.5) * 1000);
  }

  /** RMS level of the final output, 0..1 — handy for meters and tests. */
  outputLevel(): number {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  }

  private applyVolume(bus: BusId, immediate = false): void {
    const now = this.context.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, SMOOTHING);
    };
    if (bus === 'master') {
      set(this.master.gain, this.settings.muted ? 0 : volumeToGain(this.settings.volumes.master));
      return;
    }
    for (const node of this.busGains[bus]) set(node.gain, volumeToGain(this.settings.volumes[bus]));
  }
}
