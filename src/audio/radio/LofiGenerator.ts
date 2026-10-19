import { createRng, rand } from '../../core/random';
import type { NoiseBank } from '../noise';
import { bassNote, createTrack, midiToFrequency, stepDuration, voiceChord, type Track } from './music';

const STEPS_PER_BAR = 16;
/** How far ahead notes are scheduled (s); longer while the tab is hidden. */
const LOOKAHEAD = 0.15;
const HIDDEN_LOOKAHEAD = 1.6;
const TICK_MS = 25;
const INTRO_BARS = 2;

/**
 * "Living Window FM": an endless, generative lofi hip-hop station. Each track
 * picks a key, tempo, swing and a jazzy seventh-chord progression, then
 * plays dusty electric-piano chords, a round bass, lazy boom-bap drums,
 * the odd melody note and vinyl crackle, all with a slow tape wobble.
 * Notes are scheduled ahead on the audio clock so timing stays tight.
 */
export class LofiGenerator {
  readonly output: GainNode;
  onTrack: ((track: Track) => void) | null = null;

  private readonly ctx: AudioContext;
  private readonly keys: GainNode;
  private readonly bass: GainNode;
  private readonly drums: GainNode;
  private readonly crackle: GainNode;
  private readonly wowDepth: GainNode;
  private track: Track;
  private bar = 0;
  private step = 0;
  private nextTime = 0;
  private timer: number | undefined;
  private playing = false;

  constructor(
    ctx: AudioContext,
    private readonly noise: NoiseBank,
  ) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.9;
    this.track = createTrack();

