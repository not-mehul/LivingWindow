import { Graphics, Sprite, Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';

interface Pulse {
  at: number;
  amplitude: number;
}

const PULSE_DECAY = 0.07;
const STRIKE_SECONDS = 1;
/** Strikes nearer than this (0..1) show a visible bolt. */
const BOLT_DISTANCE = 0.65;

/**
 * Lightning: a multi-pulse flash that lights the whole world (and, via
 * `flash`, the room), plus a jagged pixel bolt for closer strikes.
 */
export class Lightning {
  /** Additive white wash over the world. Add on top of the world scene. */
  readonly overlay: Sprite;
  /** Bolt graphics. Add into the sky, behind clouds and the skyline. */
  readonly bolt = new Graphics();

  private pulses: Pulse[] = [];
  private elapsed = STRIKE_SECONDS;
  private strength = 0;
  private _flash = 0;

  constructor(
    private readonly horizonY: number,
    private readonly rng: () => number = Math.random,
  ) {
    this.overlay = new Sprite({ texture: Texture.WHITE, blendMode: 'add', tint: 0xe4e8ff });
    this.overlay.width = WORLD_WIDTH;
    this.overlay.height = WORLD_HEIGHT;
    this.overlay.alpha = 0;
  }

  /** Current flash brightness, 0..1. */
  get flash(): number {
    return this._flash;
  }

  /** Flash (and maybe draw a bolt). Returns the strike's world x, for panning thunder. */
  strike(intensity: number, distance: number): number {
    const rng = this.rng;
    this.elapsed = 0;
    this.strength = intensity * (1 - 0.6 * distance);
    this.pulses = [{ at: 0, amplitude: 1 }];
    // Real strikes usually flicker: a return stroke or two after the first.
    if (rng() < 0.75) this.pulses.push({ at: 0.06 + rng() * 0.06, amplitude: 0.35 + rng() * 0.35 });
    if (rng() < 0.4) this.pulses.push({ at: 0.18 + rng() * 0.1, amplitude: 0.5 + rng() * 0.4 });
    this.bolt.clear();
    const x = 40 + Math.floor(rng() * (WORLD_WIDTH - 80));
    if (distance < BOLT_DISTANCE) this.drawBolt(x, distance);
    return x;
  }

  update(dt: number): void {
    if (this.elapsed >= STRIKE_SECONDS) return;
    this.elapsed += dt;
    let flash = 0;
    for (const pulse of this.pulses) {
      if (this.elapsed < pulse.at) continue;
      flash = Math.max(flash, pulse.amplitude * Math.exp(-(this.elapsed - pulse.at) / PULSE_DECAY));
    }
    this._flash = flash * this.strength;
    this.overlay.alpha = this._flash * 0.5;
    this.bolt.alpha = Math.min(1, this._flash * 2.5);
    if (this.elapsed >= STRIKE_SECONDS) {
      this._flash = 0;
      this.overlay.alpha = 0;
      this.bolt.clear();
    }
  }

  private drawBolt(x: number, distance: number): void {
    const rng = this.rng;
    const g = this.bolt;
    const near = distance < 0.3;
    const segment = (x: number, y: number, endY: number, branchChance: number) => {
      let px = x;
      for (let py = y; py < endY; py++) {
        px += Math.round((rng() - 0.5) * 2.6);
        g.rect(px - 1, py, 3, 1).fill({ color: 0x9c9cff, alpha: 0.45 }); // glow
        g.rect(px, py, near ? 2 : 1, 1).fill(0xf8f6ff);
        if (rng() < branchChance && endY - py > 20) {
          segment(px, py, py + 12 + Math.floor(rng() * 40), 0);
        }
      }
    };
    const top = Math.floor(rng() * 25);
    segment(x, top, this.horizonY + 10, 0.05);
  }
}
