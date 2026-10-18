import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import { GroundPlane } from '../../sim/groundPlane';
import type { Obstacle, WalkArea } from '../../sim/groundWalker';
import { depthForScale } from '../../sim/perspective';
import { pixelHash } from '../../sprites/raster';
import { ditherRamp, valueNoise } from '../common/paint';
import { BROADLEAF, CONIFER, drawBroadleaf, drawConifer, drawTallPine, hazePalette, type TreePalette } from '../common/trees';
import { drawBirch, drawCanopyClump, drawFoxglove, drawMossStrand, drawRock, drawShrub, drawSnag, drawTrunkColumn, type BarkKind } from './forestFlora';

/**
 * The deep forest, after the reference drawing: from a cabin on a wooded
 * rise, the view opens between a gnarled oak and a tall pine onto a valley
 * running away between two mountains. Everything below is laid out on a
 * ground plane, so things shrink and haze over with distance.
 */

/** Eye level: the valley floor vanishes here (and the sun sets behind the ridges). */
export const FOREST_HORIZON = 200;
/** Depth 1 lands at y = 340 (the foot of the view). */
export const FOREST_EYE = 140;
/** Far edge of the wood in front of the cabin; beyond it the land drops into the valley. */
export const BROW_Y = 256;
export const forestPlane = new GroundPlane(FOREST_HORIZON, FOREST_EYE);

/** Where deer may walk: the forest floor, from just beyond the sill out to the brow, among the trunks. */
export const FOREST_FLOOR: WalkArea = {
  minDepth: forestPlane.depthAtY(334),
  maxDepth: forestPlane.depthAtY(BROW_Y + 6),
  halfWidth: (depth) => forestPlane.halfWidthAt(depth) + 40,
};

/** The small sunlit glade the deer path crosses (screen ellipse). */
const GLADE = { x: 440, y: 306, rx: 90, ry: 28 };
const inGlade = (x: number, y: number, grow = 0) => ((x - GLADE.x) / (GLADE.rx + grow)) ** 2 + ((y - GLADE.y) / (GLADE.ry + grow * 0.3)) ** 2 < 1;

/** Bird sprite scale relative to the ground plane (a robin beside a deer). */
const BIRD_SCALE = 0.34;
const birdZ = (y: number) => depthForScale(BIRD_SCALE * forestPlane.scaleAtY(y));

export interface Trunk {
  x: number;
  width: number;
  top: number;
  bottom: number;
  layer: 'mid' | 'near';
  /** Squirrel sprite size on this trunk (smaller on distant trees). */
  squirrelSize?: number;
  /** How far the trunk has swayed at a world row right now (world px), for things climbing it. */
  sway?: (y: number) => number;
}

/** A perch or trunk that rides on a swaying piece: which piece, and where on it (art px from its top-left). */
export interface Attachment {
  target: Ledge | Trunk;
  group: 'mid' | 'canopy';
  index: number;
  x: number;
  y: number;
}

/** A piece of art at a world position. */
export interface Placed {
  art: PixelBuffer;
  x: number;
  y: number;
  /** How it moves: a bough bobs from the trunk at its right end; leaves hang from above; plants grow up. */
  anchor?: 'top' | 'bottom' | 'right' | 'left';
  /** Pieces of one tree share a sway, so its foliage moves together. */
  tree?: number;
  /** The colours in it that are leaves (they rustle); none means it doesn't. */
  leaves?: readonly number[];
}

export interface MidTree extends Placed {
  /** World y of the trunk's base: the sort key among walking deer. */
  baseY: number;
  /** How much of the haze tint this tree takes (further = more). */
  haze: number;
  /** It doesn't sway (a bare trunk column, a rock, something too far off to see move). */
  still?: boolean;
}

export interface ForestLayout {
  /** The far range peeping through the V. */
  far: PixelBuffer;
  /** The two mountains framing the valley, and the one between them. */
  mountains: PixelBuffer;
  /** Forested slopes and valley floor. */
  valley: PixelBuffer;
  /** The clearing in front of the cabin. */
  ground: PixelBuffer;
  /** Trees standing in the wood and along the brow (they sway, and deer pass between them). */
  midTrees: MidTree[];
  /** Ferns and shrubs on the forest floor, sorted with the trees and deer. */
  floorPlants: MidTree[];
  /** Trunk footprints on the ground plane, for deer to walk round. */
  obstacles: Obstacle[];
  /** The framing oak and pine trunks, logs and undergrowth. */
  near: PixelBuffer;
  /** Pine boughs and oak foliage hanging into the top of the view (they sway). */
  canopy: Placed[];
  /** Ferns and wildflowers along the front (they sway). */
  ferns: Placed[];
  trunks: Trunk[];
  ledges: Ledge[];
  /** Openings in the oak's foliage where light shafts fall. */
  gaps: number[];
  /** Perches and trunks that move with the piece they're on. */
  attachments: Attachment[];
}

/**
 * Where light gets through the leaf roof (x of each opening): the places the
 * canopy is thinnest just inside the top of the view, picked a good way
 * apart from each other.
 */
export function canopyGaps(canopy: readonly Placed[], y0 = 20, y1 = 56, count = 6): number[] {
  const cover = new Float32Array(WORLD_WIDTH);
  for (const piece of canopy) {
    if (piece.art.width < 20) continue;
    for (let y = y0; y < y1; y++) {
      const ly = y - Math.round(piece.y);
      if (ly < 0 || ly >= piece.art.height) continue;
      for (let lx = 0; lx < piece.art.width; lx++) {
        const x = Math.round(piece.x) + lx;
        if (x >= 0 && x < WORLD_WIDTH && piece.art.isSet(lx, ly)) cover[x] += 1;
      }
    }
  }
  // Smooth it, then take the thinnest spots, no two within 70 px.
  const smooth = cover.map((_, x) => {
    let sum = 0;
    for (let k = -6; k <= 6; k++) sum += cover[Math.max(0, Math.min(WORLD_WIDTH - 1, x + k))];
    return sum / 13;
  });
  const order = Array.from({ length: WORLD_WIDTH - 60 }, (_, i) => i + 30).sort((a, b) => smooth[a] - smooth[b]);
  const out: number[] = [];
  for (const x of order) {
    if (out.length >= count) break;
    if (out.every((o) => Math.abs(o - x) > 70)) out.push(x);
  }
  return out.sort((a, b) => a - b);
}

