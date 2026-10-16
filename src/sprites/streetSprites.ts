import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { PixelGrid } from './raster';

/** Pedestrians are seen from high up across the street: about 10 px tall. */
export const PERSON_WIDTH = 7;
export const PERSON_HEIGHT = 13;

export type PersonFrame = 'stand' | 'walk-a' | 'walk-b';

export interface PersonLook {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  umbrella: number;
  /** Long coat instead of a shirt. */
  coat: boolean;
  bag: boolean;
  tall: boolean;
}

const SKINS = [0xf1c8a0, 0xd9a47c, 0xb07a52, 0x8a5a3c, 0x5e3c28];
const HAIRS = [0x2a1e16, 0x4a3020, 0x8a6a3a, 0xc8b070, 0x1a1a1e, 0x8a8a90, 0xa04a2a];
const TOPS = [0xc8443c, 0x3c6aa8, 0xe0c060, 0x4a8a5a, 0xe8e4dc, 0x6a4a8a, 0xd08040, 0x30343e, 0x8ab0d0];
const BOTTOMS = [0x2e3444, 0x4a4a52, 0x2a2a30, 0x6a5a48, 0x3a4a6a];
const UMBRELLAS = [0xd03c3c, 0x2a2a34, 0x3c6ac8, 0xe8c040, 0x3c9a6a, 0xe8e8e8, 0xa04aa0];

export function randomLook(rng: () => number = Math.random): PersonLook {
  const pick = (items: readonly number[]) => items[Math.floor(rng() * items.length)];
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    top: pick(TOPS),
    bottom: pick(BOTTOMS),
    shoes: rng() < 0.5 ? 0x1e1e22 : 0x5a3a2a,
    umbrella: pick(UMBRELLAS),
    coat: rng() < 0.3,
    bag: rng() < 0.25,
    tall: rng() < 0.5,
  };
}

const enum P {
  Skin = 1,
  Hair = 2,
  Top = 3,
  Bottom = 4,
  Shoes = 5,
  Umbrella = 6,
  Handle = 7,
  Bag = 8,
  TopShade = 9,
}

function personPalette(look: PersonLook): number[] {
  const shade = (c: number) => {
    const r = ((c >> 16) & 255) * 0.72;
    const g = ((c >> 8) & 255) * 0.72;
    const b = (c & 255) * 0.72;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  };
  return [0, look.skin, look.hair, look.top, look.bottom, look.shoes, look.umbrella, 0x2a2a2a, 0x6a4a30, shade(look.top)];
}

/** A tiny pedestrian facing right; feet on the bottom row. */
export function drawPerson(look: PersonLook, frame: PersonFrame, umbrella: boolean): PixelGrid {
  const g = new PixelGrid(PERSON_WIDTH, PERSON_HEIGHT);
  const top = look.tall ? 3 : 4; // head row
  // Umbrella canopy above the head, held in the leading hand.
  if (umbrella) {
    g.rect(0, top - 3, 7, 1, P.Umbrella);
    g.rect(1, top - 4, 5, 1, P.Umbrella);
    g.set(4, top - 2, P.Handle);
    g.set(4, top - 1, P.Handle);
  }
  g.set(3, top, P.Hair);
  g.set(2, top, P.Hair);
  g.set(2, top + 1, P.Hair);
  g.set(3, top + 1, P.Skin);
  const torso = top + 2;
  const torsoLength = look.coat ? 4 : 3;
  g.rect(2, torso, 2, torsoLength, P.Top);
  g.set(2, torso + torsoLength - 1, P.TopShade);
  // Arm: swinging when walking, raised when holding an umbrella.
  if (umbrella) g.set(4, torso, P.Top);
  else if (frame === 'walk-a') g.set(4, torso + 1, P.Skin);
  else if (frame === 'walk-b') g.set(1, torso + 1, P.Skin);
  else g.set(4, torso + 1, P.TopShade);
  if (look.bag) g.set(1, torso + 2, P.Bag);

  const hips = torso + torsoLength;
  const legRows = PERSON_HEIGHT - 1 - hips;
  for (let i = 0; i < legRows; i++) {
    const y = hips + i;
    if (frame === 'stand' || i === 0) {
      g.set(2, y, P.Bottom);
      g.set(3, y, P.Bottom);
    } else if (frame === 'walk-a') {
      g.set(2 - (i > 1 ? 1 : 0), y, P.Bottom);
      g.set(3 + (i > 1 ? 1 : 0), y, P.Bottom);
    } else {
      g.set(2, y, P.Bottom);
      g.set(3, y, P.Bottom);
    }
  }
  const feet = PERSON_HEIGHT - 1;
  if (frame === 'walk-a') {
    g.set(1, feet, P.Shoes);
    g.set(4, feet, P.Shoes);
  } else {
    g.set(2, feet, P.Shoes);
    g.set(3, feet, P.Shoes);
  }
  return g;
}

