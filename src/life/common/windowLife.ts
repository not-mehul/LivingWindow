import type { LandscapeDeps } from '../../landscapes/types';
import type { Environment } from '../../scene/Environment';
import { owlActivity } from '../../sim/wildlife';
import { BirdSystem, defaultActivity, type BirdEcology, type BirdLayers } from '../BirdSystem';
import type { Ledge, SillState } from '../types';
import { WindowDog } from '../WindowDog';

/** A scene's bird layers, far to near. */
export interface BirdScene {
  birdsFar: BirdLayers['far'];
  birdsMid: BirdLayers['mid'];
  birdsNear: BirdLayers['near'];
}

/** The landscape's birds: perched about its ledges, flying past the window and down to the sill. */
export function makeBirds(scene: BirdScene, ledges: Ledge[], deps: LandscapeDeps, ecology?: BirdEcology): BirdSystem {
  return new BirdSystem({
    ledges,
    worldLayers: { far: scene.birdsFar, mid: scene.birdsMid, near: scene.birdsNear },
    nearLayer: deps.layers.near,
    sillLayer: deps.layers.sillFront,
    viewport: deps.viewport,
    birdseed: deps.birdseed,
    sound: deps.sound,
    canTap: deps.canTap,
    ecology,
  });
}

/** The household dog, up at the window now and then; birds on the sill take off when it pops up. */
export function addWindowDog(deps: LandscapeDeps, birds: BirdSystem): WindowDog {
  const dog = new WindowDog(deps.sound, deps.canTap, (x) => birds.startleNear(x, 50));
  deps.layers.room.addChild(dog.container);
  return dog;
}

/** The dog's frame: it eyes the birds on the sill, and turns to one flashing past the window. */
export function updateWindowDog(dog: WindowDog, birds: BirdSystem, dt: number, env: Environment, sill: SillState): void {
  dog.update(dt, env, sill, birds.sillBirds());
  const flyby = birds.nearFlights(sill)[0];
  if (flyby !== undefined) dog.glance(flyby);
}

/** How lively the birds are where an owl comes out at night: the day birds by day, the owl after dark (not in a storm). */
export function owlNightActivity(env: Environment): number {
  return Math.max(defaultActivity(env), owlActivity(env.lighting.hours) * (1 - env.weather.lightning));
}
