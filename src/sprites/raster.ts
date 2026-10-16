/**
 * A tiny indexed-colour rasterizer for procedural pixel art. Shapes are
 * filled by testing pixel centres, so they come out with hard, aliased edges
 * at any size, which is what lets sprites be generated at exactly the size
 * a depth needs instead of being scaled (and shimmering).
 */
export class PixelGrid {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x];
  }

  set(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = color;
  }

  /** Fill pixels whose centre is inside a (rotated) ellipse. `color` may vary per pixel. */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: number | ((u: number, v: number, x: number, y: number) => number),
    angle = 0,
  ): void {
    const r = Math.max(rx, ry) + 1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = (dx * cos + dy * sin) / Math.max(0.01, rx);
        const v = (-dx * sin + dy * cos) / Math.max(0.01, ry);
        if (u * u + v * v <= 1) {
          const c = typeof color === 'number' ? color : color(u, v, x, y);
          if (c > 0) this.set(x, y, c);
        }
      }
    }
  }

  /** Fill a polygon (even–odd rule) given as [x, y] pairs. */
  polygon(points: ReadonlyArray<readonly [number, number]>, color: number): void {
    const ys = points.map((p) => p[1]);
    const xs = points.map((p) => p[0]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (insidePolygon(x + 0.5, y + 0.5, points)) this.set(x, y, color);
      }
    }
  }

  /** A line of a given thickness (in pixels). */
  line(x0: number, y0: number, x1: number, y1: number, color: number, thickness = 1): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (thickness <= 1) this.set(Math.floor(x), Math.floor(y), color);
      else this.ellipse(x, y, thickness / 2, thickness / 2, color);
    }
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let yy = Math.floor(y); yy < Math.floor(y + h); yy++) {
      for (let xx = Math.floor(x); xx < Math.floor(x + w); xx++) this.set(xx, yy, color);
    }
  }

  /** Replace colour `from` with `to` wherever `test` passes. */
  recolor(from: number, to: number, test: (x: number, y: number) => boolean = () => true): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) === from && test(x, y)) this.set(x, y, to);
      }
    }
  }

  /** Paint empty pixels that touch a filled one (4-neighbourhood) with `color`. */
  outline(color: number): void {
    const add: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) !== 0) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) {
          add.push(y * this.width + x);
        }
      }
    }
    for (const i of add) this.data[i] = color;
  }

  /** Recolour every filled pixel (for flat silhouettes at tiny sizes). */
  flatten(color: number): void {
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) this.data[i] = color;
  }

  /** Mirror horizontally in place. */
  flip(): void {
    for (let y = 0; y < this.height; y++) {
      const row = this.data.subarray(y * this.width, (y + 1) * this.width);
      row.reverse();
    }
  }

  /** A copy resized to w × h by nearest neighbour (crisp pixels, the odd row or column doubled or dropped). */
  resampled(w: number, h: number): PixelGrid {
    const out = new PixelGrid(Math.max(1, w), Math.max(1, h));
    for (let y = 0; y < out.height; y++) {
      const sy = Math.min(this.height - 1, Math.floor(((y + 0.5) * this.height) / out.height));
      for (let x = 0; x < out.width; x++) {
        const sx = Math.min(this.width - 1, Math.floor(((x + 0.5) * this.width) / out.width));
        out.data[y * out.width + x] = this.data[sy * this.width + sx];
      }
    }
    return out;
  }

  isEmpty(): boolean {
    return this.data.every((v) => v === 0);
  }

  /** RGBA pixels using a palette of 0xRRGGBB colours (index 0 is transparent). */
  toRGBA(palette: readonly number[]): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.data.length; i++) {
      const index = this.data[i];
      if (!index) continue;
      const c = palette[index] ?? 0xff00ff;
      out[i * 4] = (c >> 16) & 255;
      out[i * 4 + 1] = (c >> 8) & 255;
      out[i * 4 + 2] = c & 255;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}

function insidePolygon(x: number, y: number, points: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Cheap deterministic hash of pixel coordinates, for feather and fur texture. */
export function pixelHash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
