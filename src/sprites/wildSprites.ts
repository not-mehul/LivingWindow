import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { limb, Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid } from './raster';

/**
 * Wild animals shared between the landscapes: the fox, bats, the black bear,
 * butterflies, a woodpecker clinging to bark, and mushrooms. All drawn with
 * the kit at the size they're seen.
 */

type Pt = readonly [number, number];

/** A tiny cache of drawn textures by key. */
export class DrawnCache {
  private readonly cache = new Map<string, Texture>();

  get(key: string, draw: () => Drawn): Texture {
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = draw();
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
  }
}

// --- Fox ------------------------------------------------------------------

export type FoxPose = 'trot-1' | 'trot-2' | 'trot-3' | 'trot-4' | 'sniff' | 'sit' | 'crouch' | 'pounce' | 'run-1' | 'run-2';
export const FOX_TROT: readonly FoxPose[] = ['trot-1', 'trot-2', 'trot-3', 'trot-4'];

/**
 * A red fox in profile facing right, `height` px tall and 1.6× as wide, feet
 * on the bottom row: a russet body and white chest, black stockings, big
 * black-backed ears, a narrow muzzle, and the bushy white-tipped brush.
 * Authored in a 48×30 box.
 */
export function drawFox(pose: FoxPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.6);
  const g = new PixelGrid(W, H);
  const s = H / 30;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0xc8622a);
  const white = palette.ramp(0xf0e8dc, 0.6);
  const black = palette.ramp(0x2a2220);
  const eyeInk = palette.add(0x140c08);
  const big = H >= 12;
  const lw = Math.max(1, 2 * s);
  const leg = (path: Pt[], far: boolean) => {
    limb(g, path.slice(0, 2), lw * 1.5, lw, fur, { bias: far ? -1.2 : 0 });
    limb(g, path.slice(1), lw, lw * 0.9, black, { bias: far ? -0.8 : 0 });
  };
  const tail = (path: Pt[]) => {
    limb(g, path, 4.4 * s, 5.8 * s, fur, { bias: 0.2 });
    // White tip.
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    limb(g, [[a[0] + (b[0] - a[0]) * 0.6, a[1] + (b[1] - a[1]) * 0.6], b], 4 * s, 3.6 * s, white, { max: 3 });
  };
  const head = (hx: number, hy: number, angle: number, ears = 0) => {
    // Ears, the far one first.
    for (const [dx, far] of [[1.6, true], [0, false]] as const) {
      const base: Pt = P(hx - 1 + dx, hy - 2.5);
      const tip: Pt = P(hx - 2 + dx - ears, hy - 7.5 + Math.abs(ears) * 0.5);
      limb(g, [base, tip], 3 * s, 0.8 * s, far ? black : fur, { bias: far ? -0.5 : 0 });
      if (!far && big) limb(g, [[base[0] + s * 0.4, base[1]], tip], 1.2 * s, 0.6 * s, black, { max: 2 });
    }
    shadedEllipse(g, hx * s, hy * s, 4.2 * s, 3.4 * s, fur, { dither: false, angle });
    // The long muzzle, white beneath, a black nose at the tip.
    const mx = hx + Math.cos(angle) * 4.4;
    const my = hy + Math.sin(angle) * 4.4 + 0.6;
    shadedEllipse(g, mx * s, my * s, 3 * s, 1.5 * s, fur, { dither: false, angle });
    limb(g, [P(hx - 1, hy + 2), P(mx + 0.5, my + 1)], 2 * s, 1 * s, white, { max: 3 });
    g.set(Math.floor((hx + Math.cos(angle) * 7.2) * s), Math.floor((hy + Math.sin(angle) * 7.2 + 0.4) * s), black[1]);
    if (big) g.set(Math.floor((hx + 1.2) * s), Math.floor((hy - 0.8) * s), eyeInk);
  };

  if (pose === 'sit') {
    // Sitting up, brush curled round its feet.
    tail([P(16, 27), P(24, 29), P(32, 28.5)]);
    leg([P(26, 20), P(27, 25), P(27.5, 29)], true);
    shadedEllipse(g, 22 * s, 21 * s, 6 * s, 7 * s, fur, { dither: false, angle: -0.5 });
    shadedEllipse(g, 27 * s, 17 * s, 3 * s, 5 * s, white, { dither: false, max: 3, angle: -0.3 });
    leg([P(29, 18), P(29.5, 24), P(30, 29)], false);
    head(30, 9, 0.25);
  } else {
    const trot = pose.startsWith('trot') ? Number(pose.slice(-1)) - 1 : -1;
    const run = pose === 'run-1' ? 0 : pose === 'run-2' ? 1 : -1;
    const ph = (trot * Math.PI) / 2;
    const sw = (o: number) => (trot >= 0 ? Math.sin(ph + o) * 3 : 0);
    const lift = (o: number) => (trot >= 0 ? Math.max(0, Math.cos(ph + o)) * 2 : 0);
    const low = pose === 'crouch' ? 4 : pose === 'sniff' ? 1 : 0;
    const air = pose === 'pounce' ? -6 : run === 1 ? -2 : 0;
    const by = 16 + low + air;
    // Far legs.
    if (run >= 0) {
      leg(run === 0 ? [P(31, by + 3), P(36, by + 8), P(41, by + 11)] : [P(31, by + 3), P(30, by + 9), P(26, by + 12)], true);
      leg(run === 0 ? [P(14, by + 3), P(9, by + 8), P(4, by + 10)] : [P(14, by + 3), P(17, by + 9), P(21, by + 12)], true);
    } else if (pose === 'pounce') {
      leg([P(31, by + 3), P(35, by + 8), P(36, by + 13)], true);
      leg([P(14, by + 3), P(10, by + 7), P(6, by + 9)], true);
    } else {
      leg([P(31, by + 3), P(31.5 + sw(Math.PI) * 0.5, 24 - lift(Math.PI)), P(31 + sw(Math.PI), 29.5 - lift(Math.PI) * 0.5)], true);
      leg([P(14, by + 3), P(12 + sw(0) * 0.4, 24 - lift(0)), P(13 + sw(0), 29.5 - lift(0) * 0.5)], true);
    }
    // The brush, streaming behind (straight out when running, low when trotting).
    tail(run >= 0 || pose === 'pounce' ? [P(11, by - 1), P(5, by - 2), P(0.5, by - 1)] : [P(11, by), P(5, by + 3), P(1, by + 3)]);
    // Body, white chest.
    shadedEllipse(g, 21 * s, by * s, 11 * s, 5 * s, fur, { dither: false, min: 1, angle: pose === 'pounce' ? -0.25 : 0 });
    if (big) shadedEllipse(g, 29 * s, (by + 2) * s, 3.5 * s, 3 * s, white, { dither: false, max: 3 });
    // Near legs.
    if (run >= 0) {
      leg(run === 0 ? [P(29, by + 3), P(34, by + 9), P(38, by + 12)] : [P(29, by + 3), P(28, by + 9), P(24, by + 12)], false);
      leg(run === 0 ? [P(16, by + 3), P(11, by + 9), P(7, by + 11)] : [P(16, by + 3), P(19, by + 9), P(22, by + 12)], false);
    } else if (pose === 'pounce') {
      leg([P(29, by + 3), P(33, by + 8), P(34, by + 13)], false);
      leg([P(16, by + 3), P(12, by + 7), P(8, by + 10)], false);
    } else {
      leg([P(29, by + 3), P(29.5 + sw(0) * 0.5, 24 - lift(0)), P(29 + sw(0), 29.5 - lift(0) * 0.5)], false);
      leg([P(16, by + 3), P(14 + sw(Math.PI) * 0.4, 24 - lift(Math.PI)), P(15 + sw(Math.PI), 29.5 - lift(Math.PI) * 0.5)], false);
    }
    if (pose === 'sniff') head(37, 24, 1.0, -1);
    else if (pose === 'crouch') head(37, by - 2, 0.35, 1.5);
    else if (pose === 'pounce') head(38, by + 4, 1.1, -1);
    else head(36, by - 5, 0.3, run >= 0 ? 2 : 0);
  }
  if (big) selOut(g, palette, { bottomHeavy: H < 18 });
  return { grid: g, palette };
}

