import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { limb, Palette, selOut, shadeStep, valueNoise, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

export type CatPose =
  | 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'walk-5' | 'walk-6' | 'walk-7' | 'walk-8'
  | 'sit' | 'sit-breathe' | 'sit-blink' | 'sit-look' | 'sit-ear' | 'sit-swish-1' | 'sit-swish-2' | 'sit-swish-3'
  | 'groom-1' | 'groom-2' | 'groom-3' | 'groom-4'
  | 'yawn-1' | 'yawn-2' | 'yawn-3'
  | 'loaf' | 'loaf-blink'
  | 'stretch-1' | 'stretch-2' | 'stretch-3'
  | 'nap-1' | 'nap-2'
  | 'crouch-1' | 'crouch-2' | 'crouch-3' | 'crouch-4'
  | 'wiggle-1' | 'wiggle-2'
  | 'pounce-1' | 'pounce-2' | 'pounce-3'
  | 'chatter-1' | 'chatter-2';

export const CAT_WALK: readonly CatPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'walk-7', 'walk-8'];
export const CAT_STALK: readonly CatPose[] = ['crouch-1', 'crouch-2', 'crouch-3', 'crouch-4'];
export const CAT_GROOM: readonly CatPose[] = ['groom-1', 'groom-2', 'groom-1', 'groom-2', 'groom-3', 'groom-4', 'groom-3', 'groom-4'];
export const CAT_POSES: readonly CatPose[] = [
  ...CAT_WALK, 'sit', 'sit-breathe', 'sit-blink', 'sit-look', 'sit-ear', 'sit-swish-1', 'sit-swish-2', 'sit-swish-3',
  'groom-1', 'groom-2', 'groom-3', 'groom-4', 'yawn-1', 'yawn-2', 'yawn-3', 'loaf', 'loaf-blink', 'stretch-1', 'stretch-2', 'stretch-3',
  'nap-1', 'nap-2', ...CAT_STALK, 'wiggle-1', 'wiggle-2', 'pounce-1', 'pounce-2', 'pounce-3', 'chatter-1', 'chatter-2',
];

/** The cat's box, art px: about one and a half times the pot's width, and taller sitting. */
export const CAT_WIDTH = 88;
export const CAT_HEIGHT = 57;
/** Poses are authored in a 56×36 box and drawn at this scale. */
const S = CAT_WIDTH / 56;

export type CatCoat = 'orange-tabby' | 'grey-tabby' | 'tuxedo' | 'black' | 'calico' | 'cream' | 'silver-spotted';
export const CAT_COATS: readonly CatCoat[] = ['orange-tabby', 'grey-tabby', 'tuxedo', 'black', 'calico', 'cream', 'silver-spotted'];

interface CoatDef {
  base: number;
  light: number;
  /** Stripes, spots or a second patch colour. */
  mark: number;
  pattern: 'tabby' | 'faint-tabby' | 'spots' | 'patches' | 'solid';
  /** White chest, paws and muzzle (tuxedo, calico). */
  white: boolean;
  /** A third colour for calico patches. */
  mark2?: number;
  eye: number;
}

const COATS: Record<CatCoat, CoatDef> = {
  'orange-tabby': { base: 0xd8883e, light: 0xf0d8b4, mark: 0xa45a26, pattern: 'tabby', white: false, eye: 0xa8cc50 },
  'grey-tabby': { base: 0x8a8e9a, light: 0xc8ccd6, mark: 0x4a4e5a, pattern: 'tabby', white: false, eye: 0x8ec2c8 },
  tuxedo: { base: 0x26262e, light: 0x3a3a46, mark: 0x26262e, pattern: 'solid', white: true, eye: 0x98c860 },
  black: { base: 0x26262e, light: 0x3c3c4a, mark: 0x26262e, pattern: 'solid', white: false, eye: 0xe8c840 },
  calico: { base: 0xf0ece4, light: 0xf8f6f0, mark: 0xd88a40, mark2: 0x2c2828, pattern: 'patches', white: true, eye: 0xd8b040 },
  cream: { base: 0xe6d0aa, light: 0xf6ecd8, mark: 0xcfae7e, pattern: 'faint-tabby', white: false, eye: 0xd88a3a },
  'silver-spotted': { base: 0xb4b8c2, light: 0xe2e4ea, mark: 0x3a3e48, pattern: 'spots', white: false, eye: 0x7ac0a0 },
};

