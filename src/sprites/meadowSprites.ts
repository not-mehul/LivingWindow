import type { Texture } from 'pixi.js';
import { DrawnCache } from './cache';
import { evenSize, limb, Palette, selOut, shadedEllipse, valueNoise, type Drawn, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

type Pt = readonly [number, number];

/** Map every pixel of one ramp onto the same shade of another (for patches, bellies and markings). */
function remap(g: PixelGrid, from: Ramp, to: Ramp, test: (x: number, y: number) => boolean): void {
  const index = new Map<number, number>();
  from.forEach((c, k) => index.set(c, to[k]));
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const k = index.get(g.get(x, y));
      if (k !== undefined && test(x, y)) g.set(x, y, k);
    }
  }
}

// --- Cows ---------------------------------------------------------------

export type CowPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'graze-1' | 'graze-2' | 'stand' | 'lie';
export const COW_WALK: readonly CowPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];
export type CowCoat = 'holstein' | 'jersey' | 'brown';

const COW_COATS: Record<CowCoat, { coat: number; patch: number; muzzle: number }> = {
  holstein: { coat: 0xeeece4, patch: 0x2a2624, muzzle: 0xc89890 },
  jersey: { coat: 0xc08a54, patch: 0x8a5a30, muzzle: 0x3a2a24 },
  brown: { coat: 0x7a4a2a, patch: 0x4a2a16, muzzle: 0xa87a68 },
};

/**
 * A cow in profile facing right, (1.5·H)×H, hooves on the bottom row, with
 * real cattle lines: a straight back from the hip bones to the withers, a
 * deep barrel, long slim legs (the hind ones bent back at the hock), and a
 * big wedge of a head hanging below the back on a thick neck with a dewlap.
 * Walking is a four-beat walk, one hoof lifted at a time. A Holstein's black
 * patches stay on the body; its head is black with a white blaze and its
 * lower legs are white. Authored in a 60×40 box.
 */
export function drawCowSized(coat: CowCoat, pose: CowPose, height: number): Drawn {
  const H = Math.max(6, Math.round(height));
  const width = Math.round(H * 1.5);
  const g = new PixelGrid(width, H);
  const s = H / 40;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const style = COW_COATS[coat];
  const palette = new Palette();
  const fur = palette.ramp(style.coat, coat === 'holstein' ? 0.7 : 1);
  const patch = palette.ramp(style.patch, 0.8);
  const muzzle = palette.ramp(style.muzzle);
  const pink = palette.ramp(0xd8a8a0, 0.7);
  const horn = palette.ramp(0xd8ccb0);
  const hoof = palette.ramp(0x2e2622);
  const eyeInk = palette.add(0x140e0c);
  const detailed = H >= 16;
  const dither = false;
  const px = (w: number) => Math.max(1, w * s);
  const holstein = coat === 'holstein';

  const drawHoof = (foot: Pt, far: boolean) => {
    const hw = Math.max(1, Math.round(3 * s));
    const hh = Math.max(1, Math.round(1.6 * s));
    const y0 = Math.min(H - hh, Math.round(foot[1] - hh / 2));
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) g.set(Math.round(foot[0] - hw / 2) + x, y0 + y, hoof[far ? 1 : y === 0 ? 3 : 2]);
  };
  /** A foreleg: elbow, knee, fetlock, hoof. Lifted, it folds back at the knee. */
  const foreleg = (x: number, dx: number, lift: number, far: boolean) => {
    const bias = far ? -1.2 : 0;
    const knee = P(x + 0.5 + lift * 0.5, 31.5 - lift * 0.6);
    const foot = P(x + dx - lift * 0.9, 39.2 - lift);
    limb(g, [P(x - 0.5, 22), knee], px(4.6), px(3), fur, { bias });
    limb(g, [knee, foot], px(2.8), px(2.4), fur, { bias });
    drawHoof(foot, far);
  };
  /** A hind leg: the thigh down to the stifle, the gaskin back to the hock, the cannon straight down. */
  const hindleg = (x: number, dx: number, lift: number, far: boolean) => {
    const bias = far ? -1.2 : 0;
    const stifle = P(x + 2.5, 24);
    const hock = P(x - 1.5 + dx * 0.4 - lift * 0.3, 30.5 - lift * 0.8);
    const foot = P(x + dx + lift * 0.4, 39.2 - lift);
    limb(g, [P(x + 1, 16), stifle], px(8), px(5), fur, { bias });
    limb(g, [stifle, hock], px(4.4), px(2.6), fur, { bias });
    limb(g, [hock, foot], px(2.6), px(2.4), fur, { bias });
    drawHoof(foot, far);
  };

  let head: { poll: Pt; nose: Pt; lying: boolean };
  if (pose === 'lie') {
    // Lying down: a low loaf settled on the grass, a hind leg folded with its hoof showing, a foreleg tucked forward,
    // the head held up, chewing the cud.
    limb(g, [P(9, 25), P(6.5, 32), P(9, 38.5)], px(1.3), px(1.1), fur, { bias: -0.6 });
    shadedEllipse(g, 26 * s, 30 * s, 18 * s, 8.5 * s, fur, { dither, flat: 0.25, min: 1 });
    shadedEllipse(g, 16 * s, 29 * s, 8 * s, 8.5 * s, fur, { dither, min: 1 });
    shadedEllipse(g, 36 * s, 29.5 * s, 8 * s, 8 * s, fur, { dither, min: 1 });
    // Haunch, and the folded hind leg's hoof poking out under the belly.
    shadedEllipse(g, 15 * s, 31 * s, 6.5 * s, 6 * s, fur, { dither, bias: 0.3, min: 1 });
    limb(g, [P(20, 36), P(27, 38)], px(2.8), px(2.4), fur, { bias: -0.4 });
    drawHoof(P(28, 38.5), true);
    limb(g, [P(39, 36), P(47, 38.4)], px(3), px(2.5), fur, { bias: -0.2 });
    drawHoof(P(48, 38.6), false);
    // The neck rises from the shoulder.
    limb(g, [P(37, 27), P(42, 22), P(46, 19)], px(10), px(7), fur, { dither });
    if (detailed) shadedEllipse(g, 42.5 * s, 28 * s, 3 * s, 2.6 * s, fur, { dither, bias: -0.3 });
    head = { poll: P(47, 17.5), nose: P(51.5, 26.5), lying: true };
  } else {
    const walking = pose.startsWith('walk');
    const phase = walking ? (Number(pose.slice(-1)) - 1) * (Math.PI / 2) : 0;
    // Four-beat walk: near hind, near fore, far hind, far fore, a quarter-cycle apart; a foot is lifted mid-swing.
    const gait = (o: number) => {
      if (!walking) return { dx: 0, lift: 0 };
      const a = phase + o;
      return { dx: -Math.cos(a) * 2.6, lift: Math.max(0, Math.sin(a)) ** 2 * 2.4 };
    };
    const nh = gait(Math.PI / 2);
    const nf = gait(0);
    const fh = gait(-Math.PI / 2);
    const ff = gait(Math.PI);
    // Far legs first, in shadow.
    hindleg(16, fh.dx, fh.lift, true);
    foreleg(40.5, ff.dx, ff.lift, true);
    // The back: a straight line from the tail head over the hip bones to the withers (under the body, which
    // covers all but its top edge, filling the dips between the body's rounds).
    limb(g, [P(9, 12), P(17, 11), P(30, 11), P(41, 10.6)], px(4), px(4), fur, { bias: 0.6 });
    // The body: rump, barrel, chest; tops lined up so the back runs straight.
    shadedEllipse(g, 15 * s, 18.5 * s, 8 * s, 8.5 * s, fur, { dither, min: 1 });
    shadedEllipse(g, 28 * s, 19.5 * s, 16 * s, 9.5 * s, fur, { dither, flat: 0.25, min: 1 });
    shadedEllipse(g, 40 * s, 18 * s, 6.5 * s, 8 * s, fur, { dither, min: 1 });
    if (detailed) {
      g.set(Math.round(17 * s), Math.round(9.2 * s), fur[3]);
      // The udder, forward of the hind legs, and its teats.
      shadedEllipse(g, 21 * s, 28.4 * s, 2.8 * s, 2 * s, pink, { dither: false });
      g.set(Math.floor(19.8 * s), Math.floor(30.2 * s), pink[1]);
      g.set(Math.floor(22.2 * s), Math.floor(30.2 * s), pink[1]);
    }
    // Near legs.
    hindleg(13, nh.dx, nh.lift, false);
    foreleg(43.5, nf.dx, nf.lift, false);
    // The tail hangs straight down the rump to its tuft, swinging a little.
    const t = walking ? Math.sin(phase) * 1.2 : 0;
    limb(g, [P(8.5, 12), P(7 + t * 0.3, 21), P(7.2 + t, 29)], px(1.3), px(1), fur, { bias: -0.6 });
    shadedEllipse(g, (7.2 + t) * s, 31 * s, Math.max(0.6, 1.3 * s), Math.max(0.8, 2.3 * s), holstein ? fur : patch, { dither: false });
    // The neck: thick, set on the shoulders, with the dewlap hanging under it.
    const grazing = pose.startsWith('graze');
    if (grazing) {
      const bob = pose === 'graze-1' ? 0 : 1;
      limb(g, [P(39, 15), P(46, 21), P(50, 27 + bob)], px(10), px(6.5), fur, { dither });
      head = { poll: P(50.5, 27 + bob), nose: P(53.5, 38 + bob * 0.4), lying: false };
    } else {
      limb(g, [P(39, 16), P(45, 14.5), P(48.5, 14)], px(10), px(7.5), fur, { dither });
      if (detailed) limb(g, [P(42.5, 19), P(45, 23), P(46.5, 21)], px(3), px(1.4), fur, { bias: -0.5 });
      head = { poll: P(49.5, 13.5), nose: P(54, 23.5), lying: false };
    }
  }
  if (H >= 10 && holstein) {
    // Black patches: organic blobs over the white of the body, following its shading, but not down the legs.
    const cell = 7 * s;
    remap(g, fur, patch, (x, y) => y < 28 * s && valueNoise(x / cell, y / cell, 13) * 0.7 + valueNoise(x / (cell * 0.45), y / (cell * 0.45), 29) * 0.3 < 0.42);
  } else if (detailed) {
    // A paler belly line.
    const paler: Ramp = [fur[1], fur[2], fur[3], fur[4], fur[4]];
    remap(g, fur, paler, (_x, y) => y > 25 * s && y < 30 * s);
  }
  drawCowHead(g, s, head.poll, head.nose, { fur, patch, muzzle, horn, eyeInk }, coat, detailed);
  if (detailed) selOut(g, palette, { bottomHeavy: H < 24 });
  return { grid: g, palette };
}

