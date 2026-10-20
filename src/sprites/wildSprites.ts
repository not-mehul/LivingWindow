import { bayer4, eye, limb, Palette, rimShade, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

/**
 * Wild animals shared between the landscapes: the fox, bats, the black bear,
 * butterflies, a woodpecker clinging to bark, and mushrooms. All drawn with
 * the kit at the size they're seen.
 */

type Pt = readonly [number, number];

export { DrawnCache } from './cache';

// --- Fox ------------------------------------------------------------------

export type FoxPose = 'trot-1' | 'trot-2' | 'trot-3' | 'trot-4' | 'sniff' | 'sit' | 'crouch' | 'pounce' | 'run-1' | 'run-2';
export const FOX_TROT: readonly FoxPose[] = ['trot-1', 'trot-2', 'trot-3', 'trot-4'];

/**
 * A red fox in profile facing right, `height` px tall and 1.6× as wide, feet
 * on the bottom row: a russet body and white chest, black stockings, big
 * black-backed ears, a narrow muzzle, and the bushy white-tipped brush.
 * Authored in a 48×30 box.
 */
export function drawFox(pose: FoxPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.6);
  const g = new PixelGrid(W, H);
  const s = H / 30;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0xc8622a);
  const white = palette.ramp(0xf0e8dc, 0.6);
  const black = palette.ramp(0x2a2220);
  const eyeInk = palette.add(0x140c08);
  const big = H >= 12;
  const lw = Math.max(1, 2 * s);
  const leg = (path: Pt[], far: boolean) => {
    limb(g, path.slice(0, 2), lw * 1.5, lw, fur, { bias: far ? -1.2 : 0 });
    limb(g, path.slice(1), lw, lw * 0.9, black, { bias: far ? -0.8 : 0 });
  };
  const tail = (path: Pt[]) => {
    limb(g, path, 4.4 * s, 5.8 * s, fur, { bias: 0.2 });
    // White tip.
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    limb(g, [[a[0] + (b[0] - a[0]) * 0.6, a[1] + (b[1] - a[1]) * 0.6], b], 4 * s, 3.6 * s, white, { max: 3 });
  };
  const head = (hx: number, hy: number, angle: number, ears = 0) => {
    // Ears, the far one first.
    for (const [dx, far] of [[1.6, true], [0, false]] as const) {
      const base: Pt = P(hx - 1 + dx, hy - 2.5);
      const tip: Pt = P(hx - 2 + dx - ears, hy - 7.5 + Math.abs(ears) * 0.5);
      limb(g, [base, tip], 3 * s, 0.8 * s, far ? black : fur, { bias: far ? -0.5 : 0 });
      if (!far && big) limb(g, [[base[0] + s * 0.4, base[1]], tip], 1.2 * s, 0.6 * s, black, { max: 2 });
    }
    shadedEllipse(g, hx * s, hy * s, 4.2 * s, 3.4 * s, fur, { dither: false, angle });
    // The long muzzle, white beneath, a black nose at the tip.
    const mx = hx + Math.cos(angle) * 4.4;
    const my = hy + Math.sin(angle) * 4.4 + 0.6;
    shadedEllipse(g, mx * s, my * s, 3 * s, 1.5 * s, fur, { dither: false, angle });
    limb(g, [P(hx - 1, hy + 2), P(mx + 0.5, my + 1)], 2 * s, 1 * s, white, { max: 3 });
    g.set(Math.floor((hx + Math.cos(angle) * 7.2) * s), Math.floor((hy + Math.sin(angle) * 7.2 + 0.4) * s), black[1]);
    if (big) g.set(Math.floor((hx + 1.2) * s), Math.floor((hy - 0.8) * s), eyeInk);
  };

  if (pose === 'sit') {
    // Sitting up, brush curled round its feet.
    tail([P(16, 27), P(24, 29), P(32, 28.5)]);
    leg([P(26, 20), P(27, 25), P(27.5, 29)], true);
    shadedEllipse(g, 22 * s, 21 * s, 6 * s, 7 * s, fur, { dither: false, angle: -0.5 });
    shadedEllipse(g, 27 * s, 17 * s, 3 * s, 5 * s, white, { dither: false, max: 3, angle: -0.3 });
    leg([P(29, 18), P(29.5, 24), P(30, 29)], false);
    head(30, 9, 0.25);
  } else {
    const trot = pose.startsWith('trot') ? Number(pose.slice(-1)) - 1 : -1;
    const run = pose === 'run-1' ? 0 : pose === 'run-2' ? 1 : -1;
    const ph = (trot * Math.PI) / 2;
    const sw = (o: number) => (trot >= 0 ? Math.sin(ph + o) * 3 : 0);
    const lift = (o: number) => (trot >= 0 ? Math.max(0, Math.cos(ph + o)) * 2 : 0);
    const low = pose === 'crouch' ? 4 : pose === 'sniff' ? 1 : 0;
    const air = pose === 'pounce' ? -6 : run === 1 ? -2 : 0;
    const by = 16 + low + air;
    // Far legs.
    if (run >= 0) {
      leg(run === 0 ? [P(31, by + 3), P(36, by + 8), P(41, by + 11)] : [P(31, by + 3), P(30, by + 9), P(26, by + 12)], true);
      leg(run === 0 ? [P(14, by + 3), P(9, by + 8), P(4, by + 10)] : [P(14, by + 3), P(17, by + 9), P(21, by + 12)], true);
    } else if (pose === 'pounce') {
      leg([P(31, by + 3), P(35, by + 8), P(36, by + 13)], true);
      leg([P(14, by + 3), P(10, by + 7), P(6, by + 9)], true);
    } else {
      leg([P(31, by + 3), P(31.5 + sw(Math.PI) * 0.5, 24 - lift(Math.PI)), P(31 + sw(Math.PI), 29.5 - lift(Math.PI) * 0.5)], true);
      leg([P(14, by + 3), P(12 + sw(0) * 0.4, 24 - lift(0)), P(13 + sw(0), 29.5 - lift(0) * 0.5)], true);
    }
    // The brush, streaming behind (straight out when running, low when trotting).
    tail(run >= 0 || pose === 'pounce' ? [P(11, by - 1), P(5, by - 2), P(0.5, by - 1)] : [P(11, by), P(5, by + 3), P(1, by + 3)]);
    // Body, white chest.
    shadedEllipse(g, 21 * s, by * s, 11 * s, 5 * s, fur, { dither: false, min: 1, angle: pose === 'pounce' ? -0.25 : 0 });
    if (big) shadedEllipse(g, 29 * s, (by + 2) * s, 3.5 * s, 3 * s, white, { dither: false, max: 3 });
    // Near legs.
    if (run >= 0) {
      leg(run === 0 ? [P(29, by + 3), P(34, by + 9), P(38, by + 12)] : [P(29, by + 3), P(28, by + 9), P(24, by + 12)], false);
      leg(run === 0 ? [P(16, by + 3), P(11, by + 9), P(7, by + 11)] : [P(16, by + 3), P(19, by + 9), P(22, by + 12)], false);
    } else if (pose === 'pounce') {
      leg([P(29, by + 3), P(33, by + 8), P(34, by + 13)], false);
      leg([P(16, by + 3), P(12, by + 7), P(8, by + 10)], false);
    } else {
      leg([P(29, by + 3), P(29.5 + sw(0) * 0.5, 24 - lift(0)), P(29 + sw(0), 29.5 - lift(0) * 0.5)], false);
      leg([P(16, by + 3), P(14 + sw(Math.PI) * 0.4, 24 - lift(Math.PI)), P(15 + sw(Math.PI), 29.5 - lift(Math.PI) * 0.5)], false);
    }
    if (pose === 'sniff') head(37, 24, 1.0, -1);
    else if (pose === 'crouch') head(37, by - 2, 0.35, 1.5);
    else if (pose === 'pounce') head(38, by + 4, 1.1, -1);
    else head(36, by - 5, 0.3, run >= 0 ? 2 : 0);
  }
  if (big) selOut(g, palette, { bottomHeavy: H < 18 });
  return { grid: g, palette };
}

