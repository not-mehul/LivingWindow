import { eye, limb, Palette, selOut, shadeStep, type Drawn, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';
import { SLOT, SPECIES, spanWing, WING_SHAPES, type BirdPose, type SpeciesId } from './birdSprites';

type Pt = readonly [number, number];

/** Species drawn by the close-up renderer (the owl and eagle keep their own forms). */
export const CLOSE_SPECIES: ReadonlySet<SpeciesId> = new Set(['pigeon', 'sparrow', 'crow', 'woodpecker', 'jay', 'chickadee', 'finch', 'bluebird', 'robin', 'seagull', 'sandpiper']);
/** At this size and up, a bird is near enough to draw in full. */
export const CLOSE_SIZE = 18;
/** From this size the same renderer draws mid-distance birds, with the finer marks left off. */
export const MID_SIZE = 10;

/** The close renderer's beat for each of the far renderer's four flight frames. */
const FLIGHT_BEAT: Partial<Record<BirdPose, BirdPose>> = { 'fly-up': 'fly-1', 'fly-mid': 'fly-3', 'fly-down': 'fly-4' };

/** The six beats of a close bird's wings. */
export const FLAP_CYCLE_6: readonly BirdPose[] = ['fly-1', 'fly-2', 'fly-3', 'fly-4', 'fly-5', 'fly-6'];
/** Wingtip height (authored px above the shoulder) through the six beats. */
const BEAT_TIP = [20, 13, 2, -14, -8, 6];
const BEAT_REACH = [0.78, 0.92, 1, 0.86, 0.95, 1];

interface Ink {
  body: Ramp;
  belly: Ramp;
  head: Ramp;
  wing: Ramp;
  dark: Ramp;
  breast: Ramp;
  cap: Ramp;
  beak: Ramp;
  leg: Ramp;
  sheen: Ramp;
  accent: number;
  eyeDark: number;
  glint: number;
  iris: number;
}

/**
 * A bird close to the window, in full: its body, breast and belly shaded
 * as rounded forms; the folded wing laid over the back with rows of
 * coverts edged pale and the long primaries crossing over the tail; the
 * species' markings (a cap, cheek patch, bib, nape, streaks, wing bars,
 * an iridescent neck, a crest); a two-part beak, an eye with its glint and
 * ring; legs jointed at the heel, with toes. Facing right in a `size` box
 * (authored at 48), feet on the bottom row.
 *
 * Poses: standing and breathing, blinking, tilting its head, looking up or
 * back, fluffed up, preening, scratching, flicking its tail; the hop in
 * three beats; pecking and swallowing; singing with its throat swelling;
 * crouching and springing to take off; a six-beat flight, a glide and the
 * flare to land.
 */
export function drawBirdClose(species: SpeciesId, requested: BirdPose, size: number): Drawn {
  const pose = FLIGHT_BEAT[requested] ?? requested;
  const sp = SPECIES[species];
  const f = sp.features;
  const N = Math.max(8, Math.round(size));
  const g = new PixelGrid(N, N);
  const s = N / 48;
  const P = (x: number, y: number): Pt => [x * s, y * s];
  const palette = new Palette();
  const c = (slot: number) => sp.palette[slot];
  const ink: Ink = {
    body: palette.ramp(c(SLOT.body), 0.8),
    belly: palette.ramp(c(SLOT.belly), 0.35),
    head: palette.ramp(c(SLOT.head), 0.8),
    wing: palette.ramp(c(SLOT.wing), 0.9),
    dark: palette.ramp(c(SLOT.wingDark), 0.8),
    breast: palette.ramp(c(SLOT.breast), 0.5),
    cap: palette.ramp(c(SLOT.cap), 0.7),
    beak: palette.ramp(c(SLOT.beak), 0.8),
    leg: palette.ramp(c(SLOT.leg), 0.7),
    sheen: palette.ramp(c(SLOT.sheen), 0.7),
    accent: palette.add(c(SLOT.accent)),
    eyeDark: palette.add(0x0c0a0a),
    glint: palette.add(0xffffff),
    iris: palette.add(c(SLOT.eye)),
  };
  const dither = N >= 30;
  /** A rounded form, shaded and coloured by a function of where in it a pixel lies (u, v in −1..1). */
  const form = (cx: number, cy: number, rx: number, ry: number, angle: number, color: (u: number, v: number, x: number, y: number) => Ramp | number | null, bias = 0) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const R = Math.max(rx, ry) * s + 1;
    const X = cx * s;
    const Y = cy * s;
    for (let y = Math.floor(Y - R); y <= Math.ceil(Y + R); y++) {
      for (let x = Math.floor(X - R); x <= Math.ceil(X + R); x++) {
        const dx = x + 0.5 - X;
        const dy = y + 0.5 - Y;
        const u = (dx * cos + dy * sin) / (rx * s);
        const v = (-dx * sin + dy * cos) / (ry * s);
        if (u * u + v * v > 1) continue;
        const col = color(u, v, x, y);
        if (col === null) continue;
        if (typeof col === 'number') {
          g.set(x, y, col);
          continue;
        }
        const nz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        const nx = u * cos - v * sin;
        const ny = u * sin + v * cos;
        g.set(x, y, col[shadeStep(nx, ny, nz, x, y, dither, bias)]);
      }
    }
  };

  const flying = pose.startsWith('fly') || pose === 'glide' || pose === 'takeoff-2' || pose.startsWith('flare');
  // Further off, a beating wing reads by its broad outline rather than its foreshortening.
  if (flying && N < CLOSE_SIZE) drawFlightMid(g, sp, pose, s, P, ink, form);
  else if (flying) drawFlight(g, sp, pose, s, P, ink, form);
  else drawPerched(g, sp, pose, s, P, ink, form, f);
  if (N >= 14) selOut(g, palette, { bottomHeavy: !flying });
  return { grid: g, palette };
}

