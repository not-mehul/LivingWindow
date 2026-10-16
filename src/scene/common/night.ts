import { Container, Sprite } from 'pixi.js';
import { lerpColor, scaleColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Lighting } from '../lighting';

/**
 * How a layer looks by moonlight, after the night drawings: colour drained
 * towards grey, a cool cast, and a lift so shapes stay readable rather than
 * sinking into murk. Tints are multipliers per channel; lift is added (0–255).
 */
export interface NightGrade {
  /** 0 keeps the day's colours, 1 is fully grey before the cast. */
  desaturate: number;
  tint: readonly [number, number, number];
  lift: readonly [number, number, number];
}

/** Grade one 0xRRGGBB colour for the night. */
export function gradeColor(color: number, g: NightGrade): number {
  const r = (color >> 16) & 255;
  const gr = (color >> 8) & 255;
  const b = color & 255;
  const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  const ch = (c: number, k: number) => Math.max(0, Math.min(255, Math.round((c + (lum - c) * g.desaturate) * g.tint[k] + g.lift[k])));
  return (ch(r, 0) << 16) | (ch(gr, 1) << 8) | ch(b, 2);
}

/** A moonlit copy of a layer's art (same shape, graded colours). */
export function nightVariant(src: PixelBuffer, g: NightGrade): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  const s = src.data;
  const d = out.data;
  // Many pixels share a colour: cache the graded ones.
  const cache = new Map<number, number>();
  for (let k = 0; k < s.length; k += 4) {
    if (s[k + 3] === 0) continue;
    const c = (s[k] << 16) | (s[k + 1] << 8) | s[k + 2];
    let n = cache.get(c);
    if (n === undefined) {
      n = gradeColor(c, g);
      cache.set(c, n);
    }
    d[k] = n >> 16;
    d[k + 1] = (n >> 8) & 255;
    d[k + 2] = n & 255;
    d[k + 3] = s[k + 3];
  }
  return out;
}

/**
 * A static layer that cross-fades from its daylight art (tinted for the hour
 * as before) to its glowing dusk-and-dawn version, then to its moonlit one.
 */
export class DayNightSprite {
  readonly container = new Container();
  readonly day: Sprite;
  readonly dusk: Sprite | null;
  readonly night: Sprite;

  /** Grades for the moonlit night and (optionally) the glow of dusk and dawn. */
  constructor(art: PixelBuffer, grade: NightGrade, twilight?: NightGrade) {
    this.day = new Sprite(art.toTexture());
    this.dusk = twilight ? new Sprite(nightVariant(art, twilight).toTexture()) : null;
    this.night = new Sprite(nightVariant(art, grade).toTexture());
    this.night.alpha = 0;
    this.container.addChild(this.day);
    if (this.dusk) {
      this.dusk.alpha = 0;
      this.container.addChild(this.dusk);
    }
    this.container.addChild(this.night);
  }

  /** `dayTint` is what the layer was tinted before; at dusk and dawn, then at night, the graded art takes over, dimmed under cloud. */
  update(dayTint: number, lighting: Pick<Lighting, 'nightness' | 'twilight' | 'moonlight' | 'ambient'>): void {
    this.day.tint = dayTint;
    const n = lighting.nightness;
    const t = this.dusk ? lighting.twilight : 0;
    this.night.visible = n > 0.001;
    this.night.alpha = n;
    this.night.tint = scaleColor(0xffffff, 0.62 + 0.38 * lighting.moonlight);
    if (this.dusk) {
      // Once dusk has faded in it carries the scene until the night art covers it.
      const alpha = Math.min(1, t + n);
      this.dusk.visible = alpha > 0.001 && n < 0.999;
      this.dusk.alpha = alpha;
      // Under cloud (which also dims the moon) the glow is greyer and dimmer.
      this.dusk.tint = lerpColor(scaleColor(0xffffff, 0.7 + 0.3 * lighting.moonlight), lighting.ambient, 0.2);
    }
    this.day.visible = n + t < 0.999;
  }
}
