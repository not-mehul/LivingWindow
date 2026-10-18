import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { drawPerson, personKey, type PersonFacing, type PersonLook, type PersonPose } from './people';

import { glyphFor } from '../scene/city/pixelFont';
import { PixelGrid, pixelHash } from './raster';

export { randomLook, type PersonFacing, type PersonLook, type PersonPose } from './people';

/** Each pedestrian's sprites, drawn at the height they're seen and dropped when they leave. */
export class PersonSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(look: PersonLook, id: number, facing: PersonFacing, pose: PersonPose, frame: number, umbrella: boolean, height: number): Texture {
    const key = personKey(id, facing, pose, frame, umbrella, height);
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, palette } = drawPerson(look, facing, pose, frame, umbrella, height);
      texture = gridToTexture(grid, palette.colors);
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

export type StallKind = 'produce' | 'tea' | 'flowers' | 'noodles' | 'tech' | 'skewers';
export const DAY_STALLS: readonly StallKind[] = ['produce', 'tea', 'flowers'];
export const NIGHT_STALLS: readonly StallKind[] = ['noodles', 'tech', 'skewers'];
/** Build-up stages while a stall is set up or packed away. */
export const STALL_STAGES = 4;

interface StallStyle {
  /** The canopy's sheet colour (corrugated metal or tarp). */
  canopy: number;
  /** A tarp patch on it, if any. */
  patch?: number;
  /** The counter's front. */
  front: number;
  /** What's for sale. */
  goods: number[];
  /** The little neon sign over it: its word (if there's room) and tube colour (an index into the light palette). */
  sign: string;
  neon: number;
}

const STALL_STYLES: Record<StallKind, StallStyle> = {
  produce: { canopy: 0x5a7a72, patch: 0x3a64a8, front: 0x6a5a4a, goods: [0x5aa83a, 0x8ad04a, 0xd84a3a, 0xf0c040], sign: 'FRESH', neon: 7 },
  tea: { canopy: 0xd8d0c0, front: 0xe8a0b8, goods: [0xd8b088, 0x8a5a3a, 0xc8a0e8, 0x9ad8c0], sign: 'TEA', neon: 6 },
  flowers: { canopy: 0x7a6a5a, patch: 0x4a8a5a, front: 0x5a4a3a, goods: [0xe86a9a, 0xf2d040, 0xb06ad8, 0xf2f0e8], sign: 'HANA', neon: 6 },
  noodles: { canopy: 0x8a3a2e, front: 0x4a1a1a, goods: [0xf2e0b0, 0xe8a040, 0xd8d8d0], sign: 'RAMEN', neon: 5 },
  tech: { canopy: 0x4a5258, patch: 0xd8742a, front: 0x2a2e34, goods: [0x8a9aa8, 0x3ae8ff, 0xd8d050, 0x4a4e56], sign: 'FIX', neon: 5 },
  skewers: { canopy: 0x6a6a5e, front: 0x3a2a22, goods: [0xb86a3a, 0xe8a050, 0x5a3a2a], sign: 'YAKI', neon: 6 },
};

interface StallInk {
  palette: Palette;
  canopy: Ramp;
  patch: Ramp | null;
  front: Ramp;
  metal: Ramp;
  wood: Ramp;
  leaf: Ramp;
  card: Ramp;
  plastic: Ramp;
  bag: Ramp;
  goods: Ramp[];
  steam: number;
  neon: number;
  screen: number;
  dark: number;
}

const NEON_ART: Record<number, number> = { 5: 0x9af4ff, 6: 0xffa8d8, 7: 0xc8ff9a };

function stallInk(kind: StallKind): StallInk {
  const style = STALL_STYLES[kind];
  const palette = new Palette();
  return {
    palette,
    canopy: palette.ramp(style.canopy),
    patch: style.patch ? palette.ramp(style.patch) : null,
    front: palette.ramp(style.front),
    metal: palette.ramp(0x7a7e86),
    wood: palette.ramp(0x8a6a44),
    leaf: palette.ramp(0x4a8a3a),
    card: palette.ramp(0xb8945a),
    plastic: palette.ramp(0x3a7ab8),
    bag: palette.ramp(0x2a2a2e, 0.6),
    goods: style.goods.map((c) => palette.ramp(c)),
    steam: palette.add(0xe8eef0),
    neon: palette.add(NEON_ART[style.neon]),
    screen: palette.add(0x1a2a3a),
    dark: palette.add(0x16141a),
  };
}

