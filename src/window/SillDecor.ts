import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { snapToDevicePixel } from '../core/math';
import { createRng } from '../core/random';
import type { ViewportLayout } from '../core/viewportLayout';
import { SwayMesh } from '../scene/common/SwayMesh';
import type { BirdseedState } from '../state/BirdseedState';
import { rustleTextures } from '../scene/common/rustle';
import { Curtain } from './Curtain';
import { sillContacts } from './sillContacts';
import { PLANT, SEED } from './palette';
import { curtainWidth, plantSize, type PlantSize } from './sillProps';
import type { SillSurface } from './WindowFrame';
import { PixelBuffer } from './woodArt';

/** Seeds that are always lying about; pours add more, birds tidy them up. */
const BASE_SPECKS = 10;
const MAX_SPECKS = 42;
/** Sill rows below the standing line where the pot rests: at the front lip, like the dish. */
const FOOT_ROWS = 5;

/** Ink outline: colour every empty pixel that touches the drawing. */
function inkOutline(p: PixelBuffer, color: string): void {
  const outline: Array<[number, number]> = [];
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.isSet(x, y)) continue;
      if (p.isSet(x - 1, y) || p.isSet(x + 1, y) || p.isSet(x, y - 1) || p.isSet(x, y + 1)) outline.push([x, y]);
    }
  }
  for (const [x, y] of outline) p.set(x, y, color);
}

/** Terracotta pot: a banded, rolled rim, a tapered body lit from the window, and a saucer. */
function drawPot(size: PlantSize): Texture {
  const W = size.potWidth;
  const H = size.potHeight;
  // One spare pixel all round for the outline.
  const p = new PixelBuffer(W + 2, H + 2);
  const rimRows = Math.max(4, Math.round(H * 0.22));
  const saucerRows = Math.max(2, Math.round(H * 0.1));
  const bodyTop = rimRows;
  const bodyBottom = H - saucerRows;
  const shade = (u: number) => (u < 0.22 ? PLANT.potLight : u > 0.76 ? PLANT.potShadow : PLANT.pot);
  // Rim band, slightly wider than the body.
  for (let y = 0; y < rimRows; y++) {
    for (let x = 0; x < W; x++) p.set(x + 1, y + 1, shade(x / (W - 1)));
  }
  p.hline(2, 1, W - 2, PLANT.potRim);
  p.hline(3, 2, W - 4, PLANT.soil);
  p.hline(3, 3, W - 4, PLANT.soil);
  p.hline(1, rimRows, W, PLANT.potShadow);
  // Tapered body, with a highlight streak catching the window light.
  for (let y = bodyTop; y < bodyBottom; y++) {
    const t = (y - bodyTop) / Math.max(1, bodyBottom - bodyTop);
    const inset = 1 + Math.round(t * W * 0.12);
    for (let x = inset; x < W - inset; x++) {
      const u = (x - inset) / Math.max(1, W - inset * 2 - 1);
      p.set(x + 1, y + 1, Math.abs(u - 0.16) < 0.05 ? PLANT.potRim : shade(u));
    }
  }
  // Saucer.
  const footInset = 1 + Math.round(W * 0.12) - 2;
  for (let y = bodyBottom; y < H; y++) {
    for (let x = footInset; x < W - footInset; x++) {
      p.set(x + 1, y + 1, y === bodyBottom ? PLANT.potRim : shade((x - footInset) / (W - footInset * 2)));
    }
  }
  inkOutline(p, PLANT.potOutline);
  return p.toTexture();
}

/** The plant's stems (degrees from upright), in the clumps that sway on their own. */
const CLUMPS = [
  [-70, -52, -34],
  [-16, 0, 14],
  [30, 48, 66],
];