type Pt = readonly [number, number];
type Eyes = 'open' | 'closed' | 'wide' | 'half';
type Mouth = 'shut' | 'open' | 'wide' | 'yawn' | 'lick';

interface Leg {
  pts: Pt[];
  near: boolean;
  /** A front leg (paw rounder) or hind (a hock). */
  front?: boolean;
}

interface Rig {
  body: { x: number; y: number; rx: number; ry: number; a: number };
  chest?: { x: number; y: number; rx: number; ry: number; a: number };
  head: { x: number; y: number; r: number; eyes: Eyes; mouth?: Mouth; face?: 'side' | 'front'; tilt?: number; ear?: boolean; down?: number };
  legs: Leg[];
  tail: Pt[];
  /** The tail wraps round in front of the feet. */
  tailFront?: boolean;
  /** A raised paw drawn over the face (grooming). */
  paw?: Pt[];
  /** Tucked paws peeping out in front (loaf). */
  tucked?: boolean;
}

function walkRig(i: number): Rig {
  const phase = (i / 8) * Math.PI * 2;
  const swing = (o: number) => Math.sin(phase + o) * 3.2;
  const lift = (o: number) => Math.max(0, Math.cos(phase + o)) * 1.6;
  const bob = Math.abs(Math.sin(phase)) * 0.5;
  const front = (x: number, o: number, near: boolean): Leg => ({ pts: [[x, 23 + bob], [x + swing(o) * 0.55, 29], [x + swing(o), 34.5 - lift(o)]], near, front: true });
  const hind = (x: number, o: number, near: boolean): Leg => ({ pts: [[x, 22 + bob], [x - 2 + swing(o) * 0.4, 29.5], [x + swing(o), 34.5 - lift(o)]], near });
  return {
    body: { x: 27, y: 21 + bob, rx: 13, ry: 6.5, a: 0 },
    head: { x: 44, y: 14 + bob * 0.6, r: 6, eyes: 'open' },
    legs: [front(36, Math.PI, false), hind(18, 0, false), front(39, 0, true), hind(15, Math.PI, true)],
    tail: [[14, 19 + bob], [9, 15], [7, 9], [9 + Math.sin(phase) * 1.2, 4]],
  };
}

function sitRig(pose: CatPose): Rig {
  const breathe = pose === 'sit-breathe' ? 0.4 : 0;
  const swish = pose.startsWith('sit-swish') ? Number(pose.slice(-1)) : 0;
  return {
    body: { x: 24, y: 28, rx: 9, ry: 7, a: 0 },
    chest: { x: 29, y: 22 - breathe, rx: 7.5, ry: 11 + breathe, a: -0.2 },
    head: { x: 33, y: 10 - breathe, r: 6, eyes: pose === 'sit-blink' ? 'closed' : 'open', face: pose === 'sit-look' ? 'front' : 'side', ear: pose === 'sit-ear' },
    legs: [
      { pts: [[33, 22], [33.3, 28], [33.5, 34.5]], near: false, front: true },
      { pts: [[36, 22], [36.3, 28], [36.5, 34.5]], near: true, front: true },
      { pts: [[21, 33], [25, 34.5]], near: true },
    ],
    tail: [[18, 34], [26, 35], [34, 34.5], [38 + swish * 0.6, 33 - swish * 1.6]],
    tailFront: true,
  };
}

