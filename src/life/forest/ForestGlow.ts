import { Container, Sprite, type Texture } from 'pixi.js';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Environment } from '../../scene/Environment';
import { glowTexture } from '../../scene/common/glow';
import { pixelHash } from '../../sprites/raster';
import { clamp01 } from '../../core/math';

/** How strongly the fungi glow (0..1): only in the dark, a little brighter when it's damp. */
export function fungusGlow(darkness: number, damp: number): number {
  return clamp01((darkness - 0.55) / 0.35) * (0.8 + damp * 0.2);
}

/** Whether wisps are about: a deep, misty night. */
export function wispWeather(darkness: number, mist: number): number {
  return clamp01((darkness - 0.7) / 0.2) * clamp01((mist - 0.4) / 0.3);
}

interface Cluster {
  caps: Sprite;
  glow: Sprite;
  phase: number;
}

interface Wisp {
  sprite: Sprite;
  core: Sprite;
  x: number;
  y: number;
  tx: number;
  ty: number;
  life: number;
  age: number;
  pause: number;
}

/**
 * The wood's lights after dark: clusters of foxfire, little bioluminescent
 * caps and glowing moss on the logs and the feet of the trunks, breathing a
 * slow cold green; and on misty nights, a will-o'-the-wisp or two deep among
 * the trunks: pale lights drifting, pausing, slipping behind the trees, and
 * fading if you watch too long.
 */
export class ForestGlow {
  private readonly clusters: Cluster[] = [];
  private readonly wisps: Wisp[] = [];
  private readonly wispTexture: Texture;
  private readonly wispCore: Texture;
  private wispTimer = 10;

  constructor(
    private readonly midground: Container,
    /** Where the near logs are drawn, above the wood (fungi on them go here). */
    front: Container,
    spots: ReadonlyArray<{ x: number; y: number; size: number; front?: boolean }>,
    private readonly roam: { x0: number; x1: number; y0: number; y1: number },
    private readonly mist: () => number,
  ) {
    for (const [i, s] of spots.entries()) {
      const art = fungusCluster(s.size, 50 + i);
      const caps = new Sprite({ texture: art.toTexture(), anchor: { x: 0.5, y: 1 }, blendMode: 'add' });
      caps.position.set(Math.round(s.x), Math.round(s.y));
      caps.zIndex = s.y + 0.4;
      const glow = new Sprite({ texture: glowTexture(Math.max(5, Math.round(s.size * 3)), 0x58e8b0, 0.6, false), anchor: 0.5, blendMode: 'add' });
      glow.position.set(Math.round(s.x), Math.round(s.y - s.size * 0.4));
      glow.zIndex = s.y + 0.3;
      caps.visible = glow.visible = false;
      (s.front ? front : midground).addChild(glow, caps);
      this.clusters.push({ caps, glow, phase: Math.random() * 6 });
    }
    this.wispTexture = glowTexture(11, 0x9ae8f0, 1, false);
    this.wispCore = glowTexture(2, 0xe8fff8, 1, true);
  }

  get wispCount(): number {
    return this.wisps.length;
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather } = env;
    const damp = Math.min(1, weather.precipitation * 2 + Math.max(0, weather.cloudCover - 0.7));
    const level = fungusGlow(lighting.darkness, damp);
    for (const c of this.clusters) {
      const on = level > 0.02;
      c.caps.visible = c.glow.visible = on;
      if (!on) continue;
      c.phase += dt;
      // A slow breath of light, each cluster in its own time.
      const breathe = 0.65 + 0.35 * Math.sin(c.phase * 0.5);
      c.caps.alpha = level * (0.7 + 0.3 * breathe);
      c.glow.alpha = level * 0.85 * breathe;
    }

