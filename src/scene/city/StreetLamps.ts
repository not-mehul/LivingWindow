import { Container, Sprite, type Texture } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { bayer } from '../common/paint';
import type { StreetLampSpot } from './cityGenerator';

interface Lamp {
  spot: StreetLampSpot;
  /** Darkness level at which this lamp's sensor trips. */
  threshold: number;
  on: boolean;
  /** Seconds left in the warm-up flicker. */
  flicker: number;
  flickerLit: boolean;
  flickerTimer: number;
  /** How brightly it is shining now, 0..1 (its pool of light follows this). */
  level: number;
  glow: Sprite;
  cone: Sprite;
}

/** A soft, dithered halo round a lamp's glass (drawn additively), sized for its distance. */
function haloTexture(radius: number, color: number): Texture {
  const size = radius * 2 + 1;
  const p = new PixelBuffer(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - radius, y - radius) / (radius + 0.5);
      if (d >= 1) continue;
      const level = (1 - d) ** 2 * 4;
      let step = Math.floor(level);
      if (level - step > bayer(x, y)) step++;
      if (step <= 0) continue;
      p.set(x, y, lerpColor(0x000000, color, Math.min(1, step / 4)));
    }
  }
  // A hot core.
  p.set(radius, radius, 0xffffff);
  return p.toTexture();
}

/** A faint, dithered beam from a lamp's glass down to its pool on the paving (drawn additively). */
function coneTexture(height: number, topHalf: number, bottomHalf: number, color: number): Texture {
  const width = Math.ceil(bottomHalf) * 2 + 1;
  const cx = width / 2;
  const p = new PixelBuffer(width, Math.max(1, height));
  const ramp = [0, lerpColor(0, color, 0.08), lerpColor(0, color, 0.15), lerpColor(0, color, 0.23)];
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1);
    const half = topHalf + (bottomHalf - topHalf) * t;
    for (let x = 0; x < width; x++) {
      const u = Math.abs(x + 0.5 - cx) / half;
      if (u >= 1) continue;
      // Brightest just under the lamp, thinning out towards the ground and the beam's edges.
      const level = (1 - t * 0.65) * (1 - u * u) * 3.2;
      let step = Math.floor(level);
      if (level - step > bayer(x, y)) step++;
      step = Math.min(3, step);
      if (step > 0) p.set(x, y, ramp[step]);
    }
  }
  return p.toTexture();
}

/**
 * Street lamps that flicker on one by one as darkness falls: their glass
 * glows in a soft halo over a faint beam of light. (Their pools of light on
 * the paving are drawn by the scene, following each lamp's `level`.) Sodium-amber down by the market,
 * a whiter light further up the street.
 */
export class StreetLamps {
  readonly container = new Container({ label: 'lamp-glow' });
  private readonly lamps: Lamp[];

  constructor(
    spots: readonly StreetLampSpot[],
    private readonly rng: () => number,
  ) {
    const textures = new Map<string, Texture>();
    this.lamps = spots.map((spot) => {
      const color = spot.depth < 5 ? 0xffb860 : 0xffe2b8;
      const radius = Math.max(2, Math.round(9 * spot.scale));
      const key = `${radius}:${color}`;
      let texture = textures.get(key);
      if (!texture) textures.set(key, (texture = haloTexture(radius, color)));
      const glow = new Sprite({ texture, anchor: 0.5, blendMode: 'add' });
      glow.position.set(spot.x, spot.y);
      glow.visible = false;
      const cone = new Sprite({ texture: coneTexture(spot.groundY - spot.y, Math.max(1, 3 * spot.scale), 30 * spot.scale, color), anchor: { x: 0.5, y: 0 } });
      cone.position.set(spot.x, spot.y);
      cone.blendMode = 'add';
      cone.visible = false;
      this.container.addChild(cone, glow);
      return { spot, threshold: 0.42 + rng() * 0.16, on: false, flicker: 0, flickerLit: false, flickerTimer: 0, level: 0, glow, cone };
    });
  }

  /** How brightly lamp `i` is shining, 0..1. */
  level(i: number): number {
    return this.lamps[i]?.level ?? 0;
  }

  update(dt: number, darkness: number, emissive: number): void {
    for (const lamp of this.lamps) {
      const wantOn = lamp.on ? darkness > lamp.threshold - 0.05 : darkness > lamp.threshold;
      if (wantOn && !lamp.on) {
        lamp.on = true;
        lamp.flicker = 0.5 + this.rng() * 1.2;
        lamp.flickerTimer = 0;
      } else if (!wantOn && lamp.on) {
        lamp.on = false;
        lamp.flicker = 0;
      }
      if (lamp.flicker > 0) {
        lamp.flicker -= dt;
        lamp.flickerTimer -= dt;
        if (lamp.flickerTimer <= 0 || lamp.flicker <= 0) {
          lamp.flickerLit = lamp.flicker <= 0 ? true : !lamp.flickerLit;
          lamp.flickerTimer = 0.04 + this.rng() * 0.16;
        }
      }
      const lit = lamp.on && (lamp.flicker <= 0 || lamp.flickerLit);
      // Sodium lamps warm up rather than snapping on.
      lamp.level += ((lit ? emissive : 0) - lamp.level) * Math.min(1, dt * (lit ? 3 : 8));
      lamp.glow.visible = lamp.cone.visible = lamp.level > 0.02;
      lamp.glow.alpha = lamp.cone.alpha = lamp.level;
    }
  }
}
