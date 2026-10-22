import { Container, Graphics, Sprite } from 'pixi.js';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { MidTree, Trunk } from '../../scene/forest/forestGenerator';
import { FOCAL, type GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { mushroomLevel, nightEyesLevel, rabbitActivity, woodpeckerActivity } from '../../sim/wildlife';
import { RABBIT_HOP, RabbitSprites, type RabbitPose } from '../../sprites/meadowSprites';
import { drawMushroom, drawWoodpeckerCling, DrawnCache, type MushroomKind } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { wrapHours } from '../../state/timeOfDay';
import { clamp01 } from '../../core/math';
import { hazeTint } from '../../scene/lighting';

// --- The hare -------------------------------------------------------------------

/** A hare's height (world px) at depth 1. */
const HARE_HEIGHT = 22;

type HareState = 'graze' | 'freeze' | 'hop' | 'bolt';

/**
 * A brown hare out on the clearing around dawn and dusk: nibbling, loping a
 * few hops at a time, freezing bolt upright at any alarm, and then bolting
 * in long bounds for the trees.
 */
export class Hare {
  private walker: GroundWalker | null = null;
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new RabbitSprites();
  private state: HareState = 'graze';
  private timer = 0;
  private duration = 0;
  private stride = 0;
  private age = 0;
  private spawnTimer = r(30, 90);

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
  ) {
    this.sprite.visible = false;
    container.addChild(this.sprite);
  }

  get present(): boolean {
    return this.walker !== null;
  }

  get currentState(): HareState | null {
    return this.walker ? this.state : null;
  }

  summon(): void {
    this.spawnTimer = 0;
  }

  /** Something alarming at a ground point (the fox, a tap): freeze, then bolt if it's close. */
  alarm(gx: number, depth: number): void {
    const w = this.walker;
    if (!w || this.state === 'bolt') return;
    const d = Math.hypot(gx - w.gx, (depth - w.depth) * FOCAL);
    if (d < 70) this.bolt();
    else if (d < 160 && this.state !== 'freeze') {
      this.state = 'freeze';
      this.timer = 0;
      this.duration = r(1.5, 3);
    }
  }

  tap(worldX: number, worldY: number): boolean {
    const w = this.walker;
    if (!w) return false;
    const p = w.point;
    const h = HARE_HEIGHT * p.scale;
    if (Math.abs(worldX - p.x) < h && worldY > p.y - h * 1.2 && worldY < p.y + 2) {
      if (this.state === 'freeze') this.bolt();
      else {
        this.state = 'freeze';
        this.timer = 0;
        this.duration = 0.8;
      }
      return true;
    }
    return false;
  }

  update(dt: number, env: Environment): void {
    if (!this.walker) {
      const activity = rabbitActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.3 : 1);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = r(80, 220) / Math.max(0.1, activity);
        if (activity > 0.2) this.spawn();
      }
      return;
    }
    const w = this.walker;
    this.timer += dt;
    this.age += dt;
    // Hares lope in bursts: a few bounds, then a pause.
    const loping = this.state === 'hop' || this.state === 'bolt';
    const cycle = this.state === 'bolt' ? 0.3 : 0.45;
    const inAir = loping && this.timer % cycle < cycle * 0.62;
    w.speed = inAir ? (this.state === 'bolt' ? 110 : 34) : 0;
    w.update(dt);
    this.stride += dt;
    if (this.state === 'bolt') {
      if (w.gone) {
        this.walker = null;
        this.sprite.visible = false;
        return;
      }
    } else if (this.timer > this.duration) this.decide();
    const p = w.point;
    const h = HARE_HEIGHT * p.scale;
    // Sitting, it washes its face now and then.
    const grooming = this.state === 'graze' && this.timer % 7 > 5.4;
    const pose: RabbitPose = this.state === 'freeze' ? 'alert' : loping ? RABBIT_HOP[Math.floor(((this.timer % cycle) / cycle) * 3)] : grooming ? 'groom' : 'sit';
    this.sprite.texture = this.sprites.get(pose, h, 'hare');
    this.sprite.scale.x = w.facing;
    const lift = inAir ? Math.round(Math.sin(((this.timer % cycle) / (cycle * 0.62)) * Math.PI) * h * 0.25) : 0;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y) - lift);
    this.sprite.zIndex = p.y;
    this.sprite.tint = hazeTint(env.lighting, 0.08);
  }

  private spawn(): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const depth = r(this.area.minDepth + (this.area.maxDepth - this.area.minDepth) * 0.4, this.area.maxDepth);
    const w = GroundWalker.fromSide(this.plane, this.area, side, depth, 60, 20);
    w.obstacles = this.obstacles;
    w.steering = this.target();
    this.walker = w;
    this.state = 'hop';
    this.timer = 0;
    this.duration = r(4, 8);
    this.age = 0;
    this.sprite.visible = true;
  }

  private target(): { kind: 'seek'; gx: number; depth: number } {
    const depth = r(this.area.minDepth + (this.area.maxDepth - this.area.minDepth) * 0.3, this.area.maxDepth);
    const half = this.plane.halfWidthAt(depth) * 0.8;
    return { kind: 'seek', gx: r(-half, half), depth };
  }

  private decide(): void {
    this.timer = 0;
    if (this.age > r(60, 120)) {
      this.bolt();
      return;
    }
    const roll = Math.random();
    if (this.state === 'hop') {
      this.state = roll < 0.75 ? 'graze' : 'freeze';
      this.duration = this.state === 'graze' ? r(4, 10) : r(1.5, 4);
    } else {
      this.state = roll < 0.6 ? 'hop' : 'graze';
      this.duration = this.state === 'hop' ? r(2, 5) : r(3, 8);
      if (this.state === 'hop') this.walker!.steering = this.target();
    }
  }

  private bolt(): void {
    const w = this.walker!;
    this.state = 'bolt';
    this.timer = 0;
    w.steering = { kind: 'exit', side: w.gx >= 0 ? 1 : -1 };
  }
}