// --- Bats -----------------------------------------------------------------

/** A bat flitting, `size` px across: a furry body and leathery wings (up, level, down). */
export function drawBat(frame: number, size: number): Drawn {
  const N = Math.max(4, Math.round(size));
  const H = Math.max(3, Math.round(N * 0.6));
  const g = new PixelGrid(N, H);
  const s = N / 16;
  const palette = new Palette();
  const wing = palette.ramp(0x3a2e34);
  const fur = palette.ramp(0x5a463a);
  const cx = N / 2;
  const cy = H * 0.55;
  const f = ((frame % 3) + 3) % 3;
  const tipY = [-4.5, 0, 3.5][f] * s;
  const elbowY = [-3, -0.5, 1.5][f] * s;
  for (const side of [-1, 1]) {
    // Each wing a scalloped membrane from body to the wrist and on to the tip.
    const wrist: Pt = [cx + side * 4 * s, cy + elbowY];
    const tip: Pt = [cx + side * 7.6 * s, cy + tipY];
    g.polygon([[cx, cy - 0.5 * s], wrist, tip, [cx + side * 5.5 * s, cy + tipY * 0.5 + 1.6 * s], [cx + side * 3 * s, cy + 1.6 * s], [cx, cy + 1.2 * s]], wing[f === 0 ? 2 : 1]);
    if (N >= 10) limb(g, [[cx, cy - 0.5 * s], wrist, tip], 0.8, 0.6, wing, { max: 3 });
  }
  shadedEllipse(g, cx, cy, Math.max(0.8, 1.4 * s), Math.max(1, 2.2 * s), fur, { dither: false });
  // Ears.
  if (N >= 8) {
    g.set(Math.floor(cx - 0.6 * s), Math.floor(cy - 2.6 * s), fur[1]);
    g.set(Math.floor(cx + 0.6 * s), Math.floor(cy - 2.6 * s), fur[1]);
  }
  return { grid: g, palette };
}

