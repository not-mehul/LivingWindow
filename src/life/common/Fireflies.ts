import type { Graphics } from 'pixi.js';
import type { Environment } from '../../scene/Environment';
import { fireflyLevel } from '../../sim/wildlife';
import { rand as r } from '../../core/random';

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  on: number;
  off: number;
}

/** Where fireflies drift (world px). */
export interface FireflyArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Fireflies drifting low over the grass on warm evenings, each flashing on its own rhythm. */
export class Fireflies {
  private readonly flies: Firefly[] = [];

  constructor(
    private readonly graphics: Graphics,
    private readonly area: FireflyArea,
    count = 34,
  ) {
    graphics.blendMode = 'add';
    for (let i = 0; i < count; i++) {
      this.flies.push({ x: r(area.x0, area.x1), y: r(area.y0 + 10, area.y1), vx: r(-3, 3), vy: r(-1, 1), phase: Math.random() * 4, on: r(0.3, 0.6), off: r(1, 4) });
    }
  }

  update(dt: number, env: Environment): void {
    const g = this.graphics;
    g.clear();
    const level = fireflyLevel(env.lighting.hours, env.lighting.darkness, env.weather.kind === 'rain' && env.weather.precipitation > 0.05);
    if (level <= 0) return;
    const { x0, x1, y0, y1 } = this.area;
    const width = x1 - x0;
    const count = Math.round(this.flies.length * level);
    for (let i = 0; i < count; i++) {
      const f = this.flies[i];
      f.phase += dt;
      if (f.phase > f.on + f.off) f.phase = 0;
      f.vx += r(-6, 6) * dt;
      f.vy += r(-4, 4) * dt;
      f.vx = Math.max(-5, Math.min(5, f.vx));
      f.vy = Math.max(-2, Math.min(2, f.vy));
      f.x = x0 + ((((f.x - x0 + f.vx * dt) % width) + width) % width);
      f.y = Math.max(y0, Math.min(y1, f.y + f.vy * dt));
      if (f.phase > f.on) continue;
      // Glow swells and fades within each flash.
      const glow = Math.sin((f.phase / f.on) * Math.PI);
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      g.rect(x - 1, y - 1, 3, 3).fill({ color: 0x8ac83a, alpha: glow * 0.3 });
      g.rect(x - 1, y, 3, 1).fill({ color: 0xc8f05a, alpha: glow * 0.6 });
      g.rect(x, y - 1, 1, 3).fill({ color: 0xc8f05a, alpha: glow * 0.6 });
      g.rect(x, y, 1, 1).fill({ color: 0xf4ffa0, alpha: glow });
    }
  }
}
