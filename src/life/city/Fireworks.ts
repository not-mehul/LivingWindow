import { Container, Graphics, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Environment } from '../../scene/Environment';
import { glowTexture } from '../../scene/common/glow';
import { fireworksNight, fireworksTime } from '../../sim/wildlife';
import type { LifeSoundSink } from '../types';

const r = (a: number, b: number) => a + Math.random() * (b - a);

type BurstKind = 'peony' | 'willow' | 'ring' | 'crackle';

interface Rocket {
  x: number;
  y: number;
  vy: number;
  /** Height it bursts at. */
  top: number;
  kind: BurstKind;
  colors: [number, number];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: number;
  /** Willows trail long and droop; crackles flash white as they die. */
  kind: BurstKind;
}

const PALETTES: Array<[number, number]> = [
  [0xff4a5a, 0xffd0a0],
  [0x5ac8ff, 0xffffff],
  [0xffd040, 0xff8a30],
  [0x8aff6a, 0xe0ffe0],
  [0xd06aff, 0xffb0e8],
  [0xff6ad0, 0x6ad8ff],
];

/** Where the show goes up: over the skyline, beyond the street. */
const SKYLINE = { x0: 430, x1: 800, launchY: 150 };

/**
 * Fireworks over the skyline on about one night in five, around nine:
 * rockets climbing from behind the towers and bursting into peonies, rings,
 * golden willows and crackling stars, each with its boom arriving a moment
 * after the flash.
 */
export class Fireworks {
  /** Behind the buildings, over the sky. */
  readonly container = new Container({ label: 'fireworks' });
  private readonly gfx = new Graphics();
  private readonly flashes: Sprite[] = [];
  private readonly rockets: Rocket[] = [];
  private readonly sparks: Spark[] = [];
  private readonly booms: Array<{ delay: number; x: number }> = [];
  private launchTimer = 0;
  private evening = 0;
  private lastHours = -1;
  private tonight = false;
  private forced = 0;

  constructor(
    private readonly sound: LifeSoundSink,
    private readonly pan: (x: number) => number,
    /** Names this real day, so the same nights have shows (a date). */
    private readonly dayKey: () => string = () => new Date().toDateString(),
  ) {
    this.gfx.blendMode = 'add';
    this.container.addChild(this.gfx);
  }

  /** Whether tonight is a fireworks night. */
  get isShowNight(): boolean {
    return this.tonight;
  }

  get activeSparks(): number {
    return this.sparks.length;
  }

  /** Put on a show now, for `seconds` (for demos and tests). */
  summon(seconds = 40): void {
    this.forced = seconds;
  }

  update(dt: number, env: Environment): void {
    const h = env.lighting.hours;
    // A new evening each time the clock passes noon: decide whether it has a show.
    if (this.lastHours < 0 || (this.lastHours < 12 && h >= 12)) {
      if (this.lastHours >= 0) this.evening++;
      this.tonight = fireworksNight(`${this.dayKey()}#${this.evening}`);
    }
    this.lastHours = h;
    if (this.forced > 0) this.forced -= dt;
    const clearEnough = env.weather.precipitation < 0.3 && env.weather.lightning < 0.2;
    const showing = this.forced > 0 || (this.tonight && fireworksTime(h) && clearEnough && env.lighting.darkness > 0.5);
    if (showing) {
      this.launchTimer -= dt;
      if (this.launchTimer <= 0) {
        // Bursts come in ones and twos, with a flurry now and then.
        this.launchTimer = Math.random() < 0.15 ? r(0.15, 0.4) : r(0.8, 2.8);
        this.launch();
      }
    }
    this.step(dt);
    this.draw(env);
  }

  private launch(): void {
    const kinds: BurstKind[] = ['peony', 'peony', 'willow', 'ring', 'crackle'];
    this.rockets.push({
      x: r(SKYLINE.x0, SKYLINE.x1),
      y: SKYLINE.launchY,
      vy: -r(70, 95),
      top: r(35, 95),
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      colors: PALETTES[Math.floor(Math.random() * PALETTES.length)],
    });
  }

