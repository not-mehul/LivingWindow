import { WINDOW_CLOSED_CUTOFF_HZ, WINDOW_CLOSED_GAIN_DB, WINDOW_OPEN_CUTOFF_HZ } from '../config';
import { Emitter } from '../core/Emitter';
import { ACOUSTICS, impulseResponse, type AcousticsId } from './acoustics';
import { BUS_IDS, dbToGain, volumeToGain, type AudioSettings, type BusId } from './mixer';
import { Modulators } from './modulation';
import { NoiseBank } from './noise';
import { Prerender } from './render';
import { SoundBank, type SoundId } from './sounds/SoundBank';
import { reverbSend, spatialParams } from './spatial';
import { clamp01 } from '../core/math';

export interface AudioEngineEvents {
  /** The context started or stopped running (e.g. after the first user gesture). */
  state: { running: boolean };
  volume: { bus: BusId; volume: number };
  mute: { muted: boolean };
}

/** Where a one-shot is heard: outside on one of the exterior buses, or in the room. */
export type SpatialBus = 'wildlife' | 'ambience' | 'weather' | 'indoor';
type ExteriorBus = Exclude<SpatialBus, 'indoor'>;

/** Time constant used for smooth parameter changes (seconds). */
const SMOOTHING = 0.05;
/** Fixed boost ahead of the limiter so default slider positions sit at a comfortable level. */
const MAKEUP_GAIN = 1.6;
/** One-shots allowed to overlap per bus; extra ones are skipped rather than piling up. */
const MAX_VOICES: Record<SpatialBus, number> = { wildlife: 10, ambience: 8, weather: 8, indoor: 4 };
/** The hush of a room with the window shut: almost nothing, but not dead air. */
const ROOM_TONE_GAIN = 0.012;
/** How long after muting the context is suspended to save power (s). */
const IDLE_SUSPEND = 1.5;

/**
 * Web Audio mixer, structured as acoustic zones:
 *
 *   exterior: wildlife ─┐   (each also sends, by distance, into
 *             ambience ─┼─▶  the landscape's reverb) ─▶ window ─▶ glue ─┐
 *             weather  ─┘                                              │
 *   indoors:  the dog, rain on the glass, room foley, room tone ───────┼─▶ master ─▶ limiter ─▶ out
 *   radio:    its own speaker chain ───────────────────────────────────┘
 *
 * Closing the window sweeps the exterior low-pass down and drops it about
 * 14 dB, muffling the outside while the room and the radio stay clear.
 * Thunder only squeezes the exterior glue compressor, so it can't pump the
 * radio.
 */
export class AudioEngine extends Emitter<AudioEngineEvents> {
  readonly context: AudioContext;
  readonly noise: NoiseBank;
  readonly sounds: SoundBank;
  readonly modulators: Modulators;
  readonly prerender: Prerender;

  /** Inputs for sound sources, by acoustic role. */
  readonly inputs: {
    wildlife: GainNode;
    ambience: GainNode;
    weather: GainNode;
    /** Rain tapping the glass: part of the Weather slider, but indoors. */
    glass: GainNode;
    /** Pets in the room: on the Wildlife slider, never muffled by the window. */
    indoor: GainNode;
    radio: GainNode;
    ui: GainNode;
  };
  /** Reverb sends for the exterior buses (same sliders as their dry inputs). */
  readonly sends: Record<ExteriorBus, GainNode>;

  readonly analyser: AnalyserNode;

  private readonly busGains: Record<Exclude<BusId, 'master'>, GainNode[]>;
  private readonly master: GainNode;
  private readonly reverbIn: GainNode;
  private readonly reverbOut: GainNode;
  private convolver: ConvolverNode | null = null;
  private acousticsId: AcousticsId | null = null;
  private readonly hush: BiquadFilterNode;
  private readonly hushLevel: GainNode;
  private readonly windowFilter: BiquadFilterNode;
  private readonly windowGain: GainNode;
  private readonly roomTone: GainNode;
  private readonly settings: AudioSettings;
  private readonly voices: Record<SpatialBus, number> = { wildlife: 0, ambience: 0, weather: 0, indoor: 0 };
  /** A user gesture has let audio start at least once. */
  private gestured = false;
  private suspendTimer: number | undefined;

