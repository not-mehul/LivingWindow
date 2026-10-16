import { Graphics } from 'pixi.js';

interface Lamp {
  x: number;
  y: number;
  /** Where its light falls on the street, and how near it is (1 = at the foot of the view). */
  groundY: number;
  scale: number;
  /** Darkness level at which this lamp's sensor trips. */
  threshold: number;
  on: boolean;
  /** Seconds left in the warm-up flicker. */
  flicker: number;
  flickerLit: boolean;
  flickerTimer: number;
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Sodium street lamps that flicker on one by one as darkness falls and cast
 * a dithered pool of light on the sidewalk below.
 */
export class StreetLamps {
  readonly graphics = new Graphics();
  private readonly lamps: Lamp[];
  private dirty = true;

  constructor(
    positions: ReadonlyArray<{ x: number; y: number; groundY: number; scale: number }>,
    private readonly rng: () => number,
  ) {
    this.lamps = positions.map(({ x, y, groundY, scale }) => ({
      x,
      y,
      groundY,
      scale,
      threshold: 0.42 + rng() * 0.16,
      on: false,
      flicker: 0,
      flickerLit: false,
      flickerTimer: 0,
    }));
  }

  update(dt: number, darkness: number, emissive: number): void {
    this.graphics.alpha = emissive;
    for (const lamp of this.lamps) {
      const wantOn = lamp.on ? darkness > lamp.threshold - 0.05 : darkness > lamp.threshold;
      if (wantOn && !lamp.on) {
        lamp.on = true;
        lamp.flicker = 0.5 + this.rng() * 1.2;
        lamp.flickerTimer = 0;
      } else if (!wantOn && lamp.on) {
        lamp.on = false;
        lamp.flicker = 0;
        this.dirty = true;
      }
      if (lamp.flicker > 0) {
        lamp.flicker -= dt;
        lamp.flickerTimer -= dt;
        if (lamp.flickerTimer <= 0 || lamp.flicker <= 0) {
          lamp.flickerLit = lamp.flicker <= 0 ? true : !lamp.flickerLit;
          lamp.flickerTimer = 0.04 + this.rng() * 0.16;
          this.dirty = true;
        }
      }
    }
    if (this.dirty) this.redraw();
  }

  private redraw(): void {
    this.dirty = false;
    const g = this.graphics;
    g.clear();
    for (const lamp of this.lamps) {
      const lit = lamp.on && (lamp.flicker <= 0 || lamp.flickerLit);
      if (!lit) continue;
      const head = Math.max(1, Math.round(3 * lamp.scale));
      g.rect(lamp.x - head, lamp.y, head * 2, Math.max(1, head - 1)).fill(0xffe7a8);
      g.rect(lamp.x - head, lamp.y + Math.max(1, head - 1), head * 2, 1).fill({ color: 0xffd27a, alpha: 0.6 });
      // A faint dithered cone, densest just under the lamp, ending in a
      // brighter pool on the pavement (which lies flat, so it's squashed).
      const height = lamp.groundY - lamp.y;
      for (let dy = 2; dy < height; dy++) {
        const half = 1 + Math.floor(dy * 0.5);
        const fall = 1 - dy / height;
        for (let dx = -half; dx <= half; dx++) {
          const edge = 1 - Math.abs(dx) / (half + 1);
          const threshold = (BAYER_4[(lamp.y + dy) & 3][(lamp.x + dx) & 3] + 0.5) / 16;
          if (fall * edge * 0.42 > threshold) {
            g.rect(lamp.x + dx, lamp.y + dy, 1, 1).fill({ color: 0xffd890, alpha: 0.22 });
          }
        }
      }
      // The pool on the pavement: a dithered ellipse, squashed because it lies flat.
      const rx = 2 + height * 0.7;
      const ry = Math.max(1, height * 0.2);
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
        for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
          const d = (dx / rx) ** 2 + (dy / ry) ** 2;
          if (d > 1) continue;
          const threshold = (BAYER_4[(lamp.groundY + dy) & 3][(lamp.x + dx) & 3] + 0.5) / 16;
          if ((1 - d) * 0.9 > threshold) g.rect(lamp.x + dx, lamp.groundY + dy, 1, 1).fill({ color: d < 0.3 ? 0xffe2a8 : 0xffd890, alpha: 0.3 });
        }
      }
    }
  }
}
