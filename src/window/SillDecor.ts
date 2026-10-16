import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { snapToDevicePixel } from '../core/math';
import { createRng } from '../core/random';
import type { ViewportLayout } from '../core/viewportLayout';
import { SwayMesh } from '../scene/common/SwayMesh';
import type { BirdseedState } from '../state/BirdseedState';
import { pixelHash } from '../sprites/raster';
import { LINEN, PLANT, SEED } from './palette';
import { curtainWidth, SILL_LEFT_RESERVE, type SillSurface } from './WindowFrame';
import { PixelBuffer } from './woodArt';

const POT_WIDTH = 20;
const POT_HEIGHT = 16;
const LEAVES_WIDTH = 46;
const LEAVES_HEIGHT = 50;
/** Seeds that are always lying about; pours add more, birds tidy them up. */
const BASE_SPECKS = 10;
const MAX_SPECKS = 42;

/** Terracotta pot, slightly tapered, with a rolled rim and dark soil. */
function drawPot(): Texture {
  const p = new PixelBuffer(POT_WIDTH, POT_HEIGHT);
  // Rim.
  p.rect(0, 0, POT_WIDTH, 4, PLANT.pot);
  p.hline(1, 0, POT_WIDTH - 2, PLANT.potRim);
  p.hline(2, 1, POT_WIDTH - 4, PLANT.soil);
  p.hline(1, 3, POT_WIDTH - 2, PLANT.potShadow);
  // Body, tapering towards the foot, lit from the window on the left.
  for (let y = 4; y < POT_HEIGHT; y++) {
    const inset = 1 + Math.floor((y - 4) / 4);
    for (let x = inset; x < POT_WIDTH - inset; x++) {
      const u = (x - inset) / (POT_WIDTH - inset * 2 - 1);
      const color = u < 0.22 ? PLANT.potLight : u > 0.78 ? PLANT.potShadow : PLANT.pot;
      p.set(x, y, color);
    }
    p.set(inset, y, PLANT.potOutline);
    p.set(POT_WIDTH - inset - 1, y, PLANT.potOutline);
  }
  p.hline(0, 0, POT_WIDTH, PLANT.potOutline);
  p.vline(0, 0, 4, PLANT.potOutline);
  p.vline(POT_WIDTH - 1, 0, 4, PLANT.potOutline);
  const footInset = 1 + Math.floor((POT_HEIGHT - 5) / 4);
  p.hline(footInset, POT_HEIGHT - 1, POT_WIDTH - footInset * 2, PLANT.potOutline);
  return p.toTexture();
}

/** A leafy herb: arching stems with pointed oval leaves, inked like the reference. */
function drawLeaves(): Texture {
  const W = LEAVES_WIDTH;
  const H = LEAVES_HEIGHT;
  const p = new PixelBuffer(W, H);
  const rng = createRng(4242);
  const baseX = W / 2;
  const baseY = H - 1;
  const leaves: Array<{ x: number; y: number; angle: number; length: number }> = [];
  const stems = [-62, -38, -16, 4, 22, 44, 66];
  for (const degrees of stems) {
    const a = (degrees * Math.PI) / 180;
    const length = 26 + rng() * 18 - Math.abs(degrees) * 0.12;
    // Stems arch outward: a quadratic curve from the soil.
    const tipX = baseX + Math.sin(a) * length;
    const tipY = baseY - Math.cos(a) * length * 0.95;
    const ctrlX = baseX + Math.sin(a) * length * 0.25;
    const ctrlY = baseY - length * 0.75;
    let lastX = baseX;
    let lastY = baseY;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = (1 - t) ** 2 * baseX + 2 * (1 - t) * t * ctrlX + t * t * tipX;
      const y = (1 - t) ** 2 * baseY + 2 * (1 - t) * t * ctrlY + t * t * tipY;
      p.set(x, y, PLANT.leafDark);
      if (i % 6 === 3 && t > 0.2) {
        const side = i % 12 === 3 ? 1 : -1;
        const dir = Math.atan2(y - lastY, x - lastX) + side * 0.9;
        leaves.push({ x, y, angle: dir, length: 5 + rng() * 2 });
      }
      lastX = x;
      lastY = y;
    }
    leaves.push({ x: tipX, y: tipY, angle: Math.atan2(tipY - lastY, tipX - lastX) - Math.PI / 2 + a * 0.3, length: 7 });
  }
  // Leaves: pointed ovals, a darker underside half and a pale midrib.
  for (const leaf of leaves) {
    const cos = Math.cos(leaf.angle);
    const sin = Math.sin(leaf.angle);
    const width = leaf.length * 0.42;
    const cx = leaf.x + cos * leaf.length * 0.5;
    const cy = leaf.y + sin * leaf.length * 0.5;
    for (let j = -10; j <= 10; j++) {
      for (let i = -10; i <= 10; i++) {
        const u = (i * cos + j * sin) / (leaf.length * 0.5);
        const v = (-i * sin + j * cos) / width;
        // Pointed tip: narrow the leaf towards u = 1.
        const taper = u > 0 ? 1 - u * u * 0.55 : 1;
        if (u * u + (v / taper) ** 2 > 1) continue;
        const x = Math.round(cx + i);
        const y = Math.round(cy + j);
        const color = Math.abs(v) < 0.18 && u > -0.7 ? PLANT.leafVein : v < 0 ? PLANT.leafLight : u > 0.4 ? PLANT.leaf : PLANT.leafDark;
        p.set(x, y, color);
      }
    }
  }
  // Ink outline round the whole plant.
  const filled = (x: number, y: number) => p.isSet(x, y);
  const outline: Array<[number, number]> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) outline.push([x, y]);
    }
  }
  for (const [x, y] of outline) p.set(x, y, PLANT.leafOutline);
  return p.toTexture();
}