/** A leafy herb: arching stems with pointed oval leaves, inked like the reference (just the stems of one clump). */
function drawLeaves(size: PlantSize, clump: readonly number[]): PixelBuffer {
  const W = size.leavesWidth;
  const H = size.leavesHeight;
  const scale = H / 50;
  const p = new PixelBuffer(W, H);
  const rng = createRng(4242);
  const baseX = W / 2;
  const baseY = H - 1;
  const leaves: Array<{ x: number; y: number; angle: number; length: number }> = [];
  const stemPixels: Array<[number, number]> = [];
  for (const degrees of CLUMPS.flat()) {
    const a = (degrees * Math.PI) / 180;
    const length = (28 + rng() * 18 - Math.abs(degrees) * 0.12) * scale;
    // Stems arch outward: a quadratic curve from the soil.
    const mine = clump.includes(degrees);
    const tipX = baseX + Math.sin(a) * length;
    const tipY = baseY - Math.cos(a) * length * 0.95;
    const ctrlX = baseX + Math.sin(a) * length * 0.25;
    const ctrlY = baseY - length * 0.75;
    let lastX = baseX;
    let lastY = baseY;
    const steps = Math.round(24 * scale);
    const every = Math.max(4, Math.round(6 * scale));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) ** 2 * baseX + 2 * (1 - t) * t * ctrlX + t * t * tipX;
      const y = (1 - t) ** 2 * baseY + 2 * (1 - t) * t * ctrlY + t * t * tipY;
      if (mine) stemPixels.push([Math.round(x), Math.round(y)]);
      if (mine && i % every === Math.floor(every / 2) && t > 0.2) {
        const side = Math.floor(i / every) % 2 === 0 ? 1 : -1;
        const dir = Math.atan2(y - lastY, x - lastX) + side * 0.9;
        leaves.push({ x, y, angle: dir, length: (5 + rng() * 2.2) * scale });
      }
      lastX = x;
      lastY = y;
    }
    if (mine)
      leaves.push({
      x: tipX,
      y: tipY,
      angle: Math.atan2(tipY - lastY, tipX - lastX) - Math.PI / 2 + a * 0.3,
      length: 7 * scale,
    });
  }
  // Leaves: pointed ovals with a darker underside half, a pale midrib and side veins.
  for (const leaf of leaves) {
    const cos = Math.cos(leaf.angle);
    const sin = Math.sin(leaf.angle);
    const width = leaf.length * 0.42;
    const cx = leaf.x + cos * leaf.length * 0.5;
    const cy = leaf.y + sin * leaf.length * 0.5;
    const reach = Math.ceil(leaf.length);
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const u = (i * cos + j * sin) / (leaf.length * 0.5);
        const v = (-i * sin + j * cos) / width;
        // Pointed tip: narrow the leaf towards u = 1.
        const taper = u > 0 ? 1 - u * u * 0.55 : 1;
        if (u * u + (v / taper) ** 2 > 1) continue;
        const midrib = Math.abs(v) < 0.14 && u > -0.75;
        const vein = scale > 1.2 && Math.abs(Math.abs(v) - (u + 0.9) * 0.45) < 0.09 && u < 0.6;
        let color: string = v < 0 ? PLANT.leafLight : u > 0.4 ? PLANT.leaf : PLANT.leafDark;
        if (vein) color = v < 0 ? PLANT.leaf : PLANT.leafDark;
        if (midrib) color = PLANT.leafVein;
        p.set(Math.round(cx + i), Math.round(cy + j), color);
      }
    }
  }
  inkOutline(p, PLANT.leafOutline);
  // Stems are plain inked lines, showing between and behind the leaves.
  for (const [x, y] of stemPixels) if (!p.isSet(x, y)) p.set(x, y, PLANT.leafDark);
  return p;
}

const LEAF_COLORS = [PLANT.leafLight, PLANT.leaf, PLANT.leafDark, PLANT.leafVein].map((c) => Number.parseInt(c.slice(1), 16));

interface Speck {
  /** Position along the sill's visible width (0..1). */
  fx: number;
  /** Rows from the standing line (negative = further back on the sill). */
  dy: number;
  color: number;
  pair: boolean;
}

