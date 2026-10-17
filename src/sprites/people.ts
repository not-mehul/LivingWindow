import { bayer4, limb, Palette, selOut, shadedEllipse, type Drawn, type Ramp } from './kit';
import { PixelGrid } from './raster';

/**
 * People, drawn at the height they're seen (from a few pixels far up the
 * street to about 40 px right below the window): about seven heads tall,
 * with shoulders, arms and hands, bending legs and a four-step walk, from the
 * front (coming towards us), the back (walking away) or the side (crossing),
 * in a look of their own: hair, top, trousers or skirt, bag, umbrella.
 */

export type PersonFacing = 'front' | 'back' | 'side';
export type PersonPose = 'stand' | 'walk' | 'browse';
export type HairStyle = 'short' | 'long' | 'bun' | 'cap' | 'beanie' | 'crop';
export type TopStyle = 'tee' | 'jacket' | 'coat' | 'dress' | 'hoodie';
export type BagStyle = 'none' | 'shoulder' | 'backpack' | 'tote';

export interface PersonLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  /** Cap or beanie colour. */
  hat: number;
  top: number;
  topStyle: TopStyle;
  bottom: number;
  /** Shorts (or a skirt with a dress) rather than long trousers. */
  shorts: boolean;
  shoes: number;
  bag: BagStyle;
  bagColor: number;
  umbrella: number;
  /** Broader across the shoulders. */
  broad: boolean;
}

const SKINS = [0xf3cfa8, 0xe2b08a, 0xc48c64, 0x9a6844, 0x744a30, 0x553524];
const HAIRS = [0x2a1e16, 0x4a3020, 0x7a5432, 0xc8a868, 0x1a1a1e, 0x9a9aa0, 0xa8482a, 0xe0d8c8];
const TOPS = [0xc8443c, 0x3c6aa8, 0xe0c060, 0x4a8a5a, 0xe8e4dc, 0x6a4a8a, 0xd08040, 0x30343e, 0x8ab0d0, 0xd88aa0, 0x2e5a50, 0x8a3a3a];
const COATS = [0x6a5a48, 0x30343e, 0x8a6a4a, 0x3a4a5e, 0xa8a090, 0x5a2e2e, 0x2e4a3a];
const BOTTOMS = [0x2e3444, 0x4a4a52, 0x2a2a30, 0x6a5a48, 0x3a4a6a, 0x8a7a60, 0x5a6a80];
const HATS = [0xc84a3a, 0x2a2a34, 0x3c6ab0, 0xe0c050, 0x3a7a4a, 0xe8e4dc];
const BAGS = [0x6a4a30, 0x2a2a30, 0x8a6a4a, 0xa83a3a, 0x3a5a7a, 0xd8c8a8];
const UMBRELLAS = [0xd03c3c, 0x2a2a34, 0x3c6ac8, 0xe8c040, 0x3c9a6a, 0xe8e8e8, 0xa04aa0, 0xe87a3a];

export function randomLook(rng: () => number = Math.random): PersonLook {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
  const topStyle = pick<TopStyle>(['tee', 'tee', 'jacket', 'jacket', 'coat', 'dress', 'hoodie']);
  const hair = pick(HAIRS);
  return {
    skin: pick(SKINS),
    hair,
    hairStyle: pick<HairStyle>(['short', 'short', 'long', 'long', 'bun', 'cap', 'beanie', 'crop']),
    hat: pick(HATS),
    top: topStyle === 'coat' ? pick(COATS) : pick(TOPS),
    topStyle,
    bottom: pick(BOTTOMS),
    shorts: topStyle === 'dress' || (topStyle === 'tee' && rng() < 0.3),
    shoes: pick([0x1e1e22, 0x5a3a2a, 0xe8e4dc, 0x8a2a2a, 0x3a3a44]),
    bag: pick<BagStyle>(['none', 'none', 'none', 'shoulder', 'backpack', 'tote']),
    bagColor: pick(BAGS),
    umbrella: pick(UMBRELLAS),
    broad: rng() < 0.45,
  };
}