// --- Bats -----------------------------------------------------------------

/**
 * A bat flitting, `size` px across: a furry brown body and big ears, and
 * leathery wings stretched over long finger bones, scalloped between them.
 * Four frames through the wingbeat: raised, sweeping down, down, coming up.
 */
export function drawBat(frame: number, size: number): Drawn {
  const N = Math.max(4, Math.round(size));
  const H = Math.max(3, Math.round(N * 0.66));
  const g = new PixelGrid(N, H);
  const s = N / 16;
  const palette = new Palette();
  const wing = palette.ramp(0x3e3036, 0.9);
  const bone = palette.ramp(0x6a5458);
  const fur = palette.ramp(0x6a503e);
  const cx = N / 2;
  const cy = H * 0.52;
  const f = ((frame % 4) + 4) % 4;
  // Wrist and tip heights through the beat (authored units).
  const wristY = [-3.2, -1, 1.6, 0.2][f] * s;
  const tipY = [-4.8, -0.4, 3.6, 1.8][f] * s;
  const spread = [0.86, 1, 0.82, 0.9][f];
  for (const side of [-1, 1]) {
    const wrist: Pt = [cx + side * 3.8 * s * spread, cy + wristY];
    const tip: Pt = [cx + side * 7.6 * s * spread, cy + tipY];
    const mid: Pt = [cx + side * 6.6 * s * spread, cy + tipY * 0.5 + 2.2 * s];
    const inner: Pt = [cx + side * 4.4 * s * spread, cy + wristY * 0.3 + 2.4 * s];
    // The membrane: from the body out to the tip, scalloped back along the trailing edge.
    g.polygon([[cx, cy - 0.8 * s], wrist, tip, mid, [cx + side * 5.4 * s * spread, cy + 1.2 * s + tipY * 0.2], inner, [cx + side * 2.6 * s, cy + 2 * s], [cx, cy + 1.4 * s]], wing[f === 2 ? 1 : 2]);
    if (N >= 9) {
      // The arm and finger bones fanning from the wrist.
      limb(g, [[cx, cy - 0.6 * s], wrist], 0.9, 0.7, bone, { max: 2 });
      limb(g, [wrist, tip], 0.7, 0.6, bone, { max: 2 });
      limb(g, [wrist, mid], 0.6, 0.6, bone, { max: 1 });
      limb(g, [wrist, inner], 0.6, 0.6, bone, { max: 1 });
    }
  }
  // The body: furry, a pale-ish chest, ears pricked.
  shadedEllipse(g, cx, cy + 0.3 * s, Math.max(0.8, 1.5 * s), Math.max(1, 2.4 * s), fur, { dither: false });
  if (N >= 7) {
    const ear = Math.max(1, Math.round(1.2 * s));
    for (let k = 0; k < ear; k++) {
      g.set(Math.floor(cx - 0.9 * s), Math.floor(cy - 2.2 * s) - k, fur[2]);
      g.set(Math.floor(cx + 0.9 * s), Math.floor(cy - 2.2 * s) - k, fur[1]);
    }
  }
  if (N >= 12) selOut(g, palette, { bottomHeavy: false });
  return { grid: g, palette };
}

// --- Eagle overhead ----------------------------------------------------------

/** Frames of the soaring eagle: wingtips raised, level, drooping (it flexes as it rides the air), and a stoop. */
export const EAGLE_SOAR = 3;
export const EAGLE_STOOP = 3;

/**
 * A bald eagle soaring overhead, seen from below: long broad wings held out
 * flat, the primaries spread like fingers at the tips; a dark brown body and
 * underwing, lit along the leading edge; the white head turned the way it
 * flies, a hooked yellow bill, and the white tail fanned. Frames 0–2 flex
 * the wings (tips up, level, down) as it rides the air; frame 3 is the
 * stoop, wings half folded back. `size` is the old side-on box; the sprite
 * is 1.7× as wide (its span) and 0.75× as tall. Authored at 40×18, head right.
 */