/** Pixels of a word in the small 3×5 face, from its top-left. */
function wordPixels(word: string): { w: number; px: Array<[number, number]> } {
  const px: Array<[number, number]> = [];
  let x = 0;
  for (const ch of word) {
    const g = glyphFor(ch, 'small') ?? glyphFor('?', 'small')!;
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === '#') px.push([x + c, r]);
    x += g[0].length + 1;
  }
  return { w: Math.max(0, x - 1), px };
}

interface StallLayout {
  W: number;
  H: number;
  counterTop: number;
  left: number;
  right: number;
  /** The little sign over the stall (unmirrored), and whether a word fits on it. */
  sign: { x: number; y: number; w: number; h: number; word: string | null } | null;
}

function layoutFor(kind: StallKind, height: number): StallLayout {
  const H = Math.max(5, Math.round(height));
  const W = Math.max(7, Math.round(H * 1.45));
  const counterTop = Math.round(H * 0.56);
  const left = Math.round(W * 0.05);
  const right = Math.round(W * 0.78);
  let sign: StallLayout['sign'] = null;
  if (H >= 10) {
    const word = STALL_STYLES[kind].sign;
    const text = wordPixels(word);
    const fits = H >= 24 && text.w + 4 <= right - left;
    const w = fits ? text.w + 4 : Math.max(4, Math.round((right - left) * 0.45));
    const h = fits ? 9 : Math.max(3, Math.round(H * 0.11));
    sign = { x: Math.round(left + (right - left) * 0.18), y: 0, w, h, word: fits ? word : null };
  }
  return { W, H, counterTop, left, right, sign };
}

/**
 * A market stall `height` px tall, at a set-up stage (0 = a bare counter,
 * then posts, the canopy and its sign, and finally the goods), drawn at the
 * size it's seen. Cyberpunk market style: a corrugated canopy with a neon
 * edge and cables taped along it, a little neon sign on a pole, a counter
 * of scavenged sheet, and the clutter of a life spent here (crates, a
 * cooler, bags, a stool, extension leads). `mirrored` draws it facing the
 * other way with its sign still readable.
 */
