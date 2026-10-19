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

// --- Crabs ------------------------------------------------------------------

/**
 * A ghost crab seen from the front, `size` px wide: a squarish shell, eyes up
 * on stalks, claws held up, legs splayed either side (frames 0–3 scuttle).
 * `hidden` shows just its eyes peeping from its burrow.
 */
export function drawCrab(frame: number, size: number, hidden = false): Drawn {
  const W = Math.max(5, Math.round(size));
  // Room above the shell for the eyes up on their stalks.
  const H = Math.max(3, Math.round(W * 0.62)) + (W >= 9 ? 2 : 0);
  const g = new PixelGrid(W, H);
  const s = W / 16;
  const palette = new Palette();
  const shell = palette.ramp(0xe0c49a, 0.8);
  const leg = palette.ramp(0x8a6a4a);
  const claw = palette.ramp(0xf0e4d0, 0.6);
  const eye = palette.add(0x1a1410);
  const hole = palette.add(0x5a4430);
  const cx = W / 2;
  if (hidden) {
    // A dark burrow mouth with two eyes on their stalks just showing.
    g.ellipse(cx, H - 1, 3.5 * s + 0.5, 1.2, hole);
    g.set(Math.floor(cx - 1.2 * s), H - 3, eye);
    g.set(Math.floor(cx + 1.2 * s), H - 3, eye);
    g.set(Math.floor(cx - 1.2 * s), H - 2, shell[2]);
    g.set(Math.floor(cx + 1.2 * s), H - 2, shell[2]);
    return { grid: g, palette };
  }
  const f = ((frame % 4) + 4) % 4;
  // Legs: four a side, splayed, stepping in turn.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const lift = (f + k + (side > 0 ? 2 : 0)) % 4 < 2 ? 0 : 1;
      const y0 = H - 4 * s + k * 0.8 * s;
      limb(g, [[cx + side * 2.6 * s, y0], [cx + side * (5.8 + k * 0.9) * s, y0 - 1.6 * s - lift], [cx + side * (7.2 + k * 0.6) * s, H - 0.5]], Math.max(1, 0.9 * s), Math.max(1, 0.7 * s), leg, { bias: k === 2 ? -0.6 : 0, max: 3 });
    }
  }
  // Shell.
  shadedEllipse(g, cx, H - 4.6 * s, 3.6 * s, 2.4 * s, shell, { dither: false, min: 1 });
  // Claws, held up and forward on short arms, pale-tipped.
  for (const side of [-1, 1]) {
    limb(g, [[cx + side * 2.4 * s, H - 5 * s], [cx + side * 3.6 * s, H - 6.6 * s]], Math.max(1, 1 * s), Math.max(1, 0.9 * s), leg, { max: 3 });
    shadedEllipse(g, cx + side * 3.8 * s, H - 7.4 * s, Math.max(0.7, 1.5 * s), Math.max(0.7, 1.2 * s), claw, { dither: false, min: 1 });
  }
  // Eyes up on their stalks (raised higher while it runs, watching).
  const raise = f % 2 === 1 && W >= 12 ? 1 : 0;
  for (const side of [-1, 1]) {
    const ex = Math.floor(cx + side * 1.4 * s);
    for (let y = Math.floor(H - 7.6 * s); y >= Math.floor(H - 8.2 * s) - raise; y--) g.set(ex, y, shell[3]);
    g.set(ex, Math.floor(H - 8.4 * s) - 1 - raise, eye);
  }
  if (W >= 12) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

