import { Texture } from 'pixi.js';
import { gridToTexture } from './cache';
import { CLOSE_SPECIES, drawBirdClose, MID_SIZE } from './birdClose';
import { drawOwl } from './owlSprites';
import { PixelGrid, pixelHash } from './raster';

export type SpeciesId =
  | 'pigeon'
  | 'sparrow'
  | 'crow'
  | 'woodpecker'
  | 'jay'
  | 'chickadee'
  | 'finch'
  | 'bluebird'
  | 'robin'
  | 'seagull'
  | 'sandpiper'
  | 'owl';

export type BirdPose =
  | 'idle'
  | 'idle-breathe'
  | 'look-up'
  | 'look-back'
  | 'peck-reach'
  | 'peck-down'
  | 'chirp'
  | 'hop'
  | 'fly-up'
  | 'fly-mid'
  | 'fly-down'
  | 'glide'
  | 'sleep'
  // Close-up only (the far renderer shows the nearest of the poses above):
  | 'blink'
  | 'tilt'
  | 'fluff'
  | 'preen-1'
  | 'preen-2'
  | 'scratch-1'
  | 'scratch-2'
  | 'tail-flick'
  | 'hop-crouch'
  | 'hop-air'
  | 'hop-land'
  | 'peck-swallow'
  | 'chirp-2'
  | 'takeoff-1'
  | 'takeoff-2'
  | 'fly-1'
  | 'fly-2'
  | 'fly-3'
  | 'fly-4'
  | 'fly-5'
  | 'fly-6'
  | 'flare-1'
  | 'flare-2';

/** The far renderer's stand-in for each close-up pose. */
const BASE_POSE: Partial<Record<BirdPose, BirdPose>> = {
  blink: 'idle',
  tilt: 'look-up',
  fluff: 'idle-breathe',
  'preen-1': 'look-back',
  'preen-2': 'look-back',
  'scratch-1': 'idle',
  'scratch-2': 'idle',
  'tail-flick': 'idle',
  'hop-crouch': 'idle',
  'hop-air': 'hop',
  'hop-land': 'idle',
  'peck-swallow': 'idle',
  'chirp-2': 'chirp',
  'takeoff-1': 'idle',
  'takeoff-2': 'fly-up',
  'fly-1': 'fly-up',
  'fly-2': 'fly-up',
  'fly-3': 'fly-mid',
  'fly-4': 'fly-down',
  'fly-5': 'fly-down',
  'fly-6': 'fly-mid',
  'flare-1': 'fly-down',
  'flare-2': 'fly-down',
};

export const FLAP_CYCLE: readonly BirdPose[] = ['fly-up', 'fly-mid', 'fly-down', 'fly-mid'];

/** The palette slots of a species' colours (for the close-up renderer). */
export const SLOT = { outline: 1, dark: 2, body: 3, bodyLight: 4, belly: 5, head: 6, sheen: 7, wing: 8, wingDark: 9, beak: 10, eye: 11, leg: 12, accent: 13, sheen2: 14, cap: 15, breast: 16 } as const;

/** Palette slots shared by every species. */
const enum C {
  Outline = 1,
  Dark = 2,
  Body = 3,
  BodyLight = 4,
  Belly = 5,
  Head = 6,
  Sheen = 7,
  Wing = 8,
  WingDark = 9,
  Beak = 10,
  Eye = 11,
  Leg = 12,
  Accent = 13,
  Sheen2 = 14,
  Cap = 15,
  Breast = 16,
}

type WingPattern = 'pigeon-bars' | 'white-bar' | 'spots' | 'black-tips' | 'streaks' | 'plain' | 'sheen';

interface Features {
  /** Iridescent speckled neck (pigeon). */
  neckSheen?: boolean;
  /** Chestnut nape (sparrow). */
  nape?: boolean;
  wing: WingPattern;
  /** Dark streaks / speckles on the body. */
  streaky?: boolean;
  /** Head top in the Cap colour. */
  cap?: boolean;
  /** Pale cheek patch. */
  cheek?: boolean;
  /** Dark throat patch. */
  bib?: boolean;
  /** Breast (front of the body) in the Breast colour. */
  breast?: boolean;
  /** A raised crest on the crown, in the Cap colour. */
  crest?: boolean;
  /** Pale cere at the beak base (pigeon). */
  cere?: boolean;
  eyeRing?: boolean;
  /** Front-facing, upright body with a facial disk (owls). */
  upright?: boolean;
  /** Ear tufts (owls). */
  tufts?: boolean;
  /** Wing length multiplier in flight. */
  wingSpan?: number;
}

interface SpeciesDef {
  /** Box size relative to the 48 px full-detail box. */
  size: number;
  palette: number[];
  headR: number;
  bodyRx: number;
  bodyRy: number;
  beakLen: number;
  beakThick: number;
  tailLen: number;
  legLen: number;
  features: Features;
}

