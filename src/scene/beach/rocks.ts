import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Ledge } from '../../life/types';
import { depthForScale } from '../../sim/perspective';
import { beachPlane, shoreCoords, shorePoint } from '../../sim/shore';
import { pixelHash } from '../../sprites/raster';
import { valueNoise } from '../common/paint';

/**
 * A low point of dark volcanic rock running out into the surf partway along
 * the beach: a few rounded, craggy boulders standing in the breakers, banded
 * as the tide leaves them (black weed at the foot, barnacles above, dry and
 * pale on top, white with the gulls' droppings on the highest), wet and
 * glossy where the waves reach; and in front of them, a flat shelf of the
 * same rock lying in the sand, its hollows holding pools when the tide's out.
 */

/** The outcrop's middle, along the beach (depth) and across it (ground px from the still waterline). */
export const ROCKS_DEPTH = 2.05;

/** A boulder: where its foot is (depth, s), its radius (ground px) and how tall it stands for its width. */
const BOULDERS: ReadonlyArray<[depth: number, s: number, r: number, tall: number]> = [
  [2.32, -14, 16, 0.55],
  [2.28, 12, 24, 0.8],
  [2.22, 46, 30, 1.05],
  [2.3, 84, 18, 0.6],
  [2.12, 118, 14, 0.5],
  [2.08, 24, 22, 0.7],
  [2.02, 64, 26, 0.85],
  [1.94, 40, 16, 0.5],
  [1.9, 96, 12, 0.45],
];

/** The pools in the shelf: where (depth, s) and their half-sizes (depth units, ground px). */
export const POOLS: ReadonlyArray<{ depth: number; s: number; rd: number; rs: number }> = [
  { depth: 2.16, s: -36, rd: 0.075, rs: 22 },
  { depth: 1.98, s: -20, rd: 0.06, rs: 18 },
  { depth: 2.3, s: -56, rd: 0.05, rs: 14 },
  { depth: 1.92, s: -58, rd: 0.05, rs: 16 },
];

const SHELF = { depth: ROCKS_DEPTH, s: -30, rd: 0.3, rs: 62 };

/** Dark rock, deepest shadow to the lit face. */
const ROCK = [0x141212, 0x201c1a, 0x2e2824, 0x3e3630, 0x52483e, 0x6c5e50, 0x8a7a68];
const WEED = [0x22261a, 0x30381e, 0x424c24];
const BARNACLE = [0xaaa290, 0x7e766a];
const GUANO = 0xe6e2d8;
const SHEEN = 0x9aa8ae;
const INK = 0x121010;

export interface RockCluster {
  art: PixelBuffer;
  x: number;
  y: number;
  /** The world y of its foot, for sorting among the shore's creatures. */
  baseY: number;
}

export interface Outcrop {
  clusters: RockCluster[];
  /** Tops of the bigger boulders, for gulls (and the egret). */
  ledges: Ledge[];
  /** Points along the boulders' seaward faces where the breakers throw up spray. */
  spray: Array<{ x: number; y: number; depth: number; s: number }>;
  /** The feet of the boulders standing in the water (screen ellipse), where the sea foams round them. */
  feet: Array<{ x: number; y: number; rx: number; ry: number; s: number }>;
}

/** Paint the flat shelf and the beds of its pools into the sand (under the water, so the tide covers it). */
export function paintShelf(sand: PixelBuffer, haze: (c: number) => number): void {
  const top = Math.floor(beachPlane.project(0, SHELF.depth + SHELF.rd).y) - 1;
  const bottom = Math.ceil(beachPlane.project(0, SHELF.depth - SHELF.rd).y) + 1;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < sand.width; x++) {
      const { depth, s } = shoreCoords(x, y);
      if (Math.abs(s - SHELF.s) > SHELF.rs * 1.3) continue;
      const u = (depth - SHELF.depth) / SHELF.rd;
      const v = (s - SHELF.s) / SHELF.rs;
      // A ragged edge, slabs and fissures.
      const d = u * u + v * v - (valueNoise(x, y * 2, 5, 301) - 0.5) * 0.7;
      if (d > 1) continue;
      let level = 0.45 + (valueNoise(x, y, 3, 302) - 0.5) * 0.6;
      if (valueNoise(x * 0.6, y * 3, 4, 303) > 0.72) level = 0.05;
      let color = ROCK[1 + Math.min(4, Math.max(0, Math.round(level * 4)))];
      // The rim catches the light; weed in the low, wet parts.
      if (d > 0.82) color = ROCK[3];
      if (valueNoise(x, y, 6, 304) > 0.66) color = WEED[Math.floor(pixelHash(x, y, 305) * 3)];
      if (pixelHash(x, y, 306) < 0.05) color = BARNACLE[1];
      for (const p of POOLS) {
        const pu = (depth - p.depth) / p.rd;
        const pv = (s - p.s) / p.rs;
        const pd = pu * pu + pv * pv;
        // The pool's bed, and a dark lip round it.
        if (pd < 1.35) color = pd < 1 ? 0x24302c : ROCK[0];
      }
      sand.set(x, y, haze(color));
    }
  }
}