/** Linen drawn back to the right: gathered at the top, billowing in deep folds, hemmed. */
function drawCurtain(W: number, height: number): Texture {
  const H = Math.max(8, height);
  const p = new PixelBuffer(W, H);
  const tones = [LINEN.outline, LINEN.shadow, LINEN.dark, LINEN.base, LINEN.light, LINEN.highlight];
  for (let y = 0; y < H; y++) {
    const t = y / H;
    // Narrow where it's gathered, swelling lower down, tucked in at the foot,
    // with the leading edge rippling gently.
    const smooth = Math.min(1, Math.max(0, (t - 0.04) / 0.7));
    const ease = smooth * smooth * (3 - 2 * smooth);
    const tuck = Math.max(0, (t - 0.88) / 0.12);
    const width = Math.round(10 + (W - 12) * ease - 5 * tuck * tuck + Math.sin(t * 17) * 1.2 * ease);
    const left = W - width;
    for (let x = left; x < W; x++) {
      const u = (x - left) / width;
      // Folds fan out from the gather, so their phase follows the width.
      const fold = Math.sin(u * Math.PI * (3 + ease * 2.5) + 0.6);
      // The leading edge turns away from the light.
      const turn = Math.max(0, 1 - (x - left) / 3);
      const shade = 3.1 + fold * 1.5 - turn * 1.6 - (u > 0.85 ? 0.6 : 0);
      p.set(x, y, tones[Math.max(1, Math.min(5, Math.round(shade)))]);
    }
    p.set(left, y, LINEN.outline);
    // A lit ridge just inside the leading edge.
    if (pixelHash(left + 3, y, 3) < 0.7) p.set(left + 3, y, LINEN.highlight);
  }
  // Hem with a line of stitching.
  for (let y = H - 4; y < H; y++) {
    for (let x = 0; x < W; x++) if (p.isSet(x, y)) p.set(x, y, y === H - 1 ? LINEN.outline : LINEN.dark);
  }
  for (let x = 0; x < W; x += 2) if (p.isSet(x, H - 3)) p.set(x, H - 3, LINEN.light);
  return p.toTexture();
}

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

  private readonly pot = new Sprite({ texture: drawPot(), anchor: { x: 0.5, y: 1 } });
  private readonly leaves = new SwayMesh(drawLeaves(), { anchor: 'bottom', amplitude: 2, frequency: 1.3 });
  private readonly plant = new Container({ label: 'plant' });
  private curtain: SwayMesh | null = null;
  private curtainSize = '';
  private readonly seeds = new Graphics();
  private readonly specks: Speck[] = [];
  private readonly rng = createRng(77);
  private visibleLeft = 0;
  private visibleWidth = 1;
  private bowlFraction = 0.74;
  private frameScale = 1;

  constructor(birdseed: BirdseedState) {
    this.leaves.mesh.position.set(-LEAVES_WIDTH / 2, -POT_HEIGHT - LEAVES_HEIGHT + 3);
    this.plant.addChild(this.leaves.mesh, this.pot);
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

  layout(layout: ViewportLayout, surface: SillSurface, bowlX: number): void {
    const { opening, frameScale: fs, screenWidth, screenHeight, devicePixelRatio } = layout;
    const snap = (v: number) => snapToDevicePixel(v, devicePixelRatio);
    this.frameScale = fs;
    this.visibleLeft = Math.max(0, opening.x);
    const visibleRight = Math.min(screenWidth, opening.x + opening.width);
    this.visibleWidth = Math.max(1, visibleRight - this.visibleLeft);
    this.bowlFraction = (bowlX - this.visibleLeft) / this.visibleWidth;

    // The plant stands at the left end of the sill, over the foot of the jamb.
    this.plant.scale.set(fs);
    this.plant.position.set(snap(this.visibleLeft + (SILL_LEFT_RESERVE / 2) * fs), snap(surface.y + 2 * fs));

    // The curtain hangs from above the view down past the sill.
    const height = Math.ceil((screenHeight - opening.y) / fs) + 2;
    const width = curtainWidth(this.visibleWidth / fs);
    if (`${width}x${height}` !== this.curtainSize) {
      if (this.curtain) {
        this.front.removeChild(this.curtain.mesh);
        this.curtain.mesh.texture.destroy(true);
        this.curtain.mesh.destroy();
      }
      this.curtain = new SwayMesh(drawCurtain(width, height), { anchor: 'top', amplitude: 2.5, frequency: 0.7, rows: 24 });
      this.curtainSize = `${width}x${height}`;
      this.front.addChild(this.curtain.mesh);
    }
    this.curtain?.mesh.scale.set(fs);
    this.curtain?.mesh.position.set(snap(visibleRight - width * fs + fs), snap(opening.y - 2 * fs));

    this.seeds.scale.set(fs);
    this.seeds.position.set(snap(this.visibleLeft), snap(surface.y));
    this.redrawSeeds();
  }

  /** Breeze through the open window stirs the leaves and curtain. */
  update(time: number, wind: number, openness: number): void {
    const calm = openness * openness;
    this.leaves.update(time, wind * 0.6, calm);
    this.curtain?.update(time * 0.8, wind, calm);
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
    const minX = SILL_LEFT_RESERVE;
    for (const s of this.specks) {
      const x = Math.round(s.fx * widthArt);
      if (x < minX || x > widthArt - 8) continue;
      g.rect(x, s.dy, s.pair ? 2 : 1, 1).fill(s.color);
    }
  }
}
