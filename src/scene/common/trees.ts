import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { pixelHash } from '../../sprites/raster';

/** Colours for a tree, darkest to lightest foliage plus bark and ink. */
export interface TreePalette {
  ink: number;
  shadow: number;
  dark: number;
  base: number;
  light: number;
  highlight: number;
  bark: number;
  barkDark: number;
}

export const CONIFER: TreePalette = {
  ink: 0x1a2c22,
  shadow: 0x2a4634,
  dark: 0x365a40,
  base: 0x46704a,
  light: 0x5a8654,
  highlight: 0x739e62,
  bark: 0x5a4030,
  barkDark: 0x3a281c,
};

export const BROADLEAF: TreePalette = {
  ink: 0x1e3018,
  shadow: 0x34542a,
  dark: 0x42683a,
  base: 0x547e44,
  light: 0x6c9650,
  highlight: 0x88ae5e,
  bark: 0x5e4a3a,
  barkDark: 0x3e3024,
};

/** Fade a palette towards a haze colour (atmospheric perspective). */
export function hazePalette(p: TreePalette, haze: number, amount: number): TreePalette {
  const mix = (c: number) => lerpColor(c, haze, amount);
  return {
    ink: mix(p.ink),
    shadow: mix(p.shadow),
    dark: mix(p.dark),
    base: mix(p.base),
    light: mix(p.light),
    highlight: mix(p.highlight),
    bark: mix(p.bark),
    barkDark: mix(p.barkDark),
  };
}

export interface DrawnTree {
  buffer: PixelBuffer;
  /** Where the trunk meets the ground, within the buffer. */
  baseX: number;
  baseY: number;
  /** The very top of the tree (a perch for birds). */
  tipX: number;
  tipY: number;
  /** Sturdy side branches to perch on, within the buffer. */
  perches: Array<{ x0: number; x1: number; y: number }>;
}

/**
 * A spruce/fir in profile, built from whorls of drooping branches: each
 * branch sags towards its tip and hangs a ragged fringe of needles, upper
 * whorls overlapping the ones below. The sunny left side is lighter. Tall
 * trees get an ink outline like the reference drawing; tiny ones stay soft.
 */
export function drawConifer(height: number, seed: number, palette: TreePalette = CONIFER, ink = height >= 16): DrawnTree {
  return paintConifer(height, seed, palette, ink, { widthRatio: 0.46, crownEnd: 0.9, trunkRatio: 0.08 });
}

/**
 * A tall old pine: a long bare trunk with plated bark, and a narrower crown
 * of drooping whorls over only its top part. In front of the window these are
 * the trunks deer walk between.
 */
export function drawTallPine(height: number, seed: number, palette: TreePalette = CONIFER, ink = height >= 16): DrawnTree {
  return paintConifer(height, seed, palette, ink, { widthRatio: 0.34, crownEnd: 0.46, trunkRatio: 0.16, plated: true });
}

interface ConiferShape {
  /** Crown width as a fraction of the height. */
  widthRatio: number;
  /** Where the lowest boughs end, as a fraction of the height. */
  crownEnd: number;
  /** Trunk width as a fraction of the crown width. */
  trunkRatio: number;
  /** Reddish, plated bark lit on the left (old pines). */
  plated?: boolean;
}

function paintConifer(height: number, seed: number, palette: TreePalette, ink: boolean, shape: ConiferShape): DrawnTree {
  const H = Math.max(4, Math.round(height));
  const W = Math.max(3, Math.round(H * shape.widthRatio)) | 1;
  const pad = ink ? 1 : 0;
  const p = new PixelBuffer(W + pad * 2, H + pad);
  const cx = W / 2 + pad;
  const crownTop = Math.max(2, Math.round(H * 0.03));
  const crownBottom = Math.round(H * shape.crownEnd);
  // Trunk: mostly hidden by the boughs on a spruce, long and bare on an old pine.
  const trunkWidth = Math.max(1, Math.round(W * shape.trunkRatio));
  for (let y = Math.round(H * 0.15); y < H; y++) {
    // A slight flare at the foot.
    const flare = y > H * 0.94 ? Math.round((y - H * 0.94) * 0.5) : 0;
    const w = trunkWidth + flare * 2;
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      let color = u < 0.3 ? palette.bark : palette.barkDark;
      if (shape.plated && w >= 3) {
        if (u < 0.25) color = lerpColor(palette.bark, 0xffffff, 0.12);
        else if (u > 0.7) color = lerpColor(palette.barkDark, 0x000000, 0.2);
        if (y % 5 === 0 && pixelHash(Math.floor(i / 2), Math.floor(y / 5), seed) < 0.5) color = palette.barkDark;
      }
      p.set(cx - w / 2 + i, y, color);
    }
  }
  // Whorl heights: denser towards the top, with a little irregularity.
  const whorls: number[] = [];
  const count = Math.min(22, Math.max(4, Math.round(H / 6.5)));
  for (let i = 0; i < count; i++) {
    const f = (i + 0.3 + (pixelHash(i, 0, seed) - 0.5) * 0.5) / count;
    whorls.push(crownTop + (crownBottom - crownTop) * f ** 1.12);
  }
  const perches: DrawnTree['perches'] = [];
  const needle = (x: number, y: number, side: number, t: number, below: number) => {
    // Upper surfaces catch the light; the fringe beneath is in shadow.
    let color: number;
    if (below < 0) color = side < 0 ? palette.highlight : palette.light;
    else if (below < 1.5) color = side < 0 ? palette.light : palette.base;
    else if (below < 3) color = side < 0 ? palette.base : palette.dark;
    else color = palette.shadow;
    if (t < 0.18) color = palette.dark;
    if (pixelHash(x, y, seed + 11) < 0.06) color = palette.shadow;
    p.set(x, y, color);
  };
  // Lowest whorls first, so each whorl's fringe hangs over the one beneath.
  for (let i = whorls.length - 1; i >= 0; i--) {
    const y0 = whorls[i];
    const f = (y0 - crownTop) / (crownBottom - crownTop);
    const reach = (W / 2 - 0.5) * (0.12 + 0.88 * f) * (0.85 + 0.3 * pixelHash(i, 1, seed));
    const droop = reach * (0.28 + 0.2 * pixelHash(i, 2, seed));
    const fringe = Math.max(1, H * 0.035 + reach * 0.22);
    for (const side of [-1, 1]) {
      const steps = Math.max(2, Math.ceil(reach * 1.4));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = Math.round(cx + side * reach * t);
        const y = y0 + droop * t * t;
        // Ragged hanging needles: longer mid-branch, tapering to the tip.
        const hang = fringe * (0.5 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (0.6 + 0.6 * pixelHash(x, i, seed + 3));
        const lift = t > 0.85 ? 0 : 1;
        for (let dy = -lift; dy <= hang; dy++) needle(x, Math.round(y + dy), side, t, dy);
      }
    }
    if (H > 40 && f > 0.45 && i % 3 === 0) {
      const side = pixelHash(i, 9, seed) < 0.5 ? -1 : 1;
      const x0 = Math.round(cx + side * reach * 0.35);
      const x1 = Math.round(cx + side * reach * 0.7);
      perches.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y: Math.round(y0 + droop * 0.2) - 1 });
    }
  }
  // The leader: a thin spike at the very top.
  for (let y = 0; y <= crownTop + 1; y++) p.set(cx, y + pad, palette.base);
  if (ink) p.outline(palette.ink);
  return { buffer: p, baseX: Math.round(cx), baseY: H - 1, tipX: Math.round(cx), tipY: pad, perches };
}