    // Wisps.
    const want = wispWeather(lighting.darkness, this.mist());
    this.wispTimer -= dt;
    if (want > 0.05 && this.wispTimer <= 0 && this.wisps.length < 3) {
      this.wispTimer = 25 + Math.random() * 70;
      this.spawn();
    }
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const w = this.wisps[i];
      w.age += dt;
      if (w.pause > 0) w.pause -= dt;
      else {
        const dx = w.tx - w.x;
        const dy = w.ty - w.y;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          // Hang there a moment, then drift on.
          w.pause = 1 + Math.random() * 4;
          this.retarget(w);
        } else {
          const speed = 5 + Math.sin(w.age * 0.7) * 2;
          w.x += (dx / d) * speed * dt;
          w.y += (dy / d) * speed * dt + Math.sin(w.age * 1.9) * dt * 1.5;
        }
      }
      const fadeIn = Math.min(1, w.age / 3);
      const fadeOut = Math.min(1, Math.max(0, w.life - w.age) / 4);
      const flicker = 0.75 + 0.25 * Math.sin(w.age * 6.3 + i) * Math.sin(w.age * 2.1);
      const a = fadeIn * fadeOut * flicker * Math.max(0.2, want);
      w.sprite.alpha = a;
      w.core.alpha = a;
      w.sprite.position.set(w.x, w.y);
      w.core.position.set(Math.round(w.x), Math.round(w.y));
      // Sorted among the trunks by how far back it is, so it slips behind the nearer ones.
      w.sprite.zIndex = w.core.zIndex = w.y + 14;
      if (w.age >= w.life) {
        w.sprite.destroy();
        w.core.destroy();
        this.wisps.splice(i, 1);
      }
    }
  }

  private spawn(): void {
    const sprite = new Sprite({ texture: this.wispTexture, anchor: 0.5, blendMode: 'add' });
    const core = new Sprite({ texture: this.wispCore, anchor: 0.5, blendMode: 'add' });
    const w: Wisp = {
      sprite,
      core,
      x: this.roam.x0 + Math.random() * (this.roam.x1 - this.roam.x0),
      y: this.roam.y0 + Math.random() * (this.roam.y1 - this.roam.y0),
      tx: 0,
      ty: 0,
      life: 20 + Math.random() * 40,
      age: 0,
      pause: 0,
    };
    this.retarget(w);
    sprite.alpha = core.alpha = 0;
    this.midground.addChild(sprite, core);
    this.wisps.push(w);
  }

  private retarget(w: Wisp): void {
    w.tx = Math.max(this.roam.x0, Math.min(this.roam.x1, w.x + (Math.random() - 0.5) * 120));
    w.ty = Math.max(this.roam.y0, Math.min(this.roam.y1, w.y + (Math.random() - 0.5) * 16));
  }
}

/** A little cluster of glowing caps on a log or a root (drawn in light), with glowing moss round them. */
export function fungusCluster(size: number, seed: number): PixelBuffer {
  const S = Math.max(4, Math.round(size));
  const W = S * 2 + 2;
  const H = Math.max(4, Math.round(S * 0.9)) + 1;
  const p = new PixelBuffer(W, H);
  const caps = 3 + Math.floor(pixelHash(seed, 1, 2) * 4);
  // Moss glowing faintly along the bottom.
  for (let x = 0; x < W; x++) if (pixelHash(x, 2, seed) < 0.45) p.set(x, H - 1, 0x1a5a40);
  for (let k = 0; k < caps; k++) {
    const x = 1 + Math.round(pixelHash(k, 3, seed) * (W - 3));
    const stem = 1 + Math.round(pixelHash(k, 4, seed) * (H - 3));
    const w = 1 + (pixelHash(k, 5, seed) < 0.4 ? 1 : 0);
    for (let y = H - 2; y > H - 2 - stem; y--) p.set(x, y, 0x3a9a78);
    const top = H - 2 - stem;
    for (let i = -w; i <= w; i++) p.set(x + i, top, Math.abs(i) === w ? 0x58d8a8 : 0x9affd8);
    if (w > 1) p.set(x, top - 1, 0x7af0c0);
  }
  return p;
}
