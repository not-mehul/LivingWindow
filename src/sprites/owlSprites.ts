import { eye, limb, Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';
import type { BirdPose } from './birdSprites';

/**
 * The tawny owl: perched face-on in the trees and on posts at night, side on
 * in flight, and dozing in the mouth of the oak's hollow. Drawn with the kit
 * at the size it's seen.
 */

type Pt = readonly [number, number];

interface OwlInk {
  tawny: Ramp;
  buff: Ramp;
  dark: Ramp;
  beak: Ramp;
  eye: number;
  glint: number;
}

function owlInk(palette: Palette): OwlInk {
  return {
    tawny: palette.ramp(0x9a6c42, 0.85),
    // Hand-picked, so its shadows stay a warm grey-brown rather than turning pink.
    buff: buffRamp(palette),
    dark: palette.ramp(0x4a3220, 0.8),
    beak: palette.ramp(0xb0a488, 0.6),
    eye: palette.add(0x120c08),
    glint: palette.add(0xfff4e0),
  };
}

function buffRamp(palette: Palette): Ramp {
  const ink = palette.add(0x3a2a1c);
  return [0x8a6c4c, 0xa88c68, 0xc6ac86, 0xdcc6a0, 0xece0c4].map((c) => palette.add(c, ink)) as unknown as Ramp;
}

/** How high the wings are through the owl's slow beat (1 raised … −1 down), for each flight pose. */
const WING_LIFT: Partial<Record<BirdPose, number>> = {
  'fly-up': 1,
  'fly-1': 1,
  'fly-2': 0.6,
  'takeoff-2': 0.8,
  'fly-mid': 0.15,
  'fly-3': 0.15,
  'fly-6': 0.4,
  'fly-down': -0.8,
  'fly-4': -0.8,
  'fly-5': -0.4,
  glide: 0.05,
  'flare-1': 0.9,
  'flare-2': 0.5,
};

/**
 * A tawny owl in a `size` box (authored at 48). Perched it faces us,
 * upright and round: a mottled tawny head with ear tufts, the pale facial
 * disk in two rims round dark eyes that catch the light, a small hooked
 * beak; a streaked buff breast between the folded wings, a row of pale
 * spots along each, and feathered feet. It breathes, blinks and dozes,
 * hoots with its white throat puffed, turns its head right round, leans to
 * peer down, and fluffs up. In the air it's side on, facing right: a big
 * round head with the disk turned towards us, a stout body, and broad,
 * rounded, barred wings beating slowly.
 */
export function drawOwl(pose: BirdPose, size: number): Drawn {
  const N = Math.max(6, Math.round(size));
  const g = new PixelGrid(N, N);
  const s = N / 48;
  const palette = new Palette();
  const ink = owlInk(palette);
  const lift = WING_LIFT[pose];
  if (lift !== undefined) drawOwlFlying(g, pose, lift, s, ink);
  else drawOwlPerched(g, pose, s, ink);
  if (N >= 14) selOut(g, palette, { bottomHeavy: lift === undefined });
  return { grid: g, palette };
}

function drawOwlPerched(g: PixelGrid, pose: BirdPose, s: number, ink: OwlInk): void {
  const N = g.width;
  let bob = 0;
  let lean = 0;
  let fluff = 0;
  let hoot = 0;
  let shut = false;
  let turned = false;
  let tilt = 0;
  switch (pose) {
    case 'idle-breathe':
      bob = 0.6;
      break;
    case 'blink':
      shut = true;
      break;
    case 'sleep':
      shut = true;
      fluff = 0.6;
      bob = 0.8;
      break;
    case 'fluff':
      fluff = 1;
      break;
    case 'look-back':
    case 'preen-1':
    case 'preen-2':
      turned = true;
      break;
    case 'tilt':
    case 'look-up':
      tilt = pose === 'tilt' ? 1.5 : 0;
      bob = pose === 'look-up' ? -0.8 : 0;
      break;
    case 'chirp':
      hoot = 1;
      break;
    case 'chirp-2':
    case 'peck-swallow':
      hoot = 0.6;
      break;
    case 'peck-reach':
      lean = 3;
      break;
    case 'peck-down':
      lean = 5;
      break;
    case 'hop':
    case 'hop-air':
      bob = -2.5;
      break;
    case 'hop-crouch':
    case 'hop-land':
    case 'takeoff-1':
      bob = 1.5;
      break;
  }
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const detail = N >= 16;

  // Feathered feet gripping the perch, talons dark.
  if (bob > -2) {
    for (const fx of [20.5, 27.5]) {
      shadedEllipse(g, fx * s, 45.6 * s, Math.max(1, 2 * s), Math.max(0.8, 1.2 * s), ink.buff, { dither: false });
      if (N >= 20) for (const dx of [-1, 0, 1]) g.set(Math.floor((fx + dx * 1.3) * s), N - 1, ink.dark[0]);
    }
  }

  // The body: round and upright, the folded wings down each side.
  const by = 31 + bob;
  const brx = 12 + fluff * 1.6;
  const bry = 13.5 + fluff;
  shadedEllipse(g, 24 * s, by * s, brx * s, bry * s, ink.tawny, { dither: N >= 30 });
  // The streaked buff breast.
  shadedEllipse(g, 24 * s, (by + 1.5) * s, (7.4 + fluff) * s, (10.8 + fluff * 0.5) * s, ink.buff, { dither: N >= 30, flat: 0.3 });
  if (detail) {
    const sx = Math.max(2, Math.round(2.6 * s));
    const sy = Math.max(2, Math.round(3.4 * s));
    for (let y = Math.floor((by - 7) * s); y < Math.ceil((by + 11) * s); y++) {
      for (let x = Math.floor(17 * s); x < Math.ceil(31 * s); x++) {
        const c = g.get(x, y);
        if (c !== ink.buff[1] && c !== ink.buff[2] && c !== ink.buff[3]) continue;
        if (x % sx === 0 && y % sy !== 0 && pixelHash(Math.floor(x / sx), Math.floor(y / sy), 5) < 0.4) g.set(x, y, ink.dark[2]);
      }
    }
  }
  for (const side of [-1, 1]) {
    const wx = 24 + side * (brx - 3.4);
    shadedEllipse(g, wx * s, (by + 0.5) * s, 4.4 * s, 11 * s, ink.tawny, { angle: -side * 0.12, bias: -0.6, dither: false });
    if (detail) {
      // The row of pale spots along the shoulder; the flight feathers darker below.
      for (let k = 0; k < 3; k++) g.set(Math.floor((wx - side * 0.6) * s), Math.floor((by - 7 + k * 3.2) * s), ink.buff[4]);
      for (let y = Math.floor((by + 4) * s); y < Math.ceil((by + 10.5) * s); y++) {
        const x = Math.floor((wx + side * 1.4) * s);
        if (g.get(x, y) !== 0 && y % 2 === 0) g.set(x, y, ink.dark[1]);
      }
    }
  }
  if (hoot > 0) shadedEllipse(g, 24 * s, (by - 10.5) * s, (3.2 + hoot * 1.6) * s, (2.2 + hoot) * s, ink.buff, { bias: 0.8, dither: false });

  // The head: big and round, a little forward when it leans to peer down.
  const hx = 24 + tilt * 0.4;
  const hy = 15 + bob + lean;
  const hr = 11.2;
  for (const side of [-1, 1]) limb(g, [P(hx + side * 5.6, hy - 6.5), P(hx + side * (8.4 + tilt * side * 0.4), hy - 12)], 3 * s, 0.7 * s, ink.tawny, { bias: -0.3 });
  shadedEllipse(g, hx * s, hy * s, hr * s, (hr * 0.9) * s, ink.tawny, { dither: N >= 30 });
  if (detail) {
    // Mottled crown.
    for (let y = Math.floor((hy - hr) * s); y < Math.ceil((hy - 3) * s); y++) {
      for (let x = Math.floor((hx - hr) * s); x < Math.ceil((hx + hr) * s); x++) {
        if (g.get(x, y) !== 0 && pixelHash(x, y, 13) < 0.2) g.set(x, y, turned ? ink.buff[3] : ink.dark[2]);
      }
    }
  }
  if (turned) {
    // Head swivelled right round: the back of it, a dark stripe down the crown.
    for (let y = Math.floor((hy - hr * 0.8) * s); y < Math.ceil((hy + hr * 0.6) * s); y++) if (g.get(Math.floor(hx * s), y) !== 0) g.set(Math.floor(hx * s), y, ink.dark[1]);
    return;
  }

  // The facial disk: two pale rounds about the eyes, rimmed dark, with pale brows meeting over the beak.
  const ex = 4.6;
  const disk = (x: number, y: number) => {
    const px = (x + 0.5) / s;
    const py = (y + 0.5) / s;
    return Math.min(Math.hypot((px - (hx - ex)) / 5.6, (py - (hy + 0.6)) / 5.8), Math.hypot((px - (hx + ex)) / 5.6, (py - (hy + 0.6)) / 5.8));
  };
  for (let y = Math.floor((hy - 6) * s); y <= Math.ceil((hy + 7) * s); y++) {
    for (let x = Math.floor((hx - 11) * s); x <= Math.ceil((hx + 11) * s); x++) {
      const d = disk(x, y);
      if (d > 1) continue;
      const rim = N >= 18 && [disk(x - 1, y), disk(x + 1, y), disk(x, y + 1)].some((n) => n > 1);
      g.set(x, y, rim ? ink.dark[1] : d < 0.55 ? ink.buff[3] : ink.buff[2]);
    }
  }
  if (N >= 22) limb(g, [P(hx - 3.6, hy - 3.6), P(hx, hy - 1), P(hx + 3.6, hy - 3.6)], 1.2 * s, 1.2 * s, ink.buff, { bias: 1.5 });

  // Eyes: dark and deep, catching the light; shut, a curved lid line.
  for (const side of [-1, 1]) {
    const x = (hx + side * ex) * s;
    const y = (hy + 0.2) * s;
    if (shut) {
      const w = Math.max(1, Math.round(1.8 * s));
      for (let k = -w; k <= w; k++) g.set(Math.floor(x + k), Math.floor(y) + (Math.abs(k) === w ? 0 : 1), ink.dark[0]);
    } else if (N >= 24) {
      eye(g, x + 0.5, y + 0.5, 3, ink.eye, ink.glint);
      if (N >= 34) g.set(Math.floor(x) + 1, Math.floor(y), ink.eye);
    } else eye(g, x, y - 0.5, N >= 14 ? 2 : 1, ink.eye, ink.glint);
  }
  // The small hooked beak.
  limb(g, [P(hx, hy + 2.6), P(hx + 0.3, hy + 5.4)], Math.max(1, 1.8 * s), Math.max(1, 0.7 * s), ink.beak, { bias: 0.4 });
}

function drawOwlFlying(g: PixelGrid, pose: BirdPose, lift: number, s: number, ink: OwlInk): void {
  const N = g.width;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const flare = pose.startsWith('flare');
  const shoulder: Pt = [24, 22];
  const reach = 1 - Math.abs(lift) * 0.12;
  /** The broad rounded wing, out to its tip, as a mask: dx, dy shift it (the far wing sits behind). */
  const wingMask = (dx: number, dy: number) => {
    const mask = new PixelGrid(N, N);
    const tip: Pt = [shoulder[0] - 19 * reach + (flare ? 6 : 0) + dx, shoulder[1] - lift * 19 + dy];
    const bend: Pt = [shoulder[0] - 2 + (flare ? 3 : 0) + dx, shoulder[1] - lift * 11 - 1 + dy];
    const trail: Pt = [shoulder[0] - 12 * reach + dx, shoulder[1] - lift * 10 + (lift >= 0 ? 8 : -8) + dy];
    mask.polygon(
      [P(shoulder[0] + 3 + dx, shoulder[1] - 1 + dy), P(bend[0], bend[1]), P(tip[0] + 2, tip[1] + (lift >= 0 ? 1 : -1)), P(tip[0], tip[1]), P(tip[0] - 1, tip[1] + (lift >= 0 ? 4 : -4)), P(trail[0], trail[1]), P(shoulder[0] - 5 + dx, shoulder[1] + 3 + dy)],
      1,
    );
    return { mask, tip };
  };
  const paint = (dx: number, dy: number, far: boolean) => {
    const { mask, tip } = wingMask(dx, dy);
    const len = Math.hypot(tip[0] - shoulder[0] - dx, tip[1] - shoulder[1] - dy) * s || 1;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!mask.get(x, y)) continue;
        if (far) {
          g.set(x, y, ink.dark[1]);
          continue;
        }
        const t = ((x + 0.5 - (shoulder[0] + dx) * s) * (tip[0] - shoulder[0] - dx) * s + (y + 0.5 - (shoulder[1] + dy) * s) * (tip[1] - shoulder[1] - dy) * s) / (len * len);
        const edge = !mask.get(x + 1, y) || !mask.get(x, lift >= 0 ? y - 1 : y + 1);
        // Bars across the flight feathers out towards the tip.
        const bar = t > 0.4 && N >= 14 && Math.floor(t * (N >= 26 ? 9 : 6)) % 2 === 0;
        g.set(x, y, edge ? ink.tawny[4] : bar ? ink.dark[2] : t < 0.3 ? ink.tawny[3] : ink.tawny[2]);
      }
    }
  };
  paint(-2, -1.5, true);
  // The short tail, barred, and the stout body with its pale streaked belly.
  limb(g, [P(15, 25), P(8, flare ? 30 : 26.5)], 5 * s, (flare ? 6 : 4) * s, ink.tawny, { bias: -0.3 });
  shadedEllipse(g, 22 * s, 26 * s, 10 * s, 6 * s, ink.tawny, { angle: flare ? -0.5 : -0.08, dither: false });
  shadedEllipse(g, 23 * s, 28 * s, 7 * s, 3.4 * s, ink.buff, { angle: flare ? -0.5 : -0.08, dither: false, flat: 0.3 });
  if (flare) {
    // Feathered legs thrown forward, talons spread to land.
    limb(g, [P(25, 29), P(30, 35)], Math.max(1, 2.2 * s), Math.max(1, 1.4 * s), ink.buff);
    if (N >= 18) for (const k of [-1, 0, 1]) g.set(Math.floor((30.5 + k) * s), Math.floor(35.5 * s) + (k === 0 ? 1 : 0), ink.dark[0]);
  }
  // The big round head, the disk turned towards us.
  const hx = 33;
  const hy = 21;
  shadedEllipse(g, hx * s, hy * s, 7.2 * s, 6.6 * s, ink.tawny, { dither: false });
  shadedEllipse(g, (hx + 1.8) * s, (hy + 0.8) * s, 4.4 * s, 4.8 * s, ink.buff, { dither: false, flat: 0.4 });
  if (N >= 18) {
    // The disk's dark rim along its back edge.
    for (let y = Math.floor((hy - 3.4) * s); y <= Math.ceil((hy + 4.8) * s); y++) {
      for (let x = Math.floor((hx - 3) * s); x <= Math.ceil((hx + 2) * s); x++) {
        const c = g.get(x, y);
        if ((c === ink.buff[1] || c === ink.buff[2] || c === ink.buff[3]) && g.get(x - 1, y) !== 0 && !ink.buff.includes(g.get(x - 1, y))) g.set(x, y, ink.dark[1]);
      }
    }
  }
  eye(g, (hx + 2.8) * s, (hy - 0.2) * s, N >= 30 ? 3 : N >= 16 ? 2 : 1, ink.eye, ink.glint);
  limb(g, [P(hx + 5.6, hy + 1.6), P(hx + 6.4, hy + 3.4)], Math.max(1, 1.4 * s), Math.max(1, 0.6 * s), ink.beak);
  paint(0, 0, false);
}

