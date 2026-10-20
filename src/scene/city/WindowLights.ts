import { Sprite, type Texture } from 'pixi.js';
import { mood } from '../../state/mood';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import type { WindowRecord } from './cityGenerator';
import { clamp01 } from '../../core/math';

// Mostly a soft cream-white, as in the night drawing, with the odd warmer lamp.
const WARM = [0xfff0c8, 0xfff0c8, 0xffe8b8, 0xffdc9a, 0xfff6dc];
const COOL = [0xd6e8ff, 0xe8f0ff];
/** Rooms lit by a screen, or by a neon strip someone's put up. */
const TV = [0x7ab8ff, 0x8ac8ff];
/** Calm mode's warm cast over the lit windows (cool and neon rooms lean towards lamplight). */
const CALM_WARMTH = 0xffe2bc;
const NEON_ROOM = [0xff8ad8, 0xa88aff, 0x6ae0ff, 0xffb070];
/** Seconds between re-evaluating which windows are lit. */
const TICK_SECONDS = 0.5;

export interface LitWindow extends WindowRecord {
  /** The window is lit while the city-wide lit fraction exceeds this. */
  threshold: number;
  color: number;
  lit: boolean;
}

/**
 * Emissive overlay of lit windows for one building layer. Each window has
 * its own threshold that slowly random-walks, so lights switch on and off
 * individually and organically rather than all at once.
 */
export class WindowLights {
  readonly sprite: Sprite;
  private readonly canvas = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  private readonly texture: Texture;
  private readonly image: ImageData;
  private readonly windows: LitWindow[];
  private accumulator = TICK_SECONDS;
  private dirty = true;
  private readonly baseAlpha: number;

  constructor(
    windows: readonly WindowRecord[],
    private readonly rng: () => number,
    /** Scales how bright this layer's windows read (distant ones are dimmer). */
    brightness = 1,
  ) {
    this.windows = windows.map((w) => ({
      ...w,
      threshold: rng(),
      color: pickColor(rng),
      lit: false,
    }));
    this.image = this.canvas.ctx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
    this.texture = createNearestTexture(this.canvas.canvas);
    this.sprite = new Sprite(this.texture);
    this.baseAlpha = brightness;
  }

  /** A random window that currently has its light on, if any. */
  randomLitWindow(rng: () => number): LitWindow | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      const w = this.windows[Math.floor(rng() * this.windows.length)];
      // A real window, not a scatter of distant lit dots spread over a whole wall.
      if (w?.lit && w.w >= 3 && (!w.mask || w.mask.length >= w.w * w.h * 0.6)) return w;
    }
    return null;
  }

  /** @param litFraction share of windows that should be lit, 0..1 */
  update(dt: number, litFraction: number, emissive: number): void {
    this.sprite.alpha = this.baseAlpha * emissive;
    // The cosy city of calm mode: every lit room a little warmer.
    this.sprite.tint = mood.calm ? CALM_WARMTH : 0xffffff;
    this.accumulator += dt;
    if (this.accumulator < TICK_SECONDS) return;
    this.accumulator = 0;

    // Nudge a few thresholds each tick: someone turns a lamp off, another on.
    const nudges = Math.max(1, Math.ceil(this.windows.length * 0.006));
    for (let i = 0; i < nudges; i++) {
      const w = this.windows[Math.floor(this.rng() * this.windows.length)];
      if (w) w.threshold = clamp01(w.threshold + (this.rng() - 0.5) * 0.3);
    }

    for (const w of this.windows) {
      const lit = w.threshold < litFraction;
      if (lit !== w.lit) {
        w.lit = lit;
        this.dirty = true;
      }
    }
    if (this.dirty) this.redraw();
  }

  private redraw(): void {
    this.dirty = false;
    const data = this.image.data;
    data.fill(0);
    const paint = (i: number, c: number) => {
      const k = i * 4;
      data[k] = c >> 16;
      data[k + 1] = (c >> 8) & 255;
      data[k + 2] = c & 255;
      data[k + 3] = 255;
    };
    for (const w of this.windows) {
      if (!w.lit) continue;
      if (w.mask) for (const i of w.mask) paint(i, w.color);
      else for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) paint(y * WORLD_WIDTH + x, w.color);
    }
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }
}

function pickColor(rng: () => number): number {
  const r = rng();
  const set = r < 0.1 ? COOL : r < 0.18 ? TV : r < 0.25 ? NEON_ROOM : WARM;
  return set[Math.floor(rng() * set.length)];
}
