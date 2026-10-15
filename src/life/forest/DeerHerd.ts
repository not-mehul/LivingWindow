import { Container, Sprite } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { deerActivity } from '../../sim/wildlife';
import { DEER_WALK, DeerSpriteCache, type DeerKind, type DeerPose } from '../../sprites/forestSprites';
import type { LifeSoundSink } from '../types';

type DeerState = 'walk' | 'graze' | 'alert' | 'bound';

interface Deer {
  kind: DeerKind;
  lane: Lane;
  x: number;
  dir: 1 | -1;
  state: DeerState;
  timer: number;
  duration: number;
  stride: number;
  sprite: Sprite;
  /** A fawn trailing its mother keeps pace with her. */
  follows: Deer | null;
}

export interface Lane {
  container: Container;
  /** World y of the hooves. */
  y: number;
  /** Sprite height for an adult doe. */
  height: number;
  speed: number;
  /** Mixed into the tint: distant deer fade into the haze. */
  haze: number;
}

const r = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Deer that wander through the trees in two lanes (behind the middle trunks
 * and between the middle and near trunks), browsing and looking up, and
 * bounding off at a fright.
 */
export class DeerHerd {
  private readonly deer: Deer[] = [];
  private readonly sprites = new DeerSpriteCache();
  private spawnTimer = 5;

  constructor(
    private readonly lanes: Lane[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  get count(): number {
    return this.deer.length;
  }

  /** Startle every deer into bounding away. */
  startle(): void {
    for (const d of this.deer) this.bolt(d);
  }

  /** A tap near a deer startles it (and its fawn). */
  tap(worldX: number, worldY: number): boolean {
    for (const d of this.deer) {
      const h = this.heightOf(d);
      if (Math.abs(worldX - d.x) < h * 0.7 && worldY > d.lane.y - h && worldY < d.lane.y) {
        this.bolt(d);
        for (const f of this.deer) if (f.follows === d) this.bolt(f);
        this.sound('deer-snort', this.viewport.worldXToStereo(d.x), 0.6);
        return true;
      }
    }
    return false;
  }

  /** Bring a deer (or a doe and fawn) out now. */
  summon(): void {
    this.spawnTimer = 0;
  }

  update(dt: number, env: Environment): void {
    const activity = deerActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.5 : 1) * (1 - env.weather.lightning);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(20, 60) / Math.max(0.05, activity);
      if (this.deer.length < 4 && activity > 0.05) this.spawn();
    }
    const tint = env.lighting.ambient;
    for (let i = this.deer.length - 1; i >= 0; i--) {
      const d = this.deer[i];
      if (this.step(d, dt)) {
        d.sprite.destroy();
        this.deer.splice(i, 1);
        continue;
      }
      this.draw(d, lerpColor(tint, env.lighting.haze, d.lane.haze));
    }
  }

  private spawn(): void {
    const lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const kind: DeerKind = Math.random() < 0.3 ? 'buck' : 'doe';
    const x = dir > 0 ? -40 : WORLD_WIDTH + 40;
    const mother = this.create(kind, lane, x, dir, null);
    if (kind === 'doe' && Math.random() < 0.45) this.create('fawn', lane, x - dir * 26, dir, mother);
  }

  private create(kind: DeerKind, lane: Lane, x: number, dir: 1 | -1, follows: Deer | null): Deer {
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    lane.container.addChild(sprite);
    const deer: Deer = { kind, lane, x, dir, state: 'walk', timer: 0, duration: r(4, 12), stride: Math.random() * 4, sprite, follows };
    this.deer.push(deer);
    return deer;
  }

  /** Returns true once the deer has left. */
  private step(d: Deer, dt: number): boolean {
    d.timer += dt;
    // Fawns copy their mother's mood and keep close.
    if (d.follows) {
      const m = d.follows;
      if (!this.deer.includes(m)) d.follows = null;
      else {
        if (m.state === 'bound' && d.state !== 'bound') this.bolt(d);
        else if (d.state !== 'bound') {
          const gap = (m.x - d.x) * m.dir;
          d.state = gap > 30 ? 'walk' : m.state === 'walk' ? 'walk' : Math.random() < 0.5 ? 'graze' : d.state;
          d.dir = m.dir;
        }
      }
    }
    switch (d.state) {
      case 'walk':
      case 'bound': {
        const speed = d.lane.speed * (d.state === 'bound' ? 4 : d.kind === 'fawn' ? 1.1 : 1);
        d.x += d.dir * speed * dt;
        d.stride += speed * dt;
        if (d.x < -60 || d.x > WORLD_WIDTH + 60) return true;
        break;
      }
    }
    if (!d.follows && d.state !== 'bound' && d.timer >= d.duration) this.decide(d);
    return false;
  }

  private decide(d: Deer): void {
    d.timer = 0;
    const roll = Math.random();
    if (d.state === 'walk') {
      d.state = roll < 0.7 ? 'graze' : 'alert';
    } else if (d.state === 'graze') {
      d.state = roll < 0.25 ? 'alert' : roll < 0.6 ? 'graze' : 'walk';
    } else {
      d.state = roll < 0.6 ? 'graze' : 'walk';
      if (Math.random() < 0.15) d.dir = d.dir === 1 ? -1 : 1;
    }
    d.duration = d.state === 'walk' ? r(4, 10) : d.state === 'graze' ? r(5, 14) : r(1.5, 4);
  }

  private bolt(d: Deer): void {
    if (d.state === 'bound') return;
    d.state = 'bound';
    // Run for the nearest way out.
    d.dir = d.x < WORLD_WIDTH / 2 ? -1 : 1;
  }

  private heightOf(d: Deer): number {
    const h = d.lane.height;
    return d.kind === 'buck' ? Math.round(h * 1.22) : d.kind === 'fawn' ? Math.round(h * 0.68) : h;
  }

  private pose(d: Deer): DeerPose {
    switch (d.state) {
      case 'walk':
        return DEER_WALK[Math.floor(d.stride / 5) % 4];
      case 'bound':
        return Math.floor(d.stride / 14) % 2 === 0 ? 'bound-1' : 'bound-2';
      case 'graze':
        return Math.floor(d.timer / 0.6) % 2 === 0 ? 'graze-1' : 'graze-2';
      case 'alert':
        return 'alert';
    }
  }

  private draw(d: Deer, tint: number): void {
    const bounce = d.state === 'bound' ? Math.round(Math.abs(Math.sin(d.stride / 9)) * d.lane.height * 0.25) : 0;
    d.sprite.texture = this.sprites.get(d.kind, this.pose(d), this.heightOf(d));
    d.sprite.scale.x = d.dir;
    d.sprite.position.set(Math.round(d.x), d.lane.y - bounce);
    d.sprite.tint = tint;
  }
}