function palette(colors: Partial<Record<C, number>>): number[] {
  const p = new Array<number>(20).fill(0xff00ff);
  for (const [k, v] of Object.entries(colors)) p[Number(k)] = v as number;
  // Unset optional slots fall back to sensible neighbours.
  if (!(C.Cap in colors)) p[C.Cap] = p[C.Head];
  if (!(C.Breast in colors)) p[C.Breast] = p[C.Belly];
  return p;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  pigeon: {
    size: 0.82,
    palette: palette({
      [C.Outline]: 0x23252e, [C.Dark]: 0x3a3e4c, [C.Body]: 0x8a92a6, [C.BodyLight]: 0xa6aec0, [C.Belly]: 0x9aa2b4,
      [C.Head]: 0x6c7488, [C.Sheen]: 0x5e9a7e, [C.Sheen2]: 0x8a6aa0, [C.Wing]: 0x9ea6b8, [C.WingDark]: 0x3c404e,
      [C.Beak]: 0x4a4a52, [C.Eye]: 0xe0802a, [C.Leg]: 0xc85e5e, [C.Accent]: 0xe8e8e8,
    }),
    headR: 6, bodyRx: 15, bodyRy: 10.5, beakLen: 4, beakThick: 2, tailLen: 10, legLen: 6,
    features: { neckSheen: true, wing: 'pigeon-bars', cere: true },
  },
  sparrow: {
    size: 0.6,
    palette: palette({
      [C.Outline]: 0x2a2018, [C.Dark]: 0x2e2620, [C.Body]: 0x9a7650, [C.BodyLight]: 0xb48c62, [C.Belly]: 0xc8bca4,
      [C.Head]: 0x8a8a8a, [C.Sheen]: 0x7a4e30, [C.Sheen2]: 0x5e3c24, [C.Wing]: 0x8a6440, [C.WingDark]: 0x4a3420,
      [C.Beak]: 0x3a3430, [C.Eye]: 0x141010, [C.Leg]: 0xb08870, [C.Accent]: 0xf0ece4,
    }),
    headR: 8, bodyRx: 14, bodyRy: 11, beakLen: 4, beakThick: 3, tailLen: 9, legLen: 5,
    features: { nape: true, wing: 'white-bar', streaky: true, cheek: true, bib: true },
  },
  crow: {
    size: 0.95,
    palette: palette({
      [C.Outline]: 0x0c0c12, [C.Dark]: 0x14141c, [C.Body]: 0x22222c, [C.BodyLight]: 0x3a4058, [C.Belly]: 0x1c1c26,
      [C.Head]: 0x24242e, [C.Sheen]: 0x3a4466, [C.Sheen2]: 0x443a60, [C.Wing]: 0x2a2a36, [C.WingDark]: 0x16161e,
      [C.Beak]: 0x18181e, [C.Eye]: 0x5a4030, [C.Leg]: 0x1a1a20, [C.Accent]: 0x30303c,
    }),
    headR: 6.5, bodyRx: 15, bodyRy: 9.5, beakLen: 8, beakThick: 3.5, tailLen: 12, legLen: 7,
    features: { wing: 'sheen' },
  },
  woodpecker: {
    size: 0.62,
    palette: palette({
      [C.Outline]: 0x101014, [C.Dark]: 0x16161a, [C.Body]: 0x24242a, [C.BodyLight]: 0x3a3a42, [C.Belly]: 0xe6e2da,
      [C.Head]: 0x1e1e24, [C.Sheen]: 0x24242a, [C.Sheen2]: 0x24242a, [C.Wing]: 0x22222a, [C.WingDark]: 0x101014,
      [C.Beak]: 0x4a4a50, [C.Eye]: 0x0c0c0c, [C.Leg]: 0x4a4a50, [C.Accent]: 0xf4f2ee, [C.Cap]: 0xd0302a,
    }),
    headR: 6.5, bodyRx: 13, bodyRy: 9.5, beakLen: 7, beakThick: 2.5, tailLen: 10, legLen: 4,
    features: { wing: 'spots', cap: true, cheek: true },
  },
  jay: {
    size: 0.74,
    palette: palette({
      [C.Outline]: 0x141a2a, [C.Dark]: 0x101420, [C.Body]: 0x5a86c8, [C.BodyLight]: 0x8ab0e0, [C.Belly]: 0xe4eaf2,
      [C.Head]: 0x5a86c8, [C.Sheen]: 0x5a86c8, [C.Sheen2]: 0x3a6ab8, [C.Wing]: 0x3a6ab8, [C.WingDark]: 0x14182a,
      [C.Beak]: 0x1a1a20, [C.Eye]: 0x0c0c10, [C.Leg]: 0x3a3a44, [C.Accent]: 0xf4f6fa, [C.Cap]: 0x6a96d8,
    }),
    headR: 6.5, bodyRx: 14.5, bodyRy: 9.5, beakLen: 5, beakThick: 2.5, tailLen: 13, legLen: 6,
    features: { wing: 'spots', crest: true, cheek: true, bib: true },
  },
  chickadee: {
    size: 0.5,
    palette: palette({
      [C.Outline]: 0x1e1e22, [C.Dark]: 0x141416, [C.Body]: 0x8a9098, [C.BodyLight]: 0xa8aeb6, [C.Belly]: 0xe8dcc6,
      [C.Head]: 0x16161a, [C.Sheen]: 0x8a9098, [C.Sheen2]: 0x8a9098, [C.Wing]: 0x7a8088, [C.WingDark]: 0x4a4e56,
      [C.Beak]: 0x1a1a1e, [C.Eye]: 0x0a0a0a, [C.Leg]: 0x4a4a52, [C.Accent]: 0xf6f6f2, [C.Cap]: 0x16161a,
    }),
    headR: 8.5, bodyRx: 13, bodyRy: 11, beakLen: 3, beakThick: 2, tailLen: 10, legLen: 5,
    features: { wing: 'white-bar', cap: true, cheek: true, bib: true },
  },
  finch: {
    size: 0.52,
    palette: palette({
      [C.Outline]: 0x2a1c18, [C.Dark]: 0x3a2a22, [C.Body]: 0x8a6a54, [C.BodyLight]: 0xa48468, [C.Belly]: 0xdcd0c4,
      [C.Head]: 0xc84a44, [C.Sheen]: 0xc84a44, [C.Sheen2]: 0x5e4434, [C.Wing]: 0x7a5c48, [C.WingDark]: 0x4a3428,
      [C.Beak]: 0x9a8a80, [C.Eye]: 0x100c0c, [C.Leg]: 0x8a7468, [C.Accent]: 0xe8e0d4, [C.Breast]: 0xd85a4c,
    }),
    headR: 7.5, bodyRx: 13.5, bodyRy: 10.5, beakLen: 3.5, beakThick: 3, tailLen: 9, legLen: 5,
    features: { wing: 'white-bar', streaky: true, breast: true },
  },
  bluebird: {
    size: 0.56,
    palette: palette({
      [C.Outline]: 0x16203a, [C.Dark]: 0x1a2440, [C.Body]: 0x3a6ad0, [C.BodyLight]: 0x6a9ae8, [C.Belly]: 0xeef0f4,
      [C.Head]: 0x3a6ad0, [C.Sheen]: 0x3a6ad0, [C.Sheen2]: 0x2a52b0, [C.Wing]: 0x2e5cc0, [C.WingDark]: 0x1a2c70,
      [C.Beak]: 0x1e1e24, [C.Eye]: 0x0a0a0c, [C.Leg]: 0x3a3a44, [C.Accent]: 0xf0f2f6, [C.Breast]: 0xe0884a,
    }),
    headR: 7.5, bodyRx: 13.5, bodyRy: 10.5, beakLen: 3.5, beakThick: 2, tailLen: 10, legLen: 5,
    features: { wing: 'plain', breast: true },
  },
  robin: {
    size: 0.7,
    palette: palette({
      [C.Outline]: 0x1e1a18, [C.Dark]: 0x26221e, [C.Body]: 0x6a5e58, [C.BodyLight]: 0x8a7e76, [C.Belly]: 0xf0ece6,
      [C.Head]: 0x2e2a28, [C.Sheen]: 0x2e2a28, [C.Sheen2]: 0x5a504a, [C.Wing]: 0x625650, [C.WingDark]: 0x3a322e,
      [C.Beak]: 0xe0b030, [C.Eye]: 0x0c0a0a, [C.Leg]: 0x8a7a60, [C.Accent]: 0xf4f0ea, [C.Breast]: 0xd8642c,
    }),
    headR: 7, bodyRx: 14.5, bodyRy: 10.5, beakLen: 5, beakThick: 2.5, tailLen: 11, legLen: 7,
    features: { wing: 'plain', breast: true, eyeRing: true },
  },
  seagull: {
    size: 0.95,
    palette: palette({
      [C.Outline]: 0x3a4250, [C.Dark]: 0x5a6470, [C.Body]: 0xeef0f2, [C.BodyLight]: 0xffffff, [C.Belly]: 0xf4f6f8,
      [C.Head]: 0xf6f8fa, [C.Sheen]: 0xf6f8fa, [C.Sheen2]: 0xf6f8fa, [C.Wing]: 0xa8b4c2, [C.WingDark]: 0x1e2028,
      [C.Beak]: 0xe8c040, [C.Eye]: 0xe0c040, [C.Leg]: 0xe0a090, [C.Accent]: 0xd84a3a,
    }),
    headR: 6.5, bodyRx: 16, bodyRy: 9.5, beakLen: 6, beakThick: 2.5, tailLen: 9, legLen: 6,
    features: { wing: 'black-tips', wingSpan: 1.35 },
  },
  sandpiper: {
    size: 0.5,
    palette: palette({
      [C.Outline]: 0x2a2620, [C.Dark]: 0x3a3428, [C.Body]: 0x8a7a66, [C.BodyLight]: 0xa8987e, [C.Belly]: 0xf2f0ea,
      [C.Head]: 0x8a7a66, [C.Sheen]: 0x6a5c4c, [C.Sheen2]: 0x5a4c3e, [C.Wing]: 0x7a6c5a, [C.WingDark]: 0x4a3e32,
      [C.Beak]: 0x1e1c1a, [C.Eye]: 0x0c0a0a, [C.Leg]: 0x3a3a34, [C.Accent]: 0xf2f0ea,
    }),
    headR: 6, bodyRx: 13, bodyRy: 9, beakLen: 9, beakThick: 1.5, tailLen: 7, legLen: 9,
    features: { wing: 'streaks', streaky: true, cheek: true },
  },
  owl: {
    size: 0.8,
    palette: palette({
      [C.Outline]: 0x24180e, [C.Dark]: 0x3a2818, [C.Body]: 0x9a7650, [C.BodyLight]: 0xb08a5e, [C.Belly]: 0xd8c4a0,
      [C.Head]: 0x9a7650, [C.Sheen]: 0x6a4e32, [C.Sheen2]: 0x5a3e26, [C.Wing]: 0x8a6844, [C.WingDark]: 0x4a3420,
      [C.Beak]: 0x8a8070, [C.Eye]: 0x141010, [C.Leg]: 0xc8b08a, [C.Accent]: 0xece0c8, [C.Cap]: 0xf0c040,
    }),
    headR: 10, bodyRx: 12, bodyRy: 14, beakLen: 3, beakThick: 3, tailLen: 6, legLen: 3,
    features: { wing: 'streaks', streaky: true, upright: true, tufts: true },
  },
};

