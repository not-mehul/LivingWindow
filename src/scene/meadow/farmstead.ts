import { lerpColor, scaleColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createRng, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import { cropState, dayOfYear, mazeOpen, type CropState } from '../../sim/crops';
import type { Obstacle } from '../../sim/groundWalker';
import { meadowCreek, meadowPath, meadowPlane } from '../../sim/meadowGeometry';
import { pixelHash } from '../../sprites/raster';
import { valueNoise } from '../common/paint';
import { BROADLEAF, drawBroadleaf, hazePalette } from '../common/trees';
import type { Placed } from './meadowGenerator';

/**
 * The small farm across the field behind the hen house, between the path and
 * the creek: a white farmhouse and a red barn by the tree line with a silo
 * and a wind pump, a maize field with a maze cut through it on the rise, a
 * wheat field, a vegetable patch behind a post-and-rail fence, a little
 * orchard over the path, and the farm track winding between them. The fields
 * follow the farming year, so they change over the weeks.
 */

export interface FarmContext {
  ground: PixelBuffer;
  standing: Placed[];
  obstacles: Obstacle[];
  ledges: Ledge[];
  /** Haze colour, and how much of it at a world row. */
  haze: number;
  hazeAt: (y: number) => number;
  birdZ: (y: number) => number;
  drawBush: (w: number, h: number, seed: number, haze: number) => PixelBuffer;
  /** The hen house on the ground, for the fence beside its run. */
  coop: { gx: number; depth: number };
  date: Date;
  seed: number;
}

export interface FarmLayout {
  /** The wind pump's rotor hub (world px), its radius, and the haze it's seen through. */
  windmill: { x: number; y: number; radius: number; haze: number; baseY: number };
  /** The farmhouse's windows (world px, top-left), lit in the evening. */
  windows: Array<{ x: number; y: number; w: number; h: number }>;
  /** The row the farmhouse stands on (for drawing its lights just over it). */
  houseBaseY: number;
  /** The top of the farmhouse chimney, for its smoke. */
  chimney: { x: number; y: number; scale: number };
  /** The scarecrow's spot in the vegetable patch. */
  scarecrow: { x: number; baseY: number; height: number };
  /** The vegetable patch's rows (world px), where crows come down to peck. */
  patch: { x0: number; x1: number; y0: number; y1: number };
  /** The farm track, on the ground, from the path to the farmyard. */
  track: Array<{ gx: number; depth: number }>;
  crops: { wheat: CropState; maize: CropState; cabbage: CropState };
}

interface Field {
  gx0: number;
  gx1: number;
  d0: number;
  d1: number;
}

const project = (gx: number, depth: number) => meadowPlane.project(gx, depth);
const EARTH_DARK = 0x6a5034;
const EARTH = 0x86683e;
const EARTH_LIGHT = 0x9c7c4c;

// Where it all goes (ground px at depth 1, and depth).
const MAIZE: Field = { gx0: 560, gx1: 1000, d0: 4.9, d1: 8.4 };
const WHEAT: Field = { gx0: 1050, gx1: 1700, d0: 4.9, d1: 7.4 };
const PATCH: Field = { gx0: 620, gx1: 1040, d0: 3.75, d1: 4.6 };
/** The maize stands on a rise: its far edge shows this much higher on screen. */
const MAIZE_TILT = 9;

export function layFarm(ctx: FarmContext): FarmLayout {
  const rng = createRng(ctx.seed + 31);
  const crops = { wheat: cropState('wheat', ctx.date), maize: cropState('maize', ctx.date), cabbage: cropState('cabbage', ctx.date) };
  const hz = (c: number, y: number, k = 0.85) => lerpColor(c, ctx.haze, ctx.hazeAt(y) * k);
  const put = (art: PixelBuffer, x: number, baseY: number, sway = 0, anchorX = art.width / 2, anchorY = art.height) => {
    ctx.standing.push({ art, x: Math.round(x - anchorX), y: Math.round(baseY - anchorY), baseY: Math.round(baseY), sway, haze: 0 });
  };
  const clearOfWater = (x: number, y: number) => !meadowCreek.contains(x, y, 14) && x < meadowCreek.centreX(y) - 4;
  const clearOfPath = (x: number, y: number) => !meadowPath.contains(x, y, 10);

  // --- The farm track: off the path, along the headland between the fields, and up to the yard ---
  const pathGx = meadowPath.gxAt(4.75);
  const track = [
    { gx: pathGx, depth: 4.75 },
    { gx: 1025, depth: 4.75 },
    { gx: 1025, depth: 9.4 },
    { gx: 1500, depth: 9.4 },
  ];
  paintTrack(ctx, track, hz);
  // The farmyard: packed earth in front of the buildings.
  paintGround(ctx, { gx0: 1300, gx1: 2700, d0: 9.1, d1: 10.4 }, (u, _v, x, y) => (clearOfWater(x, y) ? hz(pixelHash(x, y, 51) < 0.2 ? EARTH_LIGHT : u > 0.92 ? 0x7a9a4a : EARTH, y) : null));

  // --- The fields ---
  layWheat(ctx, crops.wheat, hz, clearOfWater, put, rng);
  layMaize(ctx, crops.maize, ctx.date, hz, clearOfPath);
  layPatch(ctx, crops.cabbage, hz, clearOfWater);
  // A post-and-rail fence along the front of the vegetable patch, with a gate.
  fence(ctx, { gx: PATCH.gx0 - 20, depth: PATCH.d0 - 0.05 }, { gx: PATCH.gx1, depth: PATCH.d0 - 0.05 }, hz, clearOfWater, 0.18);
  const patchNear = project(PATCH.gx0, PATCH.d0);
  const patchFar = project(PATCH.gx1, PATCH.d1);

  // --- The buildings, by the tree line ---
  const house = farmhouse(project(1650, 9.6), hz);
  put(house.art, house.at.x, house.at.y, 0, house.anchorX);
  const barnAt = project(2250, 9.2);
  const barnArt = barn(barnAt.scale, (c) => hz(c, barnAt.y));
  put(barnArt.art, barnAt.x, barnAt.y, 0, barnArt.anchorX);
  ctx.ledges.push({ x0: Math.round(barnAt.x - barnArt.ridge), x1: Math.round(barnAt.x + barnArt.ridge), y: Math.round(barnAt.y - barnArt.art.height + 1), layer: 'far', kind: 'roof', z: ctx.birdZ(barnAt.y) });
  ctx.ledges.push({ x0: Math.round(house.at.x - house.ridge), x1: Math.round(house.at.x + house.ridge), y: Math.round(house.at.y - house.roofTop), layer: 'far', kind: 'roof', z: ctx.birdZ(house.at.y) });
  const siloAt = project(2620, 9.6);
  put(silo(siloAt.scale, (c) => hz(c, siloAt.y)), siloAt.x, siloAt.y);
  const tankAt = project(1330, 9.3);
  put(fuelTank(tankAt.scale, (c) => hz(c, tankAt.y)), tankAt.x, tankAt.y);
  const cartAt = project(1750, 8.0);
  put(hayCart(cartAt.scale, (c) => hz(c, cartAt.y)), cartAt.x, cartAt.y);
  // Round bales stacked by the barn.
  for (const [gx, d] of [
    [1960, 8.5],
    [1900, 8.4],
    [1930, 8.25],
  ] as const) {
    const at = project(gx, d);
    put(roundBale(at.scale, (c) => hz(c, at.y)), at.x, at.y);
  }
  // The wind pump, at the end of the yard: a lattice tower; its rotor turns in the scene.
  const pumpAt = project(2650, 10.6);
  const pump = windPumpTower(pumpAt.scale, (c) => hz(c, pumpAt.y));
  put(pump.art, pumpAt.x, pumpAt.y);
  const windmill = { x: Math.round(pumpAt.x), y: Math.round(pumpAt.y - pump.hubY), radius: pump.radius, haze: ctx.hazeAt(pumpAt.y), baseY: Math.round(pumpAt.y) };

  // --- More green: bushes round the yard, a hedgerow beyond the orchard, and the orchard ---
  for (const [gx, d, w, h] of [
    [1480, 9.0, 9, 5],
    [2400, 10.0, 8, 5],
    [2800, 10.2, 12, 6],
    [1180, 8.0, 7, 4],
  ] as const) {
    const at = project(gx, d);
    if (!clearOfWater(at.x, at.y)) continue;
    const art = ctx.drawBush(w, h, Math.round(gx), ctx.hazeAt(at.y) * 0.7);
    put(art, at.x, at.y + 1, 0.5);
  }
  for (let gx = -800; gx < -140; gx += randomRange(rng, 45, 70)) {
    const at = project(gx, 10.4);
    const art = ctx.drawBush(randomRange(rng, 6, 10), randomRange(rng, 3.5, 5), Math.round(gx * 7), ctx.hazeAt(at.y) * 0.7);
    put(art, at.x, at.y + 1, 0.4);
  }
  orchard(ctx, ctx.date, put, rng);

  // --- The hen run: rails between the posts by the hen house, and chicken wire ---
  coopRun(ctx);

  // A water trough out on the pasture by the hen house, where the cows come to drink.
  const troughAt = project(345, 1.95);
  put(trough(troughAt.scale), troughAt.x, troughAt.y);
  ctx.obstacles.push({ gx: 345, depth: 1.95, r: 26 });
  ctx.ledges.push({ x0: Math.round(troughAt.x - 6 * troughAt.scale * 3), x1: Math.round(troughAt.x + 6 * troughAt.scale * 3), y: Math.round(troughAt.y - 9 * troughAt.scale * 2.4), layer: 'mid', kind: 'post', z: ctx.birdZ(troughAt.y) });

  const scareAt = project(820, 4.15);
  return {
    windmill,
    windows: house.windows,
    houseBaseY: Math.round(house.at.y),
    chimney: house.chimney,
    scarecrow: { x: Math.round(scareAt.x), baseY: Math.round(scareAt.y), height: Math.round(64 * scareAt.scale) },
    patch: { x0: Math.round(patchNear.x), x1: Math.round(Math.min(meadowCreek.centreX(patchNear.y) - 16, project(PATCH.gx1, PATCH.d0).x)), y0: Math.round(patchFar.y), y1: Math.round(patchNear.y) },
    track,
    crops,
  };
}

// --- Painting on the ground ----------------------------------------------------------

/** Paint over a rectangle of ground; `paint` gets (u across, v away, x, y) and may leave a pixel. */
function paintGround(ctx: FarmContext, f: Field, paint: (u: number, v: number, x: number, y: number) => number | null): void {
  const yNear = Math.floor(project(0, f.d0).y);
  const yFar = Math.ceil(project(0, f.d1).y);
  for (let y = yFar; y <= yNear; y++) {
    const depth = meadowPlane.depthAtY(y + 0.5);
    const v = (depth - f.d0) / (f.d1 - f.d0);
    if (v < 0 || v > 1) continue;
    const x0 = Math.floor(meadowPlane.vanishX + f.gx0 / depth);
    const x1 = Math.ceil(meadowPlane.vanishX + f.gx1 / depth);
    for (let x = x0; x <= x1; x++) {
      const u = ((x + 0.5 - meadowPlane.vanishX) * depth - f.gx0) / (f.gx1 - f.gx0);
      if (u < 0 || u > 1) continue;
      const c = paint(u, v, x, y);
      if (c !== null) ctx.ground.set(x, y, c);
    }
  }
}

/** The track: worn earth along a polyline of ground points, about the width of a cart. */
function paintTrack(ctx: FarmContext, pts: FarmLayout['track'], hz: (c: number, y: number) => number): void {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const across = a.depth === b.depth;
    const f: Field = across
      ? { gx0: Math.min(a.gx, b.gx), gx1: Math.max(a.gx, b.gx) + 30, d0: a.depth - 0.11, d1: a.depth + 0.11 }
      : { gx0: a.gx - 26, gx1: a.gx + 26, d0: Math.min(a.depth, b.depth) - 0.1, d1: Math.max(a.depth, b.depth) };
    paintGround(ctx, f, (u, v, x, y) => {
      if (meadowCreek.contains(x, y, 6)) return null;
      // Two ruts and a grassy crown, softened at the edges.
      const t = across ? v : u;
      const crown = Math.abs(t - 0.5) < 0.14;
      if (Math.abs(t - 0.5) > 0.44 && pixelHash(x, y, 52) < 0.5) return null;
      return hz(crown ? 0x7a9a48 : pixelHash(x, y, 53) < 0.3 ? EARTH_DARK : EARTH, y);
    });
  }
}