function rigFor(pose: CatPose): Rig {
  if (pose.startsWith('walk')) return walkRig(Number(pose.slice(-1)) - 1);
  if (pose.startsWith('sit')) return sitRig(pose);
  switch (pose) {
    case 'groom-1':
    case 'groom-2': {
      // Licking a raised paw.
      const r = sitRig('sit');
      r.head = { x: 33.5, y: 11.5, r: 6, eyes: 'half', mouth: pose === 'groom-1' ? 'lick' : 'shut', down: 0.2 };
      r.legs = r.legs.filter((l) => !(l.near && l.front));
      r.paw = [[35, 21], [38.5, 17], [37.5 + (pose === 'groom-1' ? 0 : 0.5), 14 + (pose === 'groom-1' ? 0 : 0.6)]];
      return r;
    }
    case 'groom-3':
    case 'groom-4': {
      // Washing the face: the damp paw drawn back over the ear.
      const r = sitRig('sit');
      r.head = { x: 32.5, y: 11.5, r: 6, eyes: 'closed', down: 0.35 };
      r.legs = r.legs.filter((l) => !(l.near && l.front));
      r.paw = pose === 'groom-3' ? [[35, 21], [38, 15], [36, 9]] : [[35, 21], [37, 14], [33.5, 7.5]];
      return r;
    }
    case 'yawn-1':
    case 'yawn-2':
    case 'yawn-3': {
      const r = sitRig('sit');
      const k = Number(pose.slice(-1));
      r.head = { x: 33, y: 10 - k * 0.3, r: 6, eyes: k === 1 ? 'half' : 'closed', mouth: k === 1 ? 'open' : k === 2 ? 'wide' : 'yawn', tilt: -0.12 * k };
      return r;
    }
    case 'loaf':
    case 'loaf-blink':
      return {
        body: { x: 27, y: 28.5, rx: 13.5, ry: 6.5, a: 0 },
        head: { x: 39, y: 21.5, r: 5.8, eyes: pose === 'loaf-blink' ? 'closed' : 'half' },
        legs: [],
        tail: [[14, 31], [22, 34], [32, 34.5], [37, 34]],
        tailFront: true,
        tucked: true,
      };
    case 'stretch-1':
    case 'stretch-2':
    case 'stretch-3': {
      const k = Number(pose.slice(-1));
      const low = k === 2 ? 2 : k === 1 ? 1 : 0;
      return {
        body: { x: 27, y: 23 + low * 0.5 - (k === 3 ? 2 : 0), rx: 14.5, ry: 6, a: k === 3 ? 0.05 : 0.3 + low * 0.04 },
        head: { x: 44 + low * 0.5, y: 25 + low - (k === 3 ? 7 : 0), r: 5.8, eyes: 'closed', mouth: k === 2 ? 'open' : 'shut' },
        legs: [
          { pts: [[17, 22], [15.5, 28], [16, 34.5]], near: false },
          { pts: [[37, 29 - (k === 3 ? 6 : 0)], [43 + low, 32], [48 + low, 34.5]], near: false, front: true },
          { pts: [[20, 22], [19.5, 28], [20, 34.5]], near: true },
          { pts: [[35, 29 - (k === 3 ? 6 : 0)], [41 + low, 32], [45 + low, 34.5]], near: true, front: true },
        ],
        tail: [[14, 16], [10, 10 - low], [9, 5 - low], [11, 2]],
      };
    }
    case 'nap-1':
    case 'nap-2': {
      const b = pose === 'nap-2' ? 0.7 : 0;
      return {
        body: { x: 27, y: 27 - b / 2, rx: 15, ry: 8 + b, a: 0 },
        head: { x: 39, y: 27.5, r: 5.6, eyes: 'closed', down: 0.4 },
        legs: [],
        tail: [[13, 31], [20, 34], [30, 34.5], [38, 33.5]],
        tailFront: true,
      };
    }
    case 'crouch-1':
    case 'crouch-2':
    case 'crouch-3':
    case 'crouch-4': {
      const phase = ((Number(pose.slice(-1)) - 1) / 4) * Math.PI * 2;
      const st = (o: number) => Math.sin(phase + o) * 1.8;
      const up = (o: number) => Math.max(0, Math.cos(phase + o)) * 1;
      return {
        body: { x: 27, y: 28, rx: 14, ry: 5.2, a: 0 },
        head: { x: 45, y: 24, r: 5.6, eyes: 'wide' },
        legs: [
          { pts: [[37, 29], [39 + st(Math.PI) * 0.5, 31], [38 + st(Math.PI), 34.5 - up(Math.PI)]], near: false, front: true },
          { pts: [[18, 29], [15, 31.5], [17 + st(0), 34.5 - up(0)]], near: false },
          { pts: [[40, 29], [42 + st(0) * 0.5, 31], [41 + st(0), 34.5 - up(0)]], near: true, front: true },
          { pts: [[15, 29], [12, 31.5], [14 + st(Math.PI), 34.5 - up(Math.PI)]], near: true },
        ],
        tail: [[14, 27], [8, 28], [4, 27], [3, 24 + Math.sin(phase) * 0.8]],
      };
    }
    case 'wiggle-1':
    case 'wiggle-2': {
      const k = pose === 'wiggle-1' ? -1 : 1;
      return {
        body: { x: 27 + k * 0.4, y: 28.5, rx: 14, ry: 5.2, a: 0.04 },
        head: { x: 45, y: 25, r: 5.6, eyes: 'wide' },
        legs: [
          { pts: [[37, 29], [39, 31.5], [38.5, 34.5]], near: false, front: true },
          { pts: [[18 + k, 28], [15 + k, 31], [17 + k * 1.2, 34.5]], near: false },
          { pts: [[40, 29], [42, 31.5], [41.5, 34.5]], near: true, front: true },
          { pts: [[15 - k, 28], [12 - k, 31], [14 - k * 1.2, 34.5]], near: true },
        ],
        tail: [[14, 27], [8, 27 + k], [4, 25], [3, 22 + k * 1.5]],
      };
    }
    case 'pounce-1':
      return {
        body: { x: 28, y: 18, rx: 15, ry: 5.2, a: -0.3 },
        head: { x: 45, y: 9, r: 5.6, eyes: 'wide' },
        legs: [
          { pts: [[18, 22], [13, 27], [10, 29]], near: false },
          { pts: [[38, 13], [43, 10.5], [47, 9]], near: false, front: true },
          { pts: [[20, 22], [15, 28], [13, 31]], near: true },
          { pts: [[40, 15], [45, 13], [50, 12]], near: true, front: true },
        ],
        tail: [[14, 20], [8, 22], [3, 22], [1, 19]],
      };
    case 'pounce-2':
      return {
        body: { x: 28, y: 15, rx: 15.5, ry: 5, a: -0.05 },
        head: { x: 46, y: 11, r: 5.6, eyes: 'wide' },
        legs: [
          { pts: [[17, 17], [11, 19], [6, 21]], near: false },
          { pts: [[39, 17], [45, 18.5], [50, 19]], near: false, front: true },
          { pts: [[19, 18], [13, 21], [8, 23]], near: true },
          { pts: [[41, 18], [47, 20], [52, 21]], near: true, front: true },
        ],
        tail: [[13, 15], [7, 14], [3, 12], [1, 9]],
      };
    case 'pounce-3':
      return {
        body: { x: 29, y: 24, rx: 14.5, ry: 5.6, a: 0.22 },
        head: { x: 46, y: 26, r: 5.6, eyes: 'wide' },
        legs: [
          { pts: [[19, 20], [16, 26], [19, 33]], near: false },
          { pts: [[40, 28], [44, 31], [46, 34.5]], near: false, front: true },
          { pts: [[21, 21], [18, 27], [21, 33.5]], near: true },
          { pts: [[42, 29], [46, 32], [49, 34.5]], near: true, front: true },
        ],
        tail: [[15, 18], [9, 15], [5, 11], [4, 7]],
      };
    case 'chatter-1':
    case 'chatter-2': {
      // Sitting bolt upright, staring at the birds, jaw chattering.
      const r = sitRig('sit');
      r.head = { x: 33.5, y: 9.5, r: 6, eyes: 'wide', mouth: pose === 'chatter-1' ? 'open' : 'shut', tilt: -0.18 };
      r.tail = [[18, 34], [26, 35], [33, 33], [37, 29 - (pose === 'chatter-1' ? 1 : 0)]];
      return r;
    }
  }
  return walkRig(0);
}

