import { limb, Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid } from './raster';

/**
 * Street traffic, seen from up the street: everything moves along it, so
 * we see it coming (front) or going (back). Each drawing also says where its
 * lamps are, so the street can light them after dark.
 */

export type VehicleFacing = 'front' | 'back';
export type LampColor = 'white' | 'red' | 'amber' | 'yellow';

export interface Lamp {
  x: number;
  y: number;
  color: LampColor;
  /** Lamp radius, px. */
  size: number;
}

export interface DrawnVehicle extends Drawn {
  lamps: Lamp[];
}

type Pt = readonly [number, number];

// --- Delivery riders ----------------------------------------------------

export type RiderKind = 'bike' | 'scooter';

export interface RiderLook {
  /** The delivery company's colour (jacket, helmet, box). */
  brand: number;
  skin: number;
  trousers: number;
  /** The scooter's paint. */
  paint: number;
}

const BRANDS = [0xe8702a, 0x2aa88a, 0xd8384a, 0xe8c02a, 0x3a6ad0];

export function randomRiderLook(rng: () => number = Math.random): RiderLook {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  return {
    brand: pick(BRANDS),
    skin: pick([0xf3cfa8, 0xc48c64, 0x9a6844, 0x744a30]),
    trousers: pick([0x2e3444, 0x2a2a30, 0x4a4a52]),
    paint: pick([0xd8d4cc, 0x3a6ab0, 0xc84a3a, 0x2a2a30, 0x8ac8b8]),
  };
}

/**
 * A delivery rider on a bicycle or a scooter, `height` px tall, with the
 * company's box on the back. `frame` (0/1) moves the pedals.
 */
export function drawRider(kind: RiderKind, look: RiderLook, facing: VehicleFacing, frame: number, height: number): DrawnVehicle {
  const H = Math.max(5, Math.round(height));
  const W = Math.max(4, Math.round(H * 0.62)) | 1;
  const g = new PixelGrid(W, H);
  const u = H / 30;
  const cx = W / 2;
  const palette = new Palette();
  const brand = palette.ramp(look.brand);
  const skin = palette.ramp(look.skin);
  const trousers = palette.ramp(look.trousers);
  const tyre = palette.ramp(0x2a2a2e);
  const metal = palette.ramp(0x8a8c92);
  const paint = palette.ramp(look.paint);
  const pale = palette.ramp(0xf0ece4, 0.5);
  const lamps: Lamp[] = [];
  const scooter = kind === 'scooter';
  const back = facing === 'back';
  // The wheel, seen end-on: a narrow tyre.
  const wheelTop = H - 9 * u;
  for (let y = Math.floor(wheelTop); y < H; y++) {
    const w = Math.max(1, Math.round(1.6 * u));
    for (let k = 0; k < w; k++) g.set(Math.floor(cx - w / 2) + k, y, tyre[k === 0 ? 2 : 1]);
  }
  if (scooter) {
    // The scooter's shell round the rear wheel, or its leg shield in front.
    const top = H - 13 * u;
    for (let y = Math.floor(top); y < Math.floor(H - 3 * u); y++) {
      const t = (y - top) / (10 * u);
      const half = (back ? 4.2 - t * 1.2 : 3.4 + t * 0.4) * u;
      for (let x = Math.floor(cx - half); x <= Math.floor(cx + half - 0.01); x++) g.set(x, y, paint[x < cx - half * 0.3 ? 3 : x > cx + half * 0.4 ? 1 : 2]);
    }
    if (back) lamps.push({ x: cx, y: top + 2 * u, color: 'red', size: Math.max(1, u) });
    else lamps.push({ x: cx, y: top + 1.5 * u, color: 'white', size: Math.max(1, 1.4 * u) });
  } else {
    // Legs pumping the pedals, one each side of the wheel.
    for (const side of [-1, 1]) {
      const down = (frame % 2 === 0) === side > 0;
      const hip: Pt = [cx + side * 1.4 * u, H - 15 * u];
      const knee: Pt = [cx + side * 2.6 * u, down ? H - 10 * u : H - 13 * u];
      const foot: Pt = [cx + side * 2.2 * u, down ? H - 5 * u : H - 8.5 * u];
      limb(g, [hip, knee, foot], 2.6 * u, 2 * u, trousers, { bias: side > 0 ? -0.6 : 0 });
    }
    if (back) lamps.push({ x: cx, y: H - 12 * u, color: 'red', size: Math.max(1, 0.8 * u) });
    else lamps.push({ x: cx, y: H - 12 * u, color: 'white', size: Math.max(1, u) });
  }
  // Delivery box behind the rider: the whole back of it from behind, its top over the shoulders from in front.
  const boxHalf = 3.8 * u;
  const boxTop = back ? H - 22 * u : H - 25 * u;
  const boxBottom = back ? H - 13 * u : H - 21 * u;
  const drawBox = () => {
    for (let y = Math.floor(boxTop); y < Math.floor(boxBottom); y++) {
      for (let x = Math.floor(cx - boxHalf); x <= Math.floor(cx + boxHalf - 0.01); x++) {
        const stripe = back && Math.abs(y - (boxTop + boxBottom) / 2) < 0.8 * u;
        g.set(x, y, stripe ? pale[2] : brand[y === Math.floor(boxTop) ? 3 : x > cx + boxHalf * 0.5 ? 1 : 2]);
      }
    }
  };
  if (!back) drawBox();
  // Body, leaning over the handlebars.
  const shoulder = H - 23 * u;
  shadedEllipse(g, cx, H - 19 * u, 3.4 * u, 5 * u, brand, { dither: false });
  // Arms out to the bars.
  for (const side of [-1, 1]) {
    limb(g, [[cx + side * 2.8 * u, shoulder + 1.2 * u], [cx + side * 3.8 * u, H - 15.5 * u]], 1.6 * u, 1.3 * u, brand, { bias: side > 0 ? -0.6 : 0 });
    g.set(Math.floor(cx + side * 3.9 * u), Math.floor(H - 15 * u), skin[2]);
  }
  // Handlebars.
  for (let x = Math.floor(cx - 4 * u); x <= Math.floor(cx + 4 * u); x++) g.set(x, Math.floor(H - 15 * u), metal[2]);
  if (back) drawBox();
  // Head in a dark helmet, the face showing beneath it from the front.
  const helmet = palette.ramp(0x34363c);
  shadedEllipse(g, cx, H - 26 * u, 2.3 * u, 2.6 * u, back ? helmet : skin, { dither: false });
  shadedEllipse(g, cx, H - 27.4 * u, 2.6 * u, 1.6 * u, helmet, { dither: false, bias: 0.4 });
  if (!back && H >= 16) g.set(Math.floor(cx - 0.8 * u), Math.floor(H - 25.5 * u), tyre[0]);
  if (!back && H >= 16) g.set(Math.floor(cx + 0.8 * u), Math.floor(H - 25.5 * u), tyre[0]);
  if (H >= 14) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette, lamps };
}

