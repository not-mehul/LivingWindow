import { lerpColor, scaleColor } from '../../core/color';
import { boxFrom, type Box, type Hit } from '../../sim/cityGeometry';
import { FOCAL } from '../../sim/groundPlane';
import { pixelHash } from '../../sprites/raster';
import { bayer, valueNoise } from '../common/paint';

/**
 * The clutter of people living on the roofs: shacks of corrugated sheet with
 * tarp roofs, water tanks, solar panels, crates, a sofa dragged up the
 * stairs, planters of greens, antenna masts and satellite dishes, and
 * strings of bulbs for the evenings. The boxes are cast with the rest of the
 * city (so they're lit, hazed, inked and occluded like everything else);
 * the round and spindly things are painted in after.
 */

export type PropMaterial = 'shack' | 'tarp' | 'tank' | 'solar' | 'crate' | 'sofa' | 'planter' | 'plastic' | 'condenser';

export const PROP_BODIES: Record<PropMaterial, number[]> = {
  shack: [0x6e8282, 0x8a6446, 0x58769a, 0x8e8c7e],
  tarp: [0x3a64a8, 0xd0702a, 0x4a845a, 0xb83a3a],
  tank: [0x5a7686, 0x96968c, 0x3e5a76],
  solar: [0x1e2a4a],
  crate: [0x9a7a4a, 0x86683e, 0x6a7a4a],
  sofa: [0x8a3a3a, 0x3a5a7a, 0x6a6a3a],
  planter: [0x7a5a3a, 0x8a4a32],
  plastic: [0x2a8a6a, 0xe0dcd0, 0xd89a30],
  condenser: [0xa8aaa4, 0x9a9e9c, 0xb4b2a8],
};

export interface PropBox {
  box: Box;
  material: PropMaterial;
  /** A lit window in a shack's front (it lights up at night). */
  window?: boolean;
  /** A tarp roof on a shack (its colour). */
  roof?: number;
}

export interface Dish {
  gx: number;
  depth: number;
  /** Height of the dish's centre. */
  h: number;
  /** Radius in ground px. */
  r: number;
}

export interface Mast {
  gx: number;
  depth: number;
  h0: number;
  h1: number;
}

/** A string of bulbs sagging between two points (ground px, focal lengths, height). */
export interface LightString {
  a: { gx: number; depth: number; h: number };
  b: { gx: number; depth: number; h: number };
  bulbs: number;
  sag: number;
}

export interface RoofScene {
  boxes: PropBox[];
  dishes: Dish[];
  masts: Mast[];
  strings: LightString[];
  /** Where smoke rises: a grill and a stovepipe. */
  smoke: Array<{ gx: number; depth: number; h: number; kind: 'grill' | 'stove' }>;
  /** Umbrellas over tables (centre, radius, colour). */
  umbrellas: Array<{ gx: number; depth: number; h: number; r: number; color: number }>;
  /** Potted shrubs: a leafy crown on a pot (the pot is a box). */
  shrubs: Array<{ gx: number; depth: number; h: number; r: number }>;
  /** A rug laid on the roof (ground rectangle). */
  rugs: Array<{ gx0: number; gx1: number; d0: number; d1: number; h: number; colors: [number, number, number] }>;
  /** A drying rack of laundry between two poles. */
  laundry: Array<{ gx0: number; gx1: number; depth: number; h: number }>;
  /** A drone landing pad painted on a roof (centre, radius in ground px). */
  pad: { gx: number; depth: number; h: number; r: number };
  /** Old tyres lying about (centre, radius). */
  tyres: Array<{ gx: number; depth: number; h: number; r: number }>;
}

/**
 * The neighbours' terrace at left (roof at h 150) and the roof across the
 * street below us (h 110): a life someone's made up here. Keeps clear of
 * where the pigeon feeder stands (-250, 1.25), the pigeons' walk (depth
 * 1.1), the gardener's planters and path (gx 90–300, depth 1.0–1.7) and
 * the washing line.
 */
