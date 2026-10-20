import { Graphics, Sprite, type Container } from 'pixi.js';
import type { PixelBuffer } from '../../core/pixelBuffer';
import type { Environment } from '../../scene/Environment';
import { meadowCreek } from '../../sim/meadowGeometry';
import { FOCAL } from '../../sim/groundPlane';
import { butterflyActivity, hedgehogActivity, roeDeerOut } from '../../sim/wildlife';
import { drawDeerSized } from '../../sprites/forestSprites';
import { drawHedgehog, DrawnCache, HEDGEHOG_SHUFFLE } from '../../sprites/wildSprites';
import { rand as r } from '../../core/random';
import { hazeTint } from '../../scene/lighting';

// --- A hedgehog in the flower bank --------------------------------------------------------

/**
 * A hedgehog out after dark, snuffling along the grass just behind the
 * wildflower bank in front of the window, half hidden by the flowers: trundling a little way, nose down, pausing, and
 * rolling into a prickly ball at a tap.
 */
export class Hedgehog {
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private present = false;
  private x = 0;
  private dir: 1 | -1 = 1;
  private pause = 0;
  private curled = 0;
  private stride = 0;
  private timer = r(20, 80);
  private forced = false;

  constructor(
    container: Container,
    /** The row it walks along, in the grass just behind the flower bank. */
    private readonly y: number,
    private readonly width: number,
  ) {
    this.sprite.visible = false;
    container.addChild(this.sprite);
  }

  get out(): boolean {
    return this.present;
  }

  /** Where it is (world px, feet), while it's out. */
  get position(): { x: number; y: number } | null {
    return this.present ? { x: this.x, y: this.y } : null;
  }

  /** Roll up tight (a fox snuffling past), for a while after the danger's gone. */
  curl(seconds: number): void {
    if (this.present) this.curled = Math.max(this.curled, seconds);
  }

  summon(): void {
    this.forced = true;
    this.timer = 0;
  }

  tap(x: number, y: number): boolean {
    if (!this.present || Math.abs(x - this.x) > 12 || Math.abs(y - (this.y - 5)) > 10) return false;
    this.curled = r(5, 9);
    return true;
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.2;
    const activity = this.forced ? 1 : hedgehogActivity(env.lighting.hours, raining);
    if (!this.present) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(60, 200);
        if (activity > 0) {
          this.present = true;
          this.dir = Math.random() < 0.5 ? 1 : -1;
          this.x = this.dir > 0 ? -10 : this.width + 10;
        }
      }
      this.sprite.visible = false;
      return;
    }
    if (this.curled > 0) this.curled -= dt;
    else if (this.pause > 0) this.pause -= dt;
    else {
      this.x += this.dir * 6 * dt;
      this.stride += dt * 6;
      if (Math.random() < dt * 0.3) this.pause = r(1, 4);
    }
    if (this.x < -20 || this.x > this.width + 20) {
      this.present = false;
      this.forced = false;
      this.sprite.visible = false;
      return;
    }
    const curled = this.curled > 0;
    const frame = Math.floor(this.stride) % HEDGEHOG_SHUFFLE;
    this.sprite.texture = this.sprites.get(`${curled}:${frame}`, () => drawHedgehog(frame, 18, curled));
    this.sprite.scale.x = this.dir;
    this.sprite.position.set(Math.round(this.x), this.y);
    this.sprite.visible = true;
    this.sprite.tint = hazeTint(env.lighting, 0.08);
  }
}

// --- Roe deer at the tree line at dawn ------------------------------------------------------

interface Roe {
  x: number;
  y: number;
  dir: 1 | -1;
  graze: boolean;
  timer: number;
  leaving: number;
  sprite: Sprite;
}

/** Where the far tree line meets the field, for each column (world y), from its art. */
export function treeLineFoot(treeLine: PixelBuffer): (x: number) => number {
  const foot = new Int16Array(treeLine.width).fill(-1);
  for (let x = 0; x < treeLine.width; x++) {
    for (let y = treeLine.height - 1; y >= 0; y--) {
      if (treeLine.isSet(x, y)) {
        foot[x] = y;
        break;
      }
    }
  }
  return (x) => foot[Math.max(0, Math.min(foot.length - 1, Math.round(x)))];
}