const seedColor = (rng: () => number) =>
  Number.parseInt([SEED.dark, SEED.base, SEED.light, SEED.pale][Math.floor(rng() * 4)].slice(1), 16);

/**
 * Things on and around the sill that belong to the room: a potted plant at
 * the left, the curtain at the right (both drawn in front of visiting
 * creatures, so they can appear from behind them), and seed spilled across
 * the sill. The plant and curtain stir in the breeze only while the window
 * is open.
 */
export class SillDecor {
  /** Spilled seed: on the sill, beneath the bowl and visitors. */
  readonly back = new Container({ label: 'sill-decor-back' });
  /** Plant and curtain: in front of everything on the sill. */
  readonly front = new Container({ label: 'sill-decor-front' });

  private readonly pot = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private leaves: SwayMesh[] = [];
  /** A knock to the plant (a bird landing beside it), dying away. */
  private kick = 0;
  private kickTime = 0;
  private lastTime = Number.NaN;
  private plantSize: PlantSize | null = null;
  private readonly plant = new Container({ label: 'plant' });
  private curtain: Curtain | null = null;
  private curtainSize = '';
  private readonly seeds = new Graphics();
  private readonly specks: Speck[] = [];
  private readonly rng = createRng(77);
  private visibleLeft = 0;
  private visibleWidth = 1;
  private bowlFraction = 0.74;
  private frameScale = 1;

  constructor(birdseed: BirdseedState) {
    sillContacts.on('contact', ({ x, strength }) => this.nudge(x, strength));
    this.plant.addChild(this.pot);
    this.front.addChild(this.plant);
    this.back.addChild(this.seeds);
    for (let i = 0; i < BASE_SPECKS; i++) this.addSpeck(i < 6 ? 0.07 : 0.4);
    birdseed.on('filled', () => {
      for (let i = 0; i < 4; i++) this.addSpeck(0.05);
      this.redrawSeeds();
    });
    birdseed.on('change', ({ level, previous }) => {
      // Birds pecking at the bowl tidy up the spilled seed now and then.
      if (level < previous && this.specks.length > BASE_SPECKS && this.rng() < 0.3) {
        let nearest = BASE_SPECKS;
        for (let i = BASE_SPECKS; i < this.specks.length; i++) {
          if (Math.abs(this.specks[i].fx - this.bowlFraction) < Math.abs(this.specks[nearest].fx - this.bowlFraction)) {
            nearest = i;
          }
        }
        this.specks.splice(nearest, 1);
        this.redrawSeeds();
      }
    });
  }

  layout(layout: ViewportLayout, surface: SillSurface, bowlX: number, nearness = 1): void {
    const { opening, frameScale: fs, screenWidth, screenHeight, devicePixelRatio } = layout;
    const snap = (v: number) => snapToDevicePixel(v, devicePixelRatio);
    this.frameScale = fs;
    this.visibleLeft = Math.max(0, opening.x);
    const visibleRight = Math.min(screenWidth, opening.x + opening.width);
    this.visibleWidth = Math.max(1, visibleRight - this.visibleLeft);
    this.bowlFraction = (bowlX - this.visibleLeft) / this.visibleWidth;

    // The plant stands at the front-left of the sill, over the foot of the jamb.
    const size = plantSize(nearness);
    this.resizePlant(size);
    this.plant.scale.set(fs);
    this.plant.position.set(
      snap(this.visibleLeft + Math.round(size.potWidth / 2 + 3) * fs),
      snap(surface.y + FOOT_ROWS * fs),
    );

    // The curtain hangs from above the view down past the sill.
    const height = Math.ceil((screenHeight - opening.y) / fs) + 2;
    const width = curtainWidth(this.visibleWidth / fs);
    if (`${width}x${height}` !== this.curtainSize) {
      if (this.curtain) {
        this.front.removeChild(this.curtain.mesh);
        this.curtain.destroy();
      }
      this.curtain = new Curtain(width, height);
      this.curtainSize = `${width}x${height}`;
      this.front.addChild(this.curtain.mesh);
    }
    this.curtain?.mesh.scale.set(fs);
    this.curtain?.mesh.position.set(snap(visibleRight - width * fs + fs), snap(opening.y - 2 * fs));

    this.seeds.scale.set(fs);
    this.seeds.position.set(snap(this.visibleLeft), snap(surface.y));
    this.redrawSeeds();
  }

