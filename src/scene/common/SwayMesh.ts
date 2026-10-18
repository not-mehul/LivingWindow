import { MeshPlane, type Texture } from 'pixi.js';

/**
 * Which edge is fixed: trees and ferns are rooted at the bottom, canopy
 * hangs from the top, and boughs and limbs grow out of a trunk at their left
 * or right end (so they bob up and down rather than swing sideways).
 */
export type SwayAnchor = 'bottom' | 'top' | 'left' | 'right';

export interface SwayOptions {
  anchor?: SwayAnchor;
  /** Peak sway in art pixels in a strong wind. */
  amplitude?: number;
  /** Phase offset so neighbouring plants don't move in lockstep. */
  phase?: number;
  /** Sway speed (radians per second at the base frequency). */
  frequency?: number;
  /** Vertex rows (more rows = smoother bend). */
  rows?: number;
  /** Vertex columns; wide pieces get more, so gusts bend them unevenly across instead of shearing them. */
  columns?: number;
  /**
   * The same art with its leaves stirred (see `rustleFrames`): the mesh flicks
   * between them as the wind moves through the leaves, faster in a gust.
   */
  rustle?: readonly Texture[];
  /** Leaf flicks per second in a full wind. */
  rustleRate?: number;
}

/**
 * A texture on a vertex grid that bends with the wind: free ends move most,
 * rooted ends not at all.
 *
 * Offsets are left fractional (the renderer doesn't round vertices). The
 * world is drawn at its native resolution with nearest sampling, so the art
 * stays crisp, but each scanline between two vertex rows crosses the
 * half-pixel mark at its own moment: the bend slides smoothly along the plant
 * a line at a time, rather than whole bands of it snapping across together.
 * The tip lags the root a little, as a real stem whips; gusts roll across the
 * view so neighbouring plants (and the two sides of a wide one) move in turn;
 * and leafy pieces rustle, flicking between stirred copies of their leaves.
 */
export class SwayMesh {
  readonly mesh: MeshPlane;
  private readonly base: Float32Array;
  private readonly rows: number;
  private readonly cols: number;
  private readonly anchor: SwayAnchor;
  private readonly amplitude: number;
  private readonly phase: number;
  private readonly frequency: number;
  /** Offsets along the free axis, one set per column (vertical anchors) or row (side anchors). */
  private readonly offsets: Float32Array;
  private readonly rustle: readonly Texture[];
  private readonly rustleRate: number;
  private rustleClock = 0;
  private rustleFrame = 0;
  private lastTime = Number.NaN;

  constructor(texture: Texture, options: SwayOptions = {}) {
    this.anchor = options.anchor ?? 'bottom';
    const side = this.anchor === 'left' || this.anchor === 'right';
    this.rows = options.rows ?? (side ? Math.max(2, Math.ceil(texture.height / 24) + 1) : Math.max(3, Math.ceil(texture.height / 3)));
    this.cols = options.columns ?? (side ? Math.max(3, Math.ceil(texture.width / 3)) : texture.width > 60 ? Math.ceil(texture.width / 30) + 1 : 2);
    this.mesh = new MeshPlane({ texture, verticesX: this.cols, verticesY: this.rows });
    this.base = new Float32Array(this.mesh.geometry.positions);
    this.offsets = new Float32Array(side ? this.cols : this.rows);
    this.amplitude = options.amplitude ?? 3;
    this.phase = options.phase ?? Math.random() * Math.PI * 2;
    this.frequency = options.frequency ?? 0.9 + Math.random() * 0.4;
    this.rustle = options.rustle && options.rustle.length > 1 ? options.rustle : [];
    this.rustleRate = options.rustleRate ?? 5;
    this.rustleClock = Math.random() * 10;
  }

  /** `scale` (0..1) damps the whole motion, e.g. indoors with the window shut. */
  update(time: number, wind: number, scale = 1): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    const positions = this.mesh.geometry.positions;
    const { rows, cols, base, offsets } = this;
    const amplitude = this.amplitude * scale;
    let moved = false;
    if (this.anchor === 'left' || this.anchor === 'right') {
      // A bough: it bobs up and down along its length (and gives a little sideways), all rows together.
      swayOffsets(offsets, time, wind, this.mesh.x + base[(cols - 1) * 2] / 2, amplitude, this.frequency, this.phase, this.anchor === 'right' ? 'bottom' : 'top');
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = (j * cols + i) * 2;
          // Pressed down a little in a strong wind, bobbing about that.
          const o = offsets[i];
          const y = base[k + 1] + Math.abs(o) * 0.35 + o * 0.65;
          const x = base[k] + o * 0.25;
          if (Math.abs(positions[k + 1] - y) > 0.004 || Math.abs(positions[k] - x) > 0.004) moved = true;
          positions[k] = x;
          positions[k + 1] = y;
        }
      }
    } else {
      // Each column has its own gust phase (by its x across the view), so a wide crown bends unevenly.
      for (let i = 0; i < cols; i++) {
        const colX = this.mesh.x + base[i * 2];
        swayOffsets(offsets, time, wind, colX, amplitude, this.frequency, this.phase, this.anchor);
        for (let j = 0; j < rows; j++) {
          const k = (j * cols + i) * 2;
          const x = base[k] + offsets[j];
          if (Math.abs(positions[k] - x) > 0.004) moved = true;
          positions[k] = x;
        }
      }
    }
    if (moved) this.mesh.geometry.getBuffer('aPosition').update();

    if (this.rustle.length) {
      // Leaves flick over in the moving air: barely at all in a calm, quickly in a gust.
      const calm = Math.min(1, Math.abs(wind)) * scale;
      const gust = 0.6 + 0.4 * Math.sin(time * 0.21 - this.mesh.x * 0.011 + this.phase * 0.3);
      this.rustleClock += dt * this.rustleRate * (0.12 + calm * gust);
      const frame = Math.floor(this.rustleClock) % this.rustle.length;
      if (frame !== this.rustleFrame) {
        this.rustleFrame = frame;
        this.mesh.texture = this.rustle[frame];
      }
    }
  }

  /**
   * How far the art has moved at a point on it (art px from the mesh's
   * top-left), for things that sit on it to move with it: a squirrel on a
   * trunk, a bird on a bough.
   */
  offsetAt(localX: number, localY: number): { x: number; y: number } {
    const { rows, cols, base } = this;
    const positions = this.mesh.geometry.positions;
    const w = base[(cols - 1) * 2] || 1;
    const h = base[((rows - 1) * cols) * 2 + 1] || 1;
    const fx = Math.max(0, Math.min(cols - 1.0001, (localX / w) * (cols - 1)));
    const fy = Math.max(0, Math.min(rows - 1.0001, (localY / h) * (rows - 1)));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const d = (ii: number, jj: number, axis: 0 | 1) => {
      const k = (jj * cols + ii) * 2 + axis;
      return positions[k] - base[k];
    };
    const at = (axis: 0 | 1) => (d(i, j, axis) * (1 - u) + d(i + 1, j, axis) * u) * (1 - v) + (d(i, j + 1, axis) * (1 - u) + d(i + 1, j + 1, axis) * u) * v;
    return { x: at(0), y: at(1) };
  }
}

/**
 * The offset (art px) of each vertex along the free axis, from the top (or
 * left) end first: a steady lean downwind, a sway that grows with the wind,
 * swelling as gusts roll across the view (by `x`), and the free end lagging
 * behind the root.
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