// --- Eyes in the dark --------------------------------------------------------------

interface Eyes {
  x: number;
  y: number;
  color: number;
  life: number;
  t: number;
  blink: number;
}

/** After dark, pairs of eyes catch the light in the undergrowth, look about, blink, and are gone. */
export class NightEyes {
  readonly graphics = new Graphics();
  private readonly pairs: Eyes[] = [];
  private spawnTimer = 3;

  constructor(private readonly spots: ReadonlyArray<{ x: number; y: number }>) {
    this.graphics.blendMode = 'add';
  }

  get count(): number {
    return this.pairs.length;
  }

  summon(): void {
    this.spawn();
  }

  update(dt: number, env: Environment): void {
    const level = nightEyesLevel(env.lighting.darkness);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(4, 14);
      if (level > 0 && this.pairs.length < Math.ceil(level * 3)) this.spawn();
    }
    const g = this.graphics;
    g.clear();
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const e = this.pairs[i];
      e.t += dt;
      e.blink -= dt;
      if (e.t > e.life) {
        this.pairs.splice(i, 1);
        continue;
      }
      if (e.blink < 0) {
        if (e.blink < -0.12) e.blink = r(1.5, 5);
        continue;
      }
      // Fading in and out, and glancing to one side now and then.
      const a = Math.min(1, e.t / 0.6, (e.life - e.t) / 0.6) * Math.max(level, 0.6);
      const look = Math.floor(e.t / 2.5) % 3 === 1 ? 1 : 0;
      g.rect(Math.round(e.x) + look, Math.round(e.y), 1, 1).fill({ color: e.color, alpha: a });
      g.rect(Math.round(e.x) + 2 + look, Math.round(e.y), 1, 1).fill({ color: e.color, alpha: a });
    }
  }

  private spawn(): void {
    if (this.spots.length === 0) return;
    const s = this.spots[Math.floor(Math.random() * this.spots.length)];
    this.pairs.push({ x: s.x + r(-3, 3), y: s.y + r(-2, 2), color: Math.random() < 0.6 ? 0xc8f070 : 0xffb848, life: r(5, 16), t: 0, blink: r(1, 4) });
  }
}