/** The head, from the poll down to the nose: a long tapering wedge with a broad muzzle, ears out sideways, eye high up. */
function drawCowHead(
  g: PixelGrid,
  s: number,
  poll: Pt,
  nose: Pt,
  r: { fur: Ramp; patch: Ramp; muzzle: Ramp; horn: Ramp; eyeInk: number },
  coat: CowCoat,
  detailed: boolean,
): void {
  const holstein = coat === 'holstein';
  const skin = holstein ? r.patch : coat === 'jersey' ? r.patch : r.fur;
  const dx = nose[0] - poll[0];
  const dy = nose[1] - poll[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const at = (t: number, side = 0): Pt => [poll[0] + dx * t - uy * side * s, poll[1] + dy * t + ux * side * s];
  // An ear, sticking out sideways behind the poll.
  shadedEllipse(g, poll[0] - 2.2 * s, poll[1] + 0.6 * s, 3 * s, 1.3 * s, skin, { dither: false, angle: Math.atan2(uy, ux) - Math.PI / 2 - 0.25, bias: -0.4 });
  // The face: broad at the brow, narrowing to the muzzle.
  limb(g, [at(0, 0.6), at(0.55, 0.2), at(0.85)], Math.max(1, 7.6 * s), Math.max(1, 5.2 * s), skin, { bias: 0.2 });
  if (holstein && detailed) {
    // The white blaze down the front of the face.
    limb(g, [at(0.02, -1.8), at(0.5, -1.5), at(0.8, -1)], Math.max(1, 2.8 * s), Math.max(1, 2 * s), r.fur, { bias: 0.4 });
  }
  // The muzzle: broad and soft, a pale ring round a Jersey's.
  const m = at(0.92, -0.2);
  if (coat === 'jersey' && detailed) shadedEllipse(g, m[0], m[1], 3.2 * s, 2.9 * s, r.fur, { dither: false });
  shadedEllipse(g, m[0], m[1], Math.max(0.8, 2.4 * s), Math.max(0.8, 2.2 * s), r.muzzle, { dither: false, angle: Math.atan2(uy, ux) });
  if (detailed) {
    const n = at(0.98, -1.2);
    g.set(Math.floor(n[0]), Math.floor(n[1]), r.muzzle[0]);
    const e = at(0.22, 1.2);
    g.set(Math.floor(e[0]), Math.floor(e[1]), r.eyeInk);
    // Short horns curving up from the poll, on the coats that keep them.
    if (!holstein) limb(g, [[poll[0] - 0.4 * s, poll[1] - 1.8 * s], [poll[0] + 0.2 * s, poll[1] - 3.6 * s], [poll[0] + 1.2 * s, poll[1] - 4.4 * s]], Math.max(1, 1.3 * s), Math.max(1, 0.8 * s), r.horn, { max: 4 });
  }
}

export class CowSpriteCache {
  private readonly cache = new DrawnCache();

  get(coat: CowCoat, pose: CowPose, height: number): Texture {
    const h = evenSize(height, 6);
    const key = `${coat}:${pose}:${h}`;
    return this.cache.get(key, () => drawCowSized(coat, pose, h));
  }
}

// --- Chickens -----------------------------------------------------------

export type ChickenPose = 'stand' | 'peck' | 'walk' | 'walk-2' | 'scratch' | 'flap';
export type ChickenCoat = 'white' | 'brown' | 'black';

const CHICKEN_COATS: Record<ChickenCoat, { body: number; tail: number; wing: number }> = {
  white: { body: 0xf2eee4, tail: 0xdcd6c8, wing: 0xd8d0c0 },
  brown: { body: 0xb8702e, tail: 0x2a3a2a, wing: 0x8a4a1e },
  black: { body: 0x2e2e36, tail: 0x1e2a26, wing: 0x24242c },
};

/**
 * A hen facing right, `height` px tall (about as wide), feet on the bottom
 * row: round shaded body, tail feathers cocked up behind, wing, red comb and
 * wattle, beak, eye and scaly yellow legs. Pecking, walking, scratching or
 * flapping.
 */
export function drawChickenSized(coat: ChickenCoat, pose: ChickenPose, height: number): Drawn {
  const H = Math.max(6, Math.round(height));
  const W = Math.round(H * 1.15);
  const g = new PixelGrid(W, H);
  const s = H / 20;
  const style = CHICKEN_COATS[coat];
  const palette = new Palette();
  const body = palette.ramp(style.body, coat === 'white' ? 0.7 : 1);
  const tail = palette.ramp(style.tail);
  const wing = palette.ramp(style.wing);
  const comb = palette.ramp(0xd8382a);
  const beak = palette.ramp(0xe8a830);
  const legs = palette.ramp(0xe0a030);
  const eyeInk = palette.add(0x0c0a0a);
  const big = H >= 12;
  const pecking = pose === 'peck';
  const lean = pecking ? 0.5 : 0;
  // Legs and toes.
  const legTop = 15 * s;
  const ground = H - 0.5;
  const legX: Array<[number, number]> =
    pose === 'walk' ? [[9, 7.5], [12, 13.5]] : pose === 'walk-2' ? [[9, 11], [12, 10]] : pose === 'scratch' ? [[9, 6], [12, 12]] : [[9.5, 9.5], [12, 12]];
  legX.forEach(([top, foot], i) => {
    const lifted = pose === 'scratch' && i === 0;
    const fy = lifted ? ground - 1.5 * s : ground;
    limb(g, [[top * s, legTop], [foot * s, fy]], Math.max(1, 1.2 * s), Math.max(1, 1 * s), legs, { bias: i === 0 ? -1 : 0, max: 3 });
    if (big) for (let k = -1; k <= 2; k++) g.set(Math.floor(foot * s + k * s * 0.8), Math.floor(fy), legs[i === 0 ? 1 : 2]);
  });
  // Tail feathers, fanned up behind.
  const tailUp = pose === 'flap' ? -1 : 0;
  shadedEllipse(g, 4.5 * s, (7 + tailUp) * s, 3 * s, 5 * s, tail, { dither: false, angle: -0.5 });
  if (big && coat === 'brown') limb(g, [[5 * s, 6 * s], [2 * s, 4 * s], [1.5 * s, 9 * s]], 1.5 * s, 1, tail, { bias: 0.5 });
  // Body: a round, plump egg, tipping forward to peck.
  shadedEllipse(g, 10 * s, 11.5 * s, 7.5 * s, 5 * s, body, { dither: H >= 18, angle: lean * 0.6 });
  // Breast.
  shadedEllipse(g, 14 * s, (10 + lean * 2) * s, 3.5 * s, 3.8 * s, body, { dither: false });
  // Wing: folded on the flank, or raised to flap.
  if (pose === 'flap') shadedEllipse(g, 9 * s, 6 * s, 5 * s, 3 * s, wing, { dither: false, angle: -0.4 });
  else shadedEllipse(g, 9.5 * s, 11.5 * s, 4.5 * s, 2.6 * s, wing, { dither: false, angle: 0.15 + lean * 0.5, bias: -0.3 });
  // Head: up, or down at the ground.
  const hx = pecking ? 18 : 15.5;
  const hy = pecking ? 15.5 : 4.5;
  if (!pecking) limb(g, [[13.5 * s, 9 * s], [hx * s, (hy + 1) * s]], 3.6 * s, 3 * s, body, { bias: 0.3 });
  else limb(g, [[15 * s, 11 * s], [hx * s, (hy - 1) * s]], 3.6 * s, 3 * s, body, { bias: 0.3 });
  shadedEllipse(g, hx * s, hy * s, 2.4 * s, 2.3 * s, body, { dither: false });
  // Comb on top, wattle under the beak.
  const up = pecking ? -1 : 1;
  for (let k = 0; k < 3; k++) {
    const cx = (hx - 1.4 + k * 1.2) * s;
    const cy = (hy - 2.4 * up - (k === 1 ? 0.6 : 0) * up) * s;
    if (big) shadedEllipse(g, cx, cy, Math.max(0.6, 0.8 * s), Math.max(0.6, 0.9 * s), comb, { dither: false, max: 3 });
    else if (k === 1) g.set(Math.floor(cx), Math.floor(cy), comb[2]);
  }
  if (big) shadedEllipse(g, (hx + 1.4) * s, (hy + 2.2 * up) * s, Math.max(0.6, 0.7 * s), Math.max(0.8, 1.1 * s), comb, { dither: false, max: 3 });
  // Beak.
  const bx = hx + 2.3;
  for (let k = 0; k < Math.max(1, Math.round(1.6 * s)); k++) g.set(Math.floor((bx + k * 0.8) * s), Math.floor((hy + 0.2 * up) * s), beak[k === 0 ? 3 : 2]);
  // Eye.
  g.set(Math.floor((hx + 0.6) * s), Math.floor((hy - 0.4 * up) * s), eyeInk);
  if (big) selOut(g, palette, { bottomHeavy: H < 16 });
  return { grid: g, palette };
}

export class ChickenSpriteCache {
  private readonly cache = new DrawnCache();

  get(coat: ChickenCoat, pose: ChickenPose, height: number): Texture {
    const h = evenSize(height, 6);
    const key = `${coat}:${pose}:${h}`;
    return this.cache.get(key, () => drawChickenSized(coat, pose, h));
  }
}

// --- Rabbits ------------------------------------------------------------

export type RabbitPose = 'sit' | 'alert' | 'groom' | 'hop-1' | 'hop-2' | 'hop-3' | 'peek';
export const RABBIT_HOP: readonly RabbitPose[] = ['hop-1', 'hop-2', 'hop-3'];

/**
 * A wild rabbit facing right, `height` px tall and 1.3× as wide, feet on the
 * bottom row: long ears with pink insides, a round haunch, a white cotton
 * tail, a dark eye with a glint. Sitting, sitting up alert, washing its
 * face, hopping (three frames), or just its head peeking from cover.
 */
export function drawRabbitSized(pose: RabbitPose, height: number, species: 'rabbit' | 'hare' = 'rabbit'): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.3);
  const g = new PixelGrid(W, H);
  const s = H / 16;
  const palette = new Palette();
  const hare = species === 'hare';
  // A hare is tawnier, with longer, black-tipped ears.
  const fur = palette.ramp(hare ? 0xae8456 : 0x9a7c60);
  const tips = hare ? palette.ramp(0x2a2018) : null;
  const earLen = hare ? 8 : 6.5;
  const belly = palette.ramp(0xd8c8b0, 0.7);
  const ear = palette.ramp(0xd89890);
  const white = palette.ramp(0xf4f0ea, 0.5);
  const eyeInk = palette.add(0x140e0c);
  const glint = palette.add(0xf4f0ea);
  const big = H >= 10;
  const dither = false;

  // Pose: body centre and size, head position, ear angle, front and hind legs.
  type Shape = { body: [number, number, number, number, number]; head: Pt; ears: number; front: Pt[]; hind: Pt[] | null; tail: Pt };
  const shapes: Record<Exclude<RabbitPose, 'peek'>, Shape> = {
    sit: { body: [8, 11.5, 6, 4.5, -0.15], head: [14, 7.5], ears: -0.35, front: [[13, 12], [13.5, 15.5]], hind: null, tail: [2.5, 11] },
    alert: { body: [8.5, 10, 4.5, 5.5, -0.7], head: [12.5, 4.5], ears: -0.1, front: [[12, 9], [12.5, 15.5]], hind: null, tail: [4, 13.5] },
    groom: { body: [8, 11.5, 6, 4.5, -0.25], head: [13.5, 8], ears: -0.6, front: [[13, 11], [14.8, 8.8]], hind: null, tail: [2.5, 11] },
    'hop-1': { body: [9, 10, 7.5, 3.5, 0.1], head: [16, 8], ears: -0.95, front: [[14, 11], [18, 14.5]], hind: [[5, 11], [1, 13.5]], tail: [2, 8.5] },
    'hop-2': { body: [10, 8.5, 7, 3.6, -0.15], head: [16.5, 6], ears: -0.85, front: [[15, 10], [17.5, 12]], hind: [[6, 10], [3, 12.5]], tail: [3, 7] },
    'hop-3': { body: [9, 11, 6.5, 4, 0.25], head: [15, 9.5], ears: -0.7, front: [[13, 12], [14, 15.5]], hind: [[6, 12], [10, 15.5]], tail: [2.5, 9.5] },
  };
  if (pose === 'peek') {
    // Just a head and ears above the cover's edge.
    drawRabbitHead(g, s, 12, 12.5, -0.2, { fur, ear, eyeInk, glint, earLen, tips }, big);
  } else {
    const sh = shapes[pose];
    const [bx, by, brx, bry, ba] = sh.body;
    // Far ear behind the head.
    rabbitEar(g, s, sh.head, sh.ears - 0.25, fur, ear, true, earLen, tips);
    // Hind leg (when stretched out), then the body, the haunch, the belly.
    if (sh.hind) limb(g, [[sh.hind[0][0] * s, sh.hind[0][1] * s], [sh.hind[1][0] * s, sh.hind[1][1] * s]], 2.4 * s, 1.6 * s, fur, { bias: -0.6 });
    shadedEllipse(g, bx * s, by * s, brx * s, bry * s, fur, { dither, angle: ba });
    if (!sh.hind) {
      shadedEllipse(g, (bx - brx * 0.35) * s, (by + bry * 0.25) * s, brx * 0.6 * s, bry * 0.9 * s, fur, { dither });
      // A long hind foot along the ground.
      for (let x = Math.floor((bx - brx * 0.3) * s); x <= Math.floor((bx + brx * 0.45) * s); x++) g.set(x, H - 1, fur[1]);
    }
    if (big) remap(g, fur, belly, (x, y) => y > (by + bry * 0.45) * s && x > (bx - brx * 0.1) * s);
    // Front leg.
    limb(g, [[sh.front[0][0] * s, sh.front[0][1] * s], [sh.front[1][0] * s, sh.front[1][1] * s]], 1.6 * s, 1.3 * s, fur, { bias: 0.2 });
    // Cotton tail.
    shadedEllipse(g, sh.tail[0] * s, sh.tail[1] * s, Math.max(0.7, 1.4 * s), Math.max(0.7, 1.3 * s), white, { dither: false });
    drawRabbitHead(g, s, sh.head[0], sh.head[1], sh.ears, { fur, ear, eyeInk, glint, earLen, tips }, big);
  }
  if (big) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