export function terraceScene(): RoofScene {
  const T = 150;
  const R = 110;
  const boxes: PropBox[] = [
    // A shack of corrugated sheet against the back of the terrace, a tarp over its roof, a window lit at night.
    { box: boxFrom(-338, -206, 1.86, 2.3, T, T + 44), material: 'shack', window: true, roof: 0x3a64a8 },
    // A lean-to beside it, tarp on poles.
    { box: boxFrom(-206, -160, 2.0, 2.3, T + 30, T + 33), material: 'tarp' },
    // A water tank on a stand.
    { box: boxFrom(-152, -124, 2.06, 2.18, T + 12, T + 40), material: 'tank' },
    { box: boxFrom(-152, -124, 2.06, 2.18, T, T + 12), material: 'crate' },
    // Solar panels in a row.
    { box: boxFrom(-420, -352, 1.5, 1.72, T + 2, T + 7), material: 'solar' },
    { box: boxFrom(-420, -352, 1.76, 1.98, T + 2, T + 7), material: 'solar' },
    // A sofa hauled up the stairs, facing the view, and a crate for a table.
    { box: boxFrom(-196, -148, 1.5, 1.58, T, T + 9), material: 'sofa' },
    { box: boxFrom(-196, -148, 1.58, 1.62, T, T + 17), material: 'sofa' },
    { box: boxFrom(-180, -164, 1.38, 1.44, T, T + 8), material: 'crate' },
    // Crates of junk, stacked.
    { box: boxFrom(-370, -336, 1.18, 1.32, T, T + 14), material: 'crate' },
    { box: boxFrom(-364, -342, 1.21, 1.29, T + 14, T + 24), material: 'crate' },
    // Planters of greens along the railing, and a big pot.
    { box: boxFrom(-140, -100, 0.62, 0.74, T, T + 8), material: 'planter' },
    { box: boxFrom(-140, -100, 0.82, 0.94, T, T + 8), material: 'planter' },
    { box: boxFrom(-136, -104, 1.6, 1.74, T, T + 9), material: 'planter' },
    // Plastic chairs round a cooler, near the front.
    ...chair(-226, 0.76, T),
    ...chair(-174, 0.72, T),
    { box: boxFrom(-206, -192, 0.66, 0.7, T, T + 9), material: 'crate' },
    // Pots for the shrubs.
    { box: boxFrom(-382, -362, 0.86, 0.9, T, T + 10), material: 'planter' },
    { box: boxFrom(-128, -110, 1.3, 1.34, T, T + 9), material: 'planter' },
    { box: boxFrom(-336, -318, 1.56, 1.6, T, T + 9), material: 'planter' },
    // The roof across the street: a tool shed, a bank of AC condensers by the drone pad, and junk.
    { box: boxFrom(262, 300, 1.0, 1.22, R, R + 24), material: 'shack', roof: 0xd0702a },
    { box: boxFrom(186, 210, 1.62, 1.72, R, R + 14), material: 'condenser' },
    { box: boxFrom(213, 237, 1.62, 1.72, R, R + 14), material: 'condenser' },
    { box: boxFrom(266, 300, 2.3, 2.42, R, R + 18), material: 'condenser' },
    // Pallets, drums and gas bottles, a folded tarp, a broken chair.
    { box: boxFrom(86, 112, 2.55, 2.7, R, R + 4), material: 'crate' },
    { box: boxFrom(88, 110, 2.57, 2.68, R + 4, R + 7), material: 'crate' },
    { box: boxFrom(280, 292, 1.9, 1.96, R, R + 14), material: 'tank' },
    { box: boxFrom(280, 292, 1.97, 2.03, R, R + 14), material: 'tank' },
    { box: boxFrom(296, 301, 2.18, 2.21, R, R + 12), material: 'tank' },
    { box: boxFrom(186, 214, 2.48, 2.56, R, R + 3), material: 'tarp' },
    ...chair(214, 2.64, R).slice(0, 4),
    // Junk at the front of the roof, out of the gardener's way.
    { box: boxFrom(88, 110, 1.24, 1.32, R, R + 8), material: 'crate' },
    { box: boxFrom(91, 107, 1.25, 1.31, R + 8, R + 14), material: 'crate' },
    { box: boxFrom(112, 120, 1.27, 1.3, R, R + 9), material: 'tank' },
    { box: boxFrom(284, 296, 1.3, 1.36, R, R + 14), material: 'tank' },
    { box: boxFrom(276, 302, 1.42, 1.52, R, R + 3), material: 'crate' },
    { box: boxFrom(280, 298, 1.44, 1.5, R + 3, R + 5), material: 'tarp' },
  ];
  return {
    boxes,
    dishes: [
      { gx: -300, depth: 2.04, h: T + 52, r: 11 },
      { gx: -240, depth: 2.12, h: T + 50, r: 7 },
      { gx: 272, depth: 1.72, h: 148, r: 8 },
    ],
    masts: [
      { gx: -222, depth: 2.08, h0: T + 44, h1: T + 108 },
      { gx: -118, depth: 2.12, h0: T + 40, h1: T + 74 },
      { gx: 178, depth: 1.9, h0: 130, h1: 186 },
    ],
    strings: [
      { a: { gx: -208, depth: 1.86, h: T + 38 }, b: { gx: -100, depth: 1.02, h: T + 30 }, bulbs: 12, sag: 6 },
      { a: { gx: -336, depth: 1.86, h: T + 40 }, b: { gx: -150, depth: 1.5, h: T + 28 }, bulbs: 14, sag: 7 },
      // Over the chairs at the front, from the laundry pole to the railing.
      { a: { gx: -340, depth: 0.98, h: T + 26 }, b: { gx: -96, depth: 0.6, h: T + 27 }, bulbs: 16, sag: 6 },
    ],
    smoke: [
      { gx: -124, depth: 1.5, h: T + 12, kind: 'grill' },
      { gx: -320, depth: 2.0, h: T + 56, kind: 'stove' },
    ],
    umbrellas: [{ gx: -172, depth: 1.36, h: T + 30, r: 26, color: 0xd84a4a }],
    shrubs: [
      { gx: -372, depth: 0.88, h: T + 18, r: 14 },
      { gx: -119, depth: 1.32, h: T + 17, r: 12 },
      { gx: -327, depth: 1.58, h: T + 17, r: 11 },
    ],
    rugs: [{ gx0: -212, gx1: -136, d0: 1.3, d1: 1.5, h: T, colors: [0x8a2a3a, 0xd8a040, 0x2a4a6a] }],
    laundry: [{ gx0: -340, gx1: -276, depth: 0.98, h: T + 26 }],
    pad: { gx: 150, depth: 1.43, h: R, r: 28 },
    tyres: [
      { gx: 96, depth: 1.98, h: R, r: 7 },
      { gx: 104, depth: 2.06, h: R, r: 7 },
      { gx: 100, depth: 2.02, h: R + 4, r: 7 },
    ],
  };
}