/**
 * A crop standing on its field, drawn as a piece of its own: the field is
 * painted row by row from the far side, each patch of crop a column as tall
 * as the crop stands there, so nearer rows hide the stalks behind and the
 * tops make a surface. `shade` colours a column by how far up it is (0 at the
 * ground, 1 the top) and may say the crop is missing there (a path, a gap).
 */
function cropPiece(
  f: Field,
  heightAt: (u: number, v: number) => number,
  shade: (u: number, v: number, k: number, x: number, y: number) => number | null,
  keep: (x: number, y: number) => boolean,
  tilt = 0,
): { art: PixelBuffer; x: number; y: number; baseY: number } {
  const near = project(0, f.d0).y;
  const far = project(0, f.d1).y;
  const xs = [project(f.gx0, f.d0).x, project(f.gx1, f.d0).x, project(f.gx0, f.d1).x, project(f.gx1, f.d1).x];
  const left = Math.floor(Math.min(...xs)) - 1;
  const right = Math.ceil(Math.max(...xs)) + 1;
  const maxH = 40;
  const top = Math.floor(far - tilt - maxH);
  const art = new PixelBuffer(right - left + 1, Math.ceil(near) - top + 2);
  for (let y = Math.floor(far); y <= Math.ceil(near); y++) {
    const depth = meadowPlane.depthAtY(y + 0.5);
    const v = (depth - f.d0) / (f.d1 - f.d0);
    if (v < 0 || v > 1) continue;
    const s = meadowPlane.scaleAtY(y + 0.5);
    const lift = Math.round(tilt * v);
    for (let x = left; x <= right; x++) {
      const u = ((x + 0.5 - meadowPlane.vanishX) * depth - f.gx0) / (f.gx1 - f.gx0);
      if (u < 0 || u > 1 || !keep(x, y)) continue;
      const h = Math.min(maxH, heightAt(u, v) * s);
      const base = y - lift;
      const n = Math.max(1, Math.round(h));
      for (let j = 0; j < n; j++) {
        const k = h < 1 ? 0 : (j + 0.5) / n;
        const c = shade(u, v, k, x, base - j);
        if (c === null) break;
        art.set(x - left, base - j - top, c);
      }
    }
  }
  return { art, x: left, y: top, baseY: Math.round(far) };
}

