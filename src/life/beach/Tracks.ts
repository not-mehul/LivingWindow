import { Sprite, type Container, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import type { Environment } from '../../scene/Environment';
import { BEACH_HORIZON, shorePoint } from '../../sim/shore';

/** What leaves the prints: a bird's three toes, a crab's dotted scuttle, a hermit's dragged shell, a hatchling's flipper scrape, a turtle's crawl. */
export type PrintKind = 'bird' | 'crab' | 'hermit' | 'hatchling' | 'turtle';

/** What the tracks need from the beach. */
export interface TrackShore {
  readonly sandFx: Container;
  /** How far up the sand the water has run at a depth (ground px from the still waterline). */
  reachAt(depth: number): number;
}

interface Mark {
  depth: number;
  s: number;
  /** Pixels (world), packed as x + y·W, and how dark each is (0..255). */
  pixels: number[];
  alpha: number[];
  age: number;
  life: number;
  /** Washed over: fading out fast. */
  washed: boolean;
}

/** Ground px between prints, for each kind. */
const STRIDE: Record<PrintKind, number> = { bird: 5, crab: 2.5, hermit: 1.5, hatchling: 1.4, turtle: 5 };
/** How long prints last on the dry sand (s), before the wind fills them in. */
const LIFE: Record<PrintKind, number> = { bird: 300, crab: 200, hermit: 300, hatchling: 900, turtle: 1800 };
const MAX_MARKS = 1800;
const TOP = BEACH_HORIZON + 14;
const BOTTOM = 348;
const FPS = 6;

/**
 * Tracks in the sand: everything that walks the beach leaves prints behind
 * it (arrow-toed birds' feet, the dotted double line of a crab's scuttle, a
 * hermit crab's wavering drag, the flipper-scraped trail of a hatchling,
 * a turtle's broad crawl), which slowly fill in on the dry sand, and are
 * wiped clean where the waves wash up over them.
 */
export class Tracks {
  private readonly marks: Mark[] = [];
  private readonly walkers = new WeakMap<object, { depth: number; s: number; foot: number }>();
  private readonly canvas: PixelCanvas;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly texture: Texture;
  private timer = 0;
  private dirty = true;

  constructor(private readonly shore: TrackShore) {
    this.canvas = new PixelCanvas(WORLD_WIDTH, BOTTOM - TOP);
    this.image = this.canvas.ctx.createImageData(WORLD_WIDTH, BOTTOM - TOP);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.texture = createNearestTexture(this.canvas.canvas);
    const sprite = new Sprite(this.texture);
    sprite.position.set(0, TOP);
    shore.sandFx.addChild(sprite);
  }

  get count(): number {
    return this.marks.length;
  }

  /**
   * Something has moved to (depth, s): it leaves a print each stride.
   * `who` is the walker (any object, to remember its last print by).
   */
  walk(who: object, kind: PrintKind, depth: number, s: number): void {
    const last = this.walkers.get(who);
    if (!last) {
      this.walkers.set(who, { depth, s, foot: 0 });
      return;
    }
    const p0 = shorePoint(last.depth, last.s);
    const p1 = shorePoint(depth, s);
    // Ground distance moved: screen px over the scale.
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y) / Math.max(0.1, p1.scale);
    if (moved < STRIDE[kind]) return;
    last.foot = 1 - last.foot;
    this.stamp(kind, depth, s, p1.x - p0.x, p1.y - p0.y, last.foot);
    last.depth = depth;
    last.s = s;
  }

  /** Leave a print at (depth, s), heading (dx, dy) on screen. */
  stamp(kind: PrintKind, depth: number, s: number, dx: number, dy: number, foot = 0): void {
    const p = shorePoint(depth, s);
    const k = p.scale;
    if (p.y < TOP || p.y >= BOTTOM) return;
    const len = Math.hypot(dx, dy) || 1;
    const hx = dx / len;
    const hy = dy / len;
    // Across the line of travel (squashed: the ground is seen at a slant).
    const ax = -hy;
    const ay = hx * 0.5;
    const pixels: number[] = [];
    const alpha: number[] = [];
    const dot = (x: number, y: number, a: number) => {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px >= WORLD_WIDTH || py < TOP || py >= BOTTOM) return;
      pixels.push(px + (py - TOP) * WORLD_WIDTH);
      alpha.push(a);
    };
    const side = foot ? 1 : -1;
    switch (kind) {
      case 'bird': {
        // Left, right, left: three toes splayed forward, one back.
        const x = p.x + ax * side * Math.max(0.6, k * 1.4);
        const y = p.y + ay * side * Math.max(0.6, k * 1.4);
        dot(x, y, 70);
        if (k > 0.55) {
          dot(x + hx * 1.4, y + hy * 0.7, 60);
          dot(x + hx + ax * 0.9, y + hy * 0.5 + ay * 0.9, 50);
          dot(x + hx - ax * 0.9, y + hy * 0.5 - ay * 0.9, 50);
        }
        break;
      }
      case 'crab':
        // Rows of leg dots both sides of its sideways path.
        for (const sgn of [-1, 1]) dot(p.x + ax * sgn * Math.max(1, k * 2.4), p.y + ay * sgn * Math.max(1, k * 2.4), 55);
        break;
      case 'hermit':
        // Its shell dragging a wavering groove, little leg dots either side.
        dot(p.x, p.y, 45);
        if (foot && k > 0.6) dot(p.x + ax * 1.6 * side, p.y + ay * 1.6 * side, 40);
        break;
      case 'hatchling':
        // A soft groove where its belly drags, flipper scrapes either side.
        dot(p.x, p.y, 35);
        dot(p.x + ax * Math.max(1, k * 2), p.y + ay * Math.max(1, k * 2), 60);
        dot(p.x - ax * Math.max(1, k * 2), p.y - ay * Math.max(1, k * 2), 60);
        break;
      case 'turtle': {
        // A broad furrow from the plastron, with the flippers' scoops in pairs along both sides.
        const half = Math.max(2, k * 9);
        if (foot) for (let t = -half * 0.35; t <= half * 0.35; t += 1) dot(p.x + ax * t, p.y + ay * t, 16);
        for (const sgn of [-1, 1]) {
          dot(p.x + ax * sgn * half, p.y + ay * sgn * half, 70);
          dot(p.x + ax * sgn * (half - 1) + hx, p.y + ay * sgn * (half - 1) + hy * 0.5, 55);
        }
        break;
      }
    }
    if (!pixels.length) return;
    this.marks.push({ depth, s, pixels, alpha, age: 0, life: LIFE[kind] * (0.8 + Math.random() * 0.4), washed: false });
    if (this.marks.length > MAX_MARKS) this.marks.splice(0, this.marks.length - MAX_MARKS);
    this.dirty = true;
  }

  update(dt: number, env: Environment): void {
    // The wind fills them in faster.
    const wind = 1 + Math.abs(env.weather.wind) * 2 + env.weather.precipitation * 4;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.age += dt * (m.washed ? 1 : wind);
      if (!m.washed && this.shore.reachAt(m.depth) > -m.s - 0.5) {
        // The wave runs over it: wiped clean in a moment.
        m.washed = true;
        m.life = m.age + 0.4;
        this.dirty = true;
      }
      if (m.age >= m.life) {
        this.marks.splice(i, 1);
        this.dirty = true;
      }
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / FPS;
    if (!this.dirty && !this.marks.some((m) => m.washed || m.life - m.age < 30)) return;
    this.dirty = false;
    this.draw();
  }

  private draw(): void {
    const px = this.pixels;
    px.fill(0);
    for (const m of this.marks) {
      // Fading as the sand fills them in (or as the wave smooths them over).
      const fade = m.washed ? Math.max(0, (m.life - m.age) / 0.4) : Math.min(1, (m.life - m.age) / 30);
      for (let k = 0; k < m.pixels.length; k++) {
        const a = Math.round(m.alpha[k] * fade);
        if (a <= 0) continue;
        const i = m.pixels[k];
        // A shadowed dent: dark, warm.
        const prev = px[i] >>> 24;
        px[i] = ((Math.min(120, prev + a) << 24) | (0x10 << 16) | (0x1c << 8) | 0x2a) >>> 0;
      }
    }
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }
}
