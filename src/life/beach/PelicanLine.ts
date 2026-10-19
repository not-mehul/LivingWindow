import { Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { BeachScene } from '../../scene/beach/BeachScene';
import type { Environment } from '../../scene/Environment';
import { hourWindow } from '../../sim/interplay';
import { BEACH_HORIZON } from '../../sim/shore';
import { drawPelican, type PelicanPose } from '../../sprites/beachSprites';
import { DrawnCache } from '../../sprites/wildSprites';

const r = (min: number, max: number) => min + Math.random() * (max - min);

const FLAP: readonly PelicanPose[] = ['flap-up', 'flap-mid', 'flap-down', 'flap-mid'];

/**
 * In the last hour of light, a line of pelicans heading home along the
 * coast: gliding low over the swell in single file, rising and falling
 * with it, and now and then the leader gives a few slow beats and the
 * wingbeats ripple back down the line, one bird after another.
 */
export class PelicanLine {
  private readonly sprites = new DrawnCache();
  private line: { x: number; y: number; dir: 1 | -1; birds: Array<{ sprite: Sprite; flapAt: number }>; t: number; size: number } | null = null;
  private flownToday = false;
  private forced = false;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {}

  get flying(): boolean {
    return this.line !== null;
  }

  summon(): void {
    this.forced = true;
  }

  update(dt: number, env: Environment): void {
    const h = env.lighting.hours;
    if (h > 10 && h < 17) this.flownToday = false;
    if (!this.line) {
      const dusk = hourWindow(h, 17.8, 19.6, 0.3) > 0.5 && env.weather.precipitation < 0.3 && env.weather.lightning < 0.2;
      if (this.forced || (dusk && !this.flownToday && Math.random() < dt / 120)) {
        this.forced = false;
        this.flownToday = true;
        this.start();
      }
      return;
    }
    const L = this.line;
    L.t += dt;
    L.x += L.dir * 24 * dt;
    // Every so often the leader beats its wings, and the beats run back along the line.
    if (L.t > L.birds[0].flapAt + 6 && Math.random() < dt * 0.25) L.birds.forEach((b, i) => (b.flapAt = L.t + i * 0.45));
    const tint = lerpColor(env.lighting.ambient, 0x302838, 0.25);
    L.birds.forEach((b, i) => {
      const k = L.t - b.flapAt;
      const pose: PelicanPose = k >= 0 && k < 1.6 ? FLAP[Math.floor(k * 4) % 4] : 'glide';
      // Each a length behind and a touch above the one in front, riding the air off the swell.
      const x = L.x - L.dir * i * L.size * 1.1;
      const y = L.y - i * 1.5 + Math.sin(L.t * 0.9 - i * 0.7) * 1.4;
      b.sprite.texture = this.sprites.get(`${pose}:${L.size}`, () => drawPelican(pose, L.size));
      b.sprite.scale.x = L.dir;
      b.sprite.position.set(Math.round(x), Math.round(y));
      b.sprite.tint = tint;
    });
    const last = L.x - L.dir * L.birds.length * L.size * 1.1;
    const left = this.viewport.panX - 60;
    const right = this.viewport.panX + this.viewport.layout.visibleWorldWidth + 60;
    if ((L.dir > 0 && last > right) || (L.dir < 0 && last < left)) {
      for (const b of L.birds) b.sprite.destroy();
      this.line = null;
    }
  }

  private start(): void {
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const y = BEACH_HORIZON + r(10, 22);
    const size = Math.round(12 + (y - BEACH_HORIZON) * 0.35);
    const n = 3 + Math.floor(Math.random() * 3);
    const x = dir > 0 ? this.viewport.panX - 30 : this.viewport.panX + this.viewport.layout.visibleWorldWidth + 30;
    const birds = Array.from({ length: n }, () => {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      this.scene.horizonLayer.addChild(sprite);
      return { sprite, flapAt: -10 };
    });
    this.line = { x, y, dir, birds, t: 0, size };
  }
}
