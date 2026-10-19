import { Container, Graphics, Sprite } from 'pixi.js';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Environment } from '../../scene/Environment';
import { pixelHash } from '../../sprites/raster';
import { wrapHours } from '../../state/timeOfDay';

/** How much the silk shows (0..1): it glistens in low morning sun, beaded with dew; by day it's faint, at night all but gone. */
export function webShine(hours: number, sunUp: boolean, clear: number): number {
  const h = wrapHours(hours);
  const morning = h > 5.5 && h < 10 ? Math.min(1, (h - 5.5) * 1.2) * Math.min(1, (10 - h) * 0.8) : 0;
  const evening = h > 16 && h < 19.5 ? Math.min(1, (h - 16) * 0.8) * Math.min(1, (19.5 - h) * 1.2) * 0.6 : 0;
  const lit = sunUp ? 0.25 + Math.max(morning, evening) * 0.75 * clear : 0.08;
  return Math.min(1, lit);
}

interface Web {
  sprite: Sprite;
  x: number;
  y: number;
  r: number;
  beads: Array<{ x: number; y: number; phase: number }>;
  phase: number;
  spider: { a: number; t: number; out: number };
}

/**
 * Orb webs strung between the plants and branches: radial spokes and a
 * spiral of capture silk, a spider at the hub. They breathe and sway a
 * little in the air, catch the light (glistening in a low sun, beaded with
 * dew on a clear morning), and now and then the spider goes out along a
 * spoke to mend the web and comes back to the hub.
 */
export class Webs {
  readonly container = new Container({ label: 'webs' });
  private readonly webs: Web[] = [];
  private readonly beads = new Graphics();
  private readonly spiders = new Graphics();

  constructor(spots: ReadonlyArray<{ x: number; y: number; r: number }>) {
    for (const [i, s] of spots.entries()) {
      const art = drawWeb(s.r, 31 + i * 7);
      const sprite = new Sprite({ texture: art.buffer.toTexture(), anchor: 0.5 });
      sprite.position.set(s.x, s.y);
      sprite.alpha = 0;
      this.container.addChild(sprite);
      this.webs.push({ sprite, x: s.x, y: s.y, r: s.r, beads: art.beads, phase: Math.random() * 6, spider: { a: Math.random() * 6, t: 0, out: 0 } });
    }
    this.beads.blendMode = 'add';
    this.container.addChild(this.beads, this.spiders);
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather } = env;
    const clear = 1 - weather.cloudCover * 0.7;
    const shine = webShine(lighting.hours, lighting.sun.visible, clear);
    const h = lighting.hours;
    const dewy = h > 5.5 && h < 9.5 && weather.precipitation < 0.1 ? Math.min(1, (h - 5.5) * 1.5) * Math.min(1, (9.5 - h)) : weather.precipitation > 0.1 ? 0.6 : 0;
    const wind = weather.wind ?? 0.2;
    this.beads.clear();
    this.spiders.clear();
    for (const w of this.webs) {
      w.phase += dt;
      // The web bellies and swings a little in the moving air.
      const sway = Math.sin(w.phase * 1.3) * (0.3 + Math.abs(wind) * 1.2);
      w.sprite.position.set(w.x + sway, w.y + Math.abs(sway) * 0.3);
      w.sprite.scale.set(1 + Math.sin(w.phase * 0.9) * 0.01 * (1 + Math.abs(wind) * 2), 1);
      w.sprite.alpha = 0.16 + shine * 0.5;
      w.sprite.tint = lighting.sun.visible ? lighting.sun.color : lighting.ambient;
      // Dew beads glinting as the web moves.
      if (dewy > 0.02 || shine > 0.6) {
        for (const b of w.beads) {
          const g = Math.sin(w.phase * 2.4 + b.phase * 6);
          if (g < 0.4) continue;
          const a = (g - 0.4) * 1.6 * Math.max(dewy, (shine - 0.6) * 1.5);
          this.beads.rect(Math.round(w.x + sway + b.x), Math.round(w.y + b.y), 1, 1).fill({ color: 0xffffff, alpha: Math.min(1, a) });
        }
      }
      // The spider: at the hub, now and then out along a spoke and back.
      const sp = w.spider;
      sp.t -= dt;
      if (sp.t <= 0) {
        sp.t = 6 + Math.random() * 18;
        sp.a = Math.random() * Math.PI * 2;
        sp.out = 0.01;
      }
      if (sp.out > 0) {
        sp.out += dt * 0.35;
        if (sp.out > 2) sp.out = 0;
      }
      const reach = sp.out > 0 ? Math.sin(Math.min(1, sp.out / 2) * Math.PI) * w.r * 0.6 : 0;
      const sx = Math.round(w.x + sway + Math.cos(sp.a) * reach);
      const sy = Math.round(w.y + Math.sin(sp.a) * reach);
      this.spiders.rect(sx, sy, 1, 1).fill({ color: 0x2a2018 });
      this.spiders.rect(sx, sy + 1, 1, 1).fill({ color: 0x4a3828 });
      if (w.r > 12) this.spiders.rect(sx - 1, sy, 1, 1).fill({ color: 0x2a2018, alpha: 0.6 });
    }
    this.spiders.tint = lighting.ambient;
  }
}

