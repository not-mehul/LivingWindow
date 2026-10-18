import { lerpColor, scaleColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { randomRange } from '../../core/random';
import { pixelHash } from '../../sprites/raster';
import { valueNoise } from '../common/paint';
import type { TreePalette } from '../common/trees';

/**
 * The deep wood's plants and trunks: bare columns of pine, beech, birch and
 * oak rising out of the top of the view (some ivy-clad, some with bracket
 * fungus), whole silver birches, dead snags, holly and bramble, saplings,
 * foxgloves, mossy boulders, clumps of canopy and hanging strands of moss.
 */

export type BarkKind = 'pine' | 'beech' | 'birch' | 'oak';

interface Bark {
  light: number;
  base: number;
  dark: number;
  deep: number;
}

export const BARKS: Record<BarkKind, Bark> = {
  pine: { light: 0x9a6a4a, base: 0x7a4e36, dark: 0x543424, deep: 0x342016 },
  beech: { light: 0xaeb0a6, base: 0x8a8e86, dark: 0x62665e, deep: 0x44483f },
  birch: { light: 0xdcd8cc, base: 0xc2beb0, dark: 0x8e8a80, deep: 0x2a2622 },
  oak: { light: 0x8a7258, base: 0x6a5440, dark: 0x4a3a2c, deep: 0x2e241c },
};

const MOSS = [0x4a6a2c, 0x5e7e36, 0x7a9a46];
const IVY = [0x2a4a24, 0x3a6230, 0x527a3c];
const INK = 0x1c2418;

export interface TrunkColumn {
  buffer: PixelBuffer;
  /** The trunk's centre at its foot, within the buffer. */
  baseX: number;
  baseY: number;
  /** Width at the foot (without the root flare). */
  width: number;
}

/**
 * A trunk rising straight out of the top of the view, its crown far above:
 * tapering a little, flaring into roots at its foot, lit from the left. Each
 * kind has its bark (plated pine, smooth grey beech, papery birch with black
 * marks, furrowed oak); moss creeps up the shaded side; some trunks are
 * climbed by ivy, carry shelves of bracket fungus or the stubs of lost
 * branches. `haze` (0..1) fades it into the mist with distance.
 */
export function drawTrunkColumn(
  kind: BarkKind,
  width: number,
  height: number,
  seed: number,
  haze: number,
  hazeColor: number,
  decor: { ivy?: boolean; fungus?: boolean; stubs?: boolean } = {},
): TrunkColumn {
  const w = Math.max(3, Math.round(width));
  const flare = Math.max(2, Math.round(w * 0.45));
  const W = w + flare * 2 + 6;
  const H = Math.max(10, Math.round(height));
  const p = new PixelBuffer(W, H + 1);
  const cx = W / 2;
  const bark = BARKS[kind];
  const hz = (c: number) => lerpColor(c, hazeColor, haze);
  const lean = (pixelHash(seed, 1, 3) - 0.5) * 0.04;
  for (let y = 0; y < H; y++) {
    const f = y / H;
    const foot = f > 0.9 ? ((f - 0.9) / 0.1) ** 2 * flare : 0;
    const half = (w / 2) * (0.82 + 0.18 * f) + foot;
    const mid = cx + (H - y) * lean + Math.sin(y * 0.05 + seed) * 0.4;
    for (let x = Math.floor(mid - half); x <= Math.ceil(mid + half); x++) {
      const u = (x + 0.5 - (mid - half)) / (half * 2);
      if (u < 0 || u > 1) continue;
      let c = u < 0.22 ? bark.light : u > 0.72 ? bark.dark : bark.base;
      if (u > 0.9) c = bark.deep;
      if (kind === 'pine') {
        // Plates of bark with dark cracks between them.
        const plate = pixelHash(Math.floor((x - mid) / 4 + 9), Math.floor(y / 5), seed) < 0.22;
        if (plate && y % 5 === 0) c = bark.deep;
        else if (plate && u > 0.3 && u < 0.6) c = bark.light;
      } else if (kind === 'birch') {
        // Papery white with black lenticels and dark patches, darker towards the foot.
        if (pixelHash(Math.floor(x / 3), y, seed) < 0.05 + f * 0.05) c = bark.deep;
        else if (valueNoise(x * 3, y, 9, seed) > 0.78) c = 0x4a443c;
        if (f > 0.85 && pixelHash(x, y, seed + 1) < (f - 0.85) * 6) c = 0x3a3630;
      } else if (kind === 'oak') {
        const lane = Math.floor((x - mid + Math.sin(y * 0.06 + x * 0.05) * 2.5) / 3);
        if (pixelHash(lane + 20, Math.floor(y / 9), seed) < 0.3) c = u > 0.5 ? bark.deep : bark.dark;
      } else if (pixelHash(Math.floor(x / 2), Math.floor(y / 3), seed) < 0.04) {
        // Beech: smooth, with the odd faint ring.
        c = bark.dark;
      }
      // Moss up the shaded side, thickest low down.
      if (kind !== 'birch' && u > 0.62 && valueNoise(x, y, 5, seed + 2) > 0.62 - f * 0.25) c = MOSS[Math.floor(pixelHash(x, y, seed) * 3)];
      p.set(x, y, hz(c));
    }
  }
  // Stubs of lost branches, and shelves of bracket fungus.
  if (decor.stubs) {
    for (let k = 0; k < 3; k++) {
      const y = Math.round(H * (0.15 + pixelHash(k, 2, seed) * 0.5));
      const side = pixelHash(k, 3, seed) < 0.5 ? -1 : 1;
      const len = Math.max(2, Math.round(w * 0.35));
      for (let j = 0; j < len; j++) {
        const x = Math.round(cx + side * (w / 2 + j));
        p.set(x, y - Math.round(j * 0.4), hz(bark.dark));
        p.set(x, y - Math.round(j * 0.4) + 1, hz(bark.deep));
      }
    }
  }
  if (decor.fungus) {
    for (let k = 0; k < 4; k++) {
      const y = Math.round(H * (0.5 + pixelHash(k, 4, seed) * 0.35));
      const side = k % 2 ? 1 : -1;
      const len = Math.max(2, Math.round(w * 0.28));
      for (let j = 0; j <= len; j++) {
        const x = Math.round(cx + side * (w / 2 - 1 + j));
        p.set(x, y, hz(j === len ? 0x6a4a2a : 0xd8b878));
        p.set(x, y + 1, hz(0x8a6a3a));
      }
    }
  }
  if (decor.ivy) {
    // Ivy winding up the trunk: clusters of dark heart-shaped leaves along a spiral.
    for (let y = H - 2; y > H * 0.15; y -= 2) {
      const a = y * 0.09 + seed;
      const x = cx + Math.sin(a) * (w / 2 - 1);
      if (Math.cos(a) < -0.2 || pixelHash(y, 5, seed) < 0.25) continue;
      const leaf = IVY[Math.floor(pixelHash(y, 6, seed) * 3)];
      p.set(x, y, hz(leaf));
      p.set(x + 1, y, hz(IVY[2]));
      p.set(x, y - 1, hz(IVY[0]));
      if (pixelHash(y, 7, seed) < 0.5) p.set(x - 1, y + 1, hz(IVY[1]));
    }
  }
  // A mossy root flare and a little leaf litter at the foot.
  for (let x = Math.round(cx - w / 2 - flare); x <= cx + w / 2 + flare; x++) if (pixelHash(x, 8, seed) < 0.5) p.set(x, H - 1, hz(MOSS[1]));
  p.outline(hz(INK));
  return { buffer: p, baseX: Math.round(cx), baseY: H, width: w };
}

/** A silver birch: a slim white trunk and a light, airy, drooping crown. */
export function drawBirch(height: number, seed: number, pal: TreePalette, haze: number, hazeColor: number): { buffer: PixelBuffer; baseX: number; baseY: number; tipX: number; tipY: number } {
  const H = Math.max(14, Math.round(height));
  const W = Math.round(H * 0.5) + 4;
  const p = new PixelBuffer(W, H + 1);
  const cx = W / 2;
  const trunkW = Math.max(2, Math.round(H * 0.035));
  const col = drawTrunkColumn('birch', trunkW, H, seed, haze, hazeColor);
  p.draw(col.buffer, Math.round(cx - col.baseX), H - col.baseY + 1);
  // The crown: many small clumps, fine and drooping, sparser low down.
  const crownTop = H * 0.02;
  const crownBottom = H * 0.62;
  const clumps = 10 + Math.round(H / 12);
  for (let k = 0; k < clumps; k++) {
    const t = pixelHash(k, 1, seed);
    const y = crownTop + (crownBottom - crownTop) * t;
    const spread = (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (W / 2 - 2);
    const x = cx + (pixelHash(k, 2, seed) * 2 - 1) * spread;
    const r = Math.max(1.5, H * (0.045 + pixelHash(k, 3, seed) * 0.035));
    for (let j = -Math.ceil(r); j <= Math.ceil(r * 1.4); j++) {
      for (let i = -Math.ceil(r); i <= Math.ceil(r); i++) {
        const d = (i / r) ** 2 + (j / (r * 1.3)) ** 2;
        if (d > 1 - pixelHash(Math.round(x + i), Math.round(y + j), seed) * 0.35) continue;
        const light = -i / r - j / r;
        p.set(x + i, y + j, light > 0.6 ? pal.highlight : light > -0.2 ? pal.light : pal.base);
      }
    }
  }
  p.outline(pal.ink);
  return { buffer: p, baseX: Math.round(cx), baseY: H, tipX: Math.round(cx), tipY: Math.round(crownTop) };
}

/** A dead snag: a broken grey trunk with jagged top, bare stubs, and bracket fungus. */
export function drawSnag(height: number, seed: number, haze: number, hazeColor: number): { buffer: PixelBuffer; baseX: number; baseY: number; tipY: number } {
  const H = Math.max(12, Math.round(height));
  const w = Math.max(3, Math.round(H * 0.09));
  const col = drawTrunkColumn('beech', w, H, seed, haze, hazeColor, { fungus: true, stubs: true });
  const p = col.buffer;
  // Break the top off raggedly.
  for (let x = 0; x < p.width; x++) {
    const cut = Math.round(2 + pixelHash(x, 9, seed) * 6 + Math.abs(x - col.baseX) * 0.6);
    for (let y = 0; y < cut; y++) p.set(x, y, 0, 0);
  }
  p.outline(lerpColor(INK, hazeColor, haze));
  return { buffer: p, baseX: col.baseX, baseY: col.baseY, tipY: 6 };
}

/** Holly (glossy dark leaves, red berries in winter) or bramble (arching stems, white flowers or blackberries). */
export function drawShrub(kind: 'holly' | 'bramble', w: number, h: number, seed: number, haze: number, hazeColor: number, month: number): PixelBuffer {
  const W = Math.max(6, Math.round(w));
  const H = Math.max(4, Math.round(h));
  const p = new PixelBuffer(W + 2, H + 2);
  const hz = (c: number) => lerpColor(c, hazeColor, haze);
  if (kind === 'holly') {
    const greens = [0x1e3a24, 0x2a4e2e, 0x3a6a3a, 0x5a8a50];
    for (let y = 0; y < H; y++) {
      const f = y / H;
      const half = (W / 2) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + f * 0.95)));
      for (let x = Math.floor(W / 2 - half); x <= W / 2 + half; x++) {
        const n = pixelHash(x, y, seed);
        if (n < 0.08) continue;
        const light = (W / 2 - x) / W - f * 0.6 + 0.4;
        p.set(x + 1, y + 1, hz(n > 0.93 ? greens[3] : light > 0.25 ? greens[2] : light > -0.1 ? greens[1] : greens[0]));
      }
    }
    if (month >= 10 || month <= 1) for (let k = 0; k < W / 3; k++) p.set(1 + pixelHash(k, 1, seed) * W, 1 + pixelHash(k, 2, seed) * H * 0.8, hz(0xc82a22));
  } else {
    const stems = 5 + Math.round(W / 8);
    for (let k = 0; k < stems; k++) {
      const x0 = W * (0.2 + 0.6 * pixelHash(k, 3, seed));
      const reach = W * (0.25 + 0.3 * pixelHash(k, 4, seed)) * (pixelHash(k, 5, seed) < 0.5 ? -1 : 1);
      for (let t = 0; t <= 1; t += 0.04) {
        const x = 1 + x0 + reach * t;
        const y = 1 + H - H * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * (0.6 + 0.4 * pixelHash(k, 6, seed));
        p.set(x, y, hz(0x6a3a3a));
        if (pixelHash(Math.round(x), Math.round(y), seed) < 0.55) {
          p.set(x, y - 1, hz(0x3e5e2e));
          p.set(x + 1, y, hz(0x4e7236));
        }
        if (pixelHash(Math.round(x), 7, seed + k) < 0.06) p.set(x, y - 2, hz(month >= 7 && month <= 8 ? 0x2a1a2e : 0xf0e8e0));
      }
    }
  }
  p.outline(hz(INK));
  return p;
}

