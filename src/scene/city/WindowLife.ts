import { Graphics } from 'pixi.js';
import type { LitWindow, WindowLights } from './WindowLights';

type OccupantKind = 'walker' | 'tv' | 'cat' | 'curtain';

interface Occupant {
  window: LitWindow;
  kind: OccupantKind;
  t: number;
  duration: number;
  direction: 1 | -1;
  tvColor: number;
  tvTimer: number;
}

const TV_COLORS = [0x8fb8ff, 0x6f9fe8, 0xc8dcff, 0x9d8cff, 0xb0e0ff, 0x7aa0d0];
const MAX_OCCUPANTS = 7;
const SHADOW = 0x2a1e18;
const CURTAIN = 0x6a3a2a;

/**
 * Signs of life behind lit windows: someone walking past (a head and
 * shoulders against the light), a cat settling on the sill, a curtain drawn
 * across, or the blue flicker of a TV. Drawn on top of a layer's window lights.
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
      // Only ever inside the window's frame.
      const px = (x: number, y: number, width: number, height: number, color: number, alpha: number) => {
        const x0 = Math.max(w.x, x);
        const y0 = Math.max(w.y, y);
        const x1 = Math.min(w.x + w.w, x + width);
        const y1 = Math.min(w.y + w.h, y + height);
        if (x1 > x0 && y1 > y0) g.rect(x0, y0, x1 - x0, y1 - y0).fill({ color, alpha });
      };
      const bottom = w.y + w.h;
      if (o.kind === 'walker') {
        // Head and shoulders crossing the window, bobbing a little with each step.
        const progress = o.t / o.duration;
        const span = w.w + 4;
        const x = Math.floor(o.direction > 0 ? w.x - 2 + progress * span : w.x + w.w + 1 - progress * span);
        const bob = Math.floor(o.t * 4) % 2;
        const wide = w.w >= 4;
        px(x - (wide ? 1 : 0), bottom - 2 + bob, wide ? 3 : 1, 3, SHADOW, 0.8);
        px(x, bottom - 3 + bob, 1, 1, SHADOW, 0.8);
        if (w.h >= 5 && wide) px(x, bottom - 4 + bob, 1, 1, SHADOW, 0.75);
      } else if (o.kind === 'cat') {
        // A cat on the sill: a loaf with two ears and a tail hanging down, now and then turning its head.
        const cx = o.direction > 0 ? w.x + 1 : w.x + w.w - 3;
        px(cx, bottom - 2, 3, 2, SHADOW, 0.85);
        const look = Math.floor(o.t / 2.5) % 3 === 2 ? 1 : 0;
        px(cx + look, bottom - 3, 1, 1, SHADOW, 0.85);
        px(cx + 2 + look - (look ? 1 : 0), bottom - 3, 1, 1, SHADOW, 0.85);
        px(o.direction > 0 ? cx + 3 : cx - 1, bottom - 1, 1, 1, SHADOW, 0.6);
      } else if (o.kind === 'curtain') {
        // Drawn across from one side, then left closed: the room glows warm through it.
        const shut = Math.min(1, o.t / 1.6);
        const width = Math.ceil(w.w * shut);
        const x = o.direction > 0 ? w.x : w.x + w.w - width;
        px(x, w.y, width, w.h, CURTAIN, 0.55);
        if (width > 1) px(o.direction > 0 ? x + width - 1 : x, w.y, 1, w.h, SHADOW, 0.35);
      } else {
        o.tvTimer -= dt;
        if (o.tvTimer <= 0) {
          o.tvTimer = 0.12 + this.rng() * 0.45;
          o.tvColor = TV_COLORS[Math.floor(this.rng() * TV_COLORS.length)];
        }
        g.rect(w.x, w.y, w.w, w.h).fill({ color: o.tvColor, alpha: 0.85 });
        // Someone on the sofa, watching.
        if (w.w >= 4 && w.h >= 4) px(w.x + Math.floor(w.w / 2) - 1, bottom - 2, 3, 2, SHADOW, 0.7);
      }
    }
  }

  private spawn(): void {
    const window = this.lights.randomLitWindow(this.rng);
    if (!window || this.occupants.some((o) => o.window === window)) return;
    const roll = this.rng();
    const kind: OccupantKind = roll < 0.3 ? 'tv' : roll < 0.4 ? 'cat' : roll < 0.5 ? 'curtain' : 'walker';
    const durations: Record<OccupantKind, number> = {
      tv: 20 + this.rng() * 50,
      cat: 15 + this.rng() * 40,
      curtain: 40 + this.rng() * 80,
      walker: 1.8 + this.rng() * 2.2,
    };
    this.occupants.push({
      window,
      kind,
      t: 0,
      duration: durations[kind],
      direction: this.rng() < 0.5 ? 1 : -1,
      tvColor: TV_COLORS[0],
      tvTimer: 0,
    });
  }
}
