import { Graphics } from 'pixi.js';

interface Lamp {
  x: number;
  y: number;
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
    positions: ReadonlyArray<{ x: number; y: number }>,
    private readonly groundY: number,
    private readonly rng: () => number,
  ) {
    this.lamps = positions.map(({ x, y }) => ({
      x,
      y,
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
      g.rect(lamp.x - 1, lamp.y, 2, 1).fill(0xffe7a8);
      g.rect(lamp.x - 1, lamp.y + 1, 2, 1).fill({ color: 0xffd27a, alpha: 0.6 });
      // A faint dithered cone, densest just under the lamp, ending in a
      // brighter pool on the pavement.
      const height = this.groundY - lamp.y;
      for (let dy = 2; dy < height; dy++) {
        const half = 1 + Math.floor(dy * 0.6);
        const fall = 1 - dy / height;
        for (let dx = -half; dx <= half; dx++) {
          const edge = 1 - Math.abs(dx) / (half + 1);
          const threshold = (BAYER_4[(lamp.y + dy) & 3][(lamp.x + dx) & 3] + 0.5) / 16;
          if (fall * edge * 0.42 > threshold) {
            g.rect(lamp.x + dx, lamp.y + dy, 1, 1).fill({ color: 0xffd890, alpha: 0.22 });
          }
        }
      }
      const pool = 3 + Math.floor(height * 0.6);
      g.rect(lamp.x - pool, this.groundY - 1, pool * 2, 2).fill({ color: 0xffd890, alpha: 0.28 });
      g.rect(lamp.x - Math.floor(pool / 2), this.groundY - 1, pool, 2).fill({ color: 0xffe2a8, alpha: 0.3 });
    }
  }
}
