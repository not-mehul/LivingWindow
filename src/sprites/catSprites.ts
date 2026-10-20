import type { Texture } from 'pixi.js';
import { DrawnCache } from './cache';
import { luminance } from '../core/color';
import { Palette, selOut, valueNoise, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';
import { furGrain, Sculpt } from './sculpt';

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

// Part ids in the cat's sculpt.
const TAIL = 1;
const FAR_LEG = 2;
const BODY = 3;
const HAUNCH = 5;
const NEAR_LEG = 6;
const PAW = 7;
const NECK = 8;
const FAR_EAR = 9;
const SKULL = 10;
const MUZZLE = 11;
const NEAR_EAR = 12;
const EAR_IN = 13;
const FAR_PAW = 14;

/**
 * The outline of a cat's torso along its length: a back that runs nearly
 * level, a rump rounding off behind, the belly tucked up at the waist and
 * the chest dropping deep in front; centred on (x, y), `rx` long either way
 * and `ry` deep either way, turned by `a`.
 */
function torso(x: number, y: number, rx: number, ry: number, a: number): Pt[] {
  const N = 16;
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Blunt, rounded ends.
    const e = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 2.4)), 1 / 2.4);
    const lx = -rx + 2 * rx * t;
    // The back: a slight rise over the hips and the shoulders, a gentle dip between.
    const back = -ry * e * (0.92 + 0.07 * Math.cos((t - 0.15) * Math.PI * 2.2));
    // The belly: full at the haunch, tucked in at the waist, deep at the chest.
    const depth = 0.9 - 0.16 * Math.exp(-(((t - 0.4) / 0.16) ** 2)) + 0.22 * Math.exp(-(((t - 0.78) / 0.14) ** 2));
    top.push([lx, back]);
    bottom.push([lx, ry * e * depth]);
  }
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [...top, ...bottom.reverse()].map(([px, py]) => [x + px * c - py * s, y + px * s + py * c] as Pt);
}

/**
 * The cat, facing right, feet on the bottom row of an 88×57 box: a real
 * cat's build — a level back, the rump and the haunch behind, a tucked-up
 * waist and a deep chest; hind legs thick at the thigh tapering to the
 * hock, slim front legs, round paws; a neck into a profile head with a
 * rounded cranium, a short muzzle and whisker pad, a firm chin; tall ears
 * with curved edges, pink and furred inside; almond eyes rimmed dark, with
 * a slit pupil and a glint; a pink nose; whiskers; and a long tail tapering
 * to its tip. Its coat (tabby stripes, spots, calico patches, a tuxedo's
 * white front and socks), lit from the window, with the grain of the fur.
 * Walking in eight frames, sitting and breathing with its tail swishing,
 * glancing round at you, flicking an ear, washing a paw and its face,
 * yawning, loafing, stretching, curled up asleep, stalking low, wiggling to
 * pounce, the pounce itself, and chattering at birds.
 */
