import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { PixelGrid, pixelHash } from './raster';

// --- Deer ---------------------------------------------------------------

export type DeerPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'graze-1' | 'graze-2' | 'alert' | 'bound-1' | 'bound-2';
export const DEER_WALK: readonly DeerPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];
export type DeerKind = 'doe' | 'buck' | 'fawn';

const enum D {
  Outline = 1,
  Dark = 2,
  Body = 3,
  Light = 4,
  Belly = 5,
  Nose = 6,
  Antler = 7,
  Spot = 8,
  Eye = 9,
}

const DEER_PALETTE = [0, 0x2a1a10, 0x6a4628, 0xa8784a, 0xc4925e, 0xead8c0, 0x1a1210, 0xd8c8a0, 0xf4ecdc, 0x0c0808];

/**
 * A deer in profile, facing right, in an (N·1.4)×N box with hooves on the
 * bottom row. Authored in a 70×50 unit box and scaled to the requested height.
 */
export function drawDeer(kind: DeerKind, pose: DeerPose, height: number): PixelGrid {
  const width = Math.round(height * 1.4);
  const g = new PixelGrid(width, height);
  // Bucks get extra headroom in the box for their antlers.
  const headroom = kind === 'buck' ? 9 : 0;
  const s = height / (50 + headroom);
  const P = (x: number, y: number): [number, number] => [x * s, (y + headroom) * s];
  const detailed = height >= 22;
  const fawn = kind === 'fawn';

  let headX = 56;
  let headY = 10;
  let neckTilt = 0;
  if (pose === 'graze-1' || pose === 'graze-2') {
    headX = 60;
    headY = pose === 'graze-1' ? 40 : 41;
    neckTilt = 1;
  } else if (pose === 'alert') {
    headX = 55;
    headY = 6;
  }
  const bounding = pose.startsWith('bound');
  const bodyY = bounding ? (pose === 'bound-1' ? 20 : 17) : 22;

  // Legs: thin, with a walk cycle.
  const phase = pose.startsWith('walk') ? (Number(pose.slice(-1)) - 1) * (Math.PI / 2) : 0;
  const swing = (o: number) => (pose.startsWith('walk') ? Math.sin(phase + o) * 4 : 0);
  const leg = (hipX: number, hipY: number, footX: number) => {
    const kneeX = (hipX + footX) / 2 + 1;
    g.line(...P(hipX, hipY), ...P(kneeX, hipY + 11), D.Body, Math.max(1, 2.6 * s));
    g.line(...P(kneeX, hipY + 11), ...P(footX, 48.5), D.Body, Math.max(1, 1.8 * s));
    g.set(Math.floor(footX * s), Math.floor((49 + headroom) * s), D.Dark);
  };
  if (bounding) {
    // Legs tucked or stretched in a leap.
    const stretch = pose === 'bound-1';
    g.line(...P(22, bodyY + 6), ...P(stretch ? 8 : 18, bodyY + (stretch ? 14 : 18)), D.Body, Math.max(1, 2.4 * s));
    g.line(...P(46, bodyY + 6), ...P(stretch ? 62 : 50, bodyY + (stretch ? 12 : 18)), D.Body, Math.max(1, 2.4 * s));
  } else {
    leg(46, bodyY + 6, 46 + swing(Math.PI));
    leg(22, bodyY + 6, 22 + swing(0));
  }

  // Body.
  const Y = (y: number) => (y + headroom) * s;
  g.ellipse(34 * s, Y(bodyY), 19 * s, 8.5 * s, (_u, v, x, y) => {
    if (!detailed) return D.Body;
    if (v > 0.5) return D.Belly;
    if (fawn && v < 0.2 && pixelHash(x, y, 31) < 0.12) return D.Spot;
    return v < -0.55 ? D.Light : D.Body;
  });
  // Tail (white underside flashes when alarmed).
  g.ellipse(15 * s, Y(bodyY - 4), 2.5 * s, 3.5 * s, pose === 'alert' || bounding ? D.Belly : D.Dark);

  // Neck and head.
  const neckBaseX = 47;
  const neckBaseY = bodyY - 4;
  g.line(...P(neckBaseX, neckBaseY), ...P(headX - 2, headY + 4 - neckTilt * 4), D.Body, Math.max(1, (neckTilt ? 4.5 : 6) * s));
  g.ellipse(headX * s, Y(headY), 5.5 * s, 4.2 * s, D.Body, neckTilt ? 1.1 : 0.35);
  // Muzzle and nose.
  const muzzleX = headX + (neckTilt ? 1 : 5);
  const muzzleY = headY + (neckTilt ? 5 : 2);
  g.ellipse(muzzleX * s, Y(muzzleY), 2.6 * s, 2 * s, D.Light);
  g.set(Math.floor((muzzleX + (neckTilt ? 0 : 2)) * s), Math.floor(Y(muzzleY + (neckTilt ? 2 : 0))), D.Nose);
  // Ears.
  const earY = headY - 4;
  g.polygon([P(headX - 4, earY + 2), P(headX - 7, earY - 5), P(headX - 1, earY + 1)], D.Body);
  if (detailed) g.set(Math.floor((headX + 1) * s), Math.floor(Y(headY - 1)), D.Eye);
  // Antlers on a buck.
  if (kind === 'buck' && !neckTilt) {
    const ax = headX - 1;
    const ay = headY - 5;
    g.line(...P(ax, ay), ...P(ax - 4, ay - 10), D.Antler, Math.max(1, 1.4 * s));
    g.line(...P(ax - 2, ay - 5), ...P(ax + 3, ay - 9), D.Antler, Math.max(1, 1.2 * s));
    g.line(...P(ax - 3.5, ay - 9), ...P(ax - 8, ay - 12), D.Antler, Math.max(1, 1.2 * s));
  }

  if (detailed) g.outline(D.Outline);
  return g;
}

