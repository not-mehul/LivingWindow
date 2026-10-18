import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { limb, Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

type Pt = readonly [number, number];

// --- Deer ---------------------------------------------------------------

export type DeerPose =
  | 'walk-1'
  | 'walk-2'
  | 'walk-3'
  | 'walk-4'
  | 'walk-5'
  | 'walk-6'
  | 'graze-1'
  | 'graze-2'
  | 'graze-3'
  | 'stand'
  | 'stand-flick'
  | 'alert'
  | 'bound-1'
  | 'bound-2';
/** A six-beat walk: each leg swings through in turn, smoothly. */
export const DEER_WALK: readonly DeerPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6'];
export type DeerKind = 'doe' | 'buck' | 'fawn' | 'roe' | 'elk';

const DEER_COATS: Record<DeerKind, { coat: number; belly: number; antlers: boolean }> = {
  doe: { coat: 0xa8784a, belly: 0xe8d8c0, antlers: false },
  buck: { coat: 0x9a6a40, belly: 0xe8d8c0, antlers: true },
  fawn: { coat: 0xb8804a, belly: 0xeedcc4, antlers: false },
  roe: { coat: 0xb0663a, belly: 0xe0d0b8, antlers: false },
  elk: { coat: 0x8a6a48, belly: 0xc8b090, antlers: true },
};

/** One leg's joints, from the body down to the hoof (authored units, before scaling). */
type Leg = [Pt, Pt, Pt, Pt];

/**
 * A deer in profile, facing right, in an (N·1.4)×N box with hooves on the
 * bottom row: a shaded body with a pale belly and throat, long jointed legs
 * (a hock on the hind legs, a knee on the front), big ears, a dark nose, a
 * white tail that flags up when it's alarmed, spots on a fawn and branching
 * antlers on a buck. Authored in a 70×50 box (more headroom for antlers).
 */
export function drawDeerSized(kind: DeerKind, pose: DeerPose, height: number): Drawn {
  const H = Math.max(6, Math.round(height));
  const width = Math.round(H * 1.4);
  const g = new PixelGrid(width, H);
  const style = DEER_COATS[kind];
  const headroom = style.antlers ? 10 : 0;
  const s = H / (50 + headroom);
  const P = (x: number, y: number): Pt => [x * s, (y + headroom) * s];
  const palette = new Palette();
  const fur = palette.ramp(style.coat);
  const pale = palette.ramp(style.belly, 0.6);
  const dark = palette.ramp(0x3a2a20);
  const antler = palette.ramp(0xd8c8a0, 0.8);
  const eyeInk = palette.add(0x0c0808);
  const rump = palette.ramp(0xe0d6c0, 0.25);
  const mane = palette.ramp(0x3e2a1c, 0.7);
  const detailed = H >= 18;

  const walking = pose.startsWith('walk');
  const bounding = pose.startsWith('bound');
  const grazing = pose.startsWith('graze');
  const alert = pose === 'alert';
  const phase = walking ? (Number(pose.slice(-1)) - 1) * ((Math.PI * 2) / 6) : 0;
  const flick = pose === 'stand-flick';
  const chewing = pose === 'graze-3';
  const elk = kind === 'elk';
  // A walk bobs the body a touch as the weight shifts.
  const bodyY = bounding ? (pose === 'bound-1' ? 19 : 16) : 22 + (walking ? Math.abs(Math.sin(phase)) * 0.6 : 0);
  const tilt = bounding ? (pose === 'bound-1' ? -0.12 : 0.1) : 0;

  // Legs: the far pair a step out of phase and in shadow.
  const hind = (o: number, dx: number): Leg => {
    if (bounding) {
      return pose === 'bound-1'
        ? [P(20 + dx, bodyY + 4), P(15 + dx, bodyY + 10), P(8 + dx, bodyY + 15), P(3 + dx, bodyY + 17)]
        : [P(20 + dx, bodyY + 4), P(25 + dx, bodyY + 10), P(19 + dx, bodyY + 15), P(22 + dx, bodyY + 21)];
    }
    const sw = walking ? Math.sin(phase + o) * 4 : 0;
    const lift = walking ? Math.max(0, Math.cos(phase + o)) * 2 : 0;
    return [P(20 + dx, bodyY + 4), P(23 + dx + sw * 0.3, bodyY + 11), P(17 + dx + sw * 0.7, 39 - lift), P(18 + dx + sw, 49 - lift * 0.6)];
  };
  const front = (o: number, dx: number): Leg => {
    if (bounding) {
      return pose === 'bound-1'
        ? [P(46 + dx, bodyY + 4), P(52 + dx, bodyY + 9), P(58 + dx, bodyY + 12), P(64 + dx, bodyY + 13)]
        : [P(46 + dx, bodyY + 4), P(48 + dx, bodyY + 11), P(44 + dx, bodyY + 15), P(47 + dx, bodyY + 19)];
    }
    const sw = walking ? Math.sin(phase + o) * 4 : 0;
    const lift = walking ? Math.max(0, Math.cos(phase + o)) * 2.5 : 0;
    return [P(46 + dx, bodyY + 4), P(45 + dx + sw * 0.3, bodyY + 11), P(46 + dx + sw * 0.8, 40 - lift), P(46 + dx + sw, 49 - lift * 0.6)];
  };
  const drawLeg = (leg: Leg, far: boolean) => {
    const bias = far ? -1.2 : 0;
    const w = Math.max(1, 2.2 * s);
    limb(g, [leg[0], leg[1]], w * 2.2, w * 1.4, fur, { bias });
    limb(g, [leg[1], leg[2]], w * 1.3, w, fur, { bias });
    limb(g, [leg[2], leg[3]], w, w * 0.9, fur, { bias: bias - 0.3 });
    // A dark hoof.
    g.set(Math.floor(leg[3][0]), Math.min(H - 1, Math.floor(leg[3][1])), dark[far ? 0 : 1]);
    if (w >= 1.5) g.set(Math.floor(leg[3][0]) + 1, Math.min(H - 1, Math.floor(leg[3][1])), dark[0]);
  };
  drawLeg(hind(Math.PI, 3), true);
  drawLeg(front(0, 3), true);

  // Body: haunch, barrel, chest; tipped in a leap.
  const Y = (y: number) => (y + headroom) * s;
  shadedEllipse(g, 20 * s, Y(bodyY - 1), 8.5 * s, 8.5 * s, fur, { dither: false, min: 1 });
  shadedEllipse(g, 33 * s, Y(bodyY), 16 * s, 7.5 * s, fur, { dither: false, angle: tilt, min: 1 });
  shadedEllipse(g, 45 * s, Y(bodyY - 1), elk ? 8.5 * s : 7 * s, elk ? 9.5 * s : 8 * s, fur, { dither: false, min: 1 });
  // An elk's pale rump.
  if (elk && detailed) shadedEllipse(g, 15.5 * s, Y(bodyY - 2), 4 * s, 5 * s, rump, { dither: false, max: 3 });
  // Pale belly along the underside.
  if (detailed) {
    shadedEllipse(g, 33 * s, Y(bodyY + 5.5), 12 * s, 2 * s, pale, { dither: false, angle: tilt, max: 2 });
  }
  // Fawn spots along the back.
  if (kind === 'fawn' && detailed) {
    for (let y = Math.floor(Y(bodyY - 6)); y <= Math.floor(Y(bodyY + 1)); y++) {
      for (let x = Math.floor(16 * s); x <= Math.floor(46 * s); x++) {
        const c = g.get(x, y);
        if (c && fur.includes(c) && pixelHash(Math.floor(x / Math.max(1, s * 2.5)), Math.floor(y / Math.max(1, s * 2.5)), 31) < 0.22) g.set(x, y, pale[3]);
      }
    }
  }
  // Tail: flagged up white when alarmed, otherwise down and dark-tipped.
  if (alert || bounding) {
    limb(g, [P(13, bodyY - 5), P(10, bodyY - 11)], 3.4 * s, 4 * s, pale, { max: 3 });
  } else if (flick) {
    // A flick of the tail at the flies.
    limb(g, [P(13.5, bodyY - 5), P(9.5, bodyY - 3)], 3 * s, 2.6 * s, fur, { bias: -0.4 });
  } else {
    limb(g, [P(13.5, bodyY - 5), P(12, bodyY + 1)], 3 * s, 2.6 * s, fur, { bias: -0.4 });
  }
  // Near legs.
  drawLeg(hind(0, 0), false);
  drawLeg(front(Math.PI, 0), false);

  // Neck and head.
  let head: Pt;
  let headAngle: number;
  if (chewing) {
    // Head half raised from the grass, chewing, looking about.
    head = [59, 27];
    headAngle = 0.85;
    limb(g, [P(45, bodyY - 3), P(53, bodyY + 1), P(57, head[1] - 3)], 8 * s, 5 * s, fur);
  } else if (grazing) {
    head = [61, pose === 'graze-1' ? 41 : 42.5];
    headAngle = 1.25;
    limb(g, [P(46, bodyY - 3), P(54, bodyY + 6), P(59, head[1] - 4)], 7 * s, 4.5 * s, fur);
  } else {
    head = alert ? [55, 5] : bounding ? [59, bodyY - 10] : [55, 10];
    headAngle = alert ? 0.45 : 0.3;
    limb(g, [P(44, bodyY - 3), P(head[0] - 3, head[1] + 3)], 10 * s, 6 * s, fur);
    // A pale throat patch, or an elk's shaggy dark mane down the neck.
    if (elk) limb(g, [P(head[0] - 3, head[1] + 2.5), P(46.5, bodyY + 3)], 7 * s, 9 * s, mane, { bias: 0.3 });
    else if (detailed) limb(g, [P(head[0] - 1.5, head[1] + 4), P(head[0] - 2, head[1] + 5.5)], 2.2 * s, 2 * s, pale, { max: 3 });
  }
  const [hx, hy] = head;
  // Ears: big, the far one in shade.
  const earBase = grazing ? P(hx - 2, hy - 3) : P(hx - 2.5, hy - 2.5);
  // Ears up (or one turned back, flicking).
  const earTip = (dx: number, dy: number): Pt => (grazing ? P(hx - 5.5 + dx, hy - 4.5 + dy) : flick ? P(hx - 7.5 + dx, hy - 3.5 + dy) : P(hx - 6 + dx, hy - 6.5 + dy));
  limb(g, [earBase, earTip(-1.5, 0.8)], 3.4 * s, 2.2 * s, fur, { bias: -1.2 });
  // The head, tapering to the muzzle.
  shadedEllipse(g, hx * s, Y(hy), 5 * s, 3.8 * s, fur, { dither: false, angle: headAngle, min: 1 });
  const mx = hx + Math.cos(headAngle) * 4.2;
  const my = hy + Math.sin(headAngle) * 4.2;
  shadedEllipse(g, mx * s, Y(my), 2.6 * s, 2 * s, fur, { dither: false, angle: headAngle, bias: 0.4 });
  // Nose.
  const nx = hx + Math.cos(headAngle) * 6.2;
  const ny = hy + Math.sin(headAngle) * 6.2;
  g.set(Math.floor(nx * s), Math.floor(Y(ny)), dark[1]);
  limb(g, [earBase, earTip(0, 0)], 3.6 * s, 2.4 * s, fur, { bias: 0.2 });
  if (detailed) {
    // Eye, and a pale ring round the muzzle.
    g.set(Math.floor((hx + 0.6) * s), Math.floor(Y(hy - 0.8 + (grazing ? 1 : 0))), eyeInk);
    g.set(Math.floor((mx - 0.5) * s), Math.floor(Y(my + 1.2)), pale[2]);
  }
  // Antlers on a buck (and an elk's broad, many-tined rack), turned with the head when it's down.
  if (style.antlers) {
    const ax = hx - 1.5;
    const ay = hy - 3;
    const big = elk ? 1.6 : 1;
    const w = Math.max(1, (elk ? 1.6 : 1.3) * s);
    // The rack tips forward a little as the head goes down, but stays up over it.
    const turn = (headAngle - 0.3) * 0.4;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const A = (dx: number, dy: number): Pt => P(ax + (dx * cos - dy * sin) * big, ay + (dx * sin + dy * cos) * big);
    limb(g, [A(0, 0), A(-3, -6), A(-2, -11), A(1, -14)], w * 1.3, w, antler, { max: 4 });
    limb(g, [A(-2.4, -4), A(2, -7)], w, w * 0.8, antler);
    limb(g, [A(-2.6, -9), A(1.5, -11)], w, w * 0.8, antler);
    limb(g, [A(-2.8, -8), A(-7, -10)], w, w * 0.8, antler, { bias: -1 });
    if (elk) {
      // More tines sweeping back off the beam.
      limb(g, [A(-3, -6), A(-7.5, -6.5)], w, w * 0.7, antler, { bias: -1 });
      limb(g, [A(-1.5, -12.5), A(-4.5, -15)], w, w * 0.7, antler, { bias: -0.6 });
    }
  }
  if (detailed) selOut(g, palette, { bottomHeavy: H < 26 });
  return { grid: g, palette };
}

export class DeerSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(kind: DeerKind, pose: DeerPose, height: number): Texture {
    const key = `${kind}:${pose}:${height}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawDeerSized(kind, pose, height);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
  }
}

// --- Squirrel -----------------------------------------------------------

export type SquirrelPose = 'run-1' | 'run-2' | 'run-3' | 'run-4' | 'sit' | 'nibble' | 'climb-1' | 'climb-2' | 'climb-3' | 'climb-4' | 'cling' | 'cling-flick';
export const SQUIRREL_RUN: readonly SquirrelPose[] = ['run-1', 'run-2', 'run-3', 'run-4'];
export const SQUIRREL_CLIMB: readonly SquirrelPose[] = ['climb-1', 'climb-2', 'climb-3', 'climb-4'];
/** Where in its four-beat cycle a run or climb frame is (-1..1), 0 for anything else. */
const beat = (pose: SquirrelPose) => {
  const n = Number(pose.slice(-1));
  return Number.isNaN(n) ? 0 : Math.sin(((n - 1) * Math.PI) / 2 + Math.PI / 2);
};
export type SquirrelCoat = 'red' | 'grey';

const SQUIRREL_COATS: Record<SquirrelCoat, { coat: number; belly: number }> = {
  red: { coat: 0xb4602a, belly: 0xf0e0c8 },
  grey: { coat: 0x8a8a92, belly: 0xeeeae4 },
};

/** The big bushy tail along a curve: thick in the middle, lighter at its fringe. */
function bushyTail(g: PixelGrid, points: Pt[], width: number, fur: Ramp): void {
  limb(g, points, width * 0.7, width * 0.9, fur, { bias: 0.4 });
  // Fluff: a lit fringe on the outside of the curve.
  limb(g, points.slice(1), width * 0.45, width * 0.55, fur, { bias: 1.4, max: 4 });
}

/**
 * A squirrel in an N×N box. Running and sitting face right with feet on the
 * bottom row; climbing poses face up a trunk (head at the top). Small ones
 * keep the silhouette that says "squirrel": the tail curled up in an S
 * behind and the tufted ears.
 */
export function drawSquirrelSized(coat: SquirrelCoat, pose: SquirrelPose, size: number): Drawn {
  const N = Math.max(5, Math.round(size));
  const g = new PixelGrid(N, N);
  const s = N / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const style = SQUIRREL_COATS[coat];
  const palette = new Palette();
  const fur = palette.ramp(style.coat);
  const belly = palette.ramp(style.belly, 0.6);
  const nut = palette.ramp(0x8a5a3a);
  const eyeInk = palette.add(0x100808);
  const detailed = N >= 12;
  const tw = Math.max(1.6, 6.5 * s);

  if (pose.startsWith('climb') || pose.startsWith('cling')) {
    // Head-up on a trunk: the tail hanging below and flicking out.
    const reach = pose.startsWith('climb') ? beat(pose) * 1.6 : 0;
    const flickOut = pose === 'cling-flick' ? 4 : 0;
    bushyTail(g, [P(12, 15), P(10.5 - flickOut * 0.4, 19), P(12 + reach - flickOut, 22.5 - flickOut * 0.6), P(15 + reach - flickOut * 1.5, 23 - flickOut)], tw, fur);
    shadedEllipse(g, 12 * s, 12 * s, 4 * s, 6.5 * s, fur, { dither: false });
    if (detailed) shadedEllipse(g, 13.2 * s, 13 * s, 2 * s, 4.5 * s, belly, { dither: false, max: 3 });
    for (const [x, y] of [[8, 9 + reach], [16, 9 - reach], [8.5, 16 - reach], [15.5, 16 + reach]] as const) {
      limb(g, [P(12 + (x - 12) * 0.4, y), P(x, y + 1)], Math.max(1, 1.5 * s), Math.max(1, 1.2 * s), fur, { bias: -0.5 });
    }
    shadedEllipse(g, 12 * s, 5 * s, 3.3 * s, 3 * s, fur, { dither: false });
    // Tufted ears.
    limb(g, [P(10.2, 3), P(9.6, 0.2)], Math.max(1, 1.6 * s), Math.max(1, 0.8 * s), fur, { bias: -0.3 });
    limb(g, [P(13.8, 3), P(14.4, 0.2)], Math.max(1, 1.6 * s), Math.max(1, 0.8 * s), fur);
    if (detailed) {
      g.set(Math.floor(10.6 * s), Math.floor(4.6 * s), eyeInk);
      g.set(Math.floor(13.4 * s), Math.floor(4.6 * s), eyeInk);
    }
  } else {
    const sitting = pose === 'sit' || pose === 'nibble';
    // A bounding gallop: hind legs reach forward under it, then it stretches out.
    const stride = pose.startsWith('run') ? beat(pose) : 0;
    if (sitting) {
      // Sitting up, the tail an S curling up its back.
      bushyTail(g, [P(9, 21), P(4, 18), P(4, 11), P(7, 6), P(5, 2.5)], tw * 1.05, fur);
      shadedEllipse(g, 12.5 * s, 16 * s, 5 * s, 6.8 * s, fur, { dither: false, angle: -0.15 });
      if (detailed) shadedEllipse(g, 15 * s, 16.5 * s, 2.4 * s, 5 * s, belly, { dither: false, angle: -0.15, max: 3 });
      // Haunch and hind foot.
      shadedEllipse(g, 11 * s, 19.5 * s, 4 * s, 3.5 * s, fur, { dither: false, bias: -0.2 });
      limb(g, [P(10, 23), P(16, 23.2)], Math.max(1, 1.4 * s), Math.max(1, 1.2 * s), fur, { bias: -0.6 });
      shadedEllipse(g, 15 * s, 8 * s, 3.8 * s, 3.3 * s, fur, { dither: false });
      limb(g, [P(13.6, 6), P(13.2, 2.6)], Math.max(1, 1.8 * s), Math.max(1, 0.9 * s), fur);
      // Paws at the mouth, holding a nut when nibbling.
      limb(g, [P(15.5, 13), P(18, 11.5)], Math.max(1, 1.4 * s), Math.max(1, 1.3 * s), fur, { bias: 0.4 });
      if (pose === 'nibble') shadedEllipse(g, 19 * s, 10.5 * s, Math.max(0.6, 1.3 * s), Math.max(0.6, 1.3 * s), nut, { dither: false });
      if (detailed) g.set(Math.floor(16.2 * s), Math.floor(7.5 * s), eyeInk);
    } else {
      // Bounding along, the tail streaming up and back.
      bushyTail(g, [P(8, 15), P(4, 12), P(3, 7), P(6, 4)], tw, fur);
      limb(g, [P(10, 17), P(7 + stride * 3, 23)], Math.max(1, 2.2 * s), Math.max(1, 1.2 * s), fur, { bias: -0.8 });
      shadedEllipse(g, 14 * s, 16 * s, 6.5 * s, 4 * s, fur, { dither: false, angle: -0.1 * stride });
      if (detailed) shadedEllipse(g, 14.5 * s, 18.4 * s, 4.5 * s, 1.4 * s, belly, { dither: false, max: 3 });
      limb(g, [P(18, 18), P(19 - stride * 3, 23)], Math.max(1, 1.6 * s), Math.max(1, 1.2 * s), fur);
      shadedEllipse(g, 20 * s, 13 * s, 3.2 * s, 2.8 * s, fur, { dither: false });
      limb(g, [P(18.8, 11), P(18.6, 7.8)], Math.max(1, 1.7 * s), Math.max(1, 0.8 * s), fur);
      if (detailed) g.set(Math.floor(21 * s), Math.floor(12.5 * s), eyeInk);
    }
  }
  if (detailed) selOut(g, palette, { bottomHeavy: N < 16 });
  return { grid: g, palette };
}

export class SquirrelSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: SquirrelCoat, pose: SquirrelPose, size: number): Texture {
    const key = `${coat}:${pose}:${size}`;
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = drawSquirrelSized(coat, pose, size);
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
  }
}