// --- Black bear -------------------------------------------------------------

export type BearPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'sniff';

/** A black bear ambling in profile facing right, `height` px tall, 1.7× as wide: a shouldered bulk, round ears, a tan muzzle. */
export function drawBear(pose: BearPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.7);
  const g = new PixelGrid(W, H);
  const s = H / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0x2e2826, 0.9);
  const muzzle = palette.ramp(0xa8845a);
  const k = pose.startsWith('walk') ? Number(pose.slice(-1)) - 1 : 0;
  const ph = (k * Math.PI) / 2;
  const sw = (o: number) => (pose.startsWith('walk') ? Math.sin(ph + o) * 2.4 : 0);
  const legW = Math.max(1.5, 3.4 * s);
  const leg = (x: number, o: number, far: boolean) => limb(g, [P(x, 15), P(x + sw(o), 23.5)], legW * 1.2, legW, fur, { bias: far ? -1.2 : -0.2 });
  leg(30, Math.PI, true);
  leg(13, 0, true);
  // The bulk: rump, belly, the hump over the shoulders.
  shadedEllipse(g, 12 * s, 12 * s, 7 * s, 7 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 21 * s, 13 * s, 11 * s, 6.5 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 28 * s, 10.5 * s, 6 * s, 6 * s, fur, { dither: false, min: 1 });
  leg(32, 0, false);
  leg(11, Math.PI, false);
  // Head, carried low, sniffing the ground when it stops.
  const [hx, hy] = pose === 'sniff' ? [36, 17] : [35, 11];
  g.set(Math.floor((hx - 2.5) * s), Math.floor((hy - 4) * s), fur[2]);
  shadedEllipse(g, (hx - 2) * s, (hy - 3.6) * s, Math.max(0.6, 1.3 * s), Math.max(0.6, 1.3 * s), fur, { dither: false });
  shadedEllipse(g, hx * s, hy * s, 4 * s, 3.4 * s, fur, { dither: false });
  shadedEllipse(g, (hx + 3.6) * s, (hy + 0.8) * s, 2.2 * s, 1.6 * s, muzzle, { dither: false, max: 3 });
  g.set(Math.floor((hx + 5.4) * s), Math.floor((hy + 0.4) * s), fur[0]);
  if (H >= 12) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Butterflies -------------------------------------------------------------

export type ButterflyKind = 'monarch' | 'white' | 'blue' | 'brimstone';

const BUTTERFLY: Record<ButterflyKind, { wing: number; edge: number }> = {
  monarch: { wing: 0xe8862a, edge: 0x2a1e18 },
  white: { wing: 0xf2f0e8, edge: 0x6a6a70 },
  blue: { wing: 0x6a9ae8, edge: 0x2a3a6a },
  brimstone: { wing: 0xe8e060, edge: 0xb0a030 },
};

/** Hand-placed butterflies (they're only ever a few pixels): e edge, w wing, d shade, b body. */
const BUTTERFLY_FRAMES: Record<'small' | 'large', string[][]> = {
  small: [
    ['e...e', 'wwbww', '.wbw.', '.d.d.'],
    ['.e.e.', '.wbw.', '..b..', '.....'],
    ['..e..', '..w..', '..b..', '.....'],
  ],
  large: [
    ['ee.....ee', 'ewwd.dwwe', '.wwwbwww.', '..wdbdw..', '..wwbww..', '..dw.wd..'],
    ['.e.....e.', '.ww...ww.', '..wwbww..', '...dbd...', '...wbw...', '...d.d...'],
    ['....e....', '....w....', '...ww....', '...wb....', '....b....', '.........'],
  ],
};

