import { Container, Sprite, type Texture } from 'pixi.js';
import { mood } from '../../state/mood';
import { lerpColor, scaleColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { hologramLevel } from '../../sim/wildlife';
import { bayer } from '../common/paint';
import type { Environment } from '../Environment';

/**
 * Holograms over the skyline after dark: a giant koi swimming slow loops
 * through the smog, and the city's AI idol projected above a far tower,
 * waving to the streets. Drawn in light (additive), with scanlines, and now
 * and then a glitch tears through them.
 */
export class Holograms {
  readonly container = new Container({ label: 'holograms' });
  private readonly koi = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private readonly koiGhost = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private readonly idol = new Sprite({ anchor: { x: 0.5, y: 1 }, blendMode: 'add' });
  private readonly beam = new Sprite({ anchor: { x: 0.5, y: 0 }, blendMode: 'add' });
  private readonly koiFrames: Texture[];
  private readonly idolFrames: Texture[];
  private t = Math.random() * 100;
  private glitch = 0;
  private glitchTimer = 8;

  constructor() {
    this.koiFrames = [0, 1, 2, 3].map((f) => koiArt(f).toTexture());
    this.idolFrames = [0, 1].map((f) => idolArt(f).toTexture());
    this.beam.texture = beamArt().toTexture();
    this.koiGhost.tint = 0xff4aff;
    this.container.addChild(this.beam, this.idol, this.koiGhost, this.koi);
    this.container.visible = false;
  }

  update(dt: number, env: Environment): void {
    // Fainter projections in calm mode.
    const level = hologramLevel(env.lighting.hours) * Math.min(1, env.lighting.emissive * 1.4) * (mood.calm ? 0.55 : 1);
    this.container.visible = level > 0.02;
    if (!this.container.visible) return;
    this.t += dt;
    this.glitchTimer -= dt;
    if (this.glitchTimer <= 0) {
      this.glitchTimer = 6 + Math.random() * 10;
      // In calm mode the projections hold steady.
      this.glitch = mood.calm ? 0 : 0.12 + Math.random() * 0.25;
    }
    const glitching = this.glitch > 0;
    if (glitching) this.glitch -= dt;
    // The koi: a slow figure of eight above the skyline, its tail sweeping.
    const a = this.t * 0.07;
    const x = 560 + Math.sin(a) * 190;
    const y = 70 + Math.sin(a * 2) * 24;
    const heading = Math.cos(a) >= 0 ? 1 : -1;
    const frame = Math.floor(this.t * 3) % 4;
    this.koi.texture = this.koiFrames[frame];
    this.koi.position.set(Math.round(x + (glitching ? (Math.random() - 0.5) * 6 : 0)), Math.round(y));
    this.koi.scale.x = heading;
    this.koi.alpha = level * (glitching ? 0.4 + Math.random() * 0.6 : 0.62 + 0.08 * Math.sin(this.t * 5));
    this.koiGhost.texture = this.koi.texture;
    this.koiGhost.visible = glitching;
    this.koiGhost.position.set(this.koi.x + 3, this.koi.y - 1);
    this.koiGhost.scale.x = heading;
    this.koiGhost.alpha = level * 0.35;
    // The idol: waving, flickering, standing on a beam of light from the tower top.
    this.idol.texture = this.idolFrames[Math.floor(this.t * 0.9) % 2];
    this.idol.position.set(612 + (glitching ? 2 : 0), 84);
    this.idol.alpha = level * (glitching ? 0.3 : 0.55 + 0.06 * Math.sin(this.t * 7));
    this.beam.position.set(612, 84);
    this.beam.alpha = level * 0.4;
  }
}

/** The koi, 96×40, in light: a cyan outline, a dim translucent body, orange and pink patches, a flowing fan of a tail. */
function koiArt(frame: number): PixelBuffer {
  const W = 96;
  const H = 40;
  const p = new PixelBuffer(W, H);
  const cy = H / 2;
  const body = 66;
  const tx = W - body;
  const phase = (frame / 4) * Math.PI * 2;
  const bend = (x: number) => Math.sin((x / W) * Math.PI * 1.2 + phase) * 2.6 * (1 - x / W);
  const profile = (x: number) => {
    // Head at the right, a full belly, tapering to the tail's root at the left.
    const u = (x - tx) / body;
    if (u < 0 || u > 1) return 0;
    const nose = u > 0.9 ? Math.sqrt(Math.max(0, 1 - ((u - 0.9) / 0.1) ** 2)) : 1;
    return (2.5 + 10.5 * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)) ** 0.8) * nose;
  };
  const set = (x: number, y: number, c: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) p.set(x, y, y % 2 === 1 ? scaleColor(c, 0.62) : c);
  };
  const dim = (x: number, y: number) => (bayer(x, y) < 0.4 ? 0x1a5a7a : 0x0c2c3e);
  // The tail: a fan of fin rays spreading behind, sweeping with the frame.
  for (let k = 0; k < 30; k++) {
    const x = tx - k + 2;
    const sweep = Math.sin(phase - k * 0.12) * (k / 30) * 7;
    const half = 2.5 + k * 0.42;
    const yc = cy + bend(tx) + sweep;
    for (let y = Math.floor(yc - half); y <= Math.ceil(yc + half); y++) {
      const v = (y - yc) / half;
      // Forked: a notch in the middle of the fan's end.
      if (Math.abs(v) > 1 || (k > 20 && Math.abs(v) < (k - 20) / 14)) continue;
      const ray = (Math.round(v * 6) + 8) % 2 === 0;
      set(x, y, Math.abs(v) > 0.88 || k === 29 ? 0x6af8ff : ray ? 0x2a86a8 : dim(x, y));
    }
  }
  // The body.
  for (let x = tx; x < W; x++) {
    const hh = profile(x);
    const yc = cy + bend(x);
    for (let y = Math.floor(yc - hh); y <= Math.ceil(yc + hh); y++) {
      const v = (y - yc) / hh;
      if (Math.abs(v) > 1) continue;
      const edge = Math.abs(v) > 0.86;
      // Koi markings: big orange and pink patches across the back, scales glinting.
      const n = Math.sin(x * 0.21) + Math.sin(x * 0.09 + 1.5) + v * 1.2;
      const patch = n > 0.5 && v < 0.5;
      const scale = (x + (y % 2) * 2) % 4 === 0 && (y + x) % 3 === 0;
      set(x, y, edge ? 0x6af8ff : patch ? (x > W - 30 ? 0xff7040 : 0xff4a9a) : scale ? 0x4ad8f0 : dim(x, y));
    }
  }
  // Dorsal fin along the back, pectoral fins below, whiskers and an eye.
  for (let x = tx + 20; x < tx + 46; x++) {
    const yc = cy + bend(x) - profile(x);
    const hgt = Math.sin(((x - tx - 20) / 26) * Math.PI) * 5;
    for (let k = 1; k <= hgt; k++) set(x, yc - k, k >= hgt - 1 ? 0x6af8ff : dim(x, Math.round(yc - k)));
  }
  const hx = W - 14;
  const hy = cy + bend(hx);
  for (const [fx, len] of [
    [hx - 14, 10],
    [hx - 38, 7],
  ] as const) {
    for (let k = 0; k < len; k++) {
      for (let w = 0; w <= k * 0.5; w++) set(fx - k - w * 0.4, hy + profile(fx) * 0.75 + k * 0.6 + Math.sin(phase + k * 0.3) * 1.2, w >= k * 0.5 - 0.5 ? 0x6af8ff : 0x2a86a8);
    }
  }
  for (let k = 0; k < 7; k++) {
    set(W - 3 + k * 0.2, hy + 2 + k, 0x9affff);
    set(W - 5 + k * 0.1, hy + 3 + k * 0.8, 0x6ad8ff);
  }
  set(hx + 4, hy - 4, 0xffffff);
  set(hx + 5, hy - 4, 0xffffff);
  set(hx + 4, hy - 3, 0x9affff);
  return p;
}

