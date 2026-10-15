import { Particle, ParticleContainer, Rectangle, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { clamp } from '../../core/math';
import type { PrecipitationKind } from '../../state/Weather';
import type { Environment } from '../Environment';
import { RAIN_LENGTHS, RAIN_SLANTS, type WeatherAtlas } from './atlas';

export interface PrecipitationLayerConfig {
  /** Particles on screen at full intensity. */
  maxRain: number;
  maxSnow: number;
  /** Fall speeds in world px / s. */
  rainSpeed: readonly [number, number];
  snowSpeed: readonly [number, number];
  /** Which streak lengths (indices into RAIN_LENGTHS) this depth uses. */
  rainLengths: readonly number[];
  snowSizes: readonly number[];
  /** Horizontal push from wind at full strength, px / s. */
  windPush: number;
  alpha: number;
  /** Where drops end: a random world y in this range (e.g. the street). */
  groundY: readonly [number, number];
  splashes: boolean;
}

interface Drop {
  particle: Particle;
  kind: Exclude<PrecipitationKind, 'none'>;
  x: number;
  y: number;
  vy: number;
  groundY: number;
  /** Snow sway phase and amplitude. */
  phase: number;
  sway: number;
}

interface Splash {
  particle: Particle;
  life: number;
}

const SPLASH_SECONDS = 0.12;

/**
 * One depth layer of falling rain or snow in world space. Scenes place a far
 * layer behind their nearest scenery and a near layer in front of it, which
 * sells the depth without any per-drop sorting.
 */
export class PrecipitationLayer {
  readonly container: ParticleContainer;
  private readonly drops: Drop[] = [];
  private readonly splashes: Splash[] = [];
  private spawnBudget = 0;
  private time = 0;

  constructor(
    private readonly atlas: WeatherAtlas,
    private readonly config: PrecipitationLayerConfig,
    private readonly rng: () => number = Math.random,
  ) {
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, color: true, uvs: true, rotation: false, vertex: false },
      roundPixels: true,
      boundsArea: new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT),
    });
  }

  get activeCount(): number {
    return this.drops.length;
  }

  update(dt: number, env: Environment): void {
    this.time += dt;
    const { weather, lighting } = env;
    const kind = weather.kind;
    const max = kind === 'snow' ? this.config.maxSnow : kind === 'rain' ? this.config.maxRain : 0;
    const target = Math.round(max * weather.precipitation);

    // Spawn at a bounded rate so a downpour builds up from the top.
    if (kind !== 'none' && this.drops.length < target) {
      this.spawnBudget += dt * max * 1.5;
      while (this.spawnBudget >= 1 && this.drops.length < target) {
        this.spawnBudget -= 1;
        this.spawn(kind, weather.wind);
      }
    } else {
      this.spawnBudget = 0;
    }

    const tint = lighting.precipitationTint;
    const windX = weather.wind * this.config.windPush;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.vy * dt;
      if (d.kind === 'snow') {
        d.x += (windX * 0.45 + Math.sin(this.time * 1.7 + d.phase) * d.sway) * dt;
      } else {
        d.x += windX * dt;
      }
      if (d.y >= d.groundY || d.x < -40 || d.x > WORLD_WIDTH + 40) {
        if (d.kind === 'rain' && this.config.splashes && d.y >= d.groundY) this.splash(d.x, d.groundY);
        this.container.removeParticle(d.particle);
        this.drops.splice(i, 1);
        continue;
      }
      d.particle.x = Math.round(d.x);
      d.particle.y = Math.round(d.y);
      d.particle.tint = tint;
    }

    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.container.removeParticle(s.particle);
        this.splashes.splice(i, 1);
      } else {
        s.particle.tint = tint;
      }
    }
  }

  private spawn(kind: 'rain' | 'snow', wind: number): void {
    const { config, rng } = this;
    const [vMin, vMax] = kind === 'rain' ? config.rainSpeed : config.snowSpeed;
    const vy = vMin + (vMax - vMin) * rng();
    const [gMin, gMax] = config.groundY;
    const groundY = gMin + (gMax - gMin) * rng();
    // Start upwind so wind-blown drops still cover the whole panorama.
    const drift = (wind * config.windPush * groundY) / vy;
    const x = rng() * (WORLD_WIDTH + 40) - 20 - drift * (kind === 'snow' ? 0.45 : 1);

    let texture: Texture;
    if (kind === 'rain') {
      const lengths = config.rainLengths;
      const lengthIndex = lengths[Math.floor(rng() * lengths.length)];
      // Pick the streak whose slant matches the drop's direction of travel:
      // horizontal travel over the streak's length, in whole pixels.
      const length = RAIN_LENGTHS[lengthIndex];
      const slant = clamp(Math.round(((wind * config.windPush) / vy) * length), -2, 2);
      texture = this.atlas.rain[lengthIndex][RAIN_SLANTS.indexOf(slant as (typeof RAIN_SLANTS)[number])];
    } else {
      const sizes = config.snowSizes;
      texture = this.atlas.snow[sizes[Math.floor(rng() * sizes.length)]];
    }

    const particle = new Particle({ texture, x: Math.round(x), y: -10, alpha: config.alpha });
    this.container.addParticle(particle);
    this.drops.push({
      particle,
      kind,
      x,
      y: -texture.frame.height - rng() * 30,
      vy,
      groundY,
      phase: rng() * Math.PI * 2,
      sway: 4 + rng() * 10,
    });
  }

  private splash(x: number, y: number): void {
    const particle = new Particle({
      texture: this.atlas.splash,
      x: Math.round(x) - 1,
      y: Math.round(y) - 2,
      alpha: this.config.alpha,
    });
    this.container.addParticle(particle);
    this.splashes.push({ particle, life: SPLASH_SECONDS });
  }
}
