import { Sprite, type Container } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Environment } from '../../scene/Environment';
import { batActivity } from '../../sim/wildlife';
import { drawBat, DrawnCache } from '../../sprites/wildSprites';

const r = (min: number, max: number) => min + Math.random() * (max - min);

interface Bat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it's darting to next (it hawks insects in sudden swerves). */
  tx: number;
  ty: number;
  retarget: number;
  flap: number;
  size: number;
  leaving: boolean;
  sprite: Sprite;
}

/** The air bats hunt over (world px), and how big they look there. */
export interface BatArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Sprite size (px) at the top and bottom of the area. */
  size: [number, number];
}

/**
 * Bats out at dusk: flitting fast over the clearing in jinking zigzags,
 * wings a blur, coming and going with the light.
 */
export class Bats {
  private readonly bats: Bat[] = [];
  private readonly sprites = new DrawnCache();
  private spawnTimer = 1;

  constructor(
    private readonly container: Container,
    private readonly area: BatArea,
    private readonly max = 5,
  ) {}

  get count(): number {
    return this.bats.filter((b) => !b.leaving).length;
  }

  /** Send a few out now (for demos and tests). */
  summon(n = 3): void {
    for (let i = 0; i < n; i++) this.spawn();
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.1;
    const target = Math.round(batActivity(env.lighting.hours, raining) * this.max);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(1.5, 5);
      if (this.count < target) this.spawn();
      else if (this.count > target) {
        const b = this.bats.find((x) => !x.leaving);
        if (b) b.leaving = true;
      }
    }
    const { x0, x1, y0, y1 } = this.area;
    // Dark shapes against the sky.
    const tint = lerpColor(env.lighting.ambient, 0x000000, 0.35);
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      b.retarget -= dt;
      if (b.retarget <= 0) {
        b.retarget = r(0.25, 0.9);
        b.tx = b.leaving ? (b.x < (x0 + x1) / 2 ? x0 - 60 : x1 + 60) : r(x0, x1);
        b.ty = b.leaving ? y0 - 20 : r(y0, y1);
      }
      // Steer hard towards the target: sharp turns, fast flight.
      const ax = (b.tx - b.x) * 6 - b.vx * 2.2;
      const ay = (b.ty - b.y) * 6 - b.vy * 2.2;
      b.vx += ax * dt;
      b.vy += ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.flap += dt * 14;
      if (b.leaving && (b.x < x0 - 40 || b.x > x1 + 40 || b.y < y0 - 15)) {
        b.sprite.destroy();
        this.bats.splice(i, 1);
        continue;
      }
      const t = Math.max(0, Math.min(1, (b.y - y0) / Math.max(1, y1 - y0)));
      const size = Math.max(4, Math.round(this.area.size[0] + (this.area.size[1] - this.area.size[0]) * t) * b.size);
      const frame = Math.floor(b.flap) % 4;
      b.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawBat(frame, size));
      b.sprite.position.set(Math.round(b.x), Math.round(b.y));
      b.sprite.tint = tint;
    }
  }

  private spawn(): void {
    const { x0, x1, y0, y1 } = this.area;
    const fromLeft = Math.random() < 0.5;
    const sprite = new Sprite({ anchor: 0.5 });
    this.container.addChild(sprite);
    this.bats.push({
      x: fromLeft ? x0 - 20 : x1 + 20,
      y: r(y0, (y0 + y1) / 2),
      vx: 0,
      vy: 0,
      tx: r(x0, x1),
      ty: r(y0, y1),
      retarget: r(0.3, 0.8),
      flap: Math.random() * 3,
      size: r(0.85, 1.15),
      leaving: false,
      sprite,
    });
  }
}