function layWheat(ctx: FarmContext, state: CropState, hz: (c: number, y: number) => number, keep: (x: number, y: number) => boolean, put: (art: PixelBuffer, x: number, baseY: number) => void, rng: () => number): void {
  const green = 0x4e8436;
  const gold = 0xd8b45a;
  const ROW = 22;
  const piece = cropPiece(
    WHEAT,
    () => (state.stage === 'ripe' || state.stage === 'growing' ? 34 * state.height : state.stage === 'stubble' ? 3 : 0),
    (u, _v, k, x, y) => {
      const gx = WHEAT.gx0 + u * (WHEAT.gx1 - WHEAT.gx0);
      const furrow = ((gx % ROW) + ROW) % ROW < ROW * 0.45;
      if (state.stage === 'ploughed' || state.stage === 'sown') {
        // Furrows running away towards the trees, a haze of green shoots once sown.
        const shoots = state.stage === 'sown' && !furrow && pixelHash(x, y, 54) < state.height * 8;
        return hz(shoots ? 0x7aa04a : furrow ? EARTH_DARK : pixelHash(x, y, 55) < 0.25 ? EARTH_LIGHT : EARTH, y);
      }
      if (state.stage === 'stubble') return hz(k > 0.5 ? 0xd8c890 : furrow ? 0xb8a060 : 0xcab474, y);
      // Standing corn: lit tops, rows showing faintly, shadowed down among the stalks; it ripples in bands.
      const base = lerpColor(green, gold, state.ripeness);
      const band = valueNoise(x * 0.6, y * 2, 9, 56);
      let c = k > 0.7 ? lerpColor(base, 0xffffff, 0.12 + band * 0.1) : k > 0.35 ? base : scaleColor(base, 0.72);
      if (furrow && k > 0.7) c = scaleColor(c, 0.92);
      return hz(c, y);
    },
    keep,
    3,
  );
  ctx.standing.push({ ...piece, sway: 0, haze: 0 });
  // After the harvest the bales lie out on the stubble.
  if (state.stage === 'stubble') {
    for (let i = 0; i < 6; i++) {
      const at = project(randomRange(rng, WHEAT.gx0 + 60, WHEAT.gx1 - 200), randomRange(rng, WHEAT.d0 + 0.3, WHEAT.d1 - 0.3));
      if (keep(at.x, at.y)) put(roundBale(at.scale, (c) => hz(c, at.y)), at.x, at.y);
    }
  }
}