/** A plastic garden chair: seat, back and four legs. */
function chair(gx: number, d: number, floor: number): PropBox[] {
  const out: PropBox[] = [
    { box: boxFrom(gx - 10, gx + 10, d, d + 0.045, floor + 7, floor + 9), material: 'plastic' },
    { box: boxFrom(gx - 10, gx + 10, d + 0.045, d + 0.052, floor + 9, floor + 20), material: 'plastic' },
  ];
  for (const [x, dd] of [
    [gx - 9, d],
    [gx + 7, d],
    [gx - 9, d + 0.04],
    [gx + 7, d + 0.04],
  ] as const)
    out.push({ box: boxFrom(x, x + 2, dd, dd + 0.004, floor, floor + 7), material: 'plastic' });
  return out;
}

/** Rooftop clutter for a building's roof further off: a tank, a shack, a mast. Boxes on its top. */
export function roofClutter(box: Box, rng: () => number): { boxes: PropBox[]; masts: Mast[] } {
  const boxes: PropBox[] = [];
  const masts: Mast[] = [];
  const h = box.h1;
  const d0 = box.depth - box.halfW / FOCAL;
  const d1 = box.depth + box.halfW / FOCAL;
  const gx0 = box.gx - box.halfU;
  const gx1 = box.gx + box.halfU;
  const n = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const kind = rng();
    const w = 30 + rng() * 60;
    const x = gx0 + 10 + rng() * Math.max(1, gx1 - gx0 - w - 20);
    const d = d0 + 0.05 + rng() * Math.max(0.01, d1 - d0 - 0.4);
    if (kind < 0.35) boxes.push({ box: boxFrom(x, x + w * 0.5, d, d + 0.08, h, h + 26 + rng() * 14), material: 'tank' });
    else if (kind < 0.7) boxes.push({ box: boxFrom(x, x + w, d, d + 0.18, h, h + 22 + rng() * 10), material: 'shack', window: rng() < 0.6, roof: PROP_BODIES.tarp[Math.floor(rng() * 4)] });
    else boxes.push({ box: boxFrom(x, x + w, d, d + 0.2, h, h + 4), material: 'solar' });
    if (rng() < 0.5) masts.push({ gx: x + w * 0.5, depth: d + 0.04, h0: h, h1: h + 50 + rng() * 60 });
  }
  return { boxes, masts };
}

/**
 * The colour of a prop where a ray met it, and whether it's a window (a
 * key to light at night). `s`/`t` run across and up the face; `along` and
 * `height` are its size there.
 */