function rabbitEar(g: PixelGrid, s: number, head: Pt, angle: number, fur: Ramp, inner: Ramp, far: boolean, len = 6.5, tips: Ramp | null = null): void {
  // Ears sweep up and back from the crown; `angle` 0 is straight up, negative leans back.
  const bx = head[0] - 1;
  const by = head[1] - 1.2;
  const tip: Pt = [(bx + Math.sin(angle) * len) * s, (by - Math.cos(angle) * len) * s];
  limb(g, [[bx * s, by * s], tip], 1.8 * s, 1.2 * s, fur, { bias: far ? -1 : 0 });
  if (tips) {
    const k = len - 1.6;
    limb(g, [[(bx + Math.sin(angle) * k) * s, (by - Math.cos(angle) * k) * s], tip], 1.3 * s, 1.1 * s, tips, { bias: far ? -1 : 0 });
  }
  if (!far && s >= 0.8) limb(g, [[(bx + 0.2) * s, (by - 0.8) * s], [(bx + Math.sin(angle) * (len - 1.5)) * s, (by - Math.cos(angle) * (len - 1.5)) * s]], 0.8 * s, 0.6 * s, inner, { max: 3 });
}

function drawRabbitHead(
  g: PixelGrid,
  s: number,
  hx: number,
  hy: number,
  ears: number,
  r: { fur: Ramp; ear: Ramp; eyeInk: number; glint: number; earLen: number; tips: Ramp | null },
  big: boolean,
): void {
  shadedEllipse(g, hx * s, hy * s, 2.9 * s, 2.5 * s, r.fur, { dither: false, angle: 0.25 });
  rabbitEar(g, s, [hx, hy], ears, r.fur, r.ear, false, r.earLen, r.tips);
  // Eye with a glint, and a pink nose.
  const ex = Math.floor((hx + 0.4) * s);
  const ey = Math.floor((hy - 0.6) * s);
  if (big && s >= 1) {
    g.set(ex, ey, r.eyeInk);
    g.set(ex, ey + 1, r.eyeInk);
    g.set(ex + 1, ey, r.eyeInk);
    g.set(ex, ey, r.glint);
  } else g.set(ex, ey, r.eyeInk);
  if (big) g.set(Math.floor((hx + 2.6) * s), Math.floor((hy + 0.4) * s), r.ear[2]);
}