/**
 * A pedestrian at any height: the full figure from about 13 px up (scaled
 * crisply), and below that a simpler one that keeps a head, a coloured body
 * and striding legs down to a few pixels.
 */
export function drawPersonSized(look: PersonLook, frame: PersonFrame, umbrella: boolean, height: number): PixelGrid {
  const h = Math.max(3, Math.round(height));
  if (h >= PERSON_HEIGHT) return drawPerson(look, frame, umbrella).resampled(Math.round((PERSON_WIDTH * h) / PERSON_HEIGHT), h);
  const w = Math.max(3, Math.round(h * 0.5));
  const g = new PixelGrid(w, h);
  const mid = Math.floor((w - 1) / 2);
  const headRows = h >= 8 ? 2 : 1;
  const canopy = umbrella && h >= 5 ? 1 : 0;
  if (canopy) for (let x = 0; x < w; x++) g.set(x, 0, P.Umbrella);
  const head = canopy;
  g.set(mid, head, h >= 8 ? P.Hair : P.Skin);
  if (headRows === 2) g.set(mid, head + 1, P.Skin);
  const torso = head + headRows;
  const legs = Math.max(1, Math.round((h - torso) * 0.45));
  const torsoRows = Math.max(1, h - torso - legs);
  const bodyW = w >= 4 ? 2 : 1;
  g.rect(mid, torso, bodyW, torsoRows, P.Top);
  if (torsoRows > 1) g.set(mid, torso + torsoRows - 1, P.TopShade);
  for (let i = 0; i < legs; i++) {
    const y = torso + torsoRows + i;
    const spread = frame === 'walk-a' && i > 0 ? 1 : 0;
    g.set(mid - spread, y, i === legs - 1 ? P.Shoes : P.Bottom);
    if (bodyW > 1 || spread) g.set(mid + bodyW - 1 + spread, y, i === legs - 1 ? P.Shoes : P.Bottom);
  }
  return g;
}