export function drawStallSized(kind: StallKind, stage: number, height: number, mirrored = false): Drawn {
  const L = layoutFor(kind, height);
  const { W, H, counterTop, left, right } = L;
  const ink = stallInk(kind);
  const g = new PixelGrid(W, H);
  const big = H >= 18;
  const postW = Math.max(1, Math.round(W * 0.025));
  // Clutter beside the stall, there before it's set up and after it's gone.
  drawClutter(g, ink, L, big);
  // Legs and posts: scaffold pipe.
  for (const x of [left, right - postW]) for (let y = counterTop; y < H; y++) for (let k = 0; k < postW; k++) g.set(x + k, y, ink.metal[k === 0 ? 3 : 1]);
  if (stage >= 1) {
    const postTop = Math.round(H * 0.16);
    for (const x of [left, right - postW]) for (let y = postTop; y < counterTop; y++) for (let k = 0; k < postW; k++) g.set(x + k, y, ink.metal[k === 0 ? 3 : 1]);
  }
  // Counter: a lit top over a front of ribbed sheet, stickered and scuffed.
  const counterH = Math.max(1, Math.round(H * 0.08));
  const skirtTo = Math.round(H * 0.86);
  for (let y = counterTop; y < counterTop + counterH; y++) for (let x = left; x < right; x++) g.set(x, y, ink.metal[y === counterTop ? 4 : 2]);
  for (let y = counterTop + counterH; y < skirtTo; y++) {
    for (let x = left + 1; x < right - 1; x++) {
      const rib = (x - left) % Math.max(2, Math.round(W * 0.04)) === 0;
      let c = ink.front[rib ? 1 : y > skirtTo - 2 ? 1 : 2];
      if (big && pixelHash(x, y, 7) < 0.04) c = ink.front[3];
      g.set(x, y, c);
    }
  }
  if (big) {
    // Stickers and a torn flyer on the counter front.
    const sx = left + Math.round((right - left) * 0.62);
    for (let y = counterTop + counterH + 2; y < counterTop + counterH + 2 + Math.round(H * 0.1); y++) for (let x = sx; x < sx + Math.round(W * 0.08); x++) g.set(x, y, (x + y) % 5 === 0 ? ink.front[0] : ink.card[3]);
    g.set(left + 3, counterTop + counterH + 3, ink.neon);
    g.set(left + 4, counterTop + counterH + 3, ink.goods[0][3]);
  }
  if (stage >= 2) drawCanopy(g, ink, kind, L);
  if (stage >= 2 && L.sign) drawSignBox(g, ink, L);
  if (stage >= 3) drawGoods(g, ink, kind, H, counterTop, left, right, big);
  if (H >= 14) selOut(g, ink.palette, { bottomHeavy: true });
  if (mirrored) g.flip();
  // The sign's word goes on last, so it reads the right way round either way.
  if (stage >= 2 && L.sign?.word) {
    const s = L.sign;
    const x0 = mirrored ? W - s.x - s.w : s.x;
    const text = wordPixels(s.word!);
    // One letter's tube has gone dim.
    const dimFrom = kind === 'tech' ? 1 : -1;
    for (const [x, y] of text.px) g.set(x0 + 2 + x, s.y + 2 + y, dimFrom >= 0 && x >= dimFrom * 4 && x < dimFrom * 4 + 3 ? ink.front[2] : ink.neon);
  }
  return { grid: g, palette: ink.palette };
}

/** Crates, a cooler, bin bags, a stool and a tangle of leads, off to the side and under the counter. */
function drawClutter(g: PixelGrid, ink: StallInk, L: StallLayout, big: boolean): void {
  const { W, H, right } = L;
  const x0 = right + 1;
  const cw = Math.max(2, Math.round(H * 0.2));
  // Stacked crates.
  for (let k = 0; k < (big ? 2 : 1); k++) {
    const y1 = H - k * Math.round(cw * 0.75);
    const y0 = y1 - Math.round(cw * 0.75);
    const cx = x0 + (k === 1 ? 1 : 0);
    for (let y = y0; y < y1; y++) for (let x = cx; x < Math.min(W, cx + cw); x++) g.set(x, y, (y - y0) % 3 === 0 ? ink.wood[1] : ink.wood[x === cx ? 3 : 2]);
  }
  // A cool box with a white lid.
  const bx = Math.min(W - 2, x0 + cw + 1);
  const bw = Math.max(2, Math.round(H * 0.14));
  const bh = Math.max(2, Math.round(H * 0.11));
  for (let y = H - bh; y < H; y++) for (let x = bx; x < Math.min(W, bx + bw); x++) g.set(x, y, y === H - bh ? ink.metal[4] : ink.plastic[x === bx ? 3 : 2]);
  // Bin bags heaped at the foot of the counter.
  const bagR = Math.max(1, H * 0.07);
  for (let k = 0; k < 2; k++) {
    const cx = L.left + 2 + k * bagR * 1.6;
    if (bagR >= 1.4) shadedEllipse(g, cx, H - bagR, bagR, bagR * 0.9, ink.bag, { dither: false });
    else g.set(Math.floor(cx), H - 1, ink.bag[1]);
  }
  if (big) {
    // A stool, and leads snaking off along the ground.
    const sx = Math.round(L.left + (L.right - L.left) * 0.4);
    for (let x = sx; x < sx + 4; x++) g.set(x, H - 4, ink.plastic[3]);
    g.set(sx, H - 3, ink.metal[1]);
    g.set(sx + 3, H - 3, ink.metal[1]);
    g.set(sx, H - 2, ink.metal[1]);
    g.set(sx + 3, H - 2, ink.metal[1]);
    for (let x = L.left; x < W - 1; x++) if (Math.sin(x * 0.7) > 0.3) g.set(x, H - 1, ink.dark);
    // A cardboard box with its flaps open.
    const kx = Math.max(0, L.left - 1);
    for (let y = H - Math.round(H * 0.14); y < H - 1; y++) for (let x = kx; x < kx + Math.round(H * 0.16); x++) if (x < L.left + 1 || y > H - 4) g.set(x, y, ink.card[x === kx ? 3 : 2]);
  }
}