interface PersonRamps {
  skin: Ramp;
  hair: Ramp;
  hat: Ramp;
  top: Ramp;
  bottom: Ramp;
  shoes: Ramp;
  bag: Ramp;
  umbrella: Ramp;
  ink: number;
  white: number;
}

function personPalette(look: PersonLook): { palette: Palette; r: PersonRamps } {
  const palette = new Palette();
  const ink = palette.add(0x241c22);
  const r: PersonRamps = {
    skin: palette.inkedRamp(look.skin, 0x4a2e24, 0.8),
    hair: palette.ramp(look.hair, 0.9),
    hat: palette.ramp(look.hat),
    top: palette.ramp(look.top),
    bottom: palette.ramp(look.bottom),
    shoes: palette.ramp(look.shoes),
    bag: palette.ramp(look.bagColor),
    umbrella: palette.ramp(look.umbrella, 1.1),
    ink,
    white: palette.add(0xf4efe6),
  };
  return { palette, r };
}

/** Pixel height of a person including an umbrella's canopy above them. */
function canopyRise(h: number): number {
  return Math.max(1, Math.round(h * 0.2));
}

/**
 * A person `height` px tall (feet on the bottom row, plus an umbrella's
 * canopy above when they carry one), facing right in side view (flip for
 * left), or towards or away from us. `frame` steps the walk (0–3).
 */
export function drawPerson(look: PersonLook, facing: PersonFacing, pose: PersonPose, frame: number, umbrella: boolean, height: number): Drawn {
  const h = Math.max(3, Math.round(height));
  const { palette, r } = personPalette(look);
  const grid = h < 11 ? drawTiny(look, r, facing, pose, frame, umbrella, h) : drawFull(look, r, facing, pose, frame, umbrella, h);
  if (h >= 11) selOut(grid, palette, { bottomHeavy: h < 18 });
  return { grid, palette };
}

// --- Far away: a few hand-placed pixels --------------------------------

function drawTiny(look: PersonLook, r: PersonRamps, facing: PersonFacing, pose: PersonPose, frame: number, umbrella: boolean, h: number): PixelGrid {
  const rise = umbrella ? canopyRise(h) : 0;
  const w = h >= 7 ? 5 : 3;
  const g = new PixelGrid(w, h + rise);
  const top = rise;
  const cx = Math.floor(w / 2);
  const headRows = h >= 7 ? 2 : 1;
  const legs = Math.max(1, Math.round(h * 0.36));
  const torsoRows = Math.max(1, h - headRows - legs);
  const torsoW = h >= 6 ? 2 : 1;
  const tx = torsoW === 2 ? cx - (facing === 'side' ? 1 : 0) : cx;
  const hat = look.hairStyle === 'cap' || look.hairStyle === 'beanie';
  // Head: hair on top (and all over from behind), the face below it.
  const hairColor = hat ? r.hat[2] : r.hair[2];
  if (headRows === 2) {
    g.set(cx, top, hairColor);
    if (h >= 9) g.set(cx - 1, top, hairColor);
    g.set(cx, top + 1, facing === 'back' ? r.hair[1] : r.skin[2]);
    if (h >= 9) g.set(cx - 1, top + 1, facing === 'back' || facing === 'side' ? r.hair[1] : r.skin[1]);
  } else g.set(cx, top, facing === 'back' ? r.hair[2] : r.skin[2]);
  // Body: lit on the left, shaded on the right.
  const torsoY = top + headRows;
  const long = look.topStyle === 'coat' || look.topStyle === 'dress';
  for (let y = 0; y < torsoRows + (long && legs > 1 ? 1 : 0); y++) {
    for (let x = 0; x < torsoW; x++) g.set(tx + x, torsoY + y, x === torsoW - 1 && torsoW > 1 ? r.top[1] : r.top[2]);
  }
  if (look.bag === 'backpack' && facing !== 'front' && torsoRows >= 2) g.set(facing === 'side' ? tx - 1 : tx + 1, torsoY, r.bag[1]);
  // Legs: apart on the stride, together as they pass.
  const legY = torsoY + torsoRows;
  const stride = pose === 'walk' && frame % 2 === 0;
  const leg = look.topStyle === 'dress' || look.shorts ? r.skin[1] : r.bottom[1];
  for (let i = 0; i < legs; i++) {
    const y = legY + i;
    if (long && i === 0 && legs > 1) continue;
    const last = i === legs - 1;
    const spread = stride && i >= legs - 2 && legs >= 2 ? 1 : 0;
    const left = tx - spread;
    const right = tx + torsoW - 1 + spread;
    const c = last ? r.shoes[1] : leg;
    if (facing === 'side' && stride) {
      g.set(Math.min(left, right - 1), y, c);
      g.set(right, y, last ? r.shoes[2] : r.bottom[2]);
    } else if (torsoW === 1 && !spread) g.set(tx, y, c);
    else {
      // Front and back: one leg steps (its foot a row lower), the other lifts.
      g.set(left, y, frame === 1 && last && facing !== 'side' ? 0 : c);
      g.set(right, y, frame === 3 && last && facing !== 'side' ? 0 : c);
    }
  }
  // Umbrella: a canopy over the head, lit on the left.
  if (umbrella) {
    for (let x = 0; x < w; x++) g.set(x, rise - 1, x === 0 ? r.umbrella[3] : x === w - 1 ? r.umbrella[1] : r.umbrella[2]);
    if (rise >= 2) for (let x = 1; x < w - 1; x++) g.set(x, rise - 2, r.umbrella[3]);
  }
  return g;
}

