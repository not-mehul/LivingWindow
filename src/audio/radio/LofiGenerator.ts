import { createRng, rand } from '../../core/random';
import type { Modulators } from '../modulation';
import type { Stereo } from '../synth';
import { bass, bell, crackle, guitar, hat, kick, pad, rhodes, rim, shaker, snare } from './instruments';
import { bassNote, chordAt, createTrack, melodyNote, sectionAt, stepDuration, varyMotif, voiceLead, type MotifNote, type Track } from './music';

const STEPS_PER_BAR = 16;
/** How far ahead notes are scheduled (s); longer while the tab is hidden and timers are throttled. */
const LOOKAHEAD = 0.3;
const HIDDEN_LOOKAHEAD = 2;
const TICK_MS = 50;
/** The next track comes in this many bars into the current one's outro, as it fades. */
const HANDOFF_BAR = 2;
/** Most instrument buffers kept at once (oldest dropped first). */
const CACHE_LIMIT = 90;
/** Seconds of vinyl crackle rendered per track. */
const CRACKLE_SECONDS = 21;

/** Rendered instrument notes, each made once and reused while it stays in the cache. */
class Sampler {
  private readonly cache = new Map<string, AudioBuffer>();

  constructor(private readonly ctx: BaseAudioContext) {}

  get(key: string, make: () => Stereo): AudioBuffer {
    let buffer = this.cache.get(key);
    if (buffer) {
      // Refresh its place: most recently used last.
      this.cache.delete(key);
    } else {
      const stereo = make();
      fadeTail(stereo, 0.02);
      buffer = this.ctx.createBuffer(2, stereo.length, stereo.sampleRate);
      buffer.copyToChannel(stereo.left, 0);
      buffer.copyToChannel(stereo.right, 1);
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, buffer);
    return buffer;
  }
}

/** Ease the last `seconds` of a rendered note to silence, so a buffer never ends on a click. */
function fadeTail(stereo: Stereo, seconds: number): void {
  const n = Math.min(stereo.length, Math.floor(seconds * stereo.sampleRate));
  for (let i = 0; i < n; i++) {
    const k = stereo.length - 1 - i;
    const g = i / n;
    stereo.left[k] *= g;
    stereo.right[k] *= g;
  }
}

/** Where a player's sounds go: one bus per instrument family. */
interface Buses {
  keys: AudioNode;
  bass: AudioNode;
  drums: AudioNode;
  lead: AudioNode;
  pad: AudioNode;
}

/**
 * One track playing: walks its bars and sections, scheduling every note
 * ahead on the audio clock into its own gain (so two tracks can overlap
 * while one hands over to the next) and its own tone filter (which sweeps
 * open as the drums come in and closes for the outro).
 */