/**
 * The cat, facing right, feet on the bottom row of an 88×57 box: a soft,
 * rounded body shaded with the light from the window, its coat (tabby
 * stripes, spots, calico patches, a tuxedo's white front and socks), a
 * striped or plain tail, a head with pricked ears pink inside, almond eyes
 * with slit pupils, a pink nose, a muzzle with whiskers, and (when it's
 * yawning, chattering or washing) an open mouth and tongue. Walking in
 * eight frames, sitting and breathing with its tail swishing, glancing
 * round at you, flicking an ear, washing a paw and its face, yawning,
 * loafing, stretching, curled up asleep, stalking low, wiggling to pounce,
 * the pounce itself, and chattering at birds.
 */
export function drawCat(coat: CatCoat, pose: CatPose): { grid: PixelGrid; palette: Palette } {
  const g = new PixelGrid(CAT_WIDTH, CAT_HEIGHT);
  const def = COATS[coat];
  const palette = new Palette();
  const base = palette.ramp(def.base, 0.75);
  const light = palette.ramp(def.light, 0.35);
  const mark = palette.ramp(def.mark, 0.7);
  const mark2 = def.mark2 !== undefined ? palette.ramp(def.mark2, 0.7) : mark;
  const white = palette.ramp(0xf2f0ec, 0.45);
  const pink = palette.add(0xe8a0a0);
  const nose = palette.add(0xd47878);
  const mouthDark = palette.add(0x3a1a1e);
  const tongue = palette.add(0xe87888);
  const eyeC = palette.add(def.eye);
  const pupil = palette.add(0x0c0a0a);
  const glint = palette.add(0xffffff);
  const whisker = palette.add(0xf4f2ee);
  const rig = rigFor(pose);
  const P = (x: number, y: number): Pt => [x * S, y * S];
  const dither = true;

  /** The coat at a point: its pattern, and white where a tuxedo or calico is white. */
  const coatAt = (x: number, y: number, under: boolean, part: 'body' | 'head' | 'leg' | 'tail'): Ramp => {
    if (def.white && under) return white;
    switch (def.pattern) {
      case 'tabby':
      case 'faint-tabby': {
        const k = part === 'leg' ? Math.sin(y * 1.1) : part === 'tail' ? Math.sin((x + y) * 0.9) : Math.sin(x * 0.62 + Math.sin(y * 0.35) * 1.4);
        if (k > (def.pattern === 'faint-tabby' ? 0.75 : 0.45) && !under) return mark;
        return under ? light : base;
      }
      case 'spots': {
        // Round spots, set in loose rows like a little leopard's.
        if (!under && part !== 'head' && part !== 'leg') {
          // The nearest of a jittered scatter of spot centres.
          const cx = Math.floor(x / 6);
          const cy = Math.floor(y / 5);
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const ox = (cx + i) * 6 + 1 + pixelHash(cx + i, cy + j, 41) * 4;
              const oy = (cy + j) * 5 + 1 + pixelHash(cx + i, cy + j, 42) * 3;
              const rr = 1.2 + pixelHash(cx + i, cy + j, 45) * 1.6;
              if ((x - ox) ** 2 + (y - oy) ** 2 < rr) return mark;
            }
          }
        }
        return under ? light : base;
      }
      case 'patches': {
        // Calico: soft-edged patches of ginger and black over white.
        if (under || part === 'leg') return white;
        const n = valueNoise(x / 9, y / 9, 43) + (pixelHash(x, y, 44) - 0.5) * 0.06;
        return n < 0.36 ? mark : n > 0.64 ? mark2 : base;
      }
      default:
        return under ? light : base;
    }
  };

  /** A rounded, shaded part of the cat. */
  const form = (cx: number, cy: number, rx: number, ry: number, a: number, part: 'body' | 'head', underFrom = 0.45) => {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const X = cx * S;
    const Y = cy * S;
    const R = Math.max(rx, ry) * S + 1;
    for (let y = Math.floor(Y - R); y <= Math.ceil(Y + R); y++) {
      for (let x = Math.floor(X - R); x <= Math.ceil(X + R); x++) {
        const dx = x + 0.5 - X;
        const dy = y + 0.5 - Y;
        const u = (dx * cos + dy * sin) / (rx * S);
        const v = (-dx * sin + dy * cos) / (ry * S);
        if (u * u + v * v > 1) continue;
        const nz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        const ramp = coatAt(x, y, v > underFrom, part);
        // The pale underside reads as pale, even turned from the light.
        const lift = ramp === light || ramp === white ? 1.1 : 0.2;
        g.set(x, y, ramp[shadeStep(u * cos - v * sin, u * sin + v * cos, nz, x, y, dither, lift)]);
      }
    }
  };

  const drawLeg = (leg: Leg) => {
    const pts = leg.pts.map(([x, y]) => P(x, y));
    const w0 = (leg.front ? 3.4 : 3.8) * S;
    const w1 = 2.6 * S;
    // Fur in the coat's colours, banded for a tabby; darker for the far legs.
    const top = coatAt(Math.round(pts[0][0]), Math.round(pts[0][1]), false, 'leg');
    limb(g, pts, w0, w1, top, { bias: leg.near ? 0 : -0.9, dither: false });
    if (def.pattern === 'tabby' && pts.length > 2) limb(g, [pts[1], [pts[1][0] + (pts[2][0] - pts[1][0]) * 0.3, pts[1][1] + (pts[2][1] - pts[1][1]) * 0.3]], w1, w1, mark, { bias: leg.near ? 0 : -0.9 });
    // The paw: round, white for a tuxedo or calico.
    const [px, py] = pts[pts.length - 1];
    const pawRamp = def.white ? white : coatAt(Math.round(px), Math.round(py), true, 'leg');
    for (let j = -2; j <= 0; j++) for (let i = -2; i <= 2; i++) if (i * i + j * j * 2 <= 5) g.set(Math.round(px + i + (leg.front ? 1 : 0.5)), Math.round(py + j), pawRamp[leg.near ? 3 : 1]);
  };

  const drawTail = () => {
    const pts = rig.tail.map(([x, y]) => P(x, y));
    limb(g, pts, 3.2 * S, 2.4 * S, base, { dither: false });
    if (def.pattern === 'tabby' || def.pattern === 'faint-tabby' || def.pattern === 'patches') {
      // Rings along the tail, and its tip.
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        for (const t of [0.35, 0.8]) {
          const cx = x0 + (x1 - x0) * t;
          const cy = y0 + (y1 - y0) * t;
          for (let j = -2; j <= 2; j++) for (let k = -1; k <= 1; k++) if (g.get(Math.round(cx + k), Math.round(cy + j)) !== 0) g.set(Math.round(cx + k), Math.round(cy + j), mark[2]);
        }
      }
    }
    if (def.white) {
      const [tx, ty] = pts[pts.length - 1];
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if (g.get(Math.round(tx + k), Math.round(ty + j)) !== 0) g.set(Math.round(tx + k), Math.round(ty + j), white[3]);
    }
  };

  // Behind the body: the tail (unless it wraps the feet), the far legs.
  if (!rig.tailFront) drawTail();
  for (const leg of rig.legs.filter((l) => !l.near)) drawLeg(leg);
  form(rig.body.x, rig.body.y, rig.body.rx, rig.body.ry, rig.body.a, 'body', 0.4);
  if (rig.chest) form(rig.chest.x, rig.chest.y, rig.chest.rx, rig.chest.ry, rig.chest.a, 'body', def.white ? -0.2 : 0.2);
  if (rig.tucked) {
    for (const dx of [0, 3.5]) {
      const ramp = def.white ? white : light;
      for (let j = -1; j <= 1; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j * 4 <= 10) g.set(Math.round((36 + dx) * S + i), Math.round(33.6 * S + j), ramp[2 + (dx ? 1 : 0)]);
    }
  }
  for (const leg of rig.legs.filter((l) => l.near)) drawLeg(leg);
  if (rig.tailFront) drawTail();
  const ink = { base, light, mark, white, pink, nose, mouthDark, tongue, eyeC, pupil, glint };
  const whiskers = drawHead(g, rig.head, S, ink, def, coatAt);
  if (rig.paw) {
    const pts = rig.paw.map(([x, y]) => P(x, y));
    limb(g, pts, 3.4 * S, 2.8 * S, def.white ? white : base, { bias: 0.2 });
    const [px, py] = pts[pts.length - 1];
    for (let j = -2; j <= 1; j++) for (let i = -2; i <= 2; i++) if (i * i + j * j <= 5) g.set(Math.round(px + i), Math.round(py + j), (def.white ? white : light)[3]);
  }
  selOut(g, palette, { bottomHeavy: true });
  // Whiskers go on last, fine, with no outline.
  for (const [x, y] of whiskers) g.set(x, y, whisker);
  return { grid: g, palette };
}

