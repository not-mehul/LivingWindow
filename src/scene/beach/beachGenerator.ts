import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import { depthForScale } from '../../sim/perspective';
import { BEACH_HORIZON, beachPlane, shoreCoords } from '../../sim/shore';
import { pixelHash } from '../../sprites/raster';
import { ditherRamp, valueNoise } from '../common/paint';

/**
 * The beach after the reference drawing: palms leaning in from the left over
 * a dune path, a wide sandy beach running away to a wooded point on the
 * horizon, and the sea to the right with its surf parallel to the shore.
 */

/** A piece of art at a world position, with the ground y it stands on. */
export interface Placed {
  art: PixelBuffer;
  x: number;
  y: number;
  baseY: number;
}

export interface BeachLayout {
  /** The wooded point and far dunes along the horizon. */
  land: PixelBuffer;
  /** All the sand, damp near the water, rippled, with the dune path. */
  sand: PixelBuffer;
  /** Bushes, driftwood and the dune fence. */
  props: PixelBuffer;
  /** Palms (they sway, rooted at the base). */
  palms: Placed[];
  /** The dune bank along the front, and its grass and flowers (they sway). */
  dune: PixelBuffer;
  tufts: Placed[];
  ledges: Ledge[];
}

const HAZE = 0xc8dcdc;
const BIRD_SCALE = 0.34;
const birdZ = (y: number) => depthForScale(BIRD_SCALE * beachPlane.scaleAtY(y));

const PALM = {
  ink: 0x1e3018,
  frondDark: 0x3a6230,
  frond: 0x56823a,
  frondLight: 0x74a046,
  frondShine: 0x96bc5a,
  trunkDark: 0x5e4a36,
  trunk: 0x8a7254,
  trunkLight: 0xae9470,
  ring: 0x4a3a2a,
  nut: 0x5a4024,
};

/**
 * A coconut palm: a long, curving, ringed trunk leaning by `lean` px, and a
 * crown of drooping fronds whose leaflets hang down either side of the spine.
 * Returns the art and where its base sits within it.
 */
function drawPalm(height: number, lean: number, seed: number): { art: PixelBuffer; baseX: number; baseY: number; crown: { x: number; y: number } } {
  const H = Math.round(height);
  const frond = H * 0.42;
  const padX = Math.ceil(frond * 1.15) + 4;
  const padTop = Math.ceil(frond * 0.6) + 4;
  const W = Math.ceil(Math.abs(lean) + padX * 2);
  const p = new PixelBuffer(W, H + padTop + 2);
  const baseX = lean >= 0 ? padX : W - padX;
  const baseY = H + padTop;
  const topX = baseX + lean;
  const topY = padTop;
  // The trunk curves: it leans out low down and straightens towards the crown.
  const ctrlX = baseX + lean * 0.8;
  const ctrlY = baseY - H * 0.45;
  const w0 = Math.max(3, H * 0.06);
  const w1 = Math.max(2, H * 0.035);
  const steps = Math.ceil(H * 1.2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) ** 2 * baseX + 2 * (1 - t) * t * ctrlX + t * t * topX;
    const y = (1 - t) ** 2 * baseY + 2 * (1 - t) * t * ctrlY + t * t * topY;
    const w = w0 + (w1 - w0) * t;
    const ring = Math.floor(t * H / 3.2) % 2 === 0;
    for (let j = -w / 2; j <= w / 2; j++) {
      const u = (j + w / 2) / w;
      let color = u < 0.3 ? PALM.trunkLight : u > 0.72 ? PALM.trunkDark : PALM.trunk;
      if (ring && pixelHash(Math.round(x + j), Math.round(y), seed) < 0.7) color = u > 0.5 ? PALM.ring : PALM.trunkDark;
      p.set(x + j, y, color);
    }
  }
  // Fronds radiating from the crown, drooping under their own weight: a thin
  // spine with narrow leaflets hanging from both sides, like a feather.
  const rng = createRng(seed);
  const fronds = 10 + randomInt(rng, 0, 3);
  const leafColor = (v: number) => (v < 0.2 ? PALM.frondShine : v < 0.5 ? PALM.frondLight : v < 0.8 ? PALM.frond : PALM.frondDark);
  for (let f = 0; f < fronds; f++) {
    const a = -Math.PI * 1.05 + (f / (fronds - 1)) * Math.PI * 1.1 + randomRange(rng, -0.15, 0.15);
    const len = frond * randomRange(rng, 0.75, 1.1);
    const droop = len * randomRange(rng, 0.55, 0.85);
    const segs = Math.ceil(len * 1.6);
    let px = topX;
    let py = topY;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const x = topX + Math.cos(a) * len * t;
      const y = topY + Math.sin(a) * len * t * 0.55 + droop * t * t;
      const dx = x - px;
      const dy = y - py;
      px = x;
      py = y;
      p.set(x, y, PALM.frondDark);
      // A leaflet every other step on each side, angled back and down.
      if (i % 2 !== 0 || t < 0.08) continue;
      const leaf = Math.max(1.5, len * 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.05)));
      const dir = Math.atan2(dy, dx);
      for (const side of [-1, 1]) {
        const la = dir + side * 1.05 + 0.5;
        for (let k = 1; k <= leaf; k++) {
          const v = k / leaf;
          const lx = x + Math.cos(la) * k;
          const ly = y + Math.sin(la) * k + v * v * leaf * 0.35;
          if (pixelHash(Math.round(lx), Math.round(ly), seed + f) < 0.06) break;
          p.set(lx, ly, leafColor(side < 0 ? v * 0.7 : 0.3 + v * 0.7));
        }
      }
    }
  }
  // Coconuts in the crown.
  for (const [dx, dy] of [
    [-2, 2],
    [2, 3],
    [0, 4],
  ]) {
    const r = Math.max(1, H * 0.012);
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) if (j * j + k * k <= r * r) p.set(topX + dx * r + k, topY + dy * r * 0.6 + j, PALM.nut);
  }
  p.outline(PALM.ink);
  return { art: p, baseX, baseY, crown: { x: topX, y: topY } };
}