/** Spots inside the undergrowth where eyes might shine out. */
export function undergrowthSpots(plants: readonly MidTree[]): Array<{ x: number; y: number }> {
  return plants.filter((p) => p.art.height > 10).map((p) => ({ x: p.x + p.art.width * 0.45, y: p.baseY - p.art.height * 0.4 }));
}

// --- Woodpeckers on the trunks ------------------------------------------------------

interface Woodpecker {
  trunk: Trunk;
  side: 1 | -1;
  y: number;
  size: number;
  drum: number;
  /** Seconds left of a hitch up the bark. */
  hitch: number;
  pause: number;
  stay: number;
  t: number;
  sprite: Sprite;
}

export interface WoodpeckerLayers {
  mid: Container;
  near: Container;
}

/** Woodpeckers clinging to the trunks, hammering out a drum roll now and then, hitching up the bark between bouts. */
export class TrunkWoodpeckers {
  private readonly birds: Woodpecker[] = [];
  private readonly sprites = new DrawnCache();
  private spawnTimer = r(10, 40);
  /** A rival's answering roll, due in this many seconds (or negative). */
  private answerIn = -1;
  private answerPan = 0;

  constructor(
    private readonly trunks: readonly Trunk[],
    private readonly layers: WoodpeckerLayers,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  get count(): number {
    return this.birds.length;
  }

  summon(): void {
    this.spawn();
  }

  /** Something prowling below near world x: woodpeckers on nearby trunks go quiet a while. */
  hush(x: number, radius: number): void {
    for (const b of this.birds) if (Math.abs(b.trunk.x - x) < radius) b.pause = Math.max(b.pause, r(8, 14));
  }

  update(dt: number, env: Environment): void {
    // Another woodpecker, further off in the wood, answering the last drum roll.
    if (this.answerIn >= 0) {
      this.answerIn -= dt;
      if (this.answerIn < 0) {
        const other = this.birds.find((b) => b.drum <= 0 && b.pause > 0.5);
        if (other && Math.random() < 0.5) {
          other.drum = r(0.5, 0.9);
          other.pause = r(14, 40);
          this.sound('woodpecker-drum', this.viewport.worldXToStereo(other.trunk.x), other.trunk.layer === 'near' ? 0.7 : 0.4);
        } else this.sound('woodpecker-drum', this.answerPan, 0.2);
      }
    }
    const activity = woodpeckerActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.3 : 1);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(40, 120) / Math.max(0.1, activity);
      if (activity > 0 && this.birds.length < 2) this.spawn();
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.t += dt;
      b.stay -= dt;
      if (b.drum > 0) b.drum -= dt;
      else {
        b.pause -= dt;
        if (b.pause <= 0) {
          // A drum roll now and then (they spend far more time feeding), or a hitch up the bark.
          if (Math.random() < 0.4) {
            b.drum = r(0.5, 0.9);
            const pan = this.viewport.worldXToStereo(b.trunk.x);
            this.sound('woodpecker-drum', pan, b.trunk.layer === 'near' ? 0.75 : 0.45);
            // Now and then it's answered from across the wood.
            if (this.answerIn < 0 && Math.random() < 0.2) {
              this.answerIn = r(1.2, 2.6);
              this.answerPan = Math.max(-1, Math.min(1, -pan * 0.8 + r(-0.2, 0.2)));
            }
            b.pause = r(14, 40);
          } else {
            b.y = Math.max(b.trunk.top + b.size, b.y - b.size * 0.4);
            b.hitch = 0.25;
            b.pause = r(3, 8);
          }
        }
      }
      const fade = Math.min(1, b.t / 0.4, Math.max(0, b.stay) / 0.4);
      if (b.stay <= 0) {
        b.sprite.destroy();
        this.birds.splice(i, 1);
        continue;
      }
      if (b.hitch > 0) b.hitch -= dt;
      // Drumming: drawn back, swinging in, striking; a hitch up the bark lifts the tail.
      const frame = b.drum > 0 ? [0, 1, 2, 1][Math.floor(b.t * 30) % 4] : b.hitch > 0 ? 3 : 0;
      b.sprite.texture = this.sprites.get(`${frame}:${b.size}`, () => drawWoodpeckerCling(frame, b.size));
      // On the trunk's side, facing in to the bark.
      b.sprite.scale.x = b.side;
      b.sprite.position.set(Math.round(b.trunk.x - b.side * (b.trunk.width / 2 + b.size * 0.25) + (b.trunk.sway?.(b.y) ?? 0)), Math.round(b.y));
      b.sprite.alpha = fade;
      b.sprite.tint = env.lighting.ambient;
    }
  }

  private spawn(): void {
    if (this.trunks.length === 0) return;
    const trunk = this.trunks[Math.floor(Math.random() * this.trunks.length)];
    const near = trunk.layer === 'near';
    const size = Math.round(near ? 13 : Math.max(6, (trunk.squirrelSize ?? 8) * 0.9));
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    sprite.zIndex = trunk.bottom + 0.5;
    (near ? this.layers.near : this.layers.mid).addChild(sprite);
    const span = trunk.bottom - trunk.top;
    this.birds.push({
      trunk,
      side: Math.random() < 0.5 ? 1 : -1,
      y: trunk.top + span * r(0.2, 0.6),
      size,
      drum: 0,
      hitch: 0,
      pause: r(0.5, 2),
      stay: r(25, 70),
      t: 0,
      sprite,
    });
  }
}

