import { limb, Palette, selOut, shadedEllipse, type Drawn } from './kit';
import { PixelGrid } from './raster';

/**
 * Machines in the city sky: the advertising blimp and the helicopter.
 * Drawn once with the kit and cached.
 */

/** The blimp's box, and where its sign runs. */
export const BLIMP_W = 56;
export const BLIMP_H = 22;
export const BLIMP_BAND = { x0: 15, w: 32, y0: 8 } as const;

/**
 * The advertising blimp, nose right: a silver envelope, rounded and
 * dithered from its lit top to its shaded belly, with faint seams between
 * its panels; three blue fins at the tail, shaded; the gondola slung
 * underneath with a row of lit windows; and a dark band along its side
 * where the sign scrolls.
 */
export function drawBlimp(): Drawn {
  const g = new PixelGrid(BLIMP_W, BLIMP_H);
  const palette = new Palette();
  const skin = palette.ramp(0xd8dce0, 0.8);
  const fin = palette.ramp(0x3a6ab0);
  const gondola = palette.ramp(0x4a4e56);
  const window = palette.add(0xf0e0a0);
  // The fins: upper and lower behind the envelope, the near one across it.
  g.polygon([[2, 1], [9, 4], [13, 8], [6, 8]], fin[3]);
  g.polygon([[2, 20], [9, 17], [13, 13], [6, 13]], fin[1]);
  shadedEllipse(g, 29, 10.5, 24, 8.5, skin, { dither: true, min: 1 });
  // Faint seams between the envelope's panels.
  for (const sx of [20, 28, 36, 44]) {
    for (let y = 0; y < BLIMP_H; y++) {
      const c = g.get(sx, y);
      if (c && y % 2 === 0 && c !== skin[4] && (y < BLIMP_BAND.y0 - 1 || y > BLIMP_BAND.y0 + 5)) g.set(sx, y, skin[Math.max(0, skin.indexOf(c) - 1)]);
    }
  }
  g.polygon([[3, 9], [12, 9.5], [14, 11], [12, 12.5], [3, 12]], fin[2]);
  for (let x = 3; x < 12; x++) g.set(x, 9, fin[4]);
  // The gondola underneath, its windows lit.
  for (let x = 24; x < 36; x++) {
    g.set(x, 19, gondola[3]);
    g.set(x, 20, gondola[1]);
  }
  g.set(23, 20, gondola[1]);
  g.set(36, 19, gondola[2]);
  for (let x = 26; x < 34; x += 2) g.set(x, 19, window);
  // A dark band where the sign runs, inked top and bottom.
  const band = palette.add(0x0c0e14);
  const ink = palette.add(0x1e2430);
  for (let x = BLIMP_BAND.x0; x < BLIMP_BAND.x0 + BLIMP_BAND.w; x++) {
    for (let y = BLIMP_BAND.y0 - 1; y <= BLIMP_BAND.y0 + 5; y++) if (g.get(x, y)) g.set(x, y, y === BLIMP_BAND.y0 - 1 || y === BLIMP_BAND.y0 + 5 ? ink : band);
  }
  selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

/**
 * A helicopter side on, nose right, in a 18×9 box: a rounded, shaded cabin
 * with the canopy glinting at the front, a tapering tail boom to the fin
 * and tail rotor, skids underneath, and the main rotor a long blur across
 * the top or a short blade seen end-on (frames 0 and 1).
 */
export function drawHelicopter(frame: number): Drawn {
  const g = new PixelGrid(18, 9);
  const palette = new Palette();
  const hull = palette.ramp(0x3e4654, 0.8);
  const glass = palette.ramp(0x4a6a8a, 0.7);
  const metal = palette.ramp(0x6a707a, 0.6);
  const glint = palette.add(0xe8f4ff);
  const f = frame & 1;
  // The tail boom, tapering back to the fin.
  limb(g, [[9, 4.6], [1.6, 3.8]], 2.2, 1, hull, { bias: 0.2 });
  g.set(1, 2, hull[2]);
  g.set(1, 3, hull[2]);
  g.set(2, 2, hull[3]);
  // The tail rotor, flicking.
  g.set(0, f ? 2 : 4, metal[3]);
  // The cabin and its canopy.
  shadedEllipse(g, 11.5, 5, 4.2, 2.6, hull, { dither: false });
  for (const [x, y] of [[13, 4], [14, 4], [14, 5], [15, 5], [13, 3]] as const) g.set(x, y, glass[y < 5 ? 3 : 2]);
  g.set(14, 4, glint);
  // Skids and struts.
  for (let x = 8; x <= 15; x++) g.set(x, 8, metal[x === 15 ? 3 : 2]);
  g.set(9, 7, metal[1]);
  g.set(13, 7, metal[1]);
  // The mast and main rotor.
  g.set(11, 2, metal[2]);
  if (f === 0) for (let x = 3; x <= 17; x++) g.set(x, 1, x % 3 === 0 ? metal[1] : metal[3]);
  else for (let x = 8; x <= 14; x++) g.set(x, 1, metal[2]);
  return { grid: g, palette };
}

/**
 * The delivery drone that lands on the rooftop pad, `span` px between its
 * outer rotors: a rounded shell with a cyan stripe, arms out to motor pods,
 * landing legs, and a parcel slung underneath, shaded and taped. The rotors
 * are dithered discs while they spin (frame 0) or two still blades (1, 2).
 * The box is span + 8 wide and 8 tall; the shell's top sits on row 1.
 */
export function drawPadDrone(span: number, frame: number): Drawn {
  const W = span + 8;
  const H = 8;
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const shell = palette.ramp(0x4a505a, 0.8);
  const dark = palette.ramp(0x24262c, 0.6);
  const stripe = palette.add(0x3ad8e8);
  const parcel = palette.ramp(0xd89a3a, 0.7);
  const tape = palette.add(0xe8dcc0);
  const blur = palette.ramp(0xd8dce0, 0.5);
  const cx = Math.floor(W / 2);
  const reach = Math.round(span / 2);
  // Arms out to the motor pods.
  for (let x = cx - reach; x <= cx + reach; x++) g.set(x, 1, dark[2]);
  for (const side of [-1, 1]) {
    g.set(cx + side * reach, 2, dark[1]);
    g.set(cx + side * reach - (side > 0 ? 1 : 0), 1, dark[3]);
  }
  // The shell, rounded, its stripe along the middle.
  shadedEllipse(g, cx + 0.5, 2.2, Math.max(2, span * 0.24), 1.6, shell, { dither: false });
  for (let x = 0; x < W; x++) if (shell.includes(g.get(x, 2))) g.set(x, 2, stripe);
  // Landing legs.
  for (const side of [-1, 1]) for (let y = 4; y < H - 1; y++) g.set(cx + side * Math.round(span * 0.3), y, dark[1]);
  // The parcel: lit on top, shaded on its far side, taped down the middle.
  for (let y = 4; y < 7; y++) for (let x = cx - 2; x <= cx + 2; x++) g.set(x, y, y === 4 ? parcel[3] : x === cx + 2 ? parcel[1] : parcel[2]);
  for (let y = 4; y < 7; y++) g.set(cx, y, tape);
  // Rotors: dithered discs spinning, or still blades.
  for (const side of [-1, 1]) {
    const rx = cx + side * reach;
    if (frame === 0) {
      for (let x = rx - 4; x <= rx + 4; x++) if ((x + side) % 2 === 0 || Math.abs(x - rx) < 2) g.set(x, 0, blur[Math.abs(x - rx) < 2 ? 3 : 2]);
    } else {
      const long = frame === 1;
      for (let x = rx - (long ? 3 : 1); x <= rx + (long ? 3 : 1); x++) g.set(x, 0, dark[2]);
    }
  }
  return { grid: g, palette };
}
