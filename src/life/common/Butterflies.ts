import { Sprite, type Container } from 'pixi.js';
import type { Environment } from '../../scene/Environment';
import { butterflyActivity } from '../../sim/wildlife';
import { drawButterfly, DrawnCache, type ButterflyKind } from '../../sprites/wildSprites';

const r = (min: number, max: number) => min + Math.random() * (max - min);

interface Butterfly {
  kind: ButterflyKind;
  patch: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Seconds left resting on a flower, wings slowly opening and closing. */
  rest: number;
  flap: number;
  t: number;
  leaving: boolean;
  sprite: Sprite;
}

/** A sunny patch (screen ellipse) with its flowers. */
export interface ButterflyPatch {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/**
 * Butterflies dancing over sunny patches on warm days: a bobbing, wavering
 * flight from flower to flower, settling now and then with their wings
 * slowly opening and closing.
 */
export class Butterflies {
  private readonly flies: Butterfly[] = [];
  private readonly sprites = new DrawnCache();
  private spawnTimer = 2;

  constructor(
    private readonly container: Container,
    private readonly patches: readonly ButterflyPatch[],
    /** Sprite size (px) at a world y: bigger nearer the window. */
    private readonly sizeAt: (y: number) => number,
    private readonly kinds: readonly ButterflyKind[] = ['monarch', 'white', 'blue', 'brimstone'],
    private readonly max = 5,
  ) {}

  get count(): number {
    return this.flies.filter((b) => !b.leaving).length;
  }

  summon(n = 3): void {
    for (let i = 0; i < n; i++) this.spawn();
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.05;
    const target = Math.round(butterflyActivity(env.lighting.hours, env.weather.cloudCover, raining) * this.max);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(3, 9);
      if (this.count < target) this.spawn();
      else if (this.count > target) {
        const b = this.flies.find((x) => !x.leaving);
        if (b) b.leaving = true;
      }
    }
    const wind = env.weather.wind;
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const b = this.flies[i];
      b.t += dt;
      let frame: number;
      if (b.rest > 0) {
        b.rest -= dt;
        // Wings basking open, then slowly closing and opening again.
        frame = Math.floor(b.t * 1.2) % 4 === 3 ? 2 : 0;
        if (b.rest <= 0) this.pickTarget(b);
      } else {
        const dx = b.tx - b.x;
        const dy = b.ty - b.y;
        const d = Math.hypot(dx, dy);
        const speed = 14;
        if (d < 1.5) {
          if (b.leaving) {
            b.sprite.destroy();
            this.flies.splice(i, 1);
            continue;
          }
          if (Math.random() < 0.35) b.rest = r(2, 7);
          else this.pickTarget(b);
        } else {
          b.x += (dx / d) * speed * dt + wind * 4 * dt;
          // A wavering, bobbing flight.
          b.y += (dy / d) * speed * dt + Math.sin(b.t * 9) * 10 * dt;
        }
        b.flap += dt * 10;
        frame = Math.floor(b.flap) % 3;
      }
      const size = Math.max(3, Math.round(this.sizeAt(b.y)));
      b.sprite.texture = this.sprites.get(`${b.kind}:${frame}:${size}`, () => drawButterfly(b.kind, frame, size));
      b.sprite.position.set(Math.round(b.x), Math.round(b.y));
      b.sprite.tint = env.lighting.ambient;
    }
  }

  private pickTarget(b: Butterfly): void {
    if (b.leaving) {
      b.tx = b.x + (Math.random() < 0.5 ? -1 : 1) * 200;
      b.ty = b.y - 80;
      return;
    }
    // Mostly within its patch; now and then off to another one.
    if (Math.random() < 0.15) b.patch = Math.floor(Math.random() * this.patches.length);
    const q = this.patches[b.patch];
    const a = Math.random() * Math.PI * 2;
    const k = Math.sqrt(Math.random());
    b.tx = q.x + Math.cos(a) * q.rx * k;
    b.ty = q.y + Math.sin(a) * q.ry * k;
  }

  private spawn(): void {
    const patch = Math.floor(Math.random() * this.patches.length);
    const p = this.patches[patch];
    const sprite = new Sprite({ anchor: 0.5 });
    this.container.addChild(sprite);
    const fromLeft = Math.random() < 0.5;
    const b: Butterfly = {
      kind: this.kinds[Math.floor(Math.random() * this.kinds.length)],
      patch,
      x: p.x + (fromLeft ? -1 : 1) * (p.rx + 40),
      y: p.y - p.ry - 20,
      tx: 0,
      ty: 0,
      rest: 0,
      flap: Math.random() * 3,
      t: Math.random() * 10,
      leaving: false,
      sprite,
    };
    this.pickTarget(b);
    this.flies.push(b);
  }
}