export function drawCat(coat: CatCoat, pose: CatPose): { grid: PixelGrid; palette: Palette } {
  const g = new PixelGrid(CAT_WIDTH, CAT_HEIGHT);
  const def = COATS[coat];
  const palette = new Palette();
  const warm = luminance(def.base) > 0.45;
  const base = palette.ramp(def.base, 0.7, warm ? 0.45 : 1);
  const light = palette.ramp(def.light, 0.35, 0.4);
  const mark = palette.ramp(def.mark, 0.7);
  const mark2 = def.mark2 !== undefined ? palette.ramp(def.mark2, 0.7) : mark;
  const white = palette.ramp(0xf2f0ec, 0.45);
  const pink = palette.ramp(0xe8a0a0, 0.45);
  const nose = palette.add(0xd47878);
  const mouthDark = palette.add(0x3a1a1e);
  const tongue = palette.add(0xe87888);
  const eye = palette.ramp(def.eye, 0.6);
  const pupil = palette.add(0x0c0a0a);
  const glint = palette.add(0xffffff);
  const whisker = palette.add(0xf4f2ee);
  const rig = rigFor(pose);
  const P = (x: number, y: number): Pt => [x * S, y * S];
  const sc = new Sculpt(CAT_WIDTH, CAT_HEIGHT);

  /** The coat at a point: its pattern, and white where a tuxedo or calico is white. */
  const coatAt = (x: number, y: number, under: boolean, part: 'body' | 'head' | 'leg' | 'tail'): Ramp => {
    if (def.white && under) return white;
    switch (def.pattern) {
      case 'tabby':
      case 'faint-tabby': {
        const k = part === 'leg' ? Math.sin(y * 1.1) : part === 'tail' ? Math.sin((x + y) * 0.9) : Math.sin(x * 0.62 + Math.sin(y * 0.35) * 1.4 + (valueNoise(x / 4, y / 4, 47) - 0.5) * 1.2);
        if (k > (def.pattern === 'faint-tabby' ? 0.75 : 0.45) && !under) return mark;
        return under ? light : base;
      }
      case 'spots': {
        // Round spots, set in loose rows like a little leopard's.
        if (!under && part !== 'head' && part !== 'leg') {
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
        const n = valueNoise(x / 9, y / 9, 43) + (valueNoise(x / 2, y / 2, 44) - 0.5) * 0.08;
        return n < 0.36 ? mark : n > 0.64 ? mark2 : base;
      }
      default:
        return under ? light : base;
    }
  };

  // --- Build the cat, back to front. ---
  const legFur = { amount: 0.15, seed: 4 };
  const legOf = (leg: Leg, id: number) => {
    const pts = leg.pts.map(([x, y]) => P(x, y));
    // Hind legs: a thick thigh tapering to the hock; front legs slim, a little thicker at the elbow.
    const widths = leg.front ? [4.2, 3, 2.7] : pts.length > 2 ? [6.2, 3, 2.6] : [5.4, 3];
    sc.sweep(id, pts, widths.slice(0, pts.length).map((w) => w * S), { fur: legFur });
    const [px, py] = pts[pts.length - 1];
    // The paw: round, resting on the ground ahead of the leg.
    sc.ellipse(id === FAR_LEG ? FAR_PAW : PAW, px + (leg.front ? 0.9 : 0.5) * S, Math.min(py, CAT_HEIGHT - 1.4 * S) + 0.1 * S, 2 * S, 1.3 * S, 0, { round: 2 });
  };
  if (!rig.tailFront) sc.sweep(TAIL, rig.tail.map(([x, y]) => P(x, y)), tailWidths(rig.tail.length), { fur: { amount: 0.3, seed: 8 } });
  for (const leg of rig.legs.filter((l) => !l.near)) legOf(leg, FAR_LEG);
  const b = rig.body;
  if (rig.chest) {
    // Sitting: one form from the shoulders down the curve of the back to the rump on the ground, along to the
    // front paws and up the chest; the thigh laid over it, round, and the hind foot along the ground before it.
    const c = rig.chest;
    const lift = 22 - c.y;
    sc.outline(BODY, [P(29, 12.5 - lift), P(25, 16 - lift * 0.6), P(21.5, 21.5), P(18, 26.5), P(17, 31.5), P(19, 34.6), P(31, 34.6), P(32.5, 30.5), P(35.5, 26.8), P(37.6, 22), P(36.4, 16.5 - lift * 0.6), P(34, 13 - lift)], {
      frame: { cx: 27 * S, cy: 23.5 * S, rx: 10.5 * S, ry: 11.5 * S },
      fur: { amount: 0.2, dir: [0.3, 1], seed: 2 },
    });
    sc.outline(HAUNCH, [P(17.5, 31), P(18, 26), P(21.5, 22.5), P(26, 23), P(28.5, 27.5), P(28, 32.5), P(24, 34.4), P(19.5, 34.2)], { frame: { cx: 23 * S, cy: 28.5 * S, rx: 6 * S, ry: 6 * S }, fur: { amount: 0.15, seed: 7 } });
  } else {
    sc.outline(BODY, torso(b.x * S, b.y * S, b.rx * S * 1.05, b.ry * S, b.a), { frame: { cx: b.x * S, cy: b.y * S, rx: b.rx * S, ry: b.ry * S }, fur: { amount: 0.18, dir: [0, 1], seed: 2 } });
  }
  if (rig.tucked) {
    // Loafing: the front paws tucked under the chest, just peeping out.
    for (const dx of [0, 3.6]) sc.ellipse(dx ? PAW : FAR_PAW, (36.5 + dx) * S, 33.7 * S, 2.3 * S, 1.2 * S, 0, { round: 2 });
  }
  for (const leg of rig.legs.filter((l) => l.near)) legOf(leg, NEAR_LEG);
  if (rig.tailFront) sc.sweep(TAIL, rig.tail.map(([x, y]) => P(x, y)), tailWidths(rig.tail.length), { fur: { amount: 0.3, seed: 8 } });
  const h = rig.head;
  const front = h.face === 'front';
  const r = h.r * S * 1.15;
  const hx = h.x * S;
  const hy = h.y * S;
  // The neck, from the shoulders up into the back of the head.
  const shoulder: Pt = rig.chest ? [(rig.chest.x - 0.5) * S, (rig.chest.y - rig.chest.ry * 0.55) * S] : [(b.x + b.rx * 0.62) * S, (b.y - b.ry * 0.25 + Math.sin(b.a) * b.rx * 0.6) * S];
  sc.sweep(NECK, [shoulder, [(shoulder[0] + hx) / 2 - r * 0.15, (shoulder[1] + hy) / 2 + r * 0.25], [hx - r * 0.25, hy + r * 0.35]], [r * 1.25, r * 1.15, r * 1.1], { fur: { amount: 0.15, seed: 12 } });
  const whiskers = head(sc, h, r, hx, hy, front);
  if (rig.paw) {
    // The paw raised to the face (washing): over the chest, its pad turned up.
    sc.sweep(NEAR_LEG, rig.paw.map(([x, y]) => P(x, y)), [3.6 * S, 3 * S, 2.8 * S], { fur: legFur });
    const [px, py] = P(...rig.paw[rig.paw.length - 1]);
    sc.ellipse(PAW, px, py, 1.9 * S, 1.6 * S, 0, { round: 2 });
  }

  // --- Paint it. ---
  sc.paint(
    g,
    (q) => {
      switch (q.part) {
        case EAR_IN:
          return pink;
        case TAIL: {
          // Rings along a tabby's tail; a white tip on a white-marked cat.
          if (def.white && q.u > 0.86) return white;
          if ((def.pattern === 'tabby' || def.pattern === 'faint-tabby' || def.pattern === 'patches') && Math.sin(q.u * 26) > (def.pattern === 'faint-tabby' ? 0.7 : 0.35)) return def.pattern === 'patches' ? mark2 : mark;
          return def.pattern === 'patches' ? coatAt(q.x, q.y, false, 'body') : base;
        }
        case PAW:
        case FAR_PAW:
          return def.white ? white : coatAt(q.x, q.y, true, 'leg');
        case FAR_LEG:
        case NEAR_LEG:
          return def.white && q.u > 0.62 ? white : coatAt(q.x, q.y, false, 'leg');
        case BODY:
          // Sitting, its chest is the pale part, down the front; standing, the belly.
          // The pale fur is on the surfaces facing forward (the chest) or down (the belly), so its edge follows the form.
          return coatAt(q.x, q.y, rig.chest ? q.nx > (def.white ? 0.15 : 0.35) && q.v > -0.8 && q.v < 0.35 && q.u > 0.2 : q.ny > (def.white ? 0.25 : 0.45) && q.v > 0.05, 'body');
        case HAUNCH:
          return coatAt(q.x, q.y, def.white && q.v > 0.6, 'body');
        case NECK:
          // Only a white-marked cat has a white throat.
          return coatAt(q.x, q.y, def.white && q.v > 0.1, 'body');
        case FAR_EAR:
        case NEAR_EAR:
          return coatAt(q.x, q.y, false, 'head');
        case MUZZLE:
          return coatAt(q.x, q.y, true, 'head');
        default: {
          // The head: paler under the chin; a tuxedo's white blaze; the tabby 'M' and cheek lines.
          const under = front ? q.v > 0.45 || (def.white && Math.abs(q.u) < 0.18 && q.v > -0.5) : q.v > 0.62 || (def.white && q.u > 0.35 && q.v > -0.2);
          let ramp = coatAt(q.x, q.y, under, 'head');
          if ((def.pattern === 'tabby' || def.pattern === 'faint-tabby') && !under && q.v < -0.3 && Math.abs(Math.sin(q.u * 7)) > 0.86) ramp = mark;
          if ((def.pattern === 'tabby' || def.pattern === 'faint-tabby') && !under && !front && q.v > 0.05 && q.v < 0.4 && q.u < 0.2 && Math.abs(Math.sin((q.u - q.v) * 9)) > 0.9) ramp = mark;
          return ramp;
        }
      }
    },
    {
      bias: (q) => {
        // The far legs and ear sit in shadow; window light catches the top edges.
        const far = q.part === FAR_LEG || q.part === FAR_PAW || q.part === FAR_EAR ? -0.9 : 0;
        const rim = q.depth < 1.4 && q.ny < -0.3 ? 0.6 : 0;
        const angle = q.part === TAIL || q.part === FAR_LEG || q.part === NEAR_LEG ? Math.PI / 2 : Math.PI * 0.1;
        return far + rim + furGrain(q.x, q.y, angle, 19) * 0.7;
      },
    },
  );
  // Pale fur reads as pale even turned from the light: lift it a step where the shading took it to the bottom.
  for (let i = 0; i < g.data.length; i++) {
    const c = g.data[i];
    if (c === white[0] || c === light[0]) g.data[i] = c === white[0] ? white[1] : light[1];
  }
  features(g, h, r, hx, hy, front, { pink, nose, mouthDark, tongue, eye, pupil, glint, white, dark: base[0], def });
  selOut(g, palette, { bottomHeavy: true });
  // Whiskers go on last, fine, with no outline.
  for (const [x, y] of whiskers) if (x >= 0 && y >= 0 && x < CAT_WIDTH && y < CAT_HEIGHT) g.set(x, y, whisker);
  return { grid: g, palette };
}

/** A cat's tail: thick at the root, tapering to a rounded tip. */
function tailWidths(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (3.4 - (i / Math.max(1, n - 1)) * 1.3) * S);
}

