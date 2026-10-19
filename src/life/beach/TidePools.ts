import { Sprite, type Container, type Texture } from 'pixi.js';
import { lerpColor, multiplyColor, toPixel32 } from '../../core/color';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import type { Environment } from '../../scene/Environment';
import { pixelHash } from '../../sprites/raster';
import { clamp01 } from '../../core/math';

/** A pool as the scene lays it out: screen ellipse, and where it is on the shore. */
export interface PoolShape {
  x: number;
  y: number;
  hw: number;
  hh: number;
  depth: number;
  s: number;
}

/** What the pools need from the beach. */
export interface PoolShore {
  readonly poolLayer: Container;
  /** How far up the sand the water has run at a depth (ground px from the still waterline; includes the tide). */
  reachAt(depth: number): number;
}

interface Anemone {
  dx: number;
  dy: number;
  color: number;
  /** 1 open, 0 shut. */
  open: number;
}

interface Pool extends PoolShape {
  anemones: Anemone[];
  /** A starfish on the bed (pool px from the middle), or none. */
  star: { dx: number; dy: number; color: number } | null;
  /** Periwinkles grazing round the rim: angles, creeping. */
  winkles: Array<{ a: number; speed: number }>;
  /** When a wave last washed over it (s ago). */
  washed: number;
}

const ANEMONE_COLORS = [0xe0607a, 0x7ac89a, 0xe89a5a];
const STAR_COLORS = [0xe8742c, 0x9a4a8a];
/** Redraw the pools this often (they're small and still). */
const FPS = 10;

/**
 * Pools in the hollows of the rock shelf, left full when the tide goes
 * down: still water holding the sky, shivering when the breeze crosses it;
 * anemones round the edges that open their tentacles in the calm and pull
 * them in when a wave washes over; a starfish on the bottom, periwinkles
 * grazing the rim, a little crab picking about; and, in the big pool once
 * in a while, a small octopus that shifts, changes colour, and slips away
 * under the ledge.
 */
export class TidePools {
  private readonly pools: Pool[];
  private readonly canvas: PixelCanvas;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly texture: Texture;
  private readonly x0: number;
  private readonly y0: number;
  private timer = 0;
  private tick = 0;
  /** The little crab, going round the big pool's rim. */
  private crab = { a: 0.4, dir: 1, run: 0, pause: 4, hidden: 0 };
  /** The octopus: how far it is out (0 hidden .. 1), its spot in the big pool, and its colour (0 rock-dark .. 1 red). */
  private octopus = { out: 0, want: 0, dx: 0, dy: 0, flush: 0, timer: 40 };

  constructor(
    private readonly shore: PoolShore,
    shapes: readonly PoolShape[],
  ) {
    this.pools = shapes.map((p, i) => ({
      ...p,
      anemones: Array.from({ length: Math.max(1, Math.round(p.hw / 4)) }, (_, k) => {
        const a = pixelHash(i, k, 61) * Math.PI * 2;
        return { dx: Math.cos(a) * (p.hw - 1.6), dy: Math.sin(a) * Math.max(0, p.hh - 1), color: ANEMONE_COLORS[(i + k) % ANEMONE_COLORS.length], open: 1 };
      }),
      star: i % 2 === 0 ? { dx: Math.round((pixelHash(i, 1, 62) - 0.5) * p.hw), dy: 0, color: STAR_COLORS[i % 2] } : null,
      winkles: Array.from({ length: 3 + (i % 3) }, (_, k) => ({ a: pixelHash(i, k, 63) * Math.PI * 2, speed: (pixelHash(i, k, 64) - 0.5) * 0.004 })),
      washed: 99,
    }));
    this.x0 = Math.floor(Math.min(...shapes.map((p) => p.x - p.hw))) - 3;
    this.y0 = Math.floor(Math.min(...shapes.map((p) => p.y - p.hh))) - 3;
    const w = Math.ceil(Math.max(...shapes.map((p) => p.x + p.hw))) + 4 - this.x0;
    const h = Math.ceil(Math.max(...shapes.map((p) => p.y + p.hh))) + 4 - this.y0;
    this.canvas = new PixelCanvas(w, h);
    this.image = this.canvas.ctx.createImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.texture = createNearestTexture(this.canvas.canvas);
    const sprite = new Sprite(this.texture);
    sprite.position.set(this.x0, this.y0);
    shore.poolLayer.addChild(sprite);
  }

  /** Is the octopus showing (for the debug view). */
  get octopusOut(): number {
    return this.octopus.out;
  }

  /** Bring the octopus out now. */
  summonOctopus(): void {
    this.octopus.want = 1;
    this.octopus.timer = 30;
  }

  update(dt: number, env: Environment): void {
    const calm = 1 - Math.min(1, Math.abs(env.weather.wind));
    for (const p of this.pools) {
      // A wave over the pool: everything pulls in, and opens again slowly after.
      const over = this.shore.reachAt(p.depth) > -p.s - p.hw * 0.5;
      p.washed = over ? 0 : p.washed + dt;
      for (const a of p.anemones) {
        const want = p.washed < 2 ? 0 : 1;
        a.open += (want - a.open) * Math.min(1, dt * (want ? 0.25 : 4));
      }
      for (const w of p.winkles) w.a += w.speed * dt * 60;
    }
    this.updateCrab(dt);
    this.updateOctopus(dt, env);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / FPS;
    this.tick++;
    this.draw(env, calm);
  }

  private updateCrab(dt: number): void {
    const c = this.crab;
    const big = this.pools[0];
    if (big.washed < 1.5) c.hidden = 3;
    if (c.hidden > 0) {
      c.hidden -= dt;
      return;
    }
    if (c.pause > 0) {
      c.pause -= dt;
      return;
    }
    c.a += c.dir * dt * 0.9;
    c.run -= dt;
    if (c.run <= 0) {
      c.pause = 1 + Math.random() * 6;
      c.run = 0.3 + Math.random() * 0.8;
      if (Math.random() < 0.4) c.dir = -c.dir;
    }
  }

