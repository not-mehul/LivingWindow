import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
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
  holstein: { coat: 0xeeece4, patch: 0x2a2624, muzzle: 0xe0a8a0 },
  jersey: { coat: 0xc08a54, patch: 0x8a5a30, muzzle: 0x3a2a24 },
  brown: { coat: 0x7a4a2a, patch: 0x4a2a16, muzzle: 0xd8a890 },
};

/**
 * A cow in profile facing right, (1.5·H)×H, hooves on the bottom row: a
 * shaded barrel of a body, jointed legs with hocks and hooves, udder, tail
 * with its tuft, ear, horns and a muzzle; a Holstein's patches lie over it.
 * Authored in a 60×40 box.
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
  const pink = palette.ramp(0xe0a0a0);
  const horn = palette.ramp(0xd8ccb0);
  const hoof = palette.ramp(0x2e2622);
  const eyeInk = palette.add(0x140e0c);
  const detailed = H >= 16;
  // Flat bands of shade read better on a coat than dithering.
  const dither = false;
  const legW = Math.max(1, 3.6 * s);

  const leg = (top: Pt, joint: Pt, foot: Pt, far: boolean) => {
    const bias = far ? -1.2 : 0;
    limb(g, [top, joint], legW * 1.35, legW, fur, { bias });
    limb(g, [joint, foot], legW, legW * 0.85, fur, { bias });
    const hw = Math.max(1, Math.round(2.6 * s));
    const hh = Math.max(1, Math.round(1.6 * s));
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) g.set(Math.floor(foot[0] - hw / 2) + x, H - hh + y, hoof[far ? 1 : y === 0 ? 3 : 2]);
  };

  if (pose === 'lie') {
    // Lying down: a low loaf with legs folded under, head up and chewing the cud.
    // Tail lying along the ground.
    limb(g, [P(11, 27), P(8, 33), P(11, 38)], Math.max(1, 1.2 * s), Math.max(1, 1.1 * s), fur, { bias: -0.6 });
    // Body: a round back and a broad belly settled on the grass, a haunch with the hind leg folded under.
    shadedEllipse(g, 29 * s, 31 * s, 18 * s, 7.5 * s, fur, { dither, flat: 0.2, min: 1 });
    shadedEllipse(g, 24 * s, 28 * s, 11 * s, 8 * s, fur, { dither, min: 1 });
    shadedEllipse(g, 16 * s, 32 * s, 6.5 * s, 5.5 * s, fur, { dither, bias: 0.3, min: 1 });
    // A foreleg tucked forward.
    limb(g, [P(39, 36.5), P(46, 38.3)], legW, legW * 0.8, fur, { bias: -0.3 });
    // Neck up to the head.
    limb(g, [P(42, 28), P(48, 23)], 8 * s, 6.5 * s, fur);
    drawCowHead(g, s, 50, 21, 0.35, { fur, muzzle, horn, pink, eyeInk }, detailed, dither);
  } else {
    const walking = pose.startsWith('walk');
    const phase = walking ? (Number(pose.slice(-1)) - 1) * (Math.PI / 2) : 0;
    const swing = (o: number) => (walking ? Math.sin(phase + o) * 3.2 : 0);
    const lift = (o: number) => (walking ? Math.max(0, Math.cos(phase + o)) * 1.4 : 0);
    // Far legs first, in shadow.
    leg(P(41, 24), P(42 + swing(Math.PI) * 0.5, 31 - lift(Math.PI)), P(41 + swing(Math.PI), 38), true);
    leg(P(16, 24), P(13 + swing(0) * 0.4, 31 - lift(0)), P(15 + swing(0), 38), true);
    // Body: hindquarters, barrel, shoulders.
    shadedEllipse(g, 15 * s, 19 * s, 8.5 * s, 9.5 * s, fur, { dither, min: 1 });
    shadedEllipse(g, 29 * s, 20.5 * s, 19 * s, 9 * s, fur, { dither, flat: 0.2, min: 1 });
    shadedEllipse(g, 41 * s, 19 * s, 7 * s, 9.5 * s, fur, { dither, min: 1 });
    // Udder.
    if (detailed) {
      shadedEllipse(g, 21 * s, 29 * s, 3.4 * s, 2.3 * s, pink, { dither: false });
      g.set(Math.floor(20 * s), Math.floor(31.2 * s), pink[1]);
      g.set(Math.floor(22.5 * s), Math.floor(31.2 * s), pink[1]);
    }
    // Near legs.
    leg(P(45, 24), P(46 + swing(0) * 0.5, 31 - lift(0)), P(45 + swing(0), 38), false);
    leg(P(12, 24), P(9 + swing(Math.PI) * 0.4, 31 - lift(Math.PI)), P(11 + swing(Math.PI), 38), false);
    // Tail, swinging a little, with its tuft.
    const t = walking ? Math.sin(phase) * 1.2 : 0;
    limb(g, [P(9, 13), P(7 + t * 0.3, 21), P(7.5 + t, 28)], Math.max(1, 1.3 * s), Math.max(1, 1 * s), fur, { bias: -0.6 });
    shadedEllipse(g, (7.5 + t) * s, 30 * s, Math.max(0.6, 1.3 * s), Math.max(0.8, 2.2 * s), patch, { dither: false });
    // Neck and head: lowered to the grass when grazing.
    const grazing = pose.startsWith('graze');
    if (grazing) {
      const hy = pose === 'graze-1' ? 31 : 32.5;
      limb(g, [P(44, 15), P(50, 24), P(52, hy - 4)], 8.5 * s, 6 * s, fur, { dither: false });
      drawCowHead(g, s, 53, hy, 1.15, { fur, muzzle, horn, pink, eyeInk }, detailed, dither);
    } else {
      limb(g, [P(43, 16), P(50, 13)], 9 * s, 7 * s, fur, { dither: false });
      drawCowHead(g, s, 52, 14, 0.45, { fur, muzzle, horn, pink, eyeInk }, detailed, dither);
    }
  }
  if (H >= 10 && coat === 'holstein') {
    // Black patches: organic blobs over the white, following its shading.
    const cell = 7 * s;
    remap(g, fur, patch, (x, y) => valueNoise(x / cell, y / cell, 13) * 0.7 + valueNoise(x / (cell * 0.45), y / (cell * 0.45), 29) * 0.3 < 0.4);
  } else if (detailed) {
    // A paler belly and muzzle line.
    const paler: Ramp = [fur[1], fur[2], fur[3], fur[4], fur[4]];
    remap(g, fur, paler, (_x, y) => y > 25 * s && y < 30 * s);
  }
  if (detailed) selOut(g, palette, { bottomHeavy: H < 24 });
  return { grid: g, palette };
}

function drawCowHead(
  g: PixelGrid,
  s: number,
  hx: number,
  hy: number,
  tilt: number,
  r: { fur: Ramp; muzzle: Ramp; horn: Ramp; pink: Ramp; eyeInk: number },
  detailed: boolean,
  dither: boolean,
): void {
  // Ear, sticking out behind the poll.
  const back = tilt > 1 ? -1 : 0;
  shadedEllipse(g, (hx - 4.5) * s, (hy - 3.5 + back * 2) * s, 2.6 * s, 1.2 * s, r.fur, { dither: false, angle: -0.3 + tilt * 0.4, bias: -0.5 });
  // The long face, angled down to the muzzle.
  shadedEllipse(g, hx * s, hy * s, 5.2 * s, 3.6 * s, r.fur, { dither, angle: tilt });
  const mx = hx + Math.cos(tilt) * 4.2;
  const my = hy + Math.sin(tilt) * 4.2;
  shadedEllipse(g, mx * s, my * s, 2.6 * s, 2.4 * s, r.muzzle, { dither: false, angle: tilt });
  if (detailed) {
    g.set(Math.floor((mx + 1) * s), Math.floor((my + 0.2) * s), r.muzzle[0]);
    // Eye.
    const ex = hx - 0.5 + Math.sin(tilt) * 0.6;
    const ey = hy - 1.4 + Math.cos(tilt) * 0.2;
    g.set(Math.floor(ex * s), Math.floor(ey * s), r.eyeInk);
    // Horns: short and pale, curving up from the poll.
    limb(g, [[(hx - 2) * s, (hy - 3.2) * s], [(hx - 1.6) * s, (hy - 5.5) * s], [(hx - 0.6) * s, (hy - 6.6) * s]], Math.max(1, 1.3 * s), Math.max(1, 0.8 * s), r.horn, { max: 4 });
  }
}

export class CowSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: CowCoat, pose: CowPose, height: number): Texture {
    const h = evenSize(height, 6);
    const key = `${coat}:${pose}:${h}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawCowSized(coat, pose, h);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
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
  private readonly cache = new Map<string, Texture>();

  get(coat: ChickenCoat, pose: ChickenPose, height: number): Texture {
    const h = evenSize(height, 6);
    const key = `${coat}:${pose}:${h}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawChickenSized(coat, pose, h);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
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
export function drawRabbitSized(pose: RabbitPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.3);
  const g = new PixelGrid(W, H);
  const s = H / 16;
  const palette = new Palette();
  const fur = palette.ramp(0x9a7c60);
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
    drawRabbitHead(g, s, 12, 12.5, -0.2, { fur, ear, eyeInk, glint }, big);
  } else {
    const sh = shapes[pose];
    const [bx, by, brx, bry, ba] = sh.body;
    // Far ear behind the head.
    rabbitEar(g, s, sh.head, sh.ears - 0.25, fur, ear, true);
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
    drawRabbitHead(g, s, sh.head[0], sh.head[1], sh.ears, { fur, ear, eyeInk, glint }, big);
  }
  if (big) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

function rabbitEar(g: PixelGrid, s: number, head: Pt, angle: number, fur: Ramp, inner: Ramp, far: boolean): void {
  // Ears sweep up and back from the crown; `angle` 0 is straight up, negative leans back.
  const len = 6.5;
  const bx = head[0] - 1;
  const by = head[1] - 1.2;
  const tip: Pt = [(bx + Math.sin(angle) * len) * s, (by - Math.cos(angle) * len) * s];
  limb(g, [[bx * s, by * s], tip], 1.8 * s, 1.2 * s, fur, { bias: far ? -1 : 0 });
  if (!far && s >= 0.8) limb(g, [[(bx + 0.2) * s, (by - 0.8) * s], [(bx + Math.sin(angle) * (len - 1.5)) * s, (by - Math.cos(angle) * (len - 1.5)) * s]], 0.8 * s, 0.6 * s, inner, { max: 3 });
}

function drawRabbitHead(g: PixelGrid, s: number, hx: number, hy: number, ears: number, r: { fur: Ramp; ear: Ramp; eyeInk: number; glint: number }, big: boolean): void {
  shadedEllipse(g, hx * s, hy * s, 2.9 * s, 2.5 * s, r.fur, { dither: false, angle: 0.25 });
  rabbitEar(g, s, [hx, hy], ears, r.fur, r.ear, false);
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
  private readonly cache = new Map<string, Texture>();

  get(pose: RabbitPose, height: number): Texture {
    const h = evenSize(height, 6);
    const key = `${pose}:${h}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawRabbitSized(pose, h);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
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
  private readonly cache = new Map<string, Texture>();

  get(kind: FishKind, heading: number, frame: 0 | 1, shadow = false): Texture {
    const h = ((Math.round(heading) % TOP_FISH_HEADINGS) + TOP_FISH_HEADINGS) % TOP_FISH_HEADINGS;
    const key = `${kind}:${h}:${frame}:${shadow}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawTopFishSized(kind, h, frame, shadow);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
  }
}