export function drawEagleSoar(frame: number, size: number): Drawn {
  const W = Math.max(12, Math.round((size * 1.7) / 2) * 2);
  const s = W / 40;
  const H = Math.max(6, Math.round(18 * s));
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const brown = palette.ramp(0x4e3626, 0.8);
  const white = palette.ramp(0xeee8dc, 0.5);
  const bill = palette.ramp(0xe8b830, 0.7);
  const stoop = frame === EAGLE_STOOP;
  const f = Math.min(2, Math.max(0, frame));
  const cx = W / 2;
  const shoulderY = (stoop ? 6 : 7) * s;
  // Tip lift (authored units) and how far out the wings reach.
  const lift = stoop ? -4.5 : [3.2, 1.1, -0.7][f];
  const span = stoop ? 0.56 : [0.95, 1, 0.97][f];
  const half = 20 * s * span;
  // Fingered tips only when there's room for sky between them; small or stooping, the wing just tapers to a point.
  const fingers = stoop || W < 24 ? 0 : W < 30 ? 3 : 4;
  // Drawn after the outline, so the sky shows between them.
  const primaries: Array<[number, number, number]> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = Math.abs(x + 0.5 - cx) / half;
      if (t < 0.05 || t > 1) continue;
      const c = shoulderY - lift * s * t ** 1.3 + (stoop ? 2.5 * s * t : 0);
      const hand = fingers ? Math.max(0, (t - 0.55) / 0.23) : Math.max(0, (t - 0.5) / 0.5) * 2.2;
      const lead = c - (2.2 - 0.7 * t - 0.4 * hand) * s * (stoop ? 0.75 : 1);
      const trail = c + (3.4 - 1.4 * t + 0.9 * Math.sin(Math.min(1, t / 0.8) * Math.PI) - 0.9 * hand) * s * (stoop ? 0.75 : 1);
      const py = y + 0.5;
      if (fingers && t > 0.78) {
        // The spread primaries: dark fingers reaching out from the hand, fanning a little, sky between them.
        const k = (t - 0.78) / 0.22;
        const mid = (fingers - 1) / 2;
        let hit = false;
        for (let i = 0; i < fingers; i++) {
          const fy = c - 0.4 * s + (i - mid) * Math.max(1.8, (1.5 + k * 0.6) * s);
          // The middle fingers reach furthest.
          const reach = 1 - Math.abs(i - mid) * 0.07;
          if (k <= reach && Math.abs(py - fy) < 0.5) hit = true;
        }
        if (hit) primaries.push([x, y, brown[t > 0.9 ? 0 : 1]]);
        continue;
      }
      if (py < lead || py > trail) continue;
      const v = (py - lead) / Math.max(0.5, trail - lead);
      // Leading edge catching the sky's light; the coverts a shade paler than the flight feathers; dark trailing edge.
      const d = bayer4(x, y) * 0.12;
      g.set(x, y, v < 0.12 ? brown[3] : v + d < 0.5 ? brown[2] : v + d < 0.9 ? brown[1] : brown[0]);
    }
  }
  // The tail, white and fanned (closed in the stoop).
  const tailTop = shoulderY + 4.5 * s;
  const tailEnd = shoulderY + (stoop ? 10 : 9.5) * s;
  const tw0 = 1.3 * s;
  const tw1 = (stoop ? 1.6 : 3) * s;
  g.polygon([[cx - tw0, tailTop], [cx + tw0, tailTop], [cx + tw1, tailEnd], [cx - tw1, tailEnd]], white[2]);
  if (W >= 20) for (let x = Math.floor(cx - tw1); x <= Math.ceil(cx + tw1); x++) if (g.get(x, Math.floor(tailEnd) - 1) === white[2]) g.set(x, Math.floor(tailEnd) - 1, white[1]);
  // The body, and the white head turned the way it's flying.
  shadedEllipse(g, cx, shoulderY + 1.6 * s, Math.max(1, 2.3 * s), Math.max(1.5, (stoop ? 5.4 : 4.6) * s), brown, { dither: W >= 24, bias: -0.2 });
  const hx = cx + 0.8 * s;
  const hy = shoulderY - (stoop ? 3.6 : 3) * s;
  shadedEllipse(g, hx, hy, Math.max(1, 2 * s), Math.max(1, 1.9 * s), white, { dither: false });
  g.set(Math.floor(hx + 1.9 * s), Math.floor(hy + 0.2 * s), bill[2]);
  if (W >= 26) g.set(Math.floor(hx + 1.9 * s) + 1, Math.floor(hy + 0.2 * s) + 1, bill[1]);
  if (W >= 30) g.set(Math.floor(hx + 0.9 * s), Math.floor(hy - 0.3 * s), brown[0]);
  if (W >= 22) selOut(g, palette, { bottomHeavy: false });
  for (const [x, y, c] of primaries) g.set(x, y, c);
  return { grid: g, palette };
}

// --- Black bear -------------------------------------------------------------

export type BearPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'walk-5' | 'walk-6' | 'sniff' | 'sniff-air';
/** A heavy, rolling six-beat amble. */
export const BEAR_WALK: readonly BearPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6'];

/**
 * A black bear ambling in profile facing right, `height` px tall and 1.7× as
 * wide: a shaggy bulk rising to the hump over its shoulders, thick jointed
 * legs on broad paws with pale claws, round ears, a small dark eye and a tan
 * muzzle. It sniffs along the ground, or lifts its nose to scent the air.
 * Authored in a 41×24 box.
 */
