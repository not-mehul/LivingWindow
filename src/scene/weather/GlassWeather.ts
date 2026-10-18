import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { quality } from '../../core/quality';
import type { Environment } from '../Environment';
import type { WeatherAtlas } from './atlas';
import { GlassRainSim, type GlassDrop } from './glassSim';

/** Renders `GlassRainSim` onto the sash's glass layer (in sash art pixels). */
export class GlassWeather {
  readonly container: ParticleContainer;
  readonly sim: GlassRainSim;
  private readonly particles: Particle[] = [];

  constructor(
    private readonly atlas: WeatherAtlas,
    rng: () => number = Math.random,
  ) {
    this.sim = new GlassRainSim(rng);
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, color: true, uvs: true, rotation: false, vertex: false },
      roundPixels: true,
    });
  }

  /** Match the glass area of the sash (in its local art-pixel coordinates). */
  layout(glass: Rectangle): void {
    this.container.position.set(glass.x, glass.y);
    this.container.boundsArea = new Rectangle(0, 0, glass.width, glass.height);
    this.sim.resize(glass.width, glass.height);
  }

  update(dt: number, env: Environment, windowOpenness: number): void {
    const { weather, lighting } = env;
    this.sim.maxDrops = Math.round(700 * quality.scale);
    this.sim.update(dt, {
      rain: weather.kind === 'rain' ? weather.precipitation : 0,
      snow: weather.kind === 'snow' ? weather.precipitation : 0,
      wind: weather.wind,
      exposure: 1 - windowOpenness,
    });
    this.sync(lighting.precipitationTint, lighting.ambient);
  }

  private sync(waterBase: number, ambient: number): void {
    const drops = this.sim.drops;
    while (this.particles.length < drops.length) {
      const particle = new Particle({ texture: this.atlas.glassDrops[0] });
      this.particles.push(particle);
      this.container.addParticle(particle);
    }
    while (this.particles.length > drops.length) {
      const particle = this.particles.pop();
      if (particle) this.container.removeParticle(particle);
    }

    const water = lerpColor(waterBase, 0xffffff, 0.5);
    const snow = lerpColor(ambient, 0xffffff, 0.55);
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const p = this.particles[i];
      const texture = this.textureFor(d);
      p.texture = texture;
      p.x = Math.round(d.x - texture.frame.width / 2);
      p.y = Math.round(d.y - texture.frame.height / 2);
      p.tint = d.snow ? snow : water;
      p.alpha = d.trail ? Math.max(0, 1 - d.age / d.life) * 0.85 : 1;
    }
  }

  private textureFor(d: GlassDrop) {
    if (d.snow) return this.atlas.glassSnow[d.size < 1.5 ? 0 : 1];
    const frames = this.atlas.glassDrops;
    if (d.trail || d.size < 1.4) return frames[0];
    if (d.sliding) return frames[d.size < 3 ? 2 : d.size < 4 ? 3 : 4];
    if (d.size < 2.2) return frames[1];
    if (d.size < 3.2) return frames[2];
    return frames[d.size < 4.2 ? 3 : 4];
  }
}