/** The canopy: a sloping corrugated sheet (or tarp), patched, with a cable taped along it and a neon tube at its front edge. */
function drawCanopy(g: PixelGrid, ink: StallInk, kind: StallKind, L: StallLayout): void {
  const { W, H, left, right } = L;
  const top = Math.round(H * 0.15);
  const bottom = Math.round(H * 0.27);
  const x0 = Math.max(0, left - Math.round(W * 0.04));
  const x1 = Math.min(W, right + Math.round(W * 0.05));
  const ribEvery = Math.max(2, Math.round(W * 0.05));
  for (let y = top; y < bottom; y++) {
    const t = (y + 0.5 - top) / Math.max(1, bottom - top);
    const sag = Math.round(t * t * 1);
    for (let x = x0; x < x1; x++) {
      const rib = (x - x0) % ribEvery === 0;
      let r = ink.canopy;
      // A tarp patch over a rusted hole.
      if (ink.patch && x > x0 + (x1 - x0) * 0.55 && x < x0 + (x1 - x0) * 0.82) r = ink.patch;
      let c = r[rib ? 1 : t < 0.3 ? 3 : 2];
      if (r === ink.canopy && pixelHash(x, y, 3) < 0.08) c = ink.wood[1];
      g.set(x, y + sag, c);
    }
  }
  // The front edge: a neon tube.
  for (let x = x0; x < x1; x++) g.set(x, bottom + 1, ink.neon);
  // A cable taped along the top, drooping off one end.
  if (H >= 14) {
    for (let x = x0 + 1; x < x1 - 1; x++) if (x % 3 !== 0) g.set(x, top, ink.dark);
    for (let y = top; y < Math.round(H * 0.5); y++) g.set(x1 - 1 + Math.round(Math.sin(y * 0.6)), y, ink.dark);
  }
  void kind;
}

/** The little sign on its pole above the canopy: a dark frame, lit with a word or a block of glyph light. */
function drawSignBox(g: PixelGrid, ink: StallInk, L: StallLayout): void {
  const s = L.sign!;
  const pole = s.x + Math.floor(s.w / 2);
  for (let y = s.y + s.h; y < Math.round(L.H * 0.16); y++) g.set(pole, y, ink.metal[1]);
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.set(x, y, y === s.y || y === s.y + s.h - 1 || x === s.x || x === s.x + s.w - 1 ? ink.metal[0] : ink.screen);
  if (!s.word) {
    // Too small to read: a few strokes of light.
    for (let x = s.x + 1; x < s.x + s.w - 1; x++) if (x % 2 === 0) for (let y = s.y + 1; y < s.y + s.h - 1; y++) g.set(x, y, ink.neon);
  }
}