/** The cat's head in profile (facing right) or turned to look at you. Returns where its whiskers go. */
function head(sc: Sculpt, h: Rig['head'], r: number, hx: number, hy: number, front: boolean): Pt[] {
  const tilt = h.tilt ?? 0;
  const down = (h.down ?? 0) * r;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  /** A point on the head, `(u, v)` in head radii, turned with it. */
  const H = (u: number, v: number): Pt => [hx + (u * c - v * s) * r, hy + down + (u * s + v * c) * r];
  const frame = { cx: hx, cy: hy + down, rx: r, ry: r };
  const flick = h.ear ? 0.35 : 0;
  if (front) {
    // Turned to look at you: both ears up, the face broad at the cheeks, a neat muzzle.
    for (const side of [-1, 1]) {
      const f = side > 0 ? flick : 0;
      sc.outline(side < 0 ? FAR_EAR : NEAR_EAR, [H(side * 0.25, -0.62), H(side * (0.62 + f), -1.55 + f), H(side * 0.92, -0.42)], { sharp: true, round: 2 });
      sc.outline(EAR_IN, [H(side * 0.42, -0.62), H(side * (0.63 + f * 0.9), -1.3 + f), H(side * 0.78, -0.5)], { sharp: true, round: 1 });
    }
    sc.outline(SKULL, [H(0, -0.92), H(0.62, -0.78), H(0.95, -0.25), H(1.02, 0.25), H(0.75, 0.68), H(0.3, 0.88), H(0, 0.9), H(-0.3, 0.88), H(-0.75, 0.68), H(-1.02, 0.25), H(-0.95, -0.25), H(-0.62, -0.78)], { frame, fur: { amount: 0.2, seed: 15 } });
    sc.outline(MUZZLE, [H(-0.42, 0.25), H(-0.38, 0.62), H(0, 0.78), H(0.38, 0.62), H(0.42, 0.25), H(0, 0.12)], { frame, round: 3 });
    const wy = 0.5;
    const out: Pt[] = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        out.push([Math.round(H(side * 0.62, wy)[0] + side * k), Math.round(H(side * 0.62, wy)[1] - k * 0.15)]);
        if (k > 0) out.push([Math.round(H(side * 0.62, wy + 0.2)[0] + side * k), Math.round(H(side * 0.62, wy + 0.2)[1] + k * 0.45)]);
      }
    }
    return out;
  }
  // In profile: the far ear a little forward of the near one, each tall, with a curved outer edge.
  sc.outline(FAR_EAR, [H(0.02, -0.82), H(0.32 - flick * 0.5, -1.58 + flick * 0.4), H(0.62, -0.62)], { sharp: true, round: 2 });
  sc.outline(EAR_IN, [H(0.14, -0.8), H(0.33 - flick * 0.5, -1.38 + flick * 0.4), H(0.52, -0.66)], { sharp: true, round: 1 });
  sc.outline(SKULL, [H(-1, 0.05), H(-0.85, -0.55), H(-0.4, -0.92), H(0.25, -0.9), H(0.68, -0.55), H(0.86, -0.22), H(0.84, 0.4), H(0.55, 0.78), H(0, 0.86), H(-0.55, 0.78), H(-0.92, 0.45)], { frame, fur: { amount: 0.2, dir: [-1, 0.5], seed: 15 } });
  // The muzzle: a short, rounded snout and whisker pad, the chin below.
  sc.outline(MUZZLE, [H(0.55, -0.3), H(0.95, -0.2), H(1.12, 0.05), H(1.08, 0.32), H(0.92, 0.55), H(0.62, 0.66), H(0.48, 0.25)], { frame: { cx: H(0.85, 0.2)[0], cy: H(0.85, 0.2)[1], rx: r * 0.4, ry: r * 0.45 }, round: 3 });
  sc.outline(NEAR_EAR, [H(-0.62, -0.62), H(-0.36 - flick, -1.62 + flick * 0.5), H(0.02, -0.86)], { sharp: true, round: 2 });
  const out: Pt[] = [];
  const [wx, wy] = H(0.92, 0.36);
  for (let k = 0; k < 6; k++) {
    out.push([Math.round(wx - 1 + k), Math.round(wy - k * 0.3)]);
    if (k > 1) out.push([Math.round(wx - 1 + k), Math.round(wy + 1.2 + k * 0.4)]);
  }
  return out;
}

