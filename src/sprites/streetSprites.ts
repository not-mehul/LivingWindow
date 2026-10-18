import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { drawPerson, personKey, type PersonFacing, type PersonLook, type PersonPose } from './people';

import { PixelGrid } from './raster';

export { randomLook, type PersonFacing, type PersonLook, type PersonPose } from './people';

/** Each pedestrian's sprites, drawn at the height they're seen and dropped when they leave. */
export class PersonSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(look: PersonLook, id: number, facing: PersonFacing, pose: PersonPose, frame: number, umbrella: boolean, height: number): Texture {
    const key = personKey(id, facing, pose, frame, umbrella, height);
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, palette } = drawPerson(look, facing, pose, frame, umbrella, height);
      texture = gridToTexture(grid, palette.colors);
      this.cache.set(key, texture);
    }
    return texture;
  }

  forget(id: number): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${id}:`)) {
        this.cache.get(key)?.destroy(true);
        this.cache.delete(key);
      }
    }
  }
}

// --- Market stalls ------------------------------------------------------

export type StallKind = 'fruit' | 'flowers' | 'cart' | 'noodles' | 'lanterns' | 'trinkets';
export const DAY_STALLS: readonly StallKind[] = ['fruit', 'flowers', 'cart'];
export const NIGHT_STALLS: readonly StallKind[] = ['noodles', 'lanterns', 'trinkets'];
/** Build-up stages while a stall is set up or packed away. */
export const STALL_STAGES = 4;

interface StallStyle {
  /** The awning's two stripe colours. */
  awning: [number, number];
  /** The cloth over the counter's front. */
  cloth: number;
  /** What's for sale. */
  goods: number[];
}

const STALL_STYLES: Record<StallKind, StallStyle> = {
  fruit: { awning: [0xd8463c, 0xf2ece0], cloth: 0x4a7a3a, goods: [0xe0503a, 0xf0a030, 0x7ab040, 0xf2d040] },
  flowers: { awning: [0x3c8a5a, 0xf2ece0], cloth: 0x8a6040, goods: [0xe86a9a, 0xf2d040, 0xb06ad8, 0xf2f0e8] },
  cart: { awning: [0x3c6ab8, 0xf2ece0], cloth: 0x3c6ab8, goods: [0xc88a4a, 0xe8c890, 0xa04a2a] },
  noodles: { awning: [0xa82a2a, 0xe8d8b0], cloth: 0x5a1a1a, goods: [0xf2e0b0, 0xe8a040, 0xd8d8d0] },
  lanterns: { awning: [0x2a3a6a, 0xd8c8a0], cloth: 0x2a2a44, goods: [0xe84a3a, 0xf0b040, 0xe86aa0] },
  trinkets: { awning: [0x6a2a7a, 0xe8d8b0], cloth: 0x3a1e44, goods: [0x6ac8d8, 0xe8d050, 0xd86a6a, 0x8ad86a] },
};

interface StallInk {
  palette: Palette;
  wood: Ramp;
  awnA: Ramp;
  awnB: Ramp;
  cloth: Ramp;
  metal: Ramp;
  leaf: Ramp;
  goods: Ramp[];
  steam: number;
}

function stallInk(kind: StallKind): StallInk {
  const style = STALL_STYLES[kind];
  const palette = new Palette();
  return {
    palette,
    wood: palette.ramp(kind === 'cart' ? 0xb8b8c0 : 0x8a6040),
    awnA: palette.ramp(style.awning[0]),
    awnB: palette.ramp(style.awning[1], 0.8),
    cloth: palette.ramp(style.cloth),
    metal: palette.ramp(0x7a7a84),
    leaf: palette.ramp(0x4a8a3a),
    goods: style.goods.map((c) => palette.ramp(c)),
    steam: palette.add(0xe8eef0),
  };
}

/**
 * A market stall `height` px tall, at a set-up stage (0 = a bare counter,
 * then posts, the awning, and finally the goods and the cloth). Drawn at the
 * size it's seen, with a striped, scalloped awning and real wares: piled
 * fruit, buckets of flowers, a pastry cart under a parasol, a noodle pot,
 * paper lanterns, racks of trinkets.
 */
export function drawStallSized(kind: StallKind, stage: number, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.max(6, Math.round(H * 1.25));
  const ink = stallInk(kind);
  const g = new PixelGrid(W, H);
  if (kind === 'cart') drawCart(g, ink, stage, W, H);
  else drawTable(g, ink, kind, stage, W, H);
  if (H >= 14) selOut(g, ink.palette, { bottomHeavy: true });
  return { grid: g, palette: ink.palette };
}

/** The striped awning, sloping out towards us, with a scalloped valance. */
function drawAwning(g: PixelGrid, ink: StallInk, x0: number, x1: number, top: number, bottom: number, valance: number): void {
  const w = x1 - x0;
  const stripes = Math.max(3, Math.round(w / Math.max(2, w / 7)));
  const stripeW = w / stripes;
  for (let y = Math.floor(top); y < Math.floor(bottom); y++) {
    const t = (y + 0.5 - top) / Math.max(1, bottom - top);
    // The canvas widens as it slopes out.
    const inset = (1 - t) * w * 0.05;
    for (let x = Math.floor(x0 + inset); x < Math.ceil(x1 - inset); x++) {
      const k = Math.floor((x - x0) / stripeW);
      const r = k % 2 === 0 ? ink.awnA : ink.awnB;
      // Lit along the top, shading towards the front edge.
      g.set(x, y, r[t < 0.25 ? 3 : t < 0.7 ? 2 : 1]);
    }
  }
  // Scallops: one per stripe, hanging below.
  for (let k = 0; k < stripes; k++) {
    const r = k % 2 === 0 ? ink.awnA : ink.awnB;
    const cx = x0 + (k + 0.5) * stripeW;
    for (let x = Math.floor(x0 + k * stripeW); x < Math.floor(x0 + (k + 1) * stripeW); x++) {
      const d = Math.abs(x + 0.5 - cx) / (stripeW / 2);
      const drop = Math.max(0, valance * Math.sqrt(Math.max(0, 1 - d * d)));
      for (let y = Math.floor(bottom); y < Math.floor(bottom + drop); y++) g.set(x, y, r[1]);
    }
  }
}

function drawTable(g: PixelGrid, ink: StallInk, kind: StallKind, stage: number, W: number, H: number): void {
  const counterTop = Math.round(H * 0.56);
  const counterH = Math.max(1, Math.round(H * 0.09));
  const skirtTo = Math.round(H * 0.84);
  const left = Math.round(W * 0.06);
  const right = W - left;
  // Legs and posts.
  const postW = Math.max(1, Math.round(W * 0.035));
  for (const x of [left, right - postW]) for (let y = counterTop; y < H; y++) for (let k = 0; k < postW; k++) g.set(x + k, y, ink.wood[k === 0 ? 2 : 1]);
  if (stage >= 1) {
    const postTop = Math.round(H * 0.12);
    for (const x of [left, right - postW]) for (let y = postTop; y < counterTop; y++) for (let k = 0; k < postW; k++) g.set(x + k, y, ink.wood[k === 0 ? 2 : 1]);
  }
  // Counter: a lit top edge over a front of planks (or the cloth once it's dressed).
  for (let y = counterTop; y < counterTop + counterH; y++) for (let x = left; x < right; x++) g.set(x, y, ink.wood[y === counterTop ? 4 : 3]);
  const dressed = stage >= 3;
  for (let y = counterTop + counterH; y < skirtTo; y++) {
    for (let x = left + 1; x < right - 1; x++) {
      if (dressed) {
        // Cloth hangs in folds.
        const fold = Math.floor((x - left) / Math.max(2, W / 10)) % 2;
        g.set(x, y, ink.cloth[y === skirtTo - 1 ? 1 : fold ? 2 : 3]);
      } else {
        const plank = (y - counterTop - counterH) % Math.max(2, Math.round(H * 0.08)) === 0;
        g.set(x, y, ink.wood[plank ? 1 : 2]);
      }
    }
  }
  // Shadow under the counter.
  for (let y = skirtTo; y < H; y++) for (let x = left + postW; x < right - postW; x++) if ((x + y) % 2 === 0 && y === skirtTo) g.set(x, y, ink.wood[0]);
  if (stage >= 2) drawAwning(g, ink, 0, W, Math.round(H * 0.08), Math.round(H * 0.26), Math.max(1, H * 0.06));
  if (stage >= 3) drawGoods(g, ink, kind, H, counterTop, left, right);
}

/** What's on the counter (and hanging from the awning). */
function drawGoods(g: PixelGrid, ink: StallInk, kind: StallKind, H: number, counterTop: number, left: number, right: number): void {
  const span = right - left;
  const big = H >= 18;
  if (kind === 'fruit') {
    // Crates heaped with fruit: round, lit from the upper left.
    const crates = Math.max(2, Math.round(span / Math.max(4, H * 0.32)));
    const cw = span / crates;
    for (let i = 0; i < crates; i++) {
      const r = ink.goods[i % ink.goods.length];
      const cx = left + (i + 0.5) * cw;
      const fr = Math.max(0.6, H * 0.055);
      // A heap: a row along the crate, a few on top.
      for (let row = 0; row < (big ? 3 : 2); row++) {
        const n = Math.max(1, Math.floor((cw - 1) / (fr * 2)) - row);
        for (let k = 0; k < n; k++) {
          const fx = cx + (k - (n - 1) / 2) * fr * 2;
          const fy = counterTop - fr - row * fr * 1.6;
          if (fr >= 1.2) shadedEllipse(g, fx, fy, fr, fr, r, { dither: false });
          else g.set(Math.floor(fx), Math.floor(fy), r[k % 2 === 0 ? 3 : 2]);
        }
      }
      if (big) for (let x = Math.floor(cx - cw / 2 + 1); x < Math.floor(cx + cw / 2 - 1); x++) g.set(x, counterTop - 1, ink.wood[1]);
    }
  } else if (kind === 'flowers') {
    // Buckets of bunches, tallest at the back.
    const buckets = Math.max(2, Math.round(span / Math.max(4, H * 0.28)));
    const bw = span / buckets;
    for (let i = 0; i < buckets; i++) {
      const cx = left + (i + 0.5) * bw;
      const bucketH = Math.max(1, Math.round(H * 0.1));
      const half = Math.max(1, bw * 0.3);
      for (let y = counterTop - bucketH; y < counterTop; y++) for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) g.set(x, y, ink.metal[x < cx ? 3 : 2]);
      const r = ink.goods[i % ink.goods.length];
      // Stems, then blooms.
      const top = counterTop - bucketH - Math.max(2, H * 0.2);
      for (let y = Math.floor(top); y < counterTop - bucketH; y++) for (let x = Math.floor(cx - half + 0.5); x < Math.ceil(cx + half - 0.5); x += 2) g.set(x, y, ink.leaf[(x + y) % 2 === 0 ? 2 : 1]);
      // A loose dome of blooms over the stems.
      const domeW = half * 1.6;
      const domeH = Math.max(1, H * 0.09);
      for (let y = Math.floor(top - domeH); y <= Math.floor(top + domeH * 0.6); y++) {
        for (let x = Math.floor(cx - domeW); x <= Math.floor(cx + domeW); x++) {
          const dx = (x + 0.5 - cx) / domeW;
          const dy = (y + 0.5 - top) / domeH;
          if (dx * dx + dy * dy > 1) continue;
          const n = (x * 7 + y * 13 + i * 5) % 5;
          g.set(x, y, n === 0 ? ink.leaf[2] : r[dx + dy < -0.4 ? 4 : n % 2 === 0 ? 3 : 2]);
        }
      }
    }
  } else if (kind === 'noodles') {
    // A steaming pot at one end, bowls stacked at the other.
    const potR = Math.max(1.5, H * 0.13);
    const px = left + span * 0.3;
    shadedEllipse(g, px, counterTop - potR * 0.7, potR, potR * 0.8, ink.metal, { dither: false });
    for (let x = Math.floor(px - potR); x <= Math.floor(px + potR); x++) g.set(x, Math.floor(counterTop - potR * 1.4), ink.metal[4]);
    if (big) {
      for (let k = 0; k < 3; k++) {
        const sx = px - potR * 0.5 + k * potR * 0.5;
        for (let y = 0; y < H * 0.14; y++) g.set(Math.floor(sx + Math.sin(y * 0.9 + k) * 0.8), Math.floor(counterTop - potR * 1.6 - y), y % 3 === 0 ? 0 : ink.steam);
      }
    }
    const bowlW = Math.max(2, Math.round(H * 0.12));
    for (let k = 0; k < (big ? 3 : 2); k++) {
      const bx = left + span * 0.62 + k * (bowlW + 1);
      for (let y = 0; y < Math.max(1, Math.round(H * 0.06)); y++) for (let x = 0; x < bowlW - y; x++) g.set(Math.floor(bx + x + y / 2), counterTop - 1 - y, ink.goods[0][y === 0 ? 2 : 3]);
    }
    // A red lantern hung from the awning.
    lantern(g, ink.goods[1], right - span * 0.15, H * 0.36, Math.max(1, H * 0.06));
  } else if (kind === 'lanterns') {
    // Paper lanterns strung under the awning and laid out on the counter.
    const n = Math.max(2, Math.round(span / Math.max(3, H * 0.2)));
    for (let k = 0; k < n; k++) {
      const lx = left + (k + 0.5) * (span / n);
      lantern(g, ink.goods[k % ink.goods.length], lx, H * (0.36 + (k % 2) * 0.05), Math.max(1, H * 0.065));
    }
    // Folded ones for sale along the counter.
    for (let x = left + 1; x < right - 1; x++) if (x % 3 !== 0) g.set(x, counterTop - 1, ink.goods[(x >> 1) % ink.goods.length][2]);
  } else {
    // Trinkets: a rack of little hanging things, a tray of bright odds and ends.
    const rackY = Math.round(H * 0.33);
    for (let x = left + 1; x < right - 1; x++) g.set(x, rackY, ink.metal[2]);
    for (let x = left + 2; x < right - 2; x += big ? 2 : 3) {
      const r = ink.goods[(x * 3) % ink.goods.length];
      g.set(x, rackY + 1, r[3]);
      if (big) g.set(x, rackY + 2, r[2]);
    }
    for (let x = left + 1; x < right - 1; x++) {
      const r = ink.goods[(x * 7) % ink.goods.length];
      g.set(x, counterTop - 1, r[(x % 3) + 1]);
      if (big && x % 2 === 0) g.set(x, counterTop - 2, r[2]);
    }
  }
}

/** A round paper lantern on a cord from the awning, with a dark cap and tassel. */
function lantern(g: PixelGrid, r: Ramp, x: number, y: number, radius: number): void {
  for (let cy = Math.floor(g.height * 0.28); cy < Math.floor(y - radius * 1.1); cy++) g.set(Math.floor(x), cy, r[0]);
  if (radius >= 1.5) shadedEllipse(g, x, y, radius, radius * 1.1, r, { dither: false });
  else g.set(Math.floor(x), Math.floor(y), r[3]);
  g.set(Math.floor(x), Math.floor(y - radius * 1.1 - 0.5), r[0]);
  if (radius >= 1.5) g.set(Math.floor(x), Math.floor(y + radius * 1.1 + 0.5), r[0]);
}

function drawCart(g: PixelGrid, ink: StallInk, stage: number, W: number, H: number): void {
  // A pastry cart: a steel box on wheels with a glass case on top, under a parasol.
  const bodyTop = Math.round(H * 0.5);
  const bodyBottom = Math.round(H * 0.82);
  const left = Math.round(W * 0.14);
  const right = W - left;
  for (let y = bodyTop; y < bodyBottom; y++) {
    for (let x = left; x < right; x++) {
      const stripe = y === Math.round(H * 0.62) || y === Math.round(H * 0.62) + (H >= 20 ? 1 : 0);
      g.set(x, y, stripe ? ink.cloth[2] : ink.wood[x < left + 2 ? 4 : y === bodyTop ? 4 : 2]);
    }
  }
  // Wheels.
  const wr = Math.max(1, H * 0.08);
  for (const wx of [left + wr + 1, right - wr - 1]) shadedEllipse(g, wx, H - wr - 0.5, wr, wr, ink.metal, { dither: false, bias: -1 });
  // Handle.
  for (let x = right; x < Math.min(W, right + Math.round(W * 0.1)); x++) g.set(x, bodyTop + 1, ink.metal[1]);
  if (stage >= 1) {
    // Parasol pole.
    const px = Math.round(W / 2);
    for (let y = Math.round(H * 0.12); y < bodyTop; y++) g.set(px, y, ink.metal[1]);
  }
  if (stage >= 2) {
    // The parasol: a shallow dome of alternating panels.
    const cx = W / 2;
    const half = W * 0.5;
    const top = H * 0.04;
    const rim = H * 0.24;
    const panels = 6;
    for (let y = Math.floor(top); y <= Math.floor(rim); y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - cx) / half;
        const dy = (y + 0.5 - rim) / (rim - top);
        if (dx * dx + dy * dy > 1) continue;
        const panel = Math.floor((dx + 1) * panels * 0.5);
        const r = panel % 2 === 0 ? ink.awnA : ink.awnB;
        g.set(x, y, r[-dx * 0.5 - dy * 0.6 > 0.3 ? 3 : 2]);
      }
    }
  }
  if (stage >= 3) {
    // A glass case of pastries on the cart.
    const caseTop = bodyTop - Math.max(2, Math.round(H * 0.14));
    for (let y = caseTop; y < bodyTop; y++) {
      for (let x = left + 1; x < right - 1; x++) {
        const pastry = y >= bodyTop - Math.max(1, Math.round(H * 0.06)) && (x - left) % 3 !== 0;
        g.set(x, y, pastry ? ink.goods[(x >> 1) % 2][2 + ((x + y) % 2)] : y === caseTop ? ink.metal[4] : ink.metal[3]);
      }
    }
  }
}

/** Glowing bits of a night stall, to draw additively after dark: bulbs along the awning, lit lanterns, a warm counter. */
export function drawStallLightsSized(kind: StallKind, height: number): PixelGrid | null {
  if (!NIGHT_STALLS.includes(kind)) return null;
  const H = Math.max(5, Math.round(height));
  const W = Math.max(6, Math.round(H * 1.25));
  const g = new PixelGrid(W, H);
  // A string of bulbs sagging along the valance.
  const sag = H * 0.04;
  const y0 = H * 0.3;
  const step = Math.max(2, Math.round(W / 8));
  for (let x = 1; x < W - 1; x += step) {
    const t = x / W;
    g.set(x, Math.floor(y0 + Math.sin(t * Math.PI * 2) ** 2 * sag), 1);
  }
  const counterTop = Math.round(H * 0.56);
  const left = Math.round(W * 0.06);
  const right = W - left;
  const span = right - left;
  if (kind === 'noodles') {
    const radius = Math.max(1, H * 0.06);
    glowBlob(g, right - span * 0.15, H * 0.36, radius, 2);
  } else if (kind === 'lanterns') {
    const n = Math.max(2, Math.round(span / Math.max(3, H * 0.2)));
    for (let k = 0; k < n; k++) glowBlob(g, left + (k + 0.5) * (span / n), H * (0.36 + (k % 2) * 0.05), Math.max(1, H * 0.065), 2);
  }
  // Warm light on the counter's goods.
  for (let x = left + 2; x < right - 2; x += 2) g.set(x, counterTop - 1, 3);
  return g;
}

function glowBlob(g: PixelGrid, x: number, y: number, radius: number, color: number): void {
  if (radius < 1.5) {
    g.set(Math.floor(x), Math.floor(y), color);
    return;
  }
  g.ellipse(x, y, radius * 0.8, radius * 0.9, color);
  g.set(Math.floor(x - radius * 0.3), Math.floor(y - radius * 0.3), 4);
}

export const STALL_LIGHT_PALETTE = [0, 0xffe6a0, 0xff7a3c, 0xffc870, 0xffd8a8];

export class StallSpriteCache {
  private readonly cache = new Map<string, Texture>();

  /** A stall at a set-up stage, drawn `height` px tall (it's seen at many distances). */
  get(kind: StallKind, stage: number, height: number): Texture {
    const key = `${kind}:${stage}:${height}`;
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, palette } = drawStallSized(kind, stage, height);
      texture = gridToTexture(grid, palette.colors);
      this.cache.set(key, texture);
    }
    return texture;
  }

  lights(kind: StallKind, height: number): Texture | null {
    const key = `${kind}:lights:${height}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const grid = drawStallLightsSized(kind, height);
    if (!grid) return null;
    const texture = gridToTexture(grid, STALL_LIGHT_PALETTE);
    this.cache.set(key, texture);
    return texture;
  }
}
