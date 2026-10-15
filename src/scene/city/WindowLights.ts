import { Sprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import type { WindowRecord } from './cityGenerator';

const WARM = ['#ffd27a', '#ffd27a', '#ffc764', '#ffe1a0', '#ffb85c'];
const COOL = ['#bfe0ff', '#d6e8ff'];
/** Seconds between re-evaluating which windows are lit. */
const TICK_SECONDS = 0.5;

interface LitWindow extends WindowRecord {
  /** The window is lit while the city-wide lit fraction exceeds this. */
  threshold: number;
  color: string;
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
      color: rng() < 0.12 ? COOL[Math.floor(rng() * COOL.length)] : WARM[Math.floor(rng() * WARM.length)],
      lit: false,
    }));
    this.texture = createNearestTexture(this.canvas.canvas);
    this.sprite = new Sprite(this.texture);
    this.baseAlpha = brightness;
  }

  /** @param litFraction share of windows that should be lit, 0..1 */
  update(dt: number, litFraction: number, emissive: number): void {
    this.sprite.alpha = this.baseAlpha * emissive;
    this.accumulator += dt;
    if (this.accumulator < TICK_SECONDS) return;
    this.accumulator = 0;

    // Nudge a few thresholds each tick: someone turns a lamp off, another on.
    const nudges = Math.max(1, Math.ceil(this.windows.length * 0.006));
    for (let i = 0; i < nudges; i++) {
      const w = this.windows[Math.floor(this.rng() * this.windows.length)];
      if (w) w.threshold = Math.min(1, Math.max(0, w.threshold + (this.rng() - 0.5) * 0.3));
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
    const { ctx } = this.canvas;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    for (const w of this.windows) {
      if (w.lit) this.canvas.rect(w.x, w.y, w.w, w.h, w.color);
    }
    this.texture.source.update();
  }
}
