/** Colours are packed 0xRRGGBB numbers throughout, matching PixiJS tints. */

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/** A colour as a pixel in an RGBA image's 32-bit view (little-endian: alpha in the top byte). */
export function toPixel32(color: number, alpha = 255): number {
  return ((alpha << 24) | ((color & 0xff) << 16) | (color & 0xff00) | ((color >> 16) & 0xff)) >>> 0;
}

export function channels(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

export function pack(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export function lerpColor(a: number, b: number, t: number): number {
  // Hot in scenery painting: no arrays, no closures.
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.max(0, Math.min(255, Math.round(ar + (((b >> 16) & 255) - ar) * t)));
  const g = Math.max(0, Math.min(255, Math.round(ag + (((b >> 8) & 255) - ag) * t)));
  const bl = Math.max(0, Math.min(255, Math.round(ab + ((b & 255) - ab) * t)));
  return (r << 16) | (g << 8) | bl;
}

/** Relative luminance in [0, 1] (Rec. 709 weights on sRGB values). */
export function luminance(color: number): number {
  const [r, g, b] = channels(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Blend towards the colour's own grey by `amount` (0 = unchanged, 1 = grey). */
export function desaturate(color: number, amount: number): number {
  const [r, g, b] = channels(color);
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return pack(r + (grey - r) * amount, g + (grey - g) * amount, b + (grey - b) * amount);
}

export function scaleColor(color: number, factor: number): number {
  const [r, g, b] = channels(color);
  return pack(r * factor, g * factor, b * factor);
}

export function multiplyColor(a: number, b: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return pack((ar * br) / 255, (ag * bg) / 255, (ab * bb) / 255);
}