  private updateOctopus(dt: number, env: Environment): void {
    const o = this.octopus;
    o.timer -= dt;
    if (o.timer <= 0) {
      // Out now and then, mostly at dusk and dawn and after dark; gone when the waves wash in.
      const h = env.lighting.hours;
      const likely = h < 7 || h > 18 ? 0.5 : 0.15;
      o.want = o.want ? 0 : Math.random() < likely ? 1 : 0;
      o.timer = o.want ? 30 + Math.random() * 60 : 120 + Math.random() * 240;
      if (o.want) {
        const big = this.pools[0];
        o.dx = Math.round((Math.random() - 0.5) * big.hw);
        o.dy = 0;
      }
    }
    if (this.pools[0].washed < 1) o.want = 0;
    o.out += ((o.want ? 1 : 0) - o.out) * Math.min(1, dt * 0.8);
    // Its colour comes and goes: dark as the rock, then flushing red.
    o.flush = 0.5 + 0.5 * Math.sin(env.time * 0.35 + Math.sin(env.time * 0.13) * 2);
    // It shifts now and then, a pixel at a time.
    if (o.want && Math.random() < dt * 0.08) o.dx += Math.random() < 0.5 ? -1 : 1;
    const big = this.pools[0];
    o.dx = Math.max(-big.hw + 3, Math.min(big.hw - 3, o.dx));
  }

  private draw(env: Environment, calm: number): void {
    const { lighting } = env;
    const amb = lighting.ambient;
    const px = this.pixels;
    px.fill(0);
    const w = this.canvas.width;
    // The pools hold the sky: pale at the far edge, the deeper blue overhead nearer us, over the dark bed.
    const far = lerpColor(lighting.skyHorizon, 0xffffff, 0.15);
    const near = lerpColor(lighting.skyTop, lighting.skyHorizon, 0.35);
    const bed = multiplyColor(0x34443c, amb);
    const glint = lerpColor(lighting.skyHorizon, 0xffffff, 0.75);
    const put = (x: number, y: number, c: number) => {
      const ix = Math.round(x) - this.x0;
      const iy = Math.round(y) - this.y0;
      if (ix < 0 || iy < 0 || ix >= w || iy >= this.canvas.height) return;
      px[iy * w + ix] = toPixel32(c);
    };
    const wind = Math.abs(env.weather.wind);
    for (const [i, p] of this.pools.entries()) {
      const cx = p.x;
      const cy = p.y;
      for (let y = Math.floor(cy - p.hh); y <= cy + p.hh; y++) {
        for (let x = Math.floor(cx - p.hw); x <= cx + p.hw; x++) {
          const u = (x + 0.5 - cx) / p.hw;
          const v = (y + 0.5 - cy) / Math.max(1, p.hh);
          const d = u * u + v * v;
          if (d > 1) continue;
          const t = clamp01(v * 0.5 + 0.5);
          let c = lerpColor(far, near, t);
          // Shallow at the edges: the bed shows through.
          c = lerpColor(c, bed, d > 0.7 ? 0.55 : 0.2);
          // The surface shivers in the wind: little glints come and go.
          if (pixelHash(x >> 1, y, this.tick + i * 7) > 0.97 - wind * 0.06) c = glint;
          put(x, y, c);
        }
      }
      // Starfish on the bottom, seen through the water.
      if (p.star) {
        const c = lerpColor(multiplyColor(p.star.color, amb), near, 0.25);
        const sx = cx + p.star.dx;
        const sy = cy + p.star.dy;
        for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(sx + dx, sy + dy, c);
      }
      // Anemones round the edge: tentacles out in a little spray, or shut to a dark bead.
      for (const a of p.anemones) {
        const ax = cx + a.dx;
        const ay = cy + a.dy;
        if (a.open > 0.4) {
          const c = multiplyColor(a.color, amb);
          put(ax, ay, c);
          put(ax - 1, ay, lerpColor(c, 0xffffff, 0.2));
          if (a.open > 0.75) put(ax + 1, ay, lerpColor(c, 0xffffff, 0.3 * calm));
        } else put(ax, ay, multiplyColor(0x6a2a32, amb));
      }
      // Periwinkles on the rim.
      for (const k of p.winkles) put(cx + Math.cos(k.a) * (p.hw + 1), cy + Math.sin(k.a) * (p.hh + 1), multiplyColor(0x2a2420, amb));
    }
    // The crab on the big pool's rim.
    const big = this.pools[0];
    if (this.crab.hidden <= 0) {
      const a = this.crab.a;
      const x = big.x + Math.cos(a) * (big.hw + 1.5);
      const y = big.y + Math.sin(a) * (big.hh + 1);
      const c = multiplyColor(0xa04a2a, amb);
      put(x, y, c);
      put(x + 1, y, multiplyColor(0x7a3420, amb));
    }
    // The octopus: a soft blob with an arm or two out, in the big pool.
    const o = this.octopus;
    if (o.out > 0.3) {
      const c = multiplyColor(lerpColor(0x3a3430, 0xb04a3a, o.flush), amb);
      const x = big.x + o.dx;
      const y = big.y + o.dy;
      put(x, y, c);
      put(x + 1, y, c);
      put(x, y - 1, lerpColor(c, 0xffffff, 0.15));
      if (o.out > 0.7) {
        put(x - 1, y + 1, c);
        put(x + 2, y + 1, c);
        put(x + 1, y - 1, multiplyColor(0x1a1414, amb));
      }
    }
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }
}