// --- The street sweeper -------------------------------------------------

/**
 * A little municipal sweeper: a cab on a squat body, rotating brushes at its
 * front corners (two frames), and an amber beacon on the roof.
 */
export function drawSweeper(facing: VehicleFacing, frame: number, height: number): DrawnVehicle {
  const H = Math.max(6, Math.round(height));
  const W = Math.max(6, Math.round(H * 1.05));
  const g = new PixelGrid(W, H);
  const u = H / 30;
  const cx = W / 2;
  const palette = new Palette();
  const body = palette.ramp(0xe8e4dc, 0.7);
  const stripe = palette.ramp(0xe87a2a);
  const glass = palette.ramp(0x3a4a5a);
  const tyre = palette.ramp(0x2a2a2e);
  const brush = palette.ramp(0xc8a040);
  const beacon = palette.ramp(0xf0a020);
  const lamps: Lamp[] = [];
  const back = facing === 'back';
  // Wheels.
  for (const side of [-1, 1]) for (let y = Math.floor(H - 5 * u); y < H; y++) for (let x = 0; x < Math.max(1, 3 * u); x++) g.set(Math.floor(cx + side * 11 * u - 1.5 * u + x), y, tyre[1]);
  // Body: a rounded box, an orange band round it.
  for (let y = Math.floor(H - 17 * u); y < Math.floor(H - 3 * u); y++) {
    for (let x = Math.floor(cx - 13 * u); x <= Math.floor(cx + 13 * u - 0.01); x++) {
      const band = y > H - 9 * u && y < H - 6.5 * u;
      const r = band ? stripe : body;
      g.set(x, y, r[x < cx - 9 * u ? 3 : x > cx + 9 * u ? 1 : 2]);
    }
  }
  // Cab with its window.
  for (let y = Math.floor(H - 27 * u); y < Math.floor(H - 17 * u); y++) {
    for (let x = Math.floor(cx - 9 * u); x <= Math.floor(cx + 9 * u - 0.01); x++) {
      const win = y > H - 25.5 * u && y < H - 18.5 * u && x > cx - 7.5 * u && x < cx + 7.5 * u;
      g.set(x, y, win ? glass[x < cx - 3 * u ? 3 : 2] : body[x < cx - 6 * u ? 3 : 2]);
    }
  }
  // Beacon on the roof.
  shadedEllipse(g, cx, H - 28 * u, Math.max(1, 1.6 * u), Math.max(1, 1.2 * u), beacon, { dither: false });
  lamps.push({ x: cx, y: H - 28 * u, color: 'amber', size: Math.max(1, 1.4 * u) });
  if (!back) {
    // Brushes spinning at the front corners, bristles flicking round.
    for (const side of [-1, 1]) {
      const bx = cx + side * 12 * u;
      const by = H - 2.5 * u;
      g.ellipse(bx, by, 3.2 * u, 1.6 * u, (_u, _v, x) => ((x + frame) % 2 === 0 ? brush[3] : brush[1]));
    }
    lamps.push({ x: cx - 10 * u, y: H - 12 * u, color: 'white', size: Math.max(1, u) }, { x: cx + 10 * u, y: H - 12 * u, color: 'white', size: Math.max(1, u) });
  } else {
    lamps.push({ x: cx - 11 * u, y: H - 12 * u, color: 'red', size: Math.max(1, u) }, { x: cx + 11 * u, y: H - 12 * u, color: 'red', size: Math.max(1, u) });
  }
  if (H >= 14) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette, lamps };
}

