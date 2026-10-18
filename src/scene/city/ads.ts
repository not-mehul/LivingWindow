import { lerpColor, scaleColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { pixelHash } from '../../sprites/raster';
import { drawGlyph, drawText, FONT_HEIGHT, textWidth, type FontFace } from './pixelFont';

/**
 * The city's advertising: a catalogue of animated ads, each drawn pixel by
 * pixel at the size of the screen it plays on. Every brand is made up. They
 * sell the city's small comforts (a fizzy drink, a dream for an hour, a
 * friend who's always listening) with the odd crack showing: small print,
 * a dead pixel column, a promise that's not quite a promise.
 */

export type AdId = 'neurocola' | 'kaiju' | 'dreamdive' | 'askkai' | 'soulsync' | 'nanocare' | 'ramen' | 'curfew';

/** A screen's wear and tear. */
export type ScreenFlaw = 'dead-column' | 'stuck-row' | 'dim-corner' | null;

export interface AdSpec {
  frames: number;
  /** How long each frame shows (s). */
  frameSeconds: (frame: number) => number;
  /** The colour the screen throws on its surroundings at night. */
  glow: number;
}

export const ADS: Record<AdId, AdSpec> = {
  neurocola: { frames: 4, frameSeconds: (f) => [1.6, 0.5, 0.6, 2.4][f], glow: 0xff3a6a },
  kaiju: { frames: 4, frameSeconds: (f) => [1.4, 0.12, 0.1, 1.8][f], glow: 0x9aff3a },
  dreamdive: { frames: 4, frameSeconds: (f) => [0.7, 0.7, 0.7, 2.2][f], glow: 0x7a6aff },
  askkai: { frames: 5, frameSeconds: (f) => [2.6, 0.14, 1.8, 2.2, 2.6][f], glow: 0x4ae8ff },
  soulsync: { frames: 3, frameSeconds: (f) => [1.2, 0.5, 1.6][f], glow: 0xff7ad8 },
  nanocare: { frames: 3, frameSeconds: (f) => [2.2, 1.6, 0.4][f], glow: 0x6affd0 },
  ramen: { frames: 3, frameSeconds: () => 0.45, glow: 0xffa040 },
  curfew: { frames: 96, frameSeconds: () => 0.09, glow: 0xffb040 },
};

/** Draw one frame of an ad at w×h, as a lit screen: every pixel set. */
export function drawAd(id: AdId, frame: number, w: number, h: number, flaw: ScreenFlaw = null, seed = 1): PixelBuffer {
  const p = new Painter(w, h);
  const f = ((frame % ADS[id].frames) + ADS[id].frames) % ADS[id].frames;
  DRAWERS[id](p, f);
  p.screen(flaw, seed);
  return p.buf;
}

// --- A little painter over a PixelBuffer ----------------------------------------------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

type Fill = number | ((x: number, y: number) => number);

class Painter {
  readonly buf: PixelBuffer;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.buf = new PixelBuffer(w, h);
  }

  px(x: number, y: number, c: Fill): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf.set(x, y, typeof c === 'number' ? c : c(x, y));
  }

  get(x: number, y: number): number {
    return this.buf.get(Math.round(x), Math.round(y));
  }

  rect(x: number, y: number, w: number, h: number, c: Fill): void {
    for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) this.px(i, j, c);
  }

  /** A dithered ramp: level 0..1 picks between the ramp's steps, blending neighbours. */
  ramp(ramp: readonly number[], level: number, x: number, y: number): number {
    const v = Math.max(0, Math.min(0.9999, level)) * (ramp.length - 1);
    const i = Math.floor(v);
    return v - i > bayer(x, y) ? ramp[Math.min(ramp.length - 1, i + 1)] : ramp[i];
  }

  /** Fill a box with a vertical dithered gradient down a ramp (top to bottom). */
  vgrad(x: number, y: number, w: number, h: number, ramp: readonly number[], reverse = false): void {
    this.rect(x, y, w, h, (px, py) => {
      const t = (py - y) / Math.max(1, h - 1);
      return this.ramp(ramp, reverse ? 1 - t : t, px, py);
    });
  }

  /** A filled ellipse; `c` may shade by the pixel's place inside it (u, v from -1..1). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number | ((u: number, v: number, x: number, y: number) => number)): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x + 0.5 - cx) / Math.max(0.5, rx);
        const v = (y + 0.5 - cy) / Math.max(0.5, ry);
        if (u * u + v * v > 1) continue;
        this.px(x, y, typeof c === 'number' ? c : c(u, v, x, y));
      }
    }
  }

  /** A ring round an ellipse. */
  ring(cx: number, cy: number, rx: number, ry: number, width: number, c: number): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const u = (x + 0.5 - cx) / rx;
        const v = (y + 0.5 - cy) / ry;
        const d = Math.hypot(u, v);
        if (Math.abs(d - 1) * Math.min(rx, ry) < width / 2) this.px(x, y, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Fill, width = 1): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let k = 0; k < width; k++) this.px(x - (width - 1) / 2 + k, y, c);
    }
  }

  /** A filled polygon, even-odd, from points in px. */
  polygon(points: ReadonlyArray<readonly [number, number]>, c: Fill): void {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of points) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.px(x, y, c);
    }
  }

  /** Text with a dark drop shadow, so it reads on any background. Returns its width. */
  text(text: string, x: number, y: number, c: Fill, face: FontFace = 'small', shadow: number | null = 0x0a0610, scale = 1): number {
    if (shadow !== null) drawText(this.buf, text, Math.round(x) + scale, Math.round(y) + scale, shadow, face, scale);
    return drawText(this.buf, text, Math.round(x), Math.round(y), c, face, scale);
  }

  /** Centred text. */
  ctext(text: string, cx: number, y: number, c: Fill, face: FontFace = 'small', shadow: number | null = 0x0a0610, scale = 1): void {
    this.text(text, Math.round(cx - (textWidth(text, face) * scale) / 2), y, c, face, shadow, scale);
  }

  /** The first of several wordings that fits in a box, in the first face that fits (null if none does). */
  fit(options: readonly string[], width: number, faces: readonly FontFace[] = ['bold', 'small'], height = Infinity): { text: string; face: FontFace } | null {
    for (const face of faces) {
      if (FONT_HEIGHT[face] > height) continue;
      for (const text of options) if (text && textWidth(text, face) <= width) return { text, face };
    }
    return null;
  }

  /** Text that fits, or nothing at all. Returns the face used (null if it didn't fit). */
  fitted(options: readonly string[], x: number, y: number, width: number, c: Fill, faces: readonly FontFace[] = ['bold', 'small'], shadow: number | null = 0x0a0610, height = Infinity): FontFace | null {
    const fit = this.fit(options, width, faces, height);
    if (!fit) return null;
    this.text(fit.text, x, y, c, fit.face, shadow);
    return fit.face;
  }

  /** Scanlines, a bezel, and whatever's gone wrong with the screen. */
  screen(flaw: ScreenFlaw, seed: number): void {
    const { w, h } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c = this.get(x, y);
        if (c < 0) c = 0x0a0a12;
        // Faint scanlines.
        if (y % 2 === 1) c = scaleColor(c, 0.88);
        // A soft vignette into the corners.
        const e = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (e < 2) c = scaleColor(c, 0.82 + e * 0.06);
        this.buf.set(x, y, c);
      }
    }
    if (flaw === 'dead-column') {
      const x = 2 + Math.floor(pixelHash(seed, 3, 77) * (w - 4));
      for (let y = 0; y < h; y++) this.buf.set(x, y, y % 5 === 0 ? 0x2a1a2a : 0x0c0a10);
    } else if (flaw === 'stuck-row') {
      const y = 2 + Math.floor(pixelHash(seed, 5, 41) * (h - 4));
      for (let x = 0; x < w; x++) this.buf.set(x, y, x % 3 === 0 ? 0xff3aff : 0x9a2aa0);
    } else if (flaw === 'dim-corner') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = (w - x) / w + (h - y) / h;
          if (d < 0.55) this.buf.set(x, y, scaleColor(this.get(x, y), 0.45 + d));
        }
      }
    }
    // A hairline bezel.
    for (let x = 0; x < w; x++) {
      this.buf.set(x, 0, 0x16161c);
      this.buf.set(x, h - 1, 0x0c0c10);
    }
    for (let y = 0; y < h; y++) {
      this.buf.set(0, y, 0x16161c);
      this.buf.set(w - 1, y, 0x0c0c10);
    }
  }
}

