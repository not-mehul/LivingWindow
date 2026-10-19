import { WORLD_WIDTH } from '../../config';
import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { Environment } from '../../scene/Environment';
import type { MeadowScene } from '../../scene/meadow/MeadowScene';
import { meadowPlane } from '../../sim/meadowGeometry';
import { chance, Cooldown, FLIGHT_DISTANCE, goldenHour, groundDistance } from '../../sim/interplay';
import { chickensOut, owlActivity } from '../../sim/wildlife';
import { WindowDog } from '../WindowDog';
import { BirdSystem, defaultActivity, type BirdEcology } from '../BirdSystem';
import { Bats } from '../common/Bats';
import { Butterflies } from '../common/Butterflies';
import { Fireflies } from '../common/Fireflies';
import { Fox } from '../common/Fox';
import { TrunkSquirrels } from '../forest/TrunkSquirrels';
import { Breeze } from './Breeze';
import { Chickens, CowHerd } from './Farm';
import { Farmstead } from './Farmstead';
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
 * Across the field, the farm: lights and chimney smoke, a scarecrow and its
 * crows, the farmer about the patch; and the wind rolling through the grass.
 */
export class MeadowLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly dog: WindowDog;
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
  readonly farm: Farmstead;
  readonly breeze: Breeze;
  private readonly deps: LandscapeDeps;
  private time = 0;
  readonly stages = ['fox', 'eagle', 'sheepdog', 'cows-file', 'rabbits-play', 'trout', 'thunder', 'farmer'] as const;
  private readonly chaseCooldown = new Cooldown(60, 180);
  private readonly playCooldown = new Cooldown(120, 300);
  private readonly riseCooldown = new Cooldown(15, 45);
  private filedToday = false;

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
    // The household dog, up at the window now and then.
    this.dog = new WindowDog(deps.sound, deps.canTap, (x) => this.birds.startleNear(x, 50));
    deps.layers.room.addChild(this.dog.container);
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
    this.farm = new Farmstead(scene.midground, layout.farm);
    this.breeze = new Breeze(scene.groundFx, scene.frontLife);
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

  thunder(distance: number): void {
    // A crack overhead: the flock bunches, the horse bolts round its paddock, heads come up.
    if (distance < 0.55) {
      this.sheep.startle();
      this.horse.spook();
      this.chickens.takeCover();
    }
    if (distance < 0.85) this.cows.lookUp();
  }

  stage(name: string): boolean {
    switch (name) {
      case 'fox': {
        // Straight for the hen yard.
        const door = this.chickens.doorSpot;
        this.fox.summon({ gx: door.gx - 40, depth: door.depth - 0.2 });
        return true;
      }
      case 'eagle':
        if (!this.eagle.hunt()) this.eagle.summon(true);
        return true;
      case 'sheepdog':
        this.sheep.dog.summon();
        return true;
      case 'cows-file':
        return this.cows.fileHome();
      case 'rabbits-play':
        return this.rabbits.play();
      case 'trout': {
        const fly = this.dragonflies.hovering();
        if (!fly) return false;
        this.fish.rise(fly.along, fly.across);
        this.dragonflies.startle(fly.index);
        return true;
      }
      case 'thunder':
        this.thunder(0.2);
        return true;
      case 'farmer':
        this.farm.callFarmer();
        return true;
    }
    return false;
  }

  /** Who's noticed whom: the fox among the hens, the eagle over the warren, the dog at the window watching the dog at work. */
  private interplay(dt: number, env: Environment, sill: SillBase): void {
    const hours = env.lighting.hours;
    for (const c of [this.chaseCooldown, this.playCooldown, this.riseCooldown]) c.tick(dt);

    // The fox: hens flap for the door, the hedgehog rolls up, rabbits freeze or run; the sheepdog sees it off.
    const fox = this.fox.position;
    if (fox) {
      const fp = meadowPlane.project(fox.gx, fox.depth);
      this.chickens.scatter(fox.gx, fox.depth, FLIGHT_DISTANCE.hen * 2);
      const hog = this.hedgehog.position;
      if (hog && Math.abs(hog.x - fp.x) < 45 && Math.abs(hog.y - fp.y) < 30) this.hedgehog.curl(8 + Math.random() * 6);
      this.rabbits.alarm(fp.x, fp.y, 80);
      const dog = this.sheep.dog;
      const nearFlock = groundDistance(fox, this.sheep.middle) < 380;
      if (!dog.chasing && nearFlock && hours > 6 && hours < 21 && this.chaseCooldown.use()) dog.chase(() => this.fox.position);
      const dp = dog.position;
      if (dog.chasing && dp && groundDistance(dp, fox) < 70) this.fox.startle();
    }

    // The eagle low overhead: rabbits freeze, then bolt; hens make for the coop.
    const eagle = this.eagle.low;
    if (eagle) {
      this.rabbits.alarm(eagle.x, Number.NaN, 170, true);
      const door = this.chickens.doorSpot;
      if (Math.abs(meadowPlane.project(door.gx, door.depth).x - eagle.x) < 240) this.chickens.takeCover();
    } else if ((this.rabbits.spots.length > 0 || this.chickens.outside > 0) && chance(0.4, dt)) this.eagle.hunt();

    // At dusk, a few cows amble off nose to tail.
    if (hours > 19.1 && hours < 20.3 && !this.filedToday && chance(1.2, dt)) this.filedToday = this.cows.fileHome() || this.filedToday;
    if (hours < 12) this.filedToday = false;

    // Golden hour: the rabbits play.
    const golden = goldenHour(hours);
    if (golden > 0.4 && this.rabbits.spots.length > 0 && chance(golden * 0.8, dt) && this.playCooldown.use()) this.rabbits.play();

    // A trout rises under a dragonfly, more towards evening.
    const fly = this.dragonflies.hovering();
    if (fly && chance(hours > 16 && hours < 20.5 ? 2 : 0.8, dt) && this.riseCooldown.use()) {
      this.fish.rise(fly.along, fly.across);
      this.dragonflies.startle(fly.index);
    }

    // The window dog can't take its eyes off the sheepdog at work.
    const sd = this.sheep.dog.position;
    if (sd && (this.sheep.dog.herding || this.sheep.dog.chasing)) {
      const p = meadowPlane.project(sd.gx, sd.depth);
      const screen = this.deps.viewport.worldToScreen(p.x, p.y);
      this.dog.watch((screen.x - sill.surface.left) / sill.surface.frameScale);
    } else this.dog.watch(null);
  }

  update(dt: number, env: Environment, sill: SillBase): void {
    this.time += dt;
    this.interplay(dt, env, sill);
    const state = { ...sill, catX: null, catStalking: false };
    this.dog.update(dt, env, state, this.birds.sillBirds());
    this.birds.update(dt, env, state);
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
    this.farm.update(dt, env);
    this.breeze.update(dt, env);
  }
}
