import { Graphics } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { createRng } from '../../core/random';
import type { SceneLife, LandscapeDeps, SillBase } from '../../landscapes/types';
import type { Environment } from '../../scene/Environment';
import type { ForestScene } from '../../scene/forest/ForestScene';
import { forestPlane } from '../../scene/forest/forestGenerator';
import { owlActivity } from '../../sim/wildlife';
import { BirdSystem, defaultActivity, type BirdEcology } from '../BirdSystem';
import { SillSquirrel } from '../SillSquirrel';
import { Bats } from '../common/Bats';
import { Butterflies } from '../common/Butterflies';
import { Fireflies } from '../common/Fireflies';
import { Fox } from '../common/Fox';
import { Bear, findSlopeSpots, SlopeElk } from './BigWildlife';
import { Hare, Mushrooms, NightEyes, TrunkWoodpeckers, undergrowthSpots } from './ForestCritters';
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

/**
 * The forest's inhabitants: woodland birds, deer, squirrels on the trunks and
 * at the bowl; a fox and a hare on the clearing; woodpeckers drumming,
 * butterflies in the glade and mushrooms after rain; bats, fireflies and
 * eyes in the dark; and now and then a bear, or elk on the far slopes.
 */
export class ForestLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly deer: DeerHerd;
  readonly squirrels: TrunkSquirrels;
  readonly sillSquirrel: SillSquirrel;
  readonly fox: Fox;
  readonly hare: Hare;
  readonly bats: Bats;
  readonly butterflies: Butterflies;
  readonly fireflies: Fireflies;
  readonly eyes: NightEyes;
  readonly woodpeckers: TrunkWoodpeckers;
  readonly mushrooms: Mushrooms;
  readonly bear: Bear;
  readonly elk: SlopeElk;
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
    this.deer = new DeerHerd(scene.midground, scene.plane, scene.floorArea, scene.layout.obstacles, deps.viewport, deps.sound);
    this.squirrels = new TrunkSquirrels(scene.layout.trunks, { mid: scene.midground, near: scene.birdsNear }, deps.viewport, deps.sound);
    this.sillSquirrel = new SillSquirrel(deps.birdseed, deps.sound, deps.canTap);
    deps.layers.sillBack.addChild(this.sillSquirrel.container);

    const { plane, floorArea, layout } = scene;
    const obstacles = layout.obstacles;
    this.fox = new Fox({ container: scene.midground, plane, area: floorArea, obstacles, viewport: deps.viewport, sound: deps.sound });
    this.hare = new Hare(scene.midground, plane, floorArea, obstacles);
    this.bear = new Bear(scene.midground, plane, floorArea, obstacles, deps.viewport, deps.sound);
    this.bats = new Bats(scene.birdsMid, { x0: 0, x1: WORLD_WIDTH, y0: 110, y1: 250, size: [7, 11] });
    // Butterflies in the sunny glade and the clearing's open patches.
    this.butterflies = new Butterflies(
      scene.birdsMid,
      [
        { x: 440, y: 292, rx: 85, ry: 22 },
        { x: 250, y: 296, rx: 55, ry: 18 },
        { x: 640, y: 300, rx: 50, ry: 16 },
      ],
      (y) => 4 + Math.max(0, (y - 260) / 80) * 4,
    );
    const nightGraphics = new Graphics();
    scene.nightLife.addChild(nightGraphics);
    this.fireflies = new Fireflies(nightGraphics, { x0: 320, x1: 580, y0: 268, y1: 334 }, 22);
    this.eyes = new NightEyes(undergrowthSpots(layout.floorPlants));
    scene.nightLife.addChild(this.eyes.graphics);
    this.woodpeckers = new TrunkWoodpeckers(layout.trunks, { mid: scene.midground, near: scene.birdsNear }, deps.viewport, deps.sound);
    // Mushrooms at the foot of the shrubs and among the leaf litter near the front.
    const rng = createRng(404);
    const spots = layout.floorPlants.slice(0, 10).map((p) => ({ x: p.x + p.art.width * (0.2 + rng() * 0.6), y: p.baseY + 1 }));
    for (let i = 0; i < 8; i++) spots.push({ x: 80 + rng() * 680, y: 318 + rng() * 16 });
    this.mushrooms = new Mushrooms(scene.midground, spots, (y) => 9 * forestPlane.scaleAtY(y));
    this.elk = new SlopeElk(findSlopeSpots(layout.mountains, layout.valley));
    scene.slopeLife.addChild(this.elk.container);
  }

  get ambienceLevel(): number {
    return 0.5;
  }

  tap(screenX: number, screenY: number): boolean {
    if (this.birds.tap(screenX, screenY)) return true;
    if (!this.deps.canTap()) return false;
    const world = this.deps.viewport.screenToWorld(screenX, screenY);
    if (this.fox.tap(world.x, world.y)) {
      const at = this.fox.position;
      if (at) this.hare.alarm(at.gx, at.depth);
      return true;
    }
    return this.hare.tap(world.x, world.y) || this.deer.tap(world.x, world.y);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
    if (probability > 0.5) {
      this.deer.startle();
      this.fox.startle();
    }
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
    this.fox.update(dt, env);
    this.hare.update(dt, env);
    // The hare keeps an eye on the fox.
    const fox = this.fox.position;
    if (fox) this.hare.alarm(fox.gx, fox.depth);
    this.bear.update(dt, env);
    this.elk.update(dt, env);
    this.bats.update(dt, env);
    this.butterflies.update(dt, env);
    this.fireflies.update(dt, env);
    this.eyes.update(dt, env);
    this.woodpeckers.update(dt, env);
    this.mushrooms.update(env);
  }
}
