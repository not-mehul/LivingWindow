import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { PixelCanvas } from '../../core/pixelTexture';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import { pixelHash } from '../../sprites/raster';

/** Floor lines: deer walk on these (world y of hooves). */
export const FAR_FLOOR_Y = 300;
export const MID_FLOOR_Y = 316;
export const NEAR_FLOOR_Y = 336;
export const FOREST_HORIZON = 250;

export interface Trunk {
  x: number;
  width: number;
  top: number;
  bottom: number;
  layer: 'mid' | 'near';
}

export interface Placed {
  canvas: PixelCanvas;
  x: number;
  y: number;
}

export interface ForestLayout {
  far: PixelCanvas;
  mid: PixelCanvas;
  near: PixelCanvas;
  /** Crowns on the mid trunks (they sway). */
  crowns: Placed[];
  /** The leafy roof along the top of the view (it sways). */
  canopy: Placed[];
  /** Ferns along the front (they sway). */
  ferns: Placed[];
  trunks: Trunk[];
  ledges: Ledge[];
  /** Openings in the canopy where light shafts fall. */
  gaps: number[];
}

const BARK = {
  mid: { base: '#5e4a3a', light: '#7a6250', dark: '#463628', deep: '#34281e' },
  near: { base: '#4e3a2c', light: '#6a5240', dark: '#382a1e', deep: '#261c14' },
};
const LEAVES = ['#3c6430', '#4e7a3e', '#5e8a44', '#6a9a4e', '#80ae5a'];
const MOSS = '#5a7a34';

function bark(c: PixelCanvas, x0: number, top: number, width: number, bottom: number, tone: typeof BARK.mid, seed: number): void {
  for (let y = Math.max(0, top); y < Math.min(WORLD_HEIGHT, bottom); y++) {
    for (let x = x0; x < x0 + width; x++) {
      const u = (x - x0 + 0.5) / width;
      let color = tone.base;
      if (u < 0.22) color = tone.light;
      else if (u > 0.78) color = tone.dark;
      // Vertical fissures in the bark.
      if (pixelHash(Math.floor(x / 2), Math.floor(y / 5), seed) < 0.22) color = u > 0.5 ? tone.deep : tone.dark;
      if (u > 0.92) color = tone.deep;
      c.px(x, y, color);
    }
  }
}

/** A leafy mass made of overlapping round clumps, lit from above. */
function leafMass(c: PixelCanvas, clumps: Array<[number, number, number]>, seed: number, dark = 0): void {
  for (const [cx, cy, r] of clumps) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - cy) / r;
        const d = dx * dx + dy * dy;
        // Ragged edges.
        if (d > 1 - pixelHash(x, y, seed) * 0.25) continue;
        let shade = Math.min(LEAVES.length - 1, Math.max(0, Math.round(2 - dy * 1.6 - dark)));
        const h = pixelHash(x, y, seed + 1);
        if (h < 0.12) shade = Math.max(0, shade - 1);
        else if (h > 0.9) shade = Math.min(LEAVES.length - 1, shade + 1);
        c.px(x, y, LEAVES[shade]);
      }
    }
  }
}

function fern(rng: () => number): PixelCanvas {
  const w = randomInt(rng, 26, 40);
  const h = randomInt(rng, 16, 24);
  const c = new PixelCanvas(w, h);
  const fronds = randomInt(rng, 5, 8);
  for (let i = 0; i < fronds; i++) {
    const angle = Math.PI * (0.12 + (0.76 * i) / (fronds - 1));
    const length = randomRange(rng, h * 0.7, h * 1.05);
    for (let t = 0; t < length; t++) {
      const bendAngle = angle + (t / length) * (angle < Math.PI / 2 ? -0.5 : 0.5);
      const x = w / 2 - Math.cos(bendAngle) * t;
      const y = h - 1 - Math.sin(angle) * t + (t / length) ** 2 * 4;
      c.px(Math.round(x), Math.round(y), t > length * 0.7 ? '#80ae5a' : '#4e7a3e');
      // Leaflets either side of the stem.
      if (t % 2 === 0 && t > 2) {
        const leaf = Math.max(1, Math.round((1 - t / length) * 3));
        c.px(Math.round(x), Math.round(y) - leaf, '#6a9a4e');
        c.px(Math.round(x), Math.round(y) + 1, '#3c6430');
      }
    }
  }
  return c;
}

