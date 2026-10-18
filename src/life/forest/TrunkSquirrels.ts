import { Container, Sprite } from 'pixi.js';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { Trunk } from '../../scene/forest/forestGenerator';
import { squirrelActivity } from '../../sim/wildlife';
import { SquirrelSpriteCache, type SquirrelCoat, type SquirrelPose } from '../../sprites/forestSprites';
import type { LifeSoundSink } from '../types';

type State = 'run' | 'climb' | 'cling' | 'leave';

interface Squirrel {
  coat: SquirrelCoat;
  trunk: Trunk;
  x: number;
  y: number;
  /** Where it's climbing to (or running to, on the ground). */
  target: number;
  state: State;
  timer: number;
  dir: 1 | -1;
  sprite: Sprite;
  size: number;
  floor: number;
}

export interface TrunkLayers {
  /** Depth-sorted container for squirrels on the clearing's trees. */
  mid: Container;
  near: Container;
}

const r = (min: number, max: number) => min + Math.random() * (max - min);

/** Squirrels scampering between trunks and spiralling up and down them. */
export class TrunkSquirrels {
  private readonly squirrels: Squirrel[] = [];
  private readonly sprites = new SquirrelSpriteCache();
  private spawnTimer = 8;

  constructor(
    private readonly trunks: Trunk[],
    private readonly layers: TrunkLayers,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  update(dt: number, env: Environment): void {
    const activity = squirrelActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.3 : 1);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(15, 40) / Math.max(0.05, activity);
      if (activity > 0.05 && this.squirrels.length < 3) this.spawn();
    }
    for (let i = this.squirrels.length - 1; i >= 0; i--) {
      const sq = this.squirrels[i];
      if (this.step(sq, dt)) {
        sq.sprite.destroy();
        this.squirrels.splice(i, 1);
        continue;
      }
      this.draw(sq, env.lighting.ambient);
    }
  }

  private spawn(): void {
    const trunk = this.trunks[Math.floor(Math.random() * this.trunks.length)];
    const near = trunk.layer === 'near';
    // Each tree stands on its own patch of ground.
    const floor = trunk.bottom;
    const size = trunk.squirrelSize ?? (near ? 13 : 8);
    const fromLeft = Math.random() < 0.5;
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    // Sorted with the tree it's on, just in front of it.
    sprite.zIndex = trunk.bottom + 0.5;
    (near ? this.layers.near : this.layers.mid).addChild(sprite);
    this.squirrels.push({
      coat: Math.random() < 0.6 ? 'red' : 'grey',
      trunk,
      x: trunk.x + (fromLeft ? -1 : 1) * size * 9,
      y: floor,
      target: trunk.x,
      state: 'run',
      timer: 0,
      dir: fromLeft ? 1 : -1,
      sprite,
      size,
      floor,
    });
  }

  /** Returns true once it has gone. */
  private step(sq: Squirrel, dt: number): boolean {
    sq.timer += dt;
    const speed = sq.size * 3.2;
    switch (sq.state) {
      case 'run':
      case 'leave': {
        const dx = sq.target - sq.x;
        sq.dir = dx >= 0 ? 1 : -1;
        sq.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        if (Math.abs(dx) < 0.5) {
          if (sq.state === 'leave') return true;
          sq.state = 'climb';
          sq.target = sq.trunk.bottom - r(sq.size * 2, Math.max(sq.size * 2, sq.trunk.bottom - sq.trunk.top - sq.size));
        }
        break;
      }
      case 'climb': {
        const dy = sq.target - sq.y;
        sq.y += Math.sign(dy) * Math.min(Math.abs(dy), speed * 0.8 * dt);
        if (Math.abs(dy) < 0.5) {
          sq.state = 'cling';
          sq.timer = 0;
          if (Math.random() < 0.4) this.sound('squirrel-chatter', this.viewport.worldXToStereo(sq.x), sq.trunk.layer === 'near' ? 0.5 : 0.75);
        }
        break;
      }
      case 'cling':
        if (sq.timer > r(2, 6)) {
          sq.timer = 0;
          const atFloor = sq.y >= sq.floor - 1;
          if (atFloor) {
            sq.state = 'leave';
            sq.target = sq.x + (Math.random() < 0.5 ? -1 : 1) * sq.size * 15;
          } else if (Math.random() < 0.35) {
            sq.state = 'climb';
            sq.target = sq.floor;
          } else {
            sq.state = 'climb';
            sq.target = Math.max(sq.trunk.top + sq.size, Math.min(sq.floor, sq.y + r(-5, 3) * sq.size));
          }
        }
        break;
    }
    return false;
  }

  private draw(sq: Squirrel, tint: number): void {
    const onTrunk = sq.state === 'climb' || sq.state === 'cling';
    let pose: SquirrelPose;
    if (onTrunk) pose = sq.state === 'cling' ? 'cling' : Math.floor(sq.y / 3) % 2 === 0 ? 'climb-1' : 'climb-2';
    else pose = Math.floor(sq.x / 3) % 2 === 0 ? 'run-1' : 'run-2';
    sq.sprite.texture = this.sprites.get(sq.coat, pose, sq.size);
    const descending = sq.state === 'climb' && sq.target > sq.y;
    sq.sprite.scale.set(onTrunk ? 1 : sq.dir, descending ? -1 : 1);
    sq.sprite.anchor.set(0.5, descending ? 0 : 1);
    // On a trunk it moves with the tree as it sways.
    sq.sprite.position.set(Math.round(onTrunk ? sq.trunk.x - sq.trunk.width / 2 + 2 + (sq.trunk.sway?.(sq.y) ?? 0) : sq.x), Math.round(sq.y));
    sq.sprite.tint = tint;
  }
}
