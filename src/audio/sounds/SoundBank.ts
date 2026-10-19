import type { NoiseBank } from '../noise';
import { SYNTH_VOICES } from './voices';

export type SoundId = keyof typeof SYNTH_VOICES;

export const SOUND_IDS = Object.keys(SYNTH_VOICES) as SoundId[];

/**
 * One-shot sounds by id. Each id plays a recorded sample when one has been
 * loaded (several variants are picked at random), otherwise its synthesized
 * stand-in.
 */
export class SoundBank {
  private readonly samples = new Map<SoundId, AudioBuffer[]>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly noise: NoiseBank,
  ) {}

  /** Register decoded recordings for a sound (replacing its synth voice). */
  addSamples(id: SoundId, buffers: AudioBuffer[]): void {
    if (buffers.length > 0) this.samples.set(id, [...(this.samples.get(id) ?? []), ...buffers]);
  }

  /** Play a sound into `out`. Returns its duration in seconds. */
  play(id: SoundId, out: AudioNode, when: number, gain: number, rate: number): number {
    const variants = this.samples.get(id);
    if (variants && variants.length > 0) {
      const buffer = variants[Math.floor(Math.random() * variants.length)];
      const src = this.context.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const amp = this.context.createGain();
      amp.gain.value = gain;
      src.connect(amp).connect(out);
      src.start(when);
      return buffer.duration / rate;
    }
    return SYNTH_VOICES[id](this.context, out, when, gain, rate, this.noise);
  }
}