/** A butterfly, wings open (frame 0), half (1) or closed up (2), `size` px across. */
export function drawButterfly(kind: ButterflyKind, frame: number, size: number): Drawn {
  const palette = new Palette();
  const style = BUTTERFLY[kind];
  const wing = palette.ramp(style.wing);
  const ink: Record<string, number> = { e: palette.add(style.edge), w: wing[3], d: wing[1], b: palette.add(0x2a2420) };
  const rows = BUTTERFLY_FRAMES[size < 7 ? 'small' : 'large'][((frame % 3) + 3) % 3];
  const g = new PixelGrid(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.set(x, y, ink[row[x]]);
  });
  const N = Math.round(size);
  return { grid: N > 10 ? g.resampled(N, Math.round((N * rows.length) / rows[0].length)) : g, palette };
}

// --- Woodpecker on a trunk ------------------------------------------------------

/**
 * A great spotted woodpecker clinging upright to bark, facing the trunk at
 * its right, `size` px tall: black back with a white shoulder patch, red
 * under the tail and at the nape, the stiff tail braced on the bark.
 * Frame 0 has its head drawn back, frame 1 striking.
 */
export function drawWoodpeckerCling(frame: number, size: number): Drawn {
  const N = Math.max(5, Math.round(size));
  const W = Math.max(4, Math.round(N * 0.7));
  const g = new PixelGrid(W, N);
  const s = N / 16;
  const palette = new Palette();
  const black = palette.ramp(0x26242a);
  const white = palette.ramp(0xeeeae2, 0.5);
  const red = palette.ramp(0xc8282a);
  const beak = palette.add(0x3a3a40);
  const strike = frame % 2 === 1 ? 1 : 0;
  // Tail braced against the bark, below.
  limb(g, [[3.4 * s, 10 * s], [3.8 * s, 15.5 * s]], 1.8 * s, 1.2 * s, black, { bias: -0.5 });
  // Body, upright and leaning in to the trunk.
  shadedEllipse(g, 4.2 * s, 8.5 * s, 2.6 * s, 4.4 * s, black, { dither: false, angle: -0.15 });
  if (N >= 8) {
    shadedEllipse(g, 3.2 * s, 7.5 * s, 1 * s, 2 * s, white, { dither: false, max: 3 });
    g.set(Math.floor(5.4 * s), Math.floor(12 * s), red[2]);
  }
  // Head: drawn back, or struck forward into the bark.
  const hx = 5.2 + strike * 1.2;
  const hy = 3.4 + strike * 0.4;
  shadedEllipse(g, hx * s, hy * s, 1.9 * s, 1.7 * s, black, { dither: false });
  if (N >= 8) {
    g.set(Math.floor((hx + 0.3) * s), Math.floor((hy + 0.6) * s), white[3]);
    g.set(Math.floor((hx - 1.2) * s), Math.floor((hy - 0.5) * s), red[2]);
  }
  for (let k = 0; k < Math.max(1, Math.round(1.6 * s)); k++) g.set(Math.floor((hx + 1.8) * s) + k, Math.floor(hy * s), beak);
  // Feet gripping the bark.
  g.set(Math.floor(6 * s), Math.floor(10.5 * s), black[0]);
  return { grid: g, palette };
}

// --- Mushrooms ---------------------------------------------------------------

export type MushroomKind = 'fly-agaric' | 'bolete' | 'cluster';

/** A mushroom (or a little cluster) `size` px tall, pushing up through the leaf litter. */
export function drawMushroom(kind: MushroomKind, size: number): Drawn {
  const N = Math.max(3, Math.round(size));
  const W = kind === 'cluster' ? Math.round(N * 1.6) : Math.max(3, Math.round(N * 1.1));
  const g = new PixelGrid(W, N);
  const palette = new Palette();
  const stem = palette.ramp(0xeee4d0, 0.6);
  const cap: Ramp = palette.ramp(kind === 'fly-agaric' ? 0xd0302a : kind === 'bolete' ? 0x8a5a32 : 0xc8a068);
  const spot = palette.add(0xf8f4ea);
  const one = (cx: number, h: number, w: number) => {
    // Stem, then the cap over it.
    for (let y = Math.floor(N - h * 0.65); y < N; y++) for (let x = Math.floor(cx - w * 0.18); x <= Math.floor(cx + w * 0.18); x++) g.set(x, y, stem[x < cx ? 3 : 2]);
    shadedEllipse(g, cx, N - h * 0.68, w / 2, Math.max(0.8, h * 0.32), cap, { dither: false });
    if (kind === 'fly-agaric' && N >= 5) {
      g.set(Math.floor(cx - w * 0.2), Math.floor(N - h * 0.8), spot);
      g.set(Math.floor(cx + w * 0.15), Math.floor(N - h * 0.72), spot);
    }
  };
  if (kind === 'cluster') {
    one(W * 0.3, N * 0.75, N * 0.7);
    one(W * 0.62, N, N * 0.8);
    one(W * 0.85, N * 0.55, N * 0.5);
  } else one(W / 2, N, W);
  if (N >= 6) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

