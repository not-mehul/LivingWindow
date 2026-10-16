import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { createRng } from '../../core/random';
import { CITY_HORIZON, LANE_HALF, projectPoint } from '../../sim/cityGeometry';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateCity, type CityLayerName, type CityLayout } from './cityGenerator';
import { StreetLamps } from './StreetLamps';
import { WindowLife } from './WindowLife';
import { WindowLights } from './WindowLights';

/** How bright each layer's lit windows read: distance dims them. */
const WINDOW_BRIGHTNESS: Record<CityLayerName, number> = { far: 0.6, mid: 0.85, near: 1 };

/**
 * Scene 1: the city, after the reference drawing. From high on a rooftop you
 * look straight down a market street in one-point perspective: a terrace
 * with a railing at left, our own parapet sweeping across the lower right,
 * tall towers rising off the top of the view, rooftops below with plant,
 * pipes and billboards, a skybridge over the street, and the skyline beyond
 * with its great spire. At night the windows, signs, lamps and market light up.
 */
export class CityScene implements WorldScene {
  readonly container = new Container({ label: 'city-scene' });
  readonly sky = new Sky({ horizonY: CITY_HORIZON });
  readonly horizonY = CITY_HORIZON;
  readonly groundY = [CITY_HORIZON + 30, 340] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  /** Slots for living things, in depth order. */
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  /** People and stalls in the street, sorted by where they stand. */
  readonly street = new Container({ label: 'street' });
  readonly streetLights = new Container({ label: 'street-emissive' });
  readonly city: CityLayout;
  readonly laneHalf = LANE_HALF;
  readonly project = (gx: number, depth: number) => projectPoint(gx, depth);

  private readonly layers: Record<CityLayerName, Sprite>;
  private readonly neon: Sprite;
  private readonly over: Sprite;
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
      sprites[layer.name] = new Sprite(layer.art.toTexture());
      const lights = new WindowLights(layer.windows, rng, WINDOW_BRIGHTNESS[layer.name]);
      lightsByLayer[layer.name] = lights;
      this.lights.push(lights);
    }
    this.layers = sprites;
    this.over = new Sprite(city.over.toTexture());
    this.neon = new Sprite(city.neon.toTexture());
    this.neon.blendMode = 'add';
    this.lamps = new StreetLamps(city.lamps, rng);
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
      this.street,
      this.over,
      this.neon,
      this.lamps.graphics,
      this.streetLights,
      this.birdsNear,
      this.weatherFront,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting } = env;
    this.sky.update(dt, env);
    this.layers.far.tint = lerpColor(lighting.ambient, lighting.haze, 0.55);
    this.layers.mid.tint = lerpColor(lighting.ambient, lighting.haze, 0.2);
    this.layers.near.tint = lighting.ambient;
    this.over.tint = lighting.ambient;
    // Neon signs come on at dusk, with a faint buzz of a flicker.
    this.neon.alpha = Math.min(1, lighting.emissive * 1.2) * (Math.random() < 0.003 ? 0.6 : 1);
    for (const lights of this.lights) lights.update(dt, lighting.windowsLit, lighting.emissive);
    this.lamps.update(dt, lighting.darkness, lighting.emissive);
    for (const life of this.life) life.update(dt, lighting.emissive, lighting.darkness);
  }
}
