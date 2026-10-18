import { Emitter } from '../../core/Emitter';
import type { AudioEngine } from '../AudioEngine';
import { volumeToGain, type AudioSettings } from '../mixer';
import { LofiGenerator } from './LofiGenerator';

export type RadioSource = 'generative' | 'playlist' | 'stream';

export interface RadioEvents {
  change: { on: boolean; source: RadioSource; title: string };
}

/** Position of the little radio in the room: just left of centre. */
const RADIO_PAN = -0.35;
const FADE = 0.15;

/**
 * The diegetic lofi radio on the sill: a source (stream URL, local playlist or
 * the generative station) fed through a "small speaker in a cosy room" chain
 * — band-limited, a gentle mid bump, soft saturation and a touch of room
 * reverb — into the interior bus, so it is never muffled by the window.
 */
export class Radio extends Emitter<RadioEvents> {
  private readonly input: GainNode;
  private readonly generator: LofiGenerator;
  private element: HTMLAudioElement | null = null;
  private elementNode: MediaElementAudioSourceNode | null = null;
  /** Streams without CORS can't enter Web Audio; they play straight out, unprocessed. */
  private direct = false;
  private playlistIndex = 0;
  private _on = false;
  private _title = '';

  constructor(
    private readonly engine: AudioEngine,
    private readonly settings: AudioSettings,
    private readonly playlist: readonly string[] = [],
  ) {
    super();
    const ctx = engine.context;
    this.input = ctx.createGain();
    this.input.gain.value = 0;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 140;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 1100;
    body.Q.value = 0.9;
    body.gain.value = 3;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 5200;
    const saturation = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.6) / Math.tanh(1.6);
    saturation.curve = curve;
    saturation.oversample = '2x';
    const panner = ctx.createStereoPanner();
    panner.pan.value = RADIO_PAN;
    const room = ctx.createConvolver();
    room.buffer = createRoomImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;

    this.input.connect(highpass).connect(body).connect(lowpass).connect(saturation).connect(panner);
    panner.connect(engine.inputs.radio);
    panner.connect(room).connect(wet).connect(engine.inputs.radio);

    this.generator = new LofiGenerator(ctx, engine.noise);
    this.generator.output.connect(this.input);
    this.generator.onTrack = (track) => {
      if (this.source === 'generative') this.setTitle(`${track.title} · Living Window FM`);
    };

    engine.on('volume', () => this.updateDirectVolume());
    engine.on('mute', () => this.updateDirectVolume());
  }

  get isOn(): boolean {
    return this._on;
  }

  get title(): string {
    return this._title;
  }

  get source(): RadioSource {
    if (this.settings.streamUrl) return 'stream';
    if (this.playlist.length > 0) return 'playlist';
    return 'generative';
  }

  get streamUrl(): string {
    return this.settings.streamUrl;
  }

  setOn(on: boolean): void {
    if (on === this._on) return;
    this._on = on;
    this.settings.radioOn = on;
    const now = this.engine.context.currentTime;
    this.input.gain.setTargetAtTime(on ? 1 : 0, now, FADE);
    if (on) {
      this.playStatic();
      this.startSource();
    } else {
      this.stopSources();
      this.setTitle('');
    }
    this.emitChange();
  }

  toggle(): void {
    this.setOn(!this._on);
  }

  /** Next track (generative / playlist); re-tunes a stream. */
  next(): void {
    if (!this._on) return;
    this.playStatic();
    if (this.source === 'generative') this.generator.next();
    else if (this.source === 'playlist') {
      this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
      this.startSource();
    } else {
      this.startSource();
    }
  }

  /** Tune to an internet radio stream, or pass '' to return to the built-in station. */
  setStreamUrl(url: string): void {
    this.settings.streamUrl = url.trim();
    if (this._on) {
      this.stopSources();
      this.playStatic();
      this.startSource();
    }
    this.emitChange();
  }

  private startSource(): void {
    const source = this.source;
    if (source === 'generative') {
      this.stopElement();
      this.generator.start();
      this.setTitle(`${this.generator.currentTrack.title} · Living Window FM`);
      return;
    }
    this.generator.stop();
    const url = source === 'stream' ? this.settings.streamUrl : this.playlist[this.playlistIndex];
    this.playUrl(url, true);
    this.setTitle(source === 'stream' ? describeStream(url) : describeFile(url));
  }

  private playUrl(url: string, viaWebAudio: boolean): void {
    this.stopElement();
    const el = new Audio();
    el.preload = 'auto';
    this.element = el;
    this.direct = !viaWebAudio;
    if (viaWebAudio) {
      // CORS-enabled sources can be processed by the radio's EQ chain.
      el.crossOrigin = 'anonymous';
      this.elementNode = this.engine.context.createMediaElementSource(el);
      this.elementNode.connect(this.input);
    }
    el.addEventListener('ended', () => {
      if (this.element === el && this.source === 'playlist') this.next();
    });
    el.addEventListener('error', () => {
      if (this.element !== el) return;
      // Most often a stream without CORS headers: fall back to plain playback.
      if (viaWebAudio) this.playUrl(url, false);
      else this.setTitle('Station unavailable');
    });
    el.src = url;
    this.updateDirectVolume();
    void el.play().catch(() => undefined);
  }

  private stopSources(): void {
    this.generator.stop();
    this.stopElement();
  }

  private stopElement(): void {
    if (!this.element) return;
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.elementNode?.disconnect();
    this.element = null;
    this.elementNode = null;
  }

  private updateDirectVolume(): void {
    if (!this.element || !this.direct) return;
    const master = this.settings.muted ? 0 : volumeToGain(this.settings.volumes.master);
    this.element.volume = Math.min(1, master * volumeToGain(this.settings.volumes.radio));
  }

  /** A short burst of tuning static between stations and tracks. */
  private playStatic(): void {
    if (!this.engine.running) return;
    const ctx = this.engine.context;
    const when = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noise.get('white');
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.setValueAtTime(900, when);
    band.frequency.exponentialRampToValueAtTime(3200, when + 0.35);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.15, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
    src.connect(band).connect(amp).connect(this.input);
    src.start(when, Math.random() * 5, 0.45);
  }

  private setTitle(title: string): void {
    if (title === this._title) return;
    this._title = title;
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change', { on: this._on, source: this.source, title: this._title });
  }
}

function describeFile(url: string): string {
  const name = decodeURIComponent(url.split('/').pop() ?? url).replace(/\.[a-z0-9]+$/i, '');
  return name.replace(/[_-]+/g, ' ');
}

function describeStream(url: string): string {
  try {
    return `Stream · ${new URL(url, window.location.href).hostname}`;
  } catch {
    return 'Stream';
  }
}

/** A small, soft room: stereo noise with a quick exponential decay. */
function createRoomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 0.45;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * t) * (1 - t);
    }
  }
  return buffer;
}
