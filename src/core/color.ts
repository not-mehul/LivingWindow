/** Colours are packed 0xRRGGBB numbers throughout, matching PixiJS tints. */

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

export function channels(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

export function pack(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export function lerpColor(a: number, b: number, t: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
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

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
