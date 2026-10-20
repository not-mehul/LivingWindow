import { createRng } from '../core/random';

/** Knots in the control buffer (one per second at playback rate 1). */
const KNOTS = 64;
/** Control signals need few samples; 3 kHz is the lowest rate browsers accept. */
const CONTROL_RATE = 3000;

/**
 * A smooth, looping random wander in [-1, 1]: random knots joined by
 * cosine-eased curves, the last knot meeting the first so it loops without
 * a step. `samplesPerKnot` sets how many samples each knot spans.
 */
export function wanderCurve(knots: number, samplesPerKnot: number, rng: () => number): Float32Array {
  const points = Array.from({ length: knots }, () => rng() * 2 - 1);
  const out = new Float32Array(knots * samplesPerKnot);
  for (let k = 0; k < knots; k++) {
    const a = points[k];
    const b = points[(k + 1) % knots];
    for (let s = 0; s < samplesPerKnot; s++) {
      const t = (1 - Math.cos((s / samplesPerKnot) * Math.PI)) / 2;
      out[k * samplesPerKnot + s] = a + (b - a) * t;
    }
  }
  return out;
}

/**
 * Slow random modulation that runs entirely on the audio clock. Rather than
 * nudging parameters from the frame loop (which ties texture to frame rate
 * and freezes in a background tab), each wander is a looping control buffer
 * played into an AudioParam: it never stops, never steps and costs no JS.
 */
export class Modulators {
  private buffer: AudioBuffer | null = null;

  constructor(private readonly context: BaseAudioContext) {}

  /**
   * Wander `param` around its own value by up to ±`depth`, changing about
   * `rate` times a second. Returns a stop function.
   */
  wander(param: AudioParam, depth: number, rate: number): () => void {
    const ctx = this.context;
    const src = ctx.createBufferSource();
    src.buffer = this.curve();
    src.loop = true;
    src.playbackRate.value = rate;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    src.connect(amount).connect(param);
    src.start(ctx.currentTime, Math.random() * KNOTS);
    return () => {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
      amount.disconnect();
    };
  }

  /**
   * A gain stage that flutters around 1 (±`depth`): put it in a chain to make
   * a level breathe in proportion, whatever the level is set to.
   */
  flutter(depth: number, rate: number): GainNode {
    const g = this.context.createGain();
    g.gain.value = 1;
    this.wander(g.gain, depth, rate);
    return g;
  }

  private curve(): AudioBuffer {
    if (!this.buffer) {
      const data = wanderCurve(KNOTS, CONTROL_RATE, createRng(4242));
      this.buffer = this.context.createBuffer(1, data.length, CONTROL_RATE);
      this.buffer.getChannelData(0).set(data);
    }
    return this.buffer;
  }
}