  constructor(settings: AudioSettings, context: AudioContext = new AudioContext({ latencyHint: 'playback' })) {
    super();
    this.context = context;
    this.settings = settings;
    this.noise = new NoiseBank(context);
    this.prerender = new Prerender(context.sampleRate);
    this.sounds = new SoundBank(context, this.noise, this.prerender);
    this.modulators = new Modulators(context);

    const ctx = context;
    const gain = (value = 1) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };

    // Output stage: a fast limiter, then a soft clipper as a last safety net.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    const clipper = ctx.createWaveShaper();
    clipper.curve = softClipCurve();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master = gain();
    this.master.connect(gain(MAKEUP_GAIN)).connect(limiter).connect(clipper).connect(this.analyser).connect(ctx.destination);

    // Exterior zone: the buses and their reverb, through the window, glued together.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.03;
    glue.release.value = 0.4;
    this.windowFilter = ctx.createBiquadFilter();
    this.windowFilter.type = 'lowpass';
    this.windowFilter.frequency.value = WINDOW_OPEN_CUTOFF_HZ;
    this.windowFilter.Q.value = 0.5;
    this.windowGain = gain();
    this.windowFilter.connect(this.windowGain).connect(glue).connect(this.master);
    // Snow soaks up sound: a shelf that dulls the whole outdoors as it settles.
    this.hush = ctx.createBiquadFilter();
    this.hush.type = 'highshelf';
    this.hush.frequency.value = 2500;
    this.hush.gain.value = 0;
    this.hushLevel = gain();
    this.hush.connect(this.hushLevel).connect(this.windowFilter);

    this.reverbIn = gain();
    this.reverbOut = gain();
    this.reverbOut.connect(this.hush);

    const wildlife = gain();
    const ambience = gain();
    const weather = gain();
    for (const bus of [wildlife, ambience]) bus.connect(this.hush);
    weather.connect(this.windowFilter);
    this.sends = { wildlife: gain(), ambience: gain(), weather: gain() };
    for (const send of Object.values(this.sends)) send.connect(this.reverbIn);

    // Indoors: never muffled by the window.
    const glass = gain();
    const indoor = gain();
    const radio = gain();
    const ui = gain(0.8);
    for (const bus of [glass, indoor, radio, ui]) bus.connect(this.master);

    // The room's own faint hush, heard only once the window is shut.
    this.roomTone = gain(0);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 220;
    this.noise.source('brown').connect(tone).connect(this.roomTone).connect(this.master);

    this.inputs = { wildlife, ambience, weather, glass, indoor, radio, ui };
    this.busGains = {
      wildlife: [wildlife, this.sends.wildlife, indoor],
      ambience: [ambience, this.sends.ambience],
      weather: [weather, this.sends.weather, glass],
      radio: [radio],
    };