export class DeerSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(kind: DeerKind, pose: DeerPose, height: number): Texture {
    const key = `${kind}:${pose}:${height}`;
    let t = this.cache.get(key);
    if (!t) {
      t = gridToTexture(drawDeer(kind, pose, height), DEER_PALETTE);
      this.cache.set(key, t);
    }
    return t;
  }
}

// --- Squirrel -----------------------------------------------------------

export type SquirrelPose = 'run-1' | 'run-2' | 'sit' | 'nibble' | 'climb-1' | 'climb-2' | 'cling';
export type SquirrelCoat = 'red' | 'grey';

const SQUIRREL_PALETTES: Record<SquirrelCoat, number[]> = {
  red: [0, 0x2a140a, 0x7a3a18, 0xb4602a, 0xd88a48, 0xf0e0c8, 0x100808, 0x8a5a3a],
  grey: [0, 0x1e1e22, 0x5a5a62, 0x8a8a92, 0xaeaeb6, 0xeeeae4, 0x0c0c0e, 0x6a5a4a],
};

const enum Q {
  Outline = 1,
  Dark = 2,
  Body = 3,
  Light = 4,
  Belly = 5,
  Eye = 6,
  Nut = 7,
}

/**
 * A squirrel in an N×N box. Running and sitting face right with feet on the
 * bottom row; climbing poses face up a trunk (head at the top).
 */
