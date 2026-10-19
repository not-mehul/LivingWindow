import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { PixelBuffer } from '../../core/pixelBuffer';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { bearActivity, elkOut } from '../../sim/wildlife';
import { DEER_WALK, drawDeerSized } from '../../sprites/forestSprites';
import { BEAR_WALK, drawBear, DrawnCache, type BearPose } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { evenSize } from '../../sprites/kit';

/** A bear's height (world px) at depth 1. */
const BEAR_HEIGHT = 40;

/**
 * A black bear, now and then: it comes out of the trees along the far edge
 * of the clearing, ambles across with its nose to the ground, stops to
 * sniff, and goes off into the trees on the other side.
 */
export class Bear {
  private walker: GroundWalker | null = null;
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private sniff = 0;
  private stride = 0;
  private timer = r(120, 300);

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    this.sprite.visible = false;
    container.addChild(this.sprite);
  }

  get present(): boolean {
    return this.walker !== null;
  }

  /** Where it is on the ground, while it's about. */
  get position(): { gx: number; depth: number } | null {
    return this.walker ? { gx: this.walker.gx, depth: this.walker.depth } : null;
  }

  /** Where it is in the world (px, feet). */
  get point(): { x: number; y: number } | null {
    return this.walker ? { x: this.walker.point.x, y: this.walker.point.y } : null;
  }

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (!this.walker) {
      const activity = bearActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.5 : 1);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(400, 900) / Math.max(0.1, activity);
        if (activity > 0) this.spawn();
      }
      return;
    }
    const w = this.walker;
    if (this.sniff > 0) {
      this.sniff -= dt;
      w.speed = 0;
    } else {
      w.speed = 11;
      if (Math.random() < dt * 0.05) this.sniff = r(2, 5);
    }
    w.update(dt);
    this.stride += w.speed * w.point.scale * dt;
    if (w.gone) {
      this.walker = null;
      this.sprite.visible = false;
      return;
    }
    const p = w.point;
    const h = evenSize(BEAR_HEIGHT * p.scale, 6);
    // Stopped, it noses the ground, and now and then lifts its head to scent the air.
    const pose: BearPose = this.sniff > 0 ? (this.sniff % 2.4 > 1.6 ? 'sniff-air' : 'sniff') : BEAR_WALK[Math.floor(this.stride / 2) % BEAR_WALK.length];
    this.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawBear(pose, h));
    this.sprite.scale.x = w.facing;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y));
    this.sprite.zIndex = p.y;
    this.sprite.tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.2);
  }

  private spawn(): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    // Along the far side of the clearing, by the brow.
    const depth = this.area.maxDepth - r(0.02, 0.12) * (this.area.maxDepth - this.area.minDepth);
    const w = GroundWalker.fromSide(this.plane, this.area, side, depth, 80, 40);
    w.obstacles = this.obstacles;
    w.steering = { kind: 'exit', side: side > 0 ? -1 : 1 };
    this.walker = w;
    this.sprite.visible = true;
    this.sound('bear-huff', this.viewport.worldXToStereo(w.point.x), 0.35);
  }
}

/** A spot on a far slope where an elk could stand, and how big it looks there. */
interface SlopeSpot {
  x: number;
  y: number;
}

/**
 * Find places on the mountains' open slopes (not hidden by the wooded
 * valley in front) to put grazing elk.
 */
export function findSlopeSpots(mountains: PixelBuffer, valley: PixelBuffer, step = 6): SlopeSpot[] {
  const spots: SlopeSpot[] = [];
  for (let x = 10; x < mountains.width - 10; x += step) {
    let ridge = -1;
    for (let y = 0; y < mountains.height; y++) {
      if (mountains.isSet(x, y)) {
        ridge = y;
        break;
      }
    }
    if (ridge < 0) continue;
    // How far down the slope stays open.
    let bottom = ridge;
    while (bottom + 1 < mountains.height && mountains.isSet(x, bottom + 1) && !valley.isSet(x, bottom + 1)) bottom++;
    if (bottom - ridge >= 18) spots.push({ x, y: Math.round(ridge + (bottom - ridge) * 0.55) });
  }
  return spots;
}

interface Elk {
  x: number;
  y: number;
  dir: 1 | -1;
  graze: boolean;
  timer: number;
  sprite: Sprite;
}

/** A few elk grazing high on the far slopes in the early light, tiny with distance. */
export class SlopeElk {
  readonly container = new Container({ label: 'slope-elk' });
  private readonly herd: Elk[] = [];
  private readonly sprites = new DrawnCache();
  private forced = false;

  constructor(private readonly spots: readonly SlopeSpot[]) {}

  get count(): number {
    return this.herd.length;
  }

  summon(): void {
    this.forced = true;
  }

  update(dt: number, env: Environment): void {
    const out = this.forced || elkOut(env.lighting.hours);
    if (out && this.herd.length === 0 && this.spots.length > 0) {
      // Best seen in the open V of the valley, between the clearing's tall trunks.
      const open = this.spots.filter((s) => s.x > 385 && s.x < 495);
      const from = open.length > 0 ? open : this.spots;
      const base = from[Math.floor(Math.random() * from.length)];
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
        this.container.addChild(sprite);
        this.herd.push({ x: base.x + (i - n / 2) * 5 + r(-2, 2), y: base.y + r(-1, 1), dir: Math.random() < 0.5 ? 1 : -1, graze: Math.random() < 0.6, timer: r(3, 10), sprite });
      }
    } else if (!out && this.herd.length > 0) {
      for (const e of this.herd) e.sprite.destroy();
      this.herd.length = 0;
    }
    // Far away and in the haze of the slope.
    const tint = lerpColor(lerpColor(env.lighting.ambient, env.lighting.haze, 0.75), 0x404858, 0.25);
    for (const e of this.herd) {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.timer = r(3, 10);
        e.graze = !e.graze;
        if (Math.random() < 0.3) e.dir = e.dir > 0 ? -1 : 1;
      }
      if (!e.graze) e.x += e.dir * 0.4 * dt;
      const pose = e.graze ? (e.timer % 3 > 2.4 ? 'graze-3' : 'graze-1') : DEER_WALK[Math.floor(e.x * 2) % DEER_WALK.length];
      e.sprite.texture = this.sprites.get(pose, () => drawDeerSized('elk', pose, 6));
      e.sprite.scale.x = e.dir;
      e.sprite.position.set(Math.round(e.x), Math.round(e.y));
      e.sprite.tint = tint;
    }
  }
}
