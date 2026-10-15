import { Graphics } from 'pixi.js';
import type { LitWindow, WindowLights } from './WindowLights';

interface Occupant {
  window: LitWindow;
  kind: 'walker' | 'tv';
  t: number;
  duration: number;
  direction: 1 | -1;
  tvColor: number;
  tvTimer: number;
}

const TV_COLORS = [0x8fb8ff, 0x6f9fe8, 0xc8dcff, 0x9d8cff, 0xb0e0ff, 0x7aa0d0];
const MAX_OCCUPANTS = 7;

/**
 * Signs of life behind lit windows: a silhouette strolling past, or the blue
 * flicker of a TV. Drawn on top of a layer's window lights.
 */
export class WindowLife {
  readonly graphics = new Graphics();
  private readonly occupants: Occupant[] = [];
  private spawnTimer = 2;

  constructor(
    private readonly lights: WindowLights,
    private readonly rng: () => number = Math.random,
  ) {}

  update(dt: number, emissive: number, darkness: number): void {
    this.graphics.alpha = emissive;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // More going on in the evening, when people are home.
      this.spawnTimer = (1 + this.rng() * 4) / Math.max(0.2, darkness);
      if (this.occupants.length < MAX_OCCUPANTS && darkness > 0.3) this.spawn();
    }

    const g = this.graphics;
    g.clear();
    for (let i = this.occupants.length - 1; i >= 0; i--) {
      const o = this.occupants[i];
      o.t += dt;
      if (o.t >= o.duration || !o.window.lit) {
        this.occupants.splice(i, 1);
        continue;
      }
      const w = o.window;
      if (o.kind === 'walker') {
        // A 1-px-wide figure crossing the window: head, then shoulders.
        const progress = o.t / o.duration;
        const span = w.w + 2;
        const x = Math.floor(o.direction > 0 ? w.x - 1 + progress * span : w.x + w.w - progress * span);
        if (x >= w.x && x < w.x + w.w) {
          g.rect(x, w.y + w.h - 2, 1, 2).fill({ color: 0x2a1e18, alpha: 0.75 });
          if (w.h >= 3) g.rect(x, w.y + w.h - 3, 1, 1).fill({ color: 0x2a1e18, alpha: 0.6 });
        }
      } else {
        o.tvTimer -= dt;
        if (o.tvTimer <= 0) {
          o.tvTimer = 0.12 + this.rng() * 0.45;
          o.tvColor = TV_COLORS[Math.floor(this.rng() * TV_COLORS.length)];
        }
        g.rect(w.x, w.y, w.w, w.h).fill({ color: o.tvColor, alpha: 0.85 });
      }
    }
  }

  private spawn(): void {
    const window = this.lights.randomLitWindow(this.rng);
    if (!window || this.occupants.some((o) => o.window === window)) return;
    const tv = this.rng() < 0.35;
    this.occupants.push({
      window,
      kind: tv ? 'tv' : 'walker',
      t: 0,
      duration: tv ? 20 + this.rng() * 50 : 1.8 + this.rng() * 2.2,
      direction: this.rng() < 0.5 ? 1 : -1,
      tvColor: TV_COLORS[0],
      tvTimer: 0,
    });
  }
}
