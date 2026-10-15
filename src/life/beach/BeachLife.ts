import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { BeachScene } from '../../scene/beach/BeachScene';
import type { Environment } from '../../scene/Environment';
import { BirdSystem, type BirdEcology } from '../BirdSystem';
import { Dolphins, FishAndGulls, Sandpipers, Turtles } from './Shoreline';

export const BEACH_ECOLOGY: BirdEcology = {
  mix: () => ({ seagull: 1 }),
  maxPerSpecies: { seagull: 6 },
  flockSpecies: ['seagull'],
  perchPreference: (_species, kind) => (kind === 'post' ? 3 : kind === 'log' ? 1.5 : 1.2),
};

/** Gulls, sandpipers, a fish school in the shallows, turtles and dolphins. */
export class BeachLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly sandpipers: Sandpipers;
  readonly sea: FishAndGulls;
  readonly turtles: Turtles;
  readonly dolphins: Dolphins;

  constructor(scene: BeachScene, deps: LandscapeDeps) {
    this.birds = new BirdSystem({
      ledges: scene.ledges,
      worldLayers: { far: scene.birdsFar, mid: scene.birdsMid, near: scene.birdsNear },
      nearLayer: deps.layers.near,
      sillLayer: deps.layers.sillFront,
      viewport: deps.viewport,
      birdseed: deps.birdseed,
      sound: deps.sound,
      canTap: deps.canTap,
      ecology: BEACH_ECOLOGY,
    });
    this.sandpipers = new Sandpipers(scene, deps.viewport, deps.sound);
    this.sea = new FishAndGulls(scene, deps.viewport, deps.sound);
    this.turtles = new Turtles(scene, deps.viewport);
    this.dolphins = new Dolphins(scene, deps.viewport);
  }

  get ambienceLevel(): number {
    return 0.5;
  }

  tap(screenX: number, screenY: number): boolean {
    return this.birds.tap(screenX, screenY);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
  }

  startleNear(sillX: number, radius: number): void {
    this.birds.startleNear(sillX, radius);
  }

  update(dt: number, env: Environment, sill: SillBase): void {
    this.birds.update(dt, env, { ...sill, catX: null, catStalking: false });
    this.sandpipers.update(dt, env);
    this.sea.update(dt, env);
    this.turtles.update(dt, env);
    this.dolphins.update(dt, env);
  }
}
