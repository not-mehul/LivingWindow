import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { limb, Palette, selOut, shadeStep, valueNoise, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

/**
 * The dog from the room, up on its hind legs with its front paws on the
 * sill, seen from behind as it looks out of the window: the back of its
 * head and its shoulders, or its head turned to one side (to watch a
 * bird), or round over its shoulder at you, tongue out.
 */

export type DogBreed = 'husky' | 'shepherd' | 'golden' | 'lab' | 'collie' | 'beagle';
export const DOG_BREEDS: readonly DogBreed[] = ['husky', 'shepherd', 'golden', 'lab', 'collie', 'beagle'];

export type DogPose =
  | 'reach'
  | 'away' | 'away-breathe' | 'away-ear'
  | 'side' | 'side-breathe' | 'side-blink' | 'side-ear' | 'side-pant-1' | 'side-pant-2' | 'side-pant-3' | 'side-lick' | 'side-sniff' | 'side-up' | 'side-up-pant'
  | 'face' | 'face-blink' | 'face-pant-1' | 'face-pant-2' | 'face-pant-3' | 'face-tilt' | 'face-tilt-pant' | 'face-lick';

export const DOG_PANT_SIDE: readonly DogPose[] = ['side-pant-1', 'side-pant-2', 'side-pant-3', 'side-pant-2'];
export const DOG_PANT_FACE: readonly DogPose[] = ['face-pant-1', 'face-pant-2', 'face-pant-3', 'face-pant-2'];
export const DOG_POSES: readonly DogPose[] = [
  'reach', 'away', 'away-breathe', 'away-ear',
  'side', 'side-breathe', 'side-blink', 'side-ear', 'side-pant-1', 'side-pant-2', 'side-pant-3', 'side-lick', 'side-sniff', 'side-up', 'side-up-pant',
  'face', 'face-blink', 'face-pant-1', 'face-pant-2', 'face-pant-3', 'face-tilt', 'face-tilt-pant', 'face-lick',
];

/** Poses are authored in a 96-px box and drawn at this scale. */
const K = 1.45;
export const DOG_WIDTH = Math.round(96 * K);
export const DOG_HEIGHT = Math.round(96 * K);
/** The row of the box that sits on the sill's standing line (its paws rest a few rows in front of it). */
export const DOG_SURFACE_ROW = Math.round(64 * K);

export interface DogLook {
  breed: DogBreed;
  /** Which of the breed's coats. */
  coat: number;
  eyes: 'brown' | 'blue' | 'odd';
  /** Collar colour, or none. */
  collar: number | null;
}

type Zone = 'base' | 'dark' | 'light' | 'white';
type Part = 'skull' | 'muzzle' | 'ear' | 'neck' | 'body' | 'leg' | 'paw';
type View = 'away' | 'side' | 'face';

interface Coat {
  base: number;
  dark: number;
  light: number;
}

interface Breed {
  ears: 'prick' | 'tipped' | 'drop' | 'long';
  /** Muzzle length, relative. */
  muzzle: number;
  /** Fluffy coats break up their edges. */
  fluff: number;
  coats: Coat[];
  /** Which colour each part of the dog is, at (u, v) across it. */
  marks: (part: Part, view: View, u: number, v: number) => Zone;
}

const BREEDS: Record<DogBreed, Breed> = {
  husky: {
    ears: 'prick',
    muzzle: 1,
    fluff: 0.5,
    coats: [
      { base: 0x6c707c, dark: 0x3c3e48, light: 0xd8dae0 },
      { base: 0xa8643c, dark: 0x6e3a22, light: 0xf0dccc },
      { base: 0x34343c, dark: 0x202026, light: 0xdcdce2 },
    ],
    marks: (part, view, u, v) => {
      switch (part) {
        case 'skull':
          // The mask: a dark cap and a stripe down the brow over a white face.
          if (view === 'away') return Math.abs(u) > 0.75 && v > 0.2 ? 'white' : 'base';
          if (view === 'face') return v < -0.4 || (Math.abs(u) < 0.14 && v < 0.1) ? 'base' : 'white';
          return v < -0.05 && u < 0.55 ? 'base' : 'white';
        case 'muzzle':
          return view === 'side' && v < -0.45 ? 'base' : 'white';
        case 'ear':
          return view === 'face' && Math.abs(u) < 0.4 && v > -0.4 ? 'white' : 'base';
        case 'neck':
          return view === 'face' && v > 0.3 ? 'white' : Math.abs(u) > 0.8 ? 'white' : 'base';
        case 'body':
          return Math.abs(u) < 0.22 ? 'dark' : Math.abs(u) > 0.78 ? 'white' : 'base';
        default:
          return 'white';
      }
    },
  },
  shepherd: {
    ears: 'prick',
    muzzle: 1.2,
    fluff: 0.3,
    coats: [
      { base: 0xb88c5c, dark: 0x2a2224, light: 0xdcbc8c },
      { base: 0xa47450, dark: 0x262022, light: 0xd4ac80 },
    ],
    marks: (part, view, u, v) => {
      switch (part) {
        case 'skull':
          if (view === 'away') return v < -0.3 ? 'dark' : 'base';
          if (view === 'face') return Math.abs(u) < 0.32 && v < 0.2 && v > -0.6 ? 'dark' : 'base';
          return v < -0.5 && u < 0.3 ? 'dark' : 'base';
        case 'muzzle':
          return 'dark';
        case 'ear':
          return view === 'face' && Math.abs(u) < 0.35 && v > -0.3 ? 'light' : 'dark';
        case 'neck':
          return view === 'face' ? (v > 0.2 ? 'light' : 'base') : v < 0.1 ? 'dark' : 'base';
        case 'body':
          // The black saddle.
          return v < 0.55 && Math.abs(u) < 0.82 ? 'dark' : 'base';
        case 'paw':
          return 'light';
        default:
          return 'base';
      }
    },
  },
  golden: {
    ears: 'drop',
    muzzle: 1,
    fluff: 0.6,
    coats: [
      { base: 0xd0a462, dark: 0xa87c40, light: 0xecd09c },
      { base: 0xe8c488, dark: 0xc89c5c, light: 0xf8e4bc },
      { base: 0xb27a48, dark: 0x865632, light: 0xd6aa78 },
    ],
    marks: (part, view, _u, v) => {
      if (part === 'muzzle' || part === 'paw') return 'light';
      if (part === 'ear') return 'dark';
      if (part === 'neck' && view === 'face' && v > 0.2) return 'light';
      return 'base';
    },
  },
  lab: {
    ears: 'drop',
    muzzle: 1.05,
    fluff: 0,
    coats: [
      { base: 0x2a2a30, dark: 0x1c1c22, light: 0x3a3a44 },
      { base: 0xe2c48e, dark: 0xc8a66e, light: 0xf2dcb0 },
      { base: 0x6a4228, dark: 0x4e2e1a, light: 0x8a5a3a },
    ],
    marks: (part) => (part === 'ear' ? 'dark' : part === 'muzzle' ? 'light' : 'base'),
  },
  collie: {
    ears: 'tipped',
    muzzle: 1.05,
    fluff: 0.55,
    coats: [
      { base: 0x26262c, dark: 0x18181c, light: 0xf2f0ec },
      { base: 0x6a3e24, dark: 0x4a2a18, light: 0xf2f0ec },
    ],
    marks: (part, view, u, v) => {
      switch (part) {
        case 'skull':
          // The white blaze down its face.
          if (view === 'face') return Math.abs(u) < 0.14 + Math.max(0, v) * 0.5 ? 'white' : 'base';
          if (view === 'side') return u > 0.55 && v > -0.2 ? 'white' : 'base';
          return 'base';
        case 'muzzle':
          return 'white';
        case 'neck':
          // Its white ruff, right round the neck.
          return v > 0.25 ? 'white' : 'base';
        case 'body':
          return Math.abs(u) > 0.85 ? 'white' : 'base';
        case 'leg':
        case 'paw':
          return 'white';
        default:
          return 'base';
      }
    },
  },
  beagle: {
    ears: 'long',
    muzzle: 0.95,
    fluff: 0,
    coats: [
      { base: 0xb8783e, dark: 0x2a2426, light: 0xd8a068 },
      { base: 0xc8905a, dark: 0x5a4436, light: 0xe8c08a },
    ],
    marks: (part, view, u, v) => {
      switch (part) {
        case 'skull':
          if (view === 'face') return Math.abs(u) < 0.12 + Math.max(0, v) * 0.45 ? 'white' : 'base';
          if (view === 'side') return u > 0.6 && v > -0.1 ? 'white' : 'base';
          return 'base';
        case 'muzzle':
          return 'white';
        case 'ear':
          return 'base';
        case 'neck':
          return view === 'face' && v > 0.15 ? 'white' : 'base';
        case 'body':
          // Tricolour: a black saddle, tan at its edges.
          return v < 0.7 && Math.abs(u) < 0.7 ? 'dark' : 'base';
        default:
          return 'white';
      }
    },
  },
};

const COLLARS = [0xc8403a, 0x3a6ac8, 0x3a9a5a, 0xe0a030, 0x8a4ac0];

/** A dog for this visit: a breed, a coat of that breed, its eyes, maybe a collar. */
export function randomDogLook(rng: () => number = Math.random): DogLook {
  const breed = DOG_BREEDS[Math.floor(rng() * DOG_BREEDS.length)];
  const coat = Math.floor(rng() * BREEDS[breed].coats.length);
  const eyes = breed === 'husky' ? (['blue', 'blue', 'brown', 'odd'] as const)[Math.floor(rng() * 4)] : 'brown';
  return { breed, coat, eyes, collar: rng() < 0.75 ? Math.floor(rng() * COLLARS.length) : null };
}

export function dogLookKey(look: DogLook): string {
  return `${look.breed}:${look.coat}:${look.eyes}:${look.collar ?? '-'}`;
}

interface Pose {
  view: View;
  /** Paws up off the sill, as it rises or drops. */
  reach?: boolean;
  breathe?: boolean;
  eyes?: 'open' | 'shut';
  /** Tongue out this far (0 = mouth shut). */
  tongue?: number;
  lick?: boolean;
  sniff?: boolean;
  ear?: boolean;
  /** Head turned about the neck (radians; − is up/back). */
  tilt?: number;
}

function poseOf(pose: DogPose): Pose {
  const pant = (p: string) => (p.endsWith('-1') ? 5 : p.endsWith('-2') ? 7 : 6);
  switch (pose) {
    case 'reach':
      return { view: 'away', reach: true };
    case 'away':
      return { view: 'away' };
    case 'away-breathe':
      return { view: 'away', breathe: true };
    case 'away-ear':
      return { view: 'away', ear: true };
    case 'side':
      return { view: 'side' };
    case 'side-breathe':
      return { view: 'side', breathe: true };
    case 'side-blink':
      return { view: 'side', eyes: 'shut' };
    case 'side-ear':
      return { view: 'side', ear: true };
    case 'side-lick':
      return { view: 'side', lick: true };
    case 'side-sniff':
      return { view: 'side', sniff: true, tilt: -0.1 };
    case 'side-up':
      return { view: 'side', tilt: -0.38 };
    case 'side-up-pant':
      return { view: 'side', tilt: -0.38, tongue: 5 };
    case 'face':
      return { view: 'face' };
    case 'face-blink':
      return { view: 'face', eyes: 'shut' };
    case 'face-tilt':
      return { view: 'face', tilt: 0.24 };
    case 'face-tilt-pant':
      return { view: 'face', tilt: 0.24, tongue: 6 };
    case 'face-lick':
      return { view: 'face', lick: true };
    default:
      if (pose.startsWith('side-pant')) return { view: 'side', tongue: pant(pose), breathe: pose.endsWith('-2') };
      return { view: 'face', tongue: pant(pose), breathe: pose.endsWith('-2') };
  }
}

/**
 * Draw the dog in a DOG_WIDTH × DOG_HEIGHT box, its paws on the sill at
 * DOG_SURFACE_ROW and the rest of it running off the bottom. Shoulders and
 * neck from behind, forelegs reaching to the sill and paws resting on it
 * (or lifted, as it gets up); the head looking out (the back of it, the
 * ears), turned to the side (a profile: eye, muzzle, nose, mouth, ears, a
 * lolling tongue), or turned round to the viewer (both eyes, a broad
 * muzzle and nose, its tongue out, its head on one side). Breed markings:
 * a husky's mask, a shepherd's saddle and black muzzle, a collie's blaze
 * and ruff, a beagle's tricolour, a golden's feathering.
 */
export function drawWindowDog(look: DogLook, pose: DogPose): { grid: PixelGrid; palette: Palette } {
  const breed = BREEDS[look.breed];
  const coat = breed.coats[look.coat % breed.coats.length];
  const p = poseOf(pose);
  const g = new PixelGrid(DOG_WIDTH, DOG_HEIGHT);
  const palette = new Palette();
  const ramps: Record<Zone, Ramp> = {
    base: palette.ramp(coat.base, 0.55),
    dark: palette.ramp(coat.dark, 0.6),
    light: palette.ramp(coat.light, 0.4),
    white: palette.ramp(0xf0eee8, 0.4),
  };
  const noseRamp = palette.ramp(0x2a2426, 0.6);
  const tongue = palette.ramp(0xe8788a, 0.5);
  const mouth = palette.add(0x3a1a20);
  const pinkEar = palette.add(0xd89a98);
  const eyeColour = (side: number) => palette.add(look.eyes === 'blue' || (look.eyes === 'odd' && side > 0) ? 0x78b8e8 : 0x6a3e1e);
  const eyeL = eyeColour(-1);
  const eyeR = eyeColour(1);
  const pupil = palette.add(0x100c0c);
  const glint = palette.add(0xffffff);
  const collar = look.collar !== null ? palette.ramp(COLLARS[look.collar], 0.6) : null;
  const cx = 48;
  const X = (x: number) => x * K;

  /** A rounded, furry, shaded form, coloured by the breed's markings. */
  const form = (grid: PixelGrid, x0: number, y0: number, rx: number, ry: number, part: Part, view: View, opts: { a?: number; bias?: number; collarAt?: number } = {}) => {
    const a = opts.a ?? 0;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const fx = X(x0);
    const fy = X(y0);
    const RX = X(rx);
    const RY = X(ry);
    const R = Math.max(RX, RY) + 2;
    for (let y = Math.floor(fy - R); y <= Math.ceil(fy + R); y++) {
      for (let x = Math.floor(fx - R); x <= Math.ceil(fx + R); x++) {
        const dx = x + 0.5 - fx;
        const dy = y + 0.5 - fy;
        const u = (dx * cos + dy * sin) / RX;
        const v = (-dx * sin + dy * cos) / RY;
        const d = u * u + v * v;
        // Fluffy coats: tufts breaking the outline.
        const edge = 1 + breed.fluff * 0.12 * (pixelHash(Math.floor(x / 2), Math.floor(y / 2), 91) - 0.4);
        if (d > edge) continue;
        const zone = breed.marks(part, view, u, v);
        let ramp = ramps[zone];
        if (collar && opts.collarAt !== undefined && Math.abs(v - opts.collarAt - u * u * 0.25) < 0.09) ramp = collar;
        const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d)));
        // Fur: a soft grain of strands, the pale parts kept pale.
        const grain = (valueNoise(x * 0.9, y * 0.35, 17) - 0.5) * (0.6 + breed.fluff * 0.6);
        const pale = zone === 'white' || zone === 'light' ? 0.8 : 0;
        grid.set(x, y, ramp[shadeStep(u * cos - v * sin, u * sin + v * cos, nz, x, y, true, (opts.bias ?? 0) + pale + grain)]);
      }
    }
  };

  // --- Forelegs and paws, reaching to the sill.
  const pawY = p.reach ? 58 : 68.5;
  for (const side of [-1, 1]) {
    // From the elbow, at its side, the foreleg reaches forward and up to the sill.
    const elbow: [number, number] = [cx + side * 29.5, 87];
    const wrist: [number, number] = [cx + side * (p.reach ? 25 : 23.5), pawY + 2.5];
    const legZone = breed.marks('leg', 'away', 0, 0);
    limb(g, [[X(elbow[0]), X(elbow[1])], [X(wrist[0]), X(wrist[1])]], X(12), X(9.5), ramps[legZone], { bias: side < 0 ? 0.3 : -0.3, dither: true });
    form(g, wrist[0], pawY, 7.4, 3.8, 'paw', 'away', { bias: 0.4 });
    // Toes: the creases between them.
    const ink = ramps[breed.marks('paw', 'away', 0, 0)][0];
    for (const t of [-2.3, 0, 2.3]) {
      if (t === 0) continue;
      g.set(Math.round(X(wrist[0] + t)), Math.round(X(pawY - 3)), ink);
      g.set(Math.round(X(wrist[0] + t)), Math.round(X(pawY - 2)), ink);
    }
  }

  // --- Shoulders and back, then the neck.
  const breathe = p.breathe ? 0.7 : 0;
  form(g, cx, 102 - breathe, 33, 28 + breathe, 'body', 'away', { bias: 0.6 });
  form(g, cx + (p.view === 'side' ? 1.5 : 0), 68 - breathe * 0.5, 17.5, 16, 'neck', 'away', { bias: 0.35, collarAt: look.collar !== null ? -0.1 : undefined });

  // --- The head, drawn on its own so it can turn about the neck.
  const hg = new PixelGrid(DOG_WIDTH, DOG_HEIGHT);
  const hy = 45 - breathe * 0.6 + (p.reach ? 3 : 0);
  if (p.view === 'away') drawAway(hg, cx, hy);
  else if (p.view === 'side') drawSide(hg, cx, hy);
  else drawFace(hg, cx, hy);
  const tilt = p.tilt ?? 0;
  const pivot: [number, number] = [X(p.view === 'side' ? cx - 3 : cx), X(60)];
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  for (let y = 0; y < DOG_HEIGHT; y++) {
    for (let x = 0; x < DOG_WIDTH; x++) {
      // Sample the head turned back by the tilt.
      const dx = x + 0.5 - pivot[0];
      const dy = y + 0.5 - pivot[1];
      const sx = Math.floor(pivot[0] + dx * cos + dy * sin);
      const sy = Math.floor(pivot[1] - dx * sin + dy * cos);
      const c = hg.get(sx, sy);
      if (c) g.set(x, y, c);
    }
  }
  selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };

  // --- Heads -----------------------------------------------------------------

  function ears(hgr: PixelGrid, view: View, x0: number, y0: number): void {
    const twitch = (side: number) => (p.ear && side > 0 ? 1 : 0);
    if (breed.ears === 'prick' || breed.ears === 'tipped') {
      const sides = view === 'side' ? [0] : [-1, 1];
      for (const side of sides) {
        const t = twitch(side === 0 ? 1 : side);
        const bx = view === 'side' ? x0 - 5 : x0 + side * 9.5;
        const tipX = view === 'side' ? x0 - 8 - t * 3 : x0 + side * (14 + t * 3);
        const tipY = y0 - (breed.ears === 'tipped' ? 22 : 26) + t * 3;
        const pts: Array<[number, number]> = [
          [X(bx - 7), X(y0 - 8)],
          [X(tipX), X(tipY)],
          [X(bx + 7), X(y0 - 10)],
        ];
        const zone = breed.marks('ear', 'away', 1, -1);
        hgr.polygon(pts, ramps[zone][side > 0 ? 1 : 2]);
        // The lit edge of the ear.
        hgr.line(pts[0][0] + 1, pts[0][1], pts[1][0], pts[1][1] + 1, ramps[zone][3]);
        if (view === 'face') {
          // Inside the ear: pink skin, white fur.
          const inner: Array<[number, number]> = [
            [X(bx - 3), X(y0 - 10)],
            [X(tipX - side * 0.5), X(tipY + 5)],
            [X(bx + 3), X(y0 - 11)],
          ];
          hgr.polygon(inner, breed.marks('ear', 'face', 0, 0) === 'white' ? ramps.white[3] : pinkEar);
        }
        if (breed.ears === 'tipped') {
          // The tip folds forward.
          hgr.polygon([[X(tipX - 2.5), X(tipY + 1)], [X(tipX + 2.5), X(tipY + 1)], [X(tipX + side * 2), X(tipY + 5)]], ramps[zone][0]);
        }
      }
    }
  }

  function hangingEars(hgr: PixelGrid, view: View, x0: number, y0: number): void {
    if (breed.ears !== 'drop' && breed.ears !== 'long') return;
    const long = breed.ears === 'long' ? 6 : 0;
    const zone = breed.marks('ear', view, 0, 0);
    const sides = view === 'side' ? [0] : [-1, 1];
    for (const side of sides) {
      const lift = p.ear && side >= 0 ? -2 : 0;
      const top: [number, number] = view === 'side' ? [x0 - 4, y0 - 9] : [x0 + side * 12, y0 - 9];
      const bottom: [number, number] = view === 'side' ? [x0 - 6, y0 + 8 + long + lift] : [x0 + side * (16 + long * 0.2), y0 + 7 + long + lift];
      limb(hgr, [[X(top[0]), X(top[1])], [X((top[0] + bottom[0]) / 2 + side), X((top[1] + bottom[1]) / 2)], [X(bottom[0]), X(bottom[1])]], X(8), X(9.5), ramps[zone], { dither: true, bias: side < 0 ? 0.3 : -0.2 });
    }
  }

  function drawAway(hgr: PixelGrid, x0: number, y0: number): void {
    ears(hgr, 'away', x0, y0);
    // The back of the skull, the cheeks filling out below it either side.
    for (const side of [-1, 1]) form(hgr, x0 + side * 8.5, y0 + 5, 9, 8, 'skull', 'away', { bias: side < 0 ? 0.2 : -0.2 });
    form(hgr, x0, y0 - 1, 15, 13, 'skull', 'away');
    hangingEars(hgr, 'away', x0, y0);
  }

  function drawSide(hgr: PixelGrid, x0: number, y0: number): void {
    const m = breed.muzzle;
    const sniff = p.sniff ? 1 : 0;
    const open = p.tongue ? 1.5 : 0;
    ears(hgr, 'side', x0, y0);
    form(hgr, x0 - 2, y0, 14.5, 13.5, 'skull', 'side');
    // Lower jaw, dropped a little when it pants.
    form(hgr, x0 + 7 + 4 * m, y0 + 8.5 + open, 7.5 * m, 3.4, 'muzzle', 'side', { bias: -0.3 });
    if (open) {
      // The open mouth: dark inside, the tongue lolling out over the lip.
      for (let i = X(x0 + 4); i < X(x0 + 4 + 10 * m); i++) for (let j = X(y0 + 6.5); j < X(y0 + 6.5 + open + 0.8); j++) hgr.set(Math.round(i), Math.round(j), mouth);
    }
    form(hgr, x0 + 8 + 5 * m + sniff * 0.6, y0 + 3.2, 8.5 * m + 1.5, 6, 'muzzle', 'side', { a: -0.06 });
    // The nose at the tip, wet and shining.
    const nx = x0 + 8 + 13.5 * m + sniff;
    form(hgr, nx - 1, y0 + 1.5 - sniff * 0.3, 2.6, 2.1, 'muzzle', 'side');
    for (let j = -1; j <= 1; j++) for (let i = -2; i <= 0; i++) hgr.set(Math.round(X(nx) + i), Math.round(X(y0 + 1.5) + j), noseRamp[j < 0 && i === -1 ? 3 : 1]);
    hgr.set(Math.round(X(nx) - 1), Math.round(X(y0 + 0.5)), glint);
    // The lip line.
    if (!open) for (let i = X(x0 + 6); i < X(x0 + 6 + 8 * m); i++) hgr.set(Math.round(i), Math.round(X(y0 + 7)), ramps.dark[0]);
    if (p.tongue) {
      const tx = x0 + 9 + 4 * m;
      limb(hgr, [[X(tx), X(y0 + 7)], [X(tx + 1), X(y0 + 7 + p.tongue * 0.6)], [X(tx + 0.5), X(y0 + 7 + p.tongue)]], X(4.2), X(4.8), tongue, { dither: false });
      // Its crease.
      for (let j = 1; j < p.tongue; j++) hgr.set(Math.round(X(tx + 0.6)), Math.round(X(y0 + 7 + j)), tongue[1]);
    }
    if (p.lick) {
      // Tongue curled up over the nose.
      limb(hgr, [[X(nx - 3), X(y0 + 6)], [X(nx + 0.5), X(y0 + 4)], [X(nx + 0.5), X(y0 + 1.5)]], X(3.2), X(3.6), tongue, { dither: false });
    }
    // The eye, with a brow above it.
    const ex = Math.round(X(x0 + 4.5));
    const ey = Math.round(X(y0 - 3));
    if (p.eyes === 'shut') {
      for (let i = -1; i <= 2; i++) hgr.set(ex + i, ey + 1, ramps.dark[0]);
    } else {
      for (let j = 0; j < 3; j++) for (let i = -1; i <= 2; i++) if (!(j !== 1 && (i === -1 || i === 2))) hgr.set(ex + i, ey + j, eyeR);
      hgr.set(ex + 1, ey + 1, pupil);
      hgr.set(ex + 2, ey + 1, pupil);
      hgr.set(ex + 1, ey, glint);
      for (let i = -1; i <= 2; i++) hgr.set(ex + i, ey - 1, ramps.dark[1]);
    }
    hangingEars(hgr, 'side', x0, y0);
  }

  function drawFace(hgr: PixelGrid, x0: number, y0: number): void {
    ears(hgr, 'face', x0, y0);
    for (const side of [-1, 1]) form(hgr, x0 + side * 8, y0 + 4, 9, 8, 'skull', 'face', { bias: side < 0 ? 0.2 : -0.2 });
    form(hgr, x0, y0, 15.5, 13.5, 'skull', 'face');
    hangingEars(hgr, 'face', x0, y0);
    // The muzzle, broad, and the nose on it.
    form(hgr, x0, y0 + 7, 7.5 * Math.min(1.1, breed.muzzle), 6, 'muzzle', 'face', { bias: 0.2 });
    const nx = X(x0);
    const ny = X(y0 + 4.5);
    hgr.ellipse(nx, ny, X(3.4), X(2.2), (u, v, x, y) => noseRamp[v < -0.2 && u < 0 ? 3 : pixelHash(x, y, 3) < 0.15 ? 2 : 1]);
    hgr.set(Math.round(nx - X(1.5)), Math.round(ny - X(1)), glint);
    // Nostrils.
    hgr.set(Math.round(nx - X(1.4)), Math.round(ny + X(0.6)), noseRamp[0]);
    hgr.set(Math.round(nx + X(1.2)), Math.round(ny + X(0.6)), noseRamp[0]);
    // The mouth: a soft 'w' under the nose, or wide open for panting.
    const my = y0 + 8;
    if (p.tongue) {
      hgr.ellipse(X(x0), X(my + 1), X(4.6), X(2.4), mouth);
      limb(hgr, [[X(x0), X(my + 1)], [X(x0 + 0.4), X(my + 1 + p.tongue * 0.6)], [X(x0), X(my + 1 + p.tongue)]], X(5.2), X(5.8), tongue, { dither: false });
      for (let j = 1; j < p.tongue; j++) hgr.set(Math.round(X(x0)), Math.round(X(my + 1 + j)), tongue[1]);
    } else {
      hgr.set(Math.round(X(x0)), Math.round(X(my - 1.5)), ramps.dark[0]);
      for (const s of [-1, 1]) {
        hgr.set(Math.round(X(x0 + s * 1)), Math.round(X(my)), ramps.dark[0]);
        hgr.set(Math.round(X(x0 + s * 2.2)), Math.round(X(my)), ramps.dark[0]);
        hgr.set(Math.round(X(x0 + s * 3.2)), Math.round(X(my - 0.8)), ramps.dark[0]);
      }
      if (p.lick) limb(hgr, [[X(x0 + 1), X(my)], [X(x0 + 2.5), X(my - 2)], [X(x0 + 2), X(my - 3.5)]], X(3.4), X(3.6), tongue, { dither: false });
    }
    // Eyes: big, dark, shining; brows over them.
    for (const side of [-1, 1]) {
      const ex = Math.round(X(x0 + side * 6.2));
      const ey = Math.round(X(y0 - 2));
      if (p.eyes === 'shut') {
        for (let i = -1; i <= 2; i++) hgr.set(ex + i, ey + 1 + (i === -1 || i === 2 ? -1 : 0), ramps.dark[0]);
        continue;
      }
      const iris = side < 0 ? eyeL : eyeR;
      for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) if (!((j === -1 || j === 2) && (i === -1 || i === 2))) hgr.set(ex + i, ey + j, iris);
      hgr.rect(ex, ey, 2, 2, pupil);
      hgr.set(ex, ey, glint);
      hgr.set(ex + 1, ey - 2, ramps.light[3]);
      hgr.set(ex, ey - 2, ramps.light[3]);
    }
  }
}

export class DogSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(look: DogLook, pose: DogPose): Texture {
    const key = `${dogLookKey(look)}:${pose}`;
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, palette } = drawWindowDog(look, pose);
      texture = gridToTexture(grid, palette.colors);
      this.cache.set(key, texture);
    }
    return texture;
  }
}
