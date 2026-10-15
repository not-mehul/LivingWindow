import { Container, Graphics, Sprite } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { lerpColor, multiplyColor, scaleColor } from '../../core/color';
import { PixelCanvas } from '../../core/pixelTexture';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import type { Trunk } from '../forest/forestGenerator';
import { pixelHash } from '../../sprites/raster';
import { SwayMesh } from '../common/SwayMesh';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';

export const MEADOW_HORIZON = 222;
export const FAR_COWS_Y = 272;
export const NEAR_COWS_Y = 290;
export const BANK_Y = 302;
export const WATER_TOP = 306;
export const WATER_BOTTOM = 334;
export const COOP_X = 400;

const LEAVES = ['#3c6430', '#4e7a3e', '#5e8a44', '#6a9a4e', '#80ae5a'];

function hills(color: string, light: string, base: number, peak: number, seed: number): PixelCanvas {
  const c = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const top = Math.round(base - (base - peak) * (0.55 + 0.3 * Math.sin(x * 0.009 + seed) + 0.15 * Math.sin(x * 0.027 + seed * 2)));
    c.vline(x, top, WORLD_HEIGHT - top, color);
    c.px(x, top, light);
  }
  return c;
}

function blob(c: PixelCanvas, clumps: Array<[number, number, number]>, seed: number): void {
  for (const [cx, cy, r] of clumps) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - cy) / r;
        if (dx * dx + dy * dy > 1 - pixelHash(x, y, seed) * 0.25) continue;
        let shade = Math.min(4, Math.max(0, Math.round(2 - dy * 1.6)));
        if (pixelHash(x, y, seed + 1) < 0.12) shade = Math.max(0, shade - 1);
        c.px(x, y, LEAVES[shade]);
      }
    }
  }
}

function tuft(rng: () => number, flowers: boolean): PixelCanvas {
  const w = randomInt(rng, 10, 18);
  const h = randomInt(rng, 9, 16);
  const c = new PixelCanvas(w, h);
  const flowerColors = ['#f0e050', '#f0f0f0', '#e870a0', '#9a70e0', '#f09040'];
  for (let i = 0; i < randomInt(rng, 5, 9); i++) {
    const bx = w / 2 + randomRange(rng, -3, 3);
    const lean = randomRange(rng, -0.4, 0.4);
    const len = randomRange(rng, h * 0.5, h);
    for (let t = 0; t < len; t++) c.px(Math.round(bx + lean * t), h - 1 - t, t > len * 0.7 ? '#9ac060' : '#5a8a3a');
    if (flowers && rng() < 0.4) {
      const fx = Math.round(bx + lean * len);
      const fy = Math.round(h - 1 - len);
      c.px(fx, fy, flowerColors[randomInt(rng, 0, flowerColors.length - 1)]);
    }
  }
  return c;
}

/**
 * Scene 2: the meadows, from a farmhouse window. Rolling hills and a tree
 * line, a pasture of wildflowers for the cows, an old oak, a fence and a
 * hen house, and a clear stream seen side-on, so you can watch the fish.
 */
export class MeadowScene implements WorldScene {
  readonly container = new Container({ label: 'meadow-scene' });
  readonly sky = new Sky({ horizonY: MEADOW_HORIZON, seed: 4321 });
  readonly horizonY = MEADOW_HORIZON;
  readonly groundY = [262, BANK_Y] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  readonly cowsFar = new Container({ label: 'cows-far' });
  readonly cowsNear = new Container({ label: 'cows-near' });
  readonly yard = new Container({ label: 'yard' });
  readonly rabbitLayer = new Container({ label: 'rabbits' });
  /** Fish live in here; it is clipped to the water. */
  readonly underwater = new Container({ label: 'underwater' });
  readonly nightLayer = new Graphics();
  readonly ledges: Ledge[] = [];
  readonly trunks: Trunk[] = [];
  readonly bushes: Array<{ x: number; y: number; width: number }> = [];