export function drawBear(pose: BearPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.7);
  const g = new PixelGrid(W, H);
  const s = H / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0x2e2826, 0.9);
  const muzzle = palette.ramp(0xa8845a);
  const claw = palette.ramp(0xd8ccb0);
  const eyeInk = palette.add(0x0a0808);
  const glint = palette.add(0xc8c0b0);
  const walking = pose.startsWith('walk');
  const k = walking ? Number(pose.slice(-1)) - 1 : 0;
  const ph = (k * Math.PI * 2) / 6;
  const bob = walking ? Math.abs(Math.sin(ph)) * 0.7 : 0;
  const detailed = H >= 14;
  const legW = Math.max(1.5, 3.8 * s);
  /** One leg: a thick upper limb, the forearm or hock, and a broad paw; it swings and lifts in the walk. */
  const leg = (x: number, o: number, far: boolean, front: boolean) => {
    const swing = walking ? Math.sin(ph + o) * 2.6 : 0;
    const lift = walking ? Math.max(0, Math.cos(ph + o)) * 1.6 : 0;
    const bias = far ? -1.3 : -0.2;
    const top = P(x, 13 + bob);
    const joint = front ? P(x + swing * 0.4 + lift * 0.4, 19 - lift * 0.5) : P(x - 1 + swing * 0.3, 19.5 - lift * 0.6);
    const paw = P(x + swing, 23.2 - lift);
    limb(g, [top, joint], legW * 1.5, legW * 1.05, fur, { bias });
    limb(g, [joint, paw], legW * 1.05, legW * 0.95, fur, { bias });
    // The paw, flat on the ground, and its claws.
    shadedEllipse(g, paw[0] + 0.8 * s, paw[1], Math.max(1, 2.2 * s), Math.max(0.6, 1 * s), fur, { dither: false, bias: bias - 0.3 });
    if (detailed && !far) g.set(Math.floor(paw[0] + 2.6 * s), Math.floor(paw[1] + 0.4 * s), claw[2]);
  };
  leg(29, Math.PI, true, true);
  leg(11.5, 0, true, false);
  // The bulk: rump, a deep belly, and the hump over the shoulders.
  shadedEllipse(g, 11 * s, (11.5 + bob) * s, 7.5 * s, 7.5 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 20 * s, (12.5 + bob) * s, 11 * s, 6.8 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 27.5 * s, (10 + bob) * s, 6.5 * s, 6.5 * s, fur, { dither: false, min: 1 });
  // A stub of tail.
  g.set(Math.floor(3.6 * s), Math.floor((9.5 + bob) * s), fur[1]);
  leg(31.5, 0, false, true);
  leg(10, Math.PI, false, false);
  // Head: low and swinging as it walks, nose to the ground to sniff, or raised to scent the air.
  const sniffing = pose === 'sniff';
  const air = pose === 'sniff-air';
  const hx = sniffing ? 35.5 : air ? 34.5 : 35 + (walking ? Math.sin(ph) * 0.5 : 0);
  const hy = (sniffing ? 17.5 : air ? 7 : 11.5) + bob;
  const tilt = sniffing ? 0.7 : air ? -0.5 : 0.15;
  // The neck, thick, into the shoulders.
  limb(g, [P(29, 9 + bob), P(hx - 1.5, hy)], 8 * s, 6.5 * s, fur, { dither: false });
  // Round ears, the far one in shade.
  shadedEllipse(g, (hx - 2.8) * s, (hy - 3.6) * s, Math.max(0.6, 1.4 * s), Math.max(0.6, 1.4 * s), fur, { dither: false, bias: -1 });
  shadedEllipse(g, (hx - 1.4) * s, (hy - 3.9) * s, Math.max(0.6, 1.5 * s), Math.max(0.6, 1.4 * s), fur, { dither: false });
  shadedEllipse(g, hx * s, hy * s, 4 * s, 3.4 * s, fur, { dither: false, angle: tilt });
  // The long tan muzzle and its dark nose.
  const mx = hx + Math.cos(tilt) * 3.4;
  const my = hy + Math.sin(tilt) * 3.4 + 0.6;
  shadedEllipse(g, mx * s, my * s, 2.4 * s, 1.6 * s, muzzle, { dither: false, angle: tilt, max: 3 });
  g.set(Math.floor((mx + Math.cos(tilt) * 2.2) * s), Math.floor((my + Math.sin(tilt) * 2.2 - 0.4) * s), fur[0]);
  if (detailed) {
    eye(g, (hx + 0.8) * s, (hy - 0.9) * s, H >= 30 ? 2 : 1, eyeInk, glint);
    // Shaggy fur: darker strands through the coat, a little rim light along the back.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = g.get(x, y);
        if (c === fur[2] && pixelHash(x, Math.floor(y / 2), 17) < 0.18) g.set(x, y, fur[1]);
        else if (c === fur[3] && pixelHash(x, Math.floor(y / 2), 19) < 0.07) g.set(x, y, fur[4]);
      }
    }
    rimShade(g, [fur]);
  }
  if (H >= 12) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Grey wolf --------------------------------------------------------------

export type WolfPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'sit' | 'howl';
export const WOLF_WALK: readonly WolfPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];

/**
 * A grey wolf in profile facing right, `height` px tall and 1.6× as wide:
 * lean and long-legged, a deep chest, a thick ruff, pointed ears, a long
 * muzzle and a bushy tail carried low. It walks, sits, or sits with its
 * muzzle raised to the sky, howling. Authored in a 38×24 box.
 */