// --- A taxi -------------------------------------------------------------

/** A yellow cab, seen nose-on or from behind: windscreen, roof sign, lamps and bumpers. */
export function drawTaxi(facing: VehicleFacing, height: number): DrawnVehicle {
  const H = Math.max(5, Math.round(height));
  const W = Math.max(7, Math.round(H * 1.35));
  const g = new PixelGrid(W, H);
  const u = H / 20;
  const cx = W / 2;
  const palette = new Palette();
  const paint = palette.ramp(0xe8b82a);
  const glass = palette.ramp(0x2e3a48);
  const tyre = palette.ramp(0x1e1e22);
  const chrome = palette.ramp(0xa8acb2);
  const sign = palette.ramp(0xf4ecd0, 0.6);
  const lamps: Lamp[] = [];
  const back = facing === 'back';
  const half = 12.5 * u;
  // Tyres peeping out beneath.
  for (const side of [-1, 1]) for (let y = Math.floor(H - 3 * u); y < H; y++) for (let x = 0; x < Math.max(1, 3 * u); x++) g.set(Math.floor(cx + side * 9 * u - 1.5 * u + x), y, tyre[1]);
  // The body below the waist, widest at the wheel arches.
  for (let y = Math.floor(H - 10 * u); y < Math.floor(H - 2 * u); y++) {
    for (let x = Math.floor(cx - half); x <= Math.floor(cx + half - 0.01); x++) {
      const bumper = y >= H - 4 * u;
      g.set(x, y, bumper ? chrome[x < cx ? 3 : 2] : paint[y === Math.floor(H - 10 * u) ? 4 : x < cx - half * 0.6 ? 3 : x > cx + half * 0.6 ? 1 : 2]);
    }
  }
  // Cabin and glass, tapering to the roof.
  for (let y = Math.floor(H - 16 * u); y < Math.floor(H - 10 * u); y++) {
    const t = (y - (H - 16 * u)) / (6 * u);
    const w = half * (0.66 + 0.26 * t);
    for (let x = Math.floor(cx - w); x <= Math.floor(cx + w - 0.01); x++) {
      const pillar = x < cx - w + 1.2 * u || x > cx + w - 1.2 * u || y < H - 15.2 * u;
      g.set(x, y, pillar ? paint[2] : glass[x < cx - w * 0.3 && y < H - 12 * u ? 3 : 2]);
    }
  }
  // Roof sign.
  for (let y = Math.floor(H - 18 * u); y < Math.floor(H - 16 * u); y++) for (let x = Math.floor(cx - 3 * u); x <= Math.floor(cx + 3 * u); x++) g.set(x, y, sign[2]);
  lamps.push({ x: cx, y: H - 17 * u, color: 'yellow', size: Math.max(1, 1.5 * u) });
  if (back) {
    for (const side of [-1, 1]) {
      for (let y = Math.floor(H - 8.5 * u); y < Math.floor(H - 6 * u); y++) for (let x = 0; x < Math.max(1, 2.5 * u); x++) g.set(Math.floor(cx + side * 10.5 * u - 1.2 * u + x), y, palette.ramp(0xc8282a)[2]);
      lamps.push({ x: cx + side * 10.5 * u, y: H - 7.3 * u, color: 'red', size: Math.max(1, 1.2 * u) });
    }
  } else {
    // Headlamps and grille.
    for (let x = Math.floor(cx - 5 * u); x <= Math.floor(cx + 5 * u); x++) g.set(x, Math.floor(H - 6 * u), chrome[1]);
    for (const side of [-1, 1]) {
      for (let y = Math.floor(H - 8.5 * u); y < Math.floor(H - 6 * u); y++) for (let x = 0; x < Math.max(1, 3 * u); x++) g.set(Math.floor(cx + side * 9.5 * u - 1.5 * u + x), y, sign[3]);
      lamps.push({ x: cx + side * 9.5 * u, y: H - 7.3 * u, color: 'white', size: Math.max(1, 1.6 * u) });
    }
  }
  if (H >= 12) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette, lamps };
}

