import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { eye, limb, Palette, rimShade, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

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

/**
 * A bat flitting, `size` px across: a furry brown body and big ears, and
 * leathery wings stretched over long finger bones, scalloped between them.
 * Four frames through the wingbeat: raised, sweeping down, down, coming up.
 */
export function drawBat(frame: number, size: number): Drawn {
  const N = Math.max(4, Math.round(size));
  const H = Math.max(3, Math.round(N * 0.66));
  const g = new PixelGrid(N, H);
  const s = N / 16;
  const palette = new Palette();
  const wing = palette.ramp(0x3e3036, 0.9);
  const bone = palette.ramp(0x6a5458);
  const fur = palette.ramp(0x6a503e);
  const cx = N / 2;
  const cy = H * 0.52;
  const f = ((frame % 4) + 4) % 4;
  // Wrist and tip heights through the beat (authored units).
  const wristY = [-3.2, -1, 1.6, 0.2][f] * s;
  const tipY = [-4.8, -0.4, 3.6, 1.8][f] * s;
  const spread = [0.86, 1, 0.82, 0.9][f];
  for (const side of [-1, 1]) {
    const wrist: Pt = [cx + side * 3.8 * s * spread, cy + wristY];
    const tip: Pt = [cx + side * 7.6 * s * spread, cy + tipY];
    const mid: Pt = [cx + side * 6.6 * s * spread, cy + tipY * 0.5 + 2.2 * s];
    const inner: Pt = [cx + side * 4.4 * s * spread, cy + wristY * 0.3 + 2.4 * s];
    // The membrane: from the body out to the tip, scalloped back along the trailing edge.
    g.polygon([[cx, cy - 0.8 * s], wrist, tip, mid, [cx + side * 5.4 * s * spread, cy + 1.2 * s + tipY * 0.2], inner, [cx + side * 2.6 * s, cy + 2 * s], [cx, cy + 1.4 * s]], wing[f === 2 ? 1 : 2]);
    if (N >= 9) {
      // The arm and finger bones fanning from the wrist.
      limb(g, [[cx, cy - 0.6 * s], wrist], 0.9, 0.7, bone, { max: 2 });
      limb(g, [wrist, tip], 0.7, 0.6, bone, { max: 2 });
      limb(g, [wrist, mid], 0.6, 0.6, bone, { max: 1 });
      limb(g, [wrist, inner], 0.6, 0.6, bone, { max: 1 });
    }
  }
  // The body: furry, a pale-ish chest, ears pricked.
  shadedEllipse(g, cx, cy + 0.3 * s, Math.max(0.8, 1.5 * s), Math.max(1, 2.4 * s), fur, { dither: false });
  if (N >= 7) {
    const ear = Math.max(1, Math.round(1.2 * s));
    for (let k = 0; k < ear; k++) {
      g.set(Math.floor(cx - 0.9 * s), Math.floor(cy - 2.2 * s) - k, fur[2]);
      g.set(Math.floor(cx + 0.9 * s), Math.floor(cy - 2.2 * s) - k, fur[1]);
    }
  }
  if (N >= 12) selOut(g, palette, { bottomHeavy: false });
  return { grid: g, palette };
}

// --- Black bear -------------------------------------------------------------

export type BearPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'walk-5' | 'walk-6' | 'sniff' | 'sniff-air';
/** A heavy, rolling six-beat amble. */
export const BEAR_WALK: readonly BearPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6'];

/**
 * A black bear ambling in profile facing right, `height` px tall and 1.7× as
 * wide: a shaggy bulk rising to the hump over its shoulders, thick jointed
 * legs on broad paws with pale claws, round ears, a small dark eye and a tan
 * muzzle. It sniffs along the ground, or lifts its nose to scent the air.
 * Authored in a 41×24 box.
 */
export function drawBear(pose: BearPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.7);
  const g = new PixelGrid(W, H);
  const s = H / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0x2e2826, 0.9);
  const muzzle = palette.ramp(0xa8845a);
  const claw = palette.ramp(0xd8ccb0);
  const eyeInk = palette.add(0x0a0808);
  const glint = palette.add(0xc8c0b0);
  const walking = pose.startsWith('walk');
  const k = walking ? Number(pose.slice(-1)) - 1 : 0;
  const ph = (k * Math.PI * 2) / 6;
  const bob = walking ? Math.abs(Math.sin(ph)) * 0.7 : 0;
  const detailed = H >= 14;
  const legW = Math.max(1.5, 3.8 * s);
  /** One leg: a thick upper limb, the forearm or hock, and a broad paw; it swings and lifts in the walk. */
  const leg = (x: number, o: number, far: boolean, front: boolean) => {
    const swing = walking ? Math.sin(ph + o) * 2.6 : 0;
    const lift = walking ? Math.max(0, Math.cos(ph + o)) * 1.6 : 0;
    const bias = far ? -1.3 : -0.2;
    const top = P(x, 13 + bob);
    const joint = front ? P(x + swing * 0.4 + lift * 0.4, 19 - lift * 0.5) : P(x - 1 + swing * 0.3, 19.5 - lift * 0.6);
    const paw = P(x + swing, 23.2 - lift);
    limb(g, [top, joint], legW * 1.5, legW * 1.05, fur, { bias });
    limb(g, [joint, paw], legW * 1.05, legW * 0.95, fur, { bias });
    // The paw, flat on the ground, and its claws.
    shadedEllipse(g, paw[0] + 0.8 * s, paw[1], Math.max(1, 2.2 * s), Math.max(0.6, 1 * s), fur, { dither: false, bias: bias - 0.3 });
    if (detailed && !far) g.set(Math.floor(paw[0] + 2.6 * s), Math.floor(paw[1] + 0.4 * s), claw[2]);
  };
  leg(29, Math.PI, true, true);
  leg(11.5, 0, true, false);
  // The bulk: rump, a deep belly, and the hump over the shoulders.
  shadedEllipse(g, 11 * s, (11.5 + bob) * s, 7.5 * s, 7.5 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 20 * s, (12.5 + bob) * s, 11 * s, 6.8 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 27.5 * s, (10 + bob) * s, 6.5 * s, 6.5 * s, fur, { dither: false, min: 1 });
  // A stub of tail.
  g.set(Math.floor(3.6 * s), Math.floor((9.5 + bob) * s), fur[1]);
  leg(31.5, 0, false, true);
  leg(10, Math.PI, false, false);
  // Head: low and swinging as it walks, nose to the ground to sniff, or raised to scent the air.
  const sniffing = pose === 'sniff';
  const air = pose === 'sniff-air';
  const hx = sniffing ? 35.5 : air ? 34.5 : 35 + (walking ? Math.sin(ph) * 0.5 : 0);
  const hy = (sniffing ? 17.5 : air ? 7 : 11.5) + bob;
  const tilt = sniffing ? 0.7 : air ? -0.5 : 0.15;
  // The neck, thick, into the shoulders.
  limb(g, [P(29, 9 + bob), P(hx - 1.5, hy)], 8 * s, 6.5 * s, fur, { dither: false });
  // Round ears, the far one in shade.
  shadedEllipse(g, (hx - 2.8) * s, (hy - 3.6) * s, Math.max(0.6, 1.4 * s), Math.max(0.6, 1.4 * s), fur, { dither: false, bias: -1 });
  shadedEllipse(g, (hx - 1.4) * s, (hy - 3.9) * s, Math.max(0.6, 1.5 * s), Math.max(0.6, 1.4 * s), fur, { dither: false });
  shadedEllipse(g, hx * s, hy * s, 4 * s, 3.4 * s, fur, { dither: false, angle: tilt });
  // The long tan muzzle and its dark nose.
  const mx = hx + Math.cos(tilt) * 3.4;
  const my = hy + Math.sin(tilt) * 3.4 + 0.6;
  shadedEllipse(g, mx * s, my * s, 2.4 * s, 1.6 * s, muzzle, { dither: false, angle: tilt, max: 3 });
  g.set(Math.floor((mx + Math.cos(tilt) * 2.2) * s), Math.floor((my + Math.sin(tilt) * 2.2 - 0.4) * s), fur[0]);
  if (detailed) {
    eye(g, (hx + 0.8) * s, (hy - 0.9) * s, H >= 30 ? 2 : 1, eyeInk, glint);
    // Shaggy fur: darker strands through the coat, a little rim light along the back.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = g.get(x, y);
        if (c === fur[2] && pixelHash(x, Math.floor(y / 2), 17) < 0.18) g.set(x, y, fur[1]);
        else if (c === fur[3] && pixelHash(x, Math.floor(y / 2), 19) < 0.07) g.set(x, y, fur[4]);
      }
    }
    rimShade(g, [fur]);
  }
  if (H >= 12) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Grey wolf --------------------------------------------------------------