  private readonly layers: Array<{ sprite: Sprite; haze: number }> = [];
  private readonly sways: Array<{ mesh: SwayMesh; speed: number }> = [];
  private readonly swayHaze = new Map<SwayMesh, number>();
  private readonly water: Sprite;
  private readonly surface = new Graphics();
  private readonly specks: Array<{ x: number; y: number; speed: number }> = [];
  private readonly bubbles: Array<{ x: number; y: number }> = [];

  constructor() {
    const rng = createRng(6060);
    const add = (canvas: PixelCanvas, haze: number) => {
      const sprite = new Sprite(canvas.toTexture());
      this.layers.push({ sprite, haze });
      return sprite;
    };
    const sway = (canvas: PixelCanvas, x: number, y: number, amplitude: number, haze: number, speed = 1) => {
      const mesh = new SwayMesh(canvas.toTexture(), { anchor: 'bottom', amplitude });
      mesh.mesh.position.set(Math.round(x), Math.round(y));
      this.sways.push({ mesh, speed });
      this.swayHaze.set(mesh, haze);
      return mesh.mesh;
    };

    const farHills = add(hills('#9ab4a0', '#aac4b0', 252, 208, 1), 0.6);
    const nearHills = add(hills('#7ea870', '#92bc80', 262, 232, 4), 0.35);

    // Tree line along the far edge of the pasture.
    const treeLine = new Container();
    const trunks = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    for (let x = 6; x < WORLD_WIDTH; x += randomInt(rng, 26, 52)) {
      const h = randomInt(rng, 14, 26);
      trunks.rect(x, 262 - h + 8, 2, h - 6, '#5a4a3a');
      const w = randomInt(rng, 18, 30);
      const crown = new PixelCanvas(w, h);
      blob(crown, [[w / 2, h * 0.55, w * 0.4], [w * 0.3, h * 0.65, w * 0.28], [w * 0.7, h * 0.62, w * 0.3]], x);
      treeLine.addChild(sway(crown, x + 1 - w / 2, 262 - h - 2, 1, 0.3, 0.8));
      this.ledges.push({ x0: x - 3, x1: x + 3, y: 262 - h, layer: 'far', kind: 'treetop', z: 0.88 });
    }
    const treeTrunks = add(trunks, 0.3);

    // The pasture, richer and more flowery towards the viewer.
    const pasture = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const flowerColors = ['#f0e050', '#f8f8f8', '#e870a0', '#9a70e0', '#f09040'];
    for (let y = 258; y < WORLD_HEIGHT; y++) {
      const t = (y - 258) / 50;
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const h = pixelHash(x, y, 71);
        let color = t < 0.3 ? '#8ab868' : t < 0.65 ? '#7aac58' : '#6a9e4a';
        if (h < 0.1) color = '#5a8e3e';
        else if (h > 0.93) color = '#9ac878';
        if (pixelHash(x, y, 72) < 0.006 + t * 0.02) color = flowerColors[Math.floor(pixelHash(x, y, 73) * flowerColors.length)];
        pasture.px(x, y, color);
      }
    }
    const pastureSprite = add(pasture, 0);
    this.ledges.push({ x0: 0, x1: WORLD_WIDTH - 1, y: 297, layer: 'near', kind: 'ground', z: 0.66 });

    // The old oak, with branches to perch on.
    const oak = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const ox = 140;
    for (let y = 150; y < 300; y++) {
      for (let x = ox; x < ox + 16; x++) {
        const u = (x - ox) / 16;
        let color = u < 0.25 ? '#7a6250' : u > 0.75 ? '#463628' : '#5e4a3a';
        if (pixelHash(Math.floor(x / 2), Math.floor(y / 4), 9) < 0.2) color = '#3a2c20';
        oak.px(x, y, color);
      }
    }
    oak.rect(ox - 4, 296, 24, 4, '#463628');
    for (const [bx, by, len] of [
      [ox + 16, 190, 26],
      [ox - 24, 210, 24],
    ] as const) {
      oak.rect(bx, by, len, 3, '#5e4a3a');
      oak.hline(bx, by, len, '#7a6250');
      this.ledges.push({ x0: bx + 2, x1: bx + len - 3, y: by, layer: 'near', kind: 'branch', z: 0.58 });
    }
    this.trunks.push({ x: ox + 8, width: 16, top: 160, bottom: 296, layer: 'near' });
    const oakSprite = add(oak, 0);
    const crown = new PixelCanvas(150, 100);
    blob(crown, [[75, 45, 40], [40, 60, 30], [110, 58, 32], [75, 72, 30], [55, 30, 26], [100, 32, 24]], 99);
    const oakCrown = sway(crown, ox + 8 - 75, 100, 2.5, 0, 0.8);