  private burst(rk: Rocket): void {
    const n = rk.kind === 'ring' ? 56 : rk.kind === 'willow' ? 64 : 84;
    const speed = rk.kind === 'willow' ? r(28, 34) : r(36, 48);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r(-0.06, 0.06);
      // A ring is a hoop of even speed; a peony fills its sphere.
      const v = rk.kind === 'ring' ? speed : speed * Math.sqrt(Math.random());
      this.sparks.push({
        x: rk.x,
        y: rk.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.92,
        age: 0,
        life: rk.kind === 'willow' ? r(2.6, 3.4) : r(1.4, 2.2),
        color: rk.kind === 'willow' ? 0xffc860 : i % 3 === 0 ? rk.colors[1] : rk.colors[0],
        kind: rk.kind,
      });
    }
    // The flash lights the sky round it for a moment.
    const flash = new Sprite({ texture: glowTexture(26, lerpColor(0x000000, rk.colors[0], 0.55), 1, false), anchor: 0.5, blendMode: 'add' });
    flash.position.set(Math.round(rk.x), Math.round(rk.y));
    flash.alpha = 0.4;
    this.container.addChildAt(flash, 0);
    this.flashes.push(flash);
    // Sound takes a moment to reach us across the city.
    this.booms.push({ delay: r(0.6, 1.1), x: rk.x });
  }

  private step(dt: number): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const rk = this.rockets[i];
      rk.y += rk.vy * dt;
      rk.vy += 30 * dt;
      if (rk.y <= rk.top || rk.vy >= -5) {
        this.burst(rk);
        this.rockets.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      const drag = s.kind === 'willow' ? 1.6 : 1.1;
      s.vx *= Math.exp(-drag * dt);
      s.vy *= Math.exp(-drag * dt);
      s.vy += (s.kind === 'willow' ? 16 : 11) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.alpha -= dt * 1.2;
      if (f.alpha <= 0) {
        f.destroy();
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.delay -= dt;
      if (b.delay <= 0) {
        this.sound('firework-pop', this.pan(b.x), 0.35);
        this.booms.splice(i, 1);
      }
    }
  }

  private draw(env: Environment): void {
    const g = this.gfx;
    g.clear();
    if (this.rockets.length === 0 && this.sparks.length === 0) return;
    // Haze and cloud soften the show.
    const vis = 1 - env.weather.cloudCover * 0.4;
    for (const rk of this.rockets) {
      // The climbing rocket and its short spark trail.
      g.rect(Math.round(rk.x), Math.round(rk.y), 1, 1).fill({ color: 0xffe0b0, alpha: vis });
      for (let k = 1; k < 4; k++) g.rect(Math.round(rk.x), Math.round(rk.y) + k * 2, 1, 1).fill({ color: 0xffa040, alpha: (0.5 / k) * vis });
    }
    for (const s of this.sparks) {
      const t = s.age / s.life;
      // Brightest just after the burst, then burning down.
      let alpha = Math.min(1, (1 - t) ** 1.1 * 1.25) * vis;
      let color = s.color;
      if (s.kind === 'crackle' && t > 0.6) {
        // Crackling: tiny white flashes as the stars burn out.
        if (Math.random() < 0.5) continue;
        color = 0xffffff;
        alpha = vis;
      }
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      g.rect(x, y, 1, 1).fill({ color, alpha });
      // A streak behind each fast-moving star (long ones on a willow).
      const speed = Math.hypot(s.vx, s.vy);
      const tail = s.kind === 'willow' ? 3 : speed > 12 ? 1 : 0;
      for (let k = 1; k <= tail; k++) {
        g.rect(Math.round(s.x - (s.vx / speed) * k * 1.5), Math.round(s.y - (s.vy / speed) * k * 1.5), 1, 1).fill({ color, alpha: alpha * (0.5 / k) });
      }
    }
  }
}
