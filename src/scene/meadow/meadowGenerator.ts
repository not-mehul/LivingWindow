import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import { FOCAL } from '../../sim/groundPlane';
import type { Obstacle } from '../../sim/groundWalker';
import { MEADOW_HORIZON, meadowCreek, meadowPath, meadowPlane } from '../../sim/meadowGeometry';
import { depthForScale } from '../../sim/perspective';
import { pixelHash } from '../../sprites/raster';
import { ditherRamp, valueNoise } from '../common/paint';
import { BROADLEAF, CONIFER, drawBroadleaf, drawConifer, drawOak, hazePalette, type TreePalette } from '../common/trees';
import type { Trunk } from '../forest/forestGenerator';

/**
 * The meadows after the reference drawing: hazy hills and a wooded tree line
 * on the horizon, a sunlit pasture rolling towards us with bare earth patches,
 * a two-track path winding away over a rise, big field oaks on the left, a
 * creek and a hen house on the right by a hedge, and a bank of wildflowers
 * right in front of the window.
 */

/** A piece of art at a world position, with the ground y it stands on. */
export interface Placed {
  art: PixelBuffer;
  x: number;
  y: number;
  baseY: number;
  /** Plants sway; buildings and posts don't. */
  sway: number;
  /** Atmospheric haze to tint it with (0 = none). */
  haze: number;
}

export interface MeadowOak extends Placed {
  /** Crown centre and radius in world px, for its shadow. */
  crownX: number;
  crownY: number;
  crownRadius: number;
}

/** The creek's water pixels, for animating its surface. */
export interface CreekPixels {
  /** Index into the world (y * WORLD_WIDTH + x). */
  index: Int32Array;
  /** Ground px along the creek (depth × focal length) and across it. */
  along: Float32Array;
  across: Float32Array;
  /** 0 far .. 1 near. */
  nearness: Float32Array;
}

export interface MeadowLayout {
  hills: PixelBuffer;
  treeLine: PixelBuffer;
  ground: PixelBuffer;
  creek: CreekPixels;
  oaks: MeadowOak[];
  /** Everything standing on the pasture, sorted among the creatures by base y. */
  standing: Placed[];
  /** The wildflower bank in front of the window. */
  flowers: Placed[];
  /** Cover the rabbits hide in. */
  bushes: Array<{ x: number; y: number; width: number }>;
  coop: { x: number; baseY: number; door: { x: number; y: number }; gx: number; depth: number };
  obstacles: Obstacle[];
  trunks: Trunk[];
  ledges: Ledge[];
}

const HAZE = 0xc4d8dc;
const BIRD_SCALE = 0.34;
const birdZ = (y: number) => depthForScale(BIRD_SCALE * meadowPlane.scaleAtY(y));
const hazeAt = (y: number) => Math.max(0, 0.42 - meadowPlane.scaleAtY(y) * 0.8);

const GRASS = [0x5c8434, 0x6c963e, 0x84a84a, 0x9cba58, 0xb6c86a];
const EARTH = [0x7e6040, 0x967650, 0xae8e62, 0xc2a476];
const INK = 0x2a3a1c;

// --- Plants ---------------------------------------------------------------

/** A stem from (x, y) bending by `bend` over `len` px, returning its tip. */
function stem(p: PixelBuffer, x: number, y: number, len: number, bend: number, color: number): { x: number; y: number } {
  let tx = x;
  let ty = y;
  for (let t = 0; t <= len; t++) {
    const f = t / len;
    tx = x + bend * f * f;
    ty = y - t;
    p.set(tx, ty, color);
  }
  return { x: tx, y: ty };
}

function disc(p: PixelBuffer, cx: number, cy: number, rx: number, ry: number, color: (dx: number, dy: number) => number | null): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const c = color(dx, dy);
      if (c !== null) p.set(x, y, c);
    }
  }
}

const STEM = 0x4e7a32;
const STEM_DARK = 0x3a5e26;

