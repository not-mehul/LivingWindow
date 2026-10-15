import { Container, Sprite } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { COOP_X } from '../../scene/meadow/MeadowScene';
import { chickensOut, cowsResting } from '../../sim/wildlife';
import { ChickenSpriteCache, COW_WALK, CowSpriteCache, type ChickenCoat, type ChickenPose, type CowCoat, type CowPose } from '../../sprites/meadowSprites';
import type { LifeSoundSink } from '../types';

const r = (min: number, max: number) => min + Math.random() * (max - min);

type CowState = 'graze' | 'walk' | 'stand' | 'lie' | 'leave';

interface Cow {
  coat: CowCoat;
  x: number;
  target: number;
  dir: 1 | -1;
  state: CowState;
  timer: number;
  duration: number;
  stride: number;
  sprite: Sprite;
  lane: CowLane;
}

export interface CowLane {
  container: Container;
  y: number;
  height: number;
  haze: number;
  x0: number;
  x1: number;
}

/**
 * The herd: cows graze for long spells, amble a few steps, lift their heads
 * and moo. After dark most lie down to rest and one or two wander off; by
 * morning the herd is back.
 */
export class CowHerd {
  private readonly cows: Cow[] = [];
  private readonly sprites = new CowSpriteCache();
  private returnTimer = 0;

  constructor(
    private readonly lanes: CowLane[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    for (const lane of lanes) for (let i = 0; i < (lane.height > 16 ? 3 : 2); i++) this.add(lane, lane.x0 + Math.random() * (lane.x1 - lane.x0));
  }

  get count(): number {
    return this.cows.length;
  }

  update(dt: number, env: Environment): void {
    const resting = cowsResting(env.lighting.hours);
    // Wanderers come back by day.
    if (!resting && this.cows.length < 5) {
      this.returnTimer -= dt;
      if (this.returnTimer <= 0) {
        this.returnTimer = r(20, 60);
        const lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
        const fromLeft = Math.random() < 0.5;
        const cow = this.add(lane, fromLeft ? -30 : WORLD_WIDTH + 30);
        cow.state = 'walk';
        cow.target = lane.x0 + Math.random() * (lane.x1 - lane.x0);
      }
    }
    for (let i = this.cows.length - 1; i >= 0; i--) {
      const cow = this.cows[i];
      cow.timer += dt;
      if (resting && cow.state !== 'lie' && cow.state !== 'leave' && cow.timer > cow.duration) {
        // Settle down for the night, or (sometimes) head for the barn.
        if (Math.random() < 0.2 && this.cows.length > 2) {
          cow.state = 'leave';
          cow.target = cow.x < WORLD_WIDTH / 2 ? -40 : WORLD_WIDTH + 40;
        } else {
          this.begin(cow, 'lie', r(60, 200));
        }
      }
      if (cow.state === 'walk' || cow.state === 'leave') {
        const dx = cow.target - cow.x;
        cow.dir = dx >= 0 ? 1 : -1;
        const step = Math.sign(dx) * Math.min(Math.abs(dx), cow.lane.height * 0.12 * dt);
        cow.x += step;
        cow.stride += Math.abs(step);
        if (Math.abs(dx) < 0.5) {
          if (cow.state === 'leave') {
            cow.sprite.destroy();
            this.cows.splice(i, 1);
            continue;
          }
          this.begin(cow, 'graze', r(10, 30));
        }
      } else if (cow.timer > cow.duration && !(resting && cow.state === 'lie')) {
        this.decide(cow, resting);
      }
      this.draw(cow, env);
    }
  }

  private add(lane: CowLane, x: number): Cow {
    const coats: CowCoat[] = ['holstein', 'holstein', 'jersey', 'brown'];
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    lane.container.addChild(sprite);
    const cow: Cow = {
      coat: coats[Math.floor(Math.random() * coats.length)],
      x,
      target: x,
      dir: Math.random() < 0.5 ? 1 : -1,
      state: 'graze',
      timer: 0,
      duration: r(5, 25),
      stride: 0,
      sprite,
      lane,
    };
    this.cows.push(cow);
    return cow;
  }

  private begin(cow: Cow, state: CowState, duration: number): void {
    cow.state = state;
    cow.timer = 0;
    cow.duration = duration;
  }

  private decide(cow: Cow, resting: boolean): void {
    if (resting) {
      this.begin(cow, 'lie', r(60, 200));
      return;
    }
    const roll = Math.random();
    if (roll < 0.25) {
      cow.state = 'walk';
      cow.timer = 0;
      cow.target = Math.max(cow.lane.x0, Math.min(cow.lane.x1, cow.x + r(-50, 50)));
    } else if (roll < 0.4) {
      this.begin(cow, 'stand', r(3, 8));
      if (Math.random() < 0.4) this.sound('cow-moo', this.viewport.worldXToStereo(cow.x), cow.lane.height > 16 ? 0.65 : 0.85);
    } else {
      this.begin(cow, 'graze', r(10, 35));
    }
  }

  private draw(cow: Cow, env: Environment): void {
    let pose: CowPose;
    switch (cow.state) {
      case 'walk':
      case 'leave':
        pose = COW_WALK[Math.floor(cow.stride / (cow.lane.height * 0.18)) % 4];
        break;
      case 'graze':
        pose = Math.floor(cow.timer / 0.8) % 2 === 0 ? 'graze-1' : 'graze-2';
        break;
      case 'lie':
        pose = 'lie';
        break;
      default:
        pose = 'stand';
    }
    cow.sprite.texture = this.sprites.get(cow.coat, pose, cow.lane.height);
    cow.sprite.scale.x = cow.dir;
    cow.sprite.position.set(Math.round(cow.x), cow.lane.y);
    cow.sprite.tint = lerpColor(env.lighting.ambient, env.lighting.haze, cow.lane.haze);
  }
}

// --- Chickens -------------------------------------------------------------

interface Chicken {
  coat: ChickenCoat;
  x: number;
  y: number;
  target: number;
  dir: 1 | -1;
  pose: ChickenPose;
  timer: number;
  sprite: Sprite;
}

/** Hens pecking about the yard by day, filing into the hen house at dusk. */
export class Chickens {
  private readonly hens: Chicken[] = [];
  private readonly sprites = new ChickenSpriteCache();