/** A tree palette's leaf colours, for rustling. */
export const leafColors = (p: TreePalette): number[] => [p.shadow, p.dark, p.base, p.light, p.highlight];

// --- Shapes ---------------------------------------------------------------

/** A smooth ridge line through control points (cosine-eased between them). */
function ridge(points: ReadonlyArray<readonly [number, number]>, x: number, seed: number, ripple = 1.5): number {
  let y = points[points.length - 1][1];
  if (x <= points[0][0]) y = points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      y = y0 + (y1 - y0) * (1 - Math.cos(Math.PI * t)) * 0.5;
      break;
    }
  }
  return y + Math.sin(x * 0.09 + seed) * ripple + Math.sin(x * 0.23 + seed * 2) * ripple * 0.5;
}

const FAR_RANGE: Array<[number, number]> = [
  [0, 150],
  [140, 136],
  [260, 146],
  [340, 126],
  [420, 140],
  [500, 120],
  [600, 136],
  [720, 128],
  [840, 140],
];
const CENTRE_PEAK: Array<[number, number]> = [
  [320, 230],
  [390, 168],
  [455, 136],
  [520, 150],
  [610, 232],
];
const LEFT_PEAK: Array<[number, number]> = [
  [0, 146],
  [110, 118],
  [210, 102],
  [292, 90],
  [350, 126],
  [410, 172],
  [448, 206],
  [500, 252],
];
const RIGHT_PEAK: Array<[number, number]> = [
  [370, 262],
  [425, 214],
  [470, 174],
  [520, 132],
  [565, 108],
  [610, 80],
  [655, 46],
  [725, 70],
  [785, 96],
  [840, 108],
];

interface MountainStyle {
  base: number;
  light: number;
  dark: number;
  shadow: number;
  trees: number;
  /** Rows below the ridge where the forest begins. */
  treeline: number;
  cliff?: { x0: number; x1: number; y0: number; y1: number };
  rock?: [number, number, number];
}

/** Paint a mountain below its ridge: sunny and shady flanks, ravines, forested lower slopes. */
function paintMountain(
  p: PixelBuffer,
  points: ReadonlyArray<readonly [number, number]>,
  seed: number,
  style: MountainStyle,
  bottom = 300,
): void {
  const x0 = Math.max(0, Math.floor(points[0][0]));
  const x1 = Math.min(WORLD_WIDTH - 1, Math.ceil(points[points.length - 1][0]));
  const ramp = [style.shadow, style.dark, style.base, style.light];
  for (let x = x0; x <= x1; x++) {
    const r = ridge(points, x, seed);
    const slope = ridge(points, x + 4, seed) - ridge(points, x - 4, seed);
    // Light comes from the upper left: rising flanks face it.
    const lit = Math.max(-1, Math.min(1, -slope / 5));
    for (let y = Math.ceil(r); y < bottom; y++) {
      const depth = y - r;
      // Soft patches of light across the slope, shading darker lower down.
      const patch = valueNoise(x, y, 11, seed) - 0.5 + (valueNoise(x, y, 4, seed + 1) - 0.5) * 0.35;
      const level = 0.55 + lit * 0.32 + patch * 0.55 - Math.min(0.15, depth * 0.0015);
      let color = ditherRamp(ramp, level, x, y);
      // Thin ravines running down the fall line.
      const lane = Math.round(x + depth * 0.55 * Math.sign(slope || 1));
      if (pixelHash(lane, 3, seed) < 0.05 && valueNoise(x, y, 7, seed + 5) > 0.45 && depth > 3) color = style.shadow;
      if (depth < 1.2 && lit >= 0) color = lerpColor(style.light, 0xffffff, 0.18);
      // Cliff face: banded rock.
      const c = style.cliff;
      if (c && style.rock && x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && depth > 4) {
        const edge = Math.min(x - c.x0, c.x1 - x, y - c.y0, c.y1 - y);
        if (edge > valueNoise(x, y, 6, seed + 9) * 12) {
          const band = Math.floor((y + Math.sin(x * 0.15) * 3 + valueNoise(x, y, 5, seed) * 3) / 4) % 3;
          color = style.rock[band];
          if (pixelHash(Math.round(x + y * 0.3), 7, seed + 4) < 0.05) color = style.rock[2];
        }
      }
      // Forest on the lower slopes: clumps of tree tips, thickening downhill.
      if (depth > style.treeline) {
        const density = Math.min(0.8, (depth - style.treeline) / 30) * (0.55 + valueNoise(x, y, 6, seed + 3) * 0.7);
        const h = pixelHash(x, y, seed + 2);
        if (h < density) color = h < density * 0.5 ? style.trees : lerpColor(style.trees, color, 0.45);
      }
      p.set(x, y, color);
    }
    // A ragged line of treetops where the ridge is wooded.
    if (r > 120 && pixelHash(x, 1, seed) < 0.35) p.set(x, Math.ceil(r) - 1, style.trees);
  }
}

/** A small, soft conifer stamped straight into a buffer (for the thousands in the valley). */
function stampConifer(p: PixelBuffer, cx: number, baseY: number, height: number, pal: TreePalette, seed: number): void {
  const H = Math.max(3, Math.round(height));
  const tiers = Math.max(2, Math.round(H / 5));
  const reach = H * 0.22;
  for (let y = 0; y < H; y++) {
    const f = y / H;
    const t = Math.floor(f * tiers);
    const k = f * tiers - t;
    const half = 0.4 + reach * ((t + 1) / tiers) * (0.35 + 0.65 * k);
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const u = (x + 0.5 - (cx - half)) / (half * 2);
      if (u < 0 || u > 1) continue;
      let color = u < 0.38 ? pal.light : u > 0.66 ? pal.dark : pal.base;
      if (k > 0.8) color = pal.shadow;
      if (pixelHash(x, y + baseY, seed) < 0.06) color = pal.shadow;
      p.set(x, baseY - H + y, color);
    }
  }
}

/** A round broadleaf crown stamped into a buffer. */
function stampBlob(p: PixelBuffer, cx: number, baseY: number, height: number, pal: TreePalette, seed: number): void {
  const r = height * 0.42;
  const cy = baseY - height + r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / r;
      const d = dx * dx + dy * dy;
      if (d > 1 - pixelHash(x, y, seed) * 0.3) continue;
      const light = -dx * 0.6 - dy * 0.9;
      p.set(x, y, light > 0.35 ? pal.light : light > -0.3 ? pal.base : pal.dark);
    }
  }
  p.set(cx, baseY - 1, pal.barkDark);
}

