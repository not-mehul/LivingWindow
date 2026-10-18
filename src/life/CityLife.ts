import type { Container } from 'pixi.js';
import type { Viewport } from '../core/Viewport';
import type { SceneLife, SillBase } from '../landscapes/types';
import type { CityScene } from '../scene/city/CityScene';
import type { Environment } from '../scene/Environment';
import type { BirdseedState } from '../state/BirdseedState';
import { BirdSystem } from './BirdSystem';
import { Fireworks } from './city/Fireworks';
import { Performers } from './city/Performers';
import { Rooftops } from './city/Rooftops';
import { SkyTraffic } from './city/SkyTraffic';
import { Traffic } from './city/Traffic';
import { RooftopCat } from './RooftopCat';
import { StreetLife } from './StreetLife';
import type { LifeSoundSink, SillState } from './types';

export interface CityLifeOptions {
  scene: CityScene;
  viewport: Viewport;
  /** Screen-space layer for birds flying near the window. */
  nearLayer: Container;
  /** Screen-space sill layer; the cat goes in `catSlot` (behind the bowl). */
  sillLayer: Container;
  catSlot: Container;
  birdseed: BirdseedState;
  sound: LifeSoundSink;
  canTap: () => boolean;
}

/**
 * Everything alive in the downtown scene: birds, people, stalls and the cat;
 * riders, the sweeper, the noodle cart and taxis in the street; life on the
 * rooftops; traffic in the sky; the busker; and fireworks on some nights.
 */
export class CityLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly street: StreetLife;
  readonly cat: RooftopCat;
  readonly traffic: Traffic;
  readonly rooftops: Rooftops;
  readonly sky: SkyTraffic;
  readonly fireworks: Fireworks;
  readonly performers: Performers;

  constructor(options: CityLifeOptions) {
    const { scene } = options;
    const ledges = scene.city.ledges;
    this.birds = new BirdSystem({
      ledges,
      worldLayers: { far: scene.birdsFar, mid: scene.birdsMid, near: scene.birdsNear },
      nearLayer: options.nearLayer,
      sillLayer: options.sillLayer,
      viewport: options.viewport,
      birdseed: options.birdseed,
      sound: options.sound,
      canTap: options.canTap,
    });
    this.street = new StreetLife({
      doors: scene.city.doors,
      stallSpots: scene.city.stallSpots,
      laneHalf: scene.laneHalf,
      project: scene.project,
      lightAt: (gx, depth) => scene.lightAt(gx, depth),
    });
    scene.stallLight = (i) => this.street.stallLit(i);
    scene.street.addChild(this.street.container);
    scene.streetLights.addChild(this.street.lightsContainer);
    const tintAt = (gx: number, depth: number) => this.street.tintAt(gx, depth);
    const pan = (x: number) => options.viewport.worldXToStereo(x);
    this.traffic = new Traffic({ container: this.street.container, lights: scene.streetLights, laneHalf: scene.laneHalf, project: scene.project, tintAt });
    this.performers = new Performers({
      container: this.street.container,
      lights: scene.streetLights,
      project: scene.project,
      tintAt,
      openStalls: () => this.street.openStalls(),
      sound: options.sound,
      pan,
    });
    this.rooftops = new Rooftops({ summonPigeons: (x, y, n) => void this.birds.summonToPerchNear(x, y, 'pigeon', n), dronePad: scene.city.dronePad });
    scene.roofLife.addChild(this.rooftops.container);
    this.sky = new SkyTraffic();
    this.fireworks = new Fireworks(options.sound, pan);
    scene.skyLife.addChild(this.sky.container, this.fireworks.container);
    scene.birdsMid.addChild(this.sky.nearContainer);
    this.cat = new RooftopCat(options.sound, options.canTap);
    options.catSlot.addChild(this.cat.container);
  }

  get ambienceLevel(): number {
    return this.street.crowdLevel;
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
    const state: SillState = { ...sill, catX: this.cat.position, catStalking: this.cat.isStalking };
    this.cat.update(dt, env, state, this.birds.sillBirds());
    this.birds.update(dt, env, { ...state, catX: this.cat.position, catStalking: this.cat.isStalking });
    this.street.update(dt, env);
    this.traffic.update(dt, env);
    this.performers.update(dt, env);
    this.rooftops.update(dt, env);
    this.sky.update(dt, env);
    this.fireworks.update(dt, env);
  }
}