export function shadeProp(
  material: PropMaterial,
  body: number,
  prop: PropBox,
  hit: Hit,
  s: number,
  t: number,
  along: number,
  height: number,
  screenPx: number,
  x: number,
  y: number,
  seed: number,
): { color: number; window: boolean } {
  const top = hit.face === 'top';
  const u = s / Math.max(1, along);
  const v = t / Math.max(1, height);
  switch (material) {
    case 'shack': {
      if (top) {
        // A tarp roof, rippling in folds, weighed down with a tyre.
        const roof = prop.roof ?? 0x6a6a64;
        const fold = valueNoise(hit.u * 2, hit.w, 14, seed);
        const tyre = Math.hypot(hit.u - 8, hit.w + 6) < 9 && Math.hypot(hit.u - 8, hit.w + 6) > 4;
        return { color: tyre ? 0x2a2a2a : scaleColor(roof, 0.8 + fold * 0.35), window: false };
      }
      // Corrugated sheet: ribs, rust bleeding through, a patch of a different colour.
      const rib = Math.floor(s / 3) % 2 === 0;
      let c = scaleColor(body, rib ? 1 : 0.86);
      if (valueNoise(s, t, 10, seed) > 0.68) c = lerpColor(c, 0x8a4a2a, 0.55);
      if (pixelHash(Math.floor(s / 18), Math.floor(t / 14), seed) < 0.12) c = lerpColor(c, 0x9a9a8a, 0.6);
      if (hit.face === 'front') {
        if (u > 0.12 && u < 0.3 && v < 0.78) return { color: u < 0.14 || v > 0.75 ? 0x2a2018 : lerpColor(0x5a4030, 0x4a3426, v), window: false };
        if (prop.window && u > 0.5 && u < 0.78 && v > 0.38 && v < 0.72) return { color: u < 0.53 || v > 0.69 ? 0x2a2420 : lerpColor(0x3a4450, 0x7a8a98, v), window: true };
      }
      return { color: c, window: false };
    }
    case 'tarp': {
      const fold = valueNoise(s * 2, t, 12, seed);
      return { color: scaleColor(body, top ? 0.85 + fold * 0.35 : 0.7), window: false };
    }
    case 'tank': {
      if (top) return { color: scaleColor(body, 0.72 + (Math.hypot(hit.u, hit.w) < 5 ? 0.2 : 0)), window: false };
      // Round: lit across like a cylinder, banded, streaked with rust from the seams.
      const round = 0.62 + Math.sin(u * Math.PI) * 0.48 - u * 0.12;
      let c = scaleColor(body, round);
      if (Math.abs((t % 12) - 6) < Math.max(0.6, screenPx * 0.6)) c = scaleColor(c, 0.8);
      if (valueNoise(s * 3, t * 0.3, 6, seed) > 0.7) c = lerpColor(c, 0x7a4a2a, 0.4);
      return { color: c, window: false };
    }
    case 'solar': {
      if (!top) return { color: 0x7a7e84, window: false };
      // Dark blue cells in a silver grid, the sky glinting off them.
      const grid = Math.abs((hit.u + 200) % 10) < Math.max(0.8, screenPx * 0.7) || Math.abs((hit.w + 200) % 12) < Math.max(0.8, screenPx * 0.7);
      return { color: grid ? 0x9aa4b0 : lerpColor(0x1e2a4a, 0x4a6a9a, bayer(x, y) < 0.15 ? 0.6 : 0.15), window: false };
    }
    case 'crate': {
      const plank = Math.floor((top ? hit.w : t) / 5) % 2 === 0;
      const edge = u < 0.08 || u > 0.92;
      return { color: scaleColor(body, top ? (plank ? 1.1 : 0.98) : edge ? 0.7 : plank ? 0.92 : 0.84), window: false };
    }
    case 'plastic': {
      return { color: scaleColor(body, top ? 1.08 : u < 0.1 || u > 0.9 ? 0.7 : 0.9), window: false };
    }
    case 'condenser': {
      if (top) {
        // A fan in a round grille, its blades behind the bars.
        const cx = hit.u;
        const cw = hit.w;
        const rr = Math.hypot(cx, cw * 0.9);
        const fan = Math.min(along, height * 3) * 0.42;
        if (rr < fan) {
          const a = Math.atan2(cw, cx);
          const blade = Math.sin(a * 3 + rr * 0.05) > 0.2;
          const bar = Math.abs((rr % 4) - 2) < Math.max(0.6, screenPx * 0.5);
          return { color: bar ? 0x6a6c6a : blade ? 0x3a3c40 : 0x1e2024, window: false };
        }
        return { color: scaleColor(body, 1.1), window: false };
      }
      // Louvred sides, streaked with rust.
      let c = scaleColor(body, Math.floor(t / 2.5) % 2 === 0 ? 0.92 : 0.78);
      if (valueNoise(s, t * 0.3, 6, seed) > 0.7) c = lerpColor(c, 0x7a4a2a, 0.4);
      return { color: c, window: false };
    }
    case 'sofa': {
      const seam = Math.abs((s % 16) - 8) < Math.max(0.6, screenPx * 0.5);
      return { color: scaleColor(body, top ? 1.05 : seam ? 0.72 : 0.88), window: false };
    }
    case 'planter': {
      if (!top) return { color: scaleColor(body, 0.82), window: false };
      // Greens, with a flower or a tomato here and there.
      const leaf = valueNoise(hit.u * 2, hit.w, 5, seed);
      const fruit = pixelHash(x, y, seed) < 0.07;
      return { color: fruit ? (pixelHash(x, y + 1, seed) < 0.5 ? 0xd83a2a : 0xf0d040) : lerpColor(0x2e5a2a, 0x6a9a3a, leaf), window: false };
    }
  }
}