export function drawWolf(pose: WolfPose, height: number): Drawn {
  const H = Math.max(5, Math.round(height));
  const W = Math.round(H * 1.6);
  const g = new PixelGrid(W, H);
  const s = H / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const fur = palette.ramp(0x7a7672, 0.9);
  const pale = palette.ramp(0xc8c2b8, 0.6);
  const dark = palette.ramp(0x3a3634);
  const eyeInk = palette.add(0xd8c060);
  const detailed = H >= 14;
  const legW = Math.max(1, 2 * s);
  if (pose === 'sit' || pose === 'howl') {
    // Sitting: haunches down, forelegs straight, the tail curled round the feet.
    limb(g, [P(9, 21), P(4, 22.5), P(3, 20)], 3 * s, 2.4 * s, fur, { bias: -0.4 });
    shadedEllipse(g, 12 * s, 17 * s, 6 * s, 5.5 * s, fur, { dither: false, min: 1 });
    shadedEllipse(g, 17 * s, 12 * s, 4.5 * s, 7 * s, fur, { dither: false, angle: 0.35, min: 1 });
    if (detailed) shadedEllipse(g, 19.5 * s, 13 * s, 2 * s, 5 * s, pale, { dither: false, angle: 0.35, max: 3 });
    limb(g, [P(19, 15), P(20, 23.5)], legW * 1.2, legW, fur, { bias: -0.2 });
    limb(g, [P(17, 15), P(17.5, 23.5)], legW * 1.2, legW, fur, { bias: -1.2 });
    const howl = pose === 'howl';
    const hx = howl ? 21 : 22.5;
    const hy = howl ? 6.5 : 7;
    const tilt = howl ? -1.05 : 0.15;
    // The ruff, the head, ears laid back when it howls.
    limb(g, [P(18, 9), P(hx - 1, hy + 1.5)], 6 * s, 4.5 * s, fur);
    shadedEllipse(g, hx * s, hy * s, 3 * s, 2.6 * s, fur, { dither: false });
    limb(g, [P(hx - 1, hy - 1.5), P(hx - (howl ? 3 : 1.5), hy - (howl ? 3 : 4.5))], 1.8 * s, 0.8 * s, fur, { bias: -0.4 });
    const mx = hx + Math.cos(tilt) * 4;
    const my = hy + Math.sin(tilt) * 4;
    limb(g, [P(hx + Math.cos(tilt) * 1.5, hy + Math.sin(tilt) * 1.5), P(mx, my)], 2.4 * s, 1.4 * s, fur, { bias: 0.3 });
    g.set(Math.floor(mx * s), Math.floor(my * s), dark[1]);
    if (detailed && !howl) g.set(Math.floor((hx + 0.6) * s), Math.floor((hy - 0.6) * s), eyeInk);
  } else {
    const k = Number(pose.slice(-1)) - 1;
    const ph = (k * Math.PI) / 2;
    const leg = (x: number, o: number, far: boolean, front: boolean) => {
      const sw = Math.sin(ph + o) * 2.6;
      const lift = Math.max(0, Math.cos(ph + o)) * 1.4;
      const joint = front ? P(x + sw * 0.3, 18.5 - lift * 0.4) : P(x - 1.5 + sw * 0.3, 18 - lift * 0.4);
      limb(g, [P(x, 13), joint], legW * 1.4, legW, fur, { bias: far ? -1.3 : -0.2 });
      limb(g, [joint, P(x + sw, 23.4 - lift)], legW, legW * 0.9, fur, { bias: far ? -1.3 : -0.3 });
    };
    leg(26, Math.PI, true, true);
    leg(10, 0, true, false);
    // The tail, low and bushy.
    limb(g, [P(5, 11), P(2.5, 15), P(2, 19)], 3.4 * s, 2.6 * s, fur, { bias: -0.3 });
    if (detailed) g.set(Math.floor(2 * s), Math.floor(19.5 * s), dark[1]);
    // A lean body: the haunch, a tucked-up belly, the deep chest and the ruff over the shoulders.
    shadedEllipse(g, 10 * s, 11.5 * s, 5 * s, 4.5 * s, fur, { dither: false, min: 1 });
    shadedEllipse(g, 17 * s, 12 * s, 9 * s, 3.8 * s, fur, { dither: false, min: 1 });
    shadedEllipse(g, 25 * s, 11.5 * s, 5 * s, 5.2 * s, fur, { dither: false, min: 1 });
    if (detailed) shadedEllipse(g, 28.5 * s, 13.5 * s, 1.6 * s, 2.4 * s, pale, { dither: false, max: 3 });
    leg(28, 0, false, true);
    leg(8.5, Math.PI, false, false);
    // Head carried level and low, ears pricked, the long muzzle.
    const bob = Math.sin(ph * 2) * 0.4;
    const hx = 32;
    const hy = 8 + bob;
    limb(g, [P(27, 9), P(hx - 1.5, hy + 0.5)], 5.5 * s, 4 * s, fur);
    shadedEllipse(g, hx * s, hy * s, 2.8 * s, 2.5 * s, fur, { dither: false });
    limb(g, [P(hx - 1, hy - 1.5), P(hx - 1.6, hy - 4.6)], 1.8 * s, 0.8 * s, fur);
    limb(g, [P(hx + 1, hy + 0.3), P(hx + 4.6, hy + 1.2)], 2.3 * s, 1.4 * s, fur, { bias: 0.3 });
    g.set(Math.floor((hx + 4.8) * s), Math.floor((hy + 1) * s), dark[1]);
    if (detailed) g.set(Math.floor((hx + 0.7) * s), Math.floor((hy - 0.6) * s), eyeInk);
  }
  if (H >= 12) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Butterflies -------------------------------------------------------------

export type ButterflyKind = 'monarch' | 'white' | 'blue' | 'brimstone';

interface ButterflyStyle {
  /** Upper side of the wings, and its border. */
  wing: number;
  edge: number;
  /** The underside, shown when the wings are closed up. */
  under: number;
  /** The brimstone's wings end in leaf points. */
  leaf?: boolean;
}

const BUTTERFLY: Record<ButterflyKind, ButterflyStyle> = {
  monarch: { wing: 0xe8862a, edge: 0x2a1e18, under: 0xe0a86a },
  white: { wing: 0xf2f0e8, edge: 0x3a3a40, under: 0xdde4c8 },
  blue: { wing: 0x5a8ae8, edge: 0x24305a, under: 0xb8bcc8 },
  brimstone: { wing: 0xece05a, edge: 0xa89a30, under: 0xd8e08a, leaf: true },
};

/** Frames: wings open flat (0), raised half way (1), closed up over the back (2), and swept down below flat (3). */
export const BUTTERFLY_FLIGHT: readonly number[] = [0, 1, 2, 1, 0, 3];

/** Far off, a butterfly is a few hand-placed pixels: e edge, w wing, d shade, b body. */
const TINY_BUTTERFLY = [
  ['e...e', 'wwbww', '.wbw.', '.d.d.'],
  ['.e.e.', '.wbw.', '..b..', '.....'],
  ['..e..', '..w..', '..b..', '.....'],
  ['.....', 'wwbww', 'e.b.e', '.d.d.'],
];

type Pt2 = readonly [number, number];
/** Wing outlines for the right side (u out from the body, v down), in −1..1 of the box. */
const FOREWING: readonly Pt2[] = [[0.08, -0.12], [0.3, -0.62], [0.62, -0.9], [0.9, -0.82], [0.86, -0.42], [0.62, -0.04], [0.12, 0.06]];
const HINDWING: readonly Pt2[] = [[0.1, 0.02], [0.6, 0.04], [0.68, 0.36], [0.52, 0.72], [0.24, 0.84], [0.1, 0.5]];
const LEAF_TIP: Pt2 = [1, -0.98];
const LEAF_TAIL: Pt2 = [0.66, 0.66];

/**
 * A butterfly seen from above, `size` px across, head up: pointed
 * forewings and rounded hindwings with a waist between, shaded from the
 * body out and edged, with each species' marks — the monarch's black veins
 * and white-spotted border, the white's black tips and spot, the blue's
 * pale fringe, the brimstone's leaf-pointed wings and orange dots; a thin
 * dark body and its antennae. Frame 2 shows the closed wings' underside;
 * 1 and 3 are the wings raised and lowered through the beat. Under 6 px
 * it's a few hand-placed pixels.
 */
export function drawButterfly(kind: ButterflyKind, frame: number, size: number): Drawn {
  const st = BUTTERFLY[kind];
  const palette = new Palette();
  const wing = palette.ramp(st.wing, 0.7);
  const under = palette.ramp(st.under, 0.6);
  const edge = palette.add(st.edge);
  const body = palette.add(0x2a2420);
  const pale = palette.add(0xf8f4ea);
  const orange = palette.add(0xe87a20);
  const f = ((frame % 4) + 4) % 4;
  const N = Math.max(3, Math.round(size));
  if (N < 6) {
    const ink: Record<string, number> = { e: edge, w: wing[3], d: wing[1], b: body };
    const rows = TINY_BUTTERFLY[f];
    const g = new PixelGrid(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.set(x, y, ink[row[x]]);
    });
    return { grid: g, palette };
  }
  const W = N % 2 === 0 ? N + 1 : N;
  const H = Math.max(5, Math.round(N * 0.85));
  const g = new PixelGrid(W, H);
  const cx = (W - 1) / 2;
  const cy = H / 2;
  const toPx = ([u, v]: Pt2): [number, number] => [cx + 0.5 + u * (W / 2), cy + v * (H / 2)];
  const fine = N >= 9;

  if (f === 2) {
    // Closed up over the back: the underside of the pair, a sail above the body, shaded to its base.
    const sail: Pt2[] = [[-0.08, 0.5], [-0.02, -0.95], [0.42, -0.6], [0.55, -0.1], [0.46, 0.5], [0.22, 0.78], [-0.06, 0.7]];
    if (st.leaf) sail.splice(1, 1, [0.06, -1]);
    const mask = new PixelGrid(W, H);
    mask.polygon(sail.map(toPx), 1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask.get(x, y)) continue;
        const v = (y - cy) / (H / 2);
        const rim = fine && (!mask.get(x + 1, y) || !mask.get(x, y - 1));
        g.set(x, y, rim ? under[1] : v > 0.25 ? under[1] : v < -0.4 ? under[3] : under[2]);
      }
    }
    if (fine && kind === 'blue') for (const [u, v] of [[0.2, -0.2], [0.3, 0.2], [0.12, 0.45]] as const) g.set(Math.floor(toPx([u, v])[0]), Math.floor(toPx([u, v])[1]), edge);
    if (fine && kind === 'monarch') for (let k = 0; k < 4; k++) g.set(Math.floor(toPx([0.05 + k * 0.1, -0.5 + k * 0.28])[0]), Math.floor(toPx([0.05 + k * 0.1, -0.5 + k * 0.28])[1]), edge);
    // The body along the base of the wings.
    for (let y = Math.floor(cy + H * 0.25); y < Math.min(H, Math.ceil(cy + H * 0.5)); y++) g.set(Math.floor(cx - 0.04 * W), y, body);
    return { grid: g, palette };
  }

  // Open (0), raised half way (1: narrower, the outer halves turned from the light), or swept down (3).
  const span = f === 1 ? 0.58 : 1;
  const tilt = f === 3 ? 0.32 : f === 1 ? -0.1 : 0;
  const place = ([u, v]: Pt2, side: number): Pt2 => {
    const c = Math.cos(tilt);
    const sn = Math.sin(tilt);
    return [side * (u * c - v * sn) * span, u * sn + v * c];
  };
  const fore = st.leaf ? [...FOREWING.slice(0, 3), LEAF_TIP, ...FOREWING.slice(4)] : FOREWING;
  const hind = st.leaf ? [...HINDWING.slice(0, 3), LEAF_TAIL, ...HINDWING.slice(4)] : HINDWING;
  const foreMask = new PixelGrid(W, H);
  const hindMask = new PixelGrid(W, H);
  for (const side of [-1, 1]) {
    foreMask.polygon(fore.map((p) => toPx(place(p, side))), 1);
    hindMask.polygon(hind.map((p) => toPx(place(p, side))), 1);
  }
  const inWing = (x: number, y: number) => foreMask.get(x, y) || hindMask.get(x, y);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const isFore = foreMask.get(x, y) !== 0;
      if (!isFore && !hindMask.get(x, y)) continue;
      const u = (x + 0.5 - cx - 0.5) / (W / 2);
      const v = (y + 0.5 - cy) / (H / 2);
      const out = Math.abs(u) / span;
      const border = fine && (!inWing(x - 1, y) || !inWing(x + 1, y) || !inWing(x, y - 1) || !inWing(x, y + 1));
      let c = out < 0.3 ? wing[2] : isFore ? wing[3] : wing[2];
      if (f === 1 && out > 0.55) c = wing[1];
      switch (kind) {
        case 'monarch':
          // The black border, white-spotted when there's room; small, just round the outer edge.
          if (border && (N >= 11 || out > 0.6)) c = N >= 11 && (x + y) % 3 === 0 ? pale : edge;
          else if (isFore && v < -0.62 && out > 0.55) c = edge;
          break;
        case 'white':
          if (isFore && v < -0.5 && out > 0.6) c = edge;
          else if (border) c = wing[1];
          break;
        case 'blue':
          if (border) c = v < -0.5 || out > 0.5 ? pale : edge;
          else if (out < 0.35) c = wing[1];
          break;
        case 'brimstone':
          if (border) c = wing[1];
          break;
      }
      g.set(x, y, c);
    }
  }
  if (fine) {
    for (const side of [-1, 1]) {
      const mark = (p: Pt2, color: number) => {
        const [x, y] = toPx(place(p, side));
        g.set(Math.floor(x), Math.floor(y), color);
      };
      if (kind === 'monarch') {
        // Black veins out from the body.
        for (const p of [[0.32, -0.36], [0.46, -0.28], [0.36, 0.3], [0.48, 0.18]] as const) mark(p, edge);
      } else if (kind === 'white') mark([0.55, -0.32], edge);
      else if (kind === 'brimstone') {
        mark([0.5, -0.4], orange);
        mark([0.38, 0.36], orange);
      }
    }
  }
  // The thin body, head and antennae.
  const bx = Math.floor(cx);
  for (let y = Math.floor(cy - H * 0.22); y < Math.ceil(cy + H * 0.3); y++) g.set(bx, y, body);
  const top = Math.floor(cy - H * 0.3);
  g.set(bx, top + 1, body);
  g.set(bx - 1, top, body);
  g.set(bx + 1, top, body);
  if (N >= 10) {
    g.set(bx - 1, top - 1, body);
    g.set(bx + 1, top - 1, body);
  }
  return { grid: g, palette };
}