const isFlight = (pose: BirdPose) => pose.startsWith('fly') || pose === 'glide';

interface Pt {
  x: number;
  y: number;
}

/** The far renderer's flight wings, in the 48-unit box: shoulder (back, front), tip (trailing, leading) and the leading edge's bend. */
export const WING_SHAPES: Record<string, Array<[number, number]>> = {
  'fly-up': [
    [28, 23],
    [21, 23],
    [12, 3],
    [19, 2],
    [31, 13],
  ],
  'fly-mid': [
    [29, 24],
    [20, 24],
    [5, 15],
    [13, 12],
    [31, 19],
  ],
  'fly-down': [
    [28, 27],
    [21, 27],
    [13, 44],
    [20, 46],
    [31, 33],
  ],
  glide: [
    [30, 23],
    [18, 24],
    [3, 21],
    [9, 18],
    [31, 20],
  ],
};

/** Stretch a wing shape away from its shoulder (for long-winged gulls and eagles), keeping the tip inside the box. */
export function spanWing(shape: Array<[number, number]>, span: number): Array<[number, number]> {
  const [sx, sy] = [(shape[0][0] + shape[1][0]) / 2, (shape[0][1] + shape[1][1]) / 2];
  const inBox = (v: number) => Math.min(47.5, Math.max(0.5, v));
  return shape.map(([x, y], i) => (i === 2 || i === 3 ? [inBox(sx + (x - sx) * span), inBox(sy + (y - sy) * span)] : [x, y]));
}

