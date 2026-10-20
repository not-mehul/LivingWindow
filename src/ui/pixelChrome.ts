import { PixelBuffer } from '../core/pixelBuffer';
import { ALU, BEZEL, drawWallpaper } from '../window/SillTablet';

/** Art pixels of bezel round the panel's screen: one of aluminium, the rest black. */
export const BEZEL_PIXELS = 6;
/** How far each row of a corner steps in, from the outside: a small pixel-rounded corner. */
const CORNER = [3, 1, 1];

function toDataUrl(p: PixelBuffer): string {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * The tablet's case for the panel, as a 9-slice `border-image`: the
 * aluminium edge (lit on the left and top, in shadow on the right and
 * below, as on the sill sprite), the black bezel inside it and stepped
 * corners. The middle pixel is the screen and is left empty.
 */
export function bezelPixels(): PixelBuffer {
  const t = BEZEL_PIXELS;
  const n = t * 2 + 1;
  const p = new PixelBuffer(n, n);
  const inset = (y: number) => CORNER[Math.min(y, n - 1 - y)] ?? 0;
  const inside = (x: number, y: number) => {
    if (y < 0 || y >= n) return false;
    const i = inset(y);
    return x >= i && x <= n - 1 - i;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inside(x, y) || (x === t && y === t)) continue;
      let c = BEZEL;
      if (!inside(x - 1, y)) c = ALU.light;
      else if (!inside(x + 1, y)) c = ALU.dark;
      else if (!inside(x, y - 1)) c = ALU.base;
      else if (!inside(x, y + 1)) c = ALU.edge;
      p.set(x, y, c);
    }
  }
  return p;
}

let bezelUrl = '';
export function bezelImage(): string {
  return (bezelUrl ||= toDataUrl(bezelPixels()));
}

/**
 * The tablet's wallpaper for the panel's header, `cols`×`rows` art pixels:
 * only the deeper top of the bands shows, so the clock reads over it.
 */
export function wallpaperImage(cols: number, rows: number, hours: number): string {
  const p = drawWallpaper(cols, Math.round(rows * 1.7), hours, new PixelBuffer(cols, rows));
  // A dark line where the header meets the settings.
  for (let x = 0; x < cols; x++) p.set(x, rows - 1, BEZEL, 120);
  return toDataUrl(p);
}