// --- Woodpecker on a trunk ------------------------------------------------------

/**
 * A great spotted woodpecker clinging upright to bark, facing the trunk at
 * its right, `size` px tall: black back with a white shoulder patch, white
 * cheeks with a black moustache, a red nape and red under the tail, the
 * stiff tail braced on the bark. Frames: 0 head drawn back, 1 swinging in,
 * 2 striking the bark, 3 hitching up the trunk (tail lifted, body raised).
 */
export function drawWoodpeckerCling(frame: number, size: number): Drawn {
  const N = Math.max(5, Math.round(size));
  const W = Math.max(4, Math.round(N * 0.72));
  const g = new PixelGrid(W, N);
  const s = N / 16;
  const palette = new Palette();
  const black = palette.ramp(0x26242a);
  const white = palette.ramp(0xeeeae2, 0.5);
  const red = palette.ramp(0xc8282a);
  const beak = palette.add(0x3a3a40);
  const eyeInk = palette.add(0x0a0a0c);
  const f = ((frame % 4) + 4) % 4;
  const reach = [0, 0.6, 1.3, 0][f];
  const hitch = f === 3 ? -1 : 0;
  // Tail braced against the bark below (lifted as it hitches up).
  limb(g, [[3.4 * s, (10 + hitch) * s], [3.8 * s, (15.5 + hitch * 1.6) * s]], 1.8 * s, 1.2 * s, black, { bias: -0.5 });
  // Body, upright and leaning in to the trunk; white underparts showing at the front.
  shadedEllipse(g, 4.2 * s, (8.5 + hitch) * s, 2.6 * s, 4.4 * s, black, { dither: false, angle: -0.15 });
  if (N >= 8) {
    shadedEllipse(g, 5.4 * s, (8.4 + hitch) * s, 1 * s, 3 * s, white, { dither: false, max: 2 });
    shadedEllipse(g, 3.1 * s, (7.4 + hitch) * s, 1 * s, 2 * s, white, { dither: false, max: 3 });
    g.set(Math.floor(5.2 * s), Math.floor((12 + hitch) * s), red[2]);
  }
  // Head: drawn back, swinging in, or struck into the bark.
  const hx = 5.2 + reach;
  const hy = 3.4 + reach * 0.3 + hitch;
  shadedEllipse(g, hx * s, hy * s, 1.9 * s, 1.7 * s, black, { dither: false });
  if (N >= 8) {
    // White cheek, black moustache, red nape.
    g.set(Math.floor((hx + 0.2) * s), Math.floor((hy + 0.7) * s), white[3]);
    g.set(Math.floor((hx - 1.2) * s), Math.floor((hy - 0.4) * s), red[2]);
    if (N >= 12) {
      g.set(Math.floor((hx + 0.9) * s), Math.floor((hy + 0.6) * s), white[3]);
      g.set(Math.floor((hx - 1.3) * s), Math.floor((hy - 1) * s), red[1]);
    }
    g.set(Math.floor((hx + 0.6) * s), Math.floor((hy - 0.5) * s), eyeInk);
  }
  for (let k = 0; k < Math.max(1, Math.round(1.6 * s)); k++) g.set(Math.floor((hx + 1.8) * s) + k, Math.floor((hy + reach * 0.15) * s), beak);
  // Feet gripping the bark.
  g.set(Math.floor(6 * s), Math.floor((10.5 + hitch) * s), black[0]);
  if (N >= 12) selOut(g, palette, { bottomHeavy: false });
  return { grid: g, palette };
}

