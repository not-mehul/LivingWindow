import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { createRng } from '../../core/random';
import { CITY_HORIZON, LANE_HALF, projectPoint } from '../../sim/cityGeometry';
import type { Environment } from '../Environment';
import { DayNightSprite, type NightGrade } from '../common/night';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateCity, poolFalloff, POOL_REACH, type CityLayerName, type CityLayout } from './cityGenerator';
import { StreetLamps } from './StreetLamps';
import { WindowLife } from './WindowLife';
import { WindowLights } from './WindowLights';

/** Moonlit grades for the city's depth bands, after the night drawing: a deep teal-blue night. */
const NIGHT: Record<CityLayerName, NightGrade> = {
  far: { desaturate: 0.6, tint: [0.2, 0.3, 0.42], lift: [10, 16, 28] },
  mid: { desaturate: 0.6, tint: [0.24, 0.36, 0.46], lift: [8, 12, 22] },
  near: { desaturate: 0.6, tint: [0.27, 0.4, 0.48], lift: [6, 12, 20] },
};

/** Dusk and dawn, after the drawing: faces lit a warm pink-lavender, the distance a hazy violet. */
const DUSK: Record<CityLayerName, NightGrade> = {
  far: { desaturate: 0.55, tint: [0.5, 0.44, 0.64], lift: [12, 8, 24] },
  mid: { desaturate: 0.45, tint: [0.62, 0.52, 0.7], lift: [8, 4, 18] },
  near: { desaturate: 0.4, tint: [0.8, 0.66, 0.8], lift: [6, 0, 16] },
};

/** The street's paving: darker and warmer than the walls at night, so the pools of light read on it. */
const STREET_NIGHT: NightGrade = { desaturate: 0.5, tint: [0.24, 0.25, 0.32], lift: [6, 6, 12] };
const STREET_DUSK: NightGrade = { desaturate: 0.35, tint: [0.62, 0.5, 0.56], lift: [4, 2, 8] };

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
  /** How lit night stall `i` is (0..1); the street life sets this so its pool of light follows the stall. */
  stallLight: (i: number) => number = () => 0;

  private readonly layers: Record<CityLayerName, DayNightSprite>;
  private readonly over: DayNightSprite;
  private readonly lights: WindowLights[] = [];
  private readonly lamps: StreetLamps;
  private readonly life: WindowLife[] = [];
  private readonly pools: Array<{ sprite: Sprite; source: 'stall' | 'lamp'; index: number }> = [];
  private readonly poolLayer = new Container({ label: 'light-pools' });
  private readonly signs: Array<{ sprite: Sprite; broken: boolean; dip: number }> = [];
  private readonly signLayer = new Container({ label: 'neon' });
  private signsLevel = 0;

  constructor() {
    const rng = createRng(9001);
    const city = generateCity();
    this.city = city;
    const sprites = {} as Record<CityLayerName, DayNightSprite>;
    const lightsByLayer = {} as Record<CityLayerName, WindowLights>;
    for (const layer of city.layers) {
      // The street's paving lies in the near band; it gets its own grade.
      const override = layer.name === 'near' ? { mask: city.streetMask, night: STREET_NIGHT, dusk: STREET_DUSK } : undefined;
      sprites[layer.name] = new DayNightSprite(layer.art, NIGHT[layer.name], DUSK[layer.name], override);
      const lights = new WindowLights(layer.windows, rng, WINDOW_BRIGHTNESS[layer.name]);
      lightsByLayer[layer.name] = lights;
      this.lights.push(lights);
    }
    this.layers = sprites;
    this.over = new DayNightSprite(city.over, NIGHT.near, DUSK.near);
    const overLights = new WindowLights(city.overWindows, rng, 1);
    this.lights.push(overLights);
    for (const pool of city.pools) {
      const sprite = new Sprite({ texture: pool.art.toTexture(), blendMode: 'add' });
      sprite.position.set(pool.x, pool.y);
      sprite.visible = false;
      this.poolLayer.addChild(sprite);
      this.pools.push({ sprite, source: pool.source, index: pool.index });
    }
    for (const sign of city.signs) {
      const sprite = new Sprite({ texture: sign.art.toTexture(), blendMode: 'add' });
      sprite.position.set(sign.x, sign.y);
      this.signLayer.addChild(sprite);
      this.signs.push({ sprite, broken: sign.broken, dip: 0 });
    }
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
      this.poolLayer,
      this.street,
      this.lamps.container,
      this.streetLights,
      this.over.container,
      overLights.sprite,
      this.signLayer,
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
    for (const lights of this.lights) lights.update(dt, lighting.windowsLit, lighting.emissive);
    this.lamps.update(dt, lighting.darkness, lighting.emissive);
    for (const life of this.life) life.update(dt, lighting.emissive, lighting.darkness);
    // Pools of light follow their sources: the lamps as they flicker on, the stalls as they set up and pack away.
    for (const pool of this.pools) {
      const level = pool.source === 'lamp' ? this.lamps.level(pool.index) : this.stallLight(pool.index) * Math.max(0, lighting.emissive - 0.3) / 0.7;
      pool.sprite.visible = level > 0.02;
      pool.sprite.alpha = Math.min(1, level);
    }
    this.updateSigns(dt, lighting.emissive);
  }

  /** How much warm light falls on a point of the street right now (0..~1.5), to light the people walking through it. */
  lightAt(gx: number, depth: number): number {
    let light = 0;
    for (const lamp of this.city.lamps.keys()) {
      const l = this.lamps.level(lamp);
      if (l > 0) light += l * 0.8 * poolFalloff(gx, depth, this.city.lamps[lamp].gx, this.city.lamps[lamp].depth, POOL_REACH.lamp);
    }
    this.city.stallSpots.forEach((spot, i) => {
      if (spot.shift !== 'night') return;
      const l = this.stallLight(i);
      if (l > 0) light += l * poolFalloff(gx, depth, spot.gx * 0.8, spot.depth, POOL_REACH.stall);
    });
    return light;
  }

  /** Neon comes on as dusk deepens. Each sign buzzes on its own now and then; a worn one stutters. */
  private updateSigns(dt: number, emissive: number): void {
    const target = Math.max(0, Math.min(1, (emissive - 0.3) / 0.55));
    this.signsLevel += (target - this.signsLevel) * Math.min(1, dt * 2);
    for (const sign of this.signs) {
      if (sign.dip > 0) sign.dip -= dt;
      else if (Math.random() < dt * (sign.broken ? 0.9 : 0.02)) sign.dip = sign.broken ? 0.05 + Math.random() * 0.5 : 0.06 + Math.random() * 0.12;
      const flick = sign.dip > 0 ? (sign.broken ? (Math.random() < 0.5 ? 0.1 : 0.6) : 0.55) : 1;
      sign.sprite.visible = this.signsLevel > 0.01;
      sign.sprite.alpha = this.signsLevel * flick;
    }
  }
}
