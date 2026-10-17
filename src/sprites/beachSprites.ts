import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { evenSize, limb, Palette, selOut, shadedEllipse, type Drawn } from './kit';
import { PixelGrid } from './raster';

type Pt = readonly [number, number];

// --- Sea turtle ---------------------------------------------------------

/**
 * A sea turtle hauling itself up the sand, seen from the side (`width` ×
 * `width/2`), facing right: a domed shell of scutes with a rim of marginal
 * plates, a pale plastron, a scaly head with an eye and beak, and jointed
 * front flippers that sweep forward and back as it crawls (three frames).
 */
export function drawTurtleSized(frame: 0 | 1 | 2, width: number): Drawn {
  const W = Math.max(6, Math.round(width));
  const H = Math.max(3, Math.round(W / 2));
  const g = new PixelGrid(W, H);
  const s = W / 40;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const shell = palette.ramp(0x6e5a36);
  const skin = palette.ramp(0x7a7a5a);
  const belly = palette.ramp(0xd8c890, 0.6);
  const seam = palette.add(0x2e2418);
  const eyeInk = palette.add(0x0c0c0c);
  const full = W >= 24;
  // Flippers: the far ones in shadow behind the body, then the near ones in front.
  const front: Pt[][] = [
    [P(28, 13), P(33, 16), P(38, 18.5)],
    [P(28, 13), P(30, 17), P(29, 19.5)],
    [P(28, 13), P(25, 17), P(21, 19)],
  ];
  const rear: Pt[][] = [
    [P(9, 14), P(5, 17), P(2, 18.5)],
    [P(9, 14), P(8, 17.5), P(9, 19.5)],
    [P(9, 14), P(11, 17.5), P(14, 19)],
  ];
  const fw = Math.max(1, 3.2 * s);
  limb(g, front[(frame + 1) % 3].map(([x, y]) => [x - 2 * s, y] as Pt), fw, fw * 0.8, skin, { bias: -1.2 });
  limb(g, rear[(frame + 2) % 3].map(([x, y]) => [x + 2 * s, y] as Pt), fw * 0.8, fw * 0.6, skin, { bias: -1.2 });
  // Plastron, a pale band under the shell.
  shadedEllipse(g, 19 * s, 14.5 * s, 14 * s, 2.4 * s, belly, { dither: false, min: 2, max: 3 });
  // The shell: a low, streamlined dome. Seams fan out from low in its middle and
  // ring round it, dividing the central and side scutes; each plate is lit at its heart.
  const cx = 19 * s;
  const cy = 13.5 * s;
  const rx = 15.5 * s;
  const ry = 8 * s;
  const fanY = cy + ry * 0.4;
  g.ellipse(cx, cy, rx, ry, (u, v, x, y) => {
    if (v > 0.12) return 0;
    // Marginal plates round the lower rim.
    if (v > -0.18) return full && x % Math.max(2, Math.round(3 * s)) === 0 ? seam : shell[1];
    const lit = u * -0.45 + v * -0.75;
    const base = shell[lit > 0.65 ? 4 : lit > 0.3 ? 3 : lit > -0.05 ? 2 : 1];
    if (!full) return base;
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - fanY) / ry;
    const angle = Math.atan2(dy, dx);
    const radius = Math.hypot(dx, dy * 1.1);
    // Five seams fanning out, and a ring between the spine plates and the side ones.
    const k = (angle + Math.PI) / (Math.PI / 6);
    const nearSeam = Math.abs(k - Math.round(k)) * (Math.PI / 6) * radius * rx < 0.75;
    const ring = Math.abs(radius - 0.72) * ry < 0.6;
    if ((nearSeam && radius > 0.25) || ring) return seam;
    // Plates are a shade lighter at their centres.
    return Math.abs(k - Math.round(k) - 0.5) < 0.18 && Math.abs(radius - (radius > 0.72 ? 0.86 : 0.5)) < 0.1 ? shell[Math.min(4, shell.indexOf(base) + 1)] : base;
  });
  // Head on its neck, poking forward.
  limb(g, [P(32, 12), P(35.5, 11)], 4.5 * s, 4 * s, skin);
  shadedEllipse(g, 36.5 * s, 10.8 * s, 3.4 * s, 2.7 * s, skin, { dither: false });
  if (full) {
    // Scales on the head, an eye and the hooked beak.
    g.set(Math.floor(35 * s), Math.floor(9.6 * s), skin[4]);
    g.set(Math.floor(36.2 * s), Math.floor(9.4 * s), skin[4]);
    g.set(Math.floor(37.4 * s), Math.floor(10 * s), eyeInk);
    g.set(Math.floor(39.4 * s), Math.floor(11.6 * s), skin[0]);
  } else if (W >= 12) g.set(Math.floor(37.4 * s), Math.floor(10 * s), eyeInk);
  // Near flippers.
  limb(g, front[frame], fw, fw * 0.8, skin, { bias: 0.2 });
  limb(g, rear[(frame + 1) % 3], fw * 0.8, fw * 0.6, skin);
  if (W >= 14) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

export class TurtleSprites {
  private readonly cache = new Map<string, Texture>();