export class PersonSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(look: PersonLook, id: number, frame: PersonFrame, umbrella: boolean, height = PERSON_HEIGHT): Texture {
    const key = `${id}:${frame}:${umbrella}:${height}`;
    let texture = this.cache.get(key);
    if (!texture) {
      texture = gridToTexture(drawPersonSized(look, frame, umbrella, height), personPalette(look));
      this.cache.set(key, texture);
    }
    return texture;
  }

  forget(id: number): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${id}:`)) {
        this.cache.get(key)?.destroy(true);
        this.cache.delete(key);
      }
    }
  }
}

// --- Market stalls ------------------------------------------------------

export type StallKind = 'fruit' | 'flowers' | 'cart' | 'noodles' | 'lanterns' | 'trinkets';
export const DAY_STALLS: readonly StallKind[] = ['fruit', 'flowers', 'cart'];
export const NIGHT_STALLS: readonly StallKind[] = ['noodles', 'lanterns', 'trinkets'];
export const STALL_WIDTH = 20;
export const STALL_HEIGHT = 16;
/** Build-up stages while a stall is set up or packed away. */
export const STALL_STAGES = 4;

const enum S {
  Wood = 1,
  WoodDark = 2,
  AwningA = 3,
  AwningB = 4,
  GoodA = 5,
  GoodB = 6,
  GoodC = 7,
  Cloth = 8,
  Metal = 9,
}

const STALL_PALETTES: Record<StallKind, number[]> = {
  fruit: [0, 0x8a6040, 0x5a3c26, 0xd8463c, 0xf2ece0, 0xe0503a, 0xf0a030, 0x7ab040, 0x4a7a3a, 0x6a6a72],
  flowers: [0, 0x8a6040, 0x5a3c26, 0x3c8a5a, 0xf2ece0, 0xe86a9a, 0xf2d040, 0xb06ad8, 0x3c7a4a, 0x6a6a72],
  cart: [0, 0xc8c8cc, 0x6a6a72, 0x3c6ab8, 0xf2ece0, 0xc88a4a, 0xe8d0a0, 0xa04a2a, 0x8a8a92, 0x2a2a30],
  noodles: [0, 0x6a4430, 0x3a2418, 0xa82a2a, 0x7a1e1e, 0xf2e0b0, 0xe8a040, 0xd8d8d0, 0x5a1a1a, 0x4a4a52],
  lanterns: [0, 0x6a4430, 0x3a2418, 0x2a3a6a, 0x1e2a50, 0xe84a3a, 0xf0b040, 0xe86aa0, 0x2a2a44, 0x4a4a52],
  trinkets: [0, 0x6a4430, 0x3a2418, 0x5a2a6a, 0x3e1e4a, 0x6ac8d8, 0xe8d050, 0xd86a6a, 0x3a1e44, 0x4a4a52],
};

/** Draw a stall at a set-up stage (0 = bare, STALL_STAGES - 1 = fully open). */
export function drawStall(kind: StallKind, stage: number): PixelGrid {
  const g = new PixelGrid(STALL_WIDTH, STALL_HEIGHT);
  const W = STALL_WIDTH;
  const H = STALL_HEIGHT;
  if (kind === 'cart') {
    // A rolling food cart under a parasol.
    g.rect(3, H - 7, 13, 5, S.Wood);
    g.rect(3, H - 7, 13, 1, S.Metal);
    g.rect(4, H - 5, 11, 1, S.AwningA);
    g.set(5, H - 1, S.WoodDark);
    g.set(6, H - 1, S.WoodDark);
    g.set(13, H - 1, S.WoodDark);
    g.set(14, H - 1, S.WoodDark);
    g.rect(5, H - 2, 2, 1, S.WoodDark);
    g.rect(13, H - 2, 2, 1, S.WoodDark);
    if (stage >= 1) g.rect(9, H - 14, 1, 7, S.Metal);
    if (stage >= 2) {
      g.rect(3, H - 14, 14, 1, S.AwningA);
      g.rect(5, H - 15, 10, 1, S.AwningA);
      for (let x = 3; x < 17; x += 4) g.rect(x, H - 14, 2, 1, S.AwningB);
    }
    if (stage >= 3) {
      g.rect(5, H - 8, 2, 1, S.GoodA);
      g.rect(8, H - 8, 2, 1, S.GoodB);
      g.rect(11, H - 8, 3, 1, S.GoodC);
    }
    return g;
  }
  // Table stall: counter, posts, striped awning, goods.
  g.rect(2, H - 6, W - 4, 2, S.Wood);
  g.rect(2, H - 4, W - 4, 1, S.WoodDark);
  g.rect(3, H - 3, 1, 3, S.WoodDark);
  g.rect(W - 4, H - 3, 1, 3, S.WoodDark);
  if (stage >= 1) {
    g.rect(2, H - 14, 1, 8, S.WoodDark);
    g.rect(W - 3, H - 14, 1, 8, S.WoodDark);
  }
  if (stage >= 2) {
    const awningRows = stage >= 3 ? 3 : 2;
    for (let row = 0; row < awningRows; row++) {
      for (let x = 1; x < W - 1; x++) {
        g.set(x, H - 15 + row, Math.floor(x / 2) % 2 === 0 ? S.AwningA : S.AwningB);
      }
    }
    // Scalloped edge.
    for (let x = 1; x < W - 1; x += 2) g.set(x, H - 15 + awningRows, S.AwningA);
  }
  if (stage >= 3) {
    for (let x = 3; x < W - 3; x++) {
      const pick = [S.GoodA, S.GoodB, S.GoodC][(x * 7) % 3];
      g.set(x, H - 7, pick);
      if (x % 2 === 0) g.set(x, H - 8, pick);
    }
    g.rect(2, H - 6, W - 4, 1, S.Cloth);
  }
  return g;
}

/** Emissive overlay for night stalls: string lights, a lantern and a warm counter glow. */
export function drawStallLights(kind: StallKind): PixelGrid | null {
  if (!NIGHT_STALLS.includes(kind)) return null;
  const g = new PixelGrid(STALL_WIDTH, STALL_HEIGHT);
  const H = STALL_HEIGHT;
  for (let x = 1; x < STALL_WIDTH - 1; x += 3) g.set(x, H - 11 + (x % 2), 1);
  g.rect(STALL_WIDTH - 6, H - 11, 2, 3, 2);
  for (let x = 4; x < STALL_WIDTH - 4; x += 2) g.set(x, H - 7, 3);
  return g;
}

export const STALL_LIGHT_PALETTE = [0, 0xffe6a0, 0xff5a3c, 0xffc870];

export class StallSpriteCache {
  private readonly cache = new Map<string, Texture>();

  /** A stall at a set-up stage, drawn `height` px tall (it's seen at many distances). */
  get(kind: StallKind, stage: number, height = STALL_HEIGHT): Texture {
    const key = `${kind}:${stage}:${height}`;
    let texture = this.cache.get(key);
    if (!texture) {
      const grid = drawStall(kind, stage);
      texture = gridToTexture(height === STALL_HEIGHT ? grid : grid.resampled(Math.round((STALL_WIDTH * height) / STALL_HEIGHT), height), STALL_PALETTES[kind]);
      this.cache.set(key, texture);
    }
    return texture;
  }

  lights(kind: StallKind, height = STALL_HEIGHT): Texture | null {
    const key = `${kind}:lights:${height}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const grid = drawStallLights(kind);
    if (!grid) return null;
    const texture = gridToTexture(height === STALL_HEIGHT ? grid : grid.resampled(Math.round((STALL_WIDTH * height) / STALL_HEIGHT), height), STALL_LIGHT_PALETTE);
    this.cache.set(key, texture);
    return texture;
  }
}

export function stallPalette(kind: StallKind): number[] {
  return STALL_PALETTES[kind];
}