/** The owl in the oak's hollow: dozing, one eye open, wide awake, looking left or right, or out (an empty hole). */
export type HollowFace = 'sleep' | 'blink' | 'awake' | 'look-l' | 'look-r' | 'empty';

/**
 * The hole's mouth with the owl in it, `r` px across its half-width: the dark
 * of the hollow, deepest at the top; the owl's round tawny head filling it,
 * lit from outside, with its two-rimmed pale facial disk, tapered ear tufts,
 * pale brows and hooked beak; its breast streaked below. Its eyes are shut
 * lids while it dozes, one opens now and then, both wide and gleaming when
 * it's awake, and the head (disk and all) turns to look left or right.
 * `empty` is just the dark hole. The box is (2r+1) × (2r+5).
 */
export function drawOwlInHollow(r: number, face: HollowFace): Drawn {
  const ry = r + 2;
  const W = r * 2 + 1;
  const H = ry * 2 + 1;
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const ink = owlInk(palette);
  const hollow = palette.ramp(0x241812, 0.7);
  const cx = r;
  const cy = ry;
  const inside = (x: number, y: number) => ((y - cy) / ry) ** 2 + ((x - cx) / r) ** 2 < 0.72;
  // The dark of the hollow: blackest up under the lip, a little light reaching the bottom.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) g.set(x, y, y < cy - 1 ? hollow[0] : y < cy + 3 ? hollow[1] : hollow[2]);
  if (face === 'empty') return { grid: g, palette };
  const turn = face === 'look-l' ? -1 : face === 'look-r' ? 1 : 0;
  const clip = (draw: (sub: PixelGrid) => void) => {
    const sub = new PixelGrid(W, H);
    draw(sub);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y) && sub.get(x, y)) g.set(x, y, sub.get(x, y));
  };
  // The breast at the bottom of the hole, streaked.
  clip((sub) => {
    shadedEllipse(sub, cx, H - 1, r * 0.8, 4, ink.buff, { dither: false, bias: -0.4 });
    for (let y = cy + 3; y < H; y++) for (let x = 0; x < W; x++) if (sub.get(x, y) && x % 2 === 0 && pixelHash(x, y >> 1, 5) < 0.45) sub.set(x, y, ink.dark[2]);
  });
  // The round head filling the hole, lit from outside.
  const hx = cx + turn * 0.8;
  const hy = cy + 0.6;
  const hr = Math.max(3, r * 0.7);
  clip((sub) => {
    for (const side of [-1, 1]) limb(sub, [[hx + side * hr * 0.5, hy - hr * 0.6], [hx + side * hr * 0.75 + turn * 0.4, hy - hr * 1.1]], 2.2, 0.8, ink.tawny, { bias: -0.4 });
    shadedEllipse(sub, hx, hy, hr, hr * 0.92, ink.tawny, { dither: false, bias: 0.3 });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sub.get(x, y) && y < hy - hr * 0.4 && pixelHash(x, y, 13) < 0.22) sub.set(x, y, ink.dark[2]);
    // The facial disk: two pale rounds about the eyes, rimmed dark.
    const dx = hr * 0.42;
    const dr = hr * 0.5;
    const ox = hx + turn * 0.7;
    const disk = (x: number, y: number) => Math.min(Math.hypot(x + 0.5 - (ox - dx), y + 0.5 - (hy + 0.6)), Math.hypot(x + 0.5 - (ox + dx), y + 0.5 - (hy + 0.6))) / dr;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = disk(x, y);
        if (d > 1 || !sub.get(x, y)) continue;
        const rim = [disk(x - 1, y), disk(x + 1, y), disk(x, y + 1)].some((n) => n > 1);
        sub.set(x, y, rim ? ink.dark[1] : d < 0.5 ? ink.buff[3] : ink.buff[2]);
      }
    }
    // Eyes and beak.
    const ey = Math.round(hy);
    for (const [i, side] of [
      [0, -1],
      [1, 1],
    ] as const) {
      const ex = Math.round(ox + side * dx - 0.5);
      const open = face === 'awake' || face === 'look-l' || face === 'look-r' || (face === 'blink' && i === 1);
      if (open) {
        sub.rect(ex, ey - 1, 2, 2, ink.eye);
        sub.set(ex + (turn > 0 ? 1 : 0), ey - 1, ink.glint);
      } else {
        // Shut: the curved line of the lid.
        sub.set(ex - 1, ey - 1, ink.dark[1]);
        sub.set(ex, ey, ink.dark[0]);
        sub.set(ex + 1, ey - 1, ink.dark[1]);
      }
    }
    sub.set(Math.round(ox - 0.5), ey + 2, ink.beak[3]);
    sub.set(Math.round(ox - 0.5), ey + 3, ink.beak[1]);
  });
  return { grid: g, palette };
}