/**
 * Draw one frame of a bird facing right into an N×N grid. Shapes are
 * authored in a 48-unit box and scaled, then detailed according to size:
 * full markings and an outline when large, flat colours when medium, and
 * a simple two-tone figure when tiny (dark wings and tail, the body in its
 * own colour with a pale underside, beak and legs).
 */
export function drawBird(speciesId: SpeciesId, requested: BirdPose, size: number): PixelGrid {
  const pose = BASE_POSE[requested] ?? requested;
  const sp = SPECIES[speciesId];
  const f = sp.features;
  const grid = new PixelGrid(size, size);
  const s = size / 48;
  const P = (x: number, y: number): [number, number] => [x * s, y * s];
  const detailed = size >= 16;
  const medium = size >= 10;
  const flying = isFlight(pose);

  if (f.upright && !flying) {
    drawUprightBird(grid, sp, pose, s, detailed, medium);
  } else if (f.upright) {
    drawOwlFlight(grid, pose, s, detailed, medium);
  } else {
    drawProfileBird(grid, sp, pose, s, P, detailed, medium, flying);
  }

  if (!medium) {
    farFigure(grid);
  } else if (detailed) {
    grid.outline(C.Outline);
  }
  return grid;
}

/** Reduce a tiny bird to a few tones that still read: dark wings, body colour, pale belly, beak and legs. */
function farFigure(grid: PixelGrid): void {
  const out = new Uint8Array(grid.data.length);
  let beakRow = -1;
  let beakX = -1;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = grid.get(x, y);
      if (!c) continue;
      let v: number;
      if (c === C.Leg || c === C.Beak) v = c;
      else if (c === C.Wing || c === C.WingDark || c === C.Dark || c === C.Outline || c === C.Eye) v = C.Dark;
      else if (c === C.Head || c === C.Cap) {
        v = C.Head;
        if (x > beakX) [beakX, beakRow] = [x, y];
      } else v = C.Body;
      out[y * grid.width + x] = v;
    }
  }
  // The underside of the body catches the light.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (out[i] !== C.Body) continue;
      const below = y + 1 < grid.height ? out[i + grid.width] : 0;
      if (below === 0 || below === C.Leg) out[i] = C.Belly;
    }
  }
  grid.data.set(out);
  // A beak in front of the head, when it isn't drawn already.
  if (beakX >= 0 && !grid.data.includes(C.Beak) && beakX + 1 < grid.width && grid.get(beakX + 1, beakRow) === 0) grid.set(beakX + 1, beakRow, C.Beak);
}