interface FaceInk {
  pink: Ramp;
  nose: number;
  mouthDark: number;
  tongue: number;
  eye: Ramp;
  pupil: number;
  glint: number;
  white: Ramp;
  dark: number;
  def: CoatDef;
}

/** Eyes, nose and mouth over the painted head. */
function features(g: PixelGrid, h: Rig['head'], r: number, hx: number, hy: number, front: boolean, ink: FaceInk): void {
  const tilt = h.tilt ?? 0;
  const down = (h.down ?? 0) * r;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const H = (u: number, v: number): Pt => [hx + (u * c - v * s) * r, hy + down + (u * s + v * c) * r];
  /** An almond eye: the iris with a slit pupil and a glint, rimmed dark; closed, a soft downward curve. */
  const eyeAt = ([ex, ey]: Pt, facing: 1 | -1 | 0) => {
    const X = Math.round(ex);
    const Y = Math.round(ey);
    if (h.eyes === 'closed') {
      for (let i = -2; i <= 1; i++) g.set(X + i, Y + (i === -2 || i === 1 ? 0 : 1), ink.dark);
      return;
    }
    const tall = h.eyes === 'wide' ? 3 : h.eyes === 'half' ? 1 : 2;
    for (let dy = 0; dy < tall; dy++) for (let dx = -1; dx <= 1; dx++) g.set(X + dx, Y + dy, ink.eye[dy === 0 ? 3 : 2]);
    // The slit pupil, a glint up towards the light.
    for (let dy = 0; dy < tall; dy++) g.set(X, Y + dy, ink.pupil);
    if (tall > 1) g.set(X - 1, Y, ink.glint);
    // The dark rim, heavier above, with a flick out at the outer corner.
    for (let dx = -2; dx <= 2; dx++) g.set(X + dx, Y - 1, ink.dark);
    g.set(X + (facing >= 0 ? 2 : -2), Y, ink.dark);
    g.set(X + (facing >= 0 ? -2 : 2), Y + tall - 1, ink.dark);
    for (let dx = -1; dx <= 1; dx++) g.set(X + dx, Y + tall, ink.dark);
  };
  if (front) {
    eyeAt(H(-0.42, -0.2), -1);
    eyeAt(H(0.42, -0.2), 1);
    const [nx, ny] = H(0, 0.3);
    g.set(Math.round(nx) - 1, Math.round(ny), ink.nose);
    g.set(Math.round(nx), Math.round(ny), ink.nose);
    g.set(Math.round(nx), Math.round(ny) + 1, ink.pink[1]);
    g.set(Math.round(nx) - 1, Math.round(ny) + 1, ink.pink[1]);
    // The mouth: a little 'w' under the nose.
    g.set(Math.round(nx) - 2, Math.round(ny) + 2, ink.dark);
    g.set(Math.round(nx) + 1, Math.round(ny) + 2, ink.dark);
    return;
  }
  eyeAt(H(0.42, -0.2), 1);
  // Nose at the tip of the muzzle, the mouth line under the whisker pad.
  const [nx, ny] = H(1.08, 0.05);
  g.set(Math.round(nx), Math.round(ny), ink.nose);
  g.set(Math.round(nx) - 1, Math.round(ny), ink.nose);
  const mouth = h.mouth ?? 'shut';
  if (mouth === 'shut') {
    const [mx, my] = H(0.82, 0.55);
    g.set(Math.round(mx), Math.round(my), ink.dark);
    g.set(Math.round(mx) + 1, Math.round(my), ink.dark);
  } else {
    // An open mouth: dark inside, the tongue showing; a big yawn shows the teeth.
    const depth = mouth === 'open' || mouth === 'lick' ? 2 : mouth === 'wide' ? 3 : 5;
    const reach = mouth === 'open' || mouth === 'lick' ? 2 : 4;
    for (let j = 1; j <= depth; j++) for (let i = -reach; i <= 0; i++) g.set(Math.round(nx + i - j * 0.3), Math.round(ny + 1 + j), j === depth ? ink.tongue : ink.mouthDark);
    if (mouth === 'yawn' || mouth === 'wide') {
      g.set(Math.round(nx - 1), Math.round(ny + 2), ink.white[4]);
      g.set(Math.round(nx - 1 - depth * 0.3), Math.round(ny + depth), ink.white[4]);
    }
    if (mouth === 'lick') g.set(Math.round(nx + 1), Math.round(ny + 2), ink.tongue);
  }
}

export class CatSpriteCache {
  private readonly cache = new DrawnCache();

  get(coat: CatCoat, pose: CatPose): Texture {
    const key = `${coat}:${pose}`;
    return this.cache.get(key, () => drawCat(coat, pose));
  }
}
