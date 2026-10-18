import { Container, Graphics, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { glowTexture } from '../common/glow';
import type { Environment } from '../Environment';
import type { CityLayout } from './cityGenerator';

interface Puff {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  grey: number;
}

/**
 * The rooftops' evenings: strings of coloured bulbs that come on at dusk and
 * twinkle, and smoke curling from a grill at dinnertime and from a shack's
 * stovepipe in the cold hours.
 */
export class RoofAmbience {
  readonly container = new Container({ label: 'roof-ambience' });
  private readonly bulbs: Array<{ sprite: Sprite; core: Sprite; phase: number }> = [];
  private readonly smokeGfx = new Graphics();
  private readonly puffs: Puff[] = [];
  private readonly timers: number[];
  private level = 0;

  constructor(private readonly city: CityLayout) {
    for (const b of city.roofLights) {
      const halo = new Sprite({ texture: glowTexture(3, b.color, 1, false), blendMode: 'add', anchor: 0.5 });
      halo.position.set(b.x, b.y);
      const core = new Sprite({ texture: glowTexture(1, lerpColor(b.color, 0xffffff, 0.5), 1, true), blendMode: 'add', anchor: 0.5 });
      core.position.set(b.x, b.y);
      halo.visible = core.visible = false;
      this.container.addChild(halo, core);
      this.bulbs.push({ sprite: halo, core, phase: Math.random() * Math.PI * 2 });
    }
    this.container.addChild(this.smokeGfx);
    this.timers = city.smoke.map(() => Math.random());
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather } = env;
    // Someone plugs the bulbs in as dusk falls, and they're unplugged late.
    const h = lighting.hours;
    const wanted = (h > 18 || h < 1) && lighting.emissive > 0.25 ? 1 : 0;
    this.level += (wanted - this.level) * Math.min(1, dt * 1.5);
    this.bulbs.forEach((b, i) => {
      const on = this.level > 0.02;
      b.sprite.visible = b.core.visible = on;
      if (!on) return;
      // A gentle twinkle, and one bulb that's loose in its socket.
      const tw = 0.8 + 0.2 * Math.sin(env.time * 1.7 + b.phase);
      const loose = i === 3 && Math.sin(env.time * 7.3) > 0.6 ? 0.2 : 1;
      b.sprite.alpha = this.level * 0.7 * tw * loose;
      b.core.alpha = this.level * tw * loose;
    });

    // Smoke: a grill from six to nine, a stovepipe in the early morning and late at night.
    const raining = weather.kind === 'rain' && weather.precipitation > 0.3;
    this.city.smoke.forEach((spot, i) => {
      const active = spot.kind === 'grill' ? h > 18 && h < 21.5 && !raining : h < 8.5 || h > 22;
      if (!active) return;
      this.timers[i] -= dt;
      if (this.timers[i] <= 0) {
        this.timers[i] = spot.kind === 'grill' ? 0.18 : 0.45;
        this.puffs.push({ x: spot.x + (Math.random() - 0.5) * 2 * spot.scale, y: spot.y, age: 0, life: 3 + Math.random() * 2, size: (spot.kind === 'grill' ? 2 : 1.4) * spot.scale * 2, grey: spot.kind === 'grill' ? 0xd8d4cc : 0xb8b4ae });
      }
    });
    const g = this.smokeGfx;
    g.clear();
    const wind = weather.wind ?? 0.2;
    for (let k = this.puffs.length - 1; k >= 0; k--) {
      const p = this.puffs[k];
      p.age += dt;
      if (p.age > p.life) {
        this.puffs.splice(k, 1);
        continue;
      }
      const t = p.age / p.life;
      p.y -= dt * (6 - t * 3);
      p.x += dt * (2 + wind * 10) * t + Math.sin(p.age * 2 + p.size) * dt;
      const r = Math.max(1, Math.round(p.size * (1 + t * 2)));
      g.rect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), r, r).fill({ color: p.grey, alpha: 0.45 * (1 - t) });
    }
    g.tint = lerpColor(lighting.ambient, 0xffffff, 0.15);
  }
}