/** What's on the counter (and hanging over it). */
function drawGoods(g: PixelGrid, ink: StallInk, kind: StallKind, H: number, counterTop: number, left: number, right: number, big: boolean): void {
  const span = right - left;
  if (kind === 'produce') {
    // Hydroponic greens in trays under a strip of grow-light, a crate of tomatoes and lemons.
    for (let x = left + 1; x < right - 1; x++) g.set(x, Math.round(H * 0.3), x % 2 ? ink.goods[2][4] : ink.neon);
    const trays = Math.max(2, Math.round(span / Math.max(4, H * 0.3)));
    const tw = span / trays;
    for (let i = 0; i < trays; i++) {
      const cx = left + (i + 0.5) * tw;
      const r = ink.goods[i % 2];
      const fr = Math.max(0.8, H * 0.06);
      for (let k = 0; k < Math.max(1, Math.floor(tw / (fr * 1.6))); k++) {
        const fx = cx - tw / 2 + 1 + k * fr * 1.6;
        if (fr >= 1.3) shadedEllipse(g, fx, counterTop - fr, fr, fr * 1.2, r, { dither: false });
        else g.set(Math.floor(fx), counterTop - 1, r[3]);
      }
      if (big && i === trays - 1) for (let k = 0; k < 3; k++) g.set(Math.floor(cx - 1 + k), counterTop - 1, ink.goods[2 + (k % 2)][3]);
    }
  } else if (kind === 'tea') {
    // Cups of milk tea with dark pearls, a dispenser, and a menu screen.
    const cupW = Math.max(1, Math.round(H * 0.08));
    const cupH = Math.max(2, Math.round(H * 0.14));
    for (let k = 0; k < Math.max(2, Math.floor(span * 0.55 / (cupW + 1))); k++) {
      const cx = left + 1 + k * (cupW + 1);
      const r = ink.goods[(k % 2) * 2];
      for (let y = counterTop - cupH; y < counterTop; y++) for (let x = cx; x < cx + cupW; x++) g.set(x, y, y === counterTop - cupH ? ink.metal[4] : y > counterTop - 3 && (x + y) % 2 === 0 ? ink.goods[1][1] : r[2]);
      if (big) g.set(cx + Math.floor(cupW / 2), counterTop - cupH - 1, ink.neon);
    }
    const mx = left + Math.round(span * 0.62);
    const mw = Math.max(3, Math.round(span * 0.32));
    const my = Math.round(H * 0.32);
    const mh = Math.max(2, Math.round(H * 0.16));
    for (let y = my; y < my + mh; y++) for (let x = mx; x < mx + mw; x++) g.set(x, y, y === my || x === mx ? ink.metal[1] : (y - my) % 2 === 0 && x % 3 !== 0 ? ink.goods[3][3] : ink.screen);
  } else if (kind === 'flowers') {
    // Buckets of bunches on a wire rack.
    const buckets = Math.max(2, Math.round(span / Math.max(4, H * 0.28)));
    const bw = span / buckets;
    for (let i = 0; i < buckets; i++) {
      const cx = left + (i + 0.5) * bw;
      const bucketH = Math.max(1, Math.round(H * 0.1));
      const half = Math.max(1, bw * 0.3);
      for (let y = counterTop - bucketH; y < counterTop; y++) for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) g.set(x, y, ink.metal[x < cx ? 3 : 2]);
      const r = ink.goods[i % ink.goods.length];
      const top = counterTop - bucketH - Math.max(2, H * 0.18);
      for (let y = Math.floor(top); y < counterTop - bucketH; y++) for (let x = Math.floor(cx - half + 0.5); x < Math.ceil(cx + half - 0.5); x += 2) g.set(x, y, ink.leaf[(x + y) % 2 === 0 ? 2 : 1]);
      const domeW = half * 1.6;
      const domeH = Math.max(1, H * 0.08);
      for (let y = Math.floor(top - domeH); y <= Math.floor(top + domeH * 0.6); y++) {
        for (let x = Math.floor(cx - domeW); x <= Math.floor(cx + domeW); x++) {
          const dx = (x + 0.5 - cx) / domeW;
          const dy = (y + 0.5 - top) / domeH;
          if (dx * dx + dy * dy > 1) continue;
          const n = (x * 7 + y * 13 + i * 5) % 5;
          g.set(x, y, n === 0 ? ink.leaf[2] : r[dx + dy < -0.4 ? 4 : n % 2 === 0 ? 3 : 2]);
        }
      }
    }
  } else if (kind === 'noodles') {
    // A steaming pot, stacked bowls, and a bottle of chilli oil.
    const potR = Math.max(1.5, H * 0.13);
    const px = left + span * 0.3;
    shadedEllipse(g, px, counterTop - potR * 0.7, potR, potR * 0.8, ink.metal, { dither: false });
    for (let x = Math.floor(px - potR); x <= Math.floor(px + potR); x++) g.set(x, Math.floor(counterTop - potR * 1.4), ink.metal[4]);
    if (big) {
      for (let k = 0; k < 3; k++) {
        const sx = px - potR * 0.5 + k * potR * 0.5;
        for (let y = 0; y < H * 0.14; y++) g.set(Math.floor(sx + Math.sin(y * 0.9 + k) * 0.8), Math.floor(counterTop - potR * 1.6 - y), y % 3 === 0 ? 0 : ink.steam);
      }
    }
    const bowlW = Math.max(2, Math.round(H * 0.12));
    for (let k = 0; k < (big ? 3 : 2); k++) {
      const bx = left + span * 0.62 + k * (bowlW + 1);
      for (let y = 0; y < Math.max(1, Math.round(H * 0.06)); y++) for (let x = 0; x < bowlW - y; x++) g.set(Math.floor(bx + x + y / 2), counterTop - 1 - y, ink.goods[0][y === 0 ? 2 : 3]);
    }
    if (big) for (let y = counterTop - 4; y < counterTop; y++) g.set(right - 3, y, y === counterTop - 4 ? ink.metal[4] : ink.goods[1][1]);
  } else if (kind === 'tech') {
    // A pegboard of cables and chrome parts, a pair of little screens, boxes of chips.
    const pegTop = Math.round(H * 0.3);
    for (let y = pegTop; y < counterTop; y++) for (let x = left + 1; x < right - 1; x++) g.set(x, y, (x + y) % 3 === 0 ? ink.front[1] : ink.front[2]);
    for (let k = 0; k < Math.max(2, Math.floor(span / 3)); k++) {
      const x = left + 2 + k * 3;
      const len = 2 + ((k * 5) % 4);
      for (let y = pegTop + 1; y < Math.min(counterTop - 1, pegTop + 1 + len); y++) g.set(x, y, k % 3 === 0 ? ink.goods[2][2] : k % 3 === 1 ? ink.metal[3] : ink.dark);
    }
    const sw = Math.max(2, Math.round(H * 0.14));
    const sh = Math.max(2, Math.round(H * 0.1));
    for (const sx of [left + 2, left + 3 + sw]) {
      for (let y = counterTop - sh; y < counterTop; y++) for (let x = sx; x < sx + sw; x++) g.set(x, y, y === counterTop - sh || x === sx ? ink.metal[1] : (x + y) % 2 === 0 ? ink.goods[1][3] : ink.screen);
    }
    for (let x = right - Math.round(span * 0.3); x < right - 1; x++) g.set(x, counterTop - 1, x % 2 ? ink.goods[2][3] : ink.goods[0][2]);
  } else {
    // Skewers on a charcoal grill, the coals glowing, smoke rising.
    const gx0 = left + 1;
    const gx1 = left + Math.round(span * 0.66);
    const gy = counterTop - Math.max(1, Math.round(H * 0.06));
    for (let x = gx0; x < gx1; x++) {
      g.set(x, gy, ink.metal[1]);
      g.set(x, gy + 1, x % 2 ? ink.goods[1][4] : ink.goods[0][2]);
    }
    for (let x = gx0 + 1; x < gx1 - 1; x += 2) for (let y = gy - Math.max(2, Math.round(H * 0.1)); y < gy; y++) g.set(x, y, y === gy - 1 ? ink.wood[3] : ink.goods[(x >> 1) % 2 === 0 ? 0 : 2][2]);
    if (big) {
      for (let k = 0; k < 3; k++) {
        const sx = gx0 + (gx1 - gx0) * (0.25 + k * 0.25);
        for (let y = 0; y < H * 0.16; y++) if (y % 2 === 0) g.set(Math.floor(sx + Math.sin(y * 0.7 + k) * 1.2), Math.floor(gy - 4 - y), ink.steam);
      }
    }
  }
}