/** Field poppies: nodding scarlet cups with dark hearts, and a hairy bud or two. */
function drawPoppies(rng: () => number, scale: number): PixelBuffer {
  const w = Math.round(40 * scale);
  const h = Math.round(randomRange(rng, 44, 62) * scale);
  const p = new PixelBuffer(w + 4, h + 2);
  const n = randomInt(rng, 2, 4);
  for (let i = 0; i < n; i++) {
    const bx = 4 + (w - 6) * ((i + 0.5) / n) + randomRange(rng, -3, 3) * scale;
    const len = h * randomRange(rng, 0.55, 0.95);
    const tip = stem(p, bx, h, len, randomRange(rng, -6, 6) * scale, i % 2 ? STEM : STEM_DARK);
    if (rng() < 0.25) {
      // A bud, hanging its head.
      disc(p, tip.x + 1, tip.y + 2, 2 * scale + 0.5, 3 * scale + 0.5, (dx) => (dx < 0 ? 0x6a9a44 : 0x4e7a32));
      continue;
    }
    const r = (5 + rng() * 3) * scale + 1;
    disc(p, tip.x, tip.y, r * 1.15, r, (dx, dy) => {
      const d = dx * dx + dy * dy;
      if (d < 0.12) return 0x1a1414;
      // Four crinkled petals: darker folds between them.
      const a = Math.atan2(dy, dx);
      const fold = Math.abs(Math.sin(a * 2)) < 0.18;
      return fold ? 0xa82418 : dy < -0.2 && dx < 0.3 ? 0xf06048 : 0xd83a28;
    });
  }
  // Grass blades round the stems.
  for (let i = 0; i < 4; i++) stem(p, randomRange(rng, 2, w), h, h * randomRange(rng, 0.2, 0.45), randomRange(rng, -5, 5), 0x6a9a44);
  p.outline(INK);
  return p;
}

/** Ox-eye daisies: white rays round a yellow boss on tall thin stems. */
function drawDaisies(rng: () => number, scale: number): PixelBuffer {
  const w = Math.round(36 * scale);
  const h = Math.round(randomRange(rng, 34, 52) * scale);
  const p = new PixelBuffer(w + 6, h + 4);
  const n = randomInt(rng, 2, 5);
  for (let i = 0; i < n; i++) {
    const bx = 3 + (w - 2) * ((i + 0.5) / n);
    const tip = stem(p, bx, h + 2, h * randomRange(rng, 0.5, 0.95), randomRange(rng, -5, 5) * scale, STEM);
    const r = (3.5 + rng() * 2) * scale + 1.2;
    disc(p, tip.x, tip.y, r, r * 0.8, (dx, dy) => {
      const d = dx * dx + dy * dy;
      if (d < 0.14) return dy < 0 ? 0xf8d040 : 0xd8a020;
      // Separate rays.
      const a = Math.atan2(dy, dx);
      if (d > 0.5 && Math.abs(Math.sin(a * 6)) < 0.25) return null;
      return dy > 0.3 ? 0xd8d8d0 : 0xf8f8f2;
    });
  }
  p.outline(INK);
  return p;
}

/** Bluebells: arching stems hung along one side with nodding violet-blue bells. */
function drawBluebells(rng: () => number, scale: number): PixelBuffer {
  const w = Math.round(34 * scale);
  const h = Math.round(randomRange(rng, 40, 58) * scale);
  const p = new PixelBuffer(w + 8, h + 4);
  for (let i = 0; i < randomInt(rng, 1, 3); i++) {
    const bx = 4 + rng() * w * 0.6;
    const len = h * randomRange(rng, 0.75, 1);
    const arch = randomRange(rng, 8, 14) * scale;
    const bells = randomInt(rng, 3, 6);
    for (let t = 0; t <= len; t++) {
      const f = t / len;
      p.set(bx + arch * f * f, h + 2 - t + (f > 0.8 ? (f - 0.8) * len * 0.5 : 0), STEM_DARK);
    }
    for (let b = 0; b < bells; b++) {
      const f = 0.55 + (b / bells) * 0.45;
      const x = bx + arch * f * f;
      const y = h + 2 - f * len + (f > 0.8 ? (f - 0.8) * len * 0.5 : 0);
      const r = (2.2 + rng()) * scale + 0.8;
      // Hanging just below the stem, flared at the mouth.
      disc(p, x + 1, y + r + 1, r * 0.8, r * 1.2, (dx, dy) => (dy > 0.6 ? 0x8a8ae8 : dx < -0.2 ? 0x7070d0 : 0x5050b4));
    }
  }
  // Strap leaves.
  for (let i = 0; i < 3; i++) stem(p, randomRange(rng, 2, w), h + 2, h * randomRange(rng, 0.25, 0.45), randomRange(rng, -6, 6), 0x4e7a32);
  p.outline(INK);
  return p;
}

