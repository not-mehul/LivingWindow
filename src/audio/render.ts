/**
 * Offline pre-rendering: a sound built from many oscillators and filters is
 * rendered once into a buffer, then each play is a single buffer source.
 * Dense textures (raindrops, crickets, applause) and the radio's
 * instruments would otherwise create and tear down hundreds of nodes a
 * second.
 */
export class Prerender {
  private readonly ready = new Map<string, AudioBuffer>();
  private readonly pending = new Set<string>();

  constructor(private readonly sampleRate: number) {}

  /**
   * The rendered buffer for `key`, or undefined while it is still being
   * rendered (the first ask starts it). `build` draws the sound into the
   * offline context's destination, starting at time 0, and may return the
   * sound's length so the buffer is trimmed to fit.
   */
  get(key: string, seconds: number, build: (ctx: OfflineAudioContext) => number | void, channels = 1): AudioBuffer | undefined {
    const buffer = this.ready.get(key);
    if (buffer || this.pending.has(key)) return buffer;
    this.pending.add(key);
    void this.render(seconds, build, channels)
      .then((rendered) => {
        if (rendered) this.ready.set(key, rendered);
      })
      .finally(() => this.pending.delete(key));
    return undefined;
  }

  /** Forget a rendered buffer so the next `get` renders it afresh. */
  drop(key: string): void {
    this.ready.delete(key);
  }

  async render(seconds: number, build: (ctx: OfflineAudioContext) => number | void, channels = 1): Promise<AudioBuffer | null> {
    if (typeof OfflineAudioContext === 'undefined') return null;
    try {
      const length = Math.ceil(seconds * this.sampleRate);
      const ctx = new OfflineAudioContext(channels, length, this.sampleRate);
      const used = build(ctx);
      const rendered = await ctx.startRendering();
      const keep = trimmedLength(rendered, typeof used === 'number' ? used : seconds);
      return keep >= rendered.length ? rendered : copyStart(rendered, keep);
    } catch {
      return null;
    }
  }
}

/**
 * How many samples of `buffer` to keep: past the sound's nominal end, up to
 * where it has decayed below -70 dB (so tails ring out naturally), and never
 * more than the buffer holds.
 */
export function trimmedLength(buffer: { length: number; sampleRate: number; numberOfChannels: number; getChannelData(ch: number): Float32Array }, nominal: number): number {
  const from = Math.min(buffer.length, Math.floor(nominal * buffer.sampleRate));
  let last = from;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = buffer.length - 1; i >= from; i--) {
      if (Math.abs(data[i]) > 3e-4) {
        last = Math.max(last, i + 1);
        break;
      }
    }
  }
  return Math.min(buffer.length, last + Math.floor(buffer.sampleRate * 0.01));
}

function copyStart(buffer: AudioBuffer, length: number): AudioBuffer {
  const out = new AudioBuffer({ length: Math.max(1, length), numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) out.copyToChannel(buffer.getChannelData(ch).subarray(0, length), ch);
  // Ease the last few ms out so a trimmed tail can't click.
  const fade = Math.min(length, Math.floor(buffer.sampleRate * 0.005));
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    for (let i = 0; i < fade; i++) data[length - 1 - i] *= i / fade;
  }
  return out;
}