export class RabbitSprites {
  private readonly cache = new DrawnCache();

  get(pose: RabbitPose, height: number, species: 'rabbit' | 'hare' = 'rabbit'): Texture {
    const h = evenSize(height, 6);
    const key = `${species}:${pose}:${h}`;
    return this.cache.get(key, () => drawRabbitSized(pose, h, species));
  }
}

// --- Creek fish, seen from above ----------------------------------------

export type FishKind = 'trout' | 'minnow';

/** Headings the creek fish are drawn at (they turn crisply between them). */
export const TOP_FISH_HEADINGS = 16;

const TOP_FISH: Record<FishKind, { length: number; width: number; back: number; spots: boolean }> = {
  trout: { length: 15, width: 2.2, back: 0x56664c, spots: true },
  minnow: { length: 8, width: 1.2, back: 0x5a6a68, spots: false },
};

/**
 * A fish from above, head towards `heading` (one of TOP_FISH_HEADINGS steps
 * round from +x): a dark spine (spotted on a trout) shading to paler flanks,
 * a body that bends as the tail flicks between two frames, a forked tail,
 * pectoral fins and a glint off the head. `shadow` gives just its silhouette,
 * to lay faintly on the creek bed below it.
 */
export function drawTopFishSized(kind: FishKind, heading: number, frame: 0 | 1, shadow = false): Drawn {
  const spec = TOP_FISH[kind];
  const L = spec.length;
  const W = spec.width;
  const size = Math.ceil(L * 1.45) + 2;
  const g = new PixelGrid(size, size);
  const palette = new Palette();
  const back = palette.ramp(spec.back, 1.1);
  const spot = palette.add(0x1c2218);
  const glint = palette.add(0xdce8e0);
  const ink = palette.add(0x000000);
  const a = (heading / TOP_FISH_HEADINGS) * Math.PI * 2;
  const c = size / 2;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const flick = (frame === 0 ? 1 : -1) * W * 0.55;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const along = dx * ux + dy * uy;
      // The body bends towards the tail as it swims.
      const t = along / (L * 0.5);
      const bend = t < -0.2 ? (t + 0.2) / 1.2 : 0;
      const across = -dx * uy + dy * ux - flick * bend * bend * 2;
      let color = 0;
      if (t >= -1 && t <= 1) {
        // Thickest just behind the head, tapering to the tail.
        const hw = t > 0.3 ? W * Math.sqrt(Math.max(0, 1 - ((t - 0.3) / 0.72) ** 2)) : W * (0.42 + 0.58 * Math.sqrt((t + 1) / 1.3));
        const v = Math.abs(across) / Math.max(0.3, hw);
        if (v <= 1) {
          if (spec.spots && v < 0.8 && t > -0.75 && t < 0.55 && pixelHash(Math.floor(t * L * 0.6), Math.floor(across * 1.4 + 9), 5) < 0.2) color = spot;
          else color = back[v < 0.45 ? 1 : across < 0 === ux - uy > 0 ? 3 : 2];
        } else if (kind === 'trout' && t > 0.25 && t < 0.5 && v < 1.9 && Math.abs(t - 0.38 - (v - 1) * 0.12) < 0.06) color = back[2];
      } else if (t < -1 && t > -1.38) {
        // A forked tail fanning out.
        const k = (-t - 1) / 0.38;
        const hw = W * (0.35 + 0.9 * k);
        const notch = k > 0.55 ? W * 0.7 * (k - 0.55) / 0.45 : 0;
        if (Math.abs(across) <= hw && Math.abs(across) >= notch) color = back[1];
      }
      if (color) g.set(x, y, shadow ? ink : color);
    }
  }
  if (!shadow) g.set(Math.floor(c + ux * L * 0.32 - uy * 0.6), Math.floor(c + uy * L * 0.32 + ux * 0.6), glint);
  return { grid: g, palette };
}

