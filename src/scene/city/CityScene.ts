import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { createRng } from '../../core/random';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateCity, HORIZON_Y, STREET_Y, type CityLayerName, type CityLayout } from './cityGenerator';
import { StreetLamps } from './StreetLamps';
import { WindowLife } from './WindowLife';
import { WindowLights } from './WindowLights';

/** How bright each layer's lit windows read: distance dims them. */
const WINDOW_BRIGHTNESS: Record<CityLayerName, number> = { far: 0.55, mid: 0.85, near: 1 };

/**
 * Placeholder Downtown City Rooftop (Scene 1). Procedural art stands in until
 * the hand-polished layers arrive in Step 4, but the layering, lighting and
 * weather hooks are the real thing.
 */
export class CityScene implements WorldScene {
  readonly container = new Container({ label: 'city-scene' });
  readonly sky = new Sky({ horizonY: HORIZON_Y });
  readonly horizonY = HORIZON_Y;
  readonly groundY = [STREET_Y + 2, STREET_Y + 30] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  /** Slots for living things, in depth order. */
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  readonly street = new Container({ label: 'street' });
  readonly streetLights = new Container({ label: 'street-emissive' });
  readonly city: CityLayout;
  readonly sidewalkY = STREET_Y + 3;

  private readonly layers: Record<CityLayerName, Sprite>;
  private readonly lights: WindowLights[] = [];
  private readonly lamps: StreetLamps;
  private readonly life: WindowLife[] = [];

  constructor() {
    const rng = createRng(9001);
    const city = generateCity();
    this.city = city;
    const sprites = {} as Record<CityLayerName, Sprite>;
    const lightsByLayer = {} as Record<CityLayerName, WindowLights>;
    for (const layer of city.layers) {
      sprites[layer.name] = new Sprite(layer.canvas.toTexture());
      const lights = new WindowLights(layer.windows, rng, WINDOW_BRIGHTNESS[layer.name]);
      lightsByLayer[layer.name] = lights;
      this.lights.push(lights);
    }
    this.layers = sprites;
    this.lamps = new StreetLamps(city.lamps, STREET_Y + 3, rng);
    const midLife = new WindowLife(lightsByLayer.mid, rng);
    const nearLife = new WindowLife(lightsByLayer.near, rng);
    this.life.push(midLife, nearLife);

    this.container.addChild(
      this.sky.container,
      sprites.far,
      lightsByLayer.far.sprite,
      this.birdsFar,
      sprites.mid,
      lightsByLayer.mid.sprite,
      midLife.graphics,
      this.birdsMid,
      this.weatherBack,
      sprites.near,
      lightsByLayer.near.sprite,
      nearLife.graphics,
      this.lamps.graphics,
      this.street,
      this.streetLights,
      this.birdsNear,
      this.weatherFront,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting } = env;
    this.sky.update(dt, env);
    this.layers.far.tint = lighting.haze;
    this.layers.mid.tint = lerpColor(lighting.ambient, lighting.haze, 0.15);
    this.layers.near.tint = lighting.ambient;
    for (const lights of this.lights) lights.update(dt, lighting.windowsLit, lighting.emissive);
    this.lamps.update(dt, lighting.darkness, lighting.emissive);
    for (const life of this.life) life.update(dt, lighting.emissive, lighting.darkness);
  }
}
