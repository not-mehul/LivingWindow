import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { PixelCanvas } from '../../core/pixelTexture';
import { createRng, randomInt } from '../../core/random';

/**
 * Procedurally generates the placeholder downtown skyline as separate depth
 * layers. Art is authored in full daylight colours; the lighting system
 * multiplies each layer by a tint for the time of day and weather.
 */

export const HORIZON_Y = 286;
export const STREET_Y = 328;

export type CityLayerName = 'far' | 'mid' | 'near';

export interface WindowRecord {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CityLayer {
  name: CityLayerName;
  canvas: PixelCanvas;
  /** Windows that remain visible (not hidden behind a later building). */
  windows: WindowRecord[];
}

export interface CityLayout {
  layers: CityLayer[];
  lamps: Array<{ x: number; y: number }>;
}

interface LayerStyle {
  bodies: readonly string[];
  window: string;
  windowSize: number;
  windowPitch: number;
}

const STYLES: Record<CityLayerName, LayerStyle> = {
  far: { bodies: ['#a9b4c6', '#b1b7c4', '#9eabc0', '#a6aec0'], window: '#8e9cb2', windowSize: 2, windowPitch: 4 },
  mid: { bodies: ['#7c8396', '#8a807c', '#6f7c8c', '#857c8e', '#7a8a8e'], window: '#566276', windowSize: 3, windowPitch: 5 },
  near: { bodies: ['#5a5e6e', '#6a5450', '#4e5a66', '#5e5668', '#585650'], window: '#3a4256', windowSize: 3, windowPitch: 5 },
};

function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

class LayerBuilder {
  readonly canvas = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  /** Which building last painted each pixel, to drop windows that end up hidden. */
  private readonly owner = new Int32Array(WORLD_WIDTH * WORLD_HEIGHT).fill(-1);
  private readonly candidates: Array<WindowRecord & { id: number }> = [];
  private nextId = 0;

  constructor(
    private readonly style: LayerStyle,
    private readonly rng: () => number,
  ) {}

  building(x: number, top: number, width: number, bottom: number): void {
    const { rng, style, canvas: c } = this;
    const id = this.nextId++;
    const body = style.bodies[randomInt(rng, 0, style.bodies.length - 1)];
    const lit = shade(body, 1.12);
    const dark = shade(body, 0.82);

    c.rect(x, top, width, bottom - top, body);
    c.vline(x, top, bottom - top, lit); // sunlit edge
    c.vline(x + width - 1, top, bottom - top, dark);
    c.hline(x, top, width, lit);
    this.claim(x, top, width, bottom - top, id);

    // Rooftop clutter: water towers, antennas, parapets.
    const roof = rng();
    if (roof < 0.25 && width > 18) {
      const tx = x + randomInt(rng, 3, width - 12);
      c.rect(tx, top - 9, 8, 6, dark);
      c.rect(tx + 1, top - 9, 2, 6, body);
      c.rect(tx + 1, top - 3, 1, 3, dark);
      c.rect(tx + 6, top - 3, 1, 3, dark);
      c.rect(tx - 1, top - 10, 10, 1, lit);
      this.claim(tx - 1, top - 10, 10, 10, id);
    } else if (roof < 0.5) {
      const ax = x + randomInt(rng, 2, Math.max(2, width - 3));
      const h = randomInt(rng, 8, 18);
      c.vline(ax, top - h, h, dark);
      this.claim(ax, top - h, 1, h, id);
    } else if (roof < 0.7 && width > 10) {
      c.rect(x + 2, top - 3, width - 4, 3, body);
      c.hline(x + 2, top - 3, width - 4, lit);
      this.claim(x + 2, top - 3, width - 4, 3, id);
    }

    // Window grid, with the occasional horizontal floor band.
    const { windowSize: size, windowPitch: pitch } = style;
    const cols = Math.max(1, Math.floor((width - 3) / pitch));
    const offsetX = x + Math.floor((width - cols * pitch + (pitch - size)) / 2);
    let floor = 0;
    for (let wy = top + 4; wy < bottom - 4; wy += pitch + 1) {
      if (++floor % 6 === 0) {
        c.hline(x, wy - 1, width, dark);
        continue;
      }
      for (let col = 0; col < cols; col++) {
        const wx = offsetX + col * pitch;
        c.rect(wx, wy, size, size, style.window);
        this.candidates.push({ x: wx, y: wy, w: size, h: size, id });
      }
    }
  }

  build(name: CityLayerName): CityLayer {
    const windows = this.candidates
      .filter((w) => this.owner[(w.y + 1) * WORLD_WIDTH + w.x + 1] === w.id)
      .map(({ x, y, w, h }) => ({ x, y, w, h }));
    return { name, canvas: this.canvas, windows };
  }

  private claim(x: number, y: number, w: number, h: number, id: number): void {
    for (let yy = Math.max(0, y); yy < Math.min(WORLD_HEIGHT, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(WORLD_WIDTH, x + w); xx++) {
        this.owner[yy * WORLD_WIDTH + xx] = id;
      }
    }
  }
}

function drawStreet(c: PixelCanvas, rng: () => number): Array<{ x: number; y: number }> {
  c.rect(0, STREET_Y, WORLD_WIDTH, 4, '#8a8690'); // sidewalk
  c.hline(0, STREET_Y, WORLD_WIDTH, '#a6a2aa');
  c.rect(0, STREET_Y + 4, WORLD_WIDTH, WORLD_HEIGHT - STREET_Y - 4, '#4a4852'); // road
  for (let x = 6; x < WORLD_WIDTH; x += 22) c.hline(x, STREET_Y + 16, 10, '#d8cc9a');
  c.rect(0, STREET_Y + 28, WORLD_WIDTH, 4, '#8a8690'); // far sidewalk
  const lamps: Array<{ x: number; y: number }> = [];
  for (let x = 30; x < WORLD_WIDTH; x += randomInt(rng, 70, 110)) {
    c.vline(x, STREET_Y - 18, 18, '#2c2a34');
    c.hline(x, STREET_Y - 18, 4, '#2c2a34');
    c.rect(x + 3, STREET_Y - 17, 2, 1, '#cfc8b0');
    lamps.push({ x: x + 3, y: STREET_Y - 17 });
  }
  return lamps;
}

export function generateCity(seed = 20261015): CityLayout {
  const rng = createRng(seed);

  const far = new LayerBuilder(STYLES.far, rng);
  for (let x = -10; x < WORLD_WIDTH + 10; ) {
    const w = randomInt(rng, 14, 30);
    far.building(x, randomInt(rng, 150, 230), w, STREET_Y);
    x += w + randomInt(rng, -4, 3);
  }

  const mid = new LayerBuilder(STYLES.mid, rng);
  for (let x = -20; x < WORLD_WIDTH + 20; ) {
    const w = randomInt(rng, 22, 44);
    mid.building(x, randomInt(rng, 120, 250), w, STREET_Y);
    x += w + randomInt(rng, 4, 16);
  }

  // A few tall foreground towers spread across the panorama as landmarks.
  const near = new LayerBuilder(STYLES.near, rng);
  for (const [x, w, top] of [
    [24, 54, 92],
    [196, 46, 140],
    [352, 38, 70],
    [612, 58, 112],
    [760, 50, 150],
  ] as const) {
    near.building(x, top + randomInt(rng, -6, 6), w, STREET_Y);
  }
  const lamps = drawStreet(near.canvas, rng);

  return { layers: [far.build('far'), mid.build('mid'), near.build('near')], lamps };
}