    this.setAcoustics('city');
    for (const id of BUS_IDS) this.applyVolume(id, true);
    context.addEventListener('statechange', () => {
      // Once it has run, the browser has allowed audio: it can be woken again freely.
      if (this.running) this.gestured = true;
      this.emit('state', { running: this.running });
    });
    if (this.running) this.gestured = true;
  }

  get running(): boolean {
    return this.context.state === 'running';
  }

  /**
   * Audio is unlocked and either playing or deliberately asleep while muted
   * (so the UI shouldn't ask for a tap to enable it).
   */
  get ready(): boolean {
    return this.running || (this.gestured && this.settings.muted);
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
    this.gestured = true;
    // Muted: stay asleep; unmuting wakes it.
    if (this.context.state === 'running' || this.settings.muted) {
      this.emit('state', { running: this.running });
      return;
    }
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
    this.settings.volumes[bus] = clamp01(volume);
    this.applyVolume(bus);
    this.emit('volume', { bus, volume: this.settings.volumes[bus] });
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    window.clearTimeout(this.suspendTimer);
    if (muted) {
      this.applyVolume('master');
      // Nothing to hear: let the audio thread sleep.
      this.suspendTimer = window.setTimeout(() => {
        if (this.settings.muted && this.running) void this.context.suspend().catch(() => undefined);
      }, IDLE_SUSPEND * 1000);
    } else {
      this.master.gain.value = 0;
      if (!this.running && this.gestured) void this.context.resume().catch(() => undefined);
      this.applyVolume('master');
    }
    this.emit('mute', { muted });
  }

  /** Swap the outdoor reverb for a landscape's space. */
  setAcoustics(id: AcousticsId): void {
    if (id === this.acousticsId) return;
    this.acousticsId = id;
    const ctx = this.context;
    const acoustics = ACOUSTICS[id];
    const [left, right] = impulseResponse(acoustics, ctx.sampleRate, id.length);
    const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const convolver = ctx.createConvolver();
    // The impulse is already normalised to a consistent level across spaces.
    convolver.normalize = false;
    convolver.buffer = buffer;
    const now = ctx.currentTime;
    const old = this.convolver;
    if (old) {
      // Let the old space's tail ring out under the new one.
      this.reverbIn.disconnect(old);
      window.setTimeout(() => old.disconnect(), 4000);
    }
    this.reverbIn.connect(convolver).connect(this.reverbOut);
    this.convolver = convolver;
    this.reverbOut.gain.setTargetAtTime(1, now, 0.1);
  }

  /** How strongly sounds at depth `z` feed the current landscape's reverb. */
  sendLevel(z: number): number {
    return reverbSend(z, ACOUSTICS[this.acousticsId ?? 'city'].send);
  }

  /** How much fresh snow is muffling the world outside, 0..1. */
  setHush(amount: number): void {
    const now = this.context.currentTime;
    this.hush.gain.setTargetAtTime(-9 * clamp01(amount), now, 4);
    this.hushLevel.gain.setTargetAtTime(dbToGain(-5 * clamp01(amount)), now, 4);
  }

  /** Sweep the exterior filter as the sash slides. */
  setWindowOpen(open: boolean, durationSeconds: number): void {
    const now = this.context.currentTime;
    const end = now + Math.max(0.01, durationSeconds);
    const freq = this.windowFilter.frequency;
    const level = this.windowGain.gain;
    const room = this.roomTone.gain;
    for (const param of [freq, level, room]) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    // Exponential ramps sound even across the huge frequency range.
    freq.exponentialRampToValueAtTime(open ? WINDOW_OPEN_CUTOFF_HZ : WINDOW_CLOSED_CUTOFF_HZ, end);
    level.linearRampToValueAtTime(open ? 1 : dbToGain(WINDOW_CLOSED_GAIN_DB), end);
    room.linearRampToValueAtTime(open ? 0 : ROOM_TONE_GAIN, end + 0.5);
  }

  /** Jump straight to a window state without a sweep (e.g. at start-up). */
  snapWindow(open: boolean): void {
    this.windowFilter.frequency.value = open ? WINDOW_OPEN_CUTOFF_HZ : WINDOW_CLOSED_CUTOFF_HZ;
    this.windowGain.gain.value = open ? 1 : dbToGain(WINDOW_CLOSED_GAIN_DB);
    this.roomTone.gain.value = open ? 0 : ROOM_TONE_GAIN;
  }

  /**
   * Play a one-shot positioned in the scene: `screenX` ∈ [-1, 1] pans it,
   * `depthZ` ∈ [0, 1] (0 = windowsill, 1 = horizon) sets its distance: quieter,
   * duller and more reverberant the further away. Every play gets a small
   * random pitch (±8%) and gain (±15%) variation. `indoor` sounds are in the
   * room: dry, close and clear whatever the window is doing.
   */
  playSpatialSound(id: SoundId, screenX: number, depthZ: number, bus: SpatialBus = 'wildlife'): void {
    if (!this.running || this.voices[bus] >= MAX_VOICES[bus]) return;
    const params = spatialParams(screenX, depthZ);
    const ctx = this.context;
    const panner = ctx.createStereoPanner();
    panner.pan.value = params.pan;
    const nodes: AudioNode[] = [panner];
    let input: AudioNode = panner;
    if (bus === 'indoor') {
      panner.connect(this.inputs.indoor);
    } else {
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = params.cutoff;
      air.connect(panner).connect(this.inputs[bus]);
      const send = ctx.createGain();
      send.gain.value = this.sendLevel(depthZ);
      panner.connect(send).connect(this.sends[bus]);
      nodes.push(air, send);
      input = air;
    }
    const duration = this.sounds.play(id, input, ctx.currentTime, params.gain, params.playbackRate);
    this.voices[bus]++;
    // Tidy up the per-voice nodes once the sound has finished.
    window.setTimeout(() => {
      this.voices[bus]--;
      for (const node of nodes) node.disconnect();
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

  /** Overlapping one-shots per bus right now (for debugging the mix). */
  get activeVoices(): Readonly<Record<SpatialBus, number>> {
    return this.voices;
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

/** Transparent below -1 dBFS, then rounding smoothly into a ceiling just under full scale. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  const knee = 0.89;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y * 0.99;
  }
  return curve;
}