/** A perfect maze on a (2w+1)×(2h+1) grid: true where it's open. Its gate opens on the near side. */
export function carveMaze(w: number, h: number, seed: number): boolean[][] {
  const rng = createRng(seed);
  const grid = Array.from({ length: 2 * h + 1 }, () => new Array<boolean>(2 * w + 1).fill(false));
  const stack: Array<[number, number]> = [[Math.floor(w / 2), 0]];
  grid[1][2 * Math.floor(w / 2) + 1] = true;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const next = (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    )
      .map(([dx, dy]) => [cx + dx, cy + dy] as const)
      .filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h && !grid[2 * y + 1][2 * x + 1]);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [nx, ny] = next[Math.floor(rng() * next.length)];
    grid[cy + ny + 1][cx + nx + 1] = true;
    grid[2 * ny + 1][2 * nx + 1] = true;
    stack.push([nx, ny]);
  }
  // The way in, from the headland in front.
  grid[0][2 * Math.floor(w / 2) + 1] = true;
  return grid;
}

function layMaize(ctx: FarmContext, state: CropState, date: Date, hz: (c: number, y: number) => number, keep: (x: number, y: number) => boolean): void {
  const maze = mazeOpen(date) ? carveMaze(6, 4, ctx.seed + date.getFullYear()) : null;
  const open = (u: number, v: number) => {
    if (!maze) return false;
    const gy = Math.min(maze.length - 1, Math.floor(v * maze.length));
    const gx = Math.min(maze[0].length - 1, Math.floor(u * maze[0].length));
    return maze[gy][gx];
  };
  const tall = state.stage === 'growing' || state.stage === 'ripe';
  const leaf = lerpColor(0x5a8a32, 0xb8a050, state.ripeness);
  const tassel = lerpColor(0x9ab050, 0xe0c878, state.ripeness);
  const piece = cropPiece(
    MAIZE,
    () => (tall ? 66 * state.height : state.stage === 'stubble' ? 4 : 0),
    (u, v, k, x, y) => {
      if (!tall) {
        const gx = MAIZE.gx0 + u * (MAIZE.gx1 - MAIZE.gx0);
        const furrow = ((gx % 26) + 26) % 26 < 11;
        if (state.stage === 'stubble') return hz(k > 0.4 && pixelHash(x, y, 57) < 0.5 ? 0xc8b078 : furrow ? 0x8a7048 : 0xa08a58, y);
        const shoots = state.stage === 'sown' && !furrow && pixelHash(x, y, 58) < state.height * 10;
        return hz(shoots ? 0x6a9a3a : furrow ? EARTH_DARK : EARTH, y);
      }
      // The maze's paths, seen from up here as dark grooves cut through the canopy.
      if (open(u, v) && k > 0.55) return hz(k > 0.8 ? scaleColor(leaf, 0.42) : scaleColor(leaf, 0.55), y);
      // Tasselled tops catching the light, broad leaves below, dark between the stalks.
      const n = pixelHash(x, y, 59);
      const c = k > 0.86 ? (n < 0.4 ? tassel : leaf) : k > 0.5 ? (n < 0.25 ? scaleColor(leaf, 0.82) : leaf) : n < 0.5 ? scaleColor(leaf, 0.62) : scaleColor(leaf, 0.75);
      return hz(c, y);
    },
    keep,
    MAIZE_TILT,
  );
  ctx.standing.push({ ...piece, sway: 0, haze: 0 });
}

function layPatch(ctx: FarmContext, state: CropState, hz: (c: number, y: number) => number, keep: (x: number, y: number) => boolean): void {
  const ROW = 34;
  const piece = cropPiece(
    PATCH,
    (u) => {
      const gx = PATCH.gx0 + u * (PATCH.gx1 - PATCH.gx0);
      const inRow = ((gx % ROW) + ROW) % ROW < ROW * 0.6;
      return inRow ? 12 * state.height : 0;
    },
    (u, v, k, x, y) => {
      const gx = PATCH.gx0 + u * (PATCH.gx1 - PATCH.gx0);
      const lane = Math.floor(gx / ROW);
      const inRow = ((gx % ROW) + ROW) % ROW < ROW * 0.6;
      if (!inRow || state.height < 0.05) return hz(pixelHash(x, y, 60) < 0.3 ? EARTH_LIGHT : EARTH_DARK, y);
      // Alternate rows of cabbages, lettuces and leeks, each plant a round head.
      const kind = lane % 3;
      const plant = pixelHash(Math.floor(v * 14), lane, 61) < 0.85;
      if (!plant) return hz(EARTH_DARK, y);
      const base = kind === 0 ? 0x6a9a6a : kind === 1 ? 0x8ac04a : 0x5a8a4a;
      const c = k > 0.6 ? lerpColor(base, 0xe8f0c0, 0.3) : k > 0.3 ? base : scaleColor(base, 0.7);
      return hz(lerpColor(c, 0xa09050, state.ripeness * 0.4), y);
    },
    keep,
    1,
  );
  ctx.standing.push({ ...piece, sway: 0, haze: 0 });
}

