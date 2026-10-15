import { Texture } from 'pixi.js';
import { CanvasSource } from 'pixi.js';
import { PixelGrid, pixelHash } from './raster';

export type SpeciesId = 'pigeon' | 'sparrow' | 'crow';

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
  | 'sleep';

export const FLAP_CYCLE: readonly BirdPose[] = ['fly-up', 'fly-mid', 'fly-down', 'fly-mid'];

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
  /** Silhouette colour used at tiny sizes. */
  silhouette: number;
}

function palette(colors: Partial<Record<C, number>>): number[] {
  const p = new Array<number>(16).fill(0xff00ff);
  for (const [k, v] of Object.entries(colors)) p[Number(k)] = v as number;
  return p;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  pigeon: {
    size: 0.82,
    palette: palette({
      [C.Outline]: 0x23252e,
      [C.Dark]: 0x3a3e4c,
      [C.Body]: 0x8a92a6,
      [C.BodyLight]: 0xa6aec0,
      [C.Belly]: 0x9aa2b4,
      [C.Head]: 0x6c7488,
      [C.Sheen]: 0x5e9a7e,
      [C.Sheen2]: 0x8a6aa0,
      [C.Wing]: 0x9ea6b8,
      [C.WingDark]: 0x3c404e,
      [C.Beak]: 0x4a4a52,
      [C.Eye]: 0xe0802a,
      [C.Leg]: 0xc85e5e,
      [C.Accent]: 0xe8e8e8,
    }),
    headR: 6,
    bodyRx: 15,
    bodyRy: 10.5,
    beakLen: 4,
    beakThick: 2,
    tailLen: 10,
    legLen: 6,
    silhouette: 0x3a3e4c,
  },
  sparrow: {
    size: 0.6,
    palette: palette({
      [C.Outline]: 0x2a2018,
      [C.Dark]: 0x2e2620,
      [C.Body]: 0x9a7650,
      [C.BodyLight]: 0xb48c62,
      [C.Belly]: 0xc8bca4,
      [C.Head]: 0x8a8a8a,
      [C.Sheen]: 0x7a4e30,
      [C.Sheen2]: 0x5e3c24,
      [C.Wing]: 0x8a6440,
      [C.WingDark]: 0x4a3420,
      [C.Beak]: 0x3a3430,
      [C.Eye]: 0x141010,
      [C.Leg]: 0xb08870,
      [C.Accent]: 0xf0ece4,
    }),
    headR: 8,
    bodyRx: 14,
    bodyRy: 11,
    beakLen: 4,
    beakThick: 3,
    tailLen: 9,
    legLen: 5,
    silhouette: 0x3a2e24,
  },
  crow: {
    size: 0.95,
    palette: palette({
      [C.Outline]: 0x0c0c12,
      [C.Dark]: 0x14141c,
      [C.Body]: 0x22222c,
      [C.BodyLight]: 0x3a4058,
      [C.Belly]: 0x1c1c26,
      [C.Head]: 0x24242e,
      [C.Sheen]: 0x3a4466,
      [C.Sheen2]: 0x443a60,
      [C.Wing]: 0x2a2a36,
      [C.WingDark]: 0x16161e,
      [C.Beak]: 0x18181e,
      [C.Eye]: 0x5a4030,
      [C.Leg]: 0x1a1a20,
      [C.Accent]: 0x30303c,
    }),
    headR: 6.5,
    bodyRx: 15,
    bodyRy: 9.5,
    beakLen: 8,
    beakThick: 3.5,
    tailLen: 12,
    legLen: 7,
    silhouette: 0x1a1a22,
  },
};

const isFlight = (pose: BirdPose) => pose.startsWith('fly') || pose === 'glide';

interface Pt {
  x: number;
  y: number;
}

/**
 * Draw one frame of a bird facing right into an N×N grid. Shapes are
 * authored in a 48-unit box and scaled, then detailed according to size:
 * full markings and an outline when large, flat colours when medium, a
 * single-colour silhouette when tiny.
 */