/** Roe deer stepping out of the tree line in the dawn half-light: grazing at the field's edge, then slipping back into the trees. */
export class TreeLineDeer {
  private readonly herd: Roe[] = [];
  private readonly sprites = new DrawnCache();
  /** Seconds left of a summoned visit. */
  private forced = 0;

  constructor(
    private readonly container: Container,
    private readonly footAt: (x: number) => number,
    /** Where along the tree line they can come out (world x). */
    private readonly xs: readonly [number, number],
  ) {}

  get count(): number {
    return this.herd.length;
  }

  summon(): void {
    this.forced = 90;
  }

  update(dt: number, env: Environment): void {
    this.forced = Math.max(0, this.forced - dt);
    const out = this.forced > 0 || roeDeerOut(env.lighting.hours);
    if (out && this.herd.length === 0) {
      const x0 = r(this.xs[0], this.xs[1]);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const x = x0 + i * r(6, 10);
        const foot = this.footAt(x);
        if (foot < 0) continue;
        const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
        this.container.addChild(sprite);
        this.herd.push({ x, y: foot + r(1, 3), dir: Math.random() < 0.5 ? 1 : -1, graze: true, timer: r(2, 6), leaving: 0, sprite });
      }
    }
    for (let i = this.herd.length - 1; i >= 0; i--) {
      const d = this.herd[i];
      if (!out && d.leaving === 0) d.leaving = 0.001;
      d.timer -= dt;
      if (d.leaving > 0) {
        // Back into the trees.
        d.leaving += dt;
        d.y -= 2 * dt;
        d.sprite.alpha = Math.max(0, 1 - d.leaving / 2);
        if (d.leaving > 2) {
          d.sprite.destroy();
          this.herd.splice(i, 1);
          continue;
        }
      } else if (d.timer <= 0) {
        d.timer = r(2, 7);
        d.graze = !d.graze;
      }
      const pose = d.leaving > 0 ? 'bound-1' : d.graze ? 'graze-1' : 'alert';
      d.sprite.texture = this.sprites.get(pose, () => drawDeerSized('roe', pose, 8));
      d.sprite.scale.x = d.dir;
      d.sprite.position.set(Math.round(d.x), Math.round(d.y));
      d.sprite.zIndex = d.y;
      d.sprite.tint = hazeTint(env.lighting, 0.3);
    }
  }
}

// --- Bees and dragonflies ------------------------------------------------------------------

interface Bee {
  x: number;
  y: number;
  tx: number;
  ty: number;
  sit: number;
}

/** Bees working the flower bank: zipping from bloom to bloom and settling on each a moment. */
export class Bees {
  readonly graphics = new Graphics();
  private readonly bees: Bee[] = [];

  constructor(private readonly blooms: ReadonlyArray<{ x: number; y: number }>) {}

  get count(): number {
    return this.bees.length;
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.05;
    const target = Math.round(butterflyActivity(env.lighting.hours, env.weather.cloudCover, raining) * 7);
    while (this.bees.length < target && this.blooms.length > 0) {
      const b = this.blooms[Math.floor(Math.random() * this.blooms.length)];
      this.bees.push({ x: b.x + r(-40, 40), y: b.y - 20, tx: b.x, ty: b.y, sit: 0 });
    }
    if (this.bees.length > target) this.bees.length = target;
    const g = this.graphics;
    g.clear();
    const t = env.time;
    for (const b of this.bees) {
      if (b.sit > 0) {
        b.sit -= dt;
        if (b.sit <= 0) {
          const n = this.blooms[Math.floor(Math.random() * this.blooms.length)];
          b.tx = n.x;
          b.ty = n.y;
        }
      } else {
        const dx = b.tx - b.x;
        const dy = b.ty - b.y;
        const d = Math.hypot(dx, dy);
        if (d < 1) b.sit = r(0.6, 2.5);
        else {
          const s = Math.min(d, 55 * dt);
          b.x += (dx / d) * s + r(-1, 1) * 20 * dt;
          b.y += (dy / d) * s + r(-1, 1) * 20 * dt;
        }
      }
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      // A striped body and a flicker of wings.
      g.rect(x, y, 1, 1).fill(0xe8b828).rect(x + 1, y, 1, 1).fill(0x2a2018);
      if (b.sit <= 0 || Math.floor(t * 8) % 2 === 0) g.rect(x, y - 1, 1, 1).fill({ color: 0xe8f0f8, alpha: 0.7 });
    }
    g.tint = env.lighting.ambient;
  }
}