/** A post-and-rail fence between two ground points: posts every so often, two rails. */
function fence(ctx: FarmContext, a: { gx: number; depth: number }, b: { gx: number; depth: number }, hz: (c: number, y: number) => number, keep: (x: number, y: number) => boolean, gateAt = -1): void {
  const pa = project(a.gx, a.depth);
  const pb = project(b.gx, b.depth);
  const left = Math.floor(Math.min(pa.x, pb.x)) - 2;
  const right = Math.ceil(Math.max(pa.x, pb.x)) + 2;
  const postH = (s: number) => Math.max(3, Math.round(36 * s));
  const top = Math.floor(Math.min(pa.y - postH(pa.scale), pb.y - postH(pb.scale))) - 1;
  const bottom = Math.ceil(Math.max(pa.y, pb.y)) + 1;
  const art = new PixelBuffer(right - left + 1, bottom - top + 1);
  const steps = Math.ceil(Math.abs(pb.x - pa.x) * 2) + 2;
  let lastPost = -99;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const gx = a.gx + (b.gx - a.gx) * t;
    const depth = a.depth + (b.depth - a.depth) * t;
    const p = project(gx, depth);
    const x = Math.round(p.x);
    if (!keep(x, p.y)) continue;
    const h = postH(p.scale);
    const gate = gateAt >= 0 && Math.abs(t - gateAt) < 0.05;
    for (const k of [0.4, 0.8]) art.set(x - left, Math.round(p.y - h * k) - top, hz(gate ? 0xc8b498 : 0xa08a68, p.y));
    if (gate && Math.abs(t - gateAt) < 0.03) art.set(x - left, Math.round(p.y - h * 0.6) - top, hz(0xc8b498, p.y));
    if (x - lastPost >= Math.max(5, Math.round(70 * p.scale)) || i === steps) {
      lastPost = x;
      for (let y = Math.round(p.y - h); y <= Math.round(p.y); y++) art.set(x - left, y - top, hz(0x5a4a38, p.y));
    }
  }
  ctx.standing.push({ art, x: left, y: top, baseY: Math.round(Math.max(pa.y, pb.y)), sway: 0, haze: 0 });
}

/** Rails between the hen run's posts, and chicken wire netted across them. */
function coopRun(ctx: FarmContext): void {
  const posts = [0, 1, 2, 3, 4].map((i) => project(ctx.coop.gx - 120 + i * 4, ctx.coop.depth - 0.35 + i * 0.22));
  const left = Math.floor(Math.min(...posts.map((p) => p.x))) - 2;
  const right = Math.ceil(Math.max(...posts.map((p) => p.x))) + 2;
  const top = Math.floor(Math.min(...posts.map((p) => p.y - 34 * p.scale))) - 2;
  const bottom = Math.ceil(Math.max(...posts.map((p) => p.y))) + 1;
  const art = new PixelBuffer(right - left + 1, bottom - top + 1);
  for (let i = 1; i < posts.length; i++) {
    const a = posts[i - 1];
    const b = posts[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) + 1;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const h = (34 * (a.scale + (b.scale - a.scale) * t));
      // Wire mesh from the ground up to the top rail, as a fine diamond net.
      for (let k = 1; k < h * 0.9; k++) {
        const yy = Math.round(y - k);
        const xx = Math.round(x);
        if ((xx + yy) % 3 === 0 || (xx - yy + 300) % 3 === 0) art.set(xx - left, yy - top, 0xc8ccc8, 90);
      }
      for (const k of [0.45, 0.9]) {
        art.set(Math.round(x) - left, Math.round(y - h * k) - top, 0x9a8462);
        art.set(Math.round(x) - left, Math.round(y - h * k) + 1 - top, 0x5a4a38);
      }
    }
  }
  ctx.standing.push({ art, x: left, y: top, baseY: Math.round(Math.max(...posts.map((p) => p.y))) + 1, sway: 0, haze: ctx.hazeAt(posts[2].y) });
}

/** A few small fruit trees over the path, hung with apples. */
function orchard(ctx: FarmContext, date: Date, put: (art: PixelBuffer, x: number, baseY: number, sway?: number, anchorX?: number, anchorY?: number) => void, rng: () => number): void {
  // Apples from late summer until they're picked in the autumn; blossom in spring.
  const doy = dayOfYear(date);
  const day = doy >= 100 && doy < 136 ? 'blossom' : doy >= 215 && doy < 292 ? 'apples' : 'leaves';
  for (const [x, baseY] of [
    [404, 208],
    [426, 205.5],
    [447, 207],
    [416, 214],
    [440, 212.5],
  ] as const) {
    const s = meadowPlane.scaleAtY(baseY);
    const haze = ctx.hazeAt(baseY);
    const tree = drawBroadleaf(Math.max(10, 112 * s), Math.round(x * 13), hazePalette(BROADLEAF, ctx.haze, haze * 0.8), false);
    const buf = tree.buffer;
    const fruit = day === 'apples' ? lerpColor(0xd83a28, ctx.haze, haze * 0.6) : day === 'blossom' ? lerpColor(0xf8e0e8, ctx.haze, haze * 0.5) : 0;
    if (fruit) {
      for (let y = 0; y < tree.baseY - 3; y++) {
        for (let xx = 0; xx < buf.width; xx++) if (buf.isSet(xx, y) && pixelHash(xx, y, Math.round(x)) < (day === 'blossom' ? 0.22 : 0.09)) buf.set(xx, y, fruit);
      }
    }
    put(buf, x, baseY, 0.5 + rng() * 0.2, tree.baseX, tree.baseY);
    const g = meadowPlane.unproject(x, baseY);
    ctx.obstacles.push({ ...g, r: 10 * g.depth });
  }
}

