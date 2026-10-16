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
 * ends bend most, rooted ends not at all. Offsets are rounded to whole art
 * pixels, so the sway stays pixel-art crisp in the native-resolution world.
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

  constructor(texture: Texture, options: SwayOptions = {}) {
    this.rows = options.rows ?? Math.max(3, Math.ceil(texture.height / 6));
    this.mesh = new MeshPlane({ texture, verticesX: this.cols, verticesY: this.rows });
    this.base = new Float32Array(this.mesh.geometry.positions);
    this.anchor = options.anchor ?? 'bottom';
    this.amplitude = options.amplitude ?? 3;
    this.phase = options.phase ?? Math.random() * Math.PI * 2;
    this.frequency = options.frequency ?? 0.9 + Math.random() * 0.4;
  }

  /** `scale` (0..1) damps the whole motion, e.g. indoors with the window shut. */
  update(time: number, wind: number, scale = 1): void {
    const positions = this.mesh.geometry.positions;
    const strength = 0.25 + Math.min(1, Math.abs(wind)) * 0.75;
    const t = time * this.frequency + this.phase;
    const wave = 0.65 * Math.sin(t) + 0.35 * Math.sin(t * 2.3 + this.phase * 1.7);
    for (let j = 0; j < this.rows; j++) {
      const along = j / (this.rows - 1); // 0 at the top row
      const free = this.anchor === 'bottom' ? 1 - along : along;
      const bend = free ** 1.6;
      // A steady lean downwind plus a swaying oscillation.
      const offset = Math.round(this.amplitude * scale * bend * (wind * 0.6 + wave * strength));
      for (let i = 0; i < this.cols; i++) {
        const k = (j * this.cols + i) * 2;
        positions[k] = this.base[k] + offset;
      }
    }
    this.mesh.geometry.getBuffer('aPosition').update();
  }
}
