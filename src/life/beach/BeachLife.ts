import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { poolShapes } from '../../scene/beach/rocks';
import type { Environment } from '../../scene/Environment';
import { BirdSystem, type BirdEcology } from '../BirdSystem';
import { Bioluminescence, Crabs, Hatchlings, HermitCrabs, Jellyfish, Pelican } from './ShoreCreatures';
import { Dolphins, FishAndGulls, Sandpipers, Turtles } from './Shoreline';
import { TidePools } from './TidePools';
import { BeachAir } from './BeachAir';

export const BEACH_ECOLOGY: BirdEcology = {
  mix: () => ({ seagull: 1 }),
  maxPerSpecies: { seagull: 6 },
  flockSpecies: ['seagull'],
  perchPreference: (_species, kind) => (kind === 'post' ? 3 : kind === 'rock' ? 2 : kind === 'log' ? 1.5 : 1.2),
};

/**
 * Gulls, sandpipers, a fish school in the shallows, turtles and dolphins;
 * crabs at the water's edge and hermit crabs on the dry sand; a pelican
 * fishing; jellyfish; life in the tide pools; and on some nights a glowing
 * sea or a hatching nest.
 */
export class BeachLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly sandpipers: Sandpipers;
  readonly sea: FishAndGulls;
  readonly turtles: Turtles;
  readonly dolphins: Dolphins;
  readonly crabs: Crabs;
  readonly hermits: HermitCrabs;
  readonly pelican: Pelican;
  readonly jellyfish: Jellyfish;
  readonly hatchlings: Hatchlings;
  readonly glow: Bioluminescence;
  readonly pools: TidePools;
  readonly air: BeachAir;
  private readonly deps: LandscapeDeps;

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
    this.crabs = new Crabs(scene);
    this.hermits = new HermitCrabs(scene);
    this.pelican = new Pelican(scene, this.sea, deps.viewport, deps.sound);
    this.jellyfish = new Jellyfish(scene);
    this.hatchlings = new Hatchlings(scene);
    this.glow = new Bioluminescence(scene);
    this.pools = new TidePools(scene, poolShapes());
    this.air = new BeachAir(scene, deps.viewport, deps.sound);
    this.deps = deps;
  }

  get ambienceLevel(): number {
    return 0.5;
  }

  tap(screenX: number, screenY: number): boolean {
    if (this.birds.tap(screenX, screenY)) return true;
    if (!this.deps.canTap()) return false;
    const world = this.deps.viewport.screenToWorld(screenX, screenY);
    return this.hermits.tap(world.x, world.y) || this.crabs.scare(world.x, world.y);
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
    this.crabs.update(dt, env);
    this.hermits.update(dt, env);
    this.pelican.update(dt, env);
    this.jellyfish.update(dt, env);
    this.hatchlings.update(dt, env);
    this.glow.update(env);
    this.pools.update(dt, env);
    this.air.update(dt, env);
  }
}
