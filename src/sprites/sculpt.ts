import { shadeStep, valueNoise, type Ramp } from './kit';
import { PixelGrid, pixelHash } from './raster';

/**
 * Organic forms for creatures drawn up close: parts built from smoothed
 * outlines and from tubes whose width varies along a curved spine (a thigh
 * that bulges and tapers to the hock, a tail that thins to its tip), each
 * rounded by its own distance from its edge — so any silhouette shades
 * like a solid form, not only ellipses. Where a part lies over another, the
 * one beneath falls into shadow along the join. Fluffy parts can have their
 * edges broken into tufts. Then the whole thing is painted at once from a
 * colour function that knows each pixel's part, its place across the part
 * and its surface normal.
 */

export type Pt = readonly [number, number];

/** Everything known about one pixel of a sculpt. */
export interface SculptPixel {
  x: number;
  y: number;
  part: number;
  /** Where in the part: across a frame (outlines: −1..1 each way), or along (u, 0..1) and across (v, −1..1) a sweep. */
  u: number;
  v: number;
  /** Surface normal. */
  nx: number;
  ny: number;
  nz: number;
  /** Distance in from the part's edge, px. */
  depth: number;
  /** Shadow cast along the join where another part lies over this one (0..1). */
  shadow: number;
}

export interface FurOptions {
  /** How ragged (0 smooth … 1 shaggy). */
  amount: number;
  /** The way the tufts lie (they stick out most on edges facing it); omit for all round. */
  dir?: Pt;
  seed?: number;
}

export interface PartOptions {
  /** Rounding depth, px: how far in from the edge the form keeps curving (default: nearly all the way to its middle). */
  round?: number;
  fur?: FurOptions;
  /** The part runs on beyond the box's edges (a body cut off by the bottom of the sprite): the box edge isn't its edge. */
  bleed?: boolean;
}

/** A Catmull-Rom curve through the points, `steps` samples per span. */
export function smoothPath(pts: readonly Pt[], closed = false, steps = 8): Pt[] {
  if (pts.length < 3) return [...pts];
  const n = pts.length;
  const at = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Strands of fur lying along `angle` (radians): a grain in −0.5..0.5 to add to a pixel's shade. */
export function furGrain(x: number, y: number, angle: number, seed = 0): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = x * c + y * s;
  const across = -x * s + y * c;
  return valueNoise(across * 0.9, along * 0.22, seed) - 0.5;
}

/** Fill a closed polygon into a mask by scanlines (pixel centres inside, even-odd). */
function fillPolygon(mask: PixelGrid, pts: readonly Pt[]): void {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(mask.height - 1, Math.ceil(Math.max(...ys)));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(mask.width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask.data[y * mask.width + x] = 1;
    }
  }
}