/** A foxglove: a tall spike of purple bells over a rosette of leaves. */
export function drawFoxglove(scale: number, seed: number): PixelBuffer {
  const H = Math.max(10, Math.round(46 * scale));
  const W = Math.max(6, Math.round(14 * scale));
  const p = new PixelBuffer(W + 2, H + 2);
  const cx = Math.round(W / 2) + 1;
  for (let y = 3; y <= H; y++) p.set(cx, y, 0x4a6a34);
  for (let y = Math.round(H * 0.1); y < H * 0.62; y += Math.max(1, Math.round(2 * scale))) {
    const side = Math.round(y / Math.max(1, Math.round(2 * scale))) % 2 ? 1 : -1;
    const bell = Math.max(1, Math.round((1 - y / H) * 3 * scale + 1));
    for (let k = 0; k < bell; k++) {
      p.set(cx + side * (k + 1), y + k * 0.4, k === bell - 1 ? 0xe8a8d8 : 0xb048a0);
      p.set(cx + side * (k + 1), y + 1 + k * 0.4, 0x8a2a7a);
    }
  }
  for (let k = -W / 2; k <= W / 2; k++) {
    const y = H - Math.abs(k) * 0.3;
    p.set(cx + k, y, 0x3e6a34);
    p.set(cx + k, y - 1, pixelHash(k, 1, seed) < 0.5 ? 0x5a8a46 : 0x4a7a3c);
  }
  p.outline(INK);
  return p;
}