export function drawBird(speciesId: SpeciesId, pose: BirdPose, size: number): PixelGrid {
  const sp = SPECIES[speciesId];
  const grid = new PixelGrid(size, size);
  const s = size / 48;
  const P = (x: number, y: number): [number, number] => [x * s, y * s];
  const detailed = size >= 16;
  const medium = size >= 10;

  const flying = isFlight(pose);
  const body: Pt & { angle: number } = flying
    ? { x: 23, y: 25, angle: -0.06 }
    : { x: 21, y: 30, angle: -0.3 };
  if (pose === 'idle-breathe') body.y += 0.8;
  if (pose === 'hop') body.y -= 4;
  if (pose === 'peck-reach' || pose === 'peck-down') body.angle = -0.05;
  const rx = sp.bodyRx;
  const ry = flying ? sp.bodyRy * 0.62 : sp.bodyRy;

  // Head placement by pose.
  let head: Pt = flying ? { x: 37, y: 21 } : { x: 34, y: 16 };
  let beakDir = 1; // 1 = forward, -1 = looking back
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
    const legLen = tucked ? sp.legLen * 0.4 : sp.legLen + (45.5 - (body.y + ry * 0.75 + sp.legLen));
    for (const offset of [-1, 3]) {
      const x = body.x + offset;
      grid.line(...P(x, legTop), ...P(x - 0.5, legTop + legLen), C.Leg, Math.max(1, 1.6 * s));
      if (!tucked) grid.line(...P(x - 0.5, legTop + legLen), ...P(x + 3, legTop + legLen), C.Leg, Math.max(1, 1.2 * s));
    }
  }

  // --- Wing behind the body (far wing) in flight ---
  const wingShapes: Record<string, Array<[number, number]>> = {
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

  // --- Body ---
  const bodyColor = (_u: number, v: number, x: number, y: number) => {
    if (!medium) return C.Body;
    if (v < -0.5) return C.BodyLight;
    if (v > 0.35) return C.Belly;
    if (detailed && speciesId === 'sparrow' && v < 0.1 && pixelHash(x, y, 3) < 0.25) return C.Sheen2;
    return C.Body;
  };
  grid.ellipse(body.x * s, body.y * s, rx * s, ry * s, bodyColor, body.angle);

  // --- Neck joining head and body ---
  if (pose !== 'sleep') {
    const neck = { x: (head.x + body.x + rx * 0.55) / 2, y: (head.y + body.y - ry * 0.4) / 2 };
    const neckColor = (_u: number, _v: number, x: number, y: number) => {
      if (!detailed) return speciesId === 'sparrow' ? C.Body : C.Head;
      if (speciesId === 'pigeon') return pixelHash(x, y, 9) < 0.5 ? C.Sheen : C.Sheen2;
      if (speciesId === 'sparrow') return C.Sheen; // chestnut nape
      return C.Head;
    };
    grid.ellipse(neck.x * s, neck.y * s, hr * 0.85 * s, (Math.abs(head.y - body.y) * 0.45 + 2) * s, neckColor, 0.3);
  }

  // --- Folded wing on the body ---
  if (!flying) {
    const wingColor = (u: number, v: number, x: number, y: number) => {
      if (!medium) return C.Wing;
      if (detailed) {
        if (speciesId === 'pigeon' && ((u > -0.35 && u < -0.15) || (u > 0.1 && u < 0.3)) && v > -0.6) return C.WingDark;
        if (speciesId === 'sparrow') {
          if (v > 0.15 && v < 0.4) return C.Accent; // white wing bar
          return pixelHash(x, y, 5) < 0.35 ? C.WingDark : C.Wing;
        }
        if (speciesId === 'crow' && v < -0.55) return C.Sheen;
      }
      return u < -0.6 ? C.WingDark : C.Wing;
    };
    grid.ellipse((body.x - 2) * s, (body.y - 1) * s, rx * 0.78 * s, ry * 0.62 * s, wingColor, body.angle - 0.15);
  } else {
    const shape = wingShapes[pose] ?? wingShapes.glide;
    grid.polygon(shape.map(([x, y]) => P(x, y)), C.Wing);
    if (detailed) {
      // Darker flight feathers along the trailing edge.
      const tip = shape[2];
      const tip2 = shape[3];
      grid.line(...P(tip[0], tip[1]), ...P(shape[1][0], shape[1][1]), C.WingDark, Math.max(1, 2 * s));
      grid.line(...P(tip2[0], tip2[1]), ...P(tip[0], tip[1]), C.WingDark, Math.max(1, 1.5 * s));
    }
  }

  // --- Head ---
  if (pose !== 'sleep') {
    const headColor = (u: number, v: number) => {
      if (!detailed) return C.Head;
      if (speciesId === 'sparrow') {
        if (v > 0.3 && u > -0.2) return C.Accent; // pale cheek
        if (v < -0.3) return C.Head; // grey crown
        return u < -0.3 ? C.Sheen : C.Head;
      }
      return v < -0.6 ? C.BodyLight : C.Head;
    };
    grid.ellipse(head.x * s, head.y * s, hr * s, hr * s, headColor);

    // Beak.
    const bx = head.x + beakDir * hr * 0.75;
    const by = head.y + 0.5;
    const tipX = bx + beakDir * sp.beakLen * Math.cos(beakTilt);
    const tipY = by + sp.beakLen * Math.sin(beakTilt) + 1;
    const open = pose === 'chirp' ? 1.8 : 0;
    grid.polygon(
      [P(bx, by - sp.beakThick / 2 - open / 2), P(tipX, tipY - open), P(bx, by + 0.3)],
      C.Beak,
    );
    grid.polygon(
      [P(bx, by + 0.2), P(tipX - beakDir * 0.5, tipY + open * 0.6), P(bx, by + sp.beakThick / 2 + open / 2)],
      C.Beak,
    );
    if (detailed && speciesId === 'pigeon') grid.set(Math.floor(bx * s), Math.floor((by - 1.2) * s), C.Accent); // cere

    // Black bib on the sparrow's throat.
    if (detailed && speciesId === 'sparrow' && !flying) {
      grid.ellipse((head.x + 1) * s, (head.y + hr * 0.95) * s, 2.6 * s, 2.4 * s, C.Dark);
    }

    // Eye.
    if (medium) {
      const ex = head.x + beakDir * hr * 0.25;
      const ey = head.y - hr * 0.2;
      grid.set(Math.floor(ex * s), Math.floor(ey * s), C.Eye);
      if (size >= 30) grid.set(Math.floor(ex * s) + (beakDir > 0 ? 1 : -1), Math.floor(ey * s), C.Eye);
    }
  } else if (medium) {
    // Head tucked in: a small bump and a closed eye line.
    grid.ellipse((body.x + rx * 0.55) * s, (body.y - ry * 0.55) * s, hr * 0.8 * s, hr * 0.7 * s, C.Head);
  }

  // --- Near wing in flight (over the body) ---
  if (flying && detailed) {
    const shape = wingShapes[pose] ?? wingShapes.glide;
    grid.line(...P(shape[0][0], shape[0][1]), ...P(shape[1][0], shape[1][1]), C.Outline, Math.max(1, s));
  }

  if (!medium) {
    grid.flatten(C.Dark);
  } else if (detailed) {
    grid.outline(C.Outline);
  }
  return grid;
}

/** Caches generated textures by species, pose and size. */
export class BirdSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(species: SpeciesId, pose: BirdPose, size: number): Texture {
    const key = `${species}:${pose}:${size}`;
    let texture = this.cache.get(key);
    if (!texture) {
      texture = gridToTexture(drawBird(species, pose, size), SPECIES[species].palette);
      this.cache.set(key, texture);
    }
    return texture;
  }

  get size(): number {
    return this.cache.size;
  }
}

/** Upload an indexed grid as a crisp, nearest-sampled texture. */
export function gridToTexture(grid: PixelGrid, colors: readonly number[]): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(grid.toRGBA(colors) as Uint8ClampedArray<ArrayBuffer>, grid.width, grid.height), 0, 0);
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest', resolution: 1 }) });
}