/** A thick limb or root: stamped circles along a polyline, lit on top. */
function limb(
  p: PixelBuffer,
  path: ReadonlyArray<readonly [number, number]>,
  w0: number,
  w1: number,
  bark: { light: number; base: number; dark: number; deep: number },
  seed: number,
): void {
  const segments: Array<[number, number, number]> = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const length = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    segments.push([i, total, length]);
    total += length;
  }
  for (const [i, start, length] of segments) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    for (let s = 0; s <= length; s += 0.7) {
      const t = s / length;
      const along = (start + s) / total;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const r = (w0 + (w1 - w0) * along) / 2;
      for (let j = -Math.ceil(r); j <= Math.ceil(r); j++) {
        for (let k = -Math.ceil(r); k <= Math.ceil(r); k++) {
          if (j * j + k * k > r * r) continue;
          const v = k / r;
          let color = v < -0.45 ? bark.light : v > 0.5 ? bark.dark : bark.base;
          if (pixelHash(Math.floor((x + j) / 2), Math.floor((y + k) / 4), seed) < 0.16) color = bark.deep;
          p.set(x + j, y + k, color);
        }
      }
    }
  }
}

/** The deep wood's shade, which far trunks fade into (darker and greener than the valley's haze). */
const WOOD_HAZE = 0x6e8c84;
const OAK_BARK = { light: 0x8a7258, base: 0x6a5440, dark: 0x4a3a2c, deep: 0x2e241c };
const PINE_BARK = { light: 0x9a6a4a, base: 0x7a4e36, dark: 0x543424, deep: 0x342016 };
const MOSS = 0x6a8a3a;
const INK = 0x1c2418;

/**
 * A drooping pine bough reaching left from the trunk (its right edge is the
 * trunk end): a sagging main branch with side branchlets, each hanging a
 * ragged fringe of needles, lit on top.
 */
function drawBough(length: number, droop: number, seed: number): PixelBuffer {
  const L = Math.round(length);
  const fringe = 7 + length * 0.07;
  const H = Math.round(droop + fringe * 2.6 + 6);
  const p = new PixelBuffer(L + 4, H);
  const pal = CONIFER;
  const branch = (x0: number, y0: number, len: number, sag: number, f: number, s: number) => {
    const steps = Math.max(2, Math.ceil(len * 1.3));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = Math.round(x0 - len * t);
      const y = y0 + sag * t * t;
      const hang = f * (0.45 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * (0.6 + 0.7 * pixelHash(x, Math.round(y0), s));
      for (let dy = -1; dy <= hang; dy++) {
        let color = dy < 0 ? pal.highlight : dy < 1.5 ? pal.light : dy < hang * 0.55 ? pal.base : dy < hang * 0.85 ? pal.dark : pal.shadow;
        if (pixelHash(x, Math.round(y + dy), s + 5) < 0.06) color = pal.shadow;
        p.set(x, Math.round(y + dy), color);
      }
    }
  };
  // Side branchlets first (behind), then the main branch over them.
  const twigs = 2 + Math.round(length / 50);
  for (let i = 0; i < twigs; i++) {
    const t = (i + 0.6) / (twigs + 0.4);
    const x0 = L + 2 - L * t;
    const y0 = 3 + droop * t * t;
    branch(x0, y0 + fringe * 0.4, L * (0.22 + 0.12 * pixelHash(i, 1, seed)), droop * 0.3 + 4, fringe * 0.8, seed + i);
  }
  branch(L + 2, 3, L, droop, fringe, seed);
  // Bare wood showing near the trunk.
  for (let x = L - 10; x <= L + 2; x++) p.set(x, 3 + droop * ((L + 2 - x) / L) ** 2, PINE_BARK.dark);
  p.outline(pal.ink);
  return p;
}

/** Fern: arching fronds with paired leaflets. */
function drawFern(rng: () => number, scale: number): PixelBuffer {
  const w = Math.round(randomRange(rng, 34, 50) * scale);
  const h = Math.round(randomRange(rng, 22, 32) * scale);
  const p = new PixelBuffer(w + 2, h + 2);
  const fronds = randomInt(rng, 6, 9);
  for (let i = 0; i < fronds; i++) {
    const angle = Math.PI * (0.1 + (0.8 * i) / (fronds - 1));
    const length = randomRange(rng, h * 0.75, h * 1.1);
    for (let t = 0; t < length; t += 0.6) {
      const bend = angle + (t / length) * (angle < Math.PI / 2 ? -0.55 : 0.55);
      const x = 1 + w / 2 - Math.cos(bend) * t;
      const y = h - Math.sin(angle) * t + (t / length) ** 2 * 5 * scale;
      p.set(x, y, 0x3e6a34);
      if (Math.round(t) % 2 === 0 && t > 2) {
        const leaf = Math.max(1, Math.round((1 - t / length) * 3.5 * scale));
        for (let k = 1; k <= leaf; k++) {
          p.set(x, y - k, k === leaf ? 0x88b064 : 0x5e8c46);
          p.set(x, y + Math.min(k, 2), 0x3a5e30);
        }
      }
    }
  }
  p.outline(0x1e3418);
  return p;
}

const FERN_LEAVES = [0x3e6a34, 0x88b064, 0x5e8c46, 0x3a5e30];
const HOLLY_LEAVES = [0x1e3a24, 0x2a4e2e, 0x3a6a3a, 0x5a8a50];

/** A clump of wildflowers: stems and leaves with daisies or purple blooms. */
function drawFlowers(rng: () => number, kind: 'daisy' | 'violet'): PixelBuffer {
  const w = randomInt(rng, 26, 40);
  const h = randomInt(rng, 18, 28);
  const p = new PixelBuffer(w, h);
  for (let i = 0; i < 14; i++) {
    const x = randomRange(rng, 2, w - 2);
    const top = randomRange(rng, 2, h * 0.6);
    for (let y = top; y < h; y++) p.set(x + Math.sin(y * 0.3 + i) * 0.6, y, i % 3 ? 0x4e7a3e : 0x3a5e30);
  }
  const blooms = randomInt(rng, 3, 6);
  for (let i = 0; i < blooms; i++) {
    const x = Math.round(randomRange(rng, 4, w - 4));
    const y = Math.round(randomRange(rng, 3, h * 0.55));
    if (kind === 'daisy') {
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) p.set(x + dx, y + dy, 0xf4f0e4);
      p.set(x, y, 0xe8b830);
      p.set(x + 1, y, 0xd09a20);
    } else {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1]] as const) p.set(x + dx, y + dy, 0xa078c8);
      p.set(x, y, 0xe0c8f0);
      p.set(x, y + 1, 0x6a4a9a);
    }
  }
  p.outline(0x1e3418);
  return p;
}