export class TopFishSprites {
  private readonly cache = new DrawnCache();

  get(kind: FishKind, heading: number, frame: 0 | 1, shadow = false): Texture {
    const h = ((Math.round(heading) % TOP_FISH_HEADINGS) + TOP_FISH_HEADINGS) % TOP_FISH_HEADINGS;
    const key = `${kind}:${h}:${frame}:${shadow}`;
    return this.cache.get(key, () => drawTopFishSized(kind, h, frame, shadow));
  }
}

// --- Sheep ----------------------------------------------------------------------

export type SheepPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'graze-1' | 'graze-2' | 'stand' | 'lie';
export const SHEEP_WALK: readonly SheepPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];

/**
 * A black-faced sheep in profile facing right, `height` px tall and 1.4× as
 * wide: a curly, cloud-lumped fleece, black face and ears, thin black legs.
 * Authored in a 42×30 box.
 */
export function drawSheepSized(pose: SheepPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.4);
  const g = new PixelGrid(W, H);
  const s = H / 30;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const wool = palette.ramp(0xe6dfd0, 0.7);
  const face = palette.ramp(0x2e2a28);
  const eye = palette.add(0xb8a070);
  const walking = pose.startsWith('walk');
  const lying = pose === 'lie';
  const phase = walking ? (Number(pose.slice(-1)) - 1) * (Math.PI / 2) : 0;
  const sw = (o: number) => (walking ? Math.sin(phase + o) * 2.2 : 0);
  const legW = Math.max(1, 1.8 * s);
  const leg = (x: number, o: number, far: boolean) => limb(g, [P(x, 19), P(x + sw(o), 29.5)], legW, legW * 0.9, face, { bias: far ? -0.8 : 0 });
  const by = lying ? 21 : 15;
  if (!lying) {
    leg(29, Math.PI, true);
    leg(12, 0, true);
  }
  // The fleece: a lumpy cloud, curls picked out in light and shade.
  for (const [cx, cy, rx, ry] of [[12, by, 8, 7], [20, by - 1.5, 9, 8], [28, by, 7.5, 7], [20, by + 2, 11, 6]] as const) {
    g.ellipse(cx * s, cy * s, rx * s, ry * s, (u, v, x, y) => {
      const lit = -u * 0.5 - v * 0.7;
      const curl = pixelHash(Math.floor(x / Math.max(1, 1.5 * s)), Math.floor(y / Math.max(1, 1.5 * s)), 9) < 0.3 ? -1 : 0;
      return wool[Math.max(1, Math.min(4, (lit > 0.45 ? 4 : lit > -0.1 ? 3 : 2) + curl))];
    });
  }
  if (!lying) {
    leg(31, 0, false);
    leg(10, Math.PI, false);
  } else {
    // Legs folded under, a hoof showing.
    g.set(Math.floor(30 * s), Math.floor(28.5 * s), face[1]);
  }
  // Head: up, or down in the grass.
  const grazing = pose.startsWith('graze');
  const [hx, hy, ang] = grazing ? [36, pose === 'graze-1' ? 25 : 26, 1.1] : lying ? [35, 15, 0.35] : [36, 10, 0.4];
  limb(g, [P(30, by - 2), P(hx - 2, hy)], 5 * s, 4 * s, wool, { bias: 0.3 });
  shadedEllipse(g, hx * s, hy * s, 3.4 * s, 2.4 * s, face, { dither: false, angle: ang });
  // Ears out to the side.
  limb(g, [P(hx - 2, hy - 1.5), P(hx - 5, hy - 0.5 + (grazing ? -1.5 : 0))], 1.6 * s, 1 * s, face, { bias: 0.3 });
  if (H >= 12) g.set(Math.floor((hx + 0.6) * s), Math.floor((hy - 0.8 + (grazing ? 0.8 : 0)) * s), eye);
  if (H >= 12) selOut(g, palette, { bottomHeavy: H < 20 });
  return { grid: g, palette };
}