/** An orb web of radius `r`: spokes from the hub, a spiral of capture silk, anchor lines to the corners; and where dew beads on it. */
export function drawWeb(r: number, seed: number): { buffer: PixelBuffer; beads: Array<{ x: number; y: number; phase: number }> } {
  const R = Math.max(5, Math.round(r));
  const size = R * 2 + 7;
  const p = new PixelBuffer(size, size);
  const c = size / 2;
  const silk = 0xe8eef0;
  const beads: Array<{ x: number; y: number; phase: number }> = [];
  const spokes = 9 + Math.round(pixelHash(seed, 1, 2) * 4);
  const angles = Array.from({ length: spokes }, (_, k) => (k / spokes) * Math.PI * 2 + (pixelHash(k, 3, seed) - 0.5) * 0.25);
  // The web's outline is irregular: each spoke a different length.
  const len = angles.map((_, k) => R * (0.8 + pixelHash(k, 4, seed) * 0.25));
  for (const [k, a] of angles.entries()) {
    for (let t = 1; t < len[k]; t += 0.6) p.set(c + Math.cos(a) * t, c + Math.sin(a) * t, silk, 200);
  }
  // Anchor threads off to the frame from the outermost spokes.
  for (const k of [0, Math.floor(spokes / 3), Math.floor((2 * spokes) / 3)]) {
    const a = angles[k];
    for (let t = len[k]; t < R + 3; t += 0.6) p.set(c + Math.cos(a) * t, c + Math.sin(a) * t, silk, 140);
  }
  // The capture spiral, sagging slightly between spokes.
  const turns = Math.max(3, Math.round(R / 3.2));
  for (let turn = 0; turn < 1; turn += 0.002) {
    const rad = R * (0.22 + turn * 0.72);
    const a = turn * Math.PI * 2 * turns;
    const k = Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / spokes));
    if (rad > len[k % spokes] - 1) continue;
    const sag = Math.sin((a * spokes) / 2) ** 2 * 0.6;
    const x = c + Math.cos(a) * (rad - sag);
    const y = c + Math.sin(a) * (rad - sag);
    p.set(x, y, silk, 130);
    if (pixelHash(Math.round(x), Math.round(y), seed) < 0.12) beads.push({ x: Math.round(x - c), y: Math.round(y - c), phase: pixelHash(Math.round(x), 9, seed) });
  }
  // The hub, a little denser.
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (Math.abs(i) + Math.abs(j) < 2) p.set(c + i, c + j, silk, 220);
  return { buffer: p, beads };
}