class TrackPlayer {
  readonly output: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly buses: Buses;
  private readonly rng: () => number;
  private readonly phrases = new Map<number, MotifNote[]>();
  private voicing: number[] | null = null;
  private bar = 0;
  private step = 0;
  nextTime: number;
  finished = false;
  handedOver = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly sampler: Sampler,
    readonly track: Track,
    start: number,
    destination: AudioNode,
  ) {
    this.rng = createRng(Math.floor(Math.random() * 1e9));
    this.nextTime = start;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    this.tone.frequency.value = 900;
    this.tone.connect(this.output).connect(destination);
    const bus = (level: number, through: AudioNode = this.tone) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(through);
      return g;
    };
    // The drums keep their own air: only the outro's fade touches them.
    this.buses = { keys: bus(0.85), bass: bus(0.75), drums: bus(0.85, this.output), lead: bus(0.6), pad: bus(0.7) };
  }

  /** In the outro now (when the next track should start). */
  get barsIntoOutro(): number {
    const { section, bar } = sectionAt(this.track, this.bar);
    return section.name === 'outro' ? bar : -1;
  }

  schedule(until: number): void {
    while (!this.finished && this.nextTime < until) {
      this.playStep(this.nextTime);
      this.nextTime += stepDuration(this.track.bpm, this.track.swing, this.step);
      this.step++;
      if (this.step === STEPS_PER_BAR) {
        this.step = 0;
        this.bar++;
        if (this.bar >= this.track.bars) this.finished = true;
      }
    }
  }

  fadeOut(seconds: number): void {
    const now = this.ctx.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(0, now, seconds / 3);
    this.finished = true;
  }

  dispose(): void {
    this.output.disconnect();
  }

  private playStep(time: number): void {
    const { track, step, rng } = this;
    const { section, bar, index } = sectionAt(track, this.bar);
    const { chord, first, next } = chordAt(section, bar);
    const beat = 60 / track.bpm;
    const chordBars = chord.bars ?? 1;
    const lastBarOfSection = bar === section.bars - 1;
    const nextSection = track.sections[index + 1];
    const human = () => (rng() - 0.5) * 0.014;

    if (step === 0 && bar === 0) {
      // Each section opens or closes the tone; the outro fades the whole track away.
      this.tone.frequency.setTargetAtTime(500 + 9000 * section.brightness ** 2, time, beat * 2);
      if (section.name === 'outro') {
        this.output.gain.setValueAtTime(1, time);
        this.output.gain.linearRampToValueAtTime(0.0001, time + section.bars * 4 * beat);
      }
    }

    // Keys: the chord on its downbeat, voice-led from the last; the odd lazy stab.
    if (step === 0 && first) {
      this.voicing = voiceLead(track.tonic + 12, chord, this.voicing);
      this.chord(this.voicing, time, chordBars * 4 * beat * 0.97, rand(0.5, 0.65));
      this.pad(this.voicing, time, chordBars * 4 * beat);
    } else if (step === 0 && this.voicing && rng() < 0.55) {
      this.chord(this.voicing, time, 4 * beat * 0.95, rand(0.28, 0.38));
    }
    if (section.name !== 'intro' && section.name !== 'outro' && this.voicing && (step === 6 || step === 10) && rng() < 0.16) {
      this.chord(this.voicing, time + human(), beat * 0.7, rand(0.22, 0.32));
    }

    // Bass: root on the downbeat, a fifth or octave later, and a walk into the next chord.
    if (section.name !== 'intro' && !(section.name === 'outro' && bar >= 2)) {
      const root = bassNote(track.tonic, chord);
      if (step === 0) this.bass(root, time, beat * 1.6, 0.9);
      if (step === 10 && rng() < 0.6) this.bass(root + (rng() < 0.6 ? 7 : 12), time + human(), beat * 0.9, 0.7);
      const changing = (first || bar % chordBars === chordBars - 1) && next !== chord;
      if (step === 14 && changing && rng() < 0.35) this.bass(bassNote(track.tonic, next) + (rng() < 0.5 ? 1 : -1), time + human(), beat * 0.4, 0.55);
    }

    this.drums(section.drums, step, time, human, lastBarOfSection, nextSection?.drums ?? 'none');

    // Melody: the motif, varied on its repeats, with a phrase of rest every so often.
    if (section.melody) {
      const motif = track.motif;
      const phrase = Math.floor(bar / motif.bars);
      if (phrase % 4 !== 3) {
        const at = (bar % motif.bars) * STEPS_PER_BAR + step;
        let notes = this.phrases.get(index * 100 + phrase);
        if (!notes) {
          notes = varyMotif(motif, phrase, rng);
          this.phrases.set(index * 100 + phrase, notes);
        }
        for (const note of notes) {
          if (note.step === at) this.lead(melodyNote(track.tonic + 12, chord, note.tone), time + human(), note.length * beat * 0.25, rand(0.5, 0.75));
        }
      }
    }
    if (section.name === 'intro' && step === 0 && bar === section.bars - 1 && rng() < 0.5) {
      // A soft high note to lean into the first A.
      this.lead(melodyNote(track.tonic + 12, chord, 2), time + beat * 2, beat * 2, 0.4);
    }
  }

  private drums(feel: Track['sections'][number]['drums'], step: number, time: number, human: () => number, lastBar: boolean, nextFeel: string): void {
    const { rng } = this;
    // The last bar of a section: a short fill, or a drop-out for space before the next.
    if (lastBar && feel !== 'none') {
      if (step >= 12) {
        if (nextFeel !== 'none' && rng() < 0.5) this.hit('snare', time + human(), 0.15 + (step - 12) * 0.1);
        return;
      }
    }
    if (feel === 'none') {
      if (lastBar && nextFeel !== 'none' && step === 14 && rng() < 0.5) this.hit('snare', time, 0.3);
      return;
    }
    const offbeat = step % 4 === 2;
    if (feel === 'full') {
      if (step === 0 || (step === 10 && rng() < 0.75) || (step === 7 && rng() < 0.2) || (step === 3 && rng() < 0.08)) this.hit('kick', time, step === 0 ? 0.95 : 0.75);
      if (step === 4 || step === 12) this.hit('snare', time + human(), rand(0.7, 0.85));
      else if ((step === 7 || step === 9 || step === 15) && rng() < 0.12) this.hit('snare', time + human(), 0.12);
      if (step === 14 && this.bar % 4 === 3 && rng() < 0.6) this.hit('open', time + human(), 0.35);
      else if (step % 2 === 0) this.hit('hat', time + human(), (offbeat ? 0.42 : step % 4 === 0 ? 0.6 : 0.5) * rand(0.85, 1.1));
      else if (step % 4 === 3 && rng() < 0.12) this.hit('hat', time + human(), 0.2);
    } else if (feel === 'half') {
      if (step === 0 || (step === 11 && rng() < 0.6)) this.hit('kick', time, 0.85);
      if (step === 8) this.hit('snare', time + human(), 0.75);
      if (step === 12 && rng() < 0.3) this.hit('rim', time + human(), 0.5);
      if (step % 2 === 0) this.hit('hat', time + human(), (offbeat ? 0.32 : 0.42) * rand(0.85, 1.1));
    } else {
      if (step === 0 || (step === 8 && rng() < 0.4)) this.hit('kick', time, 0.75);
      if (step === 4 || step === 12) this.hit('rim', time + human(), rand(0.55, 0.7));
      if (step % 2 === 0) this.hit('shaker', time + human(), (offbeat ? 0.8 : 0.55) * rand(0.85, 1.1));
    }
  }

  private play(buffer: AudioBuffer, bus: AudioNode, when: number, gain: number, length?: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(amp).connect(bus);
    const at = Math.max(ctx.currentTime, when);
    src.start(at);
    if (length !== undefined && length < buffer.duration) {
      // Release the note: dampers down.
      amp.gain.setValueAtTime(gain, at + length);
      amp.gain.setTargetAtTime(0, at + length, 0.09);
      src.stop(at + length + 0.6);
    }
    src.addEventListener('ended', () => amp.disconnect(), { once: true });
  }

  private hit(drum: 'kick' | 'snare' | 'hat' | 'open' | 'rim' | 'shaker', when: number, velocity: number): void {
    const rate = this.ctx.sampleRate;
    const make = {
      kick: () => kick(16000),
      snare: () => snare(rate),
      hat: () => hat(rate, false),
      open: () => hat(rate, true),
      rim: () => rim(rate),
      shaker: () => shaker(rate),
    }[drum];
    this.play(this.sampler.get(drum, make), this.buses.drums, when, velocity);
  }

  private chord(notes: readonly number[], when: number, length: number, velocity: number): void {
    // Rolled slightly, low to high, like fingers landing.
    notes.forEach((midi, i) => this.key(midi, when + i * rand(0.008, 0.02), length, velocity * rand(0.9, 1.05)));
  }

  private key(midi: number, when: number, length: number, velocity: number): void {
    const layer = velocity > 0.45 ? 1 : 0.4;
    const buffer = this.sampler.get(`rhodes:${midi}:${layer}`, () => rhodes(midi, layer, 24000));
    this.play(buffer, this.buses.keys, when, velocity / layer, length);
  }

  private bass(midi: number, when: number, length: number, velocity: number): void {
    this.play(this.sampler.get(`bass:${midi}`, () => bass(midi, 16000)), this.buses.bass, when, velocity, length);
  }

  private lead(midi: number, when: number, length: number, velocity: number): void {
    const kind = this.track.lead;
    const buffer = this.sampler.get(`${kind}:${midi}`, () => (kind === 'guitar' ? guitar(midi, 24000) : bell(midi, 24000)));
    this.play(buffer, this.buses.lead, when, velocity, Math.max(length, 0.25) + 0.2);
  }

  private pad(notes: readonly number[], when: number, seconds: number): void {
    const low = notes.map((n) => n - 12);
    const buffer = this.sampler.get(`pad:${low.join(',')}:${seconds.toFixed(2)}`, () => pad(low, seconds, 16000));
    this.play(buffer, this.buses.pad, when, 1);
  }
}