// --- Mushrooms ---------------------------------------------------------------

export type MushroomKind = 'fly-agaric' | 'bolete' | 'cluster';

/** A mushroom (or a little cluster) `size` px tall, pushing up through the leaf litter. */
export function drawMushroom(kind: MushroomKind, size: number): Drawn {
  const N = Math.max(3, Math.round(size));
  const W = kind === 'cluster' ? Math.round(N * 1.6) : Math.max(3, Math.round(N * 1.1));
  const g = new PixelGrid(W, N);
  const palette = new Palette();
  const stem = palette.ramp(0xeee4d0, 0.6);
  const cap: Ramp = palette.ramp(kind === 'fly-agaric' ? 0xd0302a : kind === 'bolete' ? 0x8a5a32 : 0xc8a068);
  const spot = palette.add(0xf8f4ea);
  const one = (cx: number, h: number, w: number) => {
    // Stem, then the cap over it.
    for (let y = Math.floor(N - h * 0.65); y < N; y++) for (let x = Math.floor(cx - w * 0.18); x <= Math.floor(cx + w * 0.18); x++) g.set(x, y, stem[x < cx ? 3 : 2]);
    shadedEllipse(g, cx, N - h * 0.68, w / 2, Math.max(0.8, h * 0.32), cap, { dither: false });
    if (kind === 'fly-agaric' && N >= 5) {
      g.set(Math.floor(cx - w * 0.2), Math.floor(N - h * 0.8), spot);
      g.set(Math.floor(cx + w * 0.15), Math.floor(N - h * 0.72), spot);
    }
  };
  if (kind === 'cluster') {
    one(W * 0.3, N * 0.75, N * 0.7);
    one(W * 0.62, N, N * 0.8);
    one(W * 0.85, N * 0.55, N * 0.5);
  } else one(W / 2, N, W);
  if (N >= 6) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}


