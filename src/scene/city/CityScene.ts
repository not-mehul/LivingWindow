import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { createRng } from '../../core/random';
import { CITY_HORIZON, LANE_HALF, projectPoint } from '../../sim/cityGeometry';
import type { Environment } from '../Environment';
import { DayNightSprite, type NightGrade } from '../common/night';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateCity, type CityLayerName, type CityLayout } from './cityGenerator';
import { StreetLamps } from './StreetLamps';
import { WindowLife } from './WindowLife';
import { WindowLights } from './WindowLights';

/** Moonlit grades for the city's depth bands, after the night drawing: a deep teal-blue night. */
const NIGHT: Record<CityLayerName, NightGrade> = {
  far: { desaturate: 0.6, tint: [0.2, 0.3, 0.42], lift: [10, 16, 28] },
  mid: { desaturate: 0.6, tint: [0.24, 0.36, 0.46], lift: [8, 12, 22] },
  near: { desaturate: 0.6, tint: [0.27, 0.4, 0.48], lift: [6, 12, 20] },
};

/** How bright each layer's lit windows read: distance dims them. */
const WINDOW_BRIGHTNESS: Record<CityLayerName, number> = { far: 0.45, mid: 0.8, near: 1 };

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
  readonly sky = new Sky({ horizonY: CITY_HORIZON, moonPhase: 'crescent', nightColors: [0x0c1834, 0x1e4a64] });
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

  private readonly layers: Record<CityLayerName, DayNightSprite>;
  private readonly neon: Sprite;
  private readonly glow: Sprite;
  private readonly over: DayNightSprite;
  private readonly lights: WindowLights[] = [];
  private readonly lamps: StreetLamps;
  private readonly life: WindowLife[] = [];

  constructor() {
    const rng = createRng(9001);
    const city = generateCity();
    this.city = city;
    const sprites = {} as Record<CityLayerName, DayNightSprite>;
    const lightsByLayer = {} as Record<CityLayerName, WindowLights>;
    for (const layer of city.layers) {
      sprites[layer.name] = new DayNightSprite(layer.art, NIGHT[layer.name]);
      const lights = new WindowLights(layer.windows, rng, WINDOW_BRIGHTNESS[layer.name]);
      lightsByLayer[layer.name] = lights;
      this.lights.push(lights);
    }
    this.layers = sprites;
    this.over = new DayNightSprite(city.over, NIGHT.near);
    this.glow = new Sprite(city.streetGlow.toTexture());
    this.glow.blendMode = 'add';
    this.neon = new Sprite(city.neon.toTexture());
    this.neon.blendMode = 'add';
    this.lamps = new StreetLamps(city.lamps, rng);
    const midLife = new WindowLife(lightsByLayer.mid, rng);
    const nearLife = new WindowLife(lightsByLayer.near, rng);
    this.life.push(midLife, nearLife);

    this.container.addChild(
      this.sky.container,
      sprites.far.container,
      lightsByLayer.far.sprite,
      this.birdsFar,
      sprites.mid.container,
      lightsByLayer.mid.sprite,
      midLife.graphics,
      this.birdsMid,
      this.weatherBack,
      sprites.near.container,
      lightsByLayer.near.sprite,
      nearLife.graphics,
      this.glow,
      this.street,
      this.over.container,
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
    this.layers.far.update(lerpColor(lighting.ambient, lighting.haze, 0.55), lighting);
    this.layers.mid.update(lerpColor(lighting.ambient, lighting.haze, 0.2), lighting);
    this.layers.near.update(lighting.ambient, lighting);
    this.over.update(lighting.ambient, lighting);
    // The night market lights the street from below.
    this.glow.alpha = Math.min(1, Math.max(0, lighting.emissive - 0.35) * 1.4);
    // Neon signs come on at dusk, with a faint buzz of a flicker.
    this.neon.alpha = Math.min(1, lighting.emissive * 1.2) * (Math.random() < 0.003 ? 0.6 : 1);
    for (const lights of this.lights) lights.update(dt, lighting.windowsLit, lighting.emissive);
    this.lamps.update(dt, lighting.darkness, lighting.emissive);
    for (const life of this.life) life.update(dt, lighting.emissive, lighting.darkness);
  }
}