// --- Layout -----------------------------------------------------------------

export function generateForest(seed = 3141, date = new Date()): ForestLayout {
  const rng = createRng(seed);
  const ledges: Ledge[] = [];
  const trunks: Trunk[] = [];
  const HAZE = 0xb4ccd0;

  // --- The far range and the mountains forming the V ---
  const far = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  paintMountain(far, FAR_RANGE, 11, {
    base: 0xa9c2c6,
    light: 0xbcd2d2,
    dark: 0x98b2b8,
    shadow: 0x8eaab2,
    trees: 0x9ab6b6,
    treeline: 40,
  });
  const mountains = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  paintMountain(mountains, CENTRE_PEAK, 23, {
    base: 0x92b2a8,
    light: 0xa6c2b4,
    dark: 0x82a29a,
    shadow: 0x76968e,
    trees: 0x7a9c8c,
    treeline: 18,
  });
  paintMountain(mountains, RIGHT_PEAK, 37, {
    base: 0x7a9c88,
    light: 0x90b096,
    dark: 0x67887a,
    shadow: 0x587a6c,
    trees: 0x52786a,
    treeline: 26,
    cliff: { x0: 520, x1: 600, y0: 104, y1: 156 },
    rock: [0xa8b0a8, 0x8e9892, 0x6c7874],
  });
  paintMountain(mountains, LEFT_PEAK, 41, {
    base: 0x84a690,
    light: 0x9cbc9e,
    dark: 0x6e9080,
    shadow: 0x5e8070,
    trees: 0x587e68,
    treeline: 22,
  });

  // --- Forest down the slopes and along the valley floor, near trees larger ---
  const valley = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const envelope = (x: number) =>
    Math.min(ridge(LEFT_PEAK, x, 41), x >= 370 ? ridge(RIGHT_PEAK, x, 37) : 999, x >= 320 && x <= 610 ? ridge(CENTRE_PEAK, x, 23) : 999);
  for (let baseY = 150; baseY <= BROW_Y + 8; baseY += 2) {
    const near = (baseY - 150) / (BROW_Y + 8 - 150);
    const conifer = hazePalette(CONIFER, HAZE, 0.72 - near * 0.6);
    const broad = hazePalette(BROADLEAF, HAZE, 0.72 - near * 0.6);
    const height = 4 + near * 18;
    let x = -6 + pixelHash(baseY, 0, 3) * 4;
    while (x < WORLD_WIDTH + 6) {
      const h = height * (0.75 + pixelHash(Math.round(x), baseY, 5) * 0.5);
      if (baseY > envelope(x) + 12) {
        if (pixelHash(Math.round(x), baseY, 7) < 0.22) stampBlob(valley, x, baseY, h * 0.8, broad, baseY);
        else stampConifer(valley, x, baseY, h, conifer, baseY);
      }
      x += h * 0.3 * (0.7 + pixelHash(Math.round(x), baseY, 9) * 0.8);
    }
  }

  // --- The forest floor: moss, earth and leaf litter, with a small sunlit glade ---
  const ground = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const brow = (x: number) => BROW_Y + Math.sin(x * 0.012 + 1) * 5 + Math.sin(x * 0.031) * 2.5;
  const grass = [0x4e6e34, 0x5a7c3a, 0x668a42, 0x76984a, 0x86a656];
  const floor = [0x34421f, 0x3e4e26, 0x4a5a2c, 0x566832, 0x627438];
  const pathAt = (depth: number) => 20 + Math.sin(depth * 2.4) * 40;
  for (let y = Math.floor(BROW_Y - 8); y < WORLD_HEIGHT; y++) {
    const s = forestPlane.scaleAtY(y);
    const depth = forestPlane.depthAtY(y);
    const hazeAmount = Math.max(0, 0.45 - s * 0.5);
    const pathCentre = forestPlane.project(pathAt(depth), depth).x;
    const pathHalf = 8 * s + 1;
    const stretch = 0.35 + s * 0.65;
    for (let x = 0; x < WORLD_WIDTH; x++) {
      if (y < brow(x)) continue;
      const patch = valueNoise(x, y / stretch, 6 + 18 * s, 19) * 0.75 + pixelHash(x, y, 21) * 0.25;
      // Sunlit grass in the glade, fraying into the shaded floor at its edge.
      const glade = inGlade(x, y, (valueNoise(x, y, 9, 33) - 0.5) * 40);
      let color = ditherRamp(glade ? grass : floor, patch, x, y);
      if (glade) {
        if (pixelHash(x, y, 23) < 0.05 + 0.1 * s) color = grass[4];
      } else {
        // Bare earth, moss cushions and fallen leaves.
        const earth = valueNoise(x, y / stretch, 8 + 14 * s, 37);
        if (earth > 0.7) color = earth > 0.8 ? 0x6a5638 : 0x5a4a30;
        if (valueNoise(x, y / stretch, 4 + 8 * s, 41) > 0.78) color = 0x6a8a3a;
        if (pixelHash(x, y, 29) < 0.07) color = pixelHash(x, y, 31) < 0.4 ? 0xa86a30 : pixelHash(x, y, 32) < 0.5 ? 0xc8963e : 0x7a4a26;
      }
      // The trodden deer path.
      if (Math.abs(x - pathCentre) < pathHalf - pixelHash(x, y, 25) * 1.5) color = pixelHash(x, y, 27) < 0.3 ? 0x7a5e3e : 0x8a6c48;
      if (y - brow(x) < 1.5) color = 0x30401e;
      ground.set(x, y, lerpColor(color, HAZE, hazeAmount));
    }
  }

  // --- The wood: trunks in receding rows, trees with their crowns in view, and the floor's plants ---
  const midTrees: MidTree[] = [];
  const floorPlants: MidTree[] = [];
  const obstacles: Obstacle[] = [];
  const attachments: Attachment[] = [];
  const PINE: TreePalette = { ...CONIFER, bark: 0x8a5a3c, barkDark: 0x5a3626 };
  const month = date.getMonth();
  // Near the middle, treetops must stay below the valley so the vista stays open.
  const vistaLimit = (x: number) => {
    const d = Math.abs(x - 440);
    return d < 150 ? 212 : 212 - (d - 150) * 1.6;
  };
  /** The narrow gap onto the valley that nothing tall may cross. */
  const inVista = (x: number) => Math.abs(x - 440) < 72;
  const hazeAtY = (y: number) => Math.max(0, Math.min(0.55, 0.78 - forestPlane.scaleAtY(y)));
  type Spot = { x: number; y: number; r: number };
  const taken: Spot[] = [];
  const clear = (x: number, y: number, r: number) => !taken.some((t) => Math.abs(t.x - x) < (t.r + r) * 0.9 && Math.abs(t.y - y) < 6 + 10 * forestPlane.scaleAtY(y));
  const addTrunk = (trunk: Trunk, index: number | null, x: number) => {
    trunks.push(trunk);
    if (index !== null) attachments.push({ target: trunk, group: 'mid', index, x, y: 0 });
  };

  // Columns: trunks rising out of the top of the view (their crowns are the canopy overhead), in three rows
  // that grow slimmer and mistier with distance, leaving the vista open between the two great pines.
  const colRng = createRng(seed + 4);
  const columns: Array<{ x: number; y: number; width: number; kind: BarkKind }> = [
    { x: 352, y: 334, width: 30, kind: 'pine' },
    { x: 530, y: 330, width: 28, kind: 'pine' },
  ];
  const bands = [
    { y0: 316, y1: 336, w0: 20, w1: 30, count: 5 },
    { y0: 288, y1: 314, w0: 10, w1: 18, count: 9 },
    { y0: 264, y1: 286, w0: 4, w1: 9, count: 14 },
  ];
  const kinds: BarkKind[] = ['pine', 'pine', 'pine', 'oak', 'oak', 'beech', 'pine', 'birch', 'oak'];
  for (const b of bands) {
    let placedHere = 0;
    for (let attempt = 0; attempt < 400 && placedHere < b.count; attempt++) {
      const x = 96 + colRng() * 690;
      const y = b.y0 + colRng() * (b.y1 - b.y0);
      const width = b.w0 + colRng() * (b.w1 - b.w0);
      if (Math.abs(x - 440) < 96 + width || inGlade(x, y, 20)) continue;
      if (columns.some((c) => Math.abs(c.x - x) < (c.width + width) * 0.8 + 6 && Math.abs(c.y - y) < 18)) continue;
      columns.push({ x, y, width, kind: kinds[Math.floor(colRng() * kinds.length)] });
      placedHere++;
    }
  }
  columns.sort((a, b) => a.y - b.y);
  for (const c of columns) {
    const haze = hazeAtY(c.y) * 0.9;
    const roll = colRng();
    const col = drawTrunkColumn(c.kind, c.width, c.y + 6, Math.floor(colRng() * 1e6), haze, WOOD_HAZE, {
      ivy: c.kind !== 'birch' && roll < 0.3,
      fungus: c.kind === 'beech' && roll > 0.6,
      stubs: roll > 0.45,
    });
    midTrees.push({ art: col.buffer, x: Math.round(c.x - col.baseX), y: Math.round(c.y - col.baseY), baseY: Math.round(c.y), haze: haze * 0.35, still: true });
    taken.push({ x: c.x, y: c.y, r: c.width / 2 + 4 });
    const { gx, depth } = forestPlane.unproject(c.x, c.y);
    obstacles.push({ gx, depth, r: (c.width / 2 + 3) / forestPlane.scaleAtY(c.y) + 8 });
    if (c.width >= 6) {
      addTrunk({ x: Math.round(c.x), width: Math.round(c.width), top: 6, bottom: Math.round(c.y), layer: 'mid', squirrelSize: Math.max(5, Math.round(16 * forestPlane.scaleAtY(c.y))) }, null, 0);
    }
  }

  // Trees with their crowns in view: spruces, broadleaves, silver birches and the odd dead snag.
  const treeRng = createRng(seed + 5);
  type Kind = 'spruce' | 'broad' | 'pine' | 'birch' | 'snag';
  const crowned: Array<{ x: number; y: number; s: number; kind: Kind; height: number; seed: number }> = [];
  for (let attempt = 0; attempt < 4000 && crowned.length < 64; attempt++) {
    const y = BROW_Y + 2 + treeRng() * 72;
    const x = 20 + treeRng() * 800;
    const s = forestPlane.scaleAtY(y);
    if (inGlade(x, y, 24)) continue;
    const roll = treeRng();
    const kind: Kind = roll < 0.44 ? 'spruce' : roll < 0.74 ? 'broad' : roll < 0.82 ? 'birch' : roll < 0.93 ? 'pine' : 'snag';
    const real = kind === 'pine' ? 380 : kind === 'spruce' ? 230 + treeRng() * 110 : kind === 'birch' ? 220 + treeRng() * 80 : kind === 'snag' ? 140 + treeRng() * 100 : 200 + treeRng() * 90;
    let height = real * s;
    // Respect the vista: draw a younger, shorter tree, or none at all.
    const room = y - vistaLimit(x) - (inVista(x) ? 8 : 0);
    if (height > room) {
      if (room < 26 * s || kind === 'pine') continue;
      height = room;
    }
    const r = (kind === 'spruce' ? height * 0.2 : kind === 'birch' ? height * 0.12 : kind === 'snag' ? height * 0.05 : height * 0.16) + 3;
    if (!clear(x, y, r)) continue;
    taken.push({ x, y, r });
    crowned.push({ x, y, s, kind, height, seed: Math.floor(treeRng() * 1e6) });
  }
  crowned.sort((a, b) => a.y - b.y);
  for (const t of crowned) {
    const haze = hazeAtY(t.y) * 0.9;
    const base = t.kind === 'broad' || t.kind === 'birch' ? BROADLEAF : t.kind === 'pine' ? PINE : CONIFER;
    const pal = hazePalette(t.kind === 'birch' ? { ...BROADLEAF, light: 0x8ab85a, highlight: 0xa8cc72, base: 0x6a9a4a } : base, HAZE, haze * 0.6);
    let tree: { buffer: PixelBuffer; baseX: number; baseY: number; tipX: number; tipY: number; perches: Array<{ x0: number; x1: number; y: number }> };
    if (t.kind === 'birch') tree = { ...drawBirch(t.height, t.seed, pal, haze * 0.6, HAZE), perches: [] };
    else if (t.kind === 'snag') {
      const snag = drawSnag(t.height, t.seed, haze * 0.6, HAZE);
      tree = { ...snag, tipX: snag.baseX, perches: [] };
    } else tree = t.kind === 'spruce' ? drawConifer(t.height, t.seed, pal) : t.kind === 'broad' ? drawBroadleaf(t.height, t.seed, pal) : drawTallPine(t.height, t.seed, pal);
    const left = Math.round(t.x - tree.baseX);
    const top = Math.round(t.y - tree.baseY);
    const index = midTrees.length;
    const leafy = t.kind !== 'pine' && t.kind !== 'snag';
    midTrees.push({ art: tree.buffer, x: left, y: top, baseY: Math.round(t.y), haze: haze * 0.4, leaves: leafy ? leafColors(pal) : undefined, still: t.kind === 'snag' });
    const tipZ = depthForScale(BIRD_SCALE * t.s);
    const perchOn = (ledge: Ledge, x: number, y: number) => {
      ledges.push(ledge);
      if (t.kind !== 'snag') attachments.push({ target: ledge, group: 'mid', index, x, y });
    };
    if (top + tree.tipY > 4) {
      perchOn({ x0: left + tree.tipX - 1, x1: left + tree.tipX + 1, y: top + tree.tipY, layer: 'mid', kind: 'treetop', z: tipZ }, tree.tipX, tree.tipY);
    }
    for (const perch of tree.perches) {
      if (top + perch.y > 4) perchOn({ x0: left + perch.x0, x1: left + perch.x1, y: top + perch.y, layer: 'mid', kind: 'branch', z: tipZ }, (perch.x0 + perch.x1) / 2, perch.y);
    }
    // Its footprint for the deer: a spruce's low skirt, or just a trunk.
    const footprintPx = t.kind === 'spruce' ? t.height * 0.13 : t.height * 0.05;
    const { gx, depth } = forestPlane.unproject(t.x, t.y);
    obstacles.push({ gx, depth, r: footprintPx / t.s + 10 });
    if ((t.kind === 'broad' || t.kind === 'pine' || t.kind === 'snag') && t.height > 60) {
      addTrunk(
        {
          x: Math.round(t.x),
          width: Math.max(3, Math.round(t.kind === 'pine' ? t.height * 0.054 : t.height * 0.06)),
          top: Math.round(t.y - t.height * (t.kind === 'pine' ? 0.5 : t.kind === 'snag' ? 0.8 : 0.38)),
          bottom: Math.round(t.y),
          layer: 'mid',
          squirrelSize: Math.max(5, Math.round(16 * t.s)),
        },
        t.kind === 'snag' ? null : index,
        tree.baseX,
      );
    }
  }

  // A line of small trees along the brow, where the wood drops into the valley: dark against the mist beyond.
  const browRng = createRng(seed + 6);
  for (let x = -4; x < WORLD_WIDTH + 4; x += 3 + browRng() * 6) {
    const baseY = brow(x) + 2 + browRng() * 3;
    const s = forestPlane.scaleAtY(baseY);
    let h = (60 + browRng() * 140) * s;
    const room = baseY - vistaLimit(x) - (inVista(x) ? 10 : 0);
    if (room < 6) continue;
    h = Math.min(h, room);
    if (inVista(x) && browRng() < 0.5) continue;
    const haze = 0.42 + browRng() * 0.1;
    if (browRng() < 0.55) stampConifer(ground, x, baseY, h, hazePalette(CONIFER, HAZE, haze), Math.round(x));
    else stampBlob(ground, x, baseY, h * 0.8, hazePalette(BROADLEAF, HAZE, haze), Math.round(x));
    // Bare trunks between them.
    if (browRng() < 0.35) for (let y = Math.round(baseY - h * 1.1); y < baseY; y++) ground.set(x + 3, y, lerpColor(0x4a3a2c, HAZE, haze));
  }

  // The floor: thick with ferns, holly and bramble, saplings, foxgloves and mossy boulders.
  const plantRng = createRng(seed + 9);
  for (let attempt = 0; attempt < 1200 && floorPlants.length < 84; attempt++) {
    const y = BROW_Y + 4 + plantRng() * 74;
    const x = 10 + plantRng() * 820;
    if (inGlade(x, y, -14)) continue;
    const s = forestPlane.scaleAtY(y);
    const haze = Math.max(0, 0.5 - s * 0.6);
    const roll = plantRng();
    let art: PixelBuffer;
    let leaves: readonly number[] | undefined;
    let still = y < BROW_Y + 16;
    if (roll < 0.4) {
      art = drawFern(plantRng, Math.max(0.35, s * 1.15));
      leaves = FERN_LEAVES;
    } else if (roll < 0.52) {
      art = drawShrub('holly', (26 + plantRng() * 16) * s, (20 + plantRng() * 12) * s, Math.floor(x * 7), haze, HAZE, month);
      leaves = HOLLY_LEAVES.map((c) => lerpColor(c, HAZE, haze));
    } else if (roll < 0.64) {
      art = drawShrub('bramble', (34 + plantRng() * 20) * s, (16 + plantRng() * 10) * s, Math.floor(x * 7), haze, HAZE, month);
    } else if (roll < 0.76) {
      const pal = hazePalette(BROADLEAF, HAZE, haze);
      const sap = drawBroadleaf((44 + plantRng() * 30) * s, Math.floor(x * 11), pal, false);
      art = sap.buffer;
      leaves = leafColors(pal);
    } else if (roll < 0.84) {
      if (month < 4 || month > 7) continue;
      art = drawFoxglove(Math.max(0.3, s * 0.9), Math.floor(x));
    } else if (roll < 0.92) {
      art = drawRock((20 + plantRng() * 22) * s, (9 + plantRng() * 8) * s, Math.floor(x * 3), haze, HAZE);
      still = true;
    } else {
      const h = (22 + plantRng() * 12) * s;
      art = new PixelBuffer(Math.ceil(h * 1.6) + 2, Math.ceil(h) + 2);
      const pal = hazePalette(BROADLEAF, HAZE, haze);
      for (let k = 0; k < 3; k++) stampBlob(art, art.width / 2 + (k - 1) * h * 0.45, art.height - 1 - (k === 1 ? 0 : 1), h * (k === 1 ? 1 : 0.8), pal, Math.floor(x) + k);
      art.outline(BROADLEAF.ink);
      leaves = leafColors(pal);
    }
    floorPlants.push({ art, x: Math.round(x - art.width / 2), y: Math.round(y - art.height + 1), baseY: Math.round(y), haze: haze * 0.5, leaves, still });
  }

  // Robins hop about the glade and the floor.
  for (const y of [272, 292, 306, 320]) {
    ledges.push({ x0: 120, x1: 720, y, layer: 'mid', kind: 'ground', z: birdZ(y) });
  }

  // --- Near: the framing oak and pine, logs and undergrowth ---
  const near = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const NEAR_FLOOR = 326;
  // Undergrowth bank along the bottom.
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const top = 318 + Math.sin(x * 0.05) * 4 + Math.sin(x * 0.13 + 2) * 3 - (x < 120 || x > 720 ? 10 : 0);
    for (let y = Math.floor(top); y < WORLD_HEIGHT; y++) {
      const h = pixelHash(x, y, 51);
      let color = y - top < 2 ? 0x6a9048 : h < 0.3 ? 0x3e5a2c : h < 0.6 ? 0x4a6a34 : 0x56783c;
      if (h > 0.96) color = 0x8a6a3a;
      near.set(x, y, color);
    }
  }
  // The oak at left: a massive, gnarled trunk forking into limbs that leave the top of the view.
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    const flare = y > 286 ? (y - 286) ** 1.25 * 0.55 : 0;
    const cx = 58 + Math.sin(y / 70) * 6 + Math.sin(y / 23) * 1.5;
    const half = 38 + (y / WORLD_HEIGHT) * 8 + flare;
    for (let x = Math.floor(cx - half); x <= cx + half; x++) {
      const u = (x + 0.5 - (cx - half)) / (half * 2);
      let color = u < 0.18 ? OAK_BARK.light : u > 0.7 ? OAK_BARK.dark : OAK_BARK.base;
      // Deep, wavy furrows in the bark.
      const lane = Math.floor((x + Math.sin(y * 0.06 + x * 0.05) * 2.5) / 4);
      if (pixelHash(lane, Math.floor(y / 11), 61) < 0.28) color = u > 0.5 ? OAK_BARK.deep : OAK_BARK.dark;
      if (u > 0.76 && y > 120 && valueNoise(x, y, 6, 63) > 0.45) color = MOSS;
      near.set(x, y, color);
    }
  }
  limb(near, [[84, 150], [150, 104], [222, 66], [300, 30], [384, -16]], 34, 12, OAK_BARK, 65);
  limb(near, [[66, 104], [94, 46], [116, -16]], 28, 16, OAK_BARK, 66);
  limb(near, [[40, 124], [8, 74], [-32, 38]], 30, 16, OAK_BARK, 67);
  limb(near, [[90, 200], [160, 182], [230, 172], [296, 178]], 22, 7, OAK_BARK, 69);
  // Knot holes.
  for (const [kx, ky, kr] of [
    [50, 244, 7],
    [76, 150, 4],
  ] as const) {
    for (let j = -kr - 2; j <= kr + 2; j++) {
      for (let k = -kr; k <= kr; k++) {
        const d = (j * j) / ((kr + 2) * (kr + 2)) + (k * k) / (kr * kr);
        if (d <= 1) near.set(kx + k, ky + j, d < 0.5 ? 0x1a140e : OAK_BARK.deep);
      }
    }
  }
  ledges.push({ x0: 170, x1: 280, y: 168, layer: 'near', kind: 'branch', z: 0.48 });
  trunks.push({ x: 58, width: 80, top: 110, bottom: NEAR_FLOOR, layer: 'near', squirrelSize: 15 });
  // The oak and the framing pine are obstacles too.
  for (const [x, r] of [
    [58, 60],
    [784, 22],
  ] as const) {
    const { gx, depth } = forestPlane.unproject(x, 338);
    obstacles.push({ gx, depth, r });
  }

  // The pine at right: a straight, plated trunk (its boughs are separate, swaying pieces).
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    const flare = y > 310 ? (y - 310) * 0.3 : 0;
    const half = 11 + (y / WORLD_HEIGHT) * 3 + flare;
    const cx = 784;
    for (let x = Math.floor(cx - half); x <= cx + half; x++) {
      const u = (x + 0.5 - (cx - half)) / (half * 2);
      let color = u < 0.25 ? PINE_BARK.light : u > 0.7 ? PINE_BARK.dark : PINE_BARK.base;
      // Bark plates: short horizontal cracks.
      if (pixelHash(Math.floor(x / 5), Math.floor(y / 4), 71) < 0.2 && y % 4 === 0) color = PINE_BARK.deep;
      near.set(x, y, color);
    }
  }
  trunks.push({ x: 784, width: 24, top: 40, bottom: NEAR_FLOOR, layer: 'near', squirrelSize: 13 });

  // Two fallen, mossy logs.
  const logs: Array<[number, number, number, number, number]> = [
    [150, 322, 300, 312, 8],
    [560, 314, 694, 324, 9],
  ];
  for (const [i, [ax, ay, bx, by, r]] of logs.entries()) {
    limb(near, [[ax, ay], [bx, by]], r * 2, r * 2 - 2, OAK_BARK, 80 + i);
    for (let x = ax; x <= bx; x++) {
      const y = ay + ((by - ay) * (x - ax)) / (bx - ax) - r;
      if (pixelHash(x, 1, 82 + i) < 0.6) near.set(x, y, MOSS);
      if (pixelHash(x, 2, 82 + i) < 0.3) near.set(x, y - 1, 0x86a656);
    }
    // Cut end showing rings.
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const d = Math.hypot(j, k * 1.1) / r;
      if (d <= 1) near.set(bx + k * 0.45, by + j, d > 0.85 ? OAK_BARK.dark : Math.floor(d * 4) % 2 ? 0xc49a6a : 0xa87c52);
    }
    const topAt = (x: number) => Math.round(ay + ((by - ay) * (x - ax)) / (bx - ax) - r - 1);
    ledges.push({ x0: ax + 10, x1: bx - 14, y: topAt((ax + bx) / 2), layer: 'near', kind: 'log', z: birdZ(topAt((ax + bx) / 2) + r * 2) });
  }
  // Ink the near layer's silhouettes for the hand-drawn look.
  near.outline(INK);

  // --- The canopy: a roof of leaves overhead, pine boughs, the oak's foliage, and moss hanging from it all ---
  const canopy: Placed[] = [];
  // Behind everything, the crowns of the trunks rising out of the view: a dark, shaded roof, deepest at the
  // sides and thinning over the vista (where the sky shows between the leaves).
  const shadeRoof = (p: TreePalette, k: number): TreePalette => hazePalette(p, 0x14221a, k);
  for (let x = -30, i = 0; x < WORLD_WIDTH + 30; x += 44 + randomRange(rng, 0, 22), i++) {
    const over = Math.abs(x + 50 - 440);
    // How far down it hangs into the view (the frame hides the top 20 px or so).
    const depth = over < 80 ? 46 : over < 170 ? 70 : 96 + randomRange(rng, 0, 26);
    const w = randomRange(rng, 100, 140);
    const art = drawCanopyClump(Math.round(w), Math.round(depth + 16), shadeRoof(i % 3 ? BROADLEAF : CONIFER, 0.5), rng, 14, 300 + i);
    canopy.push({ art, x, y: -16 - randomRange(rng, 0, 8), anchor: 'top', tree: 10 + Math.floor(x / 160), leaves: leafColors(shadeRoof(i % 3 ? BROADLEAF : CONIFER, 0.5)) });
  }
  for (const [i, [y, length]] of [
    [-14, 70],
    [22, 96],
    [62, 118],
    [104, 132],
    [150, 120],
    [196, 96],
  ].entries()) {
    const bough = drawBough(length, 10 + length * 0.18, 90 + i);
    const bx = 776 - bough.width + 2;
    canopy.push({ art: bough, x: bx, y, anchor: 'right', leaves: leafColors(CONIFER) });
    if (i === 2 || i === 4) {
      const ledge: Ledge = { x0: 776 - length * 0.7, x1: 770, y: y + 4, layer: 'near', kind: 'branch', z: 0.48 };
      ledges.push(ledge);
      attachments.push({ target: ledge, group: 'canopy', index: canopy.length - 1, x: 776 - length * 0.35 - bx, y: 4 });
    }
  }
  const gaps: number[] = [];
  for (let i = 0; i < 8; i++) {
    const w = 130;
    const h = 84 - Math.max(0, i - 4) * 10;
    const foliage = new PixelBuffer(w, h);
    const pal = BROADLEAF;
    for (let c = 0; c < 11; c++) {
      const r = randomRange(rng, 12, 24);
      const cx = randomRange(rng, r, w - r);
      const cy = randomRange(rng, r * 0.6, h - r);
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const dx = (x + 0.5 - cx) / r;
          const dy = (y + 0.5 - cy) / r;
          const d = dx * dx + dy * dy;
          if (d > 1 - pixelHash(x, y, i) * 0.25) continue;
          const light = -dx * 0.6 - dy * 0.9 + (1 - d) * 0.3;
          foliage.set(x, y, light > 0.5 ? pal.highlight : light > 0.1 ? pal.light : light > -0.4 ? pal.base : pal.dark);
        }
      }
    }
    foliage.outline(pal.ink);
    // Along the oak's limbs, thinning out towards the middle of the view.
    const x = -40 + i * 54;
    canopy.push({ art: foliage, x, y: -26 + (i % 2) * 16 - Math.max(0, i - 4) * 6, anchor: 'top', tree: 1, leaves: leafColors(pal) });
  }

  // In front of it on the right of the vista, the near crowns: lit leaves hanging lower.
  for (let x = 452, i = 0; x < 700; x += 58 + randomRange(rng, 0, 18), i++) {
    const over = Math.abs(x + 55 - 440);
    const h = over < 120 ? 58 : 84;
    const art = drawCanopyClump(120, h, BROADLEAF, rng, 9, 400 + i);
    canopy.push({ art, x, y: -14 - randomRange(rng, 0, 6), anchor: 'top', tree: 2, leaves: leafColors(BROADLEAF) });
  }
  // Strands of old-man's-beard and moss hanging from the canopy and the boughs, stirring in the air.
  for (let i = 0; i < 18; i++) {
    const x = randomRange(rng, 90, 800);
    if (Math.abs(x - 440) < 60) continue;
    const length = randomRange(rng, 16, 58);
    const art = drawMossStrand(length, i * 17, randomRange(rng, 0, 0.25), WOOD_HAZE);
    canopy.push({ art, x: Math.round(x), y: Math.round(randomRange(rng, 30, Math.abs(x - 440) < 140 ? 44 : 80)), anchor: 'top' });
  }

  // --- Ferns, shrubs and wildflowers crowding the front ---
  const ferns: Placed[] = [];
  for (const [x, kind, w, h] of [
    [60, 'bramble', 66, 30],
    [250, 'holly', 50, 34],
    [610, 'bramble', 70, 28],
    [770, 'holly', 56, 38],
  ] as const) {
    const art = drawShrub(kind, w, h, x * 13, 0, HAZE, month);
    ferns.push({ art, x: x - art.width / 2, y: 330 - art.height, leaves: kind === 'holly' ? HOLLY_LEAVES : undefined });
  }
  if (month >= 4 && month <= 7) {
    for (const x of [176, 664, 822]) {
      const art = drawFoxglove(1.1 + randomRange(rng, 0, 0.25), x);
      ferns.push({ art, x: x - art.width / 2, y: 330 - art.height });
    }
  }
  for (const x of [8, 112, 200, 290, 320, 400, 452, 530, 584, 650, 716, 760, 806]) {
    const art = drawFern(rng, 1 + randomRange(rng, 0, 0.35));
    // Their tops stand clear of the sill, which hides the bottom of the view.
    ferns.push({ art, x: x - art.width / 2, y: 328 - art.height + randomInt(rng, 0, 4), leaves: FERN_LEAVES });
  }
  for (const [x, kind] of [
    [24, 'daisy'],
    [70, 'daisy'],
    [128, 'daisy'],
    [700, 'violet'],
    [752, 'violet'],
    [812, 'violet'],
  ] as const) {
    const art = drawFlowers(rng, kind);
    ferns.push({ art, x: x - art.width / 2, y: 324 - art.height + randomInt(rng, 0, 3) });
  }

  // Where light gets through: openings in the canopy just inside the top of the view.
  gaps.push(...canopyGaps(canopy));

  return { far, mountains, valley, ground, midTrees, floorPlants, obstacles, near, canopy, ferns, trunks, ledges, gaps, attachments };
}
