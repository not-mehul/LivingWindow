import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { createRng } from '../../core/random';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateCity, HORIZON_Y, STREET_Y, type CityLayerName } from './cityGenerator';
import { StreetLamps } from './StreetLamps';
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

  private readonly layers: Record<CityLayerName, Sprite>;
  private readonly lights: WindowLights[] = [];
  private readonly lamps: StreetLamps;

  constructor() {
    const rng = createRng(9001);
    const city = generateCity();
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

    this.container.addChild(
      this.sky.container,
      sprites.far,
      lightsByLayer.far.sprite,
      sprites.mid,
      lightsByLayer.mid.sprite,
      this.weatherBack,
      sprites.near,
      lightsByLayer.near.sprite,
      this.lamps.graphics,
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
  }
}