/** The boulders, in clusters to sort among the creatures, with their perches and spray points. */
export function drawOutcrop(haze: (c: number) => number): Outcrop {
  const ledges: Ledge[] = [];
  const spray: Outcrop['spray'] = [];
  const feet: Outcrop['feet'] = [];
  // Near and far groups, so a crab or a sandpiper can pass in front of the back ones.
  const groups = [BOULDERS.filter((b) => b[0] >= 2.15), BOULDERS.filter((b) => b[0] < 2.15)];
  const clusters: RockCluster[] = [];
  for (const [gi, group] of groups.entries()) {
    const shapes = group
      .map(([depth, s, r, tall], i) => {
        const p = shorePoint(depth, s);
        const rx = r * p.scale;
        return { depth, s, x: p.x, y: p.y, rx, up: rx * tall * 1.5, down: Math.max(1.5, rx * 0.28), seed: 400 + gi * 20 + i };
      })
      .sort((a, b) => a.y - b.y);
    const x0 = Math.floor(Math.min(...shapes.map((b) => b.x - b.rx * 1.2))) - 2;
    const x1 = Math.ceil(Math.max(...shapes.map((b) => b.x + b.rx * 1.2))) + 2;
    const y0 = Math.floor(Math.min(...shapes.map((b) => b.y - b.up * 1.25))) - 2;
    const y1 = Math.ceil(Math.max(...shapes.map((b) => b.y + b.down))) + 2;
    const art = new PixelBuffer(x1 - x0 + 1, y1 - y0 + 1);
    for (const b of shapes) {
      for (let y = Math.floor(b.y - b.up * 1.25); y <= b.y + b.down + 1; y++) {
        for (let x = Math.floor(b.x - b.rx * 1.25); x <= b.x + b.rx * 1.25; x++) {
          const nx = (x + 0.5 - b.x) / b.rx;
          const above = y + 0.5 <= b.y;
          const ny = above ? (b.y - y - 0.5) / b.up : (y + 0.5 - b.y) / b.down;
          // A lumpy dome: the outline wanders gently with the angle round it, and its surface breaks into flat facets.
          const angle = Math.atan2(ny, nx);
          const lump = (valueNoise(angle * 4 + b.seed, 0, 1, b.seed) - 0.5) * 0.4 + (valueNoise(x, y, 2, b.seed + 1) - 0.5) * 0.1;
          const d = nx * nx + ny * ny;
          if (d > 1 + lump) continue;
          const height = above ? ny : 0;
          // Its surface's slope: a dome's, tilted facet by facet (blocky, like fractured basalt).
          const fx = Math.floor((x - b.x + valueNoise(x, y, 3, b.seed + 9) * 3) / 5);
          const fy = Math.floor((y - b.y + valueNoise(x, y, 3, b.seed + 10) * 2) / 3);
          const tilt = (pixelHash(fx, fy, b.seed + 2) - 0.5) * 0.32;
          const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d)));
          // Light from the sky above, a little from the left and towards us.
          let light = -nx * 0.55 + (above ? ny : -0.5) * 0.5 + nz * 0.6 + tilt - 0.32;
          // A crack here and there.
          if (Math.abs(valueNoise(x * 0.7, y * 1.6, 4, b.seed + 3) - 0.5) < 0.03) light -= 0.6;
          let color = ROCK[Math.max(0, Math.min(6, Math.round(2.6 + light * 3.2)))];
          // The bands the tide leaves.
          if (height < 0.24) {
            if (pixelHash(x, y, b.seed + 4) < 0.85) color = WEED[Math.min(2, Math.max(0, Math.round(1 + light * 1.5)))];
          } else if (height < 0.46) {
            if (pixelHash(x, y, b.seed + 5) < 0.16) color = BARNACLE[light > 0.1 ? 0 : 1];
          } else if (b.up > 10 && height > 0.8 && light > 0 && pixelHash(x, y, b.seed + 6) < 0.08) color = GUANO;
          // Wet and glossy low down, where the waves wash over it: a glint on the lit facets.
          if (height < 0.42 && light > 0.3 && pixelHash(fx, fy, b.seed + 7) < 0.5 && pixelHash(x, y, b.seed + 8) < 0.5) color = SHEEN;
          art.set(x - x0, y - y0, haze(color));
        }
      }
      if (b.up > 7) {
        const top = Math.round(b.y - b.up * 0.95);
        ledges.push({ x0: Math.round(b.x - b.rx * 0.3), x1: Math.round(b.x + b.rx * 0.3), y: top, layer: 'mid', kind: 'rock', z: depthForScale(0.34 * beachPlane.scaleAtY(b.y)) });
      }
      // Spray bursts off the seaward faces of the ones out in the surf.
      if (b.s > -10) feet.push({ x: b.x, y: b.y, rx: b.rx, ry: b.down, s: b.s });
      if (b.s > 20) spray.push({ x: Math.round(b.x + b.rx * 0.5), y: Math.round(b.y - b.up * 0.4), depth: b.depth, s: b.s });
    }
    art.outline(haze(INK));
    clusters.push({ art, x: x0, y: y0, baseY: Math.max(...shapes.map((b) => b.y)) });
  }
  return { clusters, ledges, spray, feet };
}

/** The pools as screen ellipses (centre, half-width, half-height) and their place on the shore. */
export function poolShapes(): Array<{ x: number; y: number; hw: number; hh: number; depth: number; s: number }> {
  return POOLS.map((p) => {
    const c = shorePoint(p.depth, p.s);
    const near = beachPlane.project(0, p.depth - p.rd).y;
    const far = beachPlane.project(0, p.depth + p.rd).y;
    return { x: c.x, y: c.y, hw: p.rs * c.scale, hh: (near - far) / 2, depth: p.depth, s: p.s };
  });
}

/** Rock colours fade into the haze with distance the same way the rest of the beach does. */
export const rockHaze = (amount: number) => (c: number) => lerpColor(c, 0xc8dcdc, amount);
