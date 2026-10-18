import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { PixelGrid } from './raster';

export type CatPose =
  | 'walk-1'
  | 'walk-2'
  | 'walk-3'
  | 'walk-4'
  | 'sit'
  | 'sit-blink'
  | 'stretch'
  | 'nap-1'
  | 'nap-2'
  | 'crouch-1'
  | 'crouch-2'
  | 'pounce';

export const CAT_WALK: readonly CatPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];
export const CAT_WIDTH = 56;
export const CAT_HEIGHT = 36;

export type CatCoat = 'orange-tabby' | 'black' | 'grey-tabby' | 'tuxedo';
export const CAT_COATS: readonly CatCoat[] = ['orange-tabby', 'black', 'grey-tabby', 'tuxedo'];

const enum K {
  Outline = 1,
  Stripe = 2,
  Base = 3,
  Light = 4,
  Eye = 5,
  Pink = 6,
  White = 7,
  Pupil = 8,
}

const COATS: Record<CatCoat, { palette: number[]; striped: boolean; patches: boolean }> = {
  'orange-tabby': {
    palette: [0, 0x3a2414, 0xb0632a, 0xdc8f44, 0xf2c890, 0x9ccc54, 0xe08a8a, 0xf4ece0, 0x1a1208],
    striped: true,
    patches: false,
  },
  black: {
    palette: [0, 0x0e0e14, 0x1c1c24, 0x26262f, 0x3c3c4a, 0xe8c840, 0xb07878, 0x50505e, 0x0a0a0e],
    striped: false,
    patches: false,
  },
  'grey-tabby': {
    palette: [0, 0x24262e, 0x5a5e6a, 0x878b98, 0xbcc0ca, 0x8ec2c8, 0xd89090, 0xeceef2, 0x101014],
    striped: true,
    patches: false,
  },
  tuxedo: {
    palette: [0, 0x0e0e14, 0x1c1c24, 0x26262f, 0xf0f0f4, 0x98c860, 0xe09a9a, 0xf4f4f8, 0x0a0a0e],
    striped: false,
    patches: true,
  },
};

type Pt = [number, number];

/**
 * Draw the rooftop cat (facing right) in a 56×36 box, feet on the bottom row.
 * Built from simple body parts so every pose shares proportions and coat.
 */
