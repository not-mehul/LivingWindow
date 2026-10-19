import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor, multiplyColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { quality } from '../../core/quality';
import type { Ledge } from '../../life/types';
import type { GroundPlane } from '../../sim/groundPlane';
import type { WalkArea } from '../../sim/groundWalker';
import { MEADOW_HORIZON, meadowCreek, meadowPlane, shadowCast } from '../../sim/meadowGeometry';
import { pixelHash } from '../../sprites/raster';
import { bayer } from '../common/paint';
import { DayNightSprite, type NightGrade } from '../common/night';
import { SwayMesh } from '../common/SwayMesh';
import { drawRotor } from './farmstead';
import type { Environment } from '../Environment';
import type { Trunk } from '../forest/forestGenerator';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateMeadow, type MeadowLayout, type MeadowOak } from './meadowGenerator';
import { clamp01 } from '../../core/math';
import { hazeTint } from '../lighting';

export { MEADOW_HORIZON };

/** Moonlit grades for the meadow's layers, after the night drawing. */
const NIGHT: Record<'hills' | 'trees' | 'pasture', NightGrade> = {
  hills: { desaturate: 0.6, tint: [0.42, 0.46, 0.7], lift: [10, 12, 30] },
  trees: { desaturate: 0.5, tint: [0.32, 0.4, 0.58], lift: [6, 8, 20] },
  // The grass goes a deep moonlit blue, the path and bare earth a dusky lavender.
  pasture: { desaturate: 0.72, tint: [0.3, 0.34, 0.56], lift: [8, 10, 24] },
};
const NIGHT_TREES = 0x3e5078;

/** Dusk and dawn, after the drawing: soft, muted greens under a pink sky, the distance going blue. */
const DUSK: typeof NIGHT = {
  hills: { desaturate: 0.45, tint: [0.66, 0.7, 0.86], lift: [8, 8, 20] },
  trees: { desaturate: 0.35, tint: [0.66, 0.74, 0.8], lift: [6, 6, 16] },
  pasture: { desaturate: 0.3, tint: [0.76, 0.76, 0.84], lift: [4, 4, 12] },
};
const NIGHT_FLOWERS = 0x8088bc;

/** Rebuild the creek's surface at this rate. */
const CREEK_FPS = 15;
/** Sun directions the oak shadows are drawn for. */
const SHADOW_STEPS = 9;

const ROTOR_FRAMES = 6;
/** The haze the far farm is seen through (as the generator's). */
const HAZE_FARM = 0xc4d8dc;

/** Where the cows graze: the pasture from just beyond the flowers out to the tree line. */
export const PASTURE: WalkArea = { minDepth: 1.3, maxDepth: 3.6, halfWidth: (d) => meadowPlane.halfWidthAt(d) };

interface Swaying {
  sway: SwayMesh;
  haze: number;
  speed: number;
}

/**
 * Scene 2: the meadows, after the reference drawing. Big field oaks on the
 * left throw shadows that swing round with the sun; a two-track path winds
 * away over a rise to the tree line; a creek meanders across the right past
 * the hen house and the hedge; wildflowers nod right in front of the window.
 */
export class MeadowScene implements WorldScene {
  readonly container = new Container({ label: 'meadow-scene' });
  readonly sky = new Sky({ horizonY: MEADOW_HORIZON, seed: 4321, moonPhase: 'crescent', constellations: true });
  readonly horizonY = MEADOW_HORIZON;
  readonly groundY = [MEADOW_HORIZON + 8, 340] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  readonly plane: GroundPlane = meadowPlane;
  readonly pasture = PASTURE;
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  /** Oaks, the hen house, bushes, cows, hens and rabbits, sorted by where they stand. */
  readonly midground = new Container({ label: 'midground', sortableChildren: true });
  /** Fish in the creek (seen from above). */
  readonly creekLife = new Container({ label: 'creek-life' });
  readonly nightLayer = new Graphics();
  /** Effects lying on the grass under everything standing on it (the wind through it). */
  readonly groundFx = new Container({ label: 'ground-fx' });
  /** Things down among the wildflowers in front (a hedgehog), half hidden by them. */
  readonly bankLife = new Container({ label: 'bank-life' });
  /** Bees and butterflies over the wildflowers. */
  readonly frontLife = new Container({ label: 'front-life' });
  readonly layout: MeadowLayout;
  readonly ledges: Ledge[];
  readonly trunks: Trunk[];
  readonly bushes: MeadowLayout['bushes'];