// --- The sheepdog -------------------------------------------------------------------

export type DogPose = 'run-1' | 'run-2' | 'trot-1' | 'trot-2' | 'crouch' | 'sit' | 'lie';

/** A black-and-white border collie in profile facing right, `height` px tall, 1.5× as wide. Authored in a 36×24 box. */
export function drawDogSized(pose: DogPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.5);
  const g = new PixelGrid(W, H);
  const s = H / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const black = palette.ramp(0x26242a);
  const white = palette.ramp(0xf0ece4, 0.5);
  const eye = palette.add(0x8a5a2a);
  const lw = Math.max(1, 1.8 * s);
  const leg = (path: Pt[], far: boolean) => limb(g, path, lw * 1.2, lw, far ? black : white, { bias: far ? -0.8 : 0 });
  const run = pose === 'run-1' ? 0 : pose === 'run-2' ? 1 : -1;
  const trot = pose === 'trot-1' ? 0 : pose === 'trot-2' ? 1 : -1;
  if (pose === 'sit') {
    limb(g, [P(10, 21), P(4, 23)], 3 * s, 2 * s, black);
    shadedEllipse(g, 14 * s, 15 * s, 5 * s, 6.5 * s, black, { dither: false, angle: -0.5 });
    shadedEllipse(g, 18 * s, 13 * s, 3 * s, 4.5 * s, white, { dither: false, max: 3 });
    leg([P(19, 15), P(20, 23.5)], false);
    shadedEllipse(g, 21 * s, 6.5 * s, 3.4 * s, 2.8 * s, black, { dither: false });
    limb(g, [P(22, 7.5), P(26, 8.5)], 2.4 * s, 1.2 * s, white);
    limb(g, [P(19, 5), P(18, 2)], 1.8 * s, 0.8 * s, black);
    if (H >= 12) g.set(Math.floor(22 * s), Math.floor(6 * s), eye);
  } else {
    const low = pose === 'crouch' ? 4 : pose === 'lie' ? 7 : 0;
    const by = 12 + low;
    // Far legs.
    if (run === 0) {
      leg([P(26, by + 2), P(31, by + 6), P(34, by + 9)], true);
      leg([P(10, by + 2), P(5, by + 6), P(2, by + 8)], true);
    } else if (run === 1) {
      leg([P(26, by + 2), P(24, by + 7), P(21, by + 11)], true);
      leg([P(10, by + 2), P(13, by + 7), P(16, by + 11)], true);
    } else if (pose !== 'lie') {
      leg([P(25, by + 2), P(25 + (trot === 0 ? 2 : -1), 23.5)], true);
      leg([P(10, by + 2), P(10 + (trot === 0 ? -1 : 2), 23.5)], true);
    }
    // Tail streaming out behind, white-tipped.
    limb(g, [P(5, by - 1), P(1, by + (run >= 0 ? -1 : 3))], 2.6 * s, 2 * s, black);
    g.set(Math.floor(1 * s), Math.floor((by + (run >= 0 ? -1 : 3)) * s), white[3]);
    // Body: black back, white chest and collar.
    shadedEllipse(g, 16 * s, by * s, 10 * s, 4 * s, black, { dither: false, min: 1 });
    shadedEllipse(g, 24 * s, (by + 1.5) * s, 3 * s, 3 * s, white, { dither: false, max: 3 });
    // Near legs (white socks).
    if (run === 0) {
      leg([P(24, by + 2), P(29, by + 7), P(32, by + 10)], false);
      leg([P(12, by + 2), P(7, by + 7), P(4, by + 9)], false);
    } else if (run === 1) {
      leg([P(24, by + 2), P(22, by + 8), P(19, by + 11)], false);
      leg([P(12, by + 2), P(15, by + 8), P(18, by + 11)], false);
    } else if (pose === 'lie') {
      limb(g, [P(24, 21), P(31, 22.5)], lw, lw, white);
    } else {
      leg([P(23, by + 2), P(23 + (trot === 0 ? -1 : 2), 23.5)], false);
      leg([P(12, by + 2), P(12 + (trot === 0 ? 2 : -1), 23.5)], false);
    }
    // Head, held low when stalking the flock.
    const [hx, hy] = pose === 'crouch' ? [29, by] : pose === 'lie' ? [28, by - 2] : [28, by - 4];
    shadedEllipse(g, hx * s, hy * s, 3.4 * s, 2.8 * s, black, { dither: false });
    limb(g, [P(hx + 1, hy + 1), P(hx + 5, hy + 2)], 2.4 * s, 1.2 * s, white);
    g.set(Math.floor((hx + 5.2) * s), Math.floor((hy + 1.6) * s), black[0]);
    limb(g, [P(hx - 2, hy - 1.5), P(hx - 3, hy - 4.5)], 1.8 * s, 0.8 * s, black);
    if (H >= 12) g.set(Math.floor((hx + 1) * s), Math.floor((hy - 0.6) * s), eye);
  }
  if (H >= 12) selOut(g, palette, { bottomHeavy: H < 18 });
  return { grid: g, palette };
}