export function drawSquirrel(pose: SquirrelPose, size: number): PixelGrid {
  const g = new PixelGrid(size, size);
  const s = size / 24;
  const P = (x: number, y: number): [number, number] => [x * s, y * s];
  const detailed = size >= 14;
  const tail = (points: Array<[number, number]>, r: number) => {
    points.forEach(([x, y], i) => g.ellipse(x * s, y * s, r * s * (0.7 + 0.3 * (i / points.length)), r * s, i % 2 ? Q.Light : Q.Body));
  };

  if (pose.startsWith('climb') || pose === 'cling') {
    // Vertical on a trunk: tail hanging below, head up.
    const reach = pose === 'climb-1' ? -1.5 : pose === 'climb-2' ? 1.5 : 0;
    tail([[12, 22], [11, 19], [10, 16]], 3.2);
    g.ellipse(12 * s, 12 * s, 4 * s, 6.5 * s, (u) => (u > 0.4 ? Q.Belly : Q.Body));
    g.ellipse(12 * s, 5 * s, 3.4 * s, 3 * s, Q.Body);
    g.polygon([P(10, 3), P(10.5, 0), P(12, 2.5)], Q.Body);
    g.polygon([P(13, 2.5), P(14, 0), P(14.5, 3)], Q.Body);
    for (const [x, y] of [[8, 9 + reach], [16, 9 - reach], [8.5, 16 - reach], [15.5, 16 + reach]] as const) {
      g.line(...P(12 + (x - 12) * 0.5, y), ...P(x, y + 1), Q.Dark, Math.max(1, 1.2 * s));
    }
    if (detailed) {
      g.set(Math.floor(10.5 * s), Math.floor(4.5 * s), Q.Eye);
      g.set(Math.floor(13.5 * s), Math.floor(4.5 * s), Q.Eye);
    }
  } else {
    const sitting = pose === 'sit' || pose === 'nibble';
    const stride = pose === 'run-1' ? 1 : pose === 'run-2' ? -1 : 0;
    // The big bushy tail curling up behind.
    tail(sitting ? [[6, 20], [4, 15], [4, 10], [6, 6], [8, 4]] : [[7, 16], [4, 12], [3, 8], [5, 5]], sitting ? 3.6 : 3.2);
    if (sitting) {
      g.ellipse(13 * s, 16 * s, 5 * s, 7 * s, (u) => (u > 0.35 ? Q.Belly : Q.Body), -0.15);
      g.ellipse(15 * s, 8 * s, 3.8 * s, 3.3 * s, Q.Body);
      g.polygon([P(13, 6), P(13.5, 2.5), P(15, 5.5)], Q.Body);
      // Paws at the mouth, holding a seed when nibbling.
      g.ellipse(17.5 * s, 12 * s, 1.6 * s, 1.4 * s, Q.Light);
      if (pose === 'nibble') g.ellipse(18.5 * s, 10.8 * s, 1.2 * s, 1.2 * s, Q.Nut);
      g.line(...P(12, 22), ...P(15, 23), Q.Dark, Math.max(1, 1.2 * s));
      if (detailed) g.set(Math.floor(16 * s), Math.floor(7.5 * s), Q.Eye);
    } else {
      g.ellipse(14 * s, 16 * s, 6.5 * s, 4 * s, (_u, v) => (v > 0.4 ? Q.Belly : Q.Body), -0.1 * stride);
      g.ellipse(20 * s, 13 * s, 3.2 * s, 2.8 * s, Q.Body);
      g.polygon([P(18.5, 11), P(19, 8), P(20.5, 10.5)], Q.Body);
      g.line(...P(10, 18), ...P(8 + stride * 3, 23), Q.Dark, Math.max(1, 1.4 * s));
      g.line(...P(18, 18), ...P(19 - stride * 3, 23), Q.Dark, Math.max(1, 1.4 * s));
      if (detailed) g.set(Math.floor(21 * s), Math.floor(12.5 * s), Q.Eye);
    }
  }
  if (detailed) g.outline(Q.Outline);
  return g;
}

export class SquirrelSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: SquirrelCoat, pose: SquirrelPose, size: number): Texture {
    const key = `${coat}:${pose}:${size}`;
    let t = this.cache.get(key);
    if (!t) {
      t = gridToTexture(drawSquirrel(pose, size), SQUIRREL_PALETTES[coat]);
      this.cache.set(key, t);
    }
    return t;
  }
}

export function squirrelPalette(coat: SquirrelCoat): number[] {
  return SQUIRREL_PALETTES[coat];
}

export function deerPalette(): number[] {
  return DEER_PALETTE;
}