  private readonly hills: DayNightSprite;
  private readonly treeLine: DayNightSprite;
  private readonly ground: DayNightSprite;
  private readonly swaying: Swaying[] = [];
  private readonly still: Array<{ sprite: Sprite; haze: number }> = [];
  private readonly flowerLayer = new Container({ label: 'flowers' });
  private readonly flowerSways: SwayMesh[] = [];
  private readonly shadowLayer = new Container({ label: 'oak-shadows' });
  private readonly shadows: Array<{ oak: MeadowOak; sprite: Sprite; textures: Map<number, Texture> }> = [];

  private readonly creekCanvas: PixelCanvas;
  private readonly creekImage: ImageData;
  private readonly creekTexture: Texture;
  private readonly creekSprite: Sprite;
  /** Each creek pixel's offset into the creek canvas's image data. */
  private readonly creekOffset: Int32Array;
  /** Each creek pixel's ordered-dither threshold. */
  private readonly creekDither: Float32Array;
  private creekTimer = 0;
  /** The farm's wind pump: its rotor, turning with the wind. */
  private readonly rotor = new Sprite({ anchor: 0.5 });
  private readonly rotorFrames: Texture[];
  private rotorAngle = 0;

  constructor() {
    this.layout = generateMeadow();
    const layout = this.layout;
    this.ledges = layout.ledges;
    this.trunks = layout.trunks;
    this.bushes = layout.bushes;
    this.hills = new DayNightSprite(layout.hills, NIGHT.hills, DUSK.hills);
    this.treeLine = new DayNightSprite(layout.treeLine, NIGHT.trees, DUSK.trees);
    this.ground = new DayNightSprite(layout.ground, NIGHT.pasture, DUSK.pasture);

    for (const oak of layout.oaks) {
      const sway = new SwayMesh(oak.art.toTexture(), { anchor: 'bottom', amplitude: oak.sway, frequency: 0.7 });
      sway.mesh.position.set(oak.x, oak.y);
      sway.mesh.zIndex = oak.baseY;
      this.midground.addChild(sway.mesh);
      this.swaying.push({ sway, haze: oak.haze, speed: 1 });
      const sprite = new Sprite();
      sprite.alpha = 0;
      this.shadowLayer.addChild(sprite);
      this.shadows.push({ oak, sprite, textures: new Map() });
    }
    for (const piece of layout.standing) {
      if (piece.sway > 0) {
        const sway = new SwayMesh(piece.art.toTexture(), { anchor: 'bottom', amplitude: piece.sway });
        sway.mesh.position.set(piece.x, piece.y);
        sway.mesh.zIndex = piece.baseY;
        this.midground.addChild(sway.mesh);
        this.swaying.push({ sway, haze: piece.haze, speed: 1.3 });
      } else {
        const sprite = new Sprite(piece.art.toTexture());
        sprite.position.set(piece.x, piece.y);
        sprite.zIndex = piece.baseY;
        this.midground.addChild(sprite);
        this.still.push({ sprite, haze: piece.haze });
      }
    }
    for (const flower of layout.flowers) {
      const sway = new SwayMesh(flower.art.toTexture(), { anchor: 'bottom', amplitude: flower.sway, frequency: 1.2 + Math.random() * 0.5 });
      sway.mesh.position.set(flower.x, flower.y);
      this.flowerLayer.addChild(sway.mesh);
      this.flowerSways.push(sway);
    }

    const mill = layout.farm.windmill;
    this.rotorFrames = Array.from({ length: ROTOR_FRAMES }, (_, f) => drawRotor(mill.radius, f, ROTOR_FRAMES, (c) => lerpColor(c, HAZE_FARM, mill.haze * 0.85)).toTexture());
    this.rotor.texture = this.rotorFrames[0];
    this.rotor.position.set(mill.x, mill.y);
    this.rotor.zIndex = mill.baseY + 0.1;
    this.midground.addChild(this.rotor);
    this.still.push({ sprite: this.rotor, haze: 0 });

    // The creek's surface lives in a canvas just big enough for it.
    const { index } = layout.creek;
    let minX = WORLD_WIDTH;
    let maxX = 0;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = 0;
    for (const i of index) {
      const x = i % WORLD_WIDTH;
      const y = Math.floor(i / WORLD_WIDTH);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const w = Math.max(1, maxX - minX + 1);
    const h = Math.max(1, maxY - minY + 1);
    this.creekCanvas = new PixelCanvas(w, h);
    this.creekImage = this.creekCanvas.ctx.createImageData(w, h);
    this.creekOffset = Int32Array.from(index, (i) => ((Math.floor(i / WORLD_WIDTH) - minY) * w + (i % WORLD_WIDTH) - minX) * 4);
    this.creekDither = Float32Array.from(index, (i) => bayer(i % WORLD_WIDTH, Math.floor(i / WORLD_WIDTH)));
    this.creekTexture = createNearestTexture(this.creekCanvas.canvas);
    this.creekSprite = new Sprite(this.creekTexture);
    this.creekSprite.position.set(minX, minY);

    this.container.addChild(
      this.sky.container,
      this.hills.container,
      this.birdsFar,
      this.ground.container,
      this.treeLine.container,
      this.creekSprite,
      this.creekLife,
      this.shadowLayer,
      this.groundFx,
      this.weatherBack,
      this.midground,
      this.birdsMid,
      this.birdsNear,
      this.bankLife,
      this.flowerLayer,
      this.frontLife,
      this.nightLayer,
      this.weatherFront,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.sky.update(dt, env);
    this.hills.update(lerpColor(lighting.haze, lighting.ambient, 0.35), lighting);
    this.treeLine.update(hazeTint(lighting, 0.2), lighting);
    this.ground.update(lighting.ambient, lighting);
    // By moonlight the oaks and hedges go a deep blue-green; the flowers keep a hint of their colour.
    const plants = lerpColor(lighting.ambient, NIGHT_TREES, lighting.nightness * 0.9);
    for (const s of this.swaying) {
      s.sway.update(time * s.speed, weather.wind);
      s.sway.mesh.tint = lerpColor(plants, lighting.haze, s.haze);
    }
    for (const s of this.still) s.sprite.tint = hazeTint(lighting, s.haze);
    for (const f of this.flowerSways) f.update(time * 1.3, weather.wind);
    // The wind pump turns lazily in a breeze and spins in a gale; it barely creeps when it's calm.
    this.rotorAngle += dt * (0.25 + Math.min(1.5, Math.abs(weather.wind)) * 3.2);
    this.rotor.texture = this.rotorFrames[Math.floor((this.rotorAngle / ((Math.PI * 2) / 14)) * ROTOR_FRAMES) % ROTOR_FRAMES];
    this.flowerLayer.tint = lerpColor(lighting.ambient, NIGHT_FLOWERS, lighting.nightness * 0.8);
    this.creekLife.tint = lighting.ambient;
    this.updateShadows(env);

    this.creekTimer -= dt;
    if (this.creekTimer <= 0) {
      this.creekTimer = 1 / (CREEK_FPS * quality.scale);
      this.drawCreek(env);
    }
  }

  /** The oaks' shadows: thrown away from the sun (or, fainter, the moon), longer when it is low, gone under cloud. */
  private updateShadows(env: Environment): void {
    const { sun, moon, nightness, moonlight } = env.lighting;
    const clear = (1 - env.weather.cloudCover) ** 1.5;
    const byMoon = !sun.visible && moon.visible;
    const body = byMoon ? moon : sun;
    const strength = body.visible ? Math.min(1, body.elevation * 4) * clear * (byMoon ? 0.9 * nightness * moonlight : 1) : 0;
    const step = Math.round((clamp01(body.progress) - 0.5) * (SHADOW_STEPS - 1));
    const progress = 0.5 + step / (SHADOW_STEPS - 1);
    const cast = shadowCast(progress, Math.max(0.2, body.elevation));
    for (const s of this.shadows) {
      s.sprite.alpha = strength * 0.42;
      if (strength <= 0) continue;
      let texture = s.textures.get(step);
      if (!texture) {
        texture = drawShadow(s.oak, cast.stretch);
        s.textures.set(step, texture);
      }
      s.sprite.texture = texture;
      const r = s.oak.crownRadius;
      s.sprite.position.set(Math.round(s.oak.crownX + cast.shift * r - texture.width / 2), Math.round(s.oak.baseY - texture.height * 0.55));
    }
  }

  /** The creek: sky-tinted water, ripples flowing towards us, and sun glints. */
  private drawCreek(env: Environment): void {
    const { lighting, time } = env;
    const amb = lighting.ambient;
    const deep = lerpColor(multiplyColor(0x2e5a5e, amb), lighting.skyTop, 0.25);
    const sky = lerpColor(lighting.skyHorizon, lighting.skyTop, 0.4);
    const shallow = lerpColor(multiplyColor(0x5a8a7a, amb), sky, 0.45);
    const ripple = lerpColor(sky, 0xffffff, 0.3);
    const sun = lighting.sun.visible && lighting.sun.elevation > 0.05 ? lerpColor(lighting.sun.color, 0xffffff, 0.5) : 0;
    const shades = [deep, lerpColor(deep, shallow, 0.5), shallow, lerpColor(shallow, sky, 0.5)];
    const { along, across, nearness } = this.layout.creek;
    const half = meadowCreek.halfWidth;
    const data = this.creekImage.data;
    const flow = time * 30;
    const rain = env.weather.kind === 'rain' ? env.weather.precipitation : 0;
    for (let i = 0; i < this.creekOffset.length; i++) {
      const k = this.creekOffset[i];
      const u = across[i] / half;
      const a = along[i];
      // Deeper down the middle, paler where the banks shelve and reflect the sky.
      let level = 1 - Math.abs(u) * 1.6 + Math.sin(a * 0.02 + u * 3) * 0.2;
      const px = k >> 2;
      level = 3 - level * 3 + this.creekDither[i] * 0.8;
      let color = shades[Math.max(0, Math.min(3, Math.floor(level)))];
      // Ripples streaming down towards us.
      const w = Math.sin((a + flow) * 0.09 + Math.sin(u * 2.5 + a * 0.01) * 2);
      if (w > 0.93) color = ripple;
      // Raindrop rings.
      if (rain > 0 && pixelHash(px, Math.floor(time * 8), 7) < rain * 0.02) color = ripple;
      // Glints of sun dancing on the surface.
      if (sun && pixelHash(px, Math.floor((a + flow) / 6), 3) > 0.985 - nearness[i] * 0.01) color = sun;
      data[k] = color >> 16;
      data[k + 1] = (color >> 8) & 255;
      data[k + 2] = color & 255;
      data[k + 3] = 255;
    }
    this.creekCanvas.ctx.putImageData(this.creekImage, 0, 0);
    this.creekTexture.source.update();
  }
}

/** A tree's shadow on the grass: a dithered pool the shape of its crown, stretched by a low sun. */
function drawShadow(oak: MeadowOak, stretch: number): Texture {
  const r = oak.crownRadius;
  const rx = r * 0.95 * stretch;
  // Lying on the ground, it is squashed by the view's foreshortening.
  const ry = r * 0.3;
  const w = Math.ceil(rx * 2) + 4;
  const h = Math.ceil(ry * 2) + 4;
  const p = new PixelBuffer(w, h);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      // Lumpy, like the crown's clumps.
      const d = dx * dx + dy * dy + (pixelHash(Math.floor(x / 3), Math.floor(y / 2), 5) - 0.5) * 0.3;
      if (d > 1) continue;
      // A dithered, softer rim.
      if (d > 0.75 && bayer(x, y) > 0.5) continue;
      p.set(x, y, 0x1a2a10);
    }
  }
  return p.toTexture();
}