  /** Redraw the plant when the view calls for a different size. */
  private resizePlant(size: PlantSize): void {
    if (this.plantSize && this.plantSize.leavesHeight === size.leavesHeight) return;
    this.plantSize = size;
    const oldPot = this.pot.texture;
    this.pot.texture = drawPot(size);
    if (oldPot && oldPot !== Texture.EMPTY) oldPot.destroy(true);
    for (const leaves of this.leaves) {
      this.plant.removeChild(leaves.mesh);
      leaves.mesh.texture.destroy(true);
      leaves.mesh.destroy();
    }
    // Each clump of stems sways on its own, its leaves flicking over in the air.
    this.leaves = CLUMPS.map((clump, i) => {
      const art = drawLeaves(size, clump);
      return new SwayMesh(art.toTexture(), { anchor: 'bottom', amplitude: 4.5 * (size.leavesHeight / 90), frequency: 1.1 + i * 0.17, phase: i * 1.9, rustle: rustleTextures(art, LEAF_COLORS, 60 + i, 3), rustleRate: 3 });
    });
    // The stems rise out of the soil just below the pot's rim.
    const rimDrop = Math.max(3, Math.round(size.potHeight * 0.12));
    for (const [i, leaves] of [...this.leaves].reverse().entries()) {
      leaves.mesh.position.set(-size.leavesWidth / 2, -(size.potHeight + 1) - size.leavesHeight + rimDrop);
      this.plant.addChildAt(leaves.mesh, i);
    }
  }

  /** Something knocked the sill at screen x: the plant shivers if it's near. */
  nudge(x: number, strength: number): void {
    if (!this.plantSize) return;
    const reach = (this.plantSize.leavesWidth / 2 + 24) * this.frameScale;
    const d = Math.abs(x - this.plant.x);
    if (d > reach) return;
    this.kick = Math.min(1.5, this.kick + strength * (1 - d / reach) * 1.2);
  }

  /** Breeze through the open window stirs the leaves and curtain; the room's own air keeps them just moving when it's shut. */
  update(time: number, wind: number, openness: number): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    const calm = 0.22 + 0.78 * openness * openness;
    // A knock sets the stems shivering, dying away over a couple of seconds.
    this.kick *= Math.exp(-dt * 1.6);
    this.kickTime += dt;
    const shiver = this.kick * Math.sin(this.kickTime * 9);
    for (const [i, leaves] of this.leaves.entries()) leaves.update(time, wind * 0.6 + shiver * (1 + i * 0.3) / calm, calm);
    this.curtain?.update(time, wind, openness);
  }

  private addSpeck(spread: number): void {
    if (this.specks.length >= MAX_SPECKS) return;
    const nearBowl = spread < 0.2;
    const fx = nearBowl
      ? this.bowlFraction + (this.rng() - 0.5) * 2 * spread * 1.6
      : 0.12 + this.rng() * 0.8;
    this.specks.push({
      fx,
      dy: Math.floor(this.rng() * 6) - 3,
      color: seedColor(this.rng),
      pair: this.rng() < 0.3,
    });
  }

  private redrawSeeds(): void {
    const g = this.seeds;
    g.clear();
    const widthArt = this.visibleWidth / this.frameScale;
    const minX = this.plantSize?.reserve ?? 34;
    for (const s of this.specks) {
      const x = Math.round(s.fx * widthArt);
      if (x < minX || x > widthArt - 8) continue;
      g.rect(x, s.dy, s.pair ? 2 : 1, 1).fill(s.color);
    }
  }
}