/**
 * A broadleaf tree: a forked trunk under a crown of round leaf clumps, lit
 * from the upper left with dark hollows between clumps.
 */
export function drawBroadleaf(height: number, seed: number, palette: TreePalette = BROADLEAF, ink = height >= 16): DrawnTree {
  const H = Math.max(6, Math.round(height));
  const W = Math.round(H * 0.72);
  const pad = ink ? 1 : 0;
  const p = new PixelBuffer(W + pad * 2, H + pad);
  const cx = W / 2 + pad;
  const crownBottom = H * 0.62;
  // Trunk and the limbs it forks into.
  const trunkW = Math.max(1, H * 0.06);
  const limb = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const width = Math.max(1, w * (1 - t * 0.5));
      for (let j = 0; j < width; j++) p.set(x - width / 2 + j, y, j < width * 0.4 ? palette.bark : palette.barkDark);
    }
  };
  limb(cx, H - 1, cx, crownBottom, trunkW);
  limb(cx, crownBottom + H * 0.08, cx - W * 0.22, H * 0.36, trunkW * 0.7);
  limb(cx, crownBottom + H * 0.04, cx + W * 0.2, H * 0.32, trunkW * 0.7);
  // Crown clumps.
  const clumps: Array<[number, number, number]> = [];
  const count = 5 + Math.round(H / 20);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + pixelHash(i, 2, seed) * 0.8;
    const ring = i === 0 ? 0 : 0.55 + pixelHash(i, 3, seed) * 0.35;
    const r = (W * (0.16 + pixelHash(i, 4, seed) * 0.08)) * (i === 0 ? 1.3 : 1);
    clumps.push([cx + Math.cos(a) * W * 0.28 * ring, H * 0.34 + Math.sin(a) * H * 0.2 * ring, r]);
  }
  clumps.sort((a, b) => a[1] - b[1]);
  for (const [ccx, ccy, r] of clumps) {
    for (let y = Math.floor(ccy - r); y <= ccy + r; y++) {
      for (let x = Math.floor(ccx - r); x <= ccx + r; x++) {
        const dx = (x + 0.5 - ccx) / r;
        const dy = (y + 0.5 - ccy) / r;
        const d = dx * dx + dy * dy;
        if (d > 1 - pixelHash(x, y, seed) * 0.22) continue;
        // Lit from the upper left; rims of each clump go darker.
        const light = -dx * 0.6 - dy * 0.9 + (1 - d) * 0.4;
        let color = light > 0.55 ? palette.highlight : light > 0.15 ? palette.light : light > -0.35 ? palette.base : palette.dark;
        if (d > 0.82 && dy > 0) color = palette.shadow;
        if (pixelHash(x, y, seed + 1) < 0.08) color = palette.dark;
        p.set(x, y, color);
      }
    }
  }
  if (ink) p.outline(palette.ink);
  const perches = [
    { x0: Math.round(cx - W * 0.3), x1: Math.round(cx - W * 0.16), y: Math.round(H * 0.5) },
    { x0: Math.round(cx + W * 0.14), x1: Math.round(cx + W * 0.28), y: Math.round(H * 0.46) },
  ];
  return { buffer: p, baseX: Math.round(cx), baseY: H - 1, tipX: Math.round(cx), tipY: Math.round(H * 0.06), perches };
}
