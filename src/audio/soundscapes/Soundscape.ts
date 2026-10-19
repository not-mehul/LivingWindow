import type { Environment } from '../../scene/Environment';
import type { AudioEngine } from '../AudioEngine';
import type { NoiseColor } from '../noise';

/**
 * Base class for a landscape's ambience. Everything it plays goes through
 * `bed` into the ambience bus, so a whole soundscape can be faded out and
 * torn down when the view changes to another landscape.
 */
export abstract class Soundscape {
  protected readonly bed: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private disposed = false;

  constructor(protected readonly engine: AudioEngine) {
    const ctx = engine.context;
    this.bed = ctx.createGain();
    // Fade in rather than popping on.
    this.bed.gain.setValueAtTime(0, ctx.currentTime);
    this.bed.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    this.bed.connect(engine.inputs.ambience);
  }

  /**
   * @param level a landscape-specific activity level (crowd size, herd…), 0..1
   */
  abstract update(dt: number, env: Environment, level: number): void;

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ctx = this.engine.context;
    this.bed.gain.cancelScheduledValues(ctx.currentTime);
    this.bed.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    window.setTimeout(() => {
      for (const source of this.sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        source.disconnect();
      }
      this.bed.disconnect();
    }, 1200);
  }

  /** A looping noise source that is stopped on dispose. */
  protected noise(color: NoiseColor): AudioBufferSourceNode {
    const source = this.engine.noise.source(color);
    this.sources.push(source);
    return source;
  }

  /** A looping recording that is stopped on dispose. */
  protected loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const ctx = this.engine.context;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start(0, Math.random() * buffer.duration);
    this.sources.push(source);
    return source;
  }

  protected gain(value = 0): GainNode {
    const g = this.engine.context.createGain();
    g.gain.value = value;
    return g;
  }

  protected filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const f = this.engine.context.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }
}
