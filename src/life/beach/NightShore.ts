import { Sprite, type Container } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { drawNightjar, NIGHTJAR_FRAMES } from '../../sprites/shoreSprites';
import { DrawnCache } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { wrapHours } from '../../state/timeOfDay';

/** How much the nightjars are about (0..1): from the last of the dusk well into the night, and again before dawn. */
export function nightjarActivity(hours: number): number {
  const h = wrapHours(hours);
  if (h >= 19.2 && h < 22.5) return 1;
  if (h >= 22.5 || h < 3.5) return 0.35;
  if (h >= 3.5 && h < 5.6) return 0.8;
  return 0;
}

interface Jar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  retarget: number;
  /** Wingbeat, and a glide now and then (the beat stops, wings held up). */
  flap: number;
  glide: number;
  sprite: Sprite;
  leaving: boolean;
}

/** The air over the dunes the nightjars hunt (world px). */
export interface JarArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Nightjars over the dunes as it gets dark: long-winged shapes floating and
 * twisting after moths, a few deep loose beats then a glide on raised
 * wings, white wing spots flashing; and from somewhere in the scrub, the
 * long, dry churr, rising and falling, carrying across the beach.
 */
export class Nightjars {
  private readonly jars: Jar[] = [];
  private readonly sprites = new DrawnCache();
  private spawnTimer = 3;
  private churrTimer = r(20, 60);

  constructor(
    private readonly container: Container,
    private readonly area: JarArea,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  get count(): number {
    return this.jars.filter((j) => !j.leaving).length;
  }

  summon(n = 2): void {
    for (let i = 0; i < n; i++) this.spawn();
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.15;
    const level = raining ? 0 : nightjarActivity(env.lighting.hours);
    const want = Math.round(level * 2);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(10, 30);
      if (this.count < want) this.spawn();
      else if (this.count > want) {
        const j = this.jars.find((b) => !b.leaving);
        if (j) j.leaving = true;
      }
    }
    // The churr from the dunes.
    this.churrTimer -= dt;
    if (this.churrTimer <= 0) {
      this.churrTimer = r(25, 80);
      if (level > 0.3) this.sound('nightjar-churr', this.viewport.worldXToStereo(r(this.area.x0, this.area.x1)), 0.45);
    }
    const tint = lerpColor(env.lighting.ambient, 0xffffff, 0.1);
    for (let i = this.jars.length - 1; i >= 0; i--) {
      const j = this.jars[i];
      j.retarget -= dt;
      if (j.retarget <= 0) {
        // A sudden turn after a moth.
        j.retarget = r(0.5, 2);
        j.tx = j.leaving ? (j.x < (this.area.x0 + this.area.x1) / 2 ? this.area.x0 - 60 : this.area.x1 + 60) : r(this.area.x0, this.area.x1);
        j.ty = r(this.area.y0, this.area.y1);
      }
      const dx = j.tx - j.x;
      const dy = j.ty - j.y;
      const d = Math.hypot(dx, dy) || 1;
      j.vx += ((dx / d) * 55 - j.vx) * Math.min(1, dt * 1.8);
      j.vy += ((dy / d) * 30 - j.vy) * Math.min(1, dt * 1.8);
      j.x += j.vx * dt;
      j.y += j.vy * dt;
      if (j.glide > 0) j.glide -= dt;
      else {
        j.flap += dt * 9;
        if (Math.random() < dt * 0.6) j.glide = r(0.4, 1.2);
      }
      const frame = j.glide > 0 ? 0 : Math.floor(j.flap) % NIGHTJAR_FRAMES;
      const size = Math.round(12 + ((j.y - this.area.y0) / (this.area.y1 - this.area.y0)) * 4);
      j.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawNightjar(frame, size));
      j.sprite.position.set(Math.round(j.x), Math.round(j.y));
      j.sprite.tint = tint;
      if (j.leaving && (j.x < this.area.x0 - 40 || j.x > this.area.x1 + 40)) {
        j.sprite.destroy();
        this.jars.splice(i, 1);
      }
    }
  }

  private spawn(): void {
    const sprite = new Sprite({ anchor: 0.5 });
    this.container.addChild(sprite);
    const x = r(this.area.x0, this.area.x1);
    const y = r(this.area.y0, this.area.y1);
    this.jars.push({ x, y, vx: 0, vy: 0, tx: x, ty: y, retarget: 0, flap: Math.random() * 4, glide: 0, sprite, leaving: false });
  }
}