// --- The ads ----------------------------------------------------------------------------

const SILVER = [0x3a3c46, 0x6a6c78, 0xa8aab6, 0xe8eaf2, 0xffffff] as const;
const CHERRY = [0x4a0616, 0x8a0e2a, 0xd01c3a, 0xff4a62, 0xff9aa8] as const;

/** A drinks can at (x, y, w, h), standing or tipped (shear: px the top leans right). */
function can(p: Painter, x: number, y: number, w: number, h: number, body: readonly number[], shear = 0, label?: (u: number, v: number) => number | null): void {
  for (let j = 0; j < h; j++) {
    const v = j / Math.max(1, h - 1);
    const off = Math.round(shear * (1 - v));
    for (let i = 0; i < w; i++) {
      const u = i / Math.max(1, w - 1);
      // Cylinder lighting: a bright stripe a third of the way across, dark at the rims.
      const light = 1 - Math.abs(u - 0.32) * 1.9;
      const rim = v < 0.1 || v > 0.92;
      const ramp = rim ? SILVER : body;
      let c = p.ramp(ramp, 0.15 + light * 0.85, x + i, y + j);
      const l = !rim && label ? label(u, (v - 0.1) / 0.82) : null;
      if (l !== null && l !== undefined) c = lerpColor(l, c, 0.25 - light * 0.15);
      p.px(x + off + i, y + j, c);
    }
  }
  // The pull tab, and a bead of condensation or two.
  p.px(x + Math.round(shear) + Math.round(w * 0.55), y, 0x2a2a30);
  p.px(x + Math.round(shear * 0.5) + Math.round(w * 0.7), y + Math.round(h * 0.45), 0xffffff);
  p.px(x + Math.round(shear * 0.3) + Math.round(w * 0.2), y + Math.round(h * 0.7), 0xe8f0ff);
}

