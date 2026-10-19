import { eye, limb, Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid } from './raster';

type Pt = readonly [number, number];

// --- Sandpiper (a sanderling) -------------------------------------------------

export type SandpiperPose = 'stand' | 'run-0' | 'run-1' | 'run-2' | 'run-3' | 'peck' | 'probe' | 'fly-0' | 'fly-1' | 'fly-2' | 'fly-3';
export const SANDPIPER_RUN: readonly SandpiperPose[] = ['run-0', 'run-1', 'run-2', 'run-3'];
export const SANDPIPER_FLY: readonly SandpiperPose[] = ['fly-0', 'fly-1', 'fly-2', 'fly-3'];

/**
 * A sanderling in profile facing right, `size` px tall (1.25× as wide):
 * a plump little wader, pale grey back with a dark shoulder, snow-white
 * underneath, a short black bill and black legs that blur as it races the
 * waves (four running frames), pecking and probing the wet sand, or flying
 * low with its white wing-bar flashing. Authored in a 20×16 box.
 */
export function drawSandpiper(pose: SandpiperPose, size: number): Drawn {
  const H = Math.max(5, Math.round(size));
  const W = Math.round(H * 1.25);
  const g = new PixelGrid(W, H);
  const s = H / 16;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const back = palette.ramp(0xa8a49a, 0.9);
  const belly = palette.ramp(0xf2f0ea, 0.5);
  const dark = palette.ramp(0x3a3632, 0.8);
  const leg = palette.ramp(0x24201e);
  const farLeg = palette.ramp(0x14100e);
  const eyeDark = palette.add(0x0e0c0c);
  const glint = palette.add(0xffffff);
  const flying = pose.startsWith('fly');
  if (flying) {
    const f = Number(pose.slice(-1));
    // Wing tip height through the beat, and how open the wing is.
    const tipY = [-6, -1, 4.5, 1][f];
    const reach = [0.85, 1, 0.9, 1][f];
    // Far wing, behind the body.
    limb(g, [P(10, 7.5), P(8, 7.5 + tipY * 0.5), P(4 + 2 * (1 - reach), 7 + tipY * 0.9)], 2.6 * s, 0.8 * s, dark, { bias: -0.6 });
    // Body flat out, head forward, legs tucked.
    shadedEllipse(g, 10 * s, 8.5 * s, 5.2 * s, 2.4 * s, back, { dither: false, min: 1 });
    shadedEllipse(g, 10.5 * s, 9.4 * s, 4.2 * s, 1.4 * s, belly, { dither: false });
    shadedEllipse(g, 15.6 * s, 7.6 * s, 2 * s, 1.8 * s, back, { dither: false, min: 1 });
    limb(g, [P(17.4, 7.9), P(20, 8.4)], 0.9 * s, 0.6 * s, leg);
    // Near wing, in front: dark with a white bar along it.
    const wing = [P(10.5, 8), P(8.5, 8 + tipY * 0.55), P(3 + 2 * (1 - reach), 8 + tipY)] as const;
    limb(g, wing, 3 * s, 0.9 * s, dark, { bias: -0.2 });
    if (H >= 10) limb(g, [P(10, 8.2), P(6 + (1 - reach), 8.2 + tipY * 0.75)], 0.8 * s, 0.6 * s, belly);
    limb(g, [P(5.2, 8.8), P(2.5, 8.4)], 1.6 * s, 0.8 * s, back, { bias: -0.4 });
    if (H >= 9) eye(g, 16 * s, 7.2 * s, s >= 1.4 ? 3 : 1, eyeDark, glint);
  } else {
    // Head and body set by the pose: upright, leaning in to peck, or tipped right over to probe.
    const lean = pose === 'probe' ? 0.55 : pose === 'peck' ? 0.3 : 0;
    const hx = 14.6 + lean * 2;
    const hy = 6 + lean * 7;
    const run = pose.startsWith('run') ? Number(pose.slice(-1)) : -1;
    const bob = [0, -0.5, 0.1, -0.3][run] ?? 0;
    // Legs: in a run they swing fore and aft, a blur of black (the far one darker).
    const feet: Array<[Pt, Pt, Ramp]> = [];
    if (run >= 0) {
      const swing = [3.2, 0.6, -2.6, 0.4];
      for (const phase of [2, 0]) {
        const k = (run + phase) % 4;
        const fx = 9.4 + swing[k];
        const lift = k === 1 || k === 3 ? 1.6 : 0;
        feet.push([P(9 + swing[k] * 0.35, 12.4 + bob), P(fx, 15.8 - lift), phase ? farLeg : leg]);
      }
    } else {
      feet.push([P(8.6, 12.2), P(8.2, 15.8), farLeg], [P(10, 12.2), P(10.6, 15.8), leg]);
    }
    for (const [hip, foot, ramp] of feet) {
      limb(g, [hip, foot], Math.max(1, 0.8 * s), Math.max(1, 0.7 * s), ramp);
      g.set(Math.floor(foot[0] + 0.6 * s), Math.floor(Math.min(H - 1, foot[1])), ramp[2]);
    }
    // Tail, body, white front.
    limb(g, [P(5.2, 9 + bob + lean * 1.5), P(2.6, 8.4 + bob + lean * 0.4)], 2 * s, 0.8 * s, back, { bias: -0.4 });
    shadedEllipse(g, 9.2 * s, (9.4 + bob + lean * 1.2) * s, 5.4 * s, 3.4 * s, back, { dither: H >= 20, min: 1, angle: lean * 0.5 });
    shadedEllipse(g, 10 * s, (10.8 + bob + lean * 0.8) * s, 4.4 * s, 2 * s, belly, { dither: false, angle: lean * 0.5 });
    // The dark shoulder patch at the bend of the wing.
    if (H >= 9) shadedEllipse(g, 11.6 * s, (8.4 + bob + lean * 1.6) * s, 1.3 * s, 0.9 * s, dark, { dither: false });
    // Head, on a short neck.
    limb(g, [P(12, 8.6 + bob + lean * 2), P(hx - 0.8, hy + 0.8 + bob)], 3 * s, 2.6 * s, back);
    shadedEllipse(g, hx * s, (hy + bob) * s, 2.3 * s, 2.1 * s, back, { dither: false, min: 1 });
    shadedEllipse(g, (hx + 0.4) * s, (hy + 1.2 + bob) * s, 1.4 * s, 0.9 * s, belly, { dither: false });
    // The bill: short and straight, downward when probing.
    const tip: Pt = pose === 'probe' ? P(hx + 2.2, 15.8) : pose === 'peck' ? P(hx + 3.6, hy + 3.6) : P(hx + 4.8, hy + 1);
    limb(g, [P(hx + 1.8, hy + 0.5 + bob), tip], 1 * s, 0.6 * s, leg);
    if (H >= 8) eye(g, (hx + 0.5) * s, (hy - 0.4 + bob) * s, s >= 1.4 ? 3 : 1, eyeDark, glint);
  }
  if (H >= 10) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Herring gull -----------------------------------------------------------------

export type GullPose = 'stand' | 'call' | 'stretch' | 'float' | 'float-dip' | 'hover-0' | 'hover-1' | 'tug-0' | 'tug-1' | 'glide' | 'flap-up' | 'flap-down';

interface GullInk {
  white: Ramp;
  mantle: Ramp;
  tip: Ramp;
  bill: Ramp;
  legs: Ramp;
  red: number;
  eye: number;
  glint: number;
}

/**
 * A herring gull in profile facing right, `size` px tall (1.5× as wide):
 * white head and body, a silver-grey mantle, black wingtips spotted white,
 * a heavy yellow bill with its red spot, pink legs. Standing, calling with
 * its head thrown back, stretching its wings up over its back; floating on
 * the swell (or dipping its head under); hanging in the wind on spread,
 * flexing wings; tugging at a scrap with another gull; or flying.
 * Authored in a 30×20 box.
 */
export function drawGull(pose: GullPose, size: number): Drawn {
  const H = Math.max(6, Math.round(size));
  const W = Math.round(H * 1.5);
  const g = new PixelGrid(W, H);
  const s = H / 20;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const ink: GullInk = {
    white: palette.ramp(0xf0f0ec, 0.55),
    mantle: palette.ramp(0xa8b0b8, 0.8),
    tip: palette.ramp(0x262628, 0.7),
    bill: palette.ramp(0xe8c040, 0.7),
    legs: palette.ramp(0xd8a098, 0.7),
    red: palette.add(0xc8302a),
    eye: palette.add(0x1a1410),
    glint: palette.add(0xfff8e0),
  };
  const head = (hx: number, hy: number, tilt = 0, open = false) => {
    shadedEllipse(g, hx * s, hy * s, 3 * s, 2.7 * s, ink.white, { dither: false, min: 1 });
    // The bill: heavy, hooked, yellow with the red spot near the tip.
    const bx = hx + 2.6;
    const by = hy + 0.7 + tilt * 0.4;
    const tipX = bx + 3.6 * Math.cos(tilt);
    const tipY = by + 3.6 * Math.sin(tilt);
    limb(g, [P(bx, by), P(tipX, tipY)], 1.4 * s, 1 * s, ink.bill);
    if (open) limb(g, [P(bx, by + 0.8), P(tipX - 0.4, tipY + 1.6)], 1 * s, 0.8 * s, ink.bill, { bias: -0.6 });
    if (H >= 12) g.set(Math.floor((tipX - 0.8) * s), Math.floor((tipY + 0.6) * s), ink.red);
    if (H >= 9) eye(g, (hx + 0.9) * s, (hy - 0.6) * s, s >= 1.2 ? 3 : 1, ink.eye, ink.glint);
  };
  /** A folded wing along the back: grey, ending in black primaries with white spots over the tail. */
  const folded = (cx: number, cy: number, angle: number) => {
    limb(g, [P(cx + 3, cy - 0.4), P(cx - 3, cy + 0.4 + angle * 3), P(cx - 9, cy + 1 + angle * 6)], 3.2 * s, 1.2 * s, ink.mantle, { bias: 0.1 });
    limb(g, [P(cx - 5, cy + 0.9 + angle * 4), P(cx - 10, cy + 1.3 + angle * 6.5)], 1.6 * s, 0.9 * s, ink.tip);
    if (H >= 14) g.set(Math.floor((cx - 9.2) * s), Math.floor((cy + 0.6 + angle * 6) * s), ink.white[4]);
  };
  /** A spread wing from the shoulder out to its black tip, raised by `lift` (authored px). */
  const spread = (sx: number, sy: number, reachX: number, lift: number, near: boolean) => {
    const elbow = P(sx + reachX * 0.4, sy - lift * 0.55);
    const tip = P(sx + reachX, sy - lift);
    limb(g, [P(sx, sy), elbow, tip], (near ? 3.6 : 3) * s, 1 * s, ink.mantle, { bias: near ? 0.2 : -0.4 });
    limb(g, [[elbow[0] + (tip[0] - elbow[0]) * 0.55, elbow[1] + (tip[1] - elbow[1]) * 0.55], tip], 1.8 * s, 0.8 * s, ink.tip);
    if (H >= 14 && near) g.set(Math.floor(tip[0] - Math.sign(reachX) * s), Math.floor(tip[1] + 0.4 * s), ink.white[4]);
  };
  const legs = (x: number, y: number, bend = 0) => {
    for (const dx of [-0.8, 1]) {
      limb(g, [P(x + dx, y), P(x + dx + bend, 19.6)], Math.max(1, 0.8 * s), Math.max(1, 0.7 * s), ink.legs);
      g.set(Math.floor((x + dx + bend + 0.8) * s), H - 1, ink.legs[1]);
    }
  };
  switch (pose) {
    case 'stand':
    case 'call': {
      legs(13, 15.2);
      shadedEllipse(g, 13 * s, 12 * s, 7.6 * s, 4.2 * s, ink.white, { dither: H >= 24, min: 1, angle: -0.12 });
      limb(g, [P(19, 9.6), P(21, 7.4)], 3.6 * s, 3 * s, ink.white);
      folded(14, 10, 0.05);
      if (pose === 'call') head(21.4, 4.8, -0.9, true);
      else head(21.6, 6, 0);
      break;
    }
    case 'stretch': {
      legs(13, 15.2);
      // Both wings up over the back in a deep V, primaries spread.
      spread(13, 9, -9, 8.5, false);
      shadedEllipse(g, 13 * s, 12 * s, 7.4 * s, 4.2 * s, ink.white, { dither: H >= 24, min: 1, angle: -0.12 });
      limb(g, [P(19, 9.6), P(21, 7.4)], 3.6 * s, 3 * s, ink.white);
      head(21.6, 6, 0.2);
      spread(13.5, 9.5, -6, 9.5, true);
      break;
    }
    case 'float':
    case 'float-dip': {
      // Riding high on the water: the bottom rows are the waterline.
      shadedEllipse(g, 13 * s, 16.4 * s, 8 * s, 3.6 * s, ink.white, { dither: H >= 24, min: 1 });
      folded(14, 14.4, 0);
      limb(g, [P(4.6, 15.6), P(2.6, 14.6)], 2 * s, 0.9 * s, ink.tip, { bias: -0.2 });
      if (pose === 'float-dip') head(21.4, 17, 0.9);
      else {
        limb(g, [P(19, 14), P(21, 11.4)], 3.4 * s, 3 * s, ink.white);
        head(21.6, 10.4, 0);
      }
      for (let y = Math.round(18.6 * s); y < H; y++) for (let x = 0; x < W; x++) g.set(x, y, 0);
      break;
    }
    case 'hover-0':
    case 'hover-1': {
      // Hanging in the wind: wings spread and canted, tail fanned, feet let down.
      const flex = pose === 'hover-0' ? 0 : 1;
      spread(14, 8.6, 9 - flex, 6 + flex * 1.5, false);
      limb(g, [P(7, 10.4), P(2.4, 11.6)], 2.6 * s, 2 * s, ink.white, { bias: -0.2 });
      shadedEllipse(g, 12.6 * s, 10.4 * s, 6.6 * s, 3 * s, ink.white, { dither: false, min: 1, angle: 0.1 });
      if (H >= 20) for (const dx of [0, 1.4]) limb(g, [P(11.6 + dx, 12.6), P(10.8 + dx, 15.4 - flex * 0.4)], Math.max(1, 0.7 * s), Math.max(1, 0.7 * s), ink.legs);
      head(19.6, 8.6, 0.25);
      spread(13, 9.6, -10 + flex, 7.5 - flex * 1.5, true);
      break;
    }
    case 'tug-0':
    case 'tug-1': {
      // Braced, leaning back on its legs, the scrap gripped in its bill.
      const back = pose === 'tug-0' ? 1 : 0;
      legs(12 - back, 15.2, 1.2 + back);
      shadedEllipse(g, (12.4 - back) * s, (12.2 - back * 0.4) * s, 7.4 * s, 4.2 * s, ink.white, { dither: H >= 24, min: 1, angle: -0.3 + back * -0.15 });
      folded(13 - back, 10.4, 0.1);
      limb(g, [P(18.6 - back, 10.4), P(21 - back * 0.6, 9.4)], 3.4 * s, 3 * s, ink.white);
      head(22 - back * 0.6, 9.2, 0.35);
      break;
    }
    case 'glide':
    case 'flap-up':
    case 'flap-down': {
      const lift = pose === 'flap-up' ? 8 : pose === 'flap-down' ? -5 : 1.5;
      spread(14, 9.4, 8, lift * 0.8, false);
      limb(g, [P(6.6, 10.6), P(2.4, 11)], 2.4 * s, 1.6 * s, ink.white, { bias: -0.2 });
      shadedEllipse(g, 12.6 * s, 10.6 * s, 6.8 * s, 2.8 * s, ink.white, { dither: false, min: 1 });
      head(19.8, 9.2, 0.1);
      spread(13, 10, -10, lift, true);
      break;
    }
  }
  if (H >= 10) selOut(g, palette, { bottomHeavy: pose.startsWith('float') ? false : true });
  return { grid: g, palette };
}

// --- Little egret -------------------------------------------------------------

export type EgretPose = 'stand' | 'step-0' | 'step-1' | 'crouch' | 'strike' | 'fly-0' | 'fly-1';

/**
 * A little egret in profile facing right, `size` px tall (square box): pure
 * white, a long neck folded in an S, a slender black dagger of a bill, black
 * legs and bright yellow feet, a wisp of plumes off the nape. Standing,
 * stepping slow and high, crouched and still with the neck drawn back to
 * strike, striking down with the neck shot out, or flying with the neck
 * tucked and legs trailing. Authored in a 24×24 box.
 */
export function drawEgret(pose: EgretPose, size: number): Drawn {
  const N = Math.max(8, Math.round(size));
  const g = new PixelGrid(N, N);
  const s = N / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const white = palette.ramp(0xf4f4f0, 0.5);
  const black = palette.ramp(0x1c1c1e, 0.6);
  const yellow = palette.add(0xe8c830);
  const lore = palette.add(0xb8b860);
  const eyeC = palette.add(0x1a1410);
  const glint = palette.add(0xfff8c0);
  if (pose === 'fly-0' || pose === 'fly-1') {
    const up = pose === 'fly-0';
    // Broad rounded wings, neck folded back into the shoulders, legs trailing behind.
    limb(g, [P(13, 11), P(10, up ? 4 : 13), P(5, up ? 1.5 : 17)], 4 * s, 2 * s, white, { bias: -0.5 });
    limb(g, [P(9, 12.4), P(1, 13.4)], Math.max(1, 0.7 * s), Math.max(1, 0.6 * s), black);
    g.set(Math.floor(0.6 * s), Math.floor(13.6 * s), yellow);
    shadedEllipse(g, 12 * s, 12 * s, 5.4 * s, 2.4 * s, white, { dither: false, min: 1 });
    shadedEllipse(g, 17.2 * s, 10.8 * s, 2 * s, 1.7 * s, white, { dither: false, min: 1 });
    limb(g, [P(18.8, 11), P(23.6, 11.8)], 0.9 * s, 0.5 * s, black);
    limb(g, [P(13, 11.6), P(9, up ? 3 : 15), P(4, up ? 0.6 : 19.5)], 4.6 * s, 2.2 * s, white, { bias: 0.2 });
    if (N >= 14) eye(g, 17.8 * s, 10.4 * s, 1, eyeC, glint);
  } else {
    // Legs: long and black, feet yellow; one raised mid-step.
    const stepUp = pose === 'step-0' ? 1 : pose === 'step-1' ? 2 : 0;
    const hip: Pt = P(11, 15.2);
    const lowered = pose === 'crouch' || pose === 'strike' ? 1.2 : 0;
    for (const which of [1, 2]) {
      const raised = which === stepUp;
      const foot: Pt = raised ? P(13.6, 19.6) : P(which === 1 ? 9.8 : 12, 23.6);
      const knee: Pt = raised ? P(14, 19) : P((hip[0] / s + foot[0] / s) / 2 + 0.3, 19.6 + lowered * 0.5);
      limb(g, [[hip[0], hip[1] + lowered * s], knee, foot], Math.max(1, 0.8 * s), Math.max(1, 0.7 * s), black);
      g.rect(Math.floor(foot[0]), Math.floor(Math.min(N - 1, foot[1])), Math.max(1, Math.round(1.6 * s)), 1, yellow);
    }
    // The body: a slim ovoid, tail drooping behind.
    shadedEllipse(g, 10.4 * s, (13 + lowered) * s, 5.4 * s, 2.8 * s, white, { dither: N >= 30, min: 1, angle: -0.3 });
    limb(g, [P(6, 14.4 + lowered), P(3.4, 16.4 + lowered)], 2.6 * s, 1 * s, white, { bias: -0.3 });
    // Neck and head: an S standing tall, drawn back low, or shot out and down in the strike.
    const neck: Pt[] =
      pose === 'strike'
        ? [P(14, 12.4), P(17, 14), P(19.6, 17.6)]
        : pose === 'crouch'
          ? [P(14, 12.2 + lowered), P(15.6, 9.6), P(14.8, 8.2), P(16.6, 7.6)]
          : [P(14, 11.6), P(15.4, 8), P(14, 5), P(15.6, 3)];
    limb(g, neck, 2.4 * s, 1.5 * s, white);
    const [hx, hy] = neck[neck.length - 1];
    shadedEllipse(g, hx, hy, 1.6 * s, 1.4 * s, white, { dither: false, min: 1 });
    const along = pose === 'strike' ? 0.95 : pose === 'crouch' ? 0.28 : 0.12;
    const bill = 6 * s;
    limb(g, [[hx + 1.2 * s, hy + 0.2 * s], [hx + 1.2 * s + Math.cos(along) * bill, hy + 0.2 * s + Math.sin(along) * bill]], Math.max(1, 0.9 * s), Math.max(1, 0.5 * s), black);
    if (N >= 14) {
      g.set(Math.floor(hx + 1 * s), Math.floor(hy), lore);
      eye(g, hx + 0.4 * s, hy - 0.3 * s, 1, eyeC, glint);
      // The plumes off the back of the head.
      if (pose !== 'strike') limb(g, [[hx - 1.2 * s, hy - 0.2 * s], [hx - 4 * s, hy + 1.6 * s]], Math.max(1, 0.6 * s), 1, white, { bias: 0.5 });
    }
  }
  if (N >= 14) selOut(g, palette, { bottomHeavy: true });
  return { grid: g, palette };
}

// --- Frigatebird ----------------------------------------------------------------

/**
 * A magnificent frigatebird very high overhead, seen from below, `span` px
 * wingtip to wingtip: black, the long narrow wings crooked at the wrist and
 * swept back to points, the deeply forked tail. Frame 1 flexes the wings a
 * touch, as it adjusts in the air.
 */
export function drawFrigatebird(frame: number, span: number): Drawn {
  const W = Math.max(7, Math.round(span));
  const H = Math.max(4, Math.round(W * 0.42));
  const g = new PixelGrid(W, H);
  const s = W / 24;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const black = palette.ramp(0x1e1c22, 0.6);
  const flex = frame % 2 ? 0.8 : 0;
  for (const side of [-1, 1]) {
    // Shoulder, the wrist bent forward, the long hand swept back to its point.
    limb(g, [P(12, 4.6), P(12 + side * 4.6, 2 - flex * 0.4), P(12 + side * 11.6, 8 + flex)], 2 * s, 0.6 * s, black, { bias: -0.4 });
  }
  shadedEllipse(g, 12 * s, 4.8 * s, 1.4 * s, 2.2 * s, black, { dither: false });
  // The forked tail.
  for (const side of [-1, 1]) limb(g, [P(12, 6.6), P(12 + side * 1.8, 10)], Math.max(1, 0.8 * s), Math.max(1, 0.5 * s), black);
  return { grid: g, palette };
}

// --- A leaping fish -------------------------------------------------------------------

export const JUMP_FRAMES = 4;

/**
 * A little silver fish (a mullet) flicking out of the water, `size` px long:
 * nose up leaving the surface, flat at the top of its leap, nose down going
 * back in, and just the splash. The bottom row is the water.
 */
export function drawJumpFish(frame: number, size: number): Drawn {
  const L = Math.max(4, Math.round(size));
  const W = L + 4;
  const H = Math.max(4, Math.round(L * 0.9));
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const silver = palette.ramp(0xb8c8d0, 0.8);
  const spray = palette.add(0xf4f8f8);
  const f = ((frame % JUMP_FRAMES) + JUMP_FRAMES) % JUMP_FRAMES;
  const cx = W / 2;
  if (f < 3) {
    const angle = [-0.9, 0, 0.9][f];
    const lift = [0.45, 0.25, 0.45][f];
    shadedEllipse(g, cx, H * lift + 1, L / 2, Math.max(0.7, L * 0.16), silver, { dither: false, angle, min: 1 });
    // The tail fork.
    const tx = cx - Math.cos(angle) * (L / 2 + 0.4);
    const ty = H * lift + 1 - Math.sin(angle) * (L / 2 + 0.4);
    g.set(Math.floor(tx), Math.floor(ty - 0.6), silver[1]);
    g.set(Math.floor(tx), Math.floor(ty + 0.6), silver[1]);
  }
  // Where it breaks the surface: a ring of white.
  const at = f === 0 ? cx - L * 0.35 : f === 2 ? cx + L * 0.35 : f === 3 ? cx + L * 0.3 : -99;
  if (at > -50) {
    for (const dx of [-1, 0, 1]) g.set(Math.floor(at + dx), H - 1, spray);
    g.set(Math.floor(at), H - 2, spray);
    if (f === 3) {
      g.set(Math.floor(at - 1), H - 3, spray);
      g.set(Math.floor(at + 1), H - 3, spray);
    }
  }
  return { grid: g, palette };
}

// --- Nightjar -------------------------------------------------------------------------

export const NIGHTJAR_FRAMES = 4;

/**
 * A nightjar hawking moths in the dusk, seen from below, `span` px across:
 * long, pointed, soft-mottled wings with a white spot near each tip, a long
 * tail with white corners, a small head; wings beating loose and deep
 * (four frames), the shape that flickers over the dunes like a big moth.
 */
export function drawNightjar(frame: number, span: number): Drawn {
  const W = Math.max(7, Math.round(span));
  const H = Math.max(5, Math.round(W * 0.6));
  const g = new PixelGrid(W, H);
  const s = W / 20;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const brown = palette.ramp(0x6a5a48, 0.8);
  const white = palette.add(0xf0ece0);
  const f = ((frame % NIGHTJAR_FRAMES) + NIGHTJAR_FRAMES) % NIGHTJAR_FRAMES;
  const tipY = [-3.6, -0.8, 3.4, 0.8][f];
  const reach = [0.85, 1, 0.8, 0.95][f];
  for (const side of [-1, 1]) {
    const tip = P(10 + side * 9.6 * reach, 5 + tipY);
    limb(g, [P(10, 5), P(10 + side * 5 * reach, 4.4 + tipY * 0.45), tip], 2.6 * s, 0.6 * s, brown, { bias: -0.2 });
    if (W >= 12) g.set(Math.floor(10 * s + side * 7.4 * reach * s), Math.floor((4.9 + tipY * 0.75) * s), white);
  }
  // Body, the head, the long tail.
  shadedEllipse(g, 10 * s, 5.4 * s, 1.5 * s, 2.4 * s, brown, { dither: false, min: 1 });
  shadedEllipse(g, 10 * s, 3 * s, 1.2 * s, 1 * s, brown, { dither: false, min: 1 });
  limb(g, [P(10, 7), P(10, 11.4)], 2 * s, 2.4 * s, brown, { bias: -0.3 });
  if (W >= 14) {
    g.set(Math.floor(9 * s), Math.floor(11 * s), white);
    g.set(Math.floor(11 * s), Math.floor(11 * s), white);
  }
  return { grid: g, palette };
}
