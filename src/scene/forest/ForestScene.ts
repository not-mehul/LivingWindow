import { Container, Particle, ParticleContainer, Rectangle, Sprite, Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { lerpColor, scaleColor } from '../../core/color';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { createRng } from '../../core/random';
import { SwayMesh } from '../common/SwayMesh';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { FAR_FLOOR_Y, FOREST_HORIZON, generateForest, MID_FLOOR_Y, NEAR_FLOOR_Y, type ForestLayout } from './forestGenerator';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** A slanted, dithered shaft of sunlight (drawn additively). */
function createRayTexture(width: number, height: number, slant: number): Texture {
  const c = new PixelCanvas(width + Math.ceil(height * slant), height);
  const img = c.ctx.createImageData(c.width, height);
  for (let y = 0; y < height; y++) {
    const fadeDown = (1 - y / height) ** 0.8;
    for (let i = 0; i < width; i++) {
      const edge = 1 - Math.abs((i + 0.5) / width - 0.5) * 2;
      const level = fadeDown * edge;
      const x = Math.round(i + y * slant);
      if (level * 0.9 <= (BAYER[y & 3][x & 3] + 0.5) / 16) continue;
      const k = (y * c.width + x) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 236;
      img.data[k + 2] = 180;
      img.data[k + 3] = 90;
    }
  }
  c.ctx.putImageData(img, 0, 0);
  return createNearestTexture(c.canvas);
}

function createLeafTextures(): Texture[] {
  const colors = ['#c88a2a', '#a8542a', '#d8b040', '#6a8a34', '#8a5a2a'];
  const c = new PixelCanvas(colors.length * 4, 2);
  colors.forEach((color, i) => {
    c.rect(i * 4, 0, 2, 1, color);
    c.rect(i * 4 + 1, 1, 2, 1, color);
  });
  const source = createNearestTexture(c.canvas).source;
  return colors.map((_, i) => new Texture({ source, frame: new Rectangle(i * 4, 0, 3, 2) }));
}

interface Leaf {
  particle: Particle;
  x: number;
  y: number;
  vy: number;
  phase: number;
  floor: number;
  landed: number;
}

/**
 * Scene 4: the deep forest, seen from a cabin window. Layers of trunks at
 * three depths, crowns and canopy that sway in the wind, ferns, falling
 * leaves and shafts of sunlight through gaps in the canopy.
 */
export class ForestScene implements WorldScene {
  readonly container = new Container({ label: 'forest-scene' });
  readonly sky = new Sky({ horizonY: FOREST_HORIZON, seed: 77 });
  readonly horizonY = FOREST_HORIZON;
  readonly groundY = [MID_FLOOR_Y - 14, NEAR_FLOOR_Y] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  /** Depth slots for creatures. */
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly deerFar = new Container({ label: 'deer-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly deerMid = new Container({ label: 'deer-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  readonly layout: ForestLayout;

  private readonly far: Sprite;
  private readonly mid: Sprite;
  private readonly near: Sprite;
  private readonly crowns: SwayMesh[] = [];
  private readonly canopy: SwayMesh[] = [];
  private readonly ferns: SwayMesh[] = [];
  private readonly crownLayer = new Container();
  private readonly canopyLayer = new Container();
  private readonly fernLayer = new Container();
  private readonly rays: Sprite[] = [];
  private readonly rayLayer = new Container();
  private readonly leaves: Leaf[] = [];
  private readonly leafTextures = createLeafTextures();
  private readonly leafLayer: ParticleContainer;
  private readonly rng = createRng(55);
  private leafBudget = 0;

  constructor() {
    const layout = generateForest();
    this.layout = layout;
    this.far = new Sprite(layout.far.toTexture());
    this.mid = new Sprite(layout.mid.toTexture());
    this.near = new Sprite(layout.near.toTexture());

    const place = (list: typeof layout.crowns, into: SwayMesh[], layer: Container, anchor: 'bottom' | 'top', amplitude: number) => {
      for (const item of list) {
        const sway = new SwayMesh(item.canvas.toTexture(), { anchor, amplitude });
        sway.mesh.position.set(Math.round(item.x), Math.round(item.y));
        into.push(sway);
        layer.addChild(sway.mesh);
      }
    };
    place(layout.crowns, this.crowns, this.crownLayer, 'bottom', 3);
    place(layout.canopy, this.canopy, this.canopyLayer, 'top', 4);
    place(layout.ferns, this.ferns, this.fernLayer, 'bottom', 2);

    for (const [i, x] of layout.gaps.entries()) {
      const ray = new Sprite({ texture: createRayTexture(18 + (i % 3) * 8, 300, 0.32), blendMode: 'add' });
      ray.position.set(x, 20);
      ray.alpha = 0;
      this.rays.push(ray);
      this.rayLayer.addChild(ray);
    }

    this.leafLayer = new ParticleContainer({
      dynamicProperties: { position: true, color: true, uvs: true, rotation: false, vertex: false },
      roundPixels: true,
      boundsArea: new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT),
    });

    this.container.addChild(
      this.sky.container,
      this.far,
      this.birdsFar,
      this.deerFar,
      this.mid,
      this.crownLayer,
      this.birdsMid,
      this.weatherBack,
      this.deerMid,
      this.near,
      this.birdsNear,
      this.canopyLayer,
      this.rayLayer,
      this.leafLayer,
      this.fernLayer,
      this.weatherFront,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.sky.update(dt, env);
    const wind = weather.wind;

    this.far.tint = lighting.haze;
    this.mid.tint = lerpColor(lighting.ambient, lighting.haze, 0.2);
    this.crownLayer.tint = lerpColor(lighting.ambient, lighting.haze, 0.15);
    this.near.tint = lighting.ambient;
    // The canopy and undergrowth sit in shade.
    const shade = scaleColor(lighting.ambient, 0.82);
    this.canopyLayer.tint = shade;
    this.fernLayer.tint = shade;

    for (const sway of this.crowns) sway.update(time, wind);
    for (const sway of this.canopy) sway.update(time, wind);
    for (const sway of this.ferns) sway.update(time * 1.3, wind);

    // Light shafts: strongest with a low, clear morning sun.
    const sun = lighting.sun;
    const clarity = (1 - weather.cloudCover) ** 2;
    const morning = lighting.hours > 6 && lighting.hours < 10 ? 1.4 : 1;
    const strength = sun.visible ? Math.sqrt(Math.max(0, sun.elevation)) * clarity * morning : 0;
    const fromLeft = sun.progress < 0.5;
    this.rays.forEach((ray, i) => {
      ray.scale.x = fromLeft ? 1 : -1;
      ray.alpha = Math.min(1, strength * (0.75 + 0.25 * Math.sin(time * 0.4 + i * 1.7)));
      ray.tint = sun.color;
    });

    this.updateLeaves(dt, env);
  }

  private updateLeaves(dt: number, env: Environment): void {
    const wind = env.weather.wind;
    const rate = 0.6 + 5 * Math.abs(wind);
    this.leafBudget += dt * rate;
    while (this.leafBudget >= 1 && this.leaves.length < 80) {
      this.leafBudget -= 1;
      const texture = this.leafTextures[Math.floor(this.rng() * this.leafTextures.length)];
      const particle = new Particle({ texture, x: 0, y: 0 });
      this.leafLayer.addParticle(particle);
      this.leaves.push({
        particle,
        x: this.rng() * WORLD_WIDTH,
        y: 30 + this.rng() * 40,
        vy: 7 + this.rng() * 8,
        phase: this.rng() * Math.PI * 2,
        floor: this.rng() < 0.5 ? MID_FLOOR_Y - 14 + this.rng() * 6 : NEAR_FLOOR_Y + this.rng() * 20,
        landed: 0,
      });
    }
    const tint = env.lighting.ambient;
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const leaf = this.leaves[i];
      if (leaf.landed > 0) {
        leaf.landed -= dt;
        leaf.particle.alpha = Math.min(1, leaf.landed / 2);
        if (leaf.landed <= 0) {
          this.leafLayer.removeParticle(leaf.particle);
          this.leaves.splice(i, 1);
        }
        continue;
      }
      leaf.phase += dt * 2.2;
      leaf.y += leaf.vy * dt * (0.7 + 0.3 * Math.sin(leaf.phase * 1.3));
      leaf.x += (wind * 30 + Math.sin(leaf.phase) * 9) * dt;
      if (leaf.y >= leaf.floor) {
        leaf.y = leaf.floor;
        leaf.landed = 4;
      }
      if (leaf.x < -10) leaf.x += WORLD_WIDTH + 20;
      if (leaf.x > WORLD_WIDTH + 10) leaf.x -= WORLD_WIDTH + 20;
      leaf.particle.x = Math.round(leaf.x);
      leaf.particle.y = Math.round(leaf.y);
      // Tumbling: the leaf flips edge-on now and then.
      leaf.particle.scaleY = Math.sin(leaf.phase * 1.7) > 0.6 ? 0.5 : 1;
      leaf.particle.tint = tint;
    }
  }
}

export { FAR_FLOOR_Y, MID_FLOOR_Y, NEAR_FLOOR_Y };