export function generateForest(seed = 3141): ForestLayout {
  const rng = createRng(seed);
  const ledges: Ledge[] = [];
  const trunks: Trunk[] = [];

  // --- Far: a hazy wall of conifers and broadleaf crowns ---
  const far = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  for (let row = 0; row < 2; row++) {
    const color = row === 0 ? '#93ad9c' : '#7d9a88';
    const dark = row === 0 ? '#86a290' : '#6f8c7a';
    for (let x = -10; x < WORLD_WIDTH + 10; x += randomInt(rng, 9, 16)) {
      const h = randomInt(rng, 110, 200) - row * 20;
      const base = FAR_FLOOR_Y + 6;
      const top = base - h;
      if (rng() < 0.6) {
        // Conifer: stacked triangles.
        for (let y = top; y < base; y++) {
          const t = (y - top) / h;
          const half = Math.round(2 + t * 11 * (0.6 + 0.4 * ((y - top) % 9) / 9));
          far.rect(x - half, y, half * 2, 1, (y + x) % 7 === 0 ? dark : color);
        }
      } else {
        leafMass(far, [[x, top + 18, 16], [x - 8, top + 30, 13], [x + 9, top + 32, 14]], 7 + row);
        far.rect(x - 1, top + 40, 3, base - top - 40, dark);
      }
    }
    if (row === 0) {
      // Recolour the first row's leaf masses to haze.
      const img = far.ctx.getImageData(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] && img.data[i + 1] > img.data[i] + 20) {
          img.data[i] = (img.data[i] + 0x93 * 2) / 3;
          img.data[i + 1] = (img.data[i + 1] + 0xad * 2) / 3;
          img.data[i + 2] = (img.data[i + 2] + 0x9c * 2) / 3;
        }
      }
      far.ctx.putImageData(img, 0, 0);
    }
  }
  far.rect(0, FAR_FLOOR_Y + 4, WORLD_WIDTH, WORLD_HEIGHT - FAR_FLOOR_Y, '#6a8a6a');

  // --- Mid: trunks with branch stubs, and a mossy floor ---
  const mid = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  mid.rect(0, MID_FLOOR_Y - 18, WORLD_WIDTH, WORLD_HEIGHT, '#5e5a36');
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const y = MID_FLOOR_Y - 18 + Math.round(Math.sin(x * 0.05) * 2 + Math.sin(x * 0.13) * 1.5);
    mid.vline(x, y, 3, '#6a7a3a');
    if (pixelHash(x, 3, 9) < 0.3) mid.px(x, y - 1, '#7a8a44');
  }
  for (let y = MID_FLOOR_Y - 15; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const h = pixelHash(x, y, 21);
      if (h < 0.08) mid.px(x, y, '#8a6a3a');
      else if (h < 0.12) mid.px(x, y, '#4a4a2a');
    }
  }
  const crowns: Placed[] = [];
  for (let x = 20; x < WORLD_WIDTH; x += randomInt(rng, 58, 92)) {
    const width = randomInt(rng, 9, 15);
    const top = randomInt(rng, 40, 90);
    bark(mid, x, top, width, MID_FLOOR_Y - 14, BARK.mid, x);
    trunks.push({ x: x + width / 2, width, top, bottom: MID_FLOOR_Y - 14, layer: 'mid' });
    // A branch stub or two to perch on.
    for (let b = 0; b < randomInt(rng, 1, 2); b++) {
      const by = randomInt(rng, top + 40, MID_FLOOR_Y - 70);
      const right = rng() < 0.5;
      const bx = right ? x + width : x - 8;
      mid.rect(bx, by, 8, 2, BARK.mid.dark);
      mid.hline(bx, by, 8, BARK.mid.light);
      ledges.push({ x0: bx + 1, x1: bx + 6, y: by, layer: 'mid', kind: 'branch', z: 0.78 });
    }
    // Its crown, drawn separately so it can sway.
    const cw = randomInt(rng, 46, 70);
    const ch = randomInt(rng, 36, 52);
    const crown = new PixelCanvas(cw, ch);
    leafMass(crown, [[cw / 2, ch * 0.45, cw * 0.32], [cw * 0.28, ch * 0.62, cw * 0.24], [cw * 0.72, ch * 0.6, cw * 0.26], [cw * 0.5, ch * 0.7, cw * 0.22]], x);
    crowns.push({ canvas: crown, x: x + width / 2 - cw / 2, y: top - ch * 0.6 });
  }
  ledges.push({ x0: 0, x1: WORLD_WIDTH - 1, y: MID_FLOOR_Y - 14, layer: 'mid', kind: 'ground', z: 0.76 });

  // --- Near: massive trunks, the forest floor, a fallen log ---
  const near = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  near.rect(0, NEAR_FLOOR_Y - 6, WORLD_WIDTH, WORLD_HEIGHT, '#4a3c28');
  for (let y = NEAR_FLOOR_Y - 6; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const h = pixelHash(x, y, 33);
      if (h < 0.1) near.px(x, y, '#a07a40');
      else if (h < 0.16) near.px(x, y, '#8a6a3a');
      else if (h < 0.2) near.px(x, y, '#3a2e1e');
      else if (h < 0.23) near.px(x, y, '#6a8a3a');
    }
  }
  for (let x = 0; x < WORLD_WIDTH; x++) near.px(x, NEAR_FLOOR_Y - 7 + (pixelHash(x, 0, 4) < 0.4 ? 0 : 1), '#5a6a32');
  const nearXs = [36, 230, 440, 640, 790];
  for (const nx of nearXs) {
    const x = nx + randomInt(rng, -20, 20);
    const width = randomInt(rng, 30, 46);
    bark(near, x, -4, width, NEAR_FLOOR_Y, BARK.near, x + 7);
    // Flared roots and moss on the shady side.
    near.rect(x - 4, NEAR_FLOOR_Y - 8, width + 8, 6, BARK.near.dark);
    near.rect(x - 6, NEAR_FLOOR_Y - 3, width + 12, 3, BARK.near.deep);
    for (let y = 120; y < NEAR_FLOOR_Y - 8; y++) {
      for (let dx = 0; dx < 6; dx++) {
        if (pixelHash(x + width - dx, y, 5) < 0.35 - dx * 0.05) near.px(x + width - 1 - dx, y, MOSS);
      }
    }
    // A knot hole.
    const ky = randomInt(rng, 140, 220);
    near.rect(x + width / 2 - 2, ky, 4, 5, BARK.near.deep);
    trunks.push({ x: x + width / 2, width, top: 0, bottom: NEAR_FLOOR_Y - 6, layer: 'near' });
    // One sturdy branch to perch on.
    const by = randomInt(rng, 120, 200);
    const right = rng() < 0.5;
    const bx = right ? x + width : x - 22;
    near.rect(bx, by, 22, 4, BARK.near.dark);
    near.hline(bx, by, 22, BARK.near.light);
    leafMass(near, [[right ? bx + 24 : bx - 2, by - 2, 7]], by);
    ledges.push({ x0: bx + 2, x1: bx + 18, y: by, layer: 'near', kind: 'branch', z: 0.52 });
  }
  // A mossy fallen log.
  const logX = 330;
  const logY = NEAR_FLOOR_Y - 12;
  near.rect(logX, logY, 70, 9, BARK.near.base);
  near.hline(logX, logY, 70, BARK.near.light);
  near.hline(logX, logY + 8, 70, BARK.near.deep);
  for (let x = logX; x < logX + 70; x++) if (pixelHash(x, logY, 2) < 0.4) near.px(x, logY - 1, MOSS);
  near.rect(logX + 70, logY, 3, 9, '#8a6a4a');
  ledges.push({ x0: logX + 4, x1: logX + 64, y: logY - 1, layer: 'near', kind: 'log', z: 0.6 });

  // --- Canopy roof, in overlapping swaying pieces ---
  const canopy: Placed[] = [];
  const gaps: number[] = [];
  for (let x = -60; x < WORLD_WIDTH; x += 150) {
    const w = 220;
    const h = 90;
    const c = new PixelCanvas(w, h);
    const clumps: Array<[number, number, number]> = [];
    // Keep every clump inside the piece so no straight cut edge shows.
    for (let i = 0; i < 14; i++) {
      const r = randomRange(rng, 16, 30);
      clumps.push([randomRange(rng, r, w - r), randomRange(rng, -10, h - r - 2), r]);
    }
    leafMass(c, clumps, x + 100, 1);
    canopy.push({ canvas: c, x, y: -12 });
    gaps.push(x + randomInt(rng, 40, 180));
  }

  // --- Ferns along the front ---
  const ferns: Placed[] = [];
  for (let x = 0; x < WORLD_WIDTH; x += randomInt(rng, 34, 70)) {
    const c = fern(rng);
    ferns.push({ canvas: c, x: x - c.width / 2, y: WORLD_HEIGHT - c.height - randomInt(rng, 2, 12) });
  }

  return { far, mid, near, crowns, canopy, ferns, trunks, ledges, gaps };
}