/** Blooms in the flower bank (world points near the top of each flower). */
export function bloomPoints(flowers: ReadonlyArray<{ art: PixelBuffer; x: number; y: number }>): Array<{ x: number; y: number }> {
  return flowers.map((f) => ({ x: f.x + f.art.width / 2, y: f.y + Math.min(4, f.art.height * 0.2) }));
}

interface Dragonfly {
  along: number;
  across: number;
  tAlong: number;
  tAcross: number;
  hover: number;
  color: number;
  heading: number;
}

/** Dragonflies over the creek: hovering stock-still, then darting off to a new spot in a blink. */
export class Dragonflies {
  readonly graphics = new Graphics();
  private readonly flies: Dragonfly[] = [];

  get count(): number {
    return this.flies.length;
  }

  /** One hovering low over the water (ground px along and across the creek), if any. */
  hovering(): { along: number; across: number; index: number } | null {
    const i = this.flies.findIndex((f) => f.hover > 0.3);
    return i < 0 ? null : { along: this.flies[i].along, across: this.flies[i].across, index: i };
  }

  /** Something snapped at it: off in a blink, well away. */
  startle(index: number): void {
    const f = this.flies[index];
    if (!f) return;
    f.hover = 0;
    f.tAlong = Math.max(1.1 * FOCAL, Math.min(2.8 * FOCAL, f.along + (Math.random() < 0.5 ? -1 : 1) * r(140, 220)));
    f.tAcross = r(-1, 1) * meadowCreek.halfWidth * 1.4;
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.05;
    const target = Math.round(butterflyActivity(env.lighting.hours, env.weather.cloudCover, raining) * 3);
    while (this.flies.length < target) {
      const along = r(1.2, 2.6) * FOCAL;
      this.flies.push({ along, across: 0, tAlong: along, tAcross: 0, hover: r(0.5, 2), color: Math.random() < 0.5 ? 0x3a8ae8 : 0x3ab87a, heading: 0 });
    }
    if (this.flies.length > target) this.flies.length = target;
    const g = this.graphics;
    g.clear();
    for (const f of this.flies) {
      if (f.hover > 0) {
        f.hover -= dt;
        if (f.hover <= 0) {
          f.tAlong = Math.max(1.1 * FOCAL, Math.min(2.8 * FOCAL, f.along + r(-120, 120)));
          f.tAcross = r(-1, 1) * meadowCreek.halfWidth * 1.2;
        }
      } else {
        const da = f.tAlong - f.along;
        const dc = f.tAcross - f.across;
        const d = Math.hypot(da, dc);
        if (d < 2) f.hover = r(0.6, 2.5);
        else {
          const s = Math.min(d, 260 * dt);
          f.along += (da / d) * s;
          f.across += (dc / d) * s;
        }
      }
      const p = meadowCreek.point(f.along / FOCAL, f.across);
      const x = Math.round(p.x);
      // Flying a little above the water.
      const y = Math.round(p.y - 10 * p.scale) + (f.hover > 0 ? Math.round(Math.sin(env.time * 9 + f.along) * 0.6) : 0);
      const len = Math.max(3, Math.round(7 * p.scale));
      // A long slim body, and two pairs of glassy wings shimmering at the thorax.
      g.rect(x - Math.floor(len / 2), y, len, 1).fill(f.color);
      g.rect(x - Math.floor(len / 2) + 1, y - 1, 1, 1).fill({ color: 0xe8f4ff, alpha: 0.65 });
      g.rect(x - Math.floor(len / 2) + 1, y + 1, 1, 1).fill({ color: 0xe8f4ff, alpha: Math.floor(env.time * 20) % 2 === 0 ? 0.65 : 0.25 });
    }
    g.tint = env.lighting.ambient;
  }
}