interface HeadInk {
  base: Ramp;
  light: Ramp;
  mark: Ramp;
  white: Ramp;
  pink: number;
  nose: number;
  mouthDark: number;
  tongue: number;
  eyeC: number;
  pupil: number;
  glint: number;
}

/** The cat's head: in profile (facing right) or turned to look at you. Returns where its whiskers go. */
function drawHead(g: PixelGrid, h: Rig['head'], S: number, ink: HeadInk, def: CoatDef, coatAt: (x: number, y: number, under: boolean, part: 'head') => Ramp): Pt[] {
  const whiskers: Pt[] = [];
  const cx = h.x * S;
  const cy = h.y * S;
  const r = h.r * S * 1.12;
  const front = h.face === 'front';
  const tilt = h.tilt ?? 0;
  // Ears: triangles, pink inside; one flicked back.
  const ear = (side: -1 | 1) => {
    const flick = h.ear && side === 1 ? 0.35 : 0;
    const baseX = front ? cx + side * r * 0.55 : cx + (side < 0 ? -r * 0.55 : r * 0.35);
    const tipX = baseX + (front ? side * r * 0.2 : side * r * 0.12) - flick * r;
    const tipY = cy - r * (1.45 - flick * 0.5) + tilt * r * side;
    const left = baseX - r * 0.42;
    const right = baseX + r * 0.42;
    g.polygon([[left, cy - r * 0.45], [tipX, tipY], [right, cy - r * 0.55]], ink.base[1]);
    g.polygon([[left + r * 0.2, cy - r * 0.55], [tipX, tipY + r * 0.35], [right - r * 0.2, cy - r * 0.6]], ink.pink);
  };
  ear(-1);
  ear(1);
  // The head itself, shaded.
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const u = (x + 0.5 - cx) / r;
      const v = (y + 0.5 - cy) / (r * 0.9);
      if (u * u + v * v > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
      // Lighter at the muzzle and under the chin; a tuxedo's white blaze.
      const muzzle = front ? v > 0.15 && Math.abs(u) < 0.45 : u > 0.5 && v > 0.05 && v < 0.6;
      const under = muzzle || v > 0.7 || (def.white && (front ? Math.abs(u) < 0.22 && v > -0.3 : u > 0.15 && v > -0.1));
      let ramp = coatAt(x, y, under, 'head');
      // The tabby's 'M' on the forehead and stripes on the cheek.
      if ((def.pattern === 'tabby' || def.pattern === 'faint-tabby') && !under && v < -0.25 && Math.abs(Math.sin(u * 7)) > 0.85) ramp = ink.mark;
      g.set(x, y, ramp[shadeStep(u, v, nz, x, y, true, 0.25)]);
    }
  }
  // Eyes: almond, with a slit pupil and a glint; closed, a soft curve.
  const eyeAt = (ex: number, ey: number) => {
    const X = Math.round(ex);
    const Y = Math.round(ey);
    if (h.eyes === 'closed') {
      g.set(X - 1, Y, ink.base[0]);
      g.set(X, Y + 1, ink.base[0]);
      g.set(X + 1, Y, ink.base[0]);
      return;
    }
    const tall = h.eyes === 'wide' ? 2 : h.eyes === 'half' ? 0 : 1;
    for (let dy = 0; dy <= tall; dy++) for (let dx = -1; dx <= 1; dx++) g.set(X + dx, Y + dy, ink.eyeC);
    g.set(X, Y + (tall > 0 ? 1 : 0), ink.pupil);
    if (tall > 1) g.set(X, Y + 2, ink.pupil);
    if (tall > 0) g.set(X - 1, Y, ink.glint);
    g.set(X - 1, Y - 1, ink.base[0]);
    g.set(X, Y - 1, ink.base[0]);
    g.set(X + 1, Y - 1, ink.base[0]);
  };
  const down = (h.down ?? 0) * r;
  if (front) {
    eyeAt(cx - r * 0.42, cy - r * 0.15 + down);
    eyeAt(cx + r * 0.42, cy - r * 0.15 + down);
    g.set(Math.round(cx), Math.round(cy + r * 0.3 + down), ink.nose);
    g.set(Math.round(cx) - 1, Math.round(cy + r * 0.3 + down), ink.nose);
    g.set(Math.round(cx) - 1, Math.round(cy + r * 0.5 + down), ink.base[0]);
    g.set(Math.round(cx) + 1, Math.round(cy + r * 0.5 + down), ink.base[0]);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        whiskers.push([Math.round(cx + side * (r * 0.75 + k)), Math.round(cy + r * 0.35 + down)]);
        if (k > 0) whiskers.push([Math.round(cx + side * (r * 0.75 + k)), Math.round(cy + r * 0.5 + down + k * 0.5)]);
      }
    }
    return whiskers;
  }
  eyeAt(cx + r * 0.38, cy - r * 0.12 + down + tilt * r * 0.4);
  // Nose at the tip of the muzzle, the mouth line, whiskers fanning forward.
  const nx = cx + r * 0.98;
  const ny = cy + r * 0.12 + down + tilt * r;
  g.set(Math.round(nx), Math.round(ny), ink.nose);
  const mouth = h.mouth ?? 'shut';
  if (mouth === 'shut') g.set(Math.round(nx - 1), Math.round(ny + 2), ink.base[0]);
  else {
    // An open mouth: dark inside, the tongue showing; a big yawn shows the teeth.
    const depth = mouth === 'open' || mouth === 'lick' ? 2 : mouth === 'wide' ? 3 : 5;
    const reach = mouth === 'open' || mouth === 'lick' ? 2 : 4;
    for (let j = 1; j <= depth; j++) for (let i = -reach; i <= 0; i++) g.set(Math.round(nx + i - j * 0.3), Math.round(ny + 1 + j), j === depth ? ink.tongue : ink.mouthDark);
    // A big yawn shows its fangs, top and bottom.
    if (mouth === 'yawn' || mouth === 'wide') {
      g.set(Math.round(nx - 1), Math.round(ny + 2), ink.white[4]);
      g.set(Math.round(nx - 1 - depth * 0.3), Math.round(ny + depth), ink.white[4]);
    }
    if (mouth === 'lick') g.set(Math.round(nx + 1), Math.round(ny + 2), ink.tongue);
  }
  // Two whiskers fanning forward from the muzzle, one rising, one drooping.
  for (let k = 0; k < 5; k++) {
    whiskers.push([Math.round(nx - 1 + k), Math.round(ny + 1 - k * 0.35)]);
    if (k > 1) whiskers.push([Math.round(nx - 1 + k), Math.round(ny + 2 + k * 0.4)]);
  }
  return whiskers;
}

export class CatSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: CatCoat, pose: CatPose): Texture {
    const key = `${coat}:${pose}`;
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, palette } = drawCat(coat, pose);
      texture = gridToTexture(grid, palette.colors);
      this.cache.set(key, texture);
    }
    return texture;
  }
}