  /** A crawl frame at a width (rounded to even sizes so the cache stays small). */
  frame(i: number, width = 20): Texture {
    const f = (((i % 3) + 3) % 3) as 0 | 1 | 2;
    const w = evenSize(width, 6);
    const key = `${f}:${w}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawTurtleSized(f, w);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
  }
}

// --- Dolphins -----------------------------------------------------------

/** Frames of a breach: the fin, rising, arcing out, the top of the arc, diving, the splash. */
export const DOLPHIN_FRAMES = 6;
export const DOLPHIN_LENGTH = 16;

/**
 * A dolphin breaching far out (`length` px nose to fluke), in frame `f` of
 * its leap, facing right. The sprite's bottom row is the waterline: only what
 * is above the water is drawn, with spray where it breaks the surface.
 */
export function drawDolphinSized(f: number, length = DOLPHIN_LENGTH): Drawn {
  const L = Math.max(8, Math.round(length));
  const W = L + 4;
  const H = Math.round(L * 0.62);
  const g = new PixelGrid(W, H);
  const s = L / 16;
  const palette = new Palette();
  const back = palette.ramp(0x4e5e70);
  const pale = palette.ramp(0xc8d4dc, 0.6);
  const spray = palette.add(0xeef4f8);
  const foam = palette.add(0xb8ccd8);
  const water = H - 0.5;
  // Each frame: the body's spine as a curve (tail to nose), how high it is out of the water.
  const arcs: Pt[][] = [
    [[3, 12], [8, 9.6], [13, 12]],
    [[2, 13], [7, 9], [12, 5], [15, 2.5]],
    [[2, 9], [7, 4], [12, 3], [16, 5]],
    [[2, 6], [6, 3], [11, 3.5], [15, 7]],
    [[3, 3], [7, 4.5], [11, 8], [13, 12.5]],
    [],
  ];
  const k = ((f % DOLPHIN_FRAMES) + DOLPHIN_FRAMES) % DOLPHIN_FRAMES;
  const spine = arcs[k].map(([x, y]) => [x * s, y * s] as Pt);
  if (spine.length) {
    if (k === 0) {
      // Just the back and fin breaking the surface.
      limb(g, spine, 2.6 * s, 2.6 * s, back);
    } else {
      // The body: thick behind the head, thinning to the tail stock, a pale belly underneath.
      limb(g, spine, 1.4 * s, 3.2 * s, back);
      const under = spine.map(([x, y]) => [x + 0.2 * s, y + 0.9 * s] as Pt);
      limb(g, under.slice(1), 1 * s, 1.4 * s, pale, { max: 3 });
      limb(g, spine.slice(0, -1), 1.2 * s, 2.8 * s, back, { bias: 0.3 });
      // Fluke at the tail end.
      const [tx, ty] = spine[0];
      const [nx, ny] = spine[1];
      const ang = Math.atan2(ty - ny, tx - nx);
      const px = -Math.sin(ang);
      const py = Math.cos(ang);
      g.line(tx + px * 1.8 * s, ty + py * 1.8 * s, tx - px * 1.8 * s, ty - py * 1.8 * s, back[1]);
      // Beak.
      const [hx, hy] = spine[spine.length - 1];
      const [qx, qy] = spine[spine.length - 2];
      const d = Math.hypot(hx - qx, hy - qy) || 1;
      g.set(Math.floor(hx + ((hx - qx) / d) * 1.2 * s), Math.floor(hy + ((hy - qy) / d) * 1.2 * s), back[2]);
    }
    // Dorsal fin, on the back at the middle of the body.
    const mid = spine[Math.floor((spine.length - 1) / 2)];
    const nxt = spine[Math.floor((spine.length - 1) / 2) + 1] ?? mid;
    const ang = Math.atan2(nxt[1] - mid[1], nxt[0] - mid[0]);
    const up: Pt = [Math.sin(ang), -Math.cos(ang)];
    const base: Pt = [(mid[0] + nxt[0]) / 2, (mid[1] + nxt[1]) / 2];
    limb(g, [[base[0] + up[0] * 1.2 * s, base[1] + up[1] * 1.2 * s], [base[0] + up[0] * 3 * s - Math.cos(ang) * 1.2 * s, base[1] + up[1] * 3 * s - Math.sin(ang) * 1.2 * s]], 1.6 * s, 0.6 * s, back, { bias: -0.4 });
  }
  // Below the waterline nothing shows: clear it, then put spray where it breaks the surface.
  for (let y = Math.floor(water); y < H; y++) for (let x = 0; x < W; x++) g.set(x, y, 0);
  const splashAt = k === 0 ? [3, 13] : k === 1 ? [2, 14] : k === 4 ? [12, 14] : k === 5 ? [10, 13] : [];
  for (const x of splashAt) {
    const sx = Math.floor(x * s);
    g.set(sx, H - 1, foam);
    g.set(sx - 1, H - 1, foam);
    g.set(sx + 1, H - 1, foam);
    g.set(sx, H - 2, spray);
    if (k === 5) {
      // The splash of the dive, thrown up and falling.
      for (let j = 0; j < 4; j++) g.set(sx - 2 + j + (j % 2), H - 3 - (j % 2) * Math.round(2 * s), spray);
      g.set(sx, H - 3 - Math.round(3 * s), spray);
    }
  }
  return { grid: g, palette };
}

export class DolphinSprites {
  readonly frames = Array.from({ length: DOLPHIN_FRAMES }, (_, i) => {
    const { grid, palette } = drawDolphinSized(i);
    return gridToTexture(grid, palette.colors);
  });
}