export type WolfPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'sit' | 'howl';
export const WOLF_WALK: readonly WolfPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];

/**
 * A grey wolf in profile facing right, `height` px tall and 1.6× as wide:
 * lean and long-legged, a deep chest, a thick ruff, pointed ears, a long
 * muzzle and a bushy tail carried low. It walks, sits, or sits with its
 * muzzle raised to the sky, howling. Authored in a 38×24 box.
 */
export function drawWolf(pose: WolfPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.6);
  const g = new PixelGrid(W, H);
  const s = H / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0x7a7672, 0.9);
  const pale = palette.ramp(0xc8c2b8, 0.6);
  const dark = palette.ramp(0x3a3634);
  const eyeInk = palette.add(0xd8c060);
  const detailed = H >= 14;
  const legW = Math.max(1, 2 * s);
  if (pose === 'sit' || pose === 'howl') {
    // Sitting: haunches down, forelegs straight, the tail curled round the feet.
    limb(g, [P(9, 21), P(4, 22.5), P(3, 20)], 3 * s, 2.4 * s, fur, { bias: -0.4 });
    shadedEllipse(g, 12 * s, 17 * s, 6 * s, 5.5 * s, fur, { dither: false, min: 1 });
    shadedEllipse(g, 17 * s, 12 * s, 4.5 * s, 7 * s, fur, { dither: false, angle: 0.35, min: 1 });
    if (detailed) shadedEllipse(g, 19.5 * s, 13 * s, 2 * s, 5 * s, pale, { dither: false, angle: 0.35, max: 3 });
    limb(g, [P(19, 15), P(20, 23.5)], legW * 1.2, legW, fur, { bias: -0.2 });
    limb(g, [P(17, 15), P(17.5, 23.5)], legW * 1.2, legW, fur, { bias: -1.2 });
    const howl = pose === 'howl';
    const hx = howl ? 21 : 22.5;
    const hy = howl ? 6.5 : 7;
    const tilt = howl ? -1.05 : 0.15;
    // The ruff, the head, ears laid back when it howls.
    limb(g, [P(18, 9), P(hx - 1, hy + 1.5)], 6 * s, 4.5 * s, fur);
    shadedEllipse(g, hx * s, hy * s, 3 * s, 2.6 * s, fur, { dither: false });
    limb(g, [P(hx - 1, hy - 1.5), P(hx - (howl ? 3 : 1.5), hy - (howl ? 3 : 4.5))], 1.8 * s, 0.8 * s, fur, { bias: -0.4 });
    const mx = hx + Math.cos(tilt) * 4;
    const my = hy + Math.sin(tilt) * 4;
    limb(g, [P(hx + Math.cos(tilt) * 1.5, hy + Math.sin(tilt) * 1.5), P(mx, my)], 2.4 * s, 1.4 * s, fur, { bias: 0.3 });
    g.set(Math.floor(mx * s), Math.floor(my * s), dark[1]);
    if (detailed && !howl) g.set(Math.floor((hx + 0.6) * s), Math.floor((hy - 0.6) * s), eyeInk);
  } else {
    const k = Number(pose.slice(-1)) - 1;
    const ph = (k * Math.PI) / 2;
    const leg = (x: number, o: number, far: boolean, front: boolean) => {
      const sw = Math.sin(ph + o) * 2.6;
      const lift = Math.max(0, Math.cos(ph + o)) * 1.4;
      const joint = front ? P(x + sw * 0.3, 18.5 - lift * 0.4) : P(x - 1.5 + sw * 0.3, 18 - lift * 0.4);
      limb(g, [P(x, 13), joint], legW * 1.4, legW, fur, { bias: far ? -1.3 : -0.2 });
      limb(g, [joint, P(x + sw, 23.4 - lift)], legW, legW * 0.9, fur, { bias: far ? -1.3 : -0.3 });
    };
    leg(26, Math.PI, true, true);
    leg(10, 0, true, false);
    // The tail, low and bushy.
    limb(g, [P(5, 11), P(2.5, 15), P(2, 19)], 3.4 * s, 2.6 * s, fur, { bias: -0.3 });
    if (detailed) g.set(Math.floor(2 * s), Math.floor(19.5 * s), dark[1]);
    // A lean body: the haunch, a tucked-up belly, the deep chest and the ruff over the shoulders.
    shadedEllipse(g, 10 * s, 11.5 * s, 5 * s, 4.5 * s, fur, { dither: false, min: 1 });
    shadedEllipse(g, 17 * s, 12 * s, 9 * s, 3.8 * s, fur, { dither: false, min: 1 });
    shadedEllipse(g, 25 * s, 11.5 * s, 5 * s, 5.2 * s, fur, { dither: false, min: 1 });
    if (detailed) shadedEllipse(g, 28.5 * s, 13.5 * s, 1.6 * s, 2.4 * s, pale, { dither: false, max: 3 });
    leg(28, 0, false, true);
    leg(8.5, Math.PI, false, false);
    // Head carried level and low, ears pricked, the long muzzle.
    const bob = Math.sin(ph * 2) * 0.4;
    const hx = 32;
    const hy = 8 + bob;
    limb(g, [P(27, 9), P(hx - 1.5, hy + 0.5)], 5.5 * s, 4 * s, fur);
    shadedEllipse(g, hx * s, hy * s, 2.8 * s, 2.5 * s, fur, { dither: false });
    limb(g, [P(hx - 1, hy - 1.5), P(hx - 1.6, hy - 4.6)], 1.8 * s, 0.8 * s, fur);
    limb(g, [P(hx + 1, hy + 0.3), P(hx + 4.6, hy + 1.2)], 2.3 * s, 1.4 * s, fur, { bias: 0.3 });
    g.set(Math.floor((hx + 4.8) * s), Math.floor((hy + 1) * s), dark[1]);
    if (detailed) g.set(Math.floor((hx + 0.7) * s), Math.floor((hy - 0.6) * s), eyeInk);
  }
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
 * its right, `size` px tall: black back with a white shoulder patch, white
 * cheeks with a black moustache, a red nape and red under the tail, the
 * stiff tail braced on the bark. Frames: 0 head drawn back, 1 swinging in,
 * 2 striking the bark, 3 hitching up the trunk (tail lifted, body raised).
 */