/** A starburst sparkle. */
function sparkle(p: Painter, x: number, y: number, r: number, c: number): void {
  p.px(x, y, 0xffffff);
  for (let k = 1; k <= r; k++) {
    const cc = k === r ? scaleColor(c, 0.7) : c;
    p.px(x + k, y, cc);
    p.px(x - k, y, cc);
    p.px(x, y + k, cc);
    p.px(x, y - k, cc);
  }
}

const DRAWERS: Record<AdId, (p: Painter, frame: number) => void> = {
  neurocola(p, f) {
    const { w, h } = p;
    // A deep cherry backdrop with a burst of light behind the can and slanting speed lines.
    p.vgrad(0, 0, w, h, [0x7a0c34, 0x5a0a2a, 0x3a0620, 0x200414]);
    const cw = Math.max(5, Math.round(h * 0.36));
    const ch = Math.max(8, h - 7);
    const cx = 3;
    p.ellipse(cx + cw * 0.6, h * 0.5, cw * 1.6, h * 0.55, (u, v, x, y) => (Math.hypot(u, v) < 0.6 || bayer(x, y) > Math.hypot(u, v) ? 0x9a1846 : p.get(x, y)));
    for (let k = 0; k < 5; k++) p.line(w * 0.35 + k * 9, h, w * 0.35 + k * 9 + h * 0.6, 0, (x, y) => (bayer(x, y) < 0.5 ? 0x8a1640 : p.get(x, y)));
    const tip = f === 1 ? cw * 0.5 : f === 2 ? cw * 0.9 : 0;
    // The glass, filling up.
    const big = w >= 50;
    const gw = big ? Math.max(4, Math.round(cw * 0.8)) : 0;
    const gh = Math.round(h * 0.5);
    const gx = cx + cw + 4 + Math.round(tip * 0.4);
    const gy = h - 3 - gh;
    if (big) {
      const level = [0, 0.35, 0.7, 1][f];
      const top = gy + Math.round(gh * (1 - level));
      if (f === 1 || f === 2) {
        // A dark stream of cola from the can's lip, catching a highlight.
        p.line(cx + cw + tip - 1, h - ch - 2 + 2, gx + gw / 2, top, 0x3a1006, 2);
        p.line(cx + cw + tip, h - ch, gx + gw / 2 + 1, top, 0x8a3a1a);
      }
      for (let y = gy; y < gy + gh; y++) {
        for (let x = gx; x < gx + gw; x++) {
          const side = x === gx || x === gx + gw - 1 || y === gy + gh - 1;
          if (y >= top && !side) p.px(x, y, p.ramp([0x2a0a04, 0x5a1a0a, 0x8a3412], (x - gx) / gw + (pixelHash(x, y, f) < 0.15 ? 0.4 : 0), x, y));
          else if (side) p.px(x, y, x === gx ? 0xd8f4ff : 0x8ab8c8);
        }
      }
      if (f >= 2) for (let x = gx + 1; x < gx + gw - 1; x++) p.px(x, top, 0xf0e0d0);
      if (f === 3) {
        // Fizz rising over the rim.
        for (let k = 0; k < 6; k++) p.px(gx + 1 + Math.floor(pixelHash(k, 1, 9) * (gw - 2)), gy - 1 - Math.floor(pixelHash(k, 2, 9) * 5), 0xffe0ea);
        sparkle(p, gx + gw + 1, gy + 1, 2, 0xffd0e0);
      }
    }
    can(p, cx, h - ch - 2, cw, ch, CHERRY, f === 1 || f === 2 ? tip : 0, (u, v) => {
      // A white wave across the label and a little bolt.
      const wave = Math.abs(v - 0.55 - Math.sin(u * 6) * 0.08) < 0.09;
      return wave ? 0xffffff : null;
    });
    // The name, and a line of small print that changes with the frame.
    const tx = big ? gx + gw + 4 : cx + cw + 3;
    const room = w - tx - 2;
    const faces: FontFace[] = h >= 24 ? ['bold', 'small'] : ['small'];
    const gradient = (_x: number, y: number) => (y < 6 ? 0xffffff : 0x9af0ff);
    const f1 = p.fitted(['NEURO', 'NEU'], tx, 2, room, gradient, faces) ?? 'small';
    const y2 = 3 + FONT_HEIGHT[f1];
    const f2 = p.fitted(['COLA'], tx, y2, room, (x, y) => (bayer(x, y) < 0.8 ? 0xff7a9a : 0xffffff), faces, 0x0a0610, h - y2 - 1) ?? 'small';
    const lineY = y2 + FONT_HEIGHT[f2] + 2;
    if (lineY + 5 <= h - 2) {
      const tags = f === 3 ? ['TASTE THE SIGNAL', 'THE SIGNAL', 'SIGNAL'] : f === 2 ? ['100% FOCUS', 'FOCUS'] : ['ZERO SUGAR', 'ZERO'];
      p.fitted(tags, tx, h - 7, room, f === 3 ? 0xffe680 : 0xffc0d0, ['small']);
    }
    if (big && h >= 24) {
      // A price sticker in the corner.
      p.ellipse(w - 6, 6, 4.5, 4.5, (u, v) => (Math.hypot(u, v) > 0.8 ? 0xb8900a : 0xffd020));
      p.text('¥3', w - 9, 4, 0x3a1a00, 'small', null);
    }
  },

  kaiju(p, f) {
    const { w, h } = p;
    const flash = f === 1 || f === 2;
    // Black and acid green; lightning lights the whole sky for a blink.
    p.vgrad(0, 0, w, h, flash ? [0x4a6a20, 0x2a3a14, 0x101808] : [0x16200a, 0x0c1206, 0x060804]);
    const ax = Math.round(w * 0.04);
    const s = h / 28;
    // The kaiju: a hulking silhouette rearing up over a skyline, roaring.
    const sk = (pts: Array<[number, number]>) => pts.map(([x, y]) => [ax + x * s, y * s] as [number, number]);
    // Little skyline at its feet.
    for (let k = 0; k < 9; k++) {
      const bw = 2 + Math.floor(pixelHash(k, 1, 5) * 3);
      const bh = 3 + Math.floor(pixelHash(k, 2, 5) * 6);
      p.rect(ax + k * 3.4 * s, h - bh * s, bw * s, bh * s, flash ? 0x1a2a0a : 0x0a1004);
      if (!flash) p.px(ax + k * 3.4 * s + 1, h - bh * s + 2, 0xffd060);
    }
    const body = flash ? 0x060804 : 0x1e2a10;
    p.polygon(
      sk([
        [4, 28],
        [6, 18],
        [9, 13],
        [13, 10],
        [15, 6],
        [18, 4],
        [22, 5],
        [24, 8],
        [21, 9],
        [19, 11],
        [20, 14],
        [18, 15],
        [17, 19],
        [19, 22],
        [26, 24],
        [28, 28],
      ]),
      body,
    );
    // Dorsal spines, and an eye that burns red when it roars.
    for (const [x, y] of [
      [8, 15],
      [10, 12],
      [12, 9.5],
      [14, 7],
    ] as const)
      p.polygon(sk([[x - 1, y + 1], [x - 2.5, y - 2], [x + 1, y]]), flash ? 0xc8ff40 : 0x4a6a1a);
    p.px(ax + 20 * s, 6 * s, f === 3 ? 0xff3a1a : 0xffd040);
    if (f === 3) {
      // Its breath: a roaring beam out of the jaws.
      for (let k = 0; k < 8 * s; k++) p.line(ax + 24 * s + k, 8 * s - k * 0.4, ax + 24 * s + k, 8 * s + k * 0.2, k % 3 === 0 ? 0xeaff9a : 0x9aff3a);
    }
    if (flash) {
      // The lightning bolt.
      const bx = Math.round(w * 0.32);
      p.line(bx, 0, bx - 3, h * 0.35, 0xffffff, 1);
      p.line(bx - 3, h * 0.35, bx + 2, h * 0.4, 0xffffff, 1);
      p.line(bx + 2, h * 0.4, bx - 2, h * 0.75, 0xeaffff, 1);
    }
    // The can, black with claw marks.
    const cw = Math.max(5, Math.round(h * 0.32));
    const ch = Math.round(h * 0.78);
    const cx = w - cw - 3;
    can(p, cx, h - ch - 2, cw, ch, [0x0a0c08, 0x1a2010, 0x2a3418, 0x4a5a2a, 0x7a8a4a], 0, (u, v) => (Math.abs(u * 1.4 - v * 0.6 - 0.3) < 0.08 || Math.abs(u * 1.4 - v * 0.6 - 0.05) < 0.08 ? 0x9aff3a : null));
    // The name, in acid green with a black outline.
    const tx = Math.round(w * 0.4);
    const room = cx - tx - 2;
    const name = p.fit(['KAIJU'], room, h >= 24 ? ['bold', 'small'] : ['small']);
    const lime = (x: number, y: number) => (bayer(x, y) < 0.25 && y > 6 ? 0x5ad81a : 0xb8ff3a);
    const face = name?.face ?? 'small';
    if (name) {
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ])
        p.text(name.text, tx + dx, 3 + dy, 0x000000, face, null);
      p.text(name.text, tx, 3, lime, face, null);
    }
    const zy = 5 + FONT_HEIGHT[face];
    if (zy + 5 <= h - 1) p.fitted(['ZERO'], tx, zy, room, 0xffffff, ['small']);
    if (h >= 22) p.fitted(['+300% AWAKE', '+300%'], tx, h - 7, room, f === 3 ? 0xffff60 : 0xc8ff80, ['small']);
  },

  dreamdive(p, f) {
    const { w, h } = p;
    // A deep violet night with stars, a sea of light far below.
    p.vgrad(0, 0, w, h, [0x0a0626, 0x1a0e46, 0x2e1a6a, 0x4a2a8a, 0x7a4aaa]);
    for (let k = 0; k < (w * h) / 24; k++) {
      const x = Math.floor(pixelHash(k, 1, 31) * w);
      const y = Math.floor(pixelHash(k, 2, 31) * h);
      const tw = pixelHash(k, f, 32) < 0.3;
      p.px(x, y, tw ? 0xffffff : 0xa89aff);
    }
    const artW = Math.round(w * 0.42);
    // The diver, head first, arms out in a swan dive, with a trail of light.
    const dx = Math.round(artW * 0.5);
    const dy = Math.round((h * (0.15 + f * 0.2)) % h);
    for (let k = 1; k < 8; k++) p.px(dx - k * 0.3, dy - k, k < 4 ? 0xe0d8ff : 0x8a7aff);
    p.ellipse(dx, dy + 3, 1.6, 3, 0xd8d0ff);
    p.line(dx - 4, dy + 1, dx + 4, dy + 1, 0xd8d0ff);
    p.px(dx, dy + 6, 0xffffff);
    // The visor, glowing.
    p.px(dx - 1, dy + 5, 0x4affff);
    p.px(dx + 1, dy + 5, 0x4affff);
    if (f === 3) {
      // Ripples where it meets the dream.
      p.ring(dx, h - 3, artW * 0.4, 1.5, 1, 0xc8b8ff);
      p.ring(dx, h - 3, artW * 0.25, 1, 1, 0xffffff);
    }
    const tx = artW + 2;
    const room = w - tx - 2;
    const grad = (_x: number, y: number) => lerpColor(0xffffff, 0xc89aff, Math.min(1, (y - 3) / 7));
    const faces: FontFace[] = h >= 22 ? ['bold', 'small'] : ['small'];
    const one = h < 22 ? p.fit(['DREAMDIVE'], room, ['small']) : null;
    let y = 2;
    if (one) {
      p.text(one.text, tx, y, grad, 'small');
      y += 7;
    } else {
      const f1 = p.fitted(['DREAM'], tx, y, room, grad, faces) ?? 'small';
      y += FONT_HEIGHT[f1] + 1;
      const f2 = p.fitted(['DIVE'], tx, y, room, grad, faces) ?? 'small';
      y += FONT_HEIGHT[f2] + 2;
    }
    if (y + 5 <= h - 1) p.fitted(f === 3 ? ['LIVE A BETTER LIFE', 'BETTER LIFE', 'LIVE'] : ['12¥/HR', '12¥'], tx, y, room, f === 3 ? 0xffe8a0 : 0x8af0ff, ['small']);
  },

  askkai(p, f) {
    const { w, h } = p;
    // Soft teal into indigo: calm, kind, and always on.
    p.vgrad(0, 0, w, h, [0x1a6a8a, 0x165478, 0x163e66, 0x1a2a54, 0x1a1a40]);
    // Drifting motes of light.
    for (let k = 0; k < (w * h) / 60; k++) {
      const x = Math.floor(pixelHash(k, 1, 51) * w);
      const y = Math.floor((pixelHash(k, 2, 51) * h + f * 3) % h);
      p.px(x, y, k % 3 === 0 ? 0xbafcff : 0x4ab8d8);
    }
    const tall = h > w * 1.1;
    const faceR = tall ? Math.min(w * 0.3, h * 0.2) : h * 0.4;
    const fx = tall ? w / 2 : faceR + 3;
    const fy = tall ? faceR + 6 : h / 2;
    // A face drawn in light: a soft aura, a halo ring with circuit ticks, two eyes and a smile.
    p.ellipse(fx, fy, faceR * 1.35, faceR * 1.35, (u, v, x, y) => (bayer(x, y) < 0.45 - Math.hypot(u, v) * 0.32 ? 0x2a8aaa : p.get(x, y)));
    p.ellipse(fx, fy, faceR - 1, faceR - 1, (u, v, x, y) => p.ramp([0x102a42, 0x163e5a, 0x1e5878, 0x2a7090], 0.65 - v * 0.45 - u * 0.15, x, y));
    p.ring(fx, fy, faceR, faceR, Math.max(1, faceR * 0.1), 0x8af8ff);
    if (faceR >= 12) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + f * 0.2;
        const r0 = faceR + 2;
        const r1 = faceR + (k % 3 === 0 ? 5 : 3);
        p.line(fx + Math.cos(a) * r0, fy + Math.sin(a) * r0, fx + Math.cos(a) * r1, fy + Math.sin(a) * r1, k % 3 === 0 ? 0xd8ffff : 0x5ad8f0);
      }
    }
    const blink = f === 1;
    const look = f === 2 ? -faceR * 0.16 : f === 3 ? faceR * 0.12 : 0;
    const ey = fy - faceR * 0.12;
    const er = Math.max(1, faceR * 0.15);
    for (const side of [-1, 1]) {
      const ex = fx + side * faceR * 0.38 + look;
      if (blink) p.line(ex - er, ey, ex + er, ey, 0xd8ffff);
      else {
        p.ellipse(ex, ey, er, er * 1.5, 0xd8ffff);
        if (er >= 2) p.ellipse(ex, ey + er * 0.2, er * 0.55, er * 0.8, 0x2ab8e0);
        p.px(ex - er * 0.35, ey - er * 0.6, 0xffffff);
      }
      // A warm blush.
      if (faceR >= 10) p.px(fx + side * faceR * 0.6, fy + faceR * 0.22, 0xff8aba);
    }
    for (let x = -faceR * 0.38; x <= faceR * 0.38; x += 0.5) p.px(fx + x + look * 0.5, fy + faceR * 0.34 + (1 - (x / (faceR * 0.38)) ** 2) * faceR * 0.14, 0x8af8ff);
    // What it says, in a speech bubble.
    const lines = [['HI.'], ['HI.'], ["I'M", 'LISTENING'], ['ALWAYS.'], ['ASK ME', 'ANYTHING']][f];
    const bx = tall ? 3 : Math.round(fx + faceR * 1.25 + 2);
    const bw = tall ? w - 6 : w - bx - 2;
    const faces: FontFace[] = tall ? ['bold', 'small'] : ['small'];
    const fits = lines.map((t) => p.fit([t], bw - 4, faces)).filter((x): x is { text: string; face: FontFace } => x !== null);
    const bh = fits.reduce((a, l) => a + FONT_HEIGHT[l.face] + 2, 3);
    const by = tall ? Math.round(fy + faceR * 1.4 + 3) : 2;
    if (bw > 10 && fits.length) {
      p.rect(bx + 1, by, bw - 2, bh, 0xeafcff);
      p.rect(bx, by + 1, bw, bh - 2, 0xeafcff);
      const tailX = tall ? bx + bw * 0.4 : bx;
      p.polygon(
        tall
          ? [
              [tailX, by + 1],
              [tailX + 4, by + 1],
              [tailX - 2, by - 4],
            ]
          : [
              [bx + 1, by + bh - 4],
              [bx + 1, by + bh - 1],
              [bx - 3, by + bh + 1],
            ],
        0xeafcff,
      );
      let ly = by + 2;
      for (const l of fits) {
        p.ctext(l.text, bx + bw / 2, ly, 0x163e66, l.face, null);
        ly += FONT_HEIGHT[l.face] + 2;
      }
    }
    // The brand, and the small print.
    const brand = p.fit(['ASK KAI', 'KAI'], tall ? w - 4 : bw, tall ? ['bold', 'small'] : ['small']);
    if (brand) {
      const brandY = tall ? Math.min(h - FONT_HEIGHT[brand.face] - 9, by + bh + 3) : h - FONT_HEIGHT[brand.face] - 2;
      if (tall || brandY > by + bh + 1) p.ctext(brand.text, tall ? w / 2 : bx + bw / 2, brandY, (x, y) => (bayer(x, y) < 0.3 && y > brandY + 3 ? 0x8af8ff : 0xffffff), brand.face);
    }
    if (tall && h > 60) p.ctext('*TERMS APPLY', w / 2, h - 7, 0x6aa0b8, 'small', null);
  },

  soulsync(p, f) {
    const { w, h } = p;
    // A warm rose dusk: two figures holding hands under a heart, one of them made of light.
    p.vgrad(0, 0, w, h, [0x3a0a3a, 0x5a1450, 0x8a2a6a, 0xc84a7a, 0xf08a8a]);
    const s = h / 26;
    const cx = Math.round(Math.min(w * 0.24, h * 0.6));
    const base = h - 2;
    const figure = (x: number, color: Fill) => {
      p.ellipse(x, base - 15 * s, 2 * s, 2 * s, typeof color === 'number' ? color : (_u, _v, px, py) => color(px, py));
      p.rect(x - 1.6 * s, base - 13 * s, 3.2 * s, 7 * s, color);
      p.rect(x - 1.4 * s, base - 6 * s, 1.2 * s, 6 * s, color);
      p.rect(x + 0.4 * s, base - 6 * s, 1.2 * s, 6 * s, color);
    };
    figure(cx - 4 * s, 0x1a0618);
    figure(cx + 4 * s, (x, y) => (bayer(x, y) < 0.5 ? 0xffb8f0 : 0xff7ad8));
    p.line(cx - 2 * s, base - 9 * s, cx + 2.4 * s, base - 9 * s, 0xffb8f0);
    const beat = f === 1 ? 1.25 : 1;
    const hy = base - 21 * s;
    const hr = 2 * s * beat;
    p.ellipse(cx - hr * 0.8, hy, hr, hr, 0xff3a7a);
    p.ellipse(cx + hr * 0.8, hy, hr, hr, 0xff3a7a);
    p.polygon(
      [
        [cx - hr * 1.8, hy + hr * 0.3],
        [cx + hr * 1.8, hy + hr * 0.3],
        [cx, hy + hr * 2.4],
      ],
      0xff3a7a,
    );
    p.px(cx - hr * 0.9, hy - hr * 0.4, 0xffd0e0);
    const tx = Math.round(cx + 9 * s);
    const room = w - tx - 2;
    const nf = p.fitted(['SOULSYNC', 'SOUL'], tx, 2, room, 0xffffff, h >= 24 ? ['bold', 'small'] : ['small']) ?? 'small';
    const y = 4 + FONT_HEIGHT[nf];
    if (y + 5 <= h - 1) p.fitted(f === 2 ? ['NEVER ALONE', 'NEVER'] : ['NOW 2 FOR 1', '2 FOR 1', '2X1'], tx, y, room, f === 2 ? 0xffe0f0 : 0xffd060, ['small']);
    // A line of made-up glyphs, as the tagline in the local script.
    if (h >= 22) for (let k = 0; k < Math.floor(room / 7); k++) drawGlyph(p.buf, 3 + k * 5, tx + k * 7, h - 7, 0xffc0e8);
  },

  nanocare(p, f) {
    const { w, h } = p;
    // Clinical mint and white, a red cross wired up like a circuit board.
    p.vgrad(0, 0, w, h, [0xf4fffa, 0xd8f4ea, 0xb0e0d0]);
    const cs = Math.round(Math.min(h * 0.7, w * 0.3));
    const cx = 2 + cs / 2;
    const cy = h / 2;
    const arm = Math.max(2, Math.round(cs / 3));
    p.rect(cx - arm / 2, cy - cs / 2, arm, cs, 0xe02a3a);
    p.rect(cx - cs / 2, cy - arm / 2, cs, arm, 0xe02a3a);
    p.rect(cx - arm / 2, cy - cs / 2, 1, cs, 0xff6a72);
    const traces = w >= 44;
    if (traces) {
      // Circuit traces running off the cross, with a pulse travelling along them.
      for (let k = 0; k < 3; k++) {
        const y = Math.round(cy - cs / 3 + k * (cs / 3));
        p.line(cx + cs / 2, y, cx + cs / 2 + 5 + k * 2, y, 0x3a8a7a);
        if ((f + k) % 3 === 0) p.px(cx + cs / 2 + 2 + k, y, 0xffffff);
      }
    }
    const tx = Math.round(cx + cs / 2 + (traces ? 12 : 3));
    const room = w - tx - 1;
    const nf = p.fitted(['NANOCARE', 'NANO'], tx, 2, room, 0x1a5a4a, h >= 22 ? ['bold', 'small'] : ['small'], null) ?? 'small';
    const y = 4 + FONT_HEIGHT[nf];
    if (y + 5 <= h - 1) p.fitted(['WE FIX YOU.', 'FIX YOU.', 'FIX U'], tx, y, room, 0x2a3a3a, ['small'], null);
    // The small print, which flickers in (and out again).
    if (f === 1) {
      if (y + 11 <= h) p.fitted(['MOSTLY.', 'MOST.'], tx, y + 6, room, 0xe02a3a, ['small'], null);
      else p.fitted(['MOSTLY', 'MOST'], tx, 2, room, 0xe02a3a, ['small'], 0xf4fffa);
    }
  },

  ramen(p, f) {
    const { w, h } = p;
    // A warm lantern glow, a steaming bowl, and the shop's name in glyphs.
    p.vgrad(0, 0, w, h, [0xffb040, 0xf08a2a, 0xc85a1a, 0x8a3412]);
    const tall = h > w;
    const bw = Math.round(tall ? w * 0.8 : Math.min(w * 0.42, h * 1.3));
    const bx = tall ? w / 2 : 2 + bw / 2;
    const by = Math.round(tall ? h * 0.72 : h * 0.6);
    // Steam, curling up.
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < bw * 0.5; j++) {
        const x = bx - bw * 0.25 + k * bw * 0.25 + Math.sin(j * 0.6 + f * 2 + k) * 1.5;
        if (bayer(Math.round(x), j) < 0.55 - j / (bw * 1.2)) p.px(x, by - bw * 0.15 - j, 0xfff0d8);
      }
    }
    // Noodles, an egg, a dark glazed bowl with a red rim, and chopsticks across it.
    p.ellipse(bx, by, bw / 2, Math.max(1, bw * 0.12), 0xf8e8b0);
    for (let k = 0; k < 4; k++) p.line(bx - bw * 0.38, by - 1 + (k % 2), bx + bw * 0.38, by + (k % 2), (x, y) => (pixelHash(x, y, k) < 0.5 ? 0xffe890 : 0xe8c860));
    if (bw >= 12) {
      p.ellipse(bx + bw * 0.16, by - 1, Math.max(1, bw * 0.08), Math.max(1, bw * 0.06), 0xffffff);
      p.px(bx + bw * 0.16, by - 1, 0xffb020);
    }
    for (let y = 0; y < bw * 0.38; y++) {
      const half = (bw / 2) * Math.sqrt(1 - (y / (bw * 0.38)) ** 2);
      for (let x = -half; x < half; x++) p.px(bx + x, by + 1 + y, p.ramp([0x1a0a06, 0x3a1a10, 0x5a2a1a], 0.6 - x / bw, Math.round(bx + x), Math.round(by + y)));
    }
    p.line(bx - bw / 2, by + 1, bx + bw / 2, by + 1, 0xd02a1a);
    p.line(bx - bw * 0.1, by - bw * 0.35, bx + bw * 0.55, by + 1, 0x5a2a10);
    p.line(bx, by - bw * 0.38, bx + bw * 0.6, by - 1, 0x7a3a18);
    const white = (x: number, y: number) => (bayer(x, y) < 0.2 ? 0xffd0a0 : 0xffffff);
    if (tall) {
      // A hanging sign: glyphs down the top, the hours at the foot.
      const n = Math.max(1, Math.min(3, Math.floor((by - bw * 0.6) / 7)));
      for (let k = 0; k < n; k++) drawGlyph(p.buf, 9 + k * 3, w / 2 - 2, 2 + k * 7, white);
      p.ctext(f === 2 ? 'OPEN' : '24H', w / 2, h - 7, f === 2 ? 0xffffff : 0xffe0a0, 'small', 0x5a1a08);
      return;
    }
    const tx = Math.round(bx + bw / 2 + 3);
    const room = w - tx - 1;
    const n = Math.max(0, Math.min(3, Math.floor((room + 2) / 7)));
    for (let k = 0; k < n; k++) drawGlyph(p.buf, 9 + k * 3, tx + k * 7, 2, white);
    if (h >= 16) p.fitted(f === 2 ? ['OPEN 24H', 'OPEN'] : ['RAMEN', 'NOODLE', 'MEN'], tx, 9, room, f === 2 ? 0xffffff : 0x3a0a04, h >= 24 ? ['bold', 'small'] : ['small'], f === 2 ? 0x5a1a08 : null);
  },

  curfew(p, f) {
    const { w, h } = p;
    // An amber city ticker, scrolling right to left.
    p.rect(0, 0, w, h, 0x120a04);
    const msg = '  CITY NOTICE · CURFEW 02:00 · STAY SAFE · SOULSYNC: NEVER ALONE · NEUROCOLA ¥3 · ';
    const tw = textWidth(msg, 'small');
    const off = Math.floor((f / 96) * tw);
    const y = Math.round((h - 5) / 2);
    for (const k of [0, 1]) drawText(p.buf, msg, -off + k * (tw + 1), y, (_x, yy) => (yy === y ? 0xffe0a0 : 0xffb040), 'small');
    // The ticker's LED grid.
    for (let yy = 0; yy < h; yy++) for (let x = 0; x < w; x++) if ((x + yy) % 2 === 1 && p.get(x, yy) === 0x120a04) p.px(x, yy, 0x1c1006);
  },
};
