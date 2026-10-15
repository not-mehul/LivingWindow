import type { Container } from 'pixi.js';
import type { Viewport } from '../core/Viewport';
import type { SceneLife, SillBase } from '../landscapes/types';
import type { CityScene } from '../scene/city/CityScene';
import type { Environment } from '../scene/Environment';
import type { BirdseedState } from '../state/BirdseedState';
import { BirdSystem } from './BirdSystem';
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

/** Everything alive in the downtown scene: birds, people, stalls and the cat. */
export class CityLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly street: StreetLife;
  readonly cat: RooftopCat;

  constructor(options: CityLifeOptions) {
    const { scene } = options;
    const ledges = [...scene.city.layers.flatMap((l) => l.ledges), ...scene.city.streetLedges];
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
    const doors = scene.city.layers.filter((l) => l.name !== 'far').flatMap((l) => l.doors);
    this.street = new StreetLife({ doors, sidewalkY: scene.sidewalkY });
    scene.street.addChild(this.street.container);
    scene.streetLights.addChild(this.street.lightsContainer);
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
  }
}