// --- The buildings and the farm's things ---------------------------------------------

type Tint = (c: number) => number;

/** The farmhouse: white-rendered walls lit on the left, a red tiled roof, a chimney, two rows of windows and a door. */
function farmhouse(at: { x: number; y: number; scale: number }, hz: (c: number, y: number) => number) {
  const s = at.scale;
  const t: Tint = (c) => hz(c, at.y);
  const w = Math.max(14, Math.round(250 * s));
  const wall = Math.max(7, Math.round(118 * s));
  const roof = Math.max(4, Math.round(64 * s));
  const side = Math.round(w * 0.32);
  const W = w + side + 4;
  const H = wall + roof + 6;
  const p = new PixelBuffer(W, H);
  const x0 = 1;
  const y0 = H - wall - 1;
  // Front wall, and the gable end in shade.
  p.rect(x0, y0, w, wall, t(0xeee6d4));
  p.rect(x0 + w, y0, side, wall, t(0xbcb4a8));
  // The gable's triangle.
  for (let k = 0; k < roof; k++) {
    const half = (side / 2) * (k / roof);
    for (let x = Math.round(x0 + w + side / 2 - half); x < Math.round(x0 + w + side / 2 + half); x++) p.set(x, y0 - roof + k, t(0xc8c0b2));
  }
  // The roof slope over the front, from the eave up to the ridge (which runs back to the gable's apex): red tiles in courses.
  for (let k = 0; k < roof; k++) {
    const off = Math.round((side / 2) * (1 - k / roof));
    for (let x = x0 - 1 + off; x < x0 + w + off; x++) p.set(x, y0 - roof + k, t(k % 2 === 0 ? 0x9a3a2a : x % 3 === 0 ? 0xa84a34 : 0xb85a3a));
  }
  for (let x = x0 - 1; x < x0 + w + Math.round(side / 2); x++) p.set(x, y0 - 1, t(0x6a2a1e));
  // The chimney on the ridge.
  const cx = x0 + Math.round(w * 0.72);
  const ch = Math.max(3, Math.round(30 * s));
  p.rect(cx, y0 - roof - ch + 2, Math.max(2, Math.round(16 * s)), ch, t(0x8a5a44));
  p.rect(cx - 1, y0 - roof - ch + 2, Math.max(2, Math.round(16 * s)) + 2, 1, t(0x5a3a2c));
  // Windows: two rows, white frames, dark glass; a green door.
  const windows: FarmLayout['windows'] = [];
  const ww = Math.max(1, Math.round(16 * s));
  const wh = Math.max(2, Math.round(22 * s));
  const cols = 4;
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < cols; c++) {
      if (row === 1 && c === 1) continue;
      const wx = x0 + Math.round(((c + 0.5) / cols) * w - ww / 2);
      const wy = y0 + Math.round(row === 0 ? wall * 0.18 : wall * 0.58);
      p.rect(wx, wy, ww, wh, t(0x3a4048));
      p.rect(wx, wy + wh, ww, 1, t(0xffffff));
      windows.push({ x: wx, y: wy, w: ww, h: wh });
    }
  }
  const dx = x0 + Math.round((1.5 / cols) * w - ww / 2);
  p.rect(dx, H - 1 - Math.max(3, Math.round(34 * s)), ww + 1, Math.max(3, Math.round(34 * s)), t(0x3a5a3a));
  p.outline(t(0x3a2e28));
  const left = at.x - (x0 + w / 2);
  const top = at.y - H;
  return {
    art: p,
    at,
    anchorX: x0 + w / 2,
    ridge: w / 2,
    roofTop: wall + roof,
    windows: windows.map((wi) => ({ x: Math.round(left + wi.x), y: Math.round(top + wi.y), w: wi.w, h: wi.h })),
    chimney: { x: Math.round(left + cx + Math.max(2, Math.round(16 * s)) / 2), y: Math.round(top + y0 - roof - ch + 2), scale: s },
  };
}

