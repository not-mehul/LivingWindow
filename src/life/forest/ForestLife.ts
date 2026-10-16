import type { SceneLife, LandscapeDeps, SillBase } from '../../landscapes/types';
import type { Environment } from '../../scene/Environment';
import type { ForestScene } from '../../scene/forest/ForestScene';
import { owlActivity } from '../../sim/wildlife';
import { BirdSystem, defaultActivity, type BirdEcology } from '../BirdSystem';
import { SillSquirrel } from '../SillSquirrel';
import { DeerHerd } from './DeerHerd';
import { TrunkSquirrels } from './TrunkSquirrels';

export const FOREST_ECOLOGY: BirdEcology = {
  mix: (hours) => {
    if (owlActivity(hours) > 0) return { owl: 1 };
    return { chickadee: 0.34, jay: 0.24, woodpecker: 0.2, robin: 0.22 };
  },
  activity: (env) => Math.max(defaultActivity(env), owlActivity(env.lighting.hours) * (1 - env.weather.lightning)),
  shySpecies: ['owl', 'woodpecker'],
  maxPerSpecies: { owl: 1, woodpecker: 2 },
  flockSpecies: [],
  perchPreference: (species, kind) => {
    if (species === 'owl') return kind === 'branch' ? 1 : 0;
    if (species === 'woodpecker') return kind === 'ground' ? 0.1 : 2;
    if (species === 'robin') return kind === 'ground' ? 2.5 : 0.6;
    return kind === 'ground' ? 0.6 : 1.2;
  },
};

/** The forest's inhabitants: woodland birds, deer, squirrels on the trunks and at the bowl. */
export class ForestLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly deer: DeerHerd;
  readonly squirrels: TrunkSquirrels;
  readonly sillSquirrel: SillSquirrel;
  private readonly deps: LandscapeDeps;

  constructor(scene: ForestScene, deps: LandscapeDeps) {
    this.deps = deps;
    this.birds = new BirdSystem({
      ledges: scene.layout.ledges,
      worldLayers: { far: scene.birdsFar, mid: scene.birdsMid, near: scene.birdsNear },
      nearLayer: deps.layers.near,
      sillLayer: deps.layers.sillFront,
      viewport: deps.viewport,
      birdseed: deps.birdseed,
      sound: deps.sound,
      canTap: deps.canTap,
      ecology: FOREST_ECOLOGY,
    });
    this.deer = new DeerHerd(scene.midground, scene.plane, scene.clearing, deps.viewport, deps.sound);
    this.squirrels = new TrunkSquirrels(scene.layout.trunks, { mid: scene.midground, near: scene.birdsNear }, deps.viewport, deps.sound);
    this.sillSquirrel = new SillSquirrel(deps.birdseed, deps.sound, deps.canTap);
    deps.layers.sillBack.addChild(this.sillSquirrel.container);
  }

  get ambienceLevel(): number {
    return 0.5;
  }

  tap(screenX: number, screenY: number): boolean {
    if (this.birds.tap(screenX, screenY)) return true;
    if (!this.deps.canTap()) return false;
    const world = this.deps.viewport.screenToWorld(screenX, screenY);
    return this.deer.tap(world.x, world.y);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
    if (probability > 0.5) this.deer.startle();
  }

  startleNear(sillX: number, radius: number): void {
    this.birds.startleNear(sillX, radius);
  }

  update(dt: number, env: Environment, sill: SillBase): void {
    const squirrelX = this.sillSquirrel.position;
    const state = { ...sill, catX: squirrelX, catStalking: false };
    this.sillSquirrel.update(dt, env, state);
    this.birds.update(dt, env, { ...state, catX: this.sillSquirrel.position });
    this.deer.update(dt, env);
    this.squirrels.update(dt, env);
  }
}
