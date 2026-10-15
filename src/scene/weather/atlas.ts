import { Rectangle, Texture } from 'pixi.js';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';

/**
 * One small texture holding every weather particle frame. Particle
 * containers require all their particles to share a texture source.
 */
export interface WeatherAtlas {
  /** rain[lengthIndex][slant + 2]: streaks of length 3, 5 and 8 px, slanted -2..2 px. */
  rain: Texture[][];
  snow: Texture[];
  splash: Texture;
  /** Drops on the glass: 1×1 trail bead up to a large 3×5 runner. */
  glassDrops: Texture[];
  glassSnow: Texture[];
}

export const RAIN_LENGTHS = [3, 5, 8] as const;
export const RAIN_SLANTS = [-2, -1, 0, 1, 2] as const;

export function createWeatherAtlas(): WeatherAtlas {
  const c = new PixelCanvas(96, 16);
  const frames: Array<{ x: number; y: number; w: number; h: number }> = [];
  let cursor = 0;
  const frame = (w: number, h: number, draw: (x: number) => void) => {
    const x = cursor;
    draw(x);
    frames.push({ x, y: 0, w, h });
    cursor += w + 1;
    return frames.length - 1;
  };

  // Streaks sit in a 3 px wide frame. A slant of ±2 runs corner to corner,
  // ±1 shifts by one pixel; the head (bottom) is brightest.
  const rainIdx = RAIN_LENGTHS.map((length) =>
    RAIN_SLANTS.map((slant) =>
      frame(3, length, (x0) => {
        for (let i = 0; i < length; i++) {
          const t = (2 * i) / (length - 1) - 1; // -1 at the top, +1 at the head
          const x = x0 + 1 + Math.round((slant / 2) * t);
          c.ctx.globalAlpha = 0.4 + 0.6 * (i / (length - 1));
          c.px(x, i, '#ffffff');
        }
        c.ctx.globalAlpha = 1;
      }),
    ),
  );

  const snowIdx = [
    frame(1, 1, (x) => c.px(x, 0, '#ffffff')),
    frame(2, 2, (x) => {
      c.px(x, 0, '#ffffff');
      c.px(x + 1, 1, '#ffffff');
      c.ctx.globalAlpha = 0.7;
      c.px(x + 1, 0, '#ffffff');
      c.px(x, 1, '#ffffff');
      c.ctx.globalAlpha = 1;
    }),
    frame(3, 3, (x) => {
      c.px(x + 1, 0, '#ffffff');
      c.px(x, 1, '#ffffff');
      c.px(x + 1, 1, '#ffffff');
      c.px(x + 2, 1, '#ffffff');
      c.px(x + 1, 2, '#ffffff');
    }),
  ];

  const splashIdx = frame(3, 2, (x) => {
    c.ctx.globalAlpha = 0.8;
    c.px(x + 1, 0, '#e6eefa');
    c.px(x, 1, '#e6eefa');
    c.px(x + 2, 1, '#e6eefa');
    c.ctx.globalAlpha = 1;
  });

  // Drops on glass read as tiny lenses: a pale body, a dark refracted rim
  // along the bottom and a bright specular highlight.
  const drop = (w: number, h: number) =>
    frame(w, h, (x) => {
      if (w === 1) {
        c.ctx.globalAlpha = 0.85;
        c.px(x, 0, '#e4eef8');
        c.ctx.globalAlpha = 1;
        return;
      }
      c.ctx.globalAlpha = 0.7;
      c.rect(x, 0, w, h, '#c4d6ea');
      c.ctx.globalAlpha = 1;
      c.hline(x, h - 1, w, '#5f7a9c');
      if (w > 2) c.vline(x + w - 1, 1, h - 1, '#6a82a2');
      c.px(x, 0, '#ffffff');
      if (h > 3) c.px(x, 1, '#f0f6ff');
    });
  const glassIdx = [drop(1, 1), drop(2, 2), drop(2, 3), drop(3, 4), drop(3, 5)];

  const glassSnowIdx = [
    frame(1, 1, (x) => c.px(x, 0, '#ffffff')),
    frame(2, 2, (x) => {
      c.rect(x, 0, 2, 2, '#f4f8ff');
      c.px(x + 1, 1, '#c8d4e8');
    }),
  ];

  const base = createNearestTexture(c.canvas).source;
  const tex = (i: number) => {
    const f = frames[i];
    return new Texture({ source: base, frame: new Rectangle(f.x, f.y, f.w, f.h) });
  };
  return {
    rain: rainIdx.map((row) => row.map(tex)),
    snow: snowIdx.map(tex),
    splash: tex(splashIdx),
    glassDrops: glassIdx.map(tex),
    glassSnow: glassSnowIdx.map(tex),
  };
}