/** Glowing bits of a night stall, to draw additively after dark: the canopy's neon edge, the sign, screens, the grill and the pot. */
export function drawStallLightsSized(kind: StallKind, height: number, mirrored = false): PixelGrid | null {
  if (!NIGHT_STALLS.includes(kind)) return null;
  const L = layoutFor(kind, height);
  const { W, H, counterTop, left, right } = L;
  const g = new PixelGrid(W, H);
  const neon = STALL_STYLES[kind].neon;
  const bottom = Math.round(H * 0.27);
  const x0 = Math.max(0, left - Math.round(W * 0.04));
  const x1 = Math.min(W, right + Math.round(W * 0.05));
  // The neon tube along the canopy's edge, one section dead.
  for (let x = x0; x < x1; x++) if (!(x > x0 + (x1 - x0) * 0.6 && x < x0 + (x1 - x0) * 0.7)) g.set(x, bottom + 1, neon);
  const span = right - left;
  if (kind === 'noodles') glowBlob(g, left + span * 0.3, counterTop - H * 0.12, Math.max(1, H * 0.07), 2);
  if (kind === 'tech') {
    const sw = Math.max(2, Math.round(H * 0.14));
    const sh = Math.max(2, Math.round(H * 0.1));
    for (const sx of [left + 2, left + 3 + sw]) for (let y = counterTop - sh + 1; y < counterTop; y++) for (let x = sx + 1; x < sx + sw; x++) g.set(x, y, 5);
  }
  if (kind === 'skewers') for (let x = left + 1; x < left + Math.round(span * 0.66); x += 2) g.set(x, counterTop - Math.max(1, Math.round(H * 0.06)) + 1, 2);
  // Warm light on the counter.
  for (let x = left + 2; x < right - 2; x += 2) g.set(x, counterTop - 1, 3);
  if (mirrored) g.flip();
  // The sign, lit: its word, or its strokes of light.
  const s = L.sign;
  if (s) {
    const sx = mirrored ? W - s.x - s.w : s.x;
    if (s.word) {
      const dimFrom = kind === 'tech' ? 1 : -1;
      for (const [x, y] of wordPixels(s.word).px) if (!(dimFrom >= 0 && x >= dimFrom * 4 && x < dimFrom * 4 + 3)) g.set(sx + 2 + x, s.y + 2 + y, neon);
    } else for (let x = sx + 1; x < sx + s.w - 1; x++) if (x % 2 === 0) for (let y = s.y + 1; y < s.y + s.h - 1; y++) g.set(x, y, neon);
  }
  return g;
}