/** Meadow cranesbill: open five-petalled purple flowers on branching stems. */
function drawCranesbill(rng: () => number, scale: number): PixelBuffer {
  const w = Math.round(34 * scale);
  const h = Math.round(randomRange(rng, 30, 44) * scale);
  const p = new PixelBuffer(w + 6, h + 4);
  for (let i = 0; i < randomInt(rng, 2, 4); i++) {
    const tip = stem(p, 3 + rng() * w, h + 2, h * randomRange(rng, 0.5, 0.95), randomRange(rng, -6, 6) * scale, STEM);
    const r = (3 + rng() * 1.5) * scale + 1;
    disc(p, tip.x, tip.y, r, r, (dx, dy) => {
      const d = dx * dx + dy * dy;
      if (d < 0.1) return 0xf0e0f0;
      const a = Math.atan2(dy, dx);
      return Math.abs(Math.sin(a * 2.5)) < 0.2 ? 0x6a3a9a : dy < 0 ? 0xa070d0 : 0x8a58bc;
    });
  }
  p.outline(INK);
  return p;
}

/** A thistle: a spiny stem and leaves under a tufted purple head. */
function drawThistle(rng: () => number, scale: number): PixelBuffer {
  const h = Math.round(randomRange(rng, 46, 62) * scale);
  const w = Math.round(22 * scale);
  const p = new PixelBuffer(w + 4, h + 4);
  const bx = w / 2 + 2;
  const tip = stem(p, bx, h + 2, h * 0.8, randomRange(rng, -3, 3), STEM_DARK);
  // Spiky leaves.
  for (let k = 0; k < 4; k++) {
    const y = h + 2 - h * (0.2 + k * 0.15);
    const side = k % 2 ? 1 : -1;
    for (let t = 0; t < 7 * scale + 2; t++) p.set(bx + side * t, y - t * 0.4 + (t % 2), 0x5a8a44);
  }
  const r = 3.5 * scale + 1;
  disc(p, tip.x, tip.y + r * 0.6, r, r * 0.9, (dx) => (dx < 0 ? 0x5e8a4a : 0x4a7038));
  for (let t = 0; t < r * 1.6; t++) {
    for (let k = -2; k <= 2; k++) p.set(tip.x + k * r * 0.4, tip.y - t * 0.5 - Math.abs(k) * 0.2, k === 0 ? 0xd070c8 : 0xb050b0);
  }
  p.outline(INK);
  return p;
}

/** Seed-headed grasses (cocksfoot, foxtail): long stems with golden heads. */
function drawSeedGrass(rng: () => number, scale: number): PixelBuffer {
  const w = Math.round(28 * scale);
  const h = Math.round(randomRange(rng, 54, 76) * scale);
  const p = new PixelBuffer(w + 8, h + 2);
  for (let i = 0; i < randomInt(rng, 2, 4); i++) {
    const bend = randomRange(rng, -8, 8) * scale;
    const len = h * randomRange(rng, 0.7, 1);
    const tip = stem(p, 4 + rng() * w, h, len, bend, 0x8a9a50);
    const head = (9 + rng() * 6) * scale;
    for (let t = 0; t < head; t++) {
      const x = tip.x - (bend / len) * t * 0.6;
      const y = tip.y + t;
      p.set(x, y, t % 3 === 0 ? 0xe0c070 : 0xc8a050);
      if (t % 2 === 0) p.set(x + (t % 4 === 0 ? 1 : -1), y, 0xb08840);
    }
  }
  for (let i = 0; i < 5; i++) stem(p, randomRange(rng, 2, w), h, h * randomRange(rng, 0.3, 0.6), randomRange(rng, -6, 6), i % 2 ? 0x6a9a44 : 0x7aa64e);
  p.outline(0x3a3a1c);
  return p;
}

/** A clump of long grass blades. */
function drawBlades(rng: () => number, scale: number, color = 0x6a9a44): PixelBuffer {
  const w = Math.round(randomRange(rng, 14, 26) * scale);
  const h = Math.round(randomRange(rng, 16, 34) * scale);
  const p = new PixelBuffer(w + 6, h + 1);
  for (let i = 0; i < randomInt(rng, 6, 11); i++) {
    const tip = h * randomRange(rng, 0.4, 1);
    stem(p, 3 + rng() * w, h, tip, randomRange(rng, -6, 6) * scale, i % 3 === 0 ? 0x4e7a32 : i % 3 === 1 ? color : 0x8ab25a);
  }
  return p;
}