/** A mossy boulder: grey stone cushioned with moss on top. */
export function drawRock(w: number, h: number, seed: number, haze: number, hazeColor: number): PixelBuffer {
  const W = Math.max(5, Math.round(w));
  const H = Math.max(3, Math.round(h));
  const p = new PixelBuffer(W + 2, H + 2);
  const hz = (c: number) => lerpColor(c, hazeColor, haze);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2);
      const dy = (y + 0.5 - H) / H;
      const d = dx * dx + dy * dy * (dy < 0 ? 1 : 0);
      if (d > 1 - pixelHash(x, y, seed) * 0.1) continue;
      const light = -dx * 0.5 - dy * 0.8;
      const mossy = -dy > 0.55 - valueNoise(x, y, 3, seed) * 0.4;
      const c = mossy ? MOSS[light > 0.7 ? 2 : light > 0.3 ? 1 : 0] : light > 0.4 ? 0x8a8a84 : light > 0 ? 0x6a6a66 : 0x4a4a48;
      p.set(x + 1, y + 1, hz(c));
    }
  }
  p.outline(hz(INK));
  return p;
}

/**
 * A clump of canopy hanging into the view: overlapping rounds of leaves lit
 * from above and the left, dark beneath, with a ragged lower edge.
 */
export function drawCanopyClump(w: number, h: number, pal: TreePalette, rng: () => number, clumps = 11, seed = 0): PixelBuffer {
  const foliage = new PixelBuffer(w, h);
  for (let c = 0; c < clumps; c++) {
    const r = randomRange(rng, Math.min(10, h * 0.2), Math.min(24, h * 0.38));
    const cx = randomRange(rng, r, w - r);
    const cy = randomRange(rng, r * 0.6, h - r);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - cy) / r;
        const d = dx * dx + dy * dy;
        if (d > 1 - pixelHash(x, y, seed + c) * 0.25) continue;
        const light = -dx * 0.6 - dy * 0.9 + (1 - d) * 0.3;
        foliage.set(x, y, light > 0.55 ? pal.highlight : light > 0.15 ? pal.light : light > -0.35 ? pal.base : light > -0.7 ? pal.dark : pal.shadow);
      }
    }
  }
  foliage.outline(pal.ink);
  return foliage;
}

/** A hanging strand of old-man's-beard lichen and moss, thinning to wisps. */
export function drawMossStrand(length: number, seed: number, haze: number, hazeColor: number): PixelBuffer {
  const L = Math.max(6, Math.round(length));
  const p = new PixelBuffer(7, L + 1);
  const hz = (c: number) => lerpColor(c, hazeColor, haze);
  for (let y = 0; y < L; y++) {
    const f = y / L;
    const x = 3 + Math.sin(y * 0.3 + seed) * (0.6 + f);
    const c = f < 0.3 ? 0x6a8a5a : f < 0.7 ? 0x8aa47a : 0xa8bc98;
    if (pixelHash(y, 1, seed) < 0.85 - f * 0.4) p.set(x, y, hz(c));
    if (f < 0.6 && pixelHash(y, 2, seed) < 0.5) p.set(x + (pixelHash(y, 3, seed) < 0.5 ? -1 : 1), y, hz(scaleColor(c, 0.8)));
  }
  return p;
}