// --- Near: shaded figures ---------------------------------------------

type Pt = readonly [number, number];

/** Where each foot and knee go through the walk, for the side view (in units of a head, from the hip). */
const SIDE_LEGS: Array<{ near: [Pt, Pt]; far: [Pt, Pt]; bob: number }> = [
  // Contact: near leg forward, far leg back.
  { near: [[0.45, 1.75], [0.85, 3.55]], far: [[-0.3, 1.8], [-0.75, 3.5]], bob: 0 },
  // Passing: near leg planted, far leg swinging through.
  { near: [[0.08, 1.8], [0.05, 3.6]], far: [[0.4, 1.5], [-0.15, 2.95]], bob: -0.12 },
  { near: [[-0.3, 1.8], [-0.75, 3.5]], far: [[0.45, 1.75], [0.85, 3.55]], bob: 0 },
  { near: [[0.4, 1.5], [-0.15, 2.95]], far: [[0.08, 1.8], [0.05, 3.6]], bob: -0.12 },
];

function drawFull(look: PersonLook, r: PersonRamps, facing: PersonFacing, pose: PersonPose, frame: number, umbrella: boolean, h: number): PixelGrid {
  const u = h / 7;
  const full = h >= 22;
  const rise = umbrella ? Math.round(1.9 * u) : 0;
  const w = Math.ceil(u * (umbrella ? 4.4 : 3.4)) + 2;
  const g = new PixelGrid(w, h + rise + 1);
  const cx = w / 2;
  const f = pose === 'walk' ? ((frame % 4) + 4) % 4 : -1;
  const side = facing === 'side';
  const bob = side && f >= 0 ? SIDE_LEGS[f].bob * u : f === 1 || f === 3 ? -0.1 * u : 0;
  const Y = (v: number) => rise + v * u + bob;
  const ground = rise + h - 0.5;
  const hipY = Y(3.55);
  const shoulderY = Y(1.4);
  const shoulderHalf = (look.broad ? 0.95 : 0.82) * u;
  const hipHalf = 0.58 * u;
  const dress = look.topStyle === 'dress';
  const coat = look.topStyle === 'coat';
  const bare = (look.shorts || dress) && !coat;
  const legRamp = bare ? r.skin : r.bottom;
  const legW = Math.max(2, 0.5 * u);
  const sleeves = look.topStyle !== 'tee' && look.topStyle !== 'dress';

  // --- Legs (behind everything) ---
  const legPaths: Array<{ path: Pt[]; near: boolean }> = [];
  if (side) {
    const L = f >= 0 ? SIDE_LEGS[f] : { near: [[0.1, 1.8], [0.15, 3.6]] as [Pt, Pt], far: [[-0.1, 1.8], [-0.15, 3.6]] as [Pt, Pt] };
    const hx = cx - 0.05 * u;
    const leg = (k: [Pt, Pt]): Pt[] => [
      [hx, hipY],
      [hx + k[0][0] * u, hipY + k[0][1] * u],
      [hx + k[1][0] * u, Math.min(ground - 0.4 * u, hipY + k[1][1] * u)],
    ];
    legPaths.push({ path: leg(L.far), near: false }, { path: leg(L.near), near: true });
  } else {
    // From the front or back, a stepping foot comes down and out a little; the other lifts.
    for (const s of [-1, 1]) {
      const hx = cx + s * hipHalf * 0.62;
      const stepping = (f === 0 && s === -1) || (f === 2 && s === 1);
      const lifting = (f === 0 && s === 1) || (f === 2 && s === -1);
      const lift = lifting ? 0.35 * u : f === 1 || f === 3 ? 0.1 * u : 0;
      const out = stepping ? 0.12 * u * s : 0;
      const footY = ground - 0.4 * u - lift;
      legPaths.push({
        path: [
          [hx, hipY],
          [hx + out * 0.5 + (lifting ? 0.08 * u * s : 0), (hipY + footY) / 2],
          [hx + out, footY],
        ],
        near: s === -1,
      });
    }
  }
  for (const { path, near } of legPaths) {
    const bias = near ? 0 : -0.9;
    // Thigh, then shin: trousers all the way, or bare below the hem.
    limb(g, path.slice(0, 2), legW * 1.1, legW, coat && !bare ? r.bottom : dress ? r.skin : legRamp, { bias, max: 3 });
    limb(g, path.slice(1), legW, legW * 0.85, legRamp, { bias, max: 3 });
    if (look.shorts && !dress && !coat) limb(g, path.slice(0, 2), legW * 1.25, legW * 1.1, r.bottom, { bias, max: 3 });
    // Shoe.
    const [ax, ay] = path[path.length - 1];
    const toe = side ? 0.55 * u : 0.05 * u;
    const shoeH = Math.max(1, 0.26 * u);
    for (let y = Math.floor(ay); y <= Math.floor(ay + shoeH); y++) {
      for (let x = Math.floor(ax - 0.3 * u); x <= Math.floor(ax + toe + 0.25 * u); x++) g.set(x, y, near ? r.shoes[y === Math.floor(ay) ? 3 : 2] : r.shoes[1]);
    }
  }

  // --- Far arm (side view) and backpack, behind the body ---
  const armW = Math.max(1.6, 0.42 * u);
  const swing = f < 0 ? 0 : [1, 0, -1, 0][f];
  const sleeve = sleeves ? r.top : r.skin;
  const drawArm = (sx: number, sy: number, elbow: Pt, hand: Pt, bias: number) => {
    const e: Pt = [sx + elbow[0] * u, sy + elbow[1] * u];
    const hd: Pt = [sx + hand[0] * u, sy + hand[1] * u];
    limb(g, [[sx, sy], e], armW * 1.1, armW, look.topStyle === 'tee' || sleeves || dress ? r.top : r.skin, { bias, max: 3 });
    limb(g, [e, hd], armW, armW * 0.9, sleeve, { bias, max: 3 });
    // Hand.
    shadedEllipse(g, hd[0], hd[1] + 0.15 * u, Math.max(0.6, 0.24 * u), Math.max(0.6, 0.28 * u), r.skin, { dither: false, bias: bias + 0.4, max: 3 });
    return hd;
  };
  if (side) drawArm(cx, shoulderY + 0.2 * u, [-0.2 * swing, 1.15], [0.55 * swing, 2.25], -1);
  if (look.bag === 'backpack' && facing !== 'front') {
    const bx = side ? cx - 0.75 * u : cx;
    shadedEllipse(g, bx, Y(2.3), side ? 0.45 * u : 0.7 * u, 0.85 * u, r.bag, { dither: full });
  }

  // --- Body ---
  const torsoTop = shoulderY - 0.1 * u;
  // The neck, under the collar.
  const neckX = side ? cx : cx;
  limb(g, [[neckX, Y(0.95)], [neckX, torsoTop + 0.3 * u]], 0.42 * u, 0.42 * u, r.skin, { bias: -0.6, max: 2 });
  const hem = coat ? Y(5.3) : dress ? Y(5.0) : hipY + 0.15 * u;
  const halfTop = side ? 0.48 * u : shoulderHalf;
  const halfHem = side ? (coat || dress ? 0.65 : 0.45) * u : coat || dress ? hipHalf * 1.35 : hipHalf;
  for (let y = Math.floor(torsoTop); y <= Math.floor(hem); y++) {
    const t = (y + 0.5 - torsoTop) / Math.max(1, hem - torsoTop);
    // Shoulders round off at the top, the body narrows to the waist and flares to a skirt or coat hem.
    const waist = coat || dress ? 0 : Math.sin(Math.min(1, t) * Math.PI) * 0.08 * u;
    let half = halfTop + (halfHem - halfTop) * Math.min(1, t) - waist;
    if (t < 0.12) half *= 0.82 + t * 1.5;
    const ox = side ? -0.05 * u : 0;
    for (let x = Math.floor(cx + ox - half); x <= Math.floor(cx + ox + half - 0.01); x++) {
      const s = (x + 0.5 - (cx + ox)) / Math.max(0.5, half);
      const nx = Math.max(-1, Math.min(1, s));
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx * 0.8));
      const ny = t < 0.15 ? -0.6 : 0.1;
      const lambert = nx * -0.5 + ny * -0.7 + nz * 0.5;
      const v = Math.max(0, Math.min(3, (lambert * 0.6 + 0.45) * 4));
      const step = Math.min(3, Math.round(v));
      g.set(x, y, r.top[step]);
    }
  }
  // Coat or jacket opening and a belt line, from the front.
  if (facing === 'front' && full && (coat || look.topStyle === 'jacket')) {
    for (let y = Math.floor(torsoTop + 0.4 * u); y <= Math.floor(hem) - 1; y++) g.set(Math.floor(cx), y, r.top[1]);
  }
  if (look.topStyle === 'hoodie' && facing !== 'front') shadedEllipse(g, side ? cx - 0.45 * u : cx, torsoTop + 0.15 * u, 0.5 * u, 0.35 * u, r.top, { dither: false, bias: -0.5 });

  // --- Head ---
  const headCy = Y(0.6);
  const headRx = (side ? 0.52 : 0.5) * u;
  const headRy = 0.6 * u;
  const hx = side ? cx + 0.1 * u : cx;
  const hairBack = look.hairStyle === 'long';
  if (hairBack) {
    // Long hair falls behind the shoulders.
    const fall = side ? cx - 0.3 * u : cx;
    for (let y = Math.floor(headCy); y <= Math.floor(Y(2.1)); y++) {
      const half = (side ? 0.32 : 0.55) * u * (facing === 'back' ? 1.05 : 1);
      for (let x = Math.floor(fall - half); x <= Math.floor(fall + half - 0.01); x++) {
        if (facing === 'front' && Math.abs(x + 0.5 - fall) < 0.3 * u && y > headCy) continue;
        g.set(x, y, y > Y(1.7) ? r.hair[1] : r.hair[2]);
      }
    }
  }
  shadedEllipse(g, hx, headCy, headRx, headRy, r.skin, { dither: false, max: 3 });
  // Hair, cap or beanie over the head.
  const style = look.hairStyle;
  const hat = style === 'cap' || style === 'beanie';
  const hr = hat ? r.hat : r.hair;
  g.ellipse(hx, headCy, headRx + 0.05, headRy + 0.05, (uu, vv, x, y) => {
    let covered: boolean;
    if (facing === 'back') covered = vv < 0.55;
    else if (side) covered = vv < -0.25 || (uu < -0.15 && vv < 0.45) || (style === 'long' && uu < 0.1 && vv < 0.7);
    else covered = vv < -0.3 || (Math.abs(uu) > 0.78 && vv < 0.25) || (style === 'long' && Math.abs(uu) > 0.7 && vv < 0.8);
    if (style === 'crop') covered = vv < -0.45 || (facing === 'back' && vv < 0.2) || (side && uu < -0.4 && vv < 0.2);
    if (hat) covered = vv < (style === 'beanie' ? -0.15 : -0.3) || (facing === 'back' && vv < 0.35);
    if (!covered) return 0;
    const lit = uu * -0.55 + vv * -0.75;
    return hr[lit > 0.45 ? 3 : lit > -0.2 ? 2 : 1] + (bayer4(x, y) > 0.9 && full ? 0 : 0);
  });
  if (style === 'bun') shadedEllipse(g, side ? hx - 0.45 * u : hx, headCy - 0.55 * u, 0.3 * u, 0.28 * u, r.hair, { dither: false, max: 3 });
  if (style === 'cap' && facing !== 'back') {
    // The brim, out over the eyes.
    const by = Math.floor(headCy - 0.2 * u);
    if (side) for (let x = Math.floor(hx); x <= Math.floor(hx + headRx + 0.45 * u); x++) g.set(x, by, r.hat[1]);
    else for (let x = Math.floor(hx - headRx); x <= Math.floor(hx + headRx - 0.01); x++) g.set(x, by, r.hat[1]);
  }
  // Face.
  if (facing !== 'back' && h >= 18) {
    const ey = headCy + 0.05 * u;
    // Small dark eyes (a glint at this size reads as sunglasses), and the nose catching the light.
    if (side) {
      g.set(Math.floor(hx + headRx * 0.5), Math.floor(ey), r.ink);
      if (h >= 26) g.set(Math.floor(hx + headRx + 0.1), Math.floor(ey + 0.25 * u), r.skin[2]);
    } else {
      g.set(Math.floor(hx - 0.25 * u), Math.floor(ey), r.ink);
      g.set(Math.floor(hx + 0.22 * u), Math.floor(ey), r.ink);
      if (h >= 30) g.set(Math.floor(hx), Math.floor(ey + 0.3 * u), r.skin[1]);
    }
  }

  // --- Near arm(s), in front of the body ---
  if (side) {
    if (umbrella) drawArm(cx + 0.05 * u, shoulderY + 0.2 * u, [0.45, 0.75], [0.75, 0.15], 0);
    else if (pose === 'browse') drawArm(cx + 0.05 * u, shoulderY + 0.2 * u, [0.3, 1.0], [1.05, 1.35], 0);
    else drawArm(cx + 0.05 * u, shoulderY + 0.2 * u, [0.2 * swing, 1.15], [-0.55 * swing, 2.25], 0);
  } else {
    for (const s of [-1, 1]) {
      const ax = cx + s * (shoulderHalf - 0.15 * u);
      const holding = umbrella && s === 1;
      // Arms swing forward and back: from in front, the forward hand comes up and in a little.
      const fwd = f < 0 ? 0 : (s === -1 ? 1 : -1) * swing;
      if (holding) drawArm(ax, shoulderY + 0.15 * u, [0.15 * s, 0.9], [-0.15 * s, 0.6], -0.3);
      else if (pose === 'browse' && s === 1) drawArm(ax, shoulderY + 0.15 * u, [0.1 * s, 1.0], [-0.2 * s, 1.5], -0.3);
      else drawArm(ax, shoulderY + 0.15 * u, [0.12 * s, 1.1], [(0.15 - 0.12 * fwd) * s, 2.15 - 0.2 * fwd], s === -1 ? 0 : -0.5);
    }
  }
  // Bags hang over the body.
  if (look.bag === 'shoulder' || look.bag === 'tote') {
    const bx = side ? cx - 0.35 * u : cx + (facing === 'front' ? 1 : -1) * (shoulderHalf + 0.1 * u);
    const by = look.bag === 'tote' ? Y(3.1) : Y(3.3);
    const bw = look.bag === 'tote' ? 0.6 * u : 0.5 * u;
    for (let y = Math.floor(by - 0.4 * u); y <= Math.floor(by + 0.45 * u); y++) {
      for (let x = Math.floor(bx - bw / 2); x <= Math.floor(bx + bw / 2); x++) g.set(x, y, r.bag[y === Math.floor(by - 0.4 * u) ? 3 : x > bx ? 1 : 2]);
    }
    if (full) limb(g, [[bx, by - 0.4 * u], [cx + (side ? 0.2 * u : -0.3 * u), shoulderY]], 1, 1, r.bag, { max: 1 });
  } else if (look.bag === 'backpack' && facing === 'front' && full) {
    // Just the straps.
    for (const s of [-1, 1]) limb(g, [[cx + s * 0.5 * u, shoulderY], [cx + s * 0.55 * u, Y(2.6)]], 1, 1, r.bag, { max: 1 });
  }

  // --- Umbrella ---
  if (umbrella) {
    const ux = side ? cx + 0.55 * u : cx + 0.15 * u;
    const top = 0.5;
    const rim = rise + 0.35 * u;
    const half = 2.05 * u;
    // Shaft down to the hand.
    for (let y = Math.floor(top + 0.5 * u); y <= Math.floor(side ? Y(1.6) : Y(2.0)); y++) g.set(Math.floor(ux), y, r.ink);
    // Canopy: a dome, panels alternately lit, a scalloped rim.
    const panels = h >= 26 ? 6 : 4;
    for (let y = Math.floor(top); y <= Math.floor(rim + 0.4 * u); y++) {
      for (let x = Math.floor(ux - half); x <= Math.floor(ux + half); x++) {
        const dx = (x + 0.5 - ux) / half;
        const dy = (y + 0.5 - rim) / (rim - top);
        if (dx * dx + dy * dy > 1 || dy > 0) {
          // Scallops hanging below the rim.
          const panel = (dx + 1) * panels * 0.5;
          const sc = 0.4 * u * Math.sin((panel % 1) * Math.PI);
          if (dy > 0 && Math.abs(dx) <= 1 && y + 0.5 - rim < sc) g.set(x, y, r.umbrella[1]);
          continue;
        }
        const panel = Math.floor((dx + 1) * panels * 0.5);
        const lit = -dx * 0.5 - dy * 0.6;
        const step = (lit > 0.35 ? 3 : lit > -0.1 ? 2 : 1) + (panel % 2 === 0 ? 0 : -1);
        g.set(x, y, r.umbrella[Math.max(0, Math.min(4, step))]);
      }
    }
    g.set(Math.floor(ux), Math.floor(top) - 1 >= 0 ? Math.floor(top) - 1 : 0, r.ink);
  }
  return g;
}