    // Fence, gate posts and the hen house.
    const props = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    for (let x = 470; x < WORLD_WIDTH; x += 28) {
      props.rect(x, 276, 3, 22, '#8a7050');
      props.vline(x, 276, 22, '#a88a64');
      props.hline(x, 276, 3, '#c0a27a');
      this.ledges.push({ x0: x, x1: x + 2, y: 276, layer: 'near', kind: 'post', z: 0.64 });
    }
    for (const ry of [282, 290]) {
      props.rect(470, ry, WORLD_WIDTH - 470, 2, '#9a7e58');
      props.hline(470, ry, WORLD_WIDTH - 470, '#b49670');
    }
    // Hen house: a little shed with a ramp.
    const cx = COOP_X;
    props.rect(cx, 282, 30, 16, '#a8483a');
    props.rect(cx, 282, 30, 1, '#c8604c');
    for (let i = 0; i < 18; i++) props.hline(cx - 3 + Math.floor(i / 2), 281 - i / 2 - 1, 36 - i, '#5a4a3a');
    props.rect(cx + 11, 290, 7, 8, '#2a1a14');
    for (let i = 0; i < 8; i++) props.px(cx + 18 + i, 297 - Math.floor(i / 2), '#8a7050');
    this.ledges.push({ x0: cx + 2, x1: cx + 26, y: 272, layer: 'near', kind: 'roof', z: 0.64 });
    const propsSprite = add(props, 0);

    // Bushes the rabbits hide behind.
    const bushLayer = new Container();
    for (const bx of [235, 300, 590, 700]) {
      const w = randomInt(rng, 26, 36);
      const h = randomInt(rng, 14, 20);
      const c = new PixelCanvas(w, h);
      blob(c, [[w / 2, h * 0.6, w * 0.38], [w * 0.28, h * 0.72, w * 0.26], [w * 0.72, h * 0.7, w * 0.28]], bx);
      bushLayer.addChild(sway(c, bx - w / 2, BANK_Y + 1 - h, 1, 0, 1));
      this.bushes.push({ x: bx, y: BANK_Y, width: w });
    }

    // The stream, side on: water, a pebbly bed and swaying weed.
    const stream = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    stream.rect(0, BANK_Y, WORLD_WIDTH, 4, '#6a5a3a');
    for (let x = 0; x < WORLD_WIDTH; x++) {
      stream.px(x, BANK_Y, pixelHash(x, 1, 3) < 0.5 ? '#5a8e3e' : '#4a7a34');
      for (let y = WATER_TOP; y < WATER_BOTTOM; y++) {
        const t = (y - WATER_TOP) / (WATER_BOTTOM - WATER_TOP);
        stream.px(x, y, t < 0.15 ? '#6ab0c0' : t < 0.6 ? '#4a96aa' : '#3a7a8e');
      }
      for (let y = WATER_BOTTOM; y < WORLD_HEIGHT; y++) {
        const h = pixelHash(x, y, 51);
        stream.px(x, y, y < WATER_BOTTOM + 4 ? (h < 0.3 ? '#8a8070' : h < 0.55 ? '#a89a84' : '#6a6050') : h < 0.5 ? '#5a8e3e' : '#4a7a34');
      }
      // Pebbles on the bed.
      if (pixelHash(x, 7, 8) < 0.12) stream.rect(x, WATER_BOTTOM - 2, 2 + Math.floor(pixelHash(x, 8, 2) * 3), 2, '#9a8e7a');
    }
    this.water = add(stream, 0);
    const weed = new Container();
    for (let x = 10; x < WORLD_WIDTH; x += randomInt(rng, 30, 70)) {
      const h = randomInt(rng, 8, 16);
      const c = new PixelCanvas(5, h);
      for (let i = 0; i < 3; i++) {
        for (let t = 0; t < h - i * 2; t++) c.px(1 + i + Math.round(Math.sin(t * 0.5 + i) * 0.6), h - 1 - t, i === 1 ? '#4a8a4a' : '#3a6a3a');
      }
      weed.addChild(sway(c, x, WATER_BOTTOM - h, 2, 0, 0.6));
    }
    const waterMask = new Graphics().rect(0, WATER_TOP, WORLD_WIDTH, WATER_BOTTOM - WATER_TOP).fill(0xffffff);
    this.underwater.mask = waterMask;

