import { Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
import { clamp, snapToDevicePixel } from '../core/math';
import { createRng } from '../core/random';
import type { BirdseedStage, BirdseedState } from '../state/BirdseedState';
import { pixelHash } from '../sprites/raster';
import { BowlPresence } from './bowlPresence';
import { CERAMIC, SEED } from './palette';
import { dishSize, type DishSize } from './sillProps';
import type { SillSurface } from './WindowFrame';
import { PixelBuffer } from './woodArt';

const SEED_COLORS = [SEED.dark, SEED.base, SEED.base, SEED.light, SEED.pale];

/** Proportions of the dish, derived from its size (art px). */
interface DishGeometry {
  size: DishSize;
  /** Texture size: the dish, the mound headroom and a 1-px outline margin. */
  texWidth: number;
  texHeight: number;
  /** Texture row of the dish's top edge. */
  top: number;
  cx: number;
  /** Rim ellipse: centre row (dish rows), half-width, half-height. */
  rimY: number;
  a: number;
  b: number;
  /** The opening inside the rolled rim. */
  ia: number;
  ib: number;
}

function dishGeometry(size: DishSize): DishGeometry {
  const rimY = Math.round(size.height * 0.32);
  const a = size.width / 2 - 0.5;
  const thickness = Math.max(3, Math.round(size.width * 0.05));
  return {
    size,
    texWidth: size.width + 2,
    texHeight: size.mound + size.height + 2,
    top: size.mound + 1,
    cx: size.width / 2 + 1,
    rimY,
    a,
    b: rimY,
    ia: a - thickness,
    ib: Math.max(2, rimY - Math.round(thickness * 0.55)),
  };
}

/**
 * A wide, unglazed terracotta dish seen from just above: a thick rolled rim,
 * the shaded inside, a rounded belly lit from the window side and a foot.
 * `stage` adds seed: a scattering, a layer, then a heaped mound.
 */
function drawDish(g: DishGeometry, stage: BirdseedStage): Texture {
  const { size, cx, rimY, a, b, ia, ib, top } = g;
  const p = new PixelBuffer(g.texWidth, g.texHeight);
  const rng = createRng(1337 + stage * 17 + size.width);
  type Part = 'inside' | 'rim' | 'body' | 'foot' | null;
  const partAt = (x: number, y: number): Part => {
    const dx = x + 0.5 - cx;
    const dy = y - top + 0.5 - rimY;
    if (y < top || y >= top + size.height) return null;
    if ((dx / ia) ** 2 + ((dy + 0.6) / ib) ** 2 <= 1) return 'inside';
    if ((dx / a) ** 2 + (dy / b) ** 2 <= 1) return 'rim';
    if (dy < 0) return null;
    const s = dy / (size.height - rimY);
    const halfWidth = a * Math.sqrt(Math.max(0, 1 - 0.75 * s * s));
    if (Math.abs(dx) > halfWidth) return null;
    return y >= top + size.height - 2 ? 'foot' : 'body';
  };

  for (let y = 0; y < g.texHeight; y++) {
    for (let x = 0; x < g.texWidth; x++) {
      const part = partAt(x, y);
      if (!part) continue;
      const dx = x + 0.5 - cx;
      const dy = y - top + 0.5 - rimY;
      let color: string;
      if (part === 'inside') {
        // The back of the bowl sits in the rim's shadow.
        // The far wall sits in the rim's shadow; the floor nearer us catches light.
        color = dy < -ib * 0.35 ? CERAMIC.insideDark : dy < ib * 0.25 ? CERAMIC.inside : CERAMIC.insideLight;
      } else if (part === 'rim') {
        color = dy < 0 ? CERAMIC.light : CERAMIC.rim;
        if (pixelHash(x, y, 9) < 0.035) color = CERAMIC.chip;
      } else if (part === 'body') {
        const s = dy / (size.height - rimY);
        const halfWidth = a * Math.sqrt(Math.max(0, 1 - 0.75 * s * s));
        const u = dx / halfWidth;
        color = u < -0.55 ? CERAMIC.light : u > 0.55 ? CERAMIC.shadow : CERAMIC.base;
        if (s > 0.78 && u > -0.55) color = CERAMIC.shadow;
        // A thrown ring part-way down the belly.
        if (Math.abs(s - 0.42) < 0.06 && pixelHash(x, 3, 5) < 0.75) color = u > 0.55 ? CERAMIC.outline : CERAMIC.shadow;
      } else {
        color = CERAMIC.shadow;
      }
      p.set(x, y, color);
    }
  }
  // Define the lip: a lit edge on the front of the rim, shadow inside the back.
  for (let y = 0; y < g.texHeight; y++) {
    for (let x = 0; x < g.texWidth; x++) {
      const here = partAt(x, y);
      if (here === 'rim' && partAt(x, y - 1) === 'inside') p.set(x, y, CERAMIC.shine);
      if (here === 'inside' && partAt(x, y - 1) === 'rim') p.set(x, y, CERAMIC.outline);
    }
  }

  // Seed.
  if (stage > 0) {
    const mound = stage === 3;
    for (let y = 0; y < g.texHeight; y++) {
      for (let x = 0; x < g.texWidth; x++) {
        const dx = x + 0.5 - cx;
        const dy = y - top + 0.5 - rimY;
        const inside = partAt(x, y) === 'inside';
        let seeded = false;
        if (stage === 1) seeded = inside && dy > -ib * 0.1 && rng() < 0.32;
        else if (stage === 2) seeded = inside && dy > -ib * 0.55 && rng() < 0.97;
        else seeded = inside || (dy <= 0.5 && (dx / (ia * 0.94)) ** 2 + (dy / (ib + size.mound)) ** 2 <= 1);
        if (!seeded) continue;
        let color = SEED_COLORS[Math.floor(rng() * SEED_COLORS.length)];
        // The heap catches the light on its upper left.
        if (mound && dy < -ib * 0.4 && dx < 0 && rng() < 0.5) color = SEED.pale;
        p.set(x, y, color);
        // Striped sunflower seeds here and there.
        if (rng() < 0.08 && (inside || mound)) {
          p.set(x, y, SEED.dark);
          if (p.isSet(x + 1, y)) p.set(x + 1, y, SEED.pale);
        }
      }
    }
  }

  // Ink outline round the silhouette (the heap included).
  const outline: Array<[number, number]> = [];
  for (let y = 0; y < g.texHeight; y++) {
    for (let x = 0; x < g.texWidth; x++) {
      if (p.isSet(x, y)) continue;
      if (p.isSet(x - 1, y) || p.isSet(x + 1, y) || p.isSet(x, y - 1) || p.isSet(x, y + 1)) outline.push([x, y]);
    }
  }
  for (const [x, y] of outline) p.set(x, y, CERAMIC.outline);
  return p.toTexture();
}

function createDishTextures(g: DishGeometry): Record<BirdseedStage, Texture> {
  return { 0: drawDish(g, 0), 1: drawDish(g, 1), 2: drawDish(g, 2), 3: drawDish(g, 3) };
}

interface FallingSeed {
  x: number;
  y: number;
  vy: number;
  delay: number;
  landY: number;
  color: number;
}

/** Fraction of the sill's usable width at which the bowl sits. */
const BOWL_POSITION = 0.72;
/** Sill rows below the standing line where the dish's foot rests: right at the front lip. */
const FOOT_ROWS = 5;
const POUR_SECONDS = 0.55;
const BUMP_SECONDS = 0.35;
const GRAVITY = 260; // art px / s²

/**
 * The birdseed bowl on the windowsill. Tap it to fill it; birds (Step 4)
 * empty it via `BirdseedState.consume()`.
 */
export class BirdseedBowl {
  readonly container = new Container({ label: 'birdseed-bowl' });

  private geometry = dishGeometry(dishSize(1));
  private textures = createDishTextures(this.geometry);
  private readonly sprite: Sprite;
  private readonly particles = new Graphics();
  private seeds: FallingSeed[] = [];
  private bump = 1;
  private bumpKind: 'fill' | 'wiggle' = 'fill';
  private readonly presence = new BowlPresence(true);

  constructor(
    private readonly state: BirdseedState,
    /** Returns false to swallow a tap (e.g. it was the end of a pan gesture). */
    private readonly canTap: () => boolean,
  ) {
    this.sprite = new Sprite({ texture: this.textures[state.stage], anchor: { x: 0.5, y: 1 } });
    this.container.addChild(this.sprite, this.particles);
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.updateHitArea();
    this.container.on('pointertap', () => {
      if (this.canTap()) this.pour();
    });
    state.on('change', () => {
      this.sprite.texture = this.textures[state.stage];
    });
  }

  /** Half the dish's width (art px), for creatures lining up beside it. */
  get halfWidth(): number {
    return this.geometry.size.width / 2;
  }

  /** Whether the bowl is on the sill (it's taken in while the window is shut). */
  get present(): boolean {
    return this.presence.present;
  }

  /** Take the bowl in (before the sashes close) or set it back out. */
  setPresent(present: boolean): void {
    this.presence.setPresent(present);
  }

  /**
   * Fill the bowl (with a little pouring animation). Returns false when the
   * bowl isn't out on the sill, so there is nothing to pour into.
   */
  pour(): boolean {
    if (!this.presence.present) return false;
    if (!this.state.fill()) {
      this.bumpKind = 'wiggle';
      this.bump = 0;
      return true;
    }
    this.bumpKind = 'fill';
    // Negative progress delays the settle until most of the seed has landed.
    this.bump = -(POUR_SECONDS * 0.8) / BUMP_SECONDS;
    const rng = Math.random;
    const g = this.geometry;
    // Seed lands across the middle of the opening (sprite coordinates: foot at 0).
    const rimRow = -(g.texHeight - g.top) + g.rimY;
    const count = 14 + Math.round(g.size.width / 6);
    for (let i = 0; i < count; i++) {
      const color = SEED_COLORS[Math.floor(rng() * SEED_COLORS.length)];
      this.seeds.push({
        x: Math.round((rng() - 0.5) * g.ia * 0.9),
        y: -g.texHeight - 10 - rng() * 14,
        vy: 0,
        delay: (i / count) * POUR_SECONDS,
        landY: rimRow - 1 + Math.floor(rng() * 4),
        color: Number.parseInt(color.slice(1), 16),
      });
    }
    return true;
  }

  /** Place the dish on the sill, drawn at the size for this view's `nearness`. */
  layout(surface: SillSurface, devicePixelRatio: number, nearness = 1): void {
    this.resize(dishSize(nearness));
    const fs = surface.frameScale;
    const margin = (this.halfWidth + 10) * fs;
    const span = surface.right - surface.left;
    const x = clamp(surface.left + span * BOWL_POSITION, surface.left + margin, surface.right - margin);
    this.container.scale.set(fs);
    this.container.position.set(
      snapToDevicePixel(Math.round(x / fs) * fs, devicePixelRatio),
      // The foot rests at the front of the sill: nearest the viewer.
      snapToDevicePixel(surface.y + FOOT_ROWS * fs, devicePixelRatio),
    );
  }

  private resize(size: DishSize): void {
    if (size.width === this.geometry.size.width) return;
    const old = this.textures;
    this.geometry = dishGeometry(size);
    this.textures = createDishTextures(this.geometry);
    this.sprite.texture = this.textures[this.state.stage];
    for (const texture of Object.values(old)) texture.destroy(true);
    this.updateHitArea();
  }

  private updateHitArea(): void {
    // Generous hit box so it's easy to tap on phones.
    const { texWidth, texHeight } = this.geometry;
    this.container.hitArea = new Rectangle(-texWidth / 2 - 4, -texHeight - 6, texWidth + 8, texHeight + 8);
  }

  update(deltaSeconds: number): void {
    this.presence.update(deltaSeconds);
    this.container.visible = this.presence.visible;
    this.container.alpha = this.presence.alpha;
    this.container.eventMode = this.presence.present ? 'static' : 'none';
    // Lifted a few art pixels while it's being taken in or set down.
    this.container.pivot.y = this.presence.lift;
    this.updateBump(deltaSeconds);
    this.updateSeeds(deltaSeconds);
  }

  private updateBump(deltaSeconds: number): void {
    if (this.bump >= 1) return;
    this.bump = Math.min(1, this.bump + deltaSeconds / BUMP_SECONDS);
    const t = Math.max(0, this.bump);
    // Offsets are whole art pixels so the bowl never blurs or distorts.
    if (this.bumpKind === 'fill') {
      // The seed's weight lands: a one-pixel settle into the sill and back.
      this.sprite.position.set(0, Math.round(Math.sin(t * Math.PI)));
    } else {
      // "Already full": a quick side-to-side wobble.
      this.sprite.position.set(Math.round(Math.sin(t * Math.PI * 4) * (1 - t) * 2), 0);
    }
  }

  private updateSeeds(deltaSeconds: number): void {
    if (this.seeds.length === 0) return;
    const g = this.particles;
    g.clear();
    this.seeds = this.seeds.filter((seed) => {
      if (seed.delay > 0) {
        seed.delay -= deltaSeconds;
        return true;
      }
      seed.vy += GRAVITY * deltaSeconds;
      seed.y += seed.vy * deltaSeconds;
      if (seed.y >= seed.landY) return false;
      g.rect(seed.x, Math.round(seed.y), 1, 1).fill(seed.color);
      return true;
    });
  }
}