/** The AI idol, 30×62: long hair, a high collar, one arm raised to wave (frame 1 waving higher). */
function idolArt(frame: number): PixelBuffer {
  const W = 30;
  const H = 62;
  const p = new PixelBuffer(W, H);
  const cx = W / 2;
  const set = (x: number, y: number, c: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) p.set(x, y, y % 2 === 1 ? scaleColor(c, 0.55) : c);
  };
  const fill = (x: number, y: number, inner: boolean) => set(x, y, inner ? (bayer(x, y) < 0.5 ? 0x3a2a6a : 0x22184a) : 0xff8af0);
  // Head and the fall of her hair.
  for (let y = 4; y < 30; y++) {
    for (let x = 0; x < W; x++) {
      const head = Math.hypot((x - cx) / 4.6, (y - 9) / 5.6) < 1;
      const hair = y > 6 && y < 28 && Math.abs(x - cx) < 6.5 - (y - 6) * 0.02 && Math.abs(x - cx) > 3.5 - (y > 14 ? 3 : 0) && !head;
      if (!head && !hair) continue;
      const edge = head ? Math.hypot((x - cx) / 4.6, (y - 9) / 5.6) > 0.82 : Math.abs(x - cx) > 5.5;
      set(x, y, head ? (edge ? 0xffb8ff : 0x4a3a8a) : edge ? 0xb85aff : 0x6a3aaa);
    }
  }
  // Eyes that glow cyan.
  set(cx - 2, 9, 0x8affff);
  set(cx + 2, 9, 0x8affff);
  // Body: shoulders into a long coat, flaring at the hem.
  for (let y = 16; y < H - 2; y++) {
    const half = y < 22 ? 4 + (y - 16) * 0.6 : 7 + (y - 22) * 0.12;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) fill(x, y, Math.abs(x - cx) < half - 1 && y < H - 3);
  }
  // A belt of light, and the coat's seam.
  for (let x = cx - 6; x <= cx + 6; x++) set(x, 34, 0x8affff);
  for (let y = 35; y < H - 3; y++) set(cx, y, 0x6a4aaa);
  // One arm down, the other raised in a wave.
  for (let k = 0; k < 14; k++) set(cx - 8 - k * 0.12, 20 + k, 0xff8af0);
  const lift = frame === 1 ? 4 : 0;
  for (let k = 0; k < 13; k++) set(cx + 7 + k * 0.45, 20 - k * (0.9 + lift * 0.05) - (k > 9 ? lift * 0.3 : 0), 0xff8af0);
  set(cx + 13, 6 - lift, 0xffffff);
  return p;
}

/** The projector's beam from the tower top: a narrow cone of light, rising. */
function beamArt(): PixelBuffer {
  const W = 34;
  const H = 46;
  const p = new PixelBuffer(W, H);
  for (let y = 0; y < H; y++) {
    const t = 1 - y / H;
    const half = 2 + t * 14;
    for (let x = 0; x < W; x++) {
      const u = Math.abs(x + 0.5 - W / 2) / half;
      if (u >= 1) continue;
      const level = (1 - u) * (0.3 + 0.7 * (1 - t));
      if (level > bayer(x, y) * 1.2) p.set(x, y, lerpColor(0x000000, 0xb86aff, Math.min(1, level * 0.6)));
    }
  }
  return p;
}
