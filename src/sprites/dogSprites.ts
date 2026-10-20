import type { Texture } from 'pixi.js';
import { luminance } from '../core/color';
import { DrawnCache } from './cache';
import { limb, Palette, selOut, valueNoise, type Ramp } from './kit';
import { PixelGrid } from './raster';
import { furGrain, Sculpt, type Pt, type SculptPixel } from './sculpt';

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
  | 'side' | 'side-breathe' | 'side-blink' | 'side-ear' | 'side-pant-1' | 'side-pant-2' | 'side-pant-3' | 'side-lick' | 'side-sniff' | 'side-up' | 'side-up-pant' | 'howl'
  | 'face' | 'face-blink' | 'face-pant-1' | 'face-pant-2' | 'face-pant-3' | 'face-tilt' | 'face-tilt-pant' | 'face-lick';

export const DOG_PANT_SIDE: readonly DogPose[] = ['side-pant-1', 'side-pant-2', 'side-pant-3', 'side-pant-2'];
export const DOG_PANT_FACE: readonly DogPose[] = ['face-pant-1', 'face-pant-2', 'face-pant-3', 'face-pant-2'];
export const DOG_POSES: readonly DogPose[] = [
  'reach', 'away', 'away-breathe', 'away-ear',
  'side', 'side-breathe', 'side-blink', 'side-ear', 'side-pant-1', 'side-pant-2', 'side-pant-3', 'side-lick', 'side-sniff', 'side-up', 'side-up-pant', 'howl',
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
  /**
   * Which colour each part of the dog is, at (u, v) across it (−1..1 each
   * way over the part's frame; for the head, the skull's frame, so a mask
   * can run across skull and muzzle alike).
   */
  marks: (part: Part, view: View, u: number, v: number) => Zone;
}

/** How far out from the spine a saddle reaches at v down the back (body frame): broad over the shoulders, narrowing and rounding off lower down. */
function saddle(v: number, width: number): number {
  const t = Math.max(0, v + 1.45);
  return width * Math.max(0, 1 - 0.26 * t * t);
}