/** The shape of a person's look stays put; only the pose changes frame to frame. */
export function personKey(id: number, facing: PersonFacing, pose: PersonPose, frame: number, umbrella: boolean, height: number): string {
  return `${id}:${facing}:${pose}:${pose === 'walk' ? frame % 4 : 0}:${umbrella ? 1 : 0}:${height}`;
}

/**
 * A busker facing us with a guitar slung across them, `height` px tall;
 * `frame` (0–1) moves the strumming hand.
 */
export function drawBusker(look: PersonLook, frame: number, height: number): Drawn {
  const drawn = drawPerson(look, 'front', 'stand', 0, false, height);
  const { grid: g, palette } = drawn;
  const h = Math.max(3, Math.round(height));
  const u = h / 7;
  const cx = g.width / 2;
  const wood = palette.ramp(0xb07a40);
  const ink = palette.add(0x241c18);
  const skin = palette.ramp(look.skin);
  if (h < 11) {
    g.set(Math.floor(cx), Math.floor(3.3 * u), wood[2]);
    return drawn;
  }
  // The neck, up across the chest to the left; the body at the right hip.
  const bx = cx + 0.4 * u;
  const by = 3.35 * u;
  limb(g, [[bx - 0.2 * u, by - 0.2 * u], [cx - 1.25 * u, 2.25 * u]], Math.max(1, 0.3 * u), Math.max(1, 0.25 * u), wood, { bias: -1, max: 1 });
  shadedEllipse(g, bx, by, 0.78 * u, 0.66 * u, wood, { dither: false, min: 1 });
  g.set(Math.floor(bx - 0.1 * u), Math.floor(by - 0.05 * u), ink);
  // The strumming hand over the sound hole, and the fretting hand up the neck.
  const strum = frame % 2 === 0 ? -0.25 : 0.2;
  g.set(Math.floor(bx + 0.15 * u), Math.floor(by + strum * u), skin[3]);
  g.set(Math.floor(cx - 1.15 * u), Math.floor(2.3 * u), skin[2]);
  return drawn;
}