// --- Mushrooms after rain ------------------------------------------------------------

interface Mushroom {
  x: number;
  y: number;
  kind: MushroomKind;
  size: number;
  /** It comes up once the flush has got this far (0..1). */
  threshold: number;
  sprite: Sprite;
}

/** Mushrooms pushing up through the leaf litter in the day after rain, then going over. */
export class Mushrooms {
  private readonly items: Mushroom[] = [];
  private readonly sprites = new DrawnCache();
  /** Simulated hours since the last good rain. */
  private sinceRain = Infinity;
  private lastHours = -1;

  constructor(container: Container, spots: ReadonlyArray<{ x: number; y: number }>, sizeAtY: (y: number) => number) {
    const kinds: MushroomKind[] = ['fly-agaric', 'bolete', 'cluster', 'cluster', 'bolete'];
    spots.forEach((s, i) => {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      sprite.visible = false;
      sprite.zIndex = s.y + 0.2;
      container.addChild(sprite);
      this.items.push({ x: Math.round(s.x), y: Math.round(s.y), kind: kinds[i % kinds.length], size: Math.max(3, Math.round(sizeAtY(s.y))), threshold: (i * 0.37) % 1, sprite });
    });
  }

  get level(): number {
    return mushroomLevel(this.sinceRain);
  }

  /** As if it had just rained (for demos and tests). */
  summon(): void {
    this.sinceRain = 3;
  }

  update(env: Environment): void {
    const h = env.lighting.hours;
    if (this.lastHours >= 0) {
      const dh = wrapHours(h - this.lastHours);
      if (dh < 6) this.sinceRain += dh;
    }
    this.lastHours = h;
    if (env.weather.kind === 'rain' && env.weather.precipitation > 0.35) this.sinceRain = 0;
    const level = this.level;
    for (const m of this.items) {
      const a = clamp01((level - m.threshold * 0.85) * 5);
      m.sprite.visible = a > 0.02;
      if (!m.sprite.visible) continue;
      m.sprite.texture = this.sprites.get(`${m.kind}:${m.size}`, () => drawMushroom(m.kind, m.size));
      m.sprite.position.set(m.x, m.y);
      m.sprite.alpha = a;
      m.sprite.tint = env.lighting.ambient;
    }
  }
}
