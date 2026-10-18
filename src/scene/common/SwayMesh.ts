import { MeshPlane, type Texture } from 'pixi.js';

export interface SwayOptions {
  /** Which edge is fixed: trees and ferns are rooted at the bottom, canopy hangs from the top. */
  anchor?: 'bottom' | 'top';
  /** Peak sway in art pixels in a strong wind. */
  amplitude?: number;
  /** Phase offset so neighbouring plants don't move in lockstep. */
  phase?: number;
  /** Sway speed (radians per second at the base frequency). */
  frequency?: number;
  /** Vertex rows (more rows = smoother bend). */
  rows?: number;
}

/**
 * A texture on a vertex grid whose rows shift sideways with the wind: free
 * ends bend most, rooted ends not at all.
 *
 * Offsets are left fractional. The world is drawn at its native resolution
 * with nearest sampling, so the art stays crisp, but each scanline between
 * two vertex rows crosses the half-pixel mark at its own moment: the bend
 * slides smoothly up the plant a line at a time, rather than whole bands of
 * it snapping across together. The tip lags the root a little, as a real
 * stem whips, and gusts roll across the view so neighbouring plants sway in
 * turn.
 */
export class SwayMesh {
  readonly mesh: MeshPlane;
  private readonly base: Float32Array;
  private readonly rows: number;
  private readonly cols = 2;
  private readonly anchor: 'bottom' | 'top';
  private readonly amplitude: number;
  private readonly phase: number;
  private readonly frequency: number;
  private readonly offsets: Float32Array;

  constructor(texture: Texture, options: SwayOptions = {}) {
    this.rows = options.rows ?? Math.max(3, Math.ceil(texture.height / 3));
    this.mesh = new MeshPlane({ texture, verticesX: this.cols, verticesY: this.rows });
    this.base = new Float32Array(this.mesh.geometry.positions);
    this.offsets = new Float32Array(this.rows);
    this.anchor = options.anchor ?? 'bottom';
    this.amplitude = options.amplitude ?? 3;
    this.phase = options.phase ?? Math.random() * Math.PI * 2;
    this.frequency = options.frequency ?? 0.9 + Math.random() * 0.4;
  }

  /** `scale` (0..1) damps the whole motion, e.g. indoors with the window shut. */
  update(time: number, wind: number, scale = 1): void {
    const offsets = this.offsets;
    swayOffsets(offsets, time, wind, this.mesh.x, this.amplitude * scale, this.frequency, this.phase, this.anchor);
    const positions = this.mesh.geometry.positions;
    let moved = false;
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const k = (j * this.cols + i) * 2;
        const x = this.base[k] + offsets[j];
        if (Math.abs(positions[k] - x) > 0.004) moved = true;
        positions[k] = x;
      }
    }
    if (moved) this.mesh.geometry.getBuffer('aPosition').update();
  }
}

/**
 * The sideways offset (art px) of each vertex row, top row first: a steady
 * lean downwind, a sway that grows with the wind, swelling as gusts roll
 * across the view (by `x`), and the free end lagging behind the root.
 */
export function swayOffsets(out: Float32Array, time: number, wind: number, x: number, amplitude: number, frequency: number, phase: number, anchor: 'bottom' | 'top'): Float32Array {
  const rows = out.length;
  const calm = Math.min(1, Math.abs(wind));
  const strength = 0.3 + calm * 0.7;
  // A gust front sweeping across the panorama every half-minute or so, in the wind's direction.
  const gust = 0.75 + 0.25 * Math.sin(time * 0.21 - x * 0.011 * Math.sign(wind || 1) + phase * 0.3) + 0.15 * calm * Math.sin(time * 0.53 - x * 0.023);
  const t = time * frequency + phase;
  for (let j = 0; j < rows; j++) {
    const along = j / (rows - 1); // 0 at the top row
    const free = anchor === 'bottom' ? 1 - along : along;
    const bend = free ** 1.6;
    const lag = free * 0.55;
    const wave = 0.65 * Math.sin(t - lag) + 0.35 * Math.sin(t * 2.3 + phase * 1.7 - lag * 1.6);
    out[j] = amplitude * bend * (wind * 0.6 * gust + wave * strength * gust);
  }
  return out;
}
