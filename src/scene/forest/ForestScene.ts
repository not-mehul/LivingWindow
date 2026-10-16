import { Container, Particle, ParticleContainer, Rectangle, Sprite, Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { lerpColor, scaleColor } from '../../core/color';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { createRng } from '../../core/random';
import type { GroundPlane } from '../../sim/groundPlane';
import type { WalkArea } from '../../sim/groundWalker';
import { DayNightSprite, type NightGrade } from '../common/night';
import { SwayMesh } from '../common/SwayMesh';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { BROW_Y, FOREST_FLOOR, FOREST_HORIZON, forestPlane, generateForest, type ForestLayout } from './forestGenerator';

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
      img.data[k + 3] = 80;
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

/** Moonlit grades for the forest's layers, after the night drawing. */
const NIGHT: Record<'far' | 'mountains' | 'valley' | 'wood', NightGrade> = {
  // Moonlit peaks and slopes: pale blue-violet, the brightest land in the view.
  far: { desaturate: 0.55, tint: [0.62, 0.66, 0.98], lift: [20, 22, 46] },
  mountains: { desaturate: 0.5, tint: [0.62, 0.66, 0.95], lift: [16, 18, 40] },
  valley: { desaturate: 0.4, tint: [0.5, 0.62, 0.78], lift: [10, 14, 30] },
  // The wood: deep teal greens, bark a dusky violet-brown.
  wood: { desaturate: 0.35, tint: [0.46, 0.6, 0.66], lift: [6, 10, 20] },
};
const NIGHT_FOLIAGE = 0x58808c;

/** Dusk and dawn, after the drawing: blue-grey mountains against the glow, cool deep greens. */
const DUSK: typeof NIGHT = {
  far: { desaturate: 0.6, tint: [0.66, 0.74, 0.98], lift: [10, 12, 30] },
  mountains: { desaturate: 0.6, tint: [0.66, 0.74, 0.96], lift: [8, 10, 26] },
  valley: { desaturate: 0.45, tint: [0.66, 0.76, 0.9], lift: [6, 8, 20] },
  wood: { desaturate: 0.4, tint: [0.66, 0.74, 0.8], lift: [4, 4, 12] },
};
const DUSK_FOLIAGE = 0x6a7c84;

interface Tree {
  sway: SwayMesh;
  haze: number;
}

/**
 * Scene 4: the deep forest, from a cabin on a wooded rise. A great gnarled oak
 * and a tall pine frame a valley running away between two mountains; in the
 * wood in front, deer wander between the trunks, towards and away from the
 * window.
 */
export class ForestScene implements WorldScene {
  readonly container = new Container({ label: 'forest-scene' });
  readonly sky = new Sky({ horizonY: FOREST_HORIZON, seed: 77 });
  readonly horizonY = FOREST_HORIZON;
  readonly groundY = [BROW_Y, 340] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  readonly plane: GroundPlane = forestPlane;
  /** Where deer roam: the whole floor of the wood, among the trunks. */
  readonly floorArea: WalkArea = FOREST_FLOOR;
  /** Birds over the valley. */
  readonly birdsFar = new Container({ label: 'birds-far' });
  /**
   * Trees on the clearing, deer and squirrels, sorted by the y of their feet
   * so a deer can pass behind one tree and in front of the next.
   */
  readonly midground = new Container({ label: 'midground', sortableChildren: true });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  readonly layout: ForestLayout;

  private readonly far: DayNightSprite;
  private readonly mountains: DayNightSprite;
  private readonly valley: DayNightSprite;
  private readonly ground: DayNightSprite;
  private readonly near: DayNightSprite;
  private readonly trees: Tree[] = [];
  private readonly canopy: SwayMesh[] = [];
  private readonly ferns: SwayMesh[] = [];
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
    this.far = new DayNightSprite(layout.far, NIGHT.far, DUSK.far);
    this.mountains = new DayNightSprite(layout.mountains, NIGHT.mountains, DUSK.mountains);
    this.valley = new DayNightSprite(layout.valley, NIGHT.valley, DUSK.valley);
    this.ground = new DayNightSprite(layout.ground, NIGHT.wood, DUSK.wood);
    this.near = new DayNightSprite(layout.near, NIGHT.wood, DUSK.wood);

    for (const tree of [...layout.midTrees, ...layout.floorPlants]) {
      const sway = new SwayMesh(tree.art.toTexture(), { anchor: 'bottom', amplitude: 1 + tree.art.height / 90 });
      sway.mesh.position.set(tree.x, tree.y);
      sway.mesh.zIndex = tree.baseY;
      this.midground.addChild(sway.mesh);
      this.trees.push({ sway, haze: tree.haze });
    }
    for (const piece of layout.canopy) {
      const sway = new SwayMesh(piece.art.toTexture(), { anchor: 'top', amplitude: 3 });
      sway.mesh.position.set(Math.round(piece.x), Math.round(piece.y));
      this.canopy.push(sway);
      this.canopyLayer.addChild(sway.mesh);
    }
    for (const piece of layout.ferns) {
      const sway = new SwayMesh(piece.art.toTexture(), { anchor: 'bottom', amplitude: 2 });
      sway.mesh.position.set(Math.round(piece.x), Math.round(piece.y));
      this.ferns.push(sway);
      this.fernLayer.addChild(sway.mesh);
    }

    for (const [i, x] of layout.gaps.entries()) {
      const ray = new Sprite({ texture: createRayTexture(16 + (i % 3) * 8, 250, 0.55), blendMode: 'add' });
      ray.position.set(x, 10);
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
      this.far.container,
      this.mountains.container,
      this.valley.container,
      this.birdsFar,
      this.weatherBack,
      this.ground.container,
      this.midground,
      this.birdsMid,
      this.near.container,
      this.birdsNear,
      this.rayLayer,
      this.leafLayer,
      this.fernLayer,
      this.canopyLayer,
      this.weatherFront,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.sky.update(dt, env);
    const wind = weather.wind;

    // Atmospheric perspective: the further away, the more it takes the sky's haze.
    this.far.update(lerpColor(lighting.haze, lighting.skyHorizon, 0.4), lighting);
    this.mountains.update(lerpColor(lighting.ambient, lighting.haze, 0.8), lighting);
    this.valley.update(lerpColor(lighting.ambient, lighting.haze, 0.45), lighting);
    this.ground.update(lerpColor(lighting.ambient, lighting.haze, 0.08), lighting);
    // By moonlight the trees go a deep teal, the distant ones paler and bluer.
    const foliage = lerpColor(lerpColor(lighting.ambient, DUSK_FOLIAGE, lighting.twilight * 0.65), NIGHT_FOLIAGE, lighting.nightness * 0.65);
    for (const tree of this.trees) {
      tree.sway.mesh.tint = lerpColor(foliage, lighting.haze, tree.haze);
      tree.sway.update(time, wind);
    }
    this.near.update(lighting.ambient, lighting);
    // The canopy and undergrowth sit in shade.
    const shade = scaleColor(foliage, 0.85);
    this.canopyLayer.tint = shade;
    this.fernLayer.tint = shade;

    for (const sway of this.canopy) sway.update(time, wind);
    for (const sway of this.ferns) sway.update(time * 1.3, wind);

    // Light shafts through the oak's leaves: strongest with a low, clear morning sun.
    const sun = lighting.sun;
    const clarity = (1 - weather.cloudCover) ** 2;
    const morning = lighting.hours > 6 && lighting.hours < 10 ? 1.4 : 1;
    const strength = sun.visible ? Math.sqrt(Math.max(0, sun.elevation)) * clarity * morning * 0.8 : 0;
    const fromLeft = sun.progress < 0.5;
    this.rays.forEach((ray, i) => {
      ray.scale.x = fromLeft ? 1 : -1;
      ray.x = fromLeft ? this.layout.gaps[i] : WORLD_WIDTH - this.layout.gaps[i];
      ray.alpha = Math.min(1, strength * (0.75 + 0.25 * Math.sin(time * 0.4 + i * 1.7)));
      ray.tint = sun.color;
    });

    this.updateLeaves(dt, env);
  }

  private updateLeaves(dt: number, env: Environment): void {
    const wind = env.weather.wind;
    const rate = 0.5 + 4 * Math.abs(wind);
    this.leafBudget += dt * rate;
    while (this.leafBudget >= 1 && this.leaves.length < 70) {
      this.leafBudget -= 1;
      const texture = this.leafTextures[Math.floor(this.rng() * this.leafTextures.length)];
      const particle = new Particle({ texture, x: 0, y: 0 });
      this.leafLayer.addParticle(particle);
      // Mostly from the oak's crown overhead, some from the trees on the clearing.
      const fromOak = this.rng() < 0.6;
      this.leaves.push({
        particle,
        x: fromOak ? this.rng() * 280 : 100 + this.rng() * 640,
        y: fromOak ? 10 + this.rng() * 50 : 80 + this.rng() * 80,
        vy: 7 + this.rng() * 8,
        phase: this.rng() * Math.PI * 2,
        floor: BROW_Y + 8 + this.rng() * 82,
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
