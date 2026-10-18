import { WORLD_WIDTH } from '../../config';
import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { Environment } from '../../scene/Environment';
import type { MeadowScene } from '../../scene/meadow/MeadowScene';
import { meadowPlane } from '../../sim/meadowGeometry';
import { chickensOut, owlActivity } from '../../sim/wildlife';
import { BirdSystem, defaultActivity, type BirdEcology } from '../BirdSystem';
import { Bats } from '../common/Bats';
import { Butterflies } from '../common/Butterflies';
import { Fireflies } from '../common/Fireflies';
import { Fox } from '../common/Fox';
import { TrunkSquirrels } from '../forest/TrunkSquirrels';
import { Chickens, CowHerd } from './Farm';
import { Bees, bloomPoints, Dragonflies, Hedgehog, TreeLineDeer, treeLineFoot } from './MeadowVisitors';
import { HorsePaddock, SheepFlock } from './Pastoral';
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

/**
 * Cows, hens, rabbits, fish in the stream, an eagle aloft, songbirds,
 * fireflies, an owl; a flock of sheep and their dog, a horse in its paddock;
 * butterflies, bees and dragonflies by day; bats at dusk, a fox nosing round
 * the shut-up hen house, a hedgehog in the flowers, and roe deer at dawn.
 */
export class MeadowLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly cows: CowHerd;
  readonly chickens: Chickens;
  readonly rabbits: Rabbits;
  readonly fish: StreamFishes;
  readonly eagle: SoaringEagle;
  readonly fireflies: Fireflies;
  readonly squirrels: TrunkSquirrels;
  readonly sheep: SheepFlock;
  readonly horse: HorsePaddock;
  readonly fox: Fox;
  readonly bats: Bats;
  readonly hedgehog: Hedgehog;
  readonly roe: TreeLineDeer;
  readonly butterflies: Butterflies;
  readonly bees: Bees;
  readonly dragonflies: Dragonflies;
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

    const { plane, pasture, layout } = scene;
    this.sheep = new SheepFlock(scene.midground, plane, pasture, layout.obstacles, deps.viewport, deps.sound);
    this.horse = new HorsePaddock(scene.midground, plane, deps.viewport, deps.sound);
    // A fox about at dusk and night, drawn to the hen house once the hens are shut in.
    const coop = layout.coop;
    this.fox = new Fox({
      container: scene.midground,
      plane,
      area: pasture,
      obstacles: layout.obstacles,
      viewport: deps.viewport,
      sound: deps.sound,
      visit: () => ({ gx: coop.gx - 30, depth: coop.depth - 0.1 }),
      activity: (env) => (chickensOut(env.lighting.hours) ? 0.15 : 1),
    });
    this.bats = new Bats(scene.birdsMid, { x0: 0, x1: WORLD_WIDTH, y0: 100, y1: 240, size: [6, 10] });
    this.hedgehog = new Hedgehog(scene.bankLife, 288, WORLD_WIDTH);
    this.roe = new TreeLineDeer(scene.midground, treeLineFoot(layout.treeLine), [380, 700]);
    this.butterflies = new Butterflies(
      scene.frontLife,
      [
        { x: 420, y: 314, rx: 380, ry: 16 },
        { x: 300, y: 262, rx: 110, ry: 20 },
        { x: 620, y: 282, rx: 120, ry: 18 },
      ],
      (y) => Math.max(4, Math.min(12, 4 + ((y - 230) / 100) * 8)),
      ['monarch', 'white', 'blue', 'brimstone'],
      7,
    );
    this.bees = new Bees(bloomPoints(layout.flowers));
    scene.frontLife.addChild(this.bees.graphics);
    this.dragonflies = new Dragonflies();
    scene.birdsMid.addChild(this.dragonflies.graphics);
  }

  get ambienceLevel(): number {
    return this.cows.count / 5;
  }

  tap(screenX: number, screenY: number): boolean {
    if (this.birds.tap(screenX, screenY)) return true;
    if (!this.deps.canTap()) return false;
    const world = this.deps.viewport.screenToWorld(screenX, screenY);
    return this.hedgehog.tap(world.x, world.y) || this.fox.tap(world.x, world.y) || this.fish.scatter(world.x, world.y);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
    if (probability > 0.5) {
      this.rabbits.scare();
      this.fox.startle();
    }
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
    this.sheep.update(dt, env);
    this.horse.update(dt, env);
    this.fox.update(dt, env);
    this.bats.update(dt, env);
    this.hedgehog.update(dt, env);
    this.roe.update(dt, env);
    this.butterflies.update(dt, env);
    this.bees.update(dt, env);
    this.dragonflies.update(dt, env);
  }
}
