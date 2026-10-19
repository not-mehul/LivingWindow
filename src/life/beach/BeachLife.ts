import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { poolShapes } from '../../scene/beach/rocks';
import type { Environment } from '../../scene/Environment';
import { BirdSystem, type BirdEcology } from '../BirdSystem';
import { Bioluminescence, Crabs, Hatchlings, HermitCrabs, Jellyfish, Pelican } from './ShoreCreatures';
import { Dolphins, FishAndGulls, Sandpipers, Turtles } from './Shoreline';
import { TidePools } from './TidePools';
import { BeachAir } from './BeachAir';
import { Froth } from './Froth';
import { Nightjars } from './NightShore';
import { Bats } from '../common/Bats';
import { Egret, Frigatebird, Gulls, JumpingFish } from './ShoreBirds';
import { Tracks } from './Tracks';
import { Wrack } from './Wrack';

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
  readonly wrack: Wrack;
  readonly tracks: Tracks;
  readonly froth: Froth;
  readonly egret: Egret;
  readonly gulls: Gulls;
  readonly frigatebird: Frigatebird;
  readonly leapingFish: JumpingFish;
  readonly nightjars: Nightjars;
  readonly bats: Bats;
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
    this.dolphins = new Dolphins(scene, deps.viewport, deps.sound);
    this.crabs = new Crabs(scene);
    this.hermits = new HermitCrabs(scene);
    this.pelican = new Pelican(scene, this.sea, deps.viewport, deps.sound);
    this.jellyfish = new Jellyfish(scene);
    this.hatchlings = new Hatchlings(scene);
    this.glow = new Bioluminescence(scene);
    this.pools = new TidePools(scene, poolShapes());
    // On the sand, bottom to top: the strandline, the tracks, the froth (the blowing sand over them all).
    this.wrack = new Wrack(scene);
    this.tracks = new Tracks(scene);
    this.froth = new Froth(scene);
    this.egret = new Egret(scene, deps.viewport);
    this.gulls = new Gulls(scene, deps.viewport, deps.sound);
    this.frigatebird = new Frigatebird(scene, deps.viewport);
    this.leapingFish = new JumpingFish(scene, deps.viewport);
    // Over the dunes after dark: nightjars after moths, and a few bats.
    this.nightjars = new Nightjars(scene.birdsMid, { x0: 20, x1: 520, y0: 150, y1: 250 }, deps.viewport, deps.sound);
    this.bats = new Bats(scene.birdsMid, { x0: 0, x1: 560, y0: 140, y1: 240, size: [6, 9] }, 3);
    for (const walker of [this.sandpipers, this.turtles, this.crabs, this.hermits, this.hatchlings, this.egret, this.gulls]) walker.tracks = this.tracks;
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
    this.egret.update(dt, env);
    this.gulls.update(dt, env);
    this.frigatebird.update(dt, env);
    this.leapingFish.update(dt, env);
    this.nightjars.update(dt, env);
    this.bats.update(dt, env);
    this.wrack.update(dt, env);
    this.tracks.update(dt, env);
    this.froth.update(dt, env);
    this.air.update(dt, env);
  }
}