/** Beach grass: a fan of thin, wind-bent blades. */
function drawGrass(rng: () => number, scale = 1): PixelBuffer {
  const w = Math.round(randomRange(rng, 14, 24) * scale);
  const h = Math.round(randomRange(rng, 14, 24) * scale);
  const p = new PixelBuffer(w + 2, h + 1);
  for (let i = 0; i < randomInt(rng, 6, 11); i++) {
    const baseX = w / 2 + 1 + randomRange(rng, -3, 3);
    const lean = randomRange(rng, -0.7, 0.7);
    const len = randomRange(rng, h * 0.55, h);
    for (let t = 0; t < len; t++) {
      p.set(baseX + lean * t + (t / len) ** 2 * lean * 5, h - t, t > len * 0.65 ? 0xc8c070 : t > len * 0.3 ? 0x9aa458 : 0x7a8a48);
    }
  }
  return p;
}

/** A clump of wildflowers on the dune: daisies or purple sea-lavender. */
function drawFlowers(rng: () => number, kind: 'daisy' | 'violet'): PixelBuffer {
  const w = randomInt(rng, 24, 36);
  const h = randomInt(rng, 16, 24);
  const p = new PixelBuffer(w, h);
  for (let i = 0; i < 12; i++) {
    const x = randomRange(rng, 2, w - 2);
    const top = randomRange(rng, 2, h * 0.6);
    for (let y = top; y < h; y++) p.set(x + Math.sin(y * 0.3 + i) * 0.6, y, i % 3 ? 0x6a8a44 : 0x4e6e36);
  }
  for (let i = 0; i < randomInt(rng, 3, 6); i++) {
    const x = Math.round(randomRange(rng, 4, w - 4));
    const y = Math.round(randomRange(rng, 3, h * 0.55));
    if (kind === 'daisy') {
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) p.set(x + dx, y + dy, 0xf4f0e4);
      p.set(x, y, 0xe8b830);
    } else {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) p.set(x + dx, y + dy, 0xb08ad0);
      p.set(x, y, 0xe8d0f4);
    }
  }
  p.outline(0x2e3e22);
  return p;
}

