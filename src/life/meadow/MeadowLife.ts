import { WORLD_WIDTH } from '../../config';
import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { Environment } from '../../scene/Environment';
import type { MeadowScene } from '../../scene/meadow/MeadowScene';
import { meadowPlane } from '../../sim/meadowGeometry';
import { owlActivity } from '../../sim/wildlife';
import { BirdSystem, defaultActivity, type BirdEcology } from '../BirdSystem';
import { Fireflies } from '../common/Fireflies';
import { TrunkSquirrels } from '../forest/TrunkSquirrels';
import { Chickens, CowHerd } from './Farm';
import { Rabbits, SoaringEagle, StreamFishes } from './Wild';

export const MEADOW_ECOLOGY: BirdEcology = {
  mix: (hours) => {
    if (owlActivity(hours) > 0) return { owl: 1 };
    return { robin: 0.25, bluebird: 0.25, finch: 0.25, sparrow: 0.25 };
  },
  activity: (env) => Math.max(defaultActivity(env), owlActivity(env.lighting.hours) * (1 - env.weather.lightning)),
  shySpecies: ['owl'],
  maxPerSpecies: { owl: 1 },
  flockSpecies: ['finch', 'sparrow'],
  perchPreference: (species, kind) => {
    if (species === 'owl') return kind === 'branch' || kind === 'post' ? 1 : 0;
    if (species === 'robin') return kind === 'ground' ? 2.5 : 0.8;
    return kind === 'post' ? 1.5 : kind === 'ground' ? 0.8 : 1.2;
  },
};

/** Cows, hens, rabbits, fish in the stream, an eagle aloft, songbirds, fireflies, an owl. */
export class MeadowLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly cows: CowHerd;
  readonly chickens: Chickens;
  readonly rabbits: Rabbits;
  readonly fish: StreamFishes;
  readonly eagle: SoaringEagle;
  readonly fireflies: Fireflies;
  readonly squirrels: TrunkSquirrels;
  private readonly deps: LandscapeDeps;
  private time = 0;

  constructor(scene: MeadowScene, deps: LandscapeDeps) {
    this.deps = deps;
    this.birds = new BirdSystem({
      ledges: scene.ledges,
      worldLayers: { far: scene.birdsFar, mid: scene.birdsMid, near: scene.birdsNear },
      nearLayer: deps.layers.near,
      sillLayer: deps.layers.sillFront,
      viewport: deps.viewport,
      birdseed: deps.birdseed,
      sound: deps.sound,
      canTap: deps.canTap,
      ecology: MEADOW_ECOLOGY,
    });
    this.cows = new CowHerd(scene.midground, scene.plane, scene.pasture, scene.layout.obstacles, deps.viewport, deps.sound);
    this.chickens = new Chickens(scene.midground, scene.plane, scene.layout.coop, deps.viewport, deps.sound);
    this.rabbits = new Rabbits(scene.bushes, scene.midground);
    this.fish = new StreamFishes(scene.creekLife);
    this.eagle = new SoaringEagle(scene.birdsFar, deps.viewport, deps.sound);
    this.fireflies = new Fireflies(scene.nightLayer, { x0: 0, x1: WORLD_WIDTH, y0: meadowPlane.horizonY + 20, y1: 334 });
    this.squirrels = new TrunkSquirrels(scene.trunks, { mid: scene.midground, near: scene.midground }, deps.viewport, deps.sound);
  }

  get ambienceLevel(): number {
    return this.cows.count / 5;
  }

  tap(screenX: number, screenY: number): boolean {
    if (this.birds.tap(screenX, screenY)) return true;
    if (!this.deps.canTap()) return false;
    const world = this.deps.viewport.screenToWorld(screenX, screenY);
    return this.fish.scatter(world.x, world.y);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
    if (probability > 0.5) this.rabbits.scare();
  }

  startleNear(sillX: number, radius: number): void {
    this.birds.startleNear(sillX, radius);
  }

  update(dt: number, env: Environment, sill: SillBase): void {
    this.time += dt;
    this.birds.update(dt, env, { ...sill, catX: null, catStalking: false });
    this.cows.update(dt, env);
    this.chickens.update(dt, env);
    this.rabbits.update(dt, env);
    this.fish.update(dt, env, this.time);
    this.eagle.update(dt, env);
    this.fireflies.update(dt, env);
    this.squirrels.update(dt, env);
  }
}