/**
 * "Living Window FM": an endless, generative lofi hip-hop station. Each
 * track picks a key and mode, tempo, swing, two progressions and a motif,
 * and plays them through a song form (intro, A, B, A…, outro) on dusty
 * electric piano, round bass, a lazy swung kit, a plucked guitar or soft
 * bell melody and a quiet pad, with fresh vinyl crackle per record and a
 * slow tape wobble over everything. Each track hands over to the next as
 * its outro fades. Notes are scheduled ahead on the audio clock.
 */
export class LofiGenerator {
  readonly output: GainNode;
  onTrack: ((track: Track) => void) | null = null;

  private readonly ctx: AudioContext;
  private readonly sampler: Sampler;
  private readonly mix: GainNode;
  private readonly wobble: DelayNode;
  private readonly crackleGain: GainNode;
  private crackleSource: AudioBufferSourceNode | null = null;
  private players: TrackPlayer[] = [];
  private stopWobble: Array<() => void> = [];
  private timer: number | undefined;
  private playing = false;
  private upcoming: Track;

  constructor(
    ctx: AudioContext,
    private readonly modulators: Modulators,
  ) {
    this.ctx = ctx;
    this.sampler = new Sampler(ctx);
    this.upcoming = createTrack();
    this.output = ctx.createGain();
    this.output.gain.value = 0.9;
    this.mix = ctx.createGain();
    // Tape: a gently modulated delay line bends the pitch of everything together.
    this.wobble = ctx.createDelay(0.05);
    this.wobble.delayTime.value = 0.012;
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 12000;
    warmth.Q.value = 0.5;
    this.mix.connect(this.wobble).connect(warmth).connect(this.output);
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackleGain.connect(this.output);
  }