function drawProfileBird(
  grid: PixelGrid,
  sp: SpeciesDef,
  pose: BirdPose,
  s: number,
  P: (x: number, y: number) => [number, number],
  detailed: boolean,
  medium: boolean,
  flying: boolean,
): void {
  const f = sp.features;
  const body: Pt & { angle: number } = flying ? { x: 23, y: 25, angle: -0.06 } : { x: 21, y: 30, angle: -0.3 };
  if (pose === 'idle-breathe') body.y += 0.8;
  if (pose === 'hop') body.y -= 4;
  if (pose === 'peck-reach' || pose === 'peck-down') body.angle = -0.05;
  const rx = sp.bodyRx;
  const ry = flying ? sp.bodyRy * 0.62 : sp.bodyRy;

  let head: Pt = flying ? { x: 37, y: 21 } : { x: 34, y: 16 };
  let beakDir = 1;
  let beakTilt = 0;
  switch (pose) {
    case 'look-up':
      head = { x: 33, y: 14 };
      beakTilt = -0.45;
      break;
    case 'look-back':
      head = { x: 31, y: 16 };
      beakDir = -1;
      break;
    case 'peck-reach':
      head = { x: 39, y: 27 };
      beakTilt = 0.6;
      break;
    case 'peck-down':
      head = { x: 40, y: 37 };
      beakTilt = 1.1;
      break;
    case 'chirp':
      head = { x: 34, y: 14 };
      beakTilt = -0.25;
      break;
    case 'hop':
      head = { x: 34, y: 12 };
      break;
    case 'sleep':
      head = { x: 28, y: 22 };
      break;
    case 'idle-breathe':
      head = { x: 34, y: 16.6 };
      break;
  }
  const hr = sp.headR;

  // --- Tail (behind everything) ---
  const tailBase = { x: body.x - rx * 0.75, y: body.y + (flying ? 0 : 3) };
  const tailDrop = flying ? 0 : 6;
  grid.polygon(
    [
      P(tailBase.x + 2, tailBase.y - 3),
      P(tailBase.x - sp.tailLen, tailBase.y + tailDrop - 2),
      P(tailBase.x - sp.tailLen + 1, tailBase.y + tailDrop + 3),
      P(tailBase.x + 3, tailBase.y + 4),
    ],
    detailed ? C.WingDark : C.Dark,
  );

  // --- Legs (standing poses) ---
  if (!flying && pose !== 'sleep') {
    const tucked = pose === 'hop';
    const legTop = body.y + ry * 0.75;
    const legLen = tucked ? sp.legLen * 0.4 : 45.5 - legTop;
    for (const offset of [-1, 3]) {
      const x = body.x + offset;
      grid.line(...P(x, legTop), ...P(x - 0.5, legTop + legLen), C.Leg, Math.max(1, 1.6 * s));
      if (!tucked) grid.line(...P(x - 0.5, legTop + legLen), ...P(x + 3, legTop + legLen), C.Leg, Math.max(1, 1.2 * s));
    }
  }

  // --- Body ---
  const bodyColor = (u: number, v: number, x: number, y: number) => {
    if (!medium) return C.Body;
    if (f.breast && u > 0.05 && v > -0.35) return v > 0.55 ? C.Belly : C.Breast;
    if (v < -0.5) return C.BodyLight;
    if (v > 0.35) return detailed && f.streaky && pixelHash(x, y, 7) < 0.18 ? C.Sheen2 : C.Belly;
    if (detailed && f.streaky && v < 0.1 && pixelHash(x, y, 3) < 0.25) return C.Sheen2;
    return C.Body;
  };
  grid.ellipse(body.x * s, body.y * s, rx * s, ry * s, bodyColor, body.angle);

  // --- Neck joining head and body ---
  if (pose !== 'sleep') {
    const neck = { x: (head.x + body.x + rx * 0.55) / 2, y: (head.y + body.y - ry * 0.4) / 2 };
    const neckColor = (_u: number, _v: number, x: number, y: number) => {
      if (!detailed) return f.nape ? C.Body : C.Head;
      if (f.neckSheen) return pixelHash(x, y, 9) < 0.5 ? C.Sheen : C.Sheen2;
      if (f.nape) return C.Sheen;
      if (f.breast) return C.Breast;
      return C.Head;
    };
    grid.ellipse(neck.x * s, neck.y * s, hr * 0.85 * s, (Math.abs(head.y - body.y) * 0.45 + 2) * s, neckColor, 0.3);
  }

  // --- Wings ---
  if (!flying) {
    const wingColor = (u: number, v: number, x: number, y: number) => {
      if (!medium) return C.Wing;
      if (detailed) {
        switch (f.wing) {
          case 'pigeon-bars':
            if (((u > -0.35 && u < -0.15) || (u > 0.1 && u < 0.3)) && v > -0.6) return C.WingDark;
            break;
          case 'white-bar':
            if (v > 0.15 && v < 0.4) return C.Accent;
            return pixelHash(x, y, 5) < 0.35 ? C.WingDark : C.Wing;
          case 'spots':
            if (pixelHash(x, y, 11) < 0.16) return C.Accent;
            if (u < -0.2 && Math.floor(x / Math.max(1, 2 * s)) % 2 === 0) return C.WingDark;
            break;
          case 'black-tips':
            if (u < -0.55) return C.WingDark;
            if (u < -0.4 && pixelHash(x, y, 2) < 0.3) return C.Accent;
            break;
          case 'streaks':
            return pixelHash(x, y, 13) < 0.3 ? C.WingDark : C.Wing;
          case 'sheen':
            if (v < -0.55) return C.Sheen;
            break;
        }
      }
      return u < -0.6 ? C.WingDark : C.Wing;
    };
    grid.ellipse((body.x - 2) * s, (body.y - 1) * s, rx * 0.78 * s, ry * 0.62 * s, wingColor, body.angle - 0.15);
  } else {
    const base = WING_SHAPES[pose] ?? WING_SHAPES.glide;
    const shape = f.wingSpan ? spanWing(base, f.wingSpan) : base;
    grid.polygon(shape.map(([x, y]) => P(x, y)), C.Wing);
    if (detailed) {
      const tip = shape[2];
      const tip2 = shape[3];
      grid.line(...P(tip[0], tip[1]), ...P(shape[1][0], shape[1][1]), C.WingDark, Math.max(1, 2 * s));
      grid.line(...P(tip2[0], tip2[1]), ...P(tip[0], tip[1]), C.WingDark, Math.max(1, (f.wing === 'black-tips' ? 3 : 1.5) * s));
    }
  }

  // --- Head ---
  if (pose !== 'sleep') {
    // Crest first so the head overlaps its base.
    if (f.crest) {
      grid.polygon(
        [P(head.x - hr * 0.5, head.y - hr * 0.6), P(head.x - hr * 1.2, head.y - hr * 1.6), P(head.x + hr * 0.3, head.y - hr * 0.8)],
        C.Cap,
      );
    }
    const headColor = (u: number, v: number) => {
      if (!detailed) return f.cap && v < -0.2 ? C.Cap : C.Head;
      if (f.cap && v < -0.25) return C.Cap;
      if (f.cheek && v > 0.15 && v < 0.75 && u > -0.4) return C.Accent;
      if (f.nape && u < -0.3) return C.Sheen;
      if (f.breast && v > 0.55) return C.Breast;
      return v < -0.6 ? C.BodyLight : C.Head;
    };
    grid.ellipse(head.x * s, head.y * s, hr * s, hr * s, headColor);

    // Beak (two mandibles, parted when calling).
    const bx = head.x + beakDir * hr * 0.75;
    const by = head.y + 0.5;
    const tipX = bx + beakDir * sp.beakLen * Math.cos(beakTilt);
    const tipY = by + sp.beakLen * Math.sin(beakTilt) + 1;
    const open = pose === 'chirp' ? 1.8 : 0;
    grid.polygon([P(bx, by - sp.beakThick / 2 - open / 2), P(tipX, tipY - open), P(bx, by + 0.3)], C.Beak);
    grid.polygon([P(bx, by + 0.2), P(tipX - beakDir * 0.5, tipY + open * 0.6), P(bx, by + sp.beakThick / 2 + open / 2)], C.Beak);
    if (detailed && f.cere) grid.set(Math.floor(bx * s), Math.floor((by - 1.2) * s), C.Accent);
    if (detailed && f.wing === 'black-tips') grid.set(Math.floor((tipX - beakDir * 1.5) * s), Math.floor((tipY + 0.5) * s), C.Accent); // gull's red spot

    if (detailed && f.bib && !flying) {
      grid.ellipse((head.x + 1) * s, (head.y + hr * 0.95) * s, 2.6 * s, 2.4 * s, C.Dark);
    }

    if (medium) {
      const ex = head.x + beakDir * hr * 0.25;
      const ey = head.y - hr * 0.2;
      if (detailed && f.eyeRing) {
        grid.set(Math.floor(ex * s) - 1, Math.floor(ey * s), C.Accent);
        grid.set(Math.floor(ex * s) + 1, Math.floor(ey * s), C.Accent);
      }
      grid.set(Math.floor(ex * s), Math.floor(ey * s), C.Eye);
      if (s * 48 >= 30) grid.set(Math.floor(ex * s) + (beakDir > 0 ? 1 : -1), Math.floor(ey * s), C.Eye);
    }
  } else if (medium) {
    grid.ellipse((body.x + rx * 0.55) * s, (body.y - ry * 0.55) * s, hr * 0.8 * s, hr * 0.7 * s, C.Head);
  }

  if (flying && detailed) {
    const base = WING_SHAPES[pose] ?? WING_SHAPES.glide;
    const shape = f.wingSpan ? spanWing(base, f.wingSpan) : base;
    grid.line(...P(shape[0][0], shape[0][1]), ...P(shape[1][0], shape[1][1]), C.Outline, Math.max(1, s));
  }
}