const BREEDS: Record<DogBreed, Breed> = {
  husky: {
    ears: 'prick',
    muzzle: 1,
    fluff: 0.6,
    coats: [
      { base: 0x6c707c, dark: 0x3c3e48, light: 0xd8dae0 },
      { base: 0xa8643c, dark: 0x6e3a22, light: 0xf0dccc },
      { base: 0x34343c, dark: 0x202026, light: 0xdcdce2 },
    ],
    marks: (part, view, u, v) => {
      const au = Math.abs(u);
      const inside = (cu: number, cv: number, ru: number, rv: number) => ((au - cu) / ru) ** 2 + ((v - cv) / rv) ** 2 < 1;
      switch (part) {
        case 'skull':
          if (view === 'away') return au > 0.86 && v > 0.35 ? 'white' : 'base';
          if (view === 'face') {
            // The mask, as on the reference husky: white brows over dark-rimmed eyes, a dark cap
            // with a widow's peak running down between them, dark down the sides of the head, the rest white.
            if (inside(0.38, -0.56, 0.17, 0.1)) return 'white';
            if (inside(0.4, -0.2, 0.25, 0.15)) return 'base';
            if (au > 0.55 && au < 1 && Math.abs(v - (-0.24 + (au - 0.55) * 0.5)) < 0.09) return 'base';
            if (v < -0.64 + Math.max(0, au - 0.62) * 2.2) return 'base';
            if (v < -0.08 && au < 0.13 * (1 - (v + 0.64) / 0.6)) return 'base';
            return 'white';
          }
          // In profile: a dark cap and back of the head, a white brow spot, a dark line back from the eye, a white cheek.
          if (((u - 0.3) / 0.16) ** 2 + ((v + 0.58) / 0.1) ** 2 < 1) return 'white';
          if (v < -0.4 + Math.max(0, -u) * 0.25 || u < -0.55 + Math.max(0, v) * 0.2) return 'base';
          if (u > -0.3 && u < 0.45 && Math.abs(v - (-0.32 - (u - 0.3) * 0.25)) < 0.09) return 'base';
          return 'white';
        case 'muzzle':
          // A grey bridge along the top of the muzzle.
          if (view === 'side') return v < -0.45 + u * 0.1 && u < 0.8 ? 'base' : 'white';
          return 'white';
        case 'ear':
          return view === 'face' && au < 0.35 && v > -0.3 ? 'white' : 'base';
        case 'neck':
          if (view === 'face') return v > 0.1 || au < 0.35 ? 'white' : 'base';
          return au > 0.72 ? 'white' : 'base';
        case 'body':
          // A dark saddle down the back, grey sides, white flanks.
          return au < saddle(v, 0.42) ? 'dark' : au > 0.8 ? 'white' : 'base';
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
          if (view === 'face') return Math.abs(u) < 0.2 - v * 0.12 && v < 0.05 && v > -0.75 ? 'dark' : v > 0.3 && Math.abs(u) < 0.6 ? 'light' : 'base';
          return v < -0.45 && u < 0.3 ? 'dark' : u > 0.15 && v > 0.05 ? 'light' : 'base';
        case 'muzzle':
          // A black muzzle, tan beneath the jaw and up the cheeks.
          if (view === 'face') return v < 0.15 || (Math.abs(u) < 0.45 && v < 0.5) ? 'dark' : 'light';
          return v < 0.45 ? 'dark' : 'base';
        case 'ear':
          return view === 'face' && Math.abs(u) < 0.35 && v > -0.3 ? 'light' : 'dark';
        case 'neck':
          return view === 'face' ? (v > 0.2 ? 'light' : 'base') : v < 0.1 && Math.abs(u) < 0.7 ? 'dark' : 'base';
        case 'body':
          // The black saddle.
          return Math.abs(u) < saddle(v, 0.82) ? 'dark' : 'base';
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
    fluff: 0.7,
    coats: [
      { base: 0xd0a462, dark: 0xa87c40, light: 0xecd09c },
      { base: 0xe8c488, dark: 0xc89c5c, light: 0xf8e4bc },
      { base: 0xb27a48, dark: 0x865632, light: 0xd6aa78 },
    ],
    marks: (part, view, u, v) => {
      if (part === 'muzzle' || part === 'paw') return 'light';
      if (part === 'ear') return 'dark';
      if (part === 'neck' && (view === 'face' ? v > 0.1 : Math.abs(u) > 0.7)) return 'light';
      if (part === 'body' && Math.abs(u) > 0.82) return 'light';
      if (part === 'skull' && view === 'face' && v > 0.3) return 'light';
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
    muzzle: 1.15,
    fluff: 0.7,
    coats: [
      { base: 0x26262c, dark: 0x18181c, light: 0xf2f0ec },
      { base: 0x6a3e24, dark: 0x4a2a18, light: 0xf2f0ec },
    ],
    marks: (part, view, u, v) => {
      switch (part) {
        case 'skull':
          // The white blaze down its face.
          if (view === 'face') return Math.abs(u) < 0.13 + Math.max(0, v) * 0.55 ? 'white' : 'base';
          if (view === 'side') return u > 0.35 && v > -0.3 ? 'white' : 'base';
          return 'base';
        case 'muzzle':
          return 'white';
        case 'neck':
          // Its white ruff, right round the neck.
          return v > 0.2 || (view === 'face' && Math.abs(u) < 0.5) ? 'white' : 'base';
        case 'body':
          return Math.abs(u) > 0.84 ? 'white' : 'base';
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
          if (view === 'face') return Math.abs(u) < 0.11 + Math.max(0, v) * 0.5 ? 'white' : 'base';
          if (view === 'side') return u > 0.5 && v > -0.1 ? 'white' : 'base';
          return 'base';
        case 'muzzle':
          return 'white';
        case 'ear':
          return 'base';
        case 'neck':
          return view === 'face' ? (v > 0.1 ? 'white' : 'base') : v > 0.5 ? 'white' : 'base';
        case 'body':
          // Tricolour: a black saddle, tan at its edges.
          return Math.abs(u) < saddle(v, 0.7) ? 'dark' : 'base';
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
  /** Howling: the mouth open in an O, no tongue. */
  howl?: boolean;
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
    case 'howl':
      // Muzzle to the sky, eyes shut, mouth rounded.
      return { view: 'side', tilt: -0.8, howl: true, eyes: 'shut' };
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

// Part ids in the sculpts.
const BODY = 1;
const NECK = 2;
const LEG = 3;
const PAW = 4;
const SKULL = 5;
const MUZZLE = 6;
const JAW = 7;
const EAR = 8;
const EAR_IN = 9;
const NOSE = 10;
const CHEEK = 11;

const PART_OF: Record<number, Part> = { [BODY]: 'body', [NECK]: 'neck', [LEG]: 'leg', [PAW]: 'paw', [SKULL]: 'skull', [MUZZLE]: 'muzzle', [JAW]: 'muzzle', [EAR]: 'ear', [EAR_IN]: 'ear', [NOSE]: 'muzzle', [CHEEK]: 'skull' };

/** Shading for a shoulder blade or brow under the fur: a low dome at (cx, cy), `r` across, as a shade bias. */
function bump(x: number, y: number, cx: number, cy: number, r: number, k: number): number {
  const dx = (x + 0.5 - cx) / r;
  const dy = (y + 0.5 - cy) / r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= 1) return 0;
  // Lit on its upper left, shaded on its lower right.
  return (-dx * 0.5 - dy * 0.7) * (1 - d2) * k;
}

/**
 * Draw the dog in a DOG_WIDTH × DOG_HEIGHT box, its paws on the sill at
 * DOG_SURFACE_ROW and the rest of it running off the bottom: a broad back
 * with the shoulder blades moving under the fur, a thick neck in a ruff,
 * forelegs coming up from the elbows and bending at the wrist onto the
 * sill, paws with their toes. Its head, looking out (the back of the skull,
 * the ears, cheek fur), turned to the side (a real profile: the occiput,
 * the brow and stop, a long muzzle, the lower jaw and lip, a wet nose, an
 * almond eye under its brow), or turned round to you (a broad skull and
 * cheeks, a narrower muzzle, eyes set apart under the brows, the nose and
 * the mouth, its tongue out, head on one side). Breed markings: a husky's
 * mask, a shepherd's saddle and black muzzle, a collie's blaze and ruff, a
 * beagle's tricolour, a golden's feathering.
 */
export function drawWindowDog(look: DogLook, pose: DogPose): { grid: PixelGrid; palette: Palette } {
  const breed = BREEDS[look.breed];
  const coat = breed.coats[look.coat % breed.coats.length];
  const p = poseOf(pose);
  const palette = new Palette();
  const ramps: Record<Zone, Ramp> = {
    // Pale coats keep their shadows soft (a golden's shade shouldn't go fox-red).
    base: palette.ramp(coat.base, luminance(coat.base) > 0.45 ? 0.4 : 0.5, luminance(coat.base) > 0.45 ? 0.3 : 1),
    dark: palette.ramp(coat.dark, 0.55),
    light: palette.ramp(coat.light, 0.42, 0.3),
    white: palette.ramp(0xf0eee8, 0.42),
  };
  const noseRamp = palette.ramp(0x2a2426, 0.6);
  const tongue = palette.ramp(0xe8788a, 0.5);
  const mouth = palette.add(0x3a1a20);
  const gum = palette.add(0x6a2a32);
  const pinkEar = palette.ramp(0xd89a98, 0.4);
  const eyeColour = (side: number) => palette.ramp(look.eyes === 'blue' || (look.eyes === 'odd' && side > 0) ? 0x78b8e8 : 0x7a4a24, 0.6);
  const eyeL = eyeColour(-1);
  const eyeR = eyeColour(1);
  const pupil = palette.add(0x100c0c);
  const glint = palette.add(0xffffff);
  const collar = look.collar !== null ? palette.ramp(COLLARS[look.collar], 0.6) : null;
  const tag = palette.ramp(0xe8c84a, 0.6);
  const X = (x: number) => x * K;
  const P = (x: number, y: number): Pt => [x * K, y * K];
  const cx = 48;
  const fluffy = breed.fluff;

  /** Which colour a pixel is: the breed's markings, their edges broken up like real fur. */
  let memo = { x: -1, y: -1, part: 0, zone: 'base' as Zone };
  const zoneAt = (view: View, q: SculptPixel): Zone => {
    // The colour and the shade of a pixel both ask: work it out once.
    if (memo.x === q.x && memo.y === q.y && memo.part === q.part) return memo.zone;
    const ju = (valueNoise(q.x / 1.6, q.y / 2.4, 61) - 0.5) * 0.1;
    const jv = (valueNoise(q.x / 2.4, q.y / 1.6, 62) - 0.5) * 0.1;
    memo = { x: q.x, y: q.y, part: q.part, zone: breed.marks(PART_OF[q.part], view, q.u + ju, q.v + jv) };
    return memo.zone;
  };
  const coatColour = (view: View) => (q: SculptPixel): Ramp => ramps[zoneAt(view, q)];
  const coatBias = (view: View, extra?: (q: SculptPixel) => number) => (q: SculptPixel): number => {
    const zone = zoneAt(view, q);
    // Pale fur stays pale in shade; the light from the window catches the upper edges.
    const pale = zone === 'white' || zone === 'light' ? 0.75 : 0;
    const rim = q.depth < 1.6 && q.ny < -0.25 ? 0.7 : 0;
    // Fur on the body and neck runs down; on the legs, along them; on the head, back from the face.
    const angle = q.part === LEG ? Math.PI / 2 + q.v * 0.2 : q.part === SKULL || q.part === CHEEK ? Math.PI / 2 - 0.5 : Math.PI / 2;
    return pale + rim + furGrain(q.x, q.y, angle, 17) * (0.7 + fluffy * 0.45) + (extra?.(q) ?? 0);
  };

  // --- The body: back and shoulders, the neck rising out of them, the forelegs and paws. ---
  const body = new Sculpt(DOG_WIDTH, DOG_HEIGHT);
  const breathe = p.breathe ? 0.8 : 0;
  const pawY = p.reach ? 58 : 68.5;
  // The forelegs reach forward over the sill from in front of its chest, so from behind they're mostly
  // hidden by its shoulders: only the forearms show beside the neck, and the paws on the sill.
  for (const side of [-1, 1]) {
    const elbow: Pt = [cx + side * 26.5, 86];
    const wrist: Pt = [cx + side * (p.reach ? 25 : 23.5), pawY + 2.5];
    body.sweep(LEG, [P(...elbow), P(cx + side * 25.5, (86 + pawY) / 2 + 1), P(...wrist)], [X(10.5), X(9), X(8.2)], { fur: fluffy ? { amount: fluffy * 0.45, dir: [side, 0], seed: 5 + side } : undefined, bleed: true });
  }
  body.outline(BODY, [P(34, 61 - breathe), P(24, 65.5 - breathe), P(16.5, 72.5), P(13, 81), P(14, 92), P(17, 104), P(79, 104), P(82, 92), P(83, 81), P(79.5, 72.5), P(72, 65.5 - breathe), P(62, 61 - breathe)], {
    frame: { cx: X(cx), cy: X(102), rx: X(33), ry: X(28) },
    fur: fluffy ? { amount: fluffy * 0.55, dir: [0, 1], seed: 3 } : undefined,
    bleed: true,
  });
  body.outline(NECK, [P(35, 49), P(31.5, 57), P(29, 65), P(30.5, 72), P(48, 74), P(65.5, 72), P(67, 65), P(64.5, 57), P(61, 49)], {
    frame: { cx: X(cx), cy: X(68), rx: X(17.5), ry: X(16) },
    fur: fluffy ? { amount: fluffy * 0.8, dir: [0, 1], seed: 9 } : undefined,
  });
  // The paws resting on the sill: the top of the foot, toes at the far edge.
  for (const side of [-1, 1]) {
    const wx = cx + side * (p.reach ? 25 : 23.5);
    body.outline(PAW, [P(wx - 6.8, pawY + 3.2), P(wx - 7.6, pawY - 0.5), P(wx - 5.6, pawY - 3.6), P(wx, pawY - 4.6), P(wx + 5.6, pawY - 3.6), P(wx + 7.6, pawY - 0.5), P(wx + 6.8, pawY + 3.2)], {
      frame: { cx: X(wx), cy: X(pawY), rx: X(7.4), ry: X(4) },
      round: 4,
    });
  }
  const g = new PixelGrid(DOG_WIDTH, DOG_HEIGHT);
  body.paint(
    g,
    (q) => {
      // The collar round the neck, following its curve.
      if (collar && q.part === NECK && Math.abs(q.v + 0.05 - q.u * q.u * 0.28) < 0.1) return collar;
      return coatColour('away')(q);
    },
    {
      bias: coatBias('away', (q) =>
        q.part === BODY
          ? bump(q.x, q.y, X(cx - 14), X(74), X(13), 1.1) + bump(q.x, q.y, X(cx + 14), X(74), X(13), 1.1) - (Math.abs(q.x + 0.5 - X(cx)) < X(1.2) && q.y > X(70) ? 0.6 : 0)
          : q.part === PAW
            ? 0.5
            : 0,
      ),
    },
  );
  // Toes: the creases between them, down from the far edge of each paw; the collar's tag.
  for (const side of [-1, 1]) {
    const wx = cx + side * (p.reach ? 25 : 23.5);
    const ink = ramps[breed.marks('paw', 'away', 0, 0)][0];
    for (const t of [-3.4, 0, 3.4]) for (let j = 0; j < 3; j++) g.set(Math.round(X(wx + t)), Math.round(X(pawY - 4.2)) + j, ink);
  }

  // --- The head, drawn on its own so it can turn about the neck. ---
  const hy = 45 - breathe * 0.6 + (p.reach ? 3 : 0);
  const head = new Sculpt(DOG_WIDTH, DOG_HEIGHT);
  const hg = new PixelGrid(DOG_WIDTH, DOG_HEIGHT);
  if (p.view === 'away') drawAway(cx, hy);
  else if (p.view === 'side') drawSide(cx, hy);
  else drawFace(cx, hy);
  const tilt = p.tilt ?? 0;
  const pivot: Pt = [X(p.view === 'side' ? cx - 3 : cx), X(60)];
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  for (let y = 0; y < DOG_HEIGHT; y++) {
    for (let x = 0; x < DOG_WIDTH; x++) {
      // Sample the head turned back by the tilt.
      const dx = x + 0.5 - pivot[0];
      const dy = y + 0.5 - pivot[1];
      const c = hg.get(Math.floor(pivot[0] + dx * cos + dy * sin), Math.floor(pivot[1] - dx * sin + dy * cos));
      if (c) g.set(x, y, c);
    }
  }
  // The collar's tag hanging at the throat, when the head's not over it.
  if (collar && p.view !== 'face') {
    const ty = Math.round(X(67.5));
    for (let j = 0; j < 3; j++) for (let i = -1; i <= 1; i++) if (!(Math.abs(i) === 1 && j === 2) && !hg.get(Math.round(X(cx)) + i, ty + j)) g.set(Math.round(X(cx)) + i, ty + j, tag[j === 0 && i < 1 ? 3 : 2]);
  }
  selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };

  // --- Heads -----------------------------------------------------------------

  /** Pricked or folded ears standing up from the skull; `sides` are −1 and 1 seen face-on or from behind, 0 in profile. */
  function standingEars(view: View, x0: number, y0: number): void {
    if (breed.ears !== 'prick' && breed.ears !== 'tipped') return;
    const sides = view === 'side' ? [0] : [-1, 1];
    const tall = breed.ears === 'tipped' ? 21 : 26;
    for (const side of sides) {
      const twitch = p.ear && side >= 0 ? 1 : 0;
      if (view === 'side') {
        // In profile: set back on the skull, leaning back a little.
        const tip: Pt = [x0 - 8 - twitch * 3, y0 - tall + 2 + twitch * 3];
        head.outline(EAR, [P(x0 - 11, y0 - 8), P(x0 - 12, y0 - 16), P(...tip), P(x0 - 4.5, y0 - 17), P(x0 - 1.5, y0 - 10)], { sharp: true, frame: { cx: X(x0 - 6), cy: X(y0 - 16), rx: X(6), ry: X(10) }, round: 3 });
        continue;
      }
      const tip: Pt = [x0 + side * (13.5 + twitch * 3), y0 - tall + twitch * 3];
      const outer: Pt = [x0 + side * 15.5, y0 - 7];
      const inner: Pt = [x0 + side * 4.5, y0 - 12];
      head.outline(EAR, [P(...outer), P(x0 + side * 16.5, y0 - 15), P(...tip), P(x0 + side * 8, y0 - 18), P(...inner)], { sharp: true, frame: { cx: X(x0 + side * 11), cy: X(y0 - 15), rx: X(6), ry: X(10) }, round: 3 });
      if (view === 'face') {
        // Inside the ear: pink skin, tufts of pale fur at its base.
        head.outline(EAR_IN, [P(x0 + side * 13, y0 - 10), P(tip[0] - side * 1.2, tip[1] + 5), P(x0 + side * 8, y0 - 13)], { sharp: true, round: 2 });
      }
    }
  }

  /** Drop ears and a beagle's long ones, hanging beside the face. */
  function hangingEars(view: View, x0: number, y0: number): void {
    if (breed.ears !== 'drop' && breed.ears !== 'long') return;
    const long = breed.ears === 'long' ? 6 : 0;
    const fur = fluffy ? { amount: fluffy * 0.6, dir: [0, 1] as Pt, seed: 21 } : undefined;
    if (view === 'side') {
      const lift = p.ear ? -2 : 0;
      head.outline(EAR, [P(x0 - 9, y0 - 9), P(x0 - 1, y0 - 10), P(x0 - 1, y0 + 2 + lift), P(x0 - 4, y0 + 9 + long + lift), P(x0 - 9, y0 + 9 + long + lift), P(x0 - 11.5, y0 + 1)], { frame: { cx: X(x0 - 5), cy: X(y0), rx: X(5), ry: X(10) }, fur });
      return;
    }
    for (const side of [-1, 1]) {
      const lift = p.ear && side > 0 ? -2 : 0;
      head.outline(EAR, [P(x0 + side * 8, y0 - 12), P(x0 + side * 14.5, y0 - 10.5), P(x0 + side * (18 + long * 0.2), y0 - 1), P(x0 + side * (17.5 + long * 0.2), y0 + 8 + long + lift), P(x0 + side * (13.5 + long * 0.2), y0 + 10 + long + lift), P(x0 + side * 12, y0 + 1), P(x0 + side * 10.5, y0 - 7)], {
        frame: { cx: X(x0 + side * 14), cy: X(y0), rx: X(5), ry: X(11) },
        fur,
      });
    }
  }

  function paintHead(view: View): void {
    head.paint(
      hg,
      (q) => {
        if (q.part === NOSE) return noseRamp;
        if (q.part === EAR_IN) return breed.marks('ear', 'face', 0, 0) === 'white' ? ramps.white : pinkEar;
        if (q.part === EAR) return ramps[breed.marks('ear', view, q.u, q.v)];
        return coatColour(view)(q);
      },
      { bias: (q) => (q.part === NOSE ? 0 : q.part === EAR_IN ? 0.4 : coatBias(view)(q)) },
    );
  }

  function drawAway(x0: number, y0: number): void {
    standingEars('away', x0, y0);
    // The back of the skull, the cheeks filling out below it either side.
    head.outline(SKULL, [P(x0 - 10.5, y0 - 12.5), P(x0, y0 - 15), P(x0 + 10.5, y0 - 12.5), P(x0 + 14.5, y0 - 4), P(x0 + 16, y0 + 4), P(x0 + 14.5, y0 + 10.5), P(x0 + 8, y0 + 14), P(x0 - 8, y0 + 14), P(x0 - 14.5, y0 + 10.5), P(x0 - 16, y0 + 4), P(x0 - 14.5, y0 - 4)], {
      frame: { cx: X(x0), cy: X(y0 - 1), rx: X(15), ry: X(13) },
      fur: fluffy ? { amount: fluffy * 0.7, seed: 13 } : undefined,
    });
    hangingEars('away', x0, y0);
    paintHead('away');
  }

  function drawSide(x0: number, y0: number): void {
    const m = breed.muzzle;
    const L = 12.5 * m;
    const sniff = p.sniff ? 1 : 0;
    const open = p.tongue ? 2.2 : p.howl ? 3.2 : 0;
    standingEars('side', x0, y0);
    hangingEars('side', x0, y0);
    // The skull in profile: occiput, crown, brow, and the cheek down into the throat.
    const frame = { cx: X(x0 - 1), cy: X(y0), rx: X(14), ry: X(13) };
    head.outline(SKULL, [P(x0 - 14, y0 - 2), P(x0 - 10, y0 - 10.5), P(x0 - 2, y0 - 13), P(x0 + 4, y0 - 11.5), P(x0 + 8, y0 - 7), P(x0 + 9, y0 - 1), P(x0 + 6, y0 + 6), P(x0 - 1, y0 + 10.5), P(x0 - 10, y0 + 12), P(x0 - 15, y0 + 6)], {
      frame,
      fur: fluffy ? { amount: fluffy * 0.65, dir: [-1, 0.6], seed: 23 } : undefined,
    });
    // The lower jaw, dropped when it pants or howls; the mouth dark behind it.
    if (open) head.outline(JAW, [P(x0 + 2, y0 + 3), P(x0 + 6 + L * 0.85, y0 + 2.5 + open * 0.6), P(x0 + 6 + L * 0.8, y0 + 5 + open), P(x0 + 2, y0 + 7 + open * 0.6)], { frame: { cx: X(x0 + 6 + L * 0.4), cy: X(y0 + 4), rx: X(L * 0.6), ry: X(3) } });
    head.outline(JAW, [P(x0 + 1, y0 + 3.5 + open * 0.3), P(x0 + 5 + L * 0.7, y0 + 4.5 + open * 1.2), P(x0 + 6 + L * 0.95, y0 + 5.2 + open * 1.4), P(x0 + 5 + L * 0.75, y0 + 7.2 + open * 1.3), P(x0 + 1, y0 + 8.5 + open * 0.6), P(x0 - 3, y0 + 7)], {
      frame: { cx: X(x0 + 3 + L * 0.5), cy: X(y0 + 5), rx: X(L * 0.6), ry: X(3) },
      round: 3,
    });
    // The muzzle: from the stop out to the nose, the upper lip hanging over the jaw.
    const tipX = x0 + 7 + L + sniff;
    head.outline(MUZZLE, [P(x0 + 3, y0 - 6.5), P(x0 + 8, y0 - 7.2), P(x0 + 8 + L * 0.55, y0 - 5.6), P(tipX - 0.5, y0 - 4.3 - sniff * 0.3), P(tipX + 1, y0 - 1.5), P(tipX - 0.2, y0 + 2), P(x0 + 6 + L * 0.6, y0 + 4.2 + open * 0.4), P(x0 + 3, y0 + 5), P(x0 + 1, y0 + 1)], {
      frame: { cx: X(x0 + 3 + L * 0.6), cy: X(y0 - 1), rx: X(L * 0.65), ry: X(6) },
      round: 5,
    });
    // The nose at the tip, wet and shining.
    head.ellipse(NOSE, X(tipX - 0.4), X(y0 - 2.6 - sniff * 0.3), X(2.5), X(2.1), 0, { round: 2 });
    paintHead('side');
    const dark = ramps.dark[0];
    // Its nostril and glint; the lip line.
    hg.set(Math.round(X(tipX)), Math.round(X(y0 - 1.6)), noseRamp[0]);
    hg.set(Math.round(X(tipX - 1.2)), Math.round(X(y0 - 3.6)), glint);
    if (!open) for (let i = X(x0 + 4); i < X(x0 + 6 + L * 0.85); i++) hg.set(Math.round(i), Math.round(X(y0 + 4.6 + ((i / K - x0) / L) * 0.4)), dark);
    else {
      // The open mouth: a dark wedge between the lips, deepest at the back, gum along the upper lip.
      hg.polygon([P(x0 + 3, y0 + 4.2), P(x0 + 5 + L * 0.85, y0 + 3.6 + open * 0.35), P(x0 + 5 + L * 0.8, y0 + 4.4 + open * 0.9), P(x0 + 3.5, y0 + 4.8 + open * 0.8)], mouth);
      if (!p.howl) for (let i = X(x0 + 4); i < X(x0 + 4 + L * 0.8); i++) hg.set(Math.round(i), Math.round(X(y0 + 4.3 + ((i / K - x0 - 4) / L) * -0.3)), gum);
    }
    if (p.tongue) {
      const tx = x0 + 7 + 3.5 * m;
      limb(hg, [P(tx, y0 + 5.6), P(tx + 1.2, y0 + 6 + p.tongue * 0.6), P(tx + 0.6, y0 + 6 + p.tongue)], X(4.4), X(5), tongue, { dither: false });
      for (let j = 1; j < p.tongue; j++) hg.set(Math.round(X(tx + 0.7)), Math.round(X(y0 + 6 + j)), tongue[1]);
    }
    if (p.lick) limb(hg, [P(tipX - 3, y0 + 4.5), P(tipX + 0.8, y0 + 2.5), P(tipX + 0.6, y0)], X(3.2), X(3.6), tongue, { dither: false });
    // The eye: almond, set at the stop, a dark rim, under a brow.
    const ex = Math.round(X(x0 + 4));
    const ey = Math.round(X(y0 - 5));
    if (p.eyes === 'shut') {
      for (let i = -2; i <= 2; i++) hg.set(ex + i, ey + 1 + (Math.abs(i) === 2 ? -1 : 0), dark);
    } else {
      for (let j = -1; j <= 2; j++) for (let i = -2; i <= 3; i++) if (!((j === -1 || j === 2) && (i <= -1 || i >= 2))) hg.set(ex + i, ey + j, eyeR[2]);
      hg.rect(ex, ey, 2, 2, pupil);
      hg.set(ex + 1, ey - 1, eyeR[3]);
      hg.set(ex, ey, glint);
      // The dark rim round it, heavier at the corners.
      for (const [i, j] of [[-3, 0], [-3, 1], [-2, 2], [-1, 3], [0, 3], [1, 3], [2, 2], [3, 2], [4, 1], [-2, -1], [-1, -2], [0, -2], [1, -2], [2, -1], [3, -1]] as const) hg.set(ex + i, ey + j, dark);
    }
    // The brow ridge over it.
    for (let i = -2; i <= 3; i++) hg.set(ex + i, ey - 3, ramps[breed.marks('skull', 'side', 0.2, -0.6)][3]);
  }

  function drawFace(x0: number, y0: number): void {
    standingEars('face', x0, y0);
    const fur = fluffy ? { amount: fluffy * 0.75, seed: 31 } : undefined;
    // A broad skull, the cheeks fuller than the muzzle, the jaw narrowing to the chin.
    head.outline(SKULL, [P(x0 - 10, y0 - 13), P(x0, y0 - 15), P(x0 + 10, y0 - 13), P(x0 + 14, y0 - 6.5), P(x0 + 16.5, y0 + 1.5), P(x0 + 15.5, y0 + 8.5), P(x0 + 9.5, y0 + 13), P(x0, y0 + 14.5), P(x0 - 9.5, y0 + 13), P(x0 - 15.5, y0 + 8.5), P(x0 - 16.5, y0 + 1.5), P(x0 - 14, y0 - 6.5)], {
      frame: { cx: X(x0), cy: X(y0), rx: X(15.5), ry: X(13.5) },
      fur,
    });
    hangingEars('face', x0, y0);
    // The muzzle, narrower, coming towards us; the nose on its tip.
    const mw = Math.min(1.1, breed.muzzle);
    head.outline(MUZZLE, [P(x0 - 5.5 * mw, y0 + 0.5), P(x0 - 7.5 * mw, y0 + 6), P(x0 - 5.5 * mw, y0 + 10.5), P(x0, y0 + 12), P(x0 + 5.5 * mw, y0 + 10.5), P(x0 + 7.5 * mw, y0 + 6), P(x0 + 5.5 * mw, y0 + 0.5), P(x0, y0 - 1)], {
      frame: { cx: X(x0), cy: X(y0 + 7), rx: X(7.5), ry: X(6) },
      round: 5,
    });
    head.ellipse(NOSE, X(x0), X(y0 + 4.6), X(3.6), X(2.4), 0, { round: 2 });
    paintHead('face');
    const dark = ramps.dark[0];
    const nx = X(x0);
    const ny = X(y0 + 4.6);
    hg.set(Math.round(nx - X(1.6)), Math.round(ny - X(1.1)), glint);
    // Nostrils, and the groove down from the nose.
    hg.set(Math.round(nx - X(1.4)), Math.round(ny + X(0.6)), noseRamp[0]);
    hg.set(Math.round(nx + X(1.2)), Math.round(ny + X(0.6)), noseRamp[0]);
    const my = y0 + 8.4;
    if (p.tongue) {
      // Mouth open in a pant: dark inside, the tongue hanging out over the lower lip.
      hg.ellipse(X(x0), X(my + 1.2), X(5), X(2.6), mouth);
      for (let i = -4; i <= 4; i++) hg.set(Math.round(X(x0 + i)), Math.round(X(my - 0.6)), gum);
      limb(hg, [P(x0, my + 1), P(x0 + 0.4, my + 1 + p.tongue * 0.6), P(x0, my + 1 + p.tongue)], X(5.4), X(6), tongue, { dither: false });
      for (let j = 1; j < p.tongue; j++) hg.set(Math.round(X(x0)), Math.round(X(my + 1 + j)), tongue[1]);
    } else {
      // A soft 'w' under the nose.
      for (let j = X(y0 + 6.6); j < X(my); j++) hg.set(Math.round(nx), Math.round(j), dark);
      for (const s of [-1, 1]) {
        hg.set(Math.round(X(x0 + s * 1.2)), Math.round(X(my + 0.4)), dark);
        hg.set(Math.round(X(x0 + s * 2.6)), Math.round(X(my + 0.4)), dark);
        hg.set(Math.round(X(x0 + s * 3.8)), Math.round(X(my - 0.4)), dark);
      }
      if (p.lick) limb(hg, [P(x0 + 1, my), P(x0 + 2.6, my - 2), P(x0 + 2.2, my - 3.6)], X(3.4), X(3.6), tongue, { dither: false });
    }
    // Eyes: almond, set apart and a little slanting, dark-rimmed, shining; brows over them.
    for (const side of [-1, 1]) {
      const ex = Math.round(X(x0 + side * 6.3));
      const ey = Math.round(X(y0 - 2.2));
      if (p.eyes === 'shut') {
        for (let i = -2; i <= 2; i++) hg.set(ex + i, ey + 1 + (Math.abs(i) === 2 ? -1 : 0), dark);
        continue;
      }
      const iris = side < 0 ? eyeL : eyeR;
      for (let j = -1; j <= 2; j++) for (let i = -2; i <= 3; i++) if (!((j === -1 || j === 2) && (i <= -1 || i >= 2))) hg.set(ex + i, ey + j + (side * i > 1 ? -1 : 0), iris[2]);
      hg.rect(ex, ey, 2, 2, pupil);
      hg.set(ex + (side < 0 ? 1 : 0), ey - 1, iris[3]);
      hg.set(ex, ey, glint);
      for (const [i, j] of [[-3, 0], [-3, 1], [-2, 2], [-1, 3], [0, 3], [1, 3], [2, 2], [3, 1], [4, 0], [-2, -1], [-1, -2], [0, -2], [1, -2], [2, -2], [3, -1]] as const) {
        const xx = ex + (side < 0 ? i : 1 - i);
        hg.set(xx, ey + j + (side * (side < 0 ? i : 1 - i) > 1 ? -1 : 0), dark);
      }
    }
  }
}

export class DogSpriteCache {
  private readonly cache = new DrawnCache();

  get(look: DogLook, pose: DogPose): Texture {
    const key = `${dogLookKey(look)}:${pose}`;
    return this.cache.get(key, () => drawWindowDog(look, pose));
  }
}