/** Leafy shading for a clump: lit from the upper left, broken into little leaf masses. */
export function leafShade(pal: TreePalette, dx: number, dy: number, d: number, x: number, y: number, seed: number): number {
  const light = -dx * 0.6 - dy * 0.9 + (1 - d) * 0.3 + (valueNoise(x, y, 3, seed) - 0.5) * 0.9;
  if (d > 0.82 && dy > 0.1) return pal.shadow;
  return light > 0.6 ? pal.highlight : light > 0.15 ? pal.light : light > -0.35 ? pal.base : light > -0.8 ? pal.dark : pal.shadow;
}

/** A leafy bush (hedge or field bush): overlapping clumps of leaves. */
function drawBush(w: number, h: number, seed: number, haze: number): PixelBuffer {
  const pal = hazePalette(BROADLEAF, HAZE, haze);
  const p = new PixelBuffer(Math.ceil(w) + 4, Math.ceil(h) + 3);
  const clumps = Math.max(4, Math.round(w / 7));
  for (let k = 0; k < clumps; k++) {
    const r = h * (0.25 + pixelHash(k, 1, seed) * 0.2);
    const cx = 2 + r + (w - 2 * r) * pixelHash(k, 2, seed);
    const cy = h + 1 - r - pixelHash(k, 3, seed) * (h - 2 * r);
    disc(p, cx, cy, r, r, (dx, dy) => {
      const px = Math.round(cx + dx * r);
      const py = Math.round(cy + dy * r);
      return leafShade(pal, dx, dy, dx * dx + dy * dy, px, py, seed + k);
    });
  }
  p.outline(pal.ink);
  return p;
}

// --- The scene ----------------------------------------------------------