/**
 * An owl in flight, side on and heading right: a big round head with its
 * pale facial disk turned a little towards us, a short stout body and tail,
 * and broad, rounded, barred wings beating slowly (or held out in a glide).
 */
function drawOwlFlight(grid: PixelGrid, pose: BirdPose, s: number, detailed: boolean, medium: boolean): void {
  const P = (x: number, y: number): [number, number] => [x * s, y * s];
  // The far wing first, in shade, a little behind the near one.
  const wing = (dy: number, far: boolean) => {
    const tip: Record<string, [number, number]> = { 'fly-up': [14, 3], 'fly-mid': [6, 20], 'fly-down': [15, 43], glide: [4, 25] };
    const [tx, ty] = tip[pose] ?? tip.glide;
    const shoulder: [number, number] = [25, 24 + dy];
    // A broad rounded wing: leading edge out to the tip, then a deep rounded trailing edge back to the body.
    const up = ty < 20;
    const pts: Array<[number, number]> = [
      P(shoulder[0] + 3, shoulder[1] - 1),
      P(tx + 4, ty + (up ? 1 : -1) + dy),
      P(tx, ty + dy),
      P(tx - 1, ty + (up ? 5 : ty > 30 ? -5 : 4) + dy),
      P((tx + shoulder[0]) / 2 - 2, (ty + shoulder[1]) / 2 + (up ? 6 : ty > 30 ? -6 : 7) + dy),
      P(shoulder[0] - 5, shoulder[1] + 3),
    ];
    grid.polygon(pts, far ? C.WingDark : C.Wing);
    if (detailed && !far) {
      // Bars across the flight feathers.
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        grid.line(...P(shoulder[0] + (tx - shoulder[0]) * t, shoulder[1] + (ty + dy - shoulder[1]) * t), ...P(shoulder[0] + (tx - shoulder[0]) * t - 2, shoulder[1] + (ty + dy - shoulder[1]) * t + (up ? 4 : ty > 30 ? -4 : 4)), C.WingDark, Math.max(1, s));
      }
    }
  };
  wing(-2, true);
  // Short tail and a stout, streaked body.
  grid.polygon([P(15, 25), P(8, 23), P(8, 29), P(15, 28)], C.WingDark);
  grid.ellipse(22 * s, 26 * s, 9 * s, 5.5 * s, (_u, v, x, y) => (v > 0.2 ? (detailed && pixelHash(x, y, 4) < 0.25 ? C.Sheen : C.Belly) : C.Body));
  // The big round head.
  grid.ellipse(33 * s, 22 * s, 7 * s, 6.5 * s, C.Head);
  if (medium) {
    grid.ellipse(35 * s, 23 * s, 4.2 * s, 4.6 * s, C.Accent);
    if (detailed) {
      grid.ellipse(36 * s, 22 * s, 1.6 * s, 1.6 * s, C.Cap);
      grid.set(Math.floor(36.4 * s), Math.floor(22 * s), C.Eye);
    } else grid.set(Math.floor(36 * s), Math.floor(22 * s), C.Eye);
    grid.set(Math.floor(39 * s), Math.floor(24.5 * s), C.Beak);
  }
  wing(0, false);
}