/** A red barn: gambrel roof, white trim, big doors with a cross brace, a hay loft hatch above. */
function barn(s: number, t: Tint) {
  const w = Math.max(16, Math.round(300 * s));
  const wall = Math.max(7, Math.round(120 * s));
  const roof = Math.max(5, Math.round(92 * s));
  const side = Math.round(w * 0.5);
  const W = w + side + 4;
  const H = wall + roof + 3;
  const p = new PixelBuffer(W, H);
  const x0 = 1;
  const y0 = H - wall - 1;
  // Side wall (long, lit) and the gable end facing us at the right.
  for (let y = y0; y < y0 + wall; y++) for (let x = x0; x < x0 + w; x++) p.set(x, y, t(x % 3 === 0 ? 0x8a3024 : 0xa83a2c));
  // The gable: a gambrel profile, steep low slopes and shallow high ones.
  const gx0 = x0 + w;
  const prof = (u: number) => (u < 0.22 ? (u / 0.22) * 0.6 : 0.6 + ((u - 0.22) / 0.28) * 0.4);
  for (let x = 0; x < side; x++) {
    const u = Math.min(x, side - 1 - x) / side;
    const ht = Math.round(prof(Math.min(0.5, u)) * roof);
    for (let y = y0 - ht; y < y0 + wall; y++) p.set(gx0 + x, y, t(y < y0 ? 0x942e22 : x % 3 === 0 ? 0x7a281e : 0x8e3226));
  }
  // The roof over the side wall, dark grey shingles, following the gable's profile back to the ridge; its gambrel
  // break shows as a line.
  for (let k = 0; k < roof; k++) {
    const need = (roof - k) / roof;
    let off = 0;
    while (off < side / 2 && prof(off / side) < need) off++;
    const brk = Math.abs(need - 0.6) < 0.07;
    for (let x = x0 - 1 + off; x < gx0 + off; x++) p.set(x, y0 - roof + k, t(brk ? 0x3a3a40 : k % 2 ? 0x5a5a62 : x < x0 + w / 2 ? 0x6a6a72 : 0x62626a));
  }
  // Trim under the eaves and round the gable doors.
  for (let x = x0 - 1; x < gx0; x++) p.set(x, y0, t(0xe8e0d0));
  const dw = Math.max(3, Math.round(side * 0.5));
  const dh = Math.max(4, Math.round(wall * 0.75));
  const dx = gx0 + Math.round((side - dw) / 2);
  const dy = y0 + wall - dh;
  p.rect(dx, dy, dw, dh, t(0x6a2018));
  for (let k = 0; k < dh; k++) {
    p.set(dx + Math.round((k / dh) * (dw - 1)), dy + k, t(0xe8e0d0));
    p.set(dx + dw - 1 - Math.round((k / dh) * (dw - 1)), dy + k, t(0xe8e0d0));
  }
  p.rect(dx, dy, dw, 1, t(0xe8e0d0));
  // The hay loft hatch, open, hay showing.
  const hw = Math.max(2, Math.round(dw * 0.45));
  p.rect(gx0 + Math.round((side - hw) / 2), y0 - Math.round(roof * 0.45), hw, Math.max(2, Math.round(roof * 0.28)), t(0xc8a858));
  p.outline(t(0x2a1a14));
  return { art: p, anchorX: x0 + (w + side) / 2, ridge: w / 2 };
}

/** A tall grain silo: a ribbed grey drum and a domed cap. */
function silo(s: number, t: Tint): PixelBuffer {
  const w = Math.max(5, Math.round(80 * s));
  const h = Math.max(12, Math.round(300 * s));
  const p = new PixelBuffer(w + 2, h + Math.round(w / 2) + 2);
  const top = Math.round(w / 2) + 1;
  for (let y = top; y < top + h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const c = u < 0.3 ? 0xc8ccd0 : u < 0.7 ? 0xaab0b6 : 0x80868e;
      p.set(x + 1, y, t((y - top) % 4 === 0 ? scaleColor(c, 0.85) : c));
    }
  }
  for (let k = 0; k < top; k++) {
    const half = (w / 2) * Math.sqrt(1 - ((top - k) / top) ** 2);
    for (let x = Math.round(w / 2 - half); x < Math.round(w / 2 + half); x++) p.set(x + 1, k + 1, t(x < w / 2 ? 0xd8dce0 : 0x9aa0a6));
  }
  p.outline(t(0x3a3e44));
  return p;
}