    const lowpass = (frequency: number) => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = frequency;
      return f;
    };

    this.keys = ctx.createGain();
    this.keys.gain.value = 0.5;
    this.keys.connect(lowpass(2300)).connect(this.output);
    this.bass = ctx.createGain();
    this.bass.gain.value = 0.55;
    this.bass.connect(lowpass(320)).connect(this.output);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.55;
    this.drums.connect(lowpass(6500)).connect(this.output);

    // Tape wow: a slow pitch drift shared by every keys note.
    const wow = ctx.createOscillator();
    wow.frequency.value = 0.33;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 7; // cents
    wow.connect(this.wowDepth);
    wow.start();

    this.crackle = ctx.createGain();
    this.crackle.gain.value = 0;
    const crackleSource = ctx.createBufferSource();
    crackleSource.buffer = createCrackleBuffer(ctx);
    crackleSource.loop = true;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 900;
    crackleSource.connect(crackleFilter).connect(this.crackle).connect(this.output);
    crackleSource.start();
  }

  get currentTrack(): Track {
    return this.track;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.crackle.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.3);
    this.onTrack?.(this.track);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    this.playing = false;
    window.clearInterval(this.timer);
    this.crackle.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  /** Skip to a freshly generated track. */
  next(): void {
    this.track = createTrack();
    this.bar = 0;
    this.step = 0;
    this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.3);
    this.onTrack?.(this.track);
  }

  private schedule(): void {
    if (!this.playing) return;
    const lookahead = document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD;
    // If the tab was throttled and we fell behind, resynchronise instead of
    // firing a burst of stale notes.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + lookahead) {
      this.playStep(this.nextTime);
      this.nextTime += stepDuration(this.track.bpm, this.track.swing, this.step);
      this.step++;
      if (this.step === STEPS_PER_BAR) {
        this.step = 0;
        this.bar++;
        if (this.bar >= this.track.bars) {
          // Leave a beat of breathing room, then roll into a new track.
          this.nextTime += 60 / this.track.bpm;
          this.next();
        }
      }
    }
  }

  private playStep(time: number): void {
    const { track, step, bar } = this;
    const chord = track.progression[bar % track.progression.length];
    const beat = 60 / track.bpm;
    const drumsIn = bar >= INTRO_BARS && bar < track.bars - 1;

    if (step === 0) {
      const notes = voiceChord(track.tonic + 12, chord, 61);
      notes.forEach((note, i) => this.keyNote(note, time + i * rand(0.01, 0.025), beat * 3.6, 0.11));
      this.bassNote(bassNote(track.tonic, chord), time, beat * 1.6, 0.5);
    }
    // A pushed re-hit of the chord on the "and" of three, sometimes.
    if (step === 10 && Math.random() < 0.3) {
      voiceChord(track.tonic + 12, chord, 63).forEach((note, i) =>
        this.keyNote(note, time + i * 0.015, beat * 1.2, 0.07),
      );
    }
    if (step === 8 && Math.random() < 0.65) this.bassNote(bassNote(track.tonic, chord) + (Math.random() < 0.5 ? 7 : 0), time, beat, 0.4);

    // Sparse melody: a chord tone up high, like a lazy right hand.
    if (step % 2 === 0 && bar >= 1 && Math.random() < 0.09) {
      const pool = voiceChord(track.tonic + 24, chord, 76);
      this.bell(pool[Math.floor(Math.random() * pool.length)], time, rand(0.4, 0.9));
    }

    if (drumsIn) {
      if (step === 0 || (step === 10 && Math.random() < 0.7) || (step === 7 && Math.random() < 0.2)) this.kick(time);
      if (step === 4 || step === 12) this.snare(time, 0.5);
      else if (Math.random() < 0.04) this.snare(time, 0.12); // ghost note
      if (step % 2 === 0) this.hat(time, rand(0.25, 0.55) * (step % 4 === 0 ? 1 : 0.75));
    }
  }

  /** Electric-piano-ish note: fundamental, a fast-decaying tine an octave up, a warm body. */
  private keyNote(midi: number, when: number, length: number, velocity: number): void {
    const ctx = this.ctx;
    const f = midiToFrequency(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(velocity, when + 0.008);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.45, when + 0.5);
    amp.gain.setTargetAtTime(0.0001, when + length, 0.18);
    amp.connect(this.keys);
    const partials: Array<[OscillatorType, number, number]> = [
      ['sine', 1, 1],
      ['triangle', 0.999, 0.25],
    ];
    for (const [type, ratio, level] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      this.modulate(osc);
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(amp);
      osc.start(when);
      osc.stop(when + length + 1);
    }
    const tine = ctx.createOscillator();
    tine.frequency.value = f * 2.003;
    const tineAmp = ctx.createGain();
    tineAmp.gain.setValueAtTime(velocity * 0.6, when);
    tineAmp.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
    tine.connect(tineAmp).connect(this.keys);
    tine.start(when);
    tine.stop(when + 0.4);
  }

  /** Apply the shared tape wobble, releasing the connection once the note ends. */
  private modulate(osc: OscillatorNode): void {
    this.wowDepth.connect(osc.detune);
    osc.addEventListener('ended', () => this.wowDepth.disconnect(osc.detune), { once: true });
  }

  private bassNote(midi: number, when: number, length: number, velocity: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = midiToFrequency(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(velocity, when + 0.015);
    amp.gain.setTargetAtTime(velocity * 0.6, when + 0.05, 0.3);
    amp.gain.setTargetAtTime(0.0001, when + length, 0.08);
    osc.connect(amp).connect(this.bass);
    osc.start(when);
    osc.stop(when + length + 0.6);
  }

  private bell(midi: number, when: number, length: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFrequency(midi);
    this.modulate(osc);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(0.05, when + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + length);
    osc.connect(amp).connect(this.keys);
    osc.start(when);
    osc.stop(when + length + 0.05);
  }

  private kick(when: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(115, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.13);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.9, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
    osc.connect(amp).connect(this.drums);
    osc.start(when);
    osc.stop(when + 0.35);
  }

  private snare(when: number, velocity: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.get('white');
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.7;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    src.connect(band).connect(amp).connect(this.drums);
    src.start(when, Math.random() * 5, 0.2);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 185;
    const bodyAmp = ctx.createGain();
    bodyAmp.gain.setValueAtTime(velocity * 0.5, when);
    bodyAmp.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    body.connect(bodyAmp).connect(this.drums);
    body.start(when);
    body.stop(when + 0.1);
  }

  private hat(when: number, velocity: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.get('white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity * 0.35, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + rand(0.03, 0.06));
    src.connect(hp).connect(amp).connect(this.drums);
    src.start(when, Math.random() * 5, 0.08);
  }
}

/** Vinyl surface noise: a quiet hiss with sparse pops and ticks. */
function createCrackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 6;
  const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const rng = createRng(77 + ch);
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      let v = (rng() * 2 - 1) * 0.04;
      if (rng() < 0.0006) v += (rng() * 2 - 1) * (rng() < 0.1 ? 1 : 0.4);
      data[i] = v;
    }
  }
  return buffer;
}