  constructor(
    container: Container,
    y: number,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    const coats: ChickenCoat[] = ['white', 'brown', 'brown', 'black'];
    for (let i = 0; i < 4; i++) {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      container.addChild(sprite);
      this.hens.push({ coat: coats[i], x: COOP_X + r(-40, 60), y: y + Math.floor(r(-1, 3)), target: 0, dir: 1, pose: 'stand', timer: 0, sprite });
    }
  }

  update(dt: number, env: Environment): void {
    const out = chickensOut(env.lighting.hours) && !(env.weather.kind === 'rain' && env.weather.precipitation > 0.3);
    const door = COOP_X + 14;
    for (const hen of this.hens) {
      hen.timer -= dt;
      if (!out) {
        // Head for the coop door, then disappear inside.
        const dx = door - hen.x;
        hen.dir = dx >= 0 ? 1 : -1;
        hen.x += Math.sign(dx) * Math.min(Math.abs(dx), 10 * dt);
        hen.pose = Math.floor(hen.x) % 2 === 0 ? 'walk' : 'stand';
        hen.sprite.visible = Math.abs(dx) > 1;
      } else {
        hen.sprite.visible = true;
        if (hen.timer <= 0) {
          const roll = Math.random();
          if (roll < 0.45) {
            hen.pose = 'peck';
            hen.timer = r(0.3, 1.2);
          } else if (roll < 0.8) {
            hen.pose = 'walk';
            hen.target = Math.max(COOP_X - 50, Math.min(COOP_X + 70, hen.x + r(-15, 15)));
            hen.timer = r(0.6, 2);
          } else if (roll < 0.9) {
            hen.pose = 'flap';
            hen.timer = 0.4;
            this.sound('chicken-cluck', this.viewport.worldXToStereo(hen.x), 0.66);
          } else {
            hen.pose = 'stand';
            hen.timer = r(0.5, 2);
          }
        }
        if (hen.pose === 'walk') {
          const dx = hen.target - hen.x;
          hen.dir = dx >= 0 ? 1 : -1;
          hen.x += Math.sign(dx) * Math.min(Math.abs(dx), 8 * dt);
        }
      }
      const frame: ChickenPose = hen.pose === 'walk' && Math.floor(performance.now() / 160) % 2 === 0 ? 'stand' : hen.pose;
      hen.sprite.texture = this.sprites.get(hen.coat, frame);
      hen.sprite.scale.x = hen.dir;
      hen.sprite.position.set(Math.round(hen.x), hen.y);
      hen.sprite.tint = env.lighting.ambient;
    }
  }
}