export function drawWoodpeckerCling(frame: number, size: number): Drawn {
  const N = Math.max(5, Math.round(size));
  const W = Math.max(4, Math.round(N * 0.72));
  const g = new PixelGrid(W, N);
  const s = N / 16;
  const palette = new Palette();
  const black = palette.ramp(0x26242a);
  const white = palette.ramp(0xeeeae2, 0.5);
  const red = palette.ramp(0xc8282a);
  const beak = palette.add(0x3a3a40);
  const eyeInk = palette.add(0x0a0a0c);
  const f = ((frame % 4) + 4) % 4;
  const reach = [0, 0.6, 1.3, 0][f];
  const hitch = f === 3 ? -1 : 0;
  // Tail braced against the bark below (lifted as it hitches up).
  limb(g, [[3.4 * s, (10 + hitch) * s], [3.8 * s, (15.5 + hitch * 1.6) * s]], 1.8 * s, 1.2 * s, black, { bias: -0.5 });
  // Body, upright and leaning in to the trunk; white underparts showing at the front.
  shadedEllipse(g, 4.2 * s, (8.5 + hitch) * s, 2.6 * s, 4.4 * s, black, { dither: false, angle: -0.15 });
  if (N >= 8) {
    shadedEllipse(g, 5.4 * s, (8.4 + hitch) * s, 1 * s, 3 * s, white, { dither: false, max: 2 });
    shadedEllipse(g, 3.1 * s, (7.4 + hitch) * s, 1 * s, 2 * s, white, { dither: false, max: 3 });
    g.set(Math.floor(5.2 * s), Math.floor((12 + hitch) * s), red[2]);
  }
  // Head: drawn back, swinging in, or struck into the bark.
  const hx = 5.2 + reach;
  const hy = 3.4 + reach * 0.3 + hitch;
  shadedEllipse(g, hx * s, hy * s, 1.9 * s, 1.7 * s, black, { dither: false });
  if (N >= 8) {
    // White cheek, black moustache, red nape.
    g.set(Math.floor((hx + 0.2) * s), Math.floor((hy + 0.7) * s), white[3]);
    g.set(Math.floor((hx - 1.2) * s), Math.floor((hy - 0.4) * s), red[2]);
    if (N >= 12) {
      g.set(Math.floor((hx + 0.9) * s), Math.floor((hy + 0.6) * s), white[3]);
      g.set(Math.floor((hx - 1.3) * s), Math.floor((hy - 1) * s), red[1]);
    }
    g.set(Math.floor((hx + 0.6) * s), Math.floor((hy - 0.5) * s), eyeInk);
  }
  for (let k = 0; k < Math.max(1, Math.round(1.6 * s)); k++) g.set(Math.floor((hx + 1.8) * s) + k, Math.floor((hy + reach * 0.15) * s), beak);
  // Feet gripping the bark.
  g.set(Math.floor(6 * s), Math.floor((10.5 + hitch) * s), black[0]);
  if (N >= 12) selOut(g, palette, { bottomHeavy: false });
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


// --- Hedgehog ----------------------------------------------------------------------

/** A hedgehog snuffling along, `size` px long: a dome of spines, a pointed snout, little feet (frames 0–1), or rolled into a ball. */
export function drawHedgehog(frame: number, size: number, curled = false): Drawn {
  const W = Math.max(5, Math.round(size));
  const H = Math.max(3, Math.round(W * 0.6));
  const g = new PixelGrid(W, H);
  const s = W / 16;
  const palette = new Palette();
  const spines = palette.ramp(0x8a6a4c, 1.1);
  const tips = palette.add(0xe8dcc0);
  const face = palette.ramp(0xd4b490);
  const nose = palette.add(0x1a1210);
  if (curled) {
    g.ellipse(W / 2, H - 4.4 * s, 4.6 * s, 4.2 * s, (u, v, x, y) => (pixelHash(x, y, 21) < 0.35 ? tips : spines[-u - v > 0.3 ? 3 : 1]));
    if (W >= 10) selOut(g, palette, { bottomHeavy: true });
    return { grid: g, palette };
  }
  // Snout and face, poking out in front.
  limb(g, [[9.5 * s, H - 3 * s], [14.6 * s, H - 2 * s]], 3.6 * s, 1.4 * s, face);
  g.set(Math.floor(14.8 * s), Math.floor(H - 2.2 * s), nose);
  // The dome of spines, their pale tips catching the light.
  g.ellipse(7 * s, H - 3.6 * s, 6.6 * s, 4.6 * s, (u, v, x, y) => {
    if (v > 0.6) return 0;
    if (pixelHash(x, y, 21) < 0.32 - v * 0.2) return tips;
    return spines[-u * 0.5 - v * 0.7 > 0.3 ? 3 : 2];
  });
  // Little feet shuffling.
  const step = frame % 2;
  g.set(Math.floor((4 + step) * s), H - 1, face[1]);
  g.set(Math.floor((10 - step) * s), H - 1, face[1]);
  if (W >= 10) selOut(g, palette, { bottomHeavy: true });
  if (W >= 10) g.set(Math.floor(11.8 * s), Math.floor(H - 3.6 * s), nose);
  return { grid: g, palette };
}
