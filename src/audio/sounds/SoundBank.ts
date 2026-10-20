import type { NoiseBank } from '../noise';
import type { Prerender } from '../render';
import { SYNTH_VOICES } from './voices';

export type SoundId = keyof typeof SYNTH_VOICES;

export const SOUND_IDS = Object.keys(SYNTH_VOICES) as SoundId[];

/** Voices that must stay live (they carry state from one play to the next). */
const LIVE_ONLY: ReadonlySet<SoundId> = new Set(['guitar-strum']);
/** Rendered takes kept per synth voice, and the chance a play renders a fresh one. */
const TAKES = 5;
const REFRESH = 0.2;
/** Longest any synth voice runs (s). */
const MAX_VOICE_SECONDS = 7;

/**
 * One-shot sounds by id. Each id plays a recorded sample when one has been
 * loaded (several variants are picked at random), otherwise its synthesized
 * stand-in. Synth voices are rendered offline into a handful of takes, which
 * are refreshed now and then, so each play is one buffer source rather than
 * a tangle of oscillators, without ever repeating exactly.
 */
export class SoundBank {
  private readonly samples = new Map<SoundId, AudioBuffer[]>();
  private readonly takes = new Map<SoundId, AudioBuffer[]>();
  private readonly rendering = new Set<SoundId>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly noise: NoiseBank,
    private readonly prerender?: Prerender,
  ) {}

  /** Register decoded recordings for a sound (replacing its synth voice). */
  addSamples(id: SoundId, buffers: AudioBuffer[]): void {
    if (buffers.length > 0) this.samples.set(id, [...(this.samples.get(id) ?? []), ...buffers]);
  }

  /** Play a sound into `out`. Returns its duration in seconds. */
  play(id: SoundId, out: AudioNode, when: number, gain: number, rate: number): number {
    const variants = this.samples.get(id) ?? this.synthTakes(id);
    if (variants && variants.length > 0) {
      const buffer = variants[Math.floor(Math.random() * variants.length)];
      const src = this.context.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const amp = this.context.createGain();
      amp.gain.value = gain;
      src.connect(amp).connect(out);
      src.start(when);
      src.addEventListener('ended', () => amp.disconnect(), { once: true });
      return buffer.duration / rate;
    }
    return SYNTH_VOICES[id](this.context, out, when, gain, rate, this.noise);
  }

  /** Rendered takes of a synth voice (none until the first has rendered). */
  private synthTakes(id: SoundId): AudioBuffer[] | undefined {
    if (!this.prerender || LIVE_ONLY.has(id)) return undefined;
    const takes = this.takes.get(id) ?? [];
    if (takes.length < TAKES || Math.random() < REFRESH) this.renderTake(id);
    return takes.length > 0 ? takes : undefined;
  }

  private renderTake(id: SoundId): void {
    if (this.rendering.has(id) || !this.prerender) return;
    this.rendering.add(id);
    void this.prerender
      .render(MAX_VOICE_SECONDS, (ctx) => SYNTH_VOICES[id](ctx, ctx.destination, 0, 1, 1, this.noise))
      .then((buffer) => {
        if (!buffer) return;
        const takes = this.takes.get(id) ?? [];
        if (takes.length < TAKES) takes.push(buffer);
        else takes[Math.floor(Math.random() * takes.length)] = buffer;
        this.takes.set(id, takes);
      })
      .finally(() => this.rendering.delete(id));
  }
}