// --- Hedgehog ----------------------------------------------------------------------

/** The hedgehog's four-beat shuffle. */
export const HEDGEHOG_SHUFFLE = 4;

/**
 * A hedgehog snuffling along, `size` px long and facing right: a dome of
 * spines swept back, streaked dark and pale-tipped, lit from above with
 * its top edge bristling; a pale furry face with a round ear, a bright
 * dark eye and a long snout ending in a wet black nose; and four short
 * legs shuffling through a four-beat walk (frames 0–3). Curled, it's a
 * bristling ball with just the tip of its snout tucked in. Authored 16 long.
 */
export function drawHedgehog(frame: number, size: number, curled = false): Drawn {
  const W = Math.max(5, Math.round(size));
  const H = Math.max(3, Math.round(W * 0.62));
  const g = new PixelGrid(W, H);
  const s = W / 16;
  const palette = new Palette();
  const spines = palette.ramp(0x7a5c42, 1);
  const tips = palette.add(0xe8dcc0);
  const face = palette.ramp(0xc8a886, 0.45);
  const nose = palette.add(0x140e0c);
  const glint = palette.add(0xf4ece0);
  const fine = W >= 12;
  /** The spines at a pixel inside a dome or ball: swept back, streaked dark, lit from the upper left, the rim pale-tipped. */
  const spine = (x: number, y: number, u: number, v: number, d: number) => {
    const lit = -u * 0.4 - v * 0.8;
    const base = lit > 0.35 ? 3 : lit > -0.1 ? 2 : 1;
    if (fine && (x * 2 + y) % 3 === 0 && pixelHash(x, y, 19) < 0.7) return spines[Math.max(0, base - 1)];
    if (pixelHash(x, y, 21) < (d > 0.85 ? 0.3 : 0.06) + Math.max(0, lit) * 0.12) return tips;
    return spines[base];
  };
  /** Bristles standing up off the top edge, every other pixel. */
  const bristle = () => {
    if (!fine) return;
    for (let x = 1; x < W - 1; x++) {
      let top = -1;
      for (let y = 0; y < H; y++) {
        if (g.get(x, y) === 0) continue;
        top = y;
        break;
      }
      if (top > 0 && x % 2 === 0 && [spines[1], spines[2], spines[3], tips, spines[0]].includes(g.get(x, top))) g.set(x - 1, top - 1, pixelHash(x, top, 23) < 0.5 ? tips : spines[1]);
    }
  };
  if (curled) {
    const r = Math.min(W * 0.36, H * 0.5);
    const cx = W / 2;
    const cy = H - r - 0.2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5 - cx) / r;
        const v = (y + 0.5 - cy) / r;
        const d = Math.hypot(u, v);
        if (d <= 1) g.set(x, y, spine(x, y, u, v, d));
      }
    }
    // The tip of its snout, tucked in at the front.
    g.set(Math.floor(cx + r * 0.5), Math.floor(cy + r * 0.6), face[2]);
    if (fine) g.set(Math.floor(cx + r * 0.5) + 1, Math.floor(cy + r * 0.6), nose);
    bristle();
    if (W >= 10) selOut(g, palette, { bottomHeavy: true });
    return { grid: g, palette };
  }
  const f = ((frame % HEDGEHOG_SHUFFLE) + HEDGEHOG_SHUFFLE) % HEDGEHOG_SHUFFLE;
  const ground = H - 1;
  // Four short legs in a shuffling walk: the far pair darker, behind.
  const swing = [0, 1, 0, -1][f];
  // Snuffling: the snout dips to the ground and lifts again through the beat.
  const sniff = [0.7, 0, -0.5, 0][f] * s;
  for (const [lx, far, phase] of [[4.2, true, 1], [10.8, true, -1], [5.4, false, -1], [12, false, 1]] as const) {
    const x = Math.floor((lx + swing * phase * 0.6) * s);
    const lift = swing * phase > 0 && W >= 14 ? 1 : 0;
    g.set(x, ground - lift, far ? face[0] : spines[0]);
    if (W >= 14) g.set(x, ground - 1 - lift, far ? face[0] : face[1]);
  }
  // The pale face and its long snout.
  const hx = 12 * s;
  const hy = H - 3.3 * s;
  shadedEllipse(g, hx, hy, Math.max(1, 2.9 * s), Math.max(1, 2.3 * s), face, { dither: false });
  limb(g, [[hx + 1.4 * s, hy + 0.2 * s], [15.3 * s, H - 2.2 * s + sniff]], Math.max(1, 2.4 * s), Math.max(1, 1 * s), face, { bias: 0.3 });
  // The dome of spines over its back.
  const dx = 7 * s;
  const dy = H - 2.4 * s;
  const rx = 7 * s;
  const ry = 6 * s;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5 - dx) / rx;
      const v = (y + 0.5 - dy) / ry;
      const d = Math.hypot(u, v);
      if (d > 1 || v > 0.3) continue;
      // The spines run forward over the brow, leaving the face clear.
      if (u > 0.72 && v > -0.25) continue;
      g.set(x, y, spine(x, y, u, v, d));
    }
  }
  bristle();
  if (W >= 10) selOut(g, palette, { bottomHeavy: true });
  // The round ear, bright eye and black nose, over the outline.
  if (W >= 12) g.set(Math.floor(hx - 0.8 * s), Math.floor(hy - 2.1 * s), face[1]);
  if (W >= 16) eye(g, hx + 0.9 * s, hy - 0.9 * s, 2, nose, glint);
  else if (W >= 8) g.set(Math.floor(hx + 0.9 * s), Math.floor(hy - 0.8 * s), nose);
  g.set(Math.min(W - 1, Math.floor(15.4 * s)), Math.min(H - 1, Math.floor(H - 2.4 * s + sniff)), nose);
  return { grid: g, palette };
}