export class Sculpt {
  private readonly part: Int16Array;
  private readonly u: Float32Array;
  private readonly v: Float32Array;
  private readonly n: Float32Array;
  private readonly depth: Float32Array;
  private readonly shadow: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const size = width * height;
    this.part = new Int16Array(size);
    this.u = new Float32Array(size);
    this.v = new Float32Array(size);
    this.n = new Float32Array(size * 3);
    this.depth = new Float32Array(size);
    this.shadow = new Float32Array(size);
  }

  /** The part at a pixel (0 for none). */
  partAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.part[y * this.width + x];
  }

  /**
   * A part filled inside a smoothed closed outline. Its (u, v) run −1..1
   * across `frame` (centre and half-sizes; default its bounding box).
   */
  outline(part: number, pts: readonly Pt[], opts: PartOptions & { frame?: { cx: number; cy: number; rx: number; ry: number }; sharp?: boolean } = {}): void {
    const path = opts.sharp ? [...pts] : smoothPath(pts, true, 6);
    const mask = new PixelGrid(this.width, this.height);
    fillPolygon(mask, path);
    const xs = path.map((p) => p[0]);
    const ys = path.map((p) => p[1]);
    const frame = opts.frame ?? {
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      rx: Math.max(0.5, (Math.max(...xs) - Math.min(...xs)) / 2),
      ry: Math.max(0.5, (Math.max(...ys) - Math.min(...ys)) / 2),
    };
    this.commit(part, mask, (x, y) => [(x + 0.5 - frame.cx) / frame.rx, (y + 0.5 - frame.cy) / frame.ry], opts);
  }

  /**
   * A tube along a smoothed spine, `widths[i]` px across at `spine[i]`
   * (rounded at the ends). Its u runs 0..1 along it, v −1..1 across (+ on
   * the spine's right-hand side as you go along it).
   */
  sweep(part: number, spine: readonly Pt[], widths: readonly number[], opts: PartOptions = {}): void {
    const steps = 8;
    const path = smoothPath(spine, false, steps);
    // Widths eased between the authored points.
    const w = path.map((_, i) => {
      const f = i / steps;
      const a = Math.min(widths.length - 1, Math.floor(f));
      const b = Math.min(widths.length - 1, a + 1);
      const t = f - a;
      const e = t * t * (3 - 2 * t);
      return widths[a] + (widths[b] - widths[a]) * e;
    });
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const total = lengths[lengths.length - 1] || 1;
    const W = this.width;
    const mask = new PixelGrid(W, this.height);
    // Each pixel's nearest place on the spine, relative to the width there: found segment by segment, each only over its own box.
    const ratio = new Float32Array(W * this.height).fill(Infinity);
    const along = new Float32Array(W * this.height);
    const across = new Float32Array(W * this.height);
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1];
      const [bx, by] = path[i];
      const ra = w[i - 1] / 2;
      const rb = w[i] / 2;
      const r = Math.max(ra, rb) + 1;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-6;
      const len = Math.sqrt(len2);
      for (let y = Math.max(0, Math.floor(Math.min(ay, by) - r)); y <= Math.min(this.height - 1, Math.ceil(Math.max(ay, by) + r)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - r)); x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r)); x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          const qx = ax + dx * t;
          const qy = ay + dy * t;
          const rr = ra + (rb - ra) * t;
          const d = Math.hypot(px - qx, py - qy);
          const k = y * W + x;
          if (d <= rr) mask.data[k] = 1;
          const q = d / Math.max(0.5, rr);
          if (q < ratio[k]) {
            ratio[k] = q;
            along[k] = (lengths[i - 1] + len * t) / total;
            across[k] = Math.max(-1, Math.min(1, ((px - qx) * (-dy / len) + (py - qy) * (dx / len)) / Math.max(0.5, rr)));
          }
        }
      }
    }
    this.commit(part, mask, (x, y) => [along[y * W + x], across[y * W + x]], opts);
  }

  /** A part from a rotated ellipse (eyes, toes, small lumps). */
  ellipse(part: number, cx: number, cy: number, rx: number, ry: number, angle = 0, opts: PartOptions = {}): void {
    const mask = new PixelGrid(this.width, this.height);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const R = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = (dx * c + dy * s) / rx;
        const v = (-dx * s + dy * c) / ry;
        if (u * u + v * v <= 1) mask.set(x, y, 1);
      }
    }
    this.commit(part, mask, (x, y) => [((x + 0.5 - cx) * c + (y + 0.5 - cy) * s) / rx, (-(x + 0.5 - cx) * s + (y + 0.5 - cy) * c) / ry], opts);
  }

  /** Clear pixels inside a smoothed closed outline (a gap between legs, the dark of an open mouth's corner). */
  carve(pts: readonly Pt[]): void {
    const mask = new PixelGrid(this.width, this.height);
    fillPolygon(mask, smoothPath(pts, true, 6));
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) this.part[i] = 0;
  }

  /**
   * Paint the sculpt into `g`: `color` picks each pixel's ramp (shaded by
   * its normal, the join shadows and `bias`) or a fixed palette index, or
   * null to leave it empty.
   */
  paint(g: PixelGrid, color: (p: SculptPixel) => Ramp | number | null, opts: { dither?: boolean; bias?: (p: SculptPixel) => number } = {}): void {
    const { dither = true } = opts;
    const p: SculptPixel = { x: 0, y: 0, part: 0, u: 0, v: 0, nx: 0, ny: 0, nz: 1, depth: 0, shadow: 0 };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        if (!this.part[i]) continue;
        p.x = x;
        p.y = y;
        p.part = this.part[i];
        p.u = this.u[i];
        p.v = this.v[i];
        p.nx = this.n[i * 3];
        p.ny = this.n[i * 3 + 1];
        p.nz = this.n[i * 3 + 2];
        p.depth = this.depth[i];
        p.shadow = this.shadow[i];
        const c = color(p);
        if (c === null) continue;
        if (typeof c === 'number') {
          g.set(x, y, c);
          continue;
        }
        const bias = (opts.bias?.(p) ?? 0) - p.shadow * 1.8;
        g.set(x, y, c[shadeStep(p.nx, p.ny, p.nz, x, y, dither, bias)]);
      }
    }
  }

  /** Lay a part's mask over the sculpt: ragged fur, its rounding, the shadow it casts on what's beneath. */
  private commit(part: number, mask: PixelGrid, coord: (x: number, y: number) => [number, number], opts: PartOptions): void {
    const W = this.width;
    const H = this.height;
    if (opts.fur && opts.fur.amount > 0) roughen(mask, opts.fur);
    const box = bounds(mask);
    if (!box) return;
    const dist = distanceInside(mask, box, opts.bleed ? [W, H] : null);
    let deepest = 0;
    for (let i = 0; i < dist.length; i++) deepest = Math.max(deepest, dist[i]);
    const R = Math.max(1, Math.min(opts.round ?? deepest * 0.9, deepest));
    const [x0, y0, x1, y1] = box;
    const bw = x1 - x0 + 1;
    const h = new Float32Array(dist.length);
    for (let i = 0; i < h.length; i++) {
      if (!dist[i]) continue;
      const d = Math.min(dist[i], R) / R;
      // A quarter-circle profile: steep at the edge, flattening inside.
      h[i] = R * Math.sqrt(1 - (1 - d) * (1 - d));
    }
    const inMask = (x: number, y: number) => x >= x0 && y >= y0 && x <= x1 && y <= y1 && mask.data[y * W + x] !== 0;
    const offBox = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H;
    const hAt = (x: number, y: number, fallback: number) => (inMask(x, y) ? h[(y - y0) * bw + (x - x0)] : opts.bleed && offBox(x, y) ? fallback : fallback - 1.2);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!mask.data[i]) continue;
        this.shadow[i] = 0;
        const hc = h[(y - y0) * bw + (x - x0)];
        const gx = (hAt(x + 1, y, hc) - hAt(x - 1, y, hc)) / 2;
        const gy = (hAt(x, y + 1, hc) - hAt(x, y - 1, hc)) / 2;
        const len = Math.hypot(gx, gy, 1);
        this.n[i * 3] = -gx / len;
        this.n[i * 3 + 1] = -gy / len;
        this.n[i * 3 + 2] = 1 / len;
        const [u, v] = coord(x, y);
        this.u[i] = u;
        this.v[i] = v;
        this.depth[i] = dist[(y - y0) * bw + (x - x0)];
        this.part[i] = part;
      }
    }
    // The join's shadow on whatever lies just outside this part, below and to the right.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!mask.data[y * W + x]) continue;
        for (const [dx, dy, k] of JOIN_SHADOW) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (mask.data[j] || !this.part[j]) continue;
          this.shadow[j] = Math.min(1, this.shadow[j] + k);
        }
      }
    }
  }
}