export function drawCat(coat: CatCoat, pose: CatPose): PixelGrid {
  const g = new PixelGrid(CAT_WIDTH, CAT_HEIGHT);
  const { striped, patches } = COATS[coat];
  const fur = (light: (u: number, v: number) => boolean) => (u: number, v: number, x: number) => {
    if (light(u, v)) return K.Light;
    if (striped && Math.sin(x * 1.15) > 0.55 && v < 0.35) return K.Stripe;
    return K.Base;
  };
  const leg = (from: Pt, to: Pt, white = patches) => {
    g.line(from[0], from[1], to[0], to[1], K.Base, 3);
    if (white) g.ellipse(to[0], to[1] - 0.5, 1.6, 1.2, K.Light);
  };
  const tail = (points: Pt[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      g.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], K.Base, 2.6);
    }
    if (striped) {
      for (let i = 1; i < points.length; i += 2) g.ellipse(points[i][0], points[i][1], 1.2, 1.2, K.Stripe);
    }
  };
  const head = (cx: number, cy: number, r: number, eye: 'open' | 'closed' | 'wide' = 'open') => {
    // Ears first so the head overlaps their base.
    g.polygon([[cx - r * 0.8, cy - r * 0.3], [cx - r * 0.45, cy - r * 1.55], [cx + 0.2, cy - r * 0.6]], K.Base);
    g.polygon([[cx + 0.2, cy - r * 0.6], [cx + r * 0.55, cy - r * 1.5], [cx + r * 0.95, cy - r * 0.2]], K.Base);
    g.set(Math.floor(cx - r * 0.45), Math.floor(cy - r * 1.05), K.Pink);
    g.set(Math.floor(cx + r * 0.5), Math.floor(cy - r * 1.0), K.Pink);
    g.ellipse(cx, cy, r, r * 0.9, fur((u, v) => (patches ? v > 0.2 && u > 0 : v > 0.45 && u > 0.2)));
    // Muzzle, nose and eye.
    g.ellipse(cx + r * 0.75, cy + r * 0.3, r * 0.42, r * 0.34, patches ? K.White : K.Light);
    g.set(Math.floor(cx + r * 1.05), Math.floor(cy + r * 0.05), K.Pink);
    const ex = Math.floor(cx + r * 0.35);
    const ey = Math.floor(cy - r * 0.15);
    if (eye === 'closed') {
      g.set(ex - 1, ey + 1, K.Outline);
      g.set(ex, ey + 1, K.Outline);
    } else {
      g.set(ex, ey, K.Eye);
      g.set(ex - 1, ey, K.Eye);
      g.set(ex, ey + (eye === 'wide' ? 1 : 0), K.Pupil);
      if (eye === 'wide') g.set(ex - 1, ey + 1, K.Eye);
    }
  };

  switch (pose) {
    case 'walk-1':
    case 'walk-2':
    case 'walk-3':
    case 'walk-4': {
      const phase = (Number(pose.slice(-1)) - 1) * (Math.PI / 2);
      const swing = (offset: number) => Math.sin(phase + offset) * 3;
      tail([[14, 19], [9, 15], [7, 9], [9, 4]]);
      // Far legs (drawn first, behind the body) then near legs.
      leg([36, 23], [36 + swing(Math.PI), 34.5]);
      leg([18, 23], [18 + swing(0), 34.5]);
      g.ellipse(27, 21, 13, 6.5, fur((_u, v) => v > 0.45));
      leg([39, 23], [39 + swing(0), 34.5]);
      leg([15, 23], [15 + swing(Math.PI), 34.5]);
      head(44, 14, 6);
      break;
    }
    case 'sit':
    case 'sit-blink':
      tail([[18, 34], [26, 35], [34, 34.5], [38, 33]]);
      g.ellipse(24, 28, 9, 7, fur((_u, v) => v > 0.6));
      g.ellipse(29, 22, 7.5, 11, fur((u) => u > 0.35), -0.2);
      leg([33, 22], [33.5, 34.5]);
      leg([36, 22], [36.5, 34.5]);
      head(33, 10, 6, pose === 'sit-blink' ? 'closed' : 'open');
      break;
    case 'stretch':
      tail([[14, 16], [10, 10], [9, 5], [11, 2]]);
      leg([17, 22], [16, 34.5]);
      leg([20, 22], [20, 34.5]);
      g.ellipse(27, 23, 14, 6, fur((_u, v) => v > 0.45), 0.32);
      leg([37, 29], [48, 34.5]);
      leg([35, 29], [45, 34.5]);
      head(44, 25, 5.8, 'closed');
      break;
    case 'nap-1':
    case 'nap-2': {
      const breathe = pose === 'nap-2' ? 0.7 : 0;
      g.ellipse(27, 27 - breathe / 2, 15, 8 + breathe, fur((_u, v) => v > 0.6));
      tail([[13, 31], [20, 34], [30, 34.5], [38, 33.5]]);
      head(39, 27, 5.6, 'closed');
      break;
    }
    case 'crouch-1':
    case 'crouch-2': {
      const step = pose === 'crouch-2' ? 1.5 : -1.5;
      tail([[14, 27], [8, 28], [4, 27], [3, 24]]);
      leg([37, 29], [38 + step, 34.5]);
      leg([18, 29], [17 - step, 34.5]);
      g.ellipse(27, 28, 14, 5.2, fur((_u, v) => v > 0.45));
      leg([40, 29], [41 - step, 34.5]);
      leg([15, 29], [14 + step, 34.5]);
      head(45, 24, 5.6, 'wide');
      break;
    }
    case 'pounce':
      tail([[14, 20], [8, 22], [3, 22], [1, 19]]);
      leg([18, 22], [10, 29]);
      leg([20, 22], [13, 31]);
      g.ellipse(28, 17, 15, 5.2, fur((_u, v) => v > 0.45), -0.3);
      leg([38, 13], [47, 9]);
      leg([40, 15], [50, 12]);
      head(45, 8, 5.6, 'wide');
      break;
  }

  if (patches) {
    // Tuxedo: white chest blaze.
    g.recolor(K.Light, K.White);
  }
  g.outline(K.Outline);
  return g;
}

export class CatSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: CatCoat, pose: CatPose): Texture {
    const key = `${coat}:${pose}`;
    let texture = this.cache.get(key);
    if (!texture) {
      texture = gridToTexture(drawCat(coat, pose), COATS[coat].palette);
      this.cache.set(key, texture);
    }
    return texture;
  }
}

export function catPalette(coat: CatCoat): number[] {
  return COATS[coat].palette;
}