// --- A late-night noodle cart --------------------------------------------

/** A pushcart: a wooden box on two wheels under a little roof, a lantern swinging from it and steam off the pot. */
export function drawPushcart(facing: VehicleFacing, frame: number, height: number): DrawnVehicle {
  const H = Math.max(5, Math.round(height));
  const W = Math.max(6, Math.round(H * 0.95));
  const g = new PixelGrid(W, H);
  const u = H / 30;
  const cx = W / 2;
  const palette = new Palette();
  const wood = palette.ramp(0x8a5a36);
  const roof = palette.ramp(0xa8302a);
  const tyre = palette.ramp(0x2a2420);
  const pot = palette.ramp(0x6a6a72);
  const steam = palette.add(0xe8eef0);
  const lantern: Ramp = palette.ramp(0xe84a2a);
  const lamps: Lamp[] = [];
  // Wheels each side.
  for (const side of [-1, 1]) for (let y = Math.floor(H - 7 * u); y < H; y++) for (let x = 0; x < Math.max(1, 2 * u); x++) g.set(Math.floor(cx + side * 11 * u - u + x), y, tyre[side > 0 ? 1 : 2]);
  // The box.
  for (let y = Math.floor(H - 15 * u); y < Math.floor(H - 4 * u); y++) {
    for (let x = Math.floor(cx - 10 * u); x <= Math.floor(cx + 10 * u - 0.01); x++) {
      const plank = (y - Math.floor(H - 15 * u)) % Math.max(2, Math.round(3 * u)) === 0;
      g.set(x, y, wood[plank ? 1 : x < cx - 6 * u ? 3 : 2]);
    }
  }
  // Pot on top, steaming.
  shadedEllipse(g, cx - 3 * u, H - 16.5 * u, 3.5 * u, 2 * u, pot, { dither: false });
  for (let k = 0; k < 3; k++) {
    for (let y = 0; y < 4 * u; y++) {
      if ((y + frame + k) % 3 === 0) continue;
      g.set(Math.floor(cx - 4.5 * u + k * 1.4 * u + Math.sin(y * 0.8 + frame + k) * 0.8), Math.floor(H - 19 * u - y), steam);
    }
  }
  // Roof on two posts.
  for (const side of [-1, 1]) for (let y = Math.floor(H - 27 * u); y < Math.floor(H - 15 * u); y++) g.set(Math.floor(cx + side * 9 * u), y, wood[1]);
  for (let y = Math.floor(H - 29 * u); y < Math.floor(H - 26 * u); y++) {
    for (let x = Math.floor(cx - 12 * u); x <= Math.floor(cx + 12 * u - 0.01); x++) g.set(x, y, roof[y === Math.floor(H - 29 * u) ? 3 : 2]);
  }
  // A paper lantern swinging from the corner.
  const sway = frame % 2 === 0 ? -0.5 : 0.5;
  const lx = cx + (facing === 'front' ? 8 : -8) * u + sway * u;
  shadedEllipse(g, lx, H - 22.5 * u, Math.max(1, 2 * u), Math.max(1, 2.4 * u), lantern, { dither: false });
  lamps.push({ x: lx, y: H - 22.5 * u, color: 'amber', size: Math.max(1, 2.2 * u) });
  if (H >= 14) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette, lamps };
}

export const LAMP_COLORS: Record<LampColor, number> = {
  white: 0xfff4dc,
  red: 0xff3a2a,
  amber: 0xffa030,
  yellow: 0xffe060,
};