    // Reeds and wildflowers along both banks.
    const front = new Container();
    for (let x = 0; x < WORLD_WIDTH; x += randomInt(rng, 16, 34)) {
      const c = tuft(rng, true);
      front.addChild(sway(c, x - c.width / 2, BANK_Y + 2 - c.height, 2, 0, 1.4));
    }
    for (let x = 0; x < WORLD_WIDTH; x += randomInt(rng, 14, 28)) {
      const c = tuft(rng, true);
      front.addChild(sway(c, x - c.width / 2, WATER_BOTTOM + 14 - c.height, 2.5, 0, 1.4));
    }

    for (let i = 0; i < 40; i++) {
      this.specks.push({ x: rng() * WORLD_WIDTH, y: WATER_TOP + 2 + rng() * (WATER_BOTTOM - WATER_TOP - 4), speed: 8 + rng() * 10 });
    }

    this.container.addChild(
      this.sky.container,
      farHills,
      nearHills,
      treeTrunks,
      treeLine,
      this.birdsFar,
      pastureSprite,
      this.cowsFar,
      this.birdsMid,
      this.weatherBack,
      this.cowsNear,
      oakSprite,
      oakCrown,
      propsSprite,
      this.yard,
      this.rabbitLayer,
      bushLayer,
      this.birdsNear,
      this.water,
      weed,
      this.underwater,
      waterMask,
      this.surface,
      front,
      this.nightLayer,
      this.weatherFront,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.sky.update(dt, env);
    for (const { sprite, haze } of this.layers) sprite.tint = lerpColor(lighting.ambient, lighting.haze, haze);
    for (const { mesh, speed } of this.sways) {
      mesh.update(time * speed, weather.wind);
      mesh.mesh.tint = lerpColor(lighting.ambient, lighting.haze, this.swayHaze.get(mesh) ?? 0);
    }
    this.underwater.tint = lighting.ambient;

    // The stream: sparkling ripples on the surface, drifting specks, bubbles.
    const g = this.surface;
    g.clear();
    const highlight = lerpColor(multiplyColor(0xd8f0f4, lighting.ambient), 0xffffff, 0.15);
    const flow = time * 12;
    for (let x = 0; x < WORLD_WIDTH; x += 2) {
      const wobble = Math.sin((x + flow) * 0.15) + Math.sin((x - flow * 0.6) * 0.07);
      if (wobble > 1.1) g.rect(x, WATER_TOP, 2, 1).fill({ color: highlight, alpha: 0.9 });
      else if (wobble < -1.3) g.rect(x, WATER_TOP + 1, 2, 1).fill({ color: scaleColor(highlight, 0.8), alpha: 0.5 });
    }
    const speck = multiplyColor(0xa8c8c8, lighting.ambient);
    for (const s of this.specks) {
      s.x += s.speed * dt;
      s.y += Math.sin(time + s.x * 0.1) * 0.05;
      if (s.x > WORLD_WIDTH) s.x -= WORLD_WIDTH;
      g.rect(Math.round(s.x), Math.round(s.y), 1, 1).fill({ color: speck, alpha: 0.5 });
    }
    if (Math.random() < dt * 0.8) this.bubbles.push({ x: Math.random() * WORLD_WIDTH, y: WATER_BOTTOM - 3 });
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.y -= 9 * dt;
      b.x += Math.sin(b.y * 0.6) * 0.1;
      if (b.y <= WATER_TOP + 1) {
        this.bubbles.splice(i, 1);
        continue;
      }
      g.rect(Math.round(b.x), Math.round(b.y), 1, 1).fill({ color: highlight, alpha: 0.8 });
    }
  }
}