/** A hermit crab in a borrowed whelk shell, `size` px wide, legs walking (frames 0–1), or tucked away (`withdrawn`). */
export function drawHermitCrab(frame: number, size: number, withdrawn = false): Drawn {
  const W = Math.max(5, Math.round(size));
  const H = Math.max(4, Math.round(W * 0.8));
  const g = new PixelGrid(W, H);
  const s = W / 14;
  const palette = new Palette();
  const shellR = palette.ramp(0xe0c8a8, 0.9);
  const band = palette.ramp(0xa86a4a);
  const crab = palette.ramp(0xd0583a);
  const eye = palette.add(0x1a1410);
  // The spiral shell: a fat whorl tapering to its tip at the back.
  shadedEllipse(g, 6 * s, H - 4.6 * s, 4.4 * s, 4 * s, shellR, { dither: false, min: 1 });
  limb(g, [[4 * s, H - 6 * s], [1.2 * s, H - 8.5 * s]], 3.6 * s, 1.2 * s, shellR, { bias: 0.3 });
  if (W >= 8) {
    // The spiral's bands.
    for (let a = 0; a < 5.5; a += 0.25) {
      const rr = (1 + a * 0.55) * s;
      g.set(Math.floor(6 * s + Math.cos(a * 1.9) * rr * 0.9), Math.floor(H - 4.8 * s + Math.sin(a * 1.9) * rr * 0.8), band[1]);
    }
  }
  if (!withdrawn) {
    // Legs and a big claw out of the shell's mouth, eyes up.
    const step = frame % 2 === 0 ? 0 : 1;
    for (let k = 0; k < 2; k++) limb(g, [[9.5 * s, H - 2.5 * s], [(11 + k * 1.5 + step * 0.5) * s, H - 0.5]], Math.max(1, 0.9 * s), Math.max(1, 0.8 * s), crab, { bias: k === 0 ? -0.6 : 0 });
    shadedEllipse(g, 11.5 * s, H - 3.6 * s, Math.max(0.7, 1.6 * s), Math.max(0.7, 1.2 * s), crab, { dither: false });
    g.set(Math.floor(10.2 * s), Math.floor(H - 6 * s), eye);
  }
  if (W >= 10) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Pelican -----------------------------------------------------------------

export type PelicanPose = 'glide' | 'flap-up' | 'flap-mid' | 'flap-down' | 'dive' | 'float' | 'pouch-0' | 'pouch-1';

/**
 * A brown pelican, `size` px across, facing right: a heavy body, long broad
 * wings with dark flight feathers, the long bill and pouch, and a pale head.
 * Gliding, flapping, plunging bill-first with wings folded back, or
 * floating on the swell.
 */
export function drawPelican(pose: PelicanPose, size: number): Drawn {
  const W = Math.max(8, Math.round(size));
  const H = Math.max(5, Math.round(W * 0.6));
  const g = new PixelGrid(W, H);
  const s = W / 40;
  const P = (x: number, y: number): readonly [number, number] => [x * s, y * s];
  const palette = new Palette();
  const body = palette.ramp(0x8a8278);
  const flight = palette.ramp(0x3a3634);
  const head = palette.ramp(0xeee4c8, 0.6);
  const bill = palette.ramp(0xc8a060);
  const eye = palette.add(0x141010);
  if (pose === 'dive') {
    // Folded into an arrow, bill first, plunging steeply.
    limb(g, [P(10, 2), P(20, 12), P(26, 20)], 7 * s, 5 * s, body);
    limb(g, [P(6, 1), P(14, 9)], 4 * s, 2 * s, flight, { bias: -0.5 });
    shadedEllipse(g, 27 * s, 20 * s, 2.6 * s, 2.4 * s, head, { dither: false });
    limb(g, [P(28, 21), P(33, 23.5)], 2.4 * s, 1.2 * s, bill);
  } else if (pose === 'pouch-0' || pose === 'pouch-1') {
    // Just up from a dive: head thrown up, the pouch full and bulging, shaken from side to side to drain it.
    const shake = pose === 'pouch-0' ? -1 : 1;
    shadedEllipse(g, 18 * s, 18 * s, 11 * s, 5 * s, body, { dither: false, min: 1 });
    limb(g, [P(10, 15), P(22, 14)], 4 * s, 3 * s, flight, { bias: -0.3 });
    limb(g, [P(25, 15), P(27 + shake * 0.6, 7)], 3 * s, 2.6 * s, head);
    shadedEllipse(g, (27.5 + shake * 0.6) * s, 5.6 * s, 2.6 * s, 2.2 * s, head, { dither: false });
    limb(g, [P(29 + shake * 0.6, 5), P(35 + shake, 1.4)], 2 * s, 1.1 * s, bill);
    shadedEllipse(g, (31.5 + shake * 1.2) * s, 6.4 * s, 3.4 * s, 2.4 * s, bill, { dither: false, bias: -0.3, angle: -0.5 });
  } else if (pose === 'float') {
    // Sitting on the water, bill tucked down on its chest.
    shadedEllipse(g, 18 * s, 18 * s, 11 * s, 5 * s, body, { dither: false, min: 1 });
    limb(g, [P(10, 15), P(22, 14)], 4 * s, 3 * s, flight, { bias: -0.3 });
    limb(g, [P(26, 15), P(28, 9)], 3 * s, 2.6 * s, head);
    shadedEllipse(g, 28.5 * s, 8 * s, 2.6 * s, 2.2 * s, head, { dither: false });
    limb(g, [P(30, 8.5), P(36, 13)], 2.2 * s, 1.2 * s, bill);
  } else {
    const wingY = pose === 'flap-up' ? -9 : pose === 'flap-mid' ? -4 : pose === 'flap-down' ? 7 : -1;
    // Far wing, body, near wing.
    limb(g, [P(18, 11), P(13, 11 + wingY * 0.6), P(4, 10 + wingY)], 5 * s, 2.5 * s, flight, { bias: -1 });
    shadedEllipse(g, 19 * s, 12.5 * s, 10 * s, 3.6 * s, body, { dither: false, min: 1 });
    limb(g, [P(20, 12), P(16, 13 + wingY * 0.7), P(6, 14 + wingY)], 6 * s, 2.8 * s, body, { bias: 0.4 });
    limb(g, [P(14, 13 + wingY * 0.8), P(6, 14 + wingY)], 3 * s, 2.2 * s, flight, { bias: 0 });
    // Neck folded back, head forward, the long bill resting on the chest.
    shadedEllipse(g, 29 * s, 10.5 * s, 2.8 * s, 2.4 * s, head, { dither: false });
    limb(g, [P(31, 11), P(39, 12.5)], 2.2 * s, 1.1 * s, bill);
    limb(g, [P(31, 12.3), P(37, 13.4)], 1.4 * s, 0.8 * s, bill, { bias: -0.8 });
  }
  if (W >= 16) {
    const pouch = pose.startsWith('pouch') ? (pose === 'pouch-0' ? -0.6 : 0.6) : 0;
    const ex = pose === 'dive' ? 27.5 : pose === 'float' ? 29 : pouch ? 28 + pouch : 29.6;
    const ey = pose === 'dive' ? 19.5 : pose === 'float' ? 7.6 : pouch ? 5 : 10;
    g.set(Math.floor(ex * s), Math.floor(ey * s), eye);
    selOut(g, palette, { bottomHeavy: true });
  }
  return { grid: g, palette };
}

// --- Jellyfish and hatchlings -------------------------------------------------

export const JELLY_FRAMES = 4;

/**
 * A moon jellyfish drifting just under the surface, seen at a slant, `size`
 * px across the bell: a glassy dome with its four pale rings showing
 * through and a frilled rim; the frilly oral arms hanging beneath; fine
 * tentacles streaming out behind, waving. It pulses: the bell squeezes,
 * pushes, and opens out again (four frames).
 */
export function drawJellyfish(frame: number, size: number): Drawn {
  const N = Math.max(3, Math.round(size));
  const W = Math.round(N * 1.7) + 1;
  const H = Math.max(3, Math.round(N * 1.05));
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const bell = palette.ramp(0xb8cce8, 0.55);
  const ring = palette.add(0xead2f2);
  const arm = palette.ramp(0xd0d8f0, 0.5);
  const f = ((frame % JELLY_FRAMES) + JELLY_FRAMES) % JELLY_FRAMES;
  // The pulse: wide and flat, squeezing narrow and tall, then opening.
  const squeeze = [1, 0.84, 0.76, 0.9][f];
  const cx = W - N / 2 - 0.5;
  const top = 0.5;
  const rx = (N / 2) * squeeze;
  const ry = (N * 0.42) / squeeze;
  const rim = Math.min(H - 1, top + ry);
  if (N < 6) {
    g.ellipse(cx, rim, rx, ry, (u, v) => (v > 0 ? 0 : u * u + v * v > 0.6 ? bell[1] : bell[3]));
    // A trailing wisp.
    g.set(Math.floor(cx - rx - 1), Math.floor(rim), bell[1]);
    return { grid: g, palette };
  }
  // Tentacles: fine, trailing back (left) from the rim, waving as it pulses.
  for (let t = 0; t < 4; t++) {
    const y0 = rim - 0.4 + t * 0.35;
    const len = N * (0.8 + t * 0.12);
    for (let k = 0; k <= len; k++) {
      const x = cx - rx * 0.6 - k;
      const y = y0 + Math.sin(k * 0.55 - f * 1.4 + t) * 0.9 + (k / len) * N * 0.15;
      if (x < 0 || y >= H) break;
      if ((k + t) % 3 !== 2) g.set(Math.floor(x), Math.floor(y), bell[k > len * 0.6 ? 1 : 2]);
    }
  }
  // The oral arms: short frilly curtains hanging under the bell.
  for (const dx of [-0.25, 0.15]) {
    const ax = cx + dx * N;
    for (let k = 0; k < N * 0.45; k++) {
      const x = ax - k * 0.9 + Math.sin(k * 1.4 + f) * 0.5;
      const y = rim + 0.6 + k * 0.45 + Math.cos(k * 1.1 + f) * 0.4;
      if (y >= H) break;
      g.set(Math.floor(x), Math.floor(y), arm[k % 2 ? 2 : 3]);
    }
  }
  // The bell: a glassy dome, brighter at its crown and its frilled rim.
  g.ellipse(cx, rim, rx, ry, (u, v, x) => {
    if (v > 0.08) return 0;
    const d = u * u + v * v;
    if (d > 0.78) return (x + f) % 2 ? bell[3] : bell[2];
    return v < -0.7 ? bell[4] : bell[2];
  });
  // The four rings through the top.
  for (const [dx, dy] of [[-0.3, -0.5], [0.3, -0.5], [-0.12, -0.3], [0.12, -0.3]] as const) g.set(Math.floor(cx + dx * rx), Math.floor(rim + dy * ry), ring);
  return { grid: g, palette };
}

export const HATCHLING_FRAMES = 4;

/**
 * A loggerhead hatchling scrambling for the sea, seen from above, `size` px
 * long, head up the frame: a dark, keeled little shell with paler edges,
 * a blunt head with its eyes, long front flippers rowing in turn and small
 * back ones pushing (four frames).
 */
export function drawHatchling(frame: number, size: number): Drawn {
  const N = Math.max(3, Math.round(size));
  const W = Math.max(3, Math.round(N * 1.4));
  const H = N + 1;
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const shell = palette.ramp(0x4a3e2c, 0.8);
  const skin = palette.ramp(0x3a3428, 0.7);
  const eyeC = palette.add(0x0e0c0a);
  const f = ((frame % HATCHLING_FRAMES) + HATCHLING_FRAMES) % HATCHLING_FRAMES;
  const cx = W / 2;
  const s = N / 10;
  if (N < 5) {
    // Too small for its parts: a dark dot of a shell with its flippers out.
    g.set(Math.floor(cx), 0, skin[3]);
    g.rect(Math.floor(cx - 0.5), 1, 1, Math.max(1, N - 1), shell[2]);
    g.set(Math.floor(cx - 1 - (f % 2)), 1 + (f % 2), skin[2]);
    g.set(Math.ceil(cx + (f % 2)), 2 - (f % 2), skin[2]);
    return { grid: g, palette };
  }
  // Flippers: front ones sweeping (one forward as the other pulls back), back ones pushing.
  const sweep = [-1.2, -0.3, 1, 0.2][f];
  for (const side of [-1, 1]) {
    const k = side < 0 ? sweep : -sweep;
    limb(g, [[cx + side * 1.6 * s, 3.4 * s], [cx + side * 4.4 * s, (3.2 + k * 1.2) * s], [cx + side * 6 * s, (4.4 + k * 1.6) * s]], Math.max(1, 1.2 * s), Math.max(1, 0.7 * s), skin);
    limb(g, [[cx + side * 1.4 * s, 7.6 * s], [cx + side * 2.8 * s, (8.8 - k * 0.5) * s]], Math.max(1, 0.9 * s), Math.max(1, 0.6 * s), skin);
  }
  // The shell, keeled down the middle, paler round the edge.
  shadedEllipse(g, cx, 5.8 * s, 2.6 * s, 3.3 * s, shell, { dither: false, min: 1 });
  for (let y = Math.floor(3.4 * s); y < 8.4 * s; y++) g.set(Math.floor(cx), y, shell[3]);
  // The head out front, with its eyes either side.
  shadedEllipse(g, cx, 1.6 * s + 0.4, 1.3 * s, 1.3 * s, skin, { dither: false, min: 1 });
  if (N >= 8) {
    g.set(Math.floor(cx - 0.9 * s), Math.floor(1.4 * s), eyeC);
    g.set(Math.floor(cx + 0.9 * s), Math.floor(1.4 * s), eyeC);
  }
  if (N >= 8) selOut(g, palette);
  return { grid: g, palette };
}