// --- The horse -------------------------------------------------------------------------

export type HorsePose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'graze-1' | 'graze-2' | 'stand' | 'swish';
export const HORSE_WALK: readonly HorsePose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];

/**
 * A bay horse in profile facing right, `height` px tall and 1.3× as wide:
 * a deep chest, long neck and head, black mane, tail and lower legs, and a
 * white blaze. Grazing, walking, standing and swishing its tail at flies.
 * Authored in a 52×40 box.
 */
export function drawHorseSized(pose: HorsePose, height: number): Drawn {
  const H = Math.max(6, Math.round(height));
  const W = Math.round(H * 1.3);
  const g = new PixelGrid(W, H);
  const s = H / 40;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const coat = palette.ramp(0x8a4a26);
  const black = palette.ramp(0x2a1e1a);
  const blaze = palette.ramp(0xf0e8dc, 0.5);
  const eye = palette.add(0x0c0808);
  const walking = pose.startsWith('walk');
  const phase = walking ? (Number(pose.slice(-1)) - 1) * (Math.PI / 2) : 0;
  const sw = (o: number) => (walking ? Math.sin(phase + o) * 3.2 : 0);
  const lift = (o: number) => (walking ? Math.max(0, Math.cos(phase + o)) * 2 : 0);
  const legW = Math.max(1, 2.8 * s);
  const leg = (top: Pt, knee: Pt, foot: Pt, far: boolean) => {
    limb(g, [top, knee], legW * 1.4, legW, coat, { bias: far ? -1.2 : 0 });
    limb(g, [knee, foot], legW, legW * 0.9, black, { bias: far ? -0.8 : 0 });
  };
  leg(P(38, 24), P(38.5 + sw(Math.PI) * 0.4, 31 - lift(Math.PI)), P(38 + sw(Math.PI), 39.5 - lift(Math.PI) * 0.4), true);
  leg(P(14, 24), P(12 + sw(0) * 0.4, 31 - lift(0)), P(13 + sw(0), 39.5 - lift(0) * 0.4), true);
  // Tail: hanging, or swished out sideways.
  const swish = pose === 'swish';
  limb(g, swish ? [P(8, 14), P(3, 19), P(1, 25)] : [P(8, 14), P(6, 22), P(6.5, 30)], 3 * s, 2.4 * s, black, { bias: 0.2 });
  // Body: quarters, barrel, a deep chest.
  shadedEllipse(g, 14 * s, 18 * s, 8 * s, 8 * s, coat, { dither: false, min: 1 });
  shadedEllipse(g, 25 * s, 19 * s, 14 * s, 7.5 * s, coat, { dither: false, min: 1, flat: 0.2 });
  shadedEllipse(g, 36 * s, 18 * s, 7 * s, 8.5 * s, coat, { dither: false, min: 1 });
  leg(P(40, 24), P(40.5 + sw(0) * 0.4, 31 - lift(0)), P(40 + sw(0), 39.5 - lift(0) * 0.4), false);
  leg(P(12, 24), P(10 + sw(Math.PI) * 0.4, 31 - lift(Math.PI)), P(11 + sw(Math.PI), 39.5 - lift(Math.PI) * 0.4), false);
  // Neck and head, up or down to the grass; the mane along the crest.
  const grazing = pose.startsWith('graze');
  const head: Pt = grazing ? [47, pose === 'graze-1' ? 34 : 35.5] : [47, 6];
  const angle = grazing ? 1.35 : 0.85;
  const crest: Pt[] = grazing ? [P(36, 12), P(43, 20), P(46, 29)] : [P(36, 12), P(40, 6), P(44, 3)];
  limb(g, grazing ? [P(36, 15), P(43, 24), P(46, 31)] : [P(35, 16), P(41, 9), P(45, 5)], 12 * s, 7 * s, coat, { bias: 0.2 });
  limb(g, crest, 2.2 * s, 1.6 * s, black);
  shadedEllipse(g, (head[0] + Math.cos(angle) * 1.2) * s, (head[1] + Math.sin(angle) * 1.2) * s, 6.4 * s, 3.4 * s, coat, { dither: false, angle });
  if (H >= 14) {
    // The blaze down the face, an eye, an ear.
    const bx = head[0] + Math.cos(angle) * 1.5;
    const by = head[1] + Math.sin(angle) * 1.5;
    limb(g, [[bx * s, by * s], [(bx + Math.cos(angle) * 3) * s, (by + Math.sin(angle) * 3) * s]], 1 * s, 1 * s, blaze, { max: 3 });
    g.set(Math.floor((head[0] - 1.2) * s), Math.floor((head[1] - 0.8) * s), eye);
    limb(g, [P(head[0] - 3, head[1] - 2), P(head[0] - 3.6, head[1] - 4.8)], 1.6 * s, 0.8 * s, coat, { bias: -0.4 });
  }
  if (H >= 14) selOut(g, palette, { bottomHeavy: H < 24 });
  return { grid: g, palette };
}