  get currentTrack(): Track {
    return this.players[this.players.length - 1]?.track ?? this.upcoming;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    const now = this.ctx.currentTime;
    // Wow (slow, wandering) and flutter (fast, slight).
    this.stopWobble.push(this.modulators.wander(this.wobble.delayTime, 0.0014, 0.3));
    const flutter = this.ctx.createOscillator();
    flutter.frequency.value = 6.5;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.00004;
    flutter.connect(depth).connect(this.wobble.delayTime);
    flutter.start();
    this.stopWobble.push(() => {
      flutter.stop();
      depth.disconnect();
    });
    this.begin(this.upcoming, now + 0.1);
    this.crackleGain.gain.setTargetAtTime(1, now, 0.3);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    window.clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.crackleGain.gain.setTargetAtTime(0, now, 0.2);
    for (const player of this.players) {
      player.fadeOut(0.4);
      window.setTimeout(() => player.dispose(), 2000);
    }
    this.players = [];
    const stops = this.stopWobble;
    this.stopWobble = [];
    const crackle = this.crackleSource;
    this.crackleSource = null;
    window.setTimeout(() => {
      for (const stop of stops) stop();
      crackle?.stop();
    }, 1500);
    // Pick the next record now, so turning the radio back on starts afresh.
    this.upcoming = createTrack();
  }

  /** Skip to a freshly generated track. */
  next(): void {
    if (!this.playing) {
      this.upcoming = createTrack();
      return;
    }
    for (const player of this.players) {
      player.fadeOut(1.5);
      window.setTimeout(() => player.dispose(), 4000);
    }
    this.players = [];
    this.begin(createTrack(), this.ctx.currentTime + 0.4);
  }

  private begin(track: Track, start: number): void {
    this.players.push(new TrackPlayer(this.ctx, this.sampler, track, start, this.mix));
    this.newRecord();
    this.onTrack?.(track);
  }

  /** Fresh surface noise for each record, cross-faded in. */
  private newRecord(): void {
    const ctx = this.ctx;
    const stereo = crackle(CRACKLE_SECONDS, 24000, Math.floor(Math.random() * 1e9));
    const buffer = ctx.createBuffer(2, stereo.length, stereo.sampleRate);
    buffer.copyToChannel(stereo.left, 0);
    buffer.copyToChannel(stereo.right, 1);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const fade = ctx.createGain();
    const now = ctx.currentTime;
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(1, now + 3);
    src.connect(fade).connect(this.crackleGain);
    src.start(now);
    const old = this.crackleSource;
    this.crackleSource = src;
    if (old) {
      const oldFade = ctx.createGain();
      old.disconnect();
      old.connect(oldFade).connect(this.crackleGain);
      oldFade.gain.setValueAtTime(1, now);
      oldFade.gain.linearRampToValueAtTime(0, now + 3);
      old.stop(now + 3.1);
    }
  }

  private schedule(): void {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const lookahead = document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD;
    for (const player of this.players) {
      if (player.finished) continue;
      // If the tab was throttled and we fell behind, resynchronise instead of
      // firing a burst of stale notes.
      if (player.nextTime < now - 0.2) player.nextTime = now + 0.05;
      player.schedule(now + lookahead);
    }
    const current = this.players[this.players.length - 1];
    if (current && !current.handedOver && current.barsIntoOutro >= HANDOFF_BAR) {
      current.handedOver = true;
      this.begin(createTrack(), Math.max(now + 0.1, current.nextTime));
    }
    for (const player of this.players.filter((p) => p.finished && p.nextTime < now - 4)) {
      player.dispose();
      this.players.splice(this.players.indexOf(player), 1);
    }
  }
}