/** Owls: a front-facing, upright body with a facial disk and big eyes. */
function drawUprightBird(grid: PixelGrid, sp: SpeciesDef, pose: BirdPose, s: number, detailed: boolean, medium: boolean): void {
  const f = sp.features;
  const bob = pose === 'idle-breathe' ? 0.8 : pose === 'hop' ? -4 : 0;
  const lean = pose === 'peck-reach' ? 3 : pose === 'peck-down' ? 5 : 0;
  const cx = 24;
  const by = 31 + bob;
  // Feet.
  if (pose !== 'hop') {
    grid.line(21 * s, 44 * s, 21 * s, 46 * s, C.Leg, Math.max(1, 2 * s));
    grid.line(27 * s, 44 * s, 27 * s, 46 * s, C.Leg, Math.max(1, 2 * s));
  }
  grid.ellipse(cx * s, by * s, sp.bodyRx * s, sp.bodyRy * s, (u, v, x, y) => {
    if (!medium) return C.Body;
    if (Math.abs(u) < 0.55 && v > -0.4) return detailed && pixelHash(x, y, 4) < 0.22 ? C.Sheen : C.Belly;
    return detailed && pixelHash(x, y, 8) < 0.25 ? C.Sheen2 : C.Wing;
  });
  const hx = cx + lean * 0.4;
  const hy = 14 + bob + lean;
  const turned = pose === 'look-back';
  if (f.tufts) {
    grid.polygon([[(hx - 8) * s, (hy - 5) * s], [(hx - 7) * s, (hy - 12) * s], [(hx - 3) * s, (hy - 7) * s]], C.Body);
    grid.polygon([[(hx + 8) * s, (hy - 5) * s], [(hx + 7) * s, (hy - 12) * s], [(hx + 3) * s, (hy - 7) * s]], C.Body);
  }
  grid.ellipse(hx * s, hy * s, sp.headR * s, sp.headR * 0.92 * s, C.Head);
  if (!medium) return;
  if (!turned) {
    // Facial disk, eyes and beak.
    grid.ellipse(hx * s, (hy + 0.5) * s, 7.5 * s, 6.5 * s, C.Accent);
    const eyeOpen = pose !== 'sleep';
    for (const ex of [hx - 3.4, hx + 3.4]) {
      if (eyeOpen && detailed) {
        grid.ellipse(ex * s, hy * s, 2.2 * s, 2.2 * s, C.Cap);
        grid.ellipse(ex * s, hy * s, 1.2 * s, 1.2 * s, C.Eye);
      } else {
        grid.line((ex - 1.5) * s, hy * s, (ex + 1.5) * s, hy * s, C.Eye, Math.max(1, s));
      }
    }
    grid.polygon([[(hx - 1.2) * s, (hy + 2) * s], [(hx + 1.2) * s, (hy + 2) * s], [hx * s, (hy + 5) * s]], C.Beak);
  } else if (detailed) {
    // Head swivelled right round: just the speckled back of the head.
    grid.recolor(C.Head, C.Sheen2, (x, y) => pixelHash(x, y, 6) < 0.2);
  }
}

/** A bird at any size: shaded forms once it's near enough to see its shape (in full detail close to the window), a few flat tones when tiny. */
export function drawBirdAt(species: SpeciesId, pose: BirdPose, size: number): { grid: PixelGrid; colors: readonly number[] } {
  if (size >= MID_SIZE && CLOSE_SPECIES.has(species)) {
    const { grid, palette } = drawBirdClose(species, pose, size);
    return { grid, colors: palette.colors };
  }
  if (species === 'owl' && size >= 8) {
    const { grid, palette } = drawOwl(pose, size);
    return { grid, colors: palette.colors };
  }
  return { grid: drawBird(species, pose, size), colors: SPECIES[species].palette };
}

/** Caches generated textures by species, pose and size. */
export class BirdSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(species: SpeciesId, pose: BirdPose, size: number): Texture {
    const key = `${species}:${pose}:${size}`;
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, colors } = drawBirdAt(species, pose, size);
      texture = gridToTexture(grid, colors);
      this.cache.set(key, texture);
    }
    return texture;
  }

  get size(): number {
    return this.cache.size;
  }
}

