import { channels, lerpColor, pack, scaleColor } from '../core/color';
import { PixelGrid, pixelHash } from './raster';
import { clamp01 } from '../core/math';

/**
 * A small kit for drawing creatures and people as proper pixel art rather
 * than flat blobs: hue-shifted colour ramps, forms lit from the upper left
 * (rounded bodies, tapered limbs), selective outlines that take the colour
 * of what they border, and eyes with a glint. Everything stays an indexed
 * `PixelGrid`, drawn at the size it's shown.
 */

/** A material's five shades: deep shadow, shadow, base, light, highlight (as palette indices). */
export type Ramp = readonly [number, number, number, number, number];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 4×4 ordered-dither threshold for a pixel, in (0, 1). */
export function bayer4(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

function toHsl(color: number): [number, number, number] {
  const [r8, g8, b8] = channels(color);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return pack((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Turn a hue towards a target hue by up to `amount` degrees. */
function shiftHue(h: number, target: number, amount: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

/**
 * Five shades of one colour, as a painter would mix them: the shadows go
 * darker and cooler (towards blue-violet), the lights go paler and warmer
 * (towards yellow), so forms read as lit rather than just darkened.
 * `contrast` widens or narrows the steps; `hueShift` scales how far the hues turn (less for a coat whose shadows
 * shouldn't swing towards red).
 */
export function rampColors(base: number, contrast = 1, hueShift = 1): [number, number, number, number, number] {
  const [h, s, l] = toHsl(base);
  // Greys get a faint cool cast in shadow too.
  const hs = s < 0.06 ? 0 : hueShift;
  const step = (k: number): number => {
    const dl = k * 0.13 * contrast;
    const nl = k < 0 ? l * (1 + dl * 1.6) : l + (1 - l) * dl * 1.2;
    const hue = k < 0 ? shiftHue(h, 245, -k * 14 * hs) : shiftHue(h, 55, k * 10 * hs);
    const ns = k < 0 ? s * (1 + 0.08 * -k) + (hs ? 0 : 0.06 * -k) : s * (1 - 0.12 * k);
    return fromHsl(s < 0.06 && k < 0 ? 230 : hue, ns, nl);
  };
  return [step(-2), step(-1), base, step(1), step(2)];
}

/** An indexed palette built from ramps and single colours. It remembers each index's outline colour. */
export class Palette {
  readonly colors: number[] = [0];
  private readonly outlines: number[] = [0];

  /** A single colour; its outline is `outline` (an index) or itself. */
  add(color: number, outline?: number): number {
    this.colors.push(color);
    const index = this.colors.length - 1;
    this.outlines.push(outline ?? index);
    return index;
  }

  /** Five shades of a colour (see `rampColors`); every shade outlines with a darker, inkier tone of the material. */
  ramp(base: number, contrast = 1, hueShift = 1): Ramp {
    const c = rampColors(base, contrast, hueShift);
    const ink = this.add(lerpColor(scaleColor(c[0], 0.55), 0x1a1420, 0.35));
    return [this.add(c[0], ink), this.add(c[1], ink), this.add(c[2], ink), this.add(c[3], ink), this.add(c[4], ink)];
  }

  /** A ramp whose outline is a separate, darker ink. */
  inkedRamp(base: number, ink: number, contrast = 1): Ramp {
    const inkIndex = this.add(ink);
    const c = rampColors(base, contrast);
    return [this.add(c[0], inkIndex), this.add(c[1], inkIndex), this.add(c[2], inkIndex), this.add(c[3], inkIndex), this.add(c[4], inkIndex)];
  }

  outlineOf(index: number): number {
    return this.outlines[index] ?? index;
  }
}

/** The light comes from the upper left, a little in front. */
const LIGHT: readonly [number, number, number] = (() => {
  const v = [-0.5, -0.7, 0.5];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n] as const;
})();

/**
 * Which shade (0 deep shadow … 4 highlight) a surface with normal (nx, ny, nz)
 * takes, dithered between neighbouring shades when `dither` is on.
 * `bias` brightens (+) or darkens (−) by a fraction of a step.
 */
export function shadeStep(nx: number, ny: number, nz: number, x: number, y: number, dither = true, bias = 0): number {
  const lambert = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  // Facing us is the base shade; turned to the light it brightens, turned away it darkens.
  const v = Math.max(0, Math.min(4, 2 + (lambert - 0.5) * 3 + bias));
  if (!dither) return Math.max(0, Math.min(4, Math.round(v)));
  const lo = Math.floor(v);
  return Math.min(4, lo + (v - lo > bayer4(x, y) ? 1 : 0));
}

export interface ShadeOptions {
  /** Rotation of the ellipse (radians). */
  angle?: number;
  /** Dither between shades (on for bigger sprites). */
  dither?: boolean;
  /** Flatten the form (0 round … 1 flat-lit). */
  flat?: number;
  /** Brighten (+) or darken (−) by a fraction of a step. */
  bias?: number;
  /** Highest shade allowed (e.g. 3 to keep the highlight for a glint). */
  max?: number;
  /** Lowest shade allowed (e.g. 1 so a pale coat's underside doesn't go murky). */
  min?: number;
}

/** A filled ellipse shaded as a rounded body, lit from the upper left. */
export function shadedEllipse(g: PixelGrid, cx: number, cy: number, rx: number, ry: number, ramp: Ramp, opts: ShadeOptions = {}): void {
  const { angle = 0, dither = true, flat = 0, bias = 0, max = 4, min = 0 } = opts;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  g.ellipse(cx, cy, rx, ry, (u, v, x, y) => {
    // Normal of the ellipsoid in the rotated frame, back to screen.
    const nz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
    const su = u * (1 - flat);
    const sv = v * (1 - flat);
    const nx = su * cos - sv * sin;
    const ny = su * sin + sv * cos;
    const len = Math.hypot(nx, ny, nz + flat) || 1;
    return ramp[Math.max(min, Math.min(max, shadeStep(nx / len, ny / len, (nz + flat) / len, x, y, dither, bias)))];
  }, angle);
}

/**
 * A tapered limb, tail or neck along a polyline: `w0` px wide at the start,
 * `w1` at the end, rounded like a cylinder (lit side and shadow side).
 */
export function limb(g: PixelGrid, points: ReadonlyArray<readonly [number, number]>, w0: number, w1: number, ramp: Ramp, opts: { dither?: boolean; bias?: number; max?: number } = {}): void {
  const { dither = false, bias = 0, max = 4 } = opts;
  if (points.length < 2) return;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = lengths[lengths.length - 1] || 1;
  const pad = Math.max(w0, w1) / 2 + 1;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys) - pad); y <= Math.ceil(Math.max(...ys) + pad); y++) {
    for (let x = Math.floor(Math.min(...xs) - pad); x <= Math.ceil(Math.max(...xs) + pad); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Nearest point on the polyline.
      let best = Infinity;
      let bestT = 0;
      let bestSide = 0;
      let bestPerp: [number, number] = [0, 1];
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        const t = clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
        const qx = ax + dx * t;
        const qy = ay + dy * t;
        const d = Math.hypot(px - qx, py - qy);
        if (d < best) {
          best = d;
          bestT = (lengths[i - 1] + Math.sqrt(len2) * t) / total;
          const len = Math.sqrt(len2);
          bestPerp = [-dy / len, dx / len];
          bestSide = (px - qx) * bestPerp[0] + (py - qy) * bestPerp[1];
        }
      }
      const r = (w0 + (w1 - w0) * bestT) / 2;
      if (best > r) continue;
      const s = Math.max(-1, Math.min(1, bestSide / Math.max(0.5, r)));
      const nz = Math.sqrt(1 - s * s);
      g.set(x, y, ramp[Math.min(max, shadeStep(bestPerp[0] * s, bestPerp[1] * s, nz, x, y, dither, bias))]);
    }
  }
}