export function generateMeadow(seed = 6060): MeadowLayout {
  const ledges: Ledge[] = [];
  const trunks: Trunk[] = [];
  const obstacles: Obstacle[] = [];
  const standing: Placed[] = [];

  // --- Hazy hills behind the tree line ---
  const hills = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const ridge = (x: number, base: number, amp: number, s: number) =>
    base - amp * (0.55 + 0.3 * Math.sin(x * 0.007 + s) + 0.15 * Math.sin(x * 0.021 + s * 2)) + (valueNoise(x, s, 9, 5) - 0.5) * 3;
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const far = ridge(x, 172, 22, 1);
    const near = ridge(x, 182, 16, 4);
    for (let y = Math.floor(far); y < 200; y++) {
      const isNear = y >= near;
      const ramp = isNear ? [0x7c9c84, 0x88a88e, 0x96b49a] : [0x98b0ac, 0xa4bab4, 0xb0c4bc];
      // Woods on the slopes, as a soft speckle.
      const level = 0.45 + (valueNoise(x, y, 3, isNear ? 21 : 22) - 0.5) * 0.9;
      hills.set(x, y, ditherRamp(ramp, level, x, y));
    }
  }

  // --- The wooded tree line along the horizon ---
  const treeLine = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const treeRng = createRng(seed + 1);
  const foot = (x: number) => MEADOW_HORIZON + 4 + Math.sin(x * 0.013) * 2 + (x > 600 ? (x - 600) * 0.05 : 0);
  type Stamp = { baseY: number; paint: () => void };
  const stamps: Stamp[] = [];
  // An undergrowth band where the trees meet the grass.
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const f = foot(x);
    for (let y = Math.floor(f - 6 - valueNoise(x, 1, 7, 8) * 5); y < f + 2; y++) {
      treeLine.set(x, y, ditherRamp([0x56785a, 0x62845e, 0x6e9064], valueNoise(x, y, 3, 9), x, y));
    }
  }
  // Two ragged rows of woodland: the back one smaller and hazier.
  for (const row of [0, 1]) for (let x = -10; x < WORLD_WIDTH + 10; x += randomRange(treeRng, 5, 12) + row * 3) {
    const nearRight = x > 600 ? (x - 600) / 240 : 0;
    const baseY = foot(x) + (row ? randomRange(treeRng, 0, 3) : randomRange(treeRng, -4, -1)) + nearRight * 6 * row;
    // Mostly mid-sized trees, with now and then a big one standing out.
    const big = treeRng() < 0.12 ? 1.5 : 1;
    const h = randomRange(treeRng, 12, 26) * (row ? 1.15 : 0.85) * big * (1 + nearRight * 1.3 * row);
    const haze = (row ? 0.42 : 0.56) - nearRight * 0.2 * row;
    const kind = treeRng();
    const palette: TreePalette = hazePalette(kind < 0.18 ? CONIFER : BROADLEAF, HAZE, haze + (treeRng() - 0.5) * 0.12);
    const s = Math.floor(treeRng() * 1e5);
    // Spruces, poplars (tall and narrow) and spreading broadleaves.
    const tree = kind < 0.18 ? drawConifer(h * 1.15, s, palette) : kind < 0.28 ? drawConifer(h * 1.4, s, palette) : kind < 0.55 ? drawOak(h, s, palette) : drawBroadleaf(h * 1.1, s, palette);
    const tx = x;
    stamps.push({ baseY, paint: () => treeLine.draw(tree.buffer, tx - tree.baseX, baseY - tree.baseY) });
    if (h > 26) ledges.push({ x0: Math.round(tx - 2), x1: Math.round(tx + 2), y: Math.round(baseY - tree.baseY + tree.tipY), layer: 'far', kind: 'treetop', z: birdZ(baseY) });
  }
  stamps.sort((a, b) => a.baseY - b.baseY);
  for (const s of stamps) s.paint();

  // --- The pasture, path, earth patches and creek bed ---
  const ground = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const earthPatches = [
    { x: 118, y: 250, w: 150 },
    { x: 480, y: 286, w: 190 },
    { x: 700, y: 312, w: 120 },
    { x: 300, y: 212, w: 70 },
  ].map((p) => ({ ...meadowPlane.unproject(p.x, p.y), rx: (p.w / 2) * meadowPlane.depthAtY(p.y), seed: p.x }));
  const creekIndex: number[] = [];
  const creekAlong: number[] = [];
  const creekAcross: number[] = [];
  const creekNear: number[] = [];
  const flowerColors = [0xf8f8f2, 0xf0d040, 0x6a7ae0, 0xd83a28, 0xa070d0];
  // A rise across the left of the field: the path drops behind it.
  const riseRow = Float32Array.from({ length: WORLD_WIDTH }, (_, x) => 212 + Math.sin(x * 0.011) * 4 + x * 0.012);
  const riseY = (x: number) => riseRow[x];
  // The ground's swell changes slowly: sample it every few px and blend between.
  const SWELL_STEP = 4;
  const swellRow = new Float32Array(Math.ceil(WORLD_WIDTH / SWELL_STEP) + 2);
  for (let y = MEADOW_HORIZON + 1; y < WORLD_HEIGHT; y++) {
    const depth = meadowPlane.depthAtY(y);
    const s = meadowPlane.scaleAtY(y);
    const haze = hazeAt(y);
    const stretch = 0.3 + s * 0.7;
    const gz = depth * FOCAL;
    const pathX = meadowPath.centreX(y);
    const creekX = meadowCreek.centreX(y);
    // Offsets across the path and creek, square to them (the same all along a row).
    const pathCos = depth * meadowPath.cosine(depth);
    const creekCos = depth * meadowCreek.cosine(depth);
    for (let i = 0; i < swellRow.length; i++) {
      const gx = (i * SWELL_STEP - meadowPlane.vanishX) * depth;
      swellRow[i] = valueNoise(gx, gz, 300, 3) * 0.65 + valueNoise(gx, gz, 110, 4) * 0.35;
    }
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const gx = (x - meadowPlane.vanishX) * depth;
      // Gently rolling ground: lighter where it rises towards the sun.
      const si = Math.floor(x / SWELL_STEP);
      const sf = (x % SWELL_STEP) / SWELL_STEP;
      const swell = swellRow[si] + (swellRow[si + 1] - swellRow[si]) * sf;
      let level = 0.32 + swell * 0.5 + (valueNoise(x, y / stretch, 3 + 7 * s, 6) - 0.5) * 0.35;
      if (x < 520 && y < riseY(x) && y > riseY(x) - 10) level -= 0.18;
      // Blades of grass: a dark stroke under a light tip.
      const blade = pixelHash(x, Math.floor(y / Math.max(1, Math.round(3 * s))), 11);
      if (blade < 0.06 * s) level -= 0.25;
      else if (blade > 1 - 0.05 * s) level += 0.25;
      let color = ditherRamp(GRASS, level, x, y);
      // Bare earth worn through the grass.
      for (const e of earthPatches) {
        const dx = (gx - e.gx) / e.rx;
        const dz = ((depth - e.depth) * FOCAL) / (e.rx * 0.45);
        if (dx * dx + dz * dz > 1.5) continue;
        const d = dx * dx + dz * dz + (valueNoise(x, y, 6, e.seed) - 0.5) * 0.9;
        if (d < 1) color = d > 0.8 && pixelHash(x, y, 13) < 0.5 ? GRASS[1] : ditherRamp(EARTH, 0.35 + (1 - d) * 0.25 + (valueNoise(x, y, 3, 14) - 0.5) * 0.4, x, y);
      }
      // Flowers dotted through the grass, thicker towards us.
      const fh = pixelHash(x, y, 72);
      if (fh < 0.002 + s * s * 0.012) {
        // Blue cornflowers and red poppies at left, the rest mixed.
        const pick = pixelHash(x, y, 73);
        color = x < 280 && pick < 0.5 ? (pick < 0.3 ? flowerColors[2] : flowerColors[3]) : flowerColors[Math.floor(pick * flowerColors.length)];
      }
      // The two-track path: worn ruts either side of a grassy crown.
      if (y > meadowPath.endY && Math.abs((x - pathX) * depth) < meadowPath.halfWidth * 2) {
        const off = Math.abs((x - pathX) * pathCos);
        const half = meadowPath.halfWidth;
        if (off < half) {
          const rut = off > half * 0.28;
          color = rut ? ditherRamp(EARTH, 0.5 + (valueNoise(x, y, 4, 15) - 0.5) * 0.6 + (off > half * 0.7 ? 0.2 : 0), x, y) : ditherRamp(GRASS, 0.7, x, y);
          if (off > half - depth * 1.2) color = 0x6a5030;
        } else if (off < half + 4 * depth && pixelHash(x, y, 16) < 0.4) color = GRASS[3];
      }
      // The creek: a muddy bank, a lush fringe and the bed (the water is animated over it).
      if (y > meadowCreek.endY && Math.abs((x - creekX) * depth) < meadowCreek.halfWidth * 2.5) {
        const off = (x - creekX) * creekCos;
        const a = Math.abs(off);
        const half = meadowCreek.halfWidth;
        if (a < half) {
          color = 0x3a4a3a;
          creekIndex.push(y * WORLD_WIDTH + x);
          creekAlong.push(gz);
          creekAcross.push(off);
          creekNear.push(Math.min(1, s));
        } else if (a < half + 3 * depth + 1) color = off < 0 ? 0x5a4a30 : 0x6a5838;
        else if (a < half + 12 * depth) color = ditherRamp(GRASS, 0.15 + (a - half) / (12 * depth) * 0.3, x, y);
      }
      ground.set(x, y, lerpColor(color, HAZE, haze));
    }
  }
  // The rise's crest line, inked like the drawing.
  for (let x = 0; x < 520; x++) if (pixelHash(Math.floor(x / 16), 3, 17) > 0.35) ground.set(x, Math.round(riseY(x) - 10), lerpColor(0x4a6a30, HAZE, 0.2));

  // --- Field oaks on the left, with branches to perch on ---
  const oaks: MeadowOak[] = [];
  for (const [i, [x, baseY, height]] of (
    [
      [-6, 222, 120],
      [64, 230, 140],
      [340, 214, 100],
      [200, 246, 170],
    ] as const
  ).entries()) {
    const haze = hazeAt(baseY) * 0.8;
    const oak = drawOak(height, 400 + i * 37, hazePalette(BROADLEAF, HAZE, haze));
    const left = Math.round(x - oak.baseX);
    const top = Math.round(baseY - oak.baseY);
    oaks.push({
      art: oak.buffer,
      x: left,
      y: top,
      baseY,
      sway: 1.5 + height / 80,
      haze: 0,
      crownX: x,
      crownY: top + height * 0.3,
      crownRadius: height * 0.62,
    });
    for (const perch of oak.perches) ledges.push({ x0: left + perch.x0, x1: left + perch.x1, y: top + perch.y, layer: 'near', kind: 'branch', z: birdZ(baseY) });
    ledges.push({ x0: left + oak.tipX - 3, x1: left + oak.tipX + 3, y: top + oak.tipY, layer: 'near', kind: 'treetop', z: birdZ(baseY) });
    trunks.push({ x, width: oak.trunk.width, top: top + oak.trunk.top, bottom: baseY, layer: 'near', squirrelSize: Math.max(6, Math.round(12 * meadowPlane.scaleAtY(baseY))) });
    const g = meadowPlane.unproject(x, baseY);
    obstacles.push({ ...g, r: (oak.trunk.width / 2) * g.depth + 22 });
  }

  // --- The hen house by the creek, with a short paddock fence ---
  const coopX = 536;
  const coopBase = 262;
  const cs = meadowPlane.scaleAtY(coopBase);
  const coopArt = (() => {
    const w = Math.round(80 * cs);
    const h = Math.round(56 * cs);
    const roof = Math.round(22 * cs);
    const p = new PixelBuffer(w + 12, h + roof + 4);
    const x0 = 6;
    const y0 = roof + 2;
    // Planked red walls, lit on the left.
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const u = (x - x0) / w;
        let c = u < 0.5 ? 0xb04a3a : 0x96382c;
        if ((x - x0) % Math.max(3, Math.round(6 * cs)) === 0) c = 0x7a2c22;
        p.set(x, y, c);
      }
    }
    // A pitched roof of dark shingles.
    for (let k = 0; k <= roof; k++) {
      const inset = (roof - k) * (w * 0.5 + 4) / roof;
      for (let x = x0 - 4 + inset; x < x0 + w + 4 - inset; x++) p.set(x, y0 - roof + k, k % 3 === 0 ? 0x3a3028 : x < x0 + w / 2 ? 0x6a5a4a : 0x544638);
    }
    // Door and a little window, and the ramp.
    const door = { x: x0 + Math.round(w * 0.55), w: Math.max(3, Math.round(12 * cs)), h: Math.max(4, Math.round(20 * cs)) };
    p.rect(door.x, y0 + h - door.h, door.w, door.h, 0x2a1a14);
    p.rect(x0 + Math.round(w * 0.18), y0 + Math.round(h * 0.25), Math.max(2, Math.round(9 * cs)), Math.max(2, Math.round(7 * cs)), 0x3a2e28);
    for (let k = 0; k < door.h; k++) p.set(door.x + door.w + k, y0 + h - 1 - Math.floor(k / 2), 0x8a7050);
    p.outline(0x2a1a14);
    return { p, door, x0, y0, w, h };
  })();
  const coopLeft = Math.round(coopX - coopArt.x0 - coopArt.w / 2);
  const coopTop = Math.round(coopBase - coopArt.y0 - coopArt.h);
  standing.push({ art: coopArt.p, x: coopLeft, y: coopTop, baseY: coopBase, sway: 0, haze: hazeAt(coopBase) });
  ledges.push({ x0: coopLeft + coopArt.x0 + 2, x1: coopLeft + coopArt.x0 + coopArt.w - 2, y: coopTop + 1, layer: 'mid', kind: 'roof', z: birdZ(coopBase) });
  const coopGround = meadowPlane.unproject(coopX, coopBase);
  obstacles.push({ ...coopGround, r: 52 });
  const coop = {
    x: coopX,
    baseY: coopBase,
    door: { x: coopLeft + coopArt.door.x + coopArt.door.w / 2, y: coopBase },
    ...coopGround,
  };
  // Fence posts receding beside the hen run.
  for (let i = 0; i < 5; i++) {
    const p = meadowPlane.project(coopGround.gx - 120 + i * 4, coopGround.depth - 0.35 + i * 0.22);
    const h = Math.round(34 * p.scale);
    const w = Math.max(2, Math.round(5 * p.scale));
    const art = new PixelBuffer(w + 2, h + 2);
    for (let y = 1; y <= h; y++) for (let k = 0; k < w; k++) art.set(1 + k, y, k === 0 ? 0xb09a78 : k === w - 1 ? 0x5a4a38 : 0x8a7458);
    art.outline(0x3a3024);
    standing.push({ art, x: Math.round(p.x - w / 2 - 1), y: Math.round(p.y - h - 1), baseY: Math.round(p.y), sway: 0, haze: hazeAt(p.y) });
    ledges.push({ x0: Math.round(p.x - w / 2), x1: Math.round(p.x + w / 2), y: Math.round(p.y - h), layer: 'mid', kind: 'post', z: birdZ(p.y) });
  }

  // --- A hedge along the right, and bushes in the field (rabbit cover) ---
  const bushes: MeadowLayout['bushes'] = [];
  for (const [x, baseY, w, h] of [
    [700, 232, 60, 24],
    [752, 240, 76, 30],
    [806, 248, 84, 34],
    [858, 256, 90, 38],
    [252, 224, 40, 16],
    [455, 306, 56, 22],
  ] as const) {
    const art = drawBush(w, h, x, hazeAt(baseY) * 0.6);
    standing.push({ art, x: Math.round(x - art.width / 2), y: Math.round(baseY - art.height + 2), baseY, sway: 0.8, haze: 0 });
    bushes.push({ x, y: baseY, width: w });
    const g = meadowPlane.unproject(x, baseY);
    obstacles.push({ ...g, r: (w / 2) * g.depth * 0.8 });
  }

  // --- Reeds and yellow flags along the creek banks ---
  const reedRng = createRng(seed + 7);
  for (let depth = 1.35; depth < 7; depth *= 1.06) {
    for (const side of [-1, 1]) {
      if (reedRng() < 0.35) continue;
      const p = meadowCreek.point(depth, side * (meadowCreek.halfWidth + 4));
      if (p.x < -10 || p.x > WORLD_WIDTH + 10) continue;
      const art = drawBlades(reedRng, Math.max(0.3, p.scale * 1.1), 0x5a8a3a);
      if (p.scale > 0.4 && reedRng() < 0.4) for (let k = 0; k < 3; k++) art.set(art.width / 2 + k - 1, 1 + k, 0xf0d040);
      standing.push({ art, x: Math.round(p.x - art.width / 2), y: Math.round(p.y - art.height + 1), baseY: Math.round(p.y), sway: 1.2, haze: hazeAt(p.y) });
    }
  }
  for (const o of meadowCreek.obstacles(1.3, 7, 10)) obstacles.push(o);

  // --- Clumps of flowers and grass out in the field ---
  const fieldRng = createRng(seed + 9);
  for (let i = 0; i < 70; i++) {
    const y = randomRange(fieldRng, 222, 300);
    const x = randomRange(fieldRng, 0, WORLD_WIDTH);
    if (meadowPath.contains(x, y, 6) || meadowCreek.contains(x, y, 12)) continue;
    const s = meadowPlane.scaleAtY(y);
    const roll = fieldRng();
    const art =
      roll < 0.45 ? drawBlades(fieldRng, s) : x < 300 && roll < 0.7 ? drawPoppies(fieldRng, s * 0.6) : roll < 0.85 ? drawDaisies(fieldRng, s * 0.6) : drawSeedGrass(fieldRng, s * 0.6);
    standing.push({ art, x: Math.round(x - art.width / 2), y: Math.round(y - art.height + 1), baseY: Math.round(y), sway: 1.4, haze: hazeAt(y) });
  }

  // --- The wildflower bank in front of the window ---
  const flowers: Placed[] = [];
  const frontRng = createRng(seed + 11);
  for (let i = 0; i < 170; i++) {
    const x = randomRange(frontRng, -10, WORLD_WIDTH + 10);
    const baseY = randomRange(frontRng, 304, 364);
    const scale = 0.55 + ((baseY - 304) / 60) * 0.75;
    const u = x / WORLD_WIDTH;
    const roll = frontRng();
    let art: PixelBuffer;
    // Poppies at left, daisies in the middle, purple then bluebells at right, grasses throughout.
    if (roll < 0.36) art = drawBlades(frontRng, scale * 1.2);
    else if (roll < 0.46) art = drawSeedGrass(frontRng, scale);
    else if (u < 0.3 + (frontRng() - 0.5) * 0.15) art = frontRng() < 0.15 ? drawThistle(frontRng, scale) : drawPoppies(frontRng, scale);
    else if (u < 0.58 + (frontRng() - 0.5) * 0.15) art = drawDaisies(frontRng, scale);
    else if (u < 0.72 + (frontRng() - 0.5) * 0.1) art = drawCranesbill(frontRng, scale);
    else art = drawBluebells(frontRng, scale);
    flowers.push({ art, x: Math.round(x - art.width / 2), y: Math.round(baseY - art.height + 1), baseY: Math.round(baseY), sway: 1 + art.height / 18, haze: 0 });
  }
  flowers.sort((a, b) => a.baseY - b.baseY);

  // Robins hop about on the grass.
  ledges.push({ x0: 140, x1: 700, y: 292, layer: 'near', kind: 'ground', z: birdZ(292) });
  ledges.push({ x0: 380, x1: 640, y: 250, layer: 'mid', kind: 'ground', z: birdZ(250) });

  return {
    hills,
    treeLine,
    ground,
    creek: {
      index: Int32Array.from(creekIndex),
      along: Float32Array.from(creekAlong),
      across: Float32Array.from(creekAcross),
      nearness: Float32Array.from(creekNear),
    },
    oaks,
    standing,
    flowers,
    bushes,
    coop,
    obstacles,
    trunks,
    ledges,
  };
}