type Form = (cx: number, cy: number, rx: number, ry: number, angle: number, color: (u: number, v: number, x: number, y: number) => Ramp | number | null, bias?: number) => void;
type Species = (typeof SPECIES)[SpeciesId];

/** The bird standing (or hopping, preening, pecking …) on the sill. */
function drawPerched(g: PixelGrid, sp: Species, pose: BirdPose, s: number, P: (x: number, y: number) => Pt, ink: Ink, form: Form, f: Species['features']): void {
  const rx = sp.bodyRx;
  let ry = sp.bodyRy;
  let bx = 21;
  let by = 30;
  let angle = -0.32;
  let hx = 34;
  let hy = 16;
  let beakTilt = 0;
  let beakDir = 1;
  let open = 0;
  let eyeShut = false;
  let tailLift = 0;
  let legBend = 0;
  let legsTucked = false;
  let throat = 0;
  let fluff = 0;
  let scratch = 0;
  let wingOpen = 0;
  switch (pose) {
    case 'idle-breathe':
      by += 0.6;
      ry *= 1.03;
      hy += 0.6;
      break;
    case 'blink':
      eyeShut = true;
      break;
    case 'tilt':
      beakTilt = -0.35;
      hy -= 0.5;
      break;
    case 'look-up':
      hx = 33;
      hy = 14;
      beakTilt = -0.5;
      break;
    case 'look-back':
      hx = 31;
      beakDir = -1;
      break;
    case 'fluff':
      fluff = 1;
      ry *= 1.16;
      by += 0.5;
      hy += 3;
      hx -= 1;
      break;
    case 'preen-1':
    case 'preen-2':
      // Head turned back, beak worked into the feathers of the wing.
      hx = 27 + (pose === 'preen-2' ? 1 : 0);
      hy = 21 + (pose === 'preen-2' ? 1 : 0);
      beakDir = -1;
      beakTilt = pose === 'preen-2' ? 0.9 : 0.5;
      wingOpen = 0.5;
      break;
    case 'scratch-1':
    case 'scratch-2':
      // A foot brought up past the wing to scratch at the head.
      hx = 34;
      hy = 18;
      beakTilt = pose === 'scratch-1' ? 0.4 : 0.55;
      hy += pose === 'scratch-1' ? 0 : 0.6;
      scratch = pose === 'scratch-1' ? 1 : 2;
      eyeShut = true;
      break;
    case 'tail-flick':
      tailLift = 5;
      break;
    case 'hop-crouch':
      by += 2;
      hy += 2;
      legBend = 2;
      break;
    case 'hop':
    case 'hop-air':
      by -= 5;
      hy -= 4;
      legsTucked = true;
      tailLift = 2;
      break;
    case 'hop-land':
      by += 1;
      hy += 1;
      legBend = 1;
      wingOpen = 0.4;
      break;
    case 'peck-reach':
      angle = -0.08;
      hx = 37.5;
      hy = 27;
      beakTilt = 0.6;
      break;
    case 'peck-down':
      angle = -0.02;
      hx = 38;
      hy = 35;
      beakTilt = 1.15;
      break;
    case 'peck-swallow':
      hy = 15;
      beakTilt = -0.4;
      throat = 0.6;
      break;
    case 'chirp':
      hy = 14;
      beakTilt = -0.3;
      open = 1.6;
      throat = 1;
      break;
    case 'chirp-2':
      hy = 14.5;
      beakTilt = -0.2;
      open = 0.8;
      throat = 0.6;
      break;
    case 'takeoff-1':
      by += 2.5;
      hy += 2.5;
      hx += 1;
      legBend = 2.5;
      wingOpen = 0.7;
      tailLift = 2;
      break;
    case 'sleep':
      hx = 27;
      hy = 22;
      eyeShut = true;
      fluff = 1;
      break;
  }
  const hr = sp.headR;

  // --- Tail, fanned behind ---
  const tailBase: Pt = [bx - rx * 0.72, by + 3];
  const tailTip: Pt = [tailBase[0] - sp.tailLen, tailBase[1] + 6 - tailLift];
  limb(g, [P(tailBase[0] + 2, tailBase[1] - 1), P(tailTip[0], tailTip[1])], 4.6 * s, 3.4 * s, ink.dark, { bias: -0.2 });
  if (s * 48 >= 26) {
    // The feather tips: a darker notch, pale edges.
    g.set(Math.floor(tailTip[0] * s), Math.floor((tailTip[1] + 1) * s), ink.dark[0]);
    if (f.wing === 'black-tips' || f.wing === 'pigeon-bars') limb(g, [P(tailTip[0] + 2, tailTip[1] - 0.5), P(tailTip[0], tailTip[1])], 3 * s, 2.5 * s, f.wing === 'pigeon-bars' ? ink.dark : ink.belly);
  }

  // --- Legs: the far one in shade, then the near; jointed at the heel, toes splayed ---
  if (pose !== 'sleep' && !legsTucked) {
    const legTop = by + ry * 0.7;
    const ground = 46;
    for (const [i, off] of [
      [0, -1.5],
      [1, 2],
    ] as const) {
      const near = i === 1;
      // The scratching foot is drawn last, up by the face.
      if (near && scratch) continue;
      const hip: Pt = P(bx + off, legTop);
      const heel: Pt = P(bx + off + 1.4 + legBend, (legTop + ground) / 2 + legBend * 0.6);
      const foot: Pt = P(bx + off + legBend * 0.3, ground - 0.4);
      limb(g, [hip, heel, foot], Math.max(1, 1.3 * s), Math.max(1, 1.1 * s), ink.leg, { bias: near ? 0.2 : -0.8 });
      // Toes: two forward, one back.
      limb(g, [foot, [foot[0] + 3.2 * s, foot[1]]], Math.max(1, 0.9 * s), Math.max(1, 0.8 * s), ink.leg, { bias: near ? 0 : -0.8 });
      limb(g, [foot, [foot[0] - 1.6 * s, foot[1]]], Math.max(1, 0.9 * s), Math.max(1, 0.8 * s), ink.leg, { bias: -0.6 });
    }
  }

  // --- Body: back, breast and belly, rounded ---
  const streak = (x: number, y: number) => f.streaky && pixelHash(Math.floor(x / 1), Math.floor(y / 2), 7) < 0.2;
  form(bx, by, rx * (1 + fluff * 0.06), ry, angle, (u, v, x, y) => {
    // Ruffled at the edge when fluffed.
    if (fluff && u * u + v * v > 0.86 && pixelHash(x, y, 31) < 0.35) return null;
    if (f.breast && u > 0.05 && v > -0.45 && v < 0.55) return ink.breast;
    if (v > 0.3) return streak(x, y) ? ink.dark[1] : ink.belly;
    if (v > 0 && streak(x, y)) return ink.dark[2];
    return ink.body;
  });

  // --- The neck, joining the head ---
  if (pose !== 'sleep' && !pose.startsWith('preen')) {
    const neckFrom: Pt = [bx + rx * 0.5, by - ry * 0.45];
    const neckRamp = f.neckSheen ? ink.sheen : f.breast ? ink.breast : f.nape ? ink.sheen : ink.head;
    limb(g, [P(neckFrom[0], neckFrom[1]), P(hx - 1, hy + 2)], hr * 1.7 * s, hr * 1.45 * s, neckRamp);
    if (f.neckSheen && s * 48 >= 26) {
      // The pigeon's iridescent neck: green and purple glints.
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        const x = (neckFrom[0] + (hx - 1 - neckFrom[0]) * t) * s + (pixelHash(k, 1, 3) - 0.5) * hr * s;
        const y = (neckFrom[1] + (hy + 2 - neckFrom[1]) * t) * s + (pixelHash(k, 2, 3) - 0.5) * hr * s;
        g.set(Math.floor(x), Math.floor(y), pixelHash(k, 3, 3) < 0.5 ? ink.sheen[3] : ink.accent);
      }
    }
    if (throat > 0) form(hx - 1, hy + hr * 0.9, hr * (0.55 + throat * 0.3), hr * (0.45 + throat * 0.25), 0, () => (f.breast ? ink.breast : ink.belly), 0.3);
  }

  // --- The folded wing over the back, its coverts in rows, the primaries crossing the tail ---
  const wx = bx - 2;
  const wy = by - 1.5 - wingOpen * 2;
  const wingAngle = angle - 0.18 - wingOpen * 0.25;
  form(wx, wy, rx * 0.8, ry * 0.6, wingAngle, (u, v, x, y) => {
    // Coverts: scalloped rows, each feather edged paler.
    const row = Math.floor((u + 1) * 3.2);
    const edge = pixelHash(Math.floor(x / Math.max(1, 2 * s)), y, 17 + row) < 0.22 && (u * 3.2) % 1 > 0.6;
    switch (f.wing) {
      case 'pigeon-bars':
        if ((u > -0.35 && u < -0.18) || (u > 0.08 && u < 0.24)) return v > -0.5 ? ink.dark : null;
        break;
      case 'white-bar':
        if (v > 0.1 && v < 0.3 && u > -0.25 && u < 0.5 && pixelHash(x, y, 6) < 0.75) return ink.accent;
        if (pixelHash(x, y, 5) < 0.3) return ink.dark;
        break;
      case 'spots':
        if (pixelHash(x, y, 11) < 0.14) return ink.accent;
        if (u < -0.15 && Math.floor(x / Math.max(1, 2 * s)) % 2 === 0) return ink.dark;
        break;
      case 'streaks':
        if (pixelHash(x, Math.floor(y / 2), 13) < 0.3) return ink.dark;
        break;
      case 'sheen':
        if (v < -0.4) return ink.sheen;
        break;
      case 'black-tips':
        break;
    }
    if (edge) return ink.wing[4];
    return u < -0.55 ? ink.dark : ink.wing;
  });
  // The primaries, long and dark, crossing over the tail.
  const tipX = wx - rx * 1.05;
  const tipY = wy + 4 - tailLift * 0.4;
  limb(g, [P(wx - rx * 0.3, wy + 0.5), P(tipX, tipY)], 3.6 * s, 1.4 * s, ink.dark, { bias: f.wing === 'black-tips' ? -1 : -0.2 });
  if (f.wing === 'black-tips' && s * 48 >= 26) g.set(Math.floor((tipX + 1.5) * s), Math.floor((tipY - 0.2) * s), ink.accent);
  if (s * 48 >= 30) {
    // The tertials' pale edges along the wing's back.
    for (let k = 0; k < 3; k++) g.set(Math.floor((wx - rx * (0.2 + k * 0.18)) * s), Math.floor((wy + 1.6 + k * 0.7) * s), ink.wing[4]);
  }

  // --- The head ---
  if (f.crest && pose !== 'sleep') limb(g, [P(hx - hr * 0.2, hy - hr * 0.7), P(hx - hr * 1.3, hy - hr * 1.7)], hr * 1.1 * s, hr * 0.4 * s, ink.cap);
  form(hx, hy, hr, hr * 0.95, 0, (u, v) => {
    const fu = u * beakDir;
    if (f.cap && v < -0.2) return ink.cap;
    if (f.nape && fu < -0.35 && v < 0.3) return ink.sheen;
    // The pale cheek: its own colour close up, shaded like the belly further off (where a flat patch reads as a glare).
    if (f.cheek && v > 0.1 && v < 0.72 && fu > -0.45 && fu < 0.55) return s * 48 >= 24 ? ink.accent : ink.belly;
    if (f.breast && v > 0.6) return ink.breast;
    return ink.head;
  });
  if (pose === 'sleep') return;
  // A bib under the beak; the sparrow's dark eye-stripe.
  if (f.bib) form(hx + beakDir * 1.5, hy + hr * 0.9, hr * 0.4, hr * 0.35, 0, () => ink.dark[1]);
  // The beak: an upper and a lower mandible, parted when singing.
  const bx0 = hx + beakDir * hr * 0.78;
  const by0 = hy + 0.6;
  const len = sp.beakLen;
  const tx = bx0 + beakDir * len * Math.cos(beakTilt);
  const ty = by0 + len * Math.sin(beakTilt) + 0.6;
  limb(g, [P(bx0, by0 - 0.4 - open * 0.3), P(tx, ty - open * 0.6)], sp.beakThick * 0.9 * s, 0.6 * s, ink.beak, { bias: 0.4 });
  limb(g, [P(bx0, by0 + 0.6), P(tx - beakDir * 0.6, ty + open * 0.7)], sp.beakThick * 0.65 * s, 0.5 * s, ink.beak, { bias: -0.6 });
  if (f.cere && s * 48 >= 24) g.set(Math.floor(bx0 * s), Math.floor((by0 - 1.2) * s), ink.accent);
  if (f.wing === 'black-tips' && s * 48 >= 24) g.set(Math.floor((tx - beakDir * 1.6) * s), Math.floor((ty + 0.6) * s), ink.breast[2] === ink.belly[2] ? ink.dark[0] : ink.breast[2]);
  // The eye: dark, with a glint and (some) a pale ring; shut, a curved line.
  const ex = hx + beakDir * hr * 0.28;
  const ey = hy - hr * 0.18;
  if (eyeShut) {
    g.set(Math.floor(ex * s) - 1, Math.floor(ey * s), ink.head[0]);
    g.set(Math.floor(ex * s), Math.floor(ey * s) + 1, ink.head[0]);
    g.set(Math.floor(ex * s) + 1, Math.floor(ey * s), ink.head[0]);
  } else {
    // A glint only once the eye is big enough to hold one; far off, just a dark dot.
    const big = s * 48 >= 34 ? 3 : s * 48 >= 16 ? 2 : 1;
    if (f.eyeRing && big > 1) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) g.set(Math.floor(ex * s) + dx * (big === 3 ? 2 : 1), Math.floor(ey * s) + dy * (big === 3 ? 2 : 1), ink.accent);
    const dark = sp.palette[SLOT.eye] === 0 || sp.palette[SLOT.eye] < 0x303030 ? ink.eyeDark : ink.iris;
    eye(g, ex * s + (big === 3 ? 0.5 : 0), ey * s + (big === 3 ? 0.5 : 0), big, dark, ink.glint);
    if (dark === ink.iris) g.set(Math.floor(ex * s), Math.floor(ey * s), ink.eyeDark);
  }
  if (scratch) {
    // A foot brought up in front of the wing, toes raking at the cheek.
    const legTop = by + ry * 0.4;
    const fy = scratch === 1 ? hy + 2.5 : hy + 4;
    const fx = hx - (scratch === 1 ? 1.5 : 2.5);
    limb(g, [P(bx + 2, legTop), P(bx + 7, legTop - 3), P(fx, fy)], Math.max(1, 1.3 * s), Math.max(1, 1 * s), ink.leg, { bias: 0.3 });
    limb(g, [P(fx, fy), P(fx + 2, fy - (scratch === 1 ? 1.5 : 0.5))], Math.max(1, 0.9 * s), Math.max(1, 0.8 * s), ink.leg);
  }
}