/**
 * Selective outline: each empty pixel touching the sprite takes the outline
 * colour of the material it borders (its deepest shade), so the edge stays
 * coloured and soft instead of a hard black line. `bottomHeavy` leaves the
 * top edge unoutlined where the light falls on it.
 */
export function selOut(g: PixelGrid, palette: Palette, opts: { bottomHeavy?: boolean } = {}): void {
  const add: Array<[number, number]> = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (g.get(x, y) !== 0) continue;
      // Prefer the pixel below (an outline sits under a form), then the sides, then above.
      const below = g.get(x, y + 1);
      const side = g.get(x - 1, y) || g.get(x + 1, y);
      const above = g.get(x, y - 1);
      const n = below || side || (opts.bottomHeavy ? 0 : above);
      if (n) add.push([y * g.width + x, palette.outlineOf(n)]);
    }
  }
  for (const [i, c] of add) g.data[i] = c;
}

/**
 * Darken the inside edge of a form where it meets the background below or to
 * the right (away from the light): a rim of shadow that rounds the shape.
 */
export function rimShade(g: PixelGrid, ramps: readonly Ramp[]): void {
  const lookup = new Map<number, number>();
  for (const r of ramps) for (let k = 1; k < 5; k++) lookup.set(r[k], r[Math.max(0, k - 1)]);
  const set: Array<[number, number]> = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const c = g.get(x, y);
      const darker = lookup.get(c);
      if (darker === undefined) continue;
      if (g.get(x, y + 1) === 0 || g.get(x + 1, y) === 0) set.push([y * g.width + x, darker]);
    }
  }
  for (const [i, c] of set) g.data[i] = c;
}

/** An eye: dark, with a glint up and towards the light when it's big enough. */
export function eye(g: PixelGrid, x: number, y: number, size: number, dark: number, glint: number): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (size >= 3) {
    g.rect(xi - 1, yi - 1, 2, 2, dark);
    g.set(xi - 1, yi - 1, glint);
  } else if (size >= 2) {
    g.rect(xi, yi, 1, 2, dark);
    g.set(xi, yi, glint);
  } else {
    g.set(xi, yi, dark);
  }
}

/** Round a size to an even number of pixels (keeps sprite caches small). */
export function evenSize(size: number, min = 2): number {
  return Math.max(min, Math.round(size / 2) * 2);
}

/** A drawn sprite: its pixels and the colours they index. */
export interface Drawn {
  grid: PixelGrid;
  palette: Palette;
}

/** Smooth value noise in about 0..1, for organic markings (patches, spots, dapples) that scale with the sprite. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = pixelHash(x0, y0, seed);
  const b = pixelHash(x0 + 1, y0, seed);
  const c = pixelHash(x0, y0 + 1, seed);
  const d = pixelHash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