// --- Scarecrow ----------------------------------------------------------------

/**
 * The scarecrow in the vegetable patch, `height` px to the soil (the box is
 * 2 px deeper, the post sunk in it): a red plaid coat in checks big enough
 * to read, lit from the left and flaring at the hem with straw poking out;
 * sleeves along the crossbar ending in straw tufts, drooping (frame 0) or
 * flapping one way and the other (1, 2) in the wind; a stuffed sacking head
 * with stitched eyes and grin; and a wide straw hat with a red band.
 */
export function drawScarecrow(height: number, frame: number): Drawn {
  const H = Math.max(9, Math.round(height));
  const s = H / 40;
  const W = Math.round(34 * s) + 4;
  const g = new PixelGrid(W, H + 2);
  const palette = new Palette();
  const wood = palette.ramp(0x6a5034, 0.8);
  const coat = palette.ramp(0xa83a2e, 0.8);
  const navy = palette.add(0x2e3248);
  const straw = palette.ramp(0xd8b850, 0.7);
  const sack = palette.ramp(0xc8ae80, 0.6);
  const stitch = palette.add(0x2a2018);
  const band = palette.add(0x7a2420);
  const cx = Math.round(W / 2);
  const plaid = Math.max(2, Math.round(2.6 * s));
  /** The coat's plaid at a pixel, shaded by how far round the body it is (−1 left … 1 right). */
  const cloth = (x: number, y: number, nx: number) => {
    const shade = nx < -0.45 ? 3 : nx > 0.5 ? 1 : 2;
    const check = (Math.floor(x / plaid) + Math.floor(y / plaid)) % 2 === 0;
    if (H >= 20 ? x % (plaid * 2) === 0 || y % (plaid * 2) === 0 : (x + y) % 3 === 0) return navy;
    // Small, the checks go lighter rather than darker so the coat stays red.
    return coat[H >= 20 ? Math.max(0, shade - (check ? 1 : 0)) : Math.min(4, shade + (check ? 1 : 0))];
  };
  // The post, down into the soil.
  limb(g, [[cx + 0.5, 16 * s], [cx + 0.5, H + 1.5]], Math.max(1, 1.6 * s), Math.max(1, 1.4 * s), wood);
  // Sleeves along the crossbar, drooping or flapping, straw tufts at the cuffs.
  const coatTop = Math.round(14 * s);
  const coatBottom = Math.round(29 * s);
  const half = Math.max(2, Math.round(5 * s));
  const armY = coatTop + 1;
  const reach = Math.round(15 * s);
  const thick = Math.max(1, Math.round(2.4 * s));
  for (const side of [-1, 1]) {
    const lift = frame === 0 ? 1.2 : (frame === 1 ? side : -side) * -1.6;
    const cuff: [number, number] = [cx + 0.5 + side * reach, armY + thick / 2 + lift];
    const elbow: [number, number] = [cx + 0.5 + side * reach * 0.55, armY + thick / 2 + lift * 0.4];
    const mask = new PixelGrid(W, H + 2);
    limb(mask, [[cx + 0.5 + side * half * 0.6, armY + thick / 2], elbow, cuff], thick + 0.6, thick, [1, 1, 1, 1, 1]);
    for (let y = 0; y < H + 2; y++) for (let x = 0; x < W; x++) if (mask.get(x, y)) g.set(x, y, cloth(x, y, y < armY + thick / 2 ? -0.6 : 0.6));
    for (const [dx, dy] of [[1, -1], [1, 0], [1, 1], [2, 0]] as const) g.set(Math.round(cuff[0] + side * dx - 0.5), Math.round(cuff[1] + dy - 0.5), straw[dy === 0 ? 3 : 2]);
  }
  // The coat, flaring to the hem.
  for (let y = coatTop; y < coatBottom; y++) {
    const flare = ((y - coatTop) / (coatBottom - coatTop)) * 1.5 * s;
    const w = half + flare;
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) g.set(x, y, cloth(x, y, (x + 0.5 - cx) / w));
  }
  if (H >= 24) for (let y = coatTop + 2; y < coatBottom - 1; y += Math.max(2, plaid)) g.set(cx, y, straw[4]);
  // Straw at the hem, hanging in wisps.
  for (let x = Math.round(cx - half - 1); x <= Math.round(cx + half + 1); x++) {
    if ((x + frame) % 2 === 0) continue;
    g.set(x, coatBottom, straw[3]);
    if (H >= 20 && x % 3 === 0) g.set(x, coatBottom + 1, straw[2]);
  }
  // The stuffed sacking head, stitched eyes and grin.
  const hy = 9 * s;
  const hr = Math.max(2.4, 3.7 * s);
  shadedEllipse(g, cx + 0.5, hy, hr, hr * 1.05, sack, { dither: H >= 30 });
  if (H >= 14) {
    const ey = Math.round(hy - 0.2 * s);
    for (const side of [-1, 1]) g.set(Math.round(cx + side * Math.max(1, 1.3 * s)), ey, stitch);
    if (H >= 22) for (let k = -1; k <= 1; k++) g.set(Math.round(cx + k * 1.2 * s), Math.round(hy + 1.6 * s) - (k === 0 ? 0 : 1), stitch);
  }
  // The wide straw hat: brim lit along its top, the crown shaded, a red band round it.
  const brim = hr + Math.max(2, 3 * s);
  const brimY = Math.round(hy - hr + (H >= 20 ? 1 : 0.4));
  for (let x = Math.round(cx - brim); x <= Math.round(cx + brim); x++) g.set(x, brimY, straw[x < cx ? 3 : 2]);
  const crownTop = Math.round(hy - hr - Math.max(1, 2.5 * s));
  for (let y = crownTop; y < brimY; y++) {
    for (let x = Math.round(cx - hr + 1); x <= Math.round(cx + hr - 1); x++) g.set(x, y, y === brimY - 1 && H >= 18 ? band : straw[x < cx ? 4 : 2]);
  }
  selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}