const JOIN_SHADOW: ReadonlyArray<readonly [number, number, number]> = [[0, 1, 0.7], [1, 0, 0.5], [1, 1, 0.45], [0, 2, 0.3], [-1, 1, 0.3], [-1, 0, 0.2]];

/** The bounding box of a mask's set pixels, or null if it's empty. */
function bounds(mask: PixelGrid): [number, number, number, number] | null {
  const W = mask.width;
  let x0 = W;
  let y0 = mask.height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Chamfer distance (px) from each set pixel to the nearest unset one, over the box (indexed within it). */
function distanceInside(mask: PixelGrid, [x0, y0, x1, y1]: [number, number, number, number], bleed: [number, number] | null = null): Float32Array {
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const d = new Float32Array(W * H);
  const BIG = 1e6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = mask.data[(y + y0) * mask.width + x + x0] ? BIG : 0;
  // Outside the box: empty, unless the part bleeds off the sprite there (then it's as deep as can be).
  const at = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) return d[y * W + x];
    if (!bleed) return 0;
    const gx = x + x0;
    const gy = y + y0;
    return gx < 0 || gy < 0 || gx >= bleed[0] || gy >= bleed[1] ? BIG : 0;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.41, at(x + 1, y - 1) + 1.41);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.41, at(x - 1, y + 1) + 1.41);
    }
  }
  // Distance measured to the edge of the pixel, so a one-pixel line still has some depth.
  for (let i = 0; i < d.length; i++) if (d[i]) d[i] -= 0.5;
  return d;
}

/** Break a mask's edge into tufts: some sticking out (most on the side `dir` points to), a few notches in. */
function roughen(mask: PixelGrid, fur: FurOptions): void {
  const W = mask.width;
  const H = mask.height;
  const seed = fur.seed ?? 7;
  const [dx, dy] = fur.dir ?? [0, 0];
  const dl = Math.hypot(dx, dy) || 1;
  const add: number[] = [];
  const cut: number[] = [];
  const box = bounds(mask);
  if (!box) return;
  for (let y = Math.max(0, box[1] - 1); y <= Math.min(H - 1, box[3] + 1); y++) {
    for (let x = Math.max(0, box[0] - 1); x <= Math.min(W - 1, box[2] + 1); x++) {
      const set = mask.get(x, y) !== 0;
      // The direction out of the mask here.
      let ox = 0;
      let oy = 0;
      let edge = false;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nb = mask.get(x + ax, y + ay) !== 0;
        if (nb !== set) {
          edge = true;
          if (set) {
            ox += ax;
            oy += ay;
          } else {
            ox -= ax;
            oy -= ay;
          }
        }
      }
      if (!edge) continue;
      const facing = fur.dir ? Math.max(0, (ox * dx + oy * dy) / (dl * (Math.hypot(ox, oy) || 1))) : 0.6;
      const r = pixelHash(x, y, seed);
      if (!set && r < fur.amount * (0.25 + facing * 0.6)) add.push(y * W + x);
      else if (set && r < fur.amount * 0.12) cut.push(y * W + x);
    }
  }
  for (const i of add) mask.data[i] = 1;
  for (const i of cut) mask.data[i] = 0;
  // A second, sparser layer of longer tufts in the lie of the fur.
  if (fur.dir) {
    const tip: number[] = [];
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    for (const i of add) {
      const x = i % W;
      const y = Math.floor(i / W);
      const nx = x + sx;
      const ny = y + sy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!mask.get(nx, ny) && pixelHash(x, y, seed + 1) < fur.amount * 0.5) tip.push(ny * W + nx);
    }
    for (const i of tip) mask.data[i] = 1;
  }
}
