import { Container, Sprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import { createNearestTexture, PixelCanvas } from '../core/pixelTexture';
import { createRng, randomInt, randomRange } from '../core/random';

/**
 * A procedurally drawn stand-in for Scene 1 (Downtown City Rooftop) so the
 * viewport, frame and panning can be exercised before real art exists.
 * Step 4 replaces this with the hand-polished, layered scene.
 */

const SKY_BANDS = ['#2a2850', '#3d3570', '#5c4589', '#8a5a9c', '#c4729a', '#ec9a7c', '#f7c27e', '#fbe0a0'];
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const HORIZON_Y = 286;
const STREET_Y = 328;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Banded sky with ordered dithering between bands, plus a low sun. */
function drawSky(c: PixelCanvas): void {
  const { width, height } = c;
  const image = c.ctx.createImageData(width, height);
  const bands = SKY_BANDS.map(hexToRgb);
  const skyHeight = HORIZON_Y + 10;
  for (let y = 0; y < height; y++) {
    const t = Math.min(0.9999, y / skyHeight) * (bands.length - 1);
    const index = Math.floor(t);
    const frac = t - index;
    for (let x = 0; x < width; x++) {
      const threshold = (BAYER_4[y & 3][x & 3] + 0.5) / 16;
      const [r, g, b] = bands[frac > threshold ? Math.min(index + 1, bands.length - 1) : index];
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  c.ctx.putImageData(image, 0, 0);

  // Sun sitting low between the towers.
  const sunX = 520;
  const sunY = 238;
  for (let dy = -16; dy <= 16; dy++) {
    for (let dx = -16; dx <= 16; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= 13) c.px(sunX + dx, sunY + dy, d < 10 ? '#fff4c8' : '#ffe39a');
      else if (d <= 16 && ((dx + dy) & 1) === 0) c.px(sunX + dx, sunY + dy, '#fcd28a');
    }
  }
}

interface BuildingStyle {
  body: string;
  edge: string;
  window: string;
  lit: string;
  litChance: number;
}

function drawBuilding(
  c: PixelCanvas,
  rng: () => number,
  x: number,
  top: number,
  width: number,
  bottom: number,
  style: BuildingStyle,
): void {
  c.rect(x, top, width, bottom - top, style.body);
  c.vline(x + width - 1, top, bottom - top, style.edge);
  c.hline(x, top, width, style.edge);

  // Rooftop clutter: water towers, antennas, parapets.
  const roof = rng();
  if (roof < 0.25 && width > 18) {
    const tx = x + randomInt(rng, 3, width - 12);
    c.rect(tx, top - 9, 8, 6, style.edge);
    c.rect(tx + 1, top - 3, 1, 3, style.edge);
    c.rect(tx + 6, top - 3, 1, 3, style.edge);
    c.rect(tx - 1, top - 10, 10, 1, style.body);
  } else if (roof < 0.5) {
    const ax = x + randomInt(rng, 2, Math.max(2, width - 3));
    c.vline(ax, top - randomInt(rng, 8, 18), 18, style.edge);
  } else if (roof < 0.7 && width > 10) {
    c.rect(x + 2, top - 3, width - 4, 3, style.body);
  }

  // Window grid.
  const cols = Math.max(1, Math.floor((width - 4) / 5));
  const offsetX = x + Math.floor((width - cols * 5 + 2) / 2);
  for (let wy = top + 5; wy < bottom - 5; wy += 6) {
    for (let col = 0; col < cols; col++) {
      const lit = rng() < style.litChance;
      c.rect(offsetX + col * 5, wy, 3, 3, lit ? style.lit : style.window);
    }
  }
}

function drawSkyline(c: PixelCanvas, rng: () => number): void {
  const far: BuildingStyle = {
    body: '#5b4a7e',
    edge: '#6c5a90',
    window: '#544475',
    lit: '#9f86b8',
    litChance: 0.1,
  };
  const mid: BuildingStyle = {
    body: '#3a2e55',
    edge: '#4a3c68',
    window: '#2f2546',
    lit: '#f2c46e',
    litChance: 0.18,
  };
  const near: BuildingStyle = {
    body: '#241c36',
    edge: '#32284a',
    window: '#1c162b',
    lit: '#ffd27a',
    litChance: 0.24,
  };

  for (let x = -10; x < WORLD_WIDTH + 10; ) {
    const w = randomInt(rng, 14, 30);
    drawBuilding(c, rng, x, randomInt(rng, 150, 230), w, STREET_Y, far);
    x += w + randomInt(rng, -4, 3);
  }
  for (let x = -20; x < WORLD_WIDTH + 20; ) {
    const w = randomInt(rng, 22, 44);
    drawBuilding(c, rng, x, randomInt(rng, 120, 250), w, STREET_Y, mid);
    x += w + randomInt(rng, 4, 16);
  }
  // A few tall foreground towers spread across the panorama as landmarks.
  for (const [x, w, top] of [
    [24, 54, 92],
    [196, 46, 140],
    [352, 38, 70],
    [612, 58, 112],
    [760, 50, 150],
  ] as const) {
    drawBuilding(c, rng, x, top + randomInt(rng, -6, 6), w, STREET_Y, near);
  }
}

function drawStreet(c: PixelCanvas, rng: () => number): void {
  c.rect(0, STREET_Y, WORLD_WIDTH, 4, '#4a4256'); // sidewalk
  c.hline(0, STREET_Y, WORLD_WIDTH, '#625877');
  c.rect(0, STREET_Y + 4, WORLD_WIDTH, WORLD_HEIGHT - STREET_Y - 4, '#2a2433'); // road
  for (let x = 6; x < WORLD_WIDTH; x += 22) c.hline(x, STREET_Y + 16, 10, '#8e826a');
  c.rect(0, STREET_Y + 28, WORLD_WIDTH, 4, '#4a4256'); // far sidewalk
  // Street lamps.
  for (let x = 30; x < WORLD_WIDTH; x += randomInt(rng, 70, 110)) {
    c.vline(x, STREET_Y - 18, 18, '#1b1626');
    c.hline(x, STREET_Y - 18, 4, '#1b1626');
    c.rect(x + 3, STREET_Y - 17, 2, 1, '#ffe7a8');
  }
}

function createSkyTexture(): Texture {
  const c = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  drawSky(c);
  return createNearestTexture(c.canvas);
}

function createCityTexture(): Texture {
  const c = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  const rng = createRng(20261015);
  drawSkyline(c, rng);
  drawStreet(c, rng);
  return createNearestTexture(c.canvas);
}

function createCloudTexture(rng: () => number): Texture {
  const w = randomInt(rng, 34, 64);
  const h = 14;
  const c = new PixelCanvas(w, h);
  const puffs = randomInt(rng, 3, 5);
  for (let i = 0; i < puffs; i++) {
    const cx = ((i + 0.5) / puffs) * w;
    const r = randomRange(rng, 4, 7);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / (r * 1.6);
        const dy = (y - (h - r)) / r;
        if (dx * dx + dy * dy <= 1) c.px(x, y, y < h - r ? '#ffd6c2' : '#e8a6a8');
      }
    }
  }
  c.hline(2, h - 1, w - 4, '#c98896');
  return c.toTexture();
}

interface Cloud {
  sprite: Sprite;
  speed: number;
}

export class PlaceholderCityScene {
  readonly container = new Container({ label: 'placeholder-city' });
  private readonly clouds: Cloud[] = [];

  constructor() {
    const rng = createRng(77);
    const cloudLayer = new Container({ label: 'clouds' });
    for (let i = 0; i < 7; i++) {
      const sprite = new Sprite(createCloudTexture(rng));
      sprite.position.set(randomRange(rng, 0, WORLD_WIDTH), randomInt(rng, 24, 130));
      sprite.alpha = randomRange(rng, 0.65, 0.95);
      this.clouds.push({ sprite, speed: randomRange(rng, 1.5, 4.5) });
      cloudLayer.addChild(sprite);
    }
    // Sky → drifting clouds → skyline, so clouds pass behind the towers.
    this.container.addChild(new Sprite(createSkyTexture()), cloudLayer, new Sprite(createCityTexture()));
  }

  update(deltaSeconds: number): void {
    for (const cloud of this.clouds) {
      const { sprite } = cloud;
      sprite.x += cloud.speed * deltaSeconds;
      if (sprite.x > WORLD_WIDTH + 10) sprite.x = -sprite.width - 10;
    }
  }
}