/** The bird in the air close to the window: wings beating through six frames, gliding, or flaring to land. */
function drawFlight(g: PixelGrid, sp: Species, pose: BirdPose, s: number, P: (x: number, y: number) => Pt, ink: Ink, form: Form): void {
  const f = sp.features;
  const span = f.wingSpan ?? 1;
  const flare = pose.startsWith('flare');
  const beat = pose.startsWith('fly-') ? Number(pose.slice(4)) - 1 : pose === 'takeoff-2' ? 1 : -1;
  const tipUp = beat >= 0 ? BEAT_TIP[beat] : flare ? (pose === 'flare-1' ? 16 : 10) : 3;
  const reach = beat >= 0 ? BEAT_REACH[beat] : flare ? 0.8 : 1;
  const angle = flare ? -0.55 : -0.06;
  const bx = 23;
  const by = flare ? 26 : 25;
  const hx = flare ? 34 : 37;
  const hy = flare ? 15 : 21;
  const shoulder: Pt = [bx + 3, by - 2];
  const wing = (far: boolean) => {
    const dy = far ? -1.5 : 0;
    const len = 20 * span * reach * (far ? 0.85 : 1);
    const tipX = shoulder[0] - len * 0.55 + (flare ? 8 : 0);
    const tipY = shoulder[1] - tipUp * (far ? 0.85 : 1) + dy;
    const wristX = shoulder[0] - len * 0.15 + (flare ? 4 : 0);
    const wristY = shoulder[1] - tipUp * 0.45 + dy;
    const ramp = far ? ink.dark : ink.wing;
    // The arm and the hand of the wing, broad at the body, the primaries fanned to the tip.
    limb(g, [P(shoulder[0], shoulder[1] + dy), P(wristX, wristY), P(tipX, tipY)], 11 * s, 3.4 * s, ramp, { bias: far ? -0.8 : 0 });
    if (!far) {
      limb(g, [P(wristX + (tipX - wristX) * 0.2, wristY + (tipY - wristY) * 0.2), P(tipX, tipY)], 4 * s, 2 * s, ink.dark, { bias: f.wing === 'black-tips' ? -1 : -0.3 });
      // The trailing edge of the secondaries.
      limb(g, [P(shoulder[0] - 2, shoulder[1] + 2.5), P((wristX + shoulder[0]) / 2 - 3, (wristY + shoulder[1]) / 2 + 3)], 2 * s, 1.2 * s, ink.dark, { bias: -0.5 });
      if (f.wing === 'white-bar' || f.wing === 'pigeon-bars') limb(g, [P(shoulder[0] - 1, shoulder[1] + 0.5), P(wristX - 1, wristY + 1)], 1.2 * s, 1 * s, f.wing === 'white-bar' ? ([ink.accent, ink.accent, ink.accent, ink.accent, ink.accent] as unknown as Ramp) : ink.dark);
    }
  };
  wing(true);
  // The tail, fanned out in a flare.
  limb(g, [P(bx - sp.bodyRx * 0.7, by + (flare ? 3 : 0.5)), P(bx - sp.bodyRx * 0.7 - sp.tailLen, by + (flare ? 9 : 1.5))], (flare ? 5 : 3.6) * s, (flare ? 6 : 3) * s, ink.dark);
  form(bx, by, sp.bodyRx * 0.95, sp.bodyRy * 0.62, angle, (u, v) => (f.breast && u > 0.1 && v > -0.3 ? ink.breast : v > 0.25 ? ink.belly : ink.body));
  // Legs: tucked in flight, swung forward to land.
  if (flare) {
    for (const off of [0, 2]) limb(g, [P(bx + 2 + off, by + 4), P(bx + 6 + off, by + 10)], Math.max(1, 1.2 * s), Math.max(1, 1 * s), ink.leg);
  }
  limb(g, [P(bx + sp.bodyRx * 0.55, by - 2), P(hx - 1, hy + 1)], sp.headR * 1.5 * s, sp.headR * 1.3 * s, f.breast ? ink.breast : ink.head);
  form(hx, hy, sp.headR * 0.95, sp.headR * 0.9, 0, (u, v) => (f.cap && v < -0.2 ? ink.cap : f.cheek && v > 0.1 && v < 0.7 && u > -0.4 ? ink.accent : ink.head));
  const bx0 = hx + sp.headR * 0.75;
  limb(g, [P(bx0, hy + 0.4), P(bx0 + sp.beakLen, hy + 1)], sp.beakThick * 0.85 * s, 0.6 * s, ink.beak, { bias: 0.3 });
  eye(g, (hx + sp.headR * 0.28) * s, (hy - sp.headR * 0.2) * s, s * 48 >= 34 ? 3 : s * 48 >= 16 ? 2 : 1, ink.eyeDark, ink.glint);
  wing(false);
}