/** A red fuel tank up on its legs. */
function fuelTank(s: number, t: Tint): PixelBuffer {
  const w = Math.max(5, Math.round(70 * s));
  const h = Math.max(3, Math.round(26 * s));
  const legs = Math.max(2, Math.round(26 * s));
  const p = new PixelBuffer(w + 2, h + legs + 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(x + 1, y + 1, t(y < h / 2 ? 0xc84a3a : 0x9a3428));
  for (let y = h + 1; y < h + legs + 1; y++) {
    p.set(2, y, t(0x4a4a4a));
    p.set(w - 1, y, t(0x4a4a4a));
  }
  p.outline(t(0x2a1a14));
  return p;
}

/** A wooden hay cart with two big wheels, half loaded. */
function hayCart(s: number, t: Tint): PixelBuffer {
  const w = Math.max(7, Math.round(110 * s));
  const bed = Math.max(2, Math.round(16 * s));
  const r = Math.max(2, Math.round(20 * s));
  const load = Math.max(2, Math.round(18 * s));
  const p = new PixelBuffer(w + Math.round(w * 0.4) + 2, load + bed + r * 2 + 2);
  const y0 = load + 1;
  // Hay heaped on the bed.
  for (let x = 2; x < w - 1; x++) {
    const hh = Math.round(load * Math.sin((x / w) * Math.PI));
    for (let y = y0 - hh; y < y0; y++) p.set(x, y, t(pixelHash(x, y, 62) < 0.3 ? 0xe8d088 : 0xd0b060));
  }
  p.rect(1, y0, w, bed, t(0x8a6a42));
  // The shafts, out in front.
  for (let k = 0; k < Math.round(w * 0.4); k++) p.set(w + k, y0 + bed - 1 + Math.round(k * 0.25), t(0x6a5034));
  // Wheels.
  const cy = y0 + bed + r - 1;
  for (const cx of [Math.round(w * 0.3)]) {
    for (let a = 0; a < 24; a++) p.set(Math.round(cx + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(cy + Math.sin((a / 24) * Math.PI * 2) * r), t(0x4a3a28));
    for (let k = -r; k <= r; k++) {
      p.set(cx + k, cy, t(0x6a5034));
      p.set(cx, cy + k, t(0x6a5034));
    }
  }
  p.outline(t(0x2a1e14));
  return p;
}

/** A round bale of hay, its spiral showing on the end. */
function roundBale(s: number, t: Tint): PixelBuffer {
  const r = Math.max(2, Math.round(22 * s));
  const len = Math.max(2, Math.round(30 * s));
  const p = new PixelBuffer(len + r * 2 + 3, r * 2 + 3);
  for (let y = 0; y < r * 2; y++) for (let x = r; x < r + len; x++) p.set(x + 1, y + 1, t(y < r * 0.7 ? 0xe0c070 : y < r * 1.4 ? 0xc8a858 : 0xa8884a));
  for (let y = 0; y <= r * 2; y++) {
    for (let x = 0; x <= r * 2; x++) {
      const d = Math.hypot(x - r, y - r);
      if (d > r) continue;
      p.set(x + len + 1, y + 1, t(Math.round(d) % 2 === 0 ? 0xd8b868 : 0xb89850));
    }
  }
  p.outline(t(0x5a4428));
  return p;
}

/** A galvanised water trough on short legs. */
function trough(s: number): PixelBuffer {
  const w = Math.max(6, Math.round(70 * s));
  const h = Math.max(2, Math.round(14 * s));
  const legs = Math.max(1, Math.round(5 * s));
  const p = new PixelBuffer(w + 2, h + legs + 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(x + 1, y + 1, y === 0 ? 0x5a7a90 : y < h / 2 ? 0xb8c0c4 : 0x8a9298);
  for (let y = h + 1; y < h + legs + 1; y++) {
    p.set(2, y, 0x5a5e62);
    p.set(w - 1, y, 0x5a5e62);
  }
  p.outline(0x2e3236);
  return p;
}

/** The wind pump's lattice tower and tail vane (its rotor is drawn turning, separately). */
function windPumpTower(s: number, t: Tint): { art: PixelBuffer; hubY: number; radius: number } {
  const h = Math.max(16, Math.round(420 * s));
  const foot = Math.max(5, Math.round(110 * s));
  const radius = Math.max(4, Math.round(105 * s));
  const tail = Math.round(radius * 1.6);
  const W = foot + tail * 2 + 4;
  const p = new PixelBuffer(W, h + radius + 4);
  const cx = Math.round(W / 2);
  const baseY = p.height - 1;
  const topY = baseY - h;
  const steel = t(0x7a7e84);
  const dark = t(0x4e5258);
  // Two legs tapering up to the head, cross-braced.
  const legX = (side: number, y: number) => cx + side * ((foot / 2) * ((y - topY) / h) + 1);
  for (let y = topY; y <= baseY; y++) {
    p.set(Math.round(legX(-1, y)), y, steel);
    p.set(Math.round(legX(1, y)), y, dark);
  }
  const bays = Math.max(3, Math.round(h / 8));
  for (let b = 0; b < bays; b++) {
    const ya = topY + (h * b) / bays;
    const yb = topY + (h * (b + 1)) / bays;
    for (let k = 0; k <= 10; k++) {
      const y = ya + ((yb - ya) * k) / 10;
      const x = legX(-1, y) + (legX(1, y) - legX(-1, y)) * (k / 10);
      p.set(Math.round(x), Math.round(y), dark);
      const x2 = legX(1, y) - (legX(1, y) - legX(-1, y)) * (k / 10);
      p.set(Math.round(x2), Math.round(y), steel);
    }
    for (let x = Math.round(legX(-1, yb)); x <= Math.round(legX(1, yb)); x++) p.set(x, Math.round(yb), steel);
  }
  // The head, and the tail vane out behind it.
  p.rect(cx - 1, topY - 2, 3, 3, dark);
  for (let k = 0; k < tail; k++) p.set(cx + 1 + k, topY - 1, steel);
  const vh = Math.max(2, Math.round(radius * 0.7));
  for (let y = 0; y < vh; y++) for (let x = 0; x < Math.round(vh * 0.9); x++) p.set(cx + tail - x, topY - 1 - Math.round(vh / 2) + y, t(y < vh / 2 ? 0xd8d4c8 : 0xb8b4a8));
  return { art: p, hubY: h + 2, radius };
}

/**
 * The wind pump's rotor at one turn of a blade's spacing (frame 0..frames-1):
 * a ring of sheet-steel blades round the hub, seen a little from the side.
 */
export function drawRotor(radius: number, frame: number, frames: number, tint: Tint = (c) => c): PixelBuffer {
  const R = Math.max(3, radius);
  const blades = 14;
  const p = new PixelBuffer(R * 2 + 3, R * 2 + 3);
  const cx = R + 1;
  const cy = R + 1;
  const squash = 0.62;
  const turn = ((frame / frames) * Math.PI * 2) / blades;
  for (let b = 0; b < blades; b++) {
    const a = turn + (b / blades) * Math.PI * 2;
    for (let r = R * 0.3; r <= R; r += 0.5) {
      const spread = 0.12 + (r / R) * 0.08;
      for (const da of [-spread, 0, spread * 0.6]) {
        const x = cx + Math.cos(a + da) * r * squash;
        const y = cy + Math.sin(a + da) * r;
        const lit = Math.sin(a) < 0;
        p.set(Math.round(x), Math.round(y), tint(da < 0 ? (lit ? 0xe0e0dc : 0xb8bab8) : lit ? 0xc8cac8 : 0x989a9a));
      }
    }
  }
  // The rim ring and the hub.
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    p.set(Math.round(cx + Math.cos(a) * R * squash), Math.round(cy + Math.sin(a) * R), tint(0x6a6e72));
  }
  p.rect(cx - 1, cy - 1, 2, 2, tint(0x3a3e42));
  return p;
}