/** A leafy dune bush stamped into a buffer. */
function stampBush(p: PixelBuffer, cx: number, baseY: number, h: number, seed: number, haze: number): void {
  const pal = [0x3e5a2e, 0x4e6c36, 0x62803e, 0x7a964a].map((c) => lerpColor(c, HAZE, haze));
  for (let k = 0; k < 3; k++) {
    const r = h * (k === 1 ? 0.55 : 0.42);
    const ccx = cx + (k - 1) * h * 0.55;
    const ccy = baseY - r;
    for (let y = Math.floor(ccy - r); y <= ccy + r; y++) {
      for (let x = Math.floor(ccx - r); x <= ccx + r; x++) {
        const dx = (x + 0.5 - ccx) / r;
        const dy = (y + 0.5 - ccy) / r;
        if (dx * dx + dy * dy > 1 - pixelHash(x, y, seed) * 0.3 || y > baseY) continue;
        const light = -dx * 0.6 - dy * 0.9;
        p.set(x, y, pal[light > 0.45 ? 3 : light > 0 ? 2 : light > -0.45 ? 1 : 0]);
      }
    }
  }
}

export function generateBeach(seed = 2718): BeachLayout {
  const rng = createRng(seed);
  const ledges: Ledge[] = [];

  // --- The wooded point: forest and palms running down to the horizon ---
  const land = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const landTop = (x: number) => 118 + (x / 450) ** 1.4 * 42 + Math.sin(x * 0.09) * 2 + (pixelHash(Math.floor(x / 3), 1, 7) - 0.5) * 3;
  for (let x = 0; x < 452; x++) {
    const top = landTop(x);
    for (let y = Math.floor(top); y < 200; y++) {
      const depth = y - top;
      const level = 0.35 + (valueNoise(x, y, 5, 11) - 0.5) * 0.6 - depth * 0.01;
      const ramp = [0x6e9488, 0x80a496, 0x92b4a2, 0xa4c2ae];
      land.set(x, y, ditherRamp(ramp, level, x, y));
      // Little palm tufts on the skyline.
      if (depth < 1 && pixelHash(x, 2, 7) < 0.08) for (let k = 1; k <= 3; k++) land.set(x + (k % 2), y - k, 0x7c9e90);
    }
  }

  // --- Sand: dry and rippled up the beach, damp towards the water ---
  const sand = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const dry = [0xcfb27c, 0xdcc28e, 0xe6d09e, 0xefdcae, 0xf6e8c0];
  const damp = [0xa88a5c, 0xb89a6a, 0xc6a874, 0xd2b682];
  const duneSand = [0xc8ae7c, 0xd6bc8a, 0xe2ca9a, 0xecd8aa];
  const duneGrass = [0x667440, 0x7a884a, 0x909c56, 0xa6ac64];
  /** Where the open beach gives way to grassy dunes (ground px up from the waterline). */
  const backEdge = (depth: number) => -300 - 50 * Math.sin(depth * 1.9 + 0.5);
  /** The path winds from the dunes at lower left out onto the open beach. */
  const pathS = (depth: number) => -560 + (depth - 1) * 220 + 25 * Math.sin(depth * 4);
  for (let y = BEACH_HORIZON + 1; y < WORLD_HEIGHT; y++) {
    const s = beachPlane.scaleAtY(y);
    const hazeAmount = Math.max(0, 0.5 - s * 0.7);
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const { depth, s: across } = shoreCoords(x, y);
      if (y < landTop(Math.min(451, x)) + 30 && x < 452 && y < 200) {
        // The far beach tucks under the wooded point.
        if (y < landTop(x) + 2) continue;
      }
      const gx = (x - beachPlane.vanishX) * depth;
      const stretch = 0.3 + s * 0.7;
      let level = 0.55 + (valueNoise(x, y / stretch, 6 + 20 * s, 21) - 0.5) * 0.5;
      // Wind ripples, fading with distance.
      if (depth < 3.5 && Math.sin(depth * 700 * 0.09 + gx * 0.03 + Math.sin(gx * 0.01) * 2) > 0.9) level -= 0.18;
      let color = ditherRamp(dry, level, x, y);
      // Damp sand near the water, darker the closer it gets.
      if (across > -70) color = ditherRamp(damp, 0.2 + (-across / 70) * 0.8 + (valueNoise(x, y, 7, 3) - 0.5) * 0.3, x, y);
      // Grassy dunes up the beach: sandy hollows between clumps of marram.
      const edge = backEdge(depth) + (valueNoise(x, y, 9, 77) - 0.5) * 50;
      if (across < edge) {
        const into = Math.min(1, (edge - across) / 160);
        // Soft dune ridges: lit faces and shaded hollows.
        const hollow = valueNoise(x, y / stretch, 8 + 22 * s, 73);
        color = ditherRamp(duneSand, 0.35 + hollow * 0.65, x, y);
        // Clumps of marram, patchy rather than a carpet.
        const grassy = valueNoise(x, y / stretch, 2 + 6 * s, 71) * 0.8 + pixelHash(x, y, 72) * 0.3;
        if (grassy > 0.92 - into * 0.2) color = ditherRamp(duneGrass, (grassy - 0.6) * 2 + (pixelHash(x, y, 74) - 0.5) * 0.3, x, y);
      }
      // The dune path: soft, pale, trodden sand with footprints.
      const pathOff = Math.abs(across - pathS(depth)) - (24 + 8 * Math.sin(depth * 7));
      if (pathOff < 0 && depth < 3.2) {
        // Trodden sand, scuffed with footprints, with a darker edge where it's been kicked up.
        color = pathOff > -5 * depth ? dry[1] : ditherRamp(dry, 0.72, x, y);
        if (pixelHash(Math.floor(x / 2), Math.floor(y / 2), 31) < 0.09) color = dry[0];
      }
      // Shells and pebbles.
      const h = pixelHash(x, y, 41);
      if (h < 0.004 * s) color = h < 0.002 * s ? 0xf8f0e4 : 0xe0a28a;
      sand.set(x, y, lerpColor(color, HAZE, hazeAmount));
    }
  }

  // --- Driftwood and an old dune fence ---
  const props = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  // Driftwood logs on the dry sand.
  for (const [i, [ax, ay, bx, by]] of (
    [
      [276, 312, 352, 302],
      [540, 296, 600, 300],
    ] as const
  ).entries()) {
    const s = beachPlane.scaleAtY((ay + by) / 2);
    const r = 4 + 4 * s;
    const steps = Math.hypot(bx - ax, by - ay);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      for (let j = -r; j <= r; j++) {
        const v = j / r;
        let color = v < -0.4 ? 0xcabaa0 : v > 0.45 ? 0x7a6a54 : 0xa8987e;
        if (pixelHash(Math.round(x / 3), Math.round(y + j), 50 + i) < 0.12) color = 0x6a5a46;
        props.set(x, y + j, color);
      }
    }
    // A broken branch sticking up.
    for (let k = 0; k < 10 * s; k++) props.set(bx - 6 + k * 0.4, by - r - k, 0x9a8a70);
    const top = Math.round(Math.min(ay, by) - r);
    ledges.push({ x0: Math.min(ax, bx) + 4, x1: Math.max(ax, bx) - 6, y: top, layer: 'near', kind: 'log', z: birdZ(top + r * 2) });
  }
  // Weathered fence posts along the dune, receding.
  for (let i = 0; i < 6; i++) {
    const depth = 1.45 + i * 0.28;
    const gx = -470 + i * 6;
    const p = beachPlane.project(gx, depth);
    const h = Math.round(30 * p.scale);
    const w = Math.max(2, Math.round(5 * p.scale));
    const x0 = Math.round(p.x - w / 2);
    const top = Math.round(p.y - h);
    for (let y = top; y < p.y; y++) {
      for (let k = 0; k < w; k++) props.set(x0 + k, y, k === 0 ? 0xa8987c : k === w - 1 ? 0x4e4234 : 0x7a6a56);
    }
    props.hline(x0, top, w, 0xc8bca4);
    ledges.push({ x0, x1: x0 + w - 1, y: top, layer: 'mid', kind: 'post', z: birdZ(p.y) });
  }
  props.outline(0x3a3024);

  // --- Palms leaning in from the left ---
  const palms: Placed[] = [];
  const palmSpots: Array<[x: number, baseY: number, height: number, lean: number]> = [
    [400, 188, 150, 10],
    [345, 196, 190, -18],
    [292, 204, 230, 26],
    [222, 214, 260, -24],
    [150, 226, 300, 34],
    [84, 238, 330, -30],
    [24, 262, 360, 40],
    [205, 300, 380, 150],
    [70, 318, 420, 60],
  ];
  for (const [i, [x, baseY, real, lean]] of palmSpots.entries()) {
    const s = beachPlane.scaleAtY(baseY);
    const palm = drawPalm(real * s, lean * s, 300 + i * 17);
    palms.push({ art: palm.art, x: Math.round(x - palm.baseX), y: Math.round(baseY - palm.baseY), baseY });
    // Gulls sit on the crowns of the nearer palms.
    if (s > 0.5) {
      const cx = Math.round(x - palm.baseX + palm.crown.x);
      const cy = Math.round(baseY - palm.baseY + palm.crown.y);
      ledges.push({ x0: cx - 3, x1: cx + 3, y: cy - 1, layer: 'mid', kind: 'palm', z: birdZ(baseY) });
    }
  }

  // --- The dune bank along the front, with grass and flowers ---
  const dune = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
  const duneTop = (x: number) => 288 + (x / 440) ** 1.6 * 36 + Math.sin(x * 0.04) * 3;
  for (let x = 0; x < 470; x++) {
    const top = duneTop(x);
    for (let y = Math.floor(top); y < WORLD_HEIGHT; y++) {
      const depth = y - top;
      const level = 0.62 - depth * 0.012 + (valueNoise(x, y, 6, 61) - 0.5) * 0.4 - (x / 470) * 0.1;
      dune.set(x, y, ditherRamp(dry, level, x, y));
    }
    dune.set(x, Math.floor(top), dry[4]);
  }
  dune.outline(0x8a744e);
  const tufts: Placed[] = [];
  for (let x = 6; x < 460; x += randomInt(rng, 16, 34)) {
    const art = drawGrass(rng, 1.7);
    const baseY = Math.round(duneTop(x) + randomInt(rng, 2, 8));
    tufts.push({ art, x: x - art.width / 2, y: baseY - art.height, baseY });
  }
  for (const [x, kind] of [
    [30, 'daisy'],
    [92, 'daisy'],
    [160, 'violet'],
    [230, 'daisy'],
    [320, 'violet'],
  ] as const) {
    const art = drawFlowers(rng, kind);
    const baseY = Math.round(duneTop(x) + 6);
    tufts.push({ art, x: x - art.width / 2, y: baseY - art.height, baseY });
  }
  // Marram grass and bushes dot the dunes, sized by distance (off the path).
  const plantRng = createRng(seed + 3);
  let placedPlants = 0;
  let bushes = 0;
  for (let attempt = 0; attempt < 1200 && placedPlants < 110; attempt++) {
    const y = randomRange(plantRng, BEACH_HORIZON + 14, 300);
    const x = randomRange(plantRng, 0, WORLD_WIDTH);
    const { depth, s: across } = shoreCoords(x, y);
    if (across > backEdge(depth) - 10) continue;
    if (Math.abs(across - pathS(depth)) < 34) continue;
    const scale = beachPlane.scaleAtY(y);
    const haze = Math.max(0, 0.5 - scale * 0.7);
    // Lusher further up the dunes, under the palms.
    const lush = Math.min(1, (backEdge(depth) - across) / 300);
    let art: PixelBuffer;
    if (bushes >= 26 || plantRng() < 0.8 - lush * 0.3) {
      // Marram: tall, varied clumps.
      art = drawGrass(plantRng, Math.max(0.35, scale * (1 + plantRng() * 0.8)));
    } else {
      // Low, irregular scrub: wider than tall, a different shape each time.
      const h = (10 + plantRng() * 18) * scale;
      const w = h * (1.4 + plantRng() * 1.2);
      art = new PixelBuffer(Math.ceil(w * 1.3) + 4, Math.ceil(h) + 3);
      const lobes = 2 + Math.floor(plantRng() * 3);
      for (let k = 0; k < lobes; k++) {
        stampBush(art, art.width / 2 + (k - (lobes - 1) / 2) * w * 0.3, art.height - 2, h * (0.6 + plantRng() * 0.4), Math.floor(x) + k, haze);
      }
      art.outline(0x2e3e22);
      bushes++;
    }
    tufts.push({ art, x: Math.round(x - art.width / 2), y: Math.round(y - art.height + 1), baseY: Math.round(y) });
    placedPlants++;
  }
  tufts.sort((a, b) => a.baseY - b.baseY);
  ledges.push({ x0: 120, x1: 440, y: 290, layer: 'near', kind: 'sand', z: birdZ(290) });
  ledges.push({ x0: 300, x1: 560, y: 250, layer: 'mid', kind: 'sand', z: birdZ(250) });

  return { land, sand, props, palms, dune, tufts, ledges };
}