/** Which of the far wing outlines each beat is closest to. */
const MID_WING: Partial<Record<BirdPose, string>> = { 'fly-1': 'fly-up', 'fly-2': 'fly-up', 'fly-3': 'fly-mid', 'fly-6': 'fly-mid', 'fly-4': 'fly-down', 'fly-5': 'fly-down', 'takeoff-2': 'fly-up', 'flare-1': 'fly-up', 'flare-2': 'fly-mid' };

/**
 * A bird in the air at middle distance (10–17 px): a broad wing outline
 * that changes shape through the beat, lit along its leading edge and dark
 * through the primaries, the far wing in shade behind; a shaded body,
 * head, tail and beak, and the eye a dark dot.
 */
function drawFlightMid(g: PixelGrid, sp: Species, pose: BirdPose, s: number, P: (x: number, y: number) => Pt, ink: Ink, form: Form): void {
  const f = sp.features;
  const base = WING_SHAPES[MID_WING[pose] ?? 'glide'];
  const shape = f.wingSpan ? spanWing(base, f.wingSpan) : base;
  const bx = 23;
  const by = 25;
  const hx = 37;
  const hy = 21;
  const wing = (dx: number, dy: number, color: (x: number, y: number, mask: PixelGrid) => number) => {
    const mask = new PixelGrid(g.width, g.height);
    mask.polygon(shape.map(([x, y]) => P(x + dx, y + dy)), 1);
    const [tx, ty] = [(shape[2][0] + shape[3][0]) / 2 + dx, (shape[2][1] + shape[3][1]) / 2 + dy];
    const [sx, sy] = [(shape[0][0] + shape[1][0]) / 2 + dx, (shape[0][1] + shape[1][1]) / 2 + dy];
    const len = Math.hypot(tx - sx, ty - sy) * s || 1;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (!mask.get(x, y)) continue;
        // How far out along the wing (0 at the shoulder, 1 at the tip).
        const t = ((x + 0.5 - sx * s) * (tx - sx) * s + (y + 0.5 - sy * s) * (ty - sy) * s) / (len * len);
        g.set(x, y, color(x, y, mask) ?? 0);
        if (t > 0.62) g.set(x, y, f.wing === 'black-tips' ? ink.dark[0] : ink.dark[mask.get(x + 1, y) ? 1 : 2]);
        else if (f.wing === 'white-bar' && t > 0.3 && t < 0.42) g.set(x, y, ink.accent);
      }
    }
  };
  // The far wing, raised a little behind the body and in shade.
  wing(-2, -1.5, () => ink.dark[1]);
  limb(g, [P(bx - sp.bodyRx * 0.7, by + 0.5), P(bx - sp.bodyRx * 0.7 - sp.tailLen, by + 1.5)], 3.6 * s, 3 * s, ink.dark);
  form(bx, by, sp.bodyRx * 0.95, sp.bodyRy * 0.62, -0.06, (u, v) => (f.breast && u > 0.1 && v > -0.3 ? ink.breast : v > 0.25 ? ink.belly : ink.body));
  limb(g, [P(bx + sp.bodyRx * 0.55, by - 2), P(hx - 1, hy + 1)], sp.headR * 1.5 * s, sp.headR * 1.3 * s, f.breast ? ink.breast : ink.head);
  form(hx, hy, sp.headR * 0.95, sp.headR * 0.9, 0, (_u, v) => (f.cap && v < -0.2 ? ink.cap : ink.head));
  const bx0 = hx + sp.headR * 0.75;
  limb(g, [P(bx0, hy + 0.4), P(bx0 + sp.beakLen, hy + 1)], Math.max(1, sp.beakThick * 0.85 * s), 0.6 * s, ink.beak, { bias: 0.3 });
  g.set(Math.floor((hx + sp.headR * 0.28) * s), Math.floor((hy - sp.headR * 0.2) * s), ink.eyeDark);
  // The near wing over the body: its leading edge catching the light, the trailing edge in shade.
  wing(0, 0, (x, y, mask) => (!mask.get(x + 1, y) || !mask.get(x, y - 1) ? ink.wing[4] : !mask.get(x - 1, y) || !mask.get(x, y + 1) ? ink.wing[1] : ink.wing[2]));
}