function glowBlob(g: PixelGrid, x: number, y: number, radius: number, color: number): void {
  if (radius < 1.5) {
    g.set(Math.floor(x), Math.floor(y), color);
    return;
  }
  g.ellipse(x, y, radius * 0.8, radius * 0.9, color);
  g.set(Math.floor(x - radius * 0.3), Math.floor(y - radius * 0.3), 4);
}

export const STALL_LIGHT_PALETTE = [0, 0xffe6a0, 0xff7a3c, 0xffc870, 0xffd8a8, 0x4ae8ff, 0xff4aa8, 0x9aff4a];

export class StallSpriteCache {
  private readonly cache = new Map<string, Texture>();

  /** A stall at a set-up stage, drawn `height` px tall (it's seen at many distances), facing either way. */
  get(kind: StallKind, stage: number, height: number, mirrored = false): Texture {
    const key = `${kind}:${stage}:${height}:${mirrored}`;
    let texture = this.cache.get(key);
    if (!texture) {
      const { grid, palette } = drawStallSized(kind, stage, height, mirrored);
      texture = gridToTexture(grid, palette.colors);
      this.cache.set(key, texture);
    }
    return texture;
  }

  lights(kind: StallKind, height: number, mirrored = false): Texture | null {
    const key = `${kind}:lights:${height}:${mirrored}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const grid = drawStallLightsSized(kind, height, mirrored);
    if (!grid) return null;
    const texture = gridToTexture(grid, STALL_LIGHT_PALETTE);
    this.cache.set(key, texture);
    return texture;
  }
}
