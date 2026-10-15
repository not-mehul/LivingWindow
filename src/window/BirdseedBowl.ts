import { Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
import { clamp, snapToDevicePixel } from '../core/math';
import { PixelCanvas } from '../core/pixelTexture';
import { createRng } from '../core/random';
import type { BirdseedStage, BirdseedState } from '../state/BirdseedState';
import { CERAMIC, SEED } from './palette';
import type { SillSurface } from './WindowFrame';

const BOWL_ROWS = [
  '....oooooooooooooo....',
  '..oorrrrrrrrrrrrrroo..',
  '.orriiiiiiiiiiiiiirro.',
  'orliiiiiiiiiiiiiiiilro',
  'olrrrrrrrrrrrrrrrrrrlo',
  'olbbbbbbbbbbbbbbbbbbso',
  '.olbbbbbbbbbbbbbbbbso.',
  '.olbbbbbbbbbbbbbbbsso.',
  '..olbbbbbbbbbbbbbsso..',
  '...oosbbbbbbbbbssoo...',
  '.....oossssssssoo.....',
  '......oooooooooo......',
] as const;

const BOWL_PALETTE = {
  o: CERAMIC.outline,
  r: CERAMIC.rim,
  l: CERAMIC.light,
  b: CERAMIC.base,
  s: CERAMIC.shadow,
  i: CERAMIC.inside,
};

const BOWL_WIDTH = BOWL_ROWS[0].length;
/** Half the bowl's width in art pixels, for creatures lining up beside it. */
export const BOWL_HALF_WIDTH = BOWL_WIDTH / 2;
/** Extra rows above the bowl for the heaped seed mound. */
const HEADROOM = 4;
const TEX_HEIGHT = BOWL_ROWS.length + HEADROOM;
const SEED_COLORS = [SEED.dark, SEED.base, SEED.base, SEED.light, SEED.pale];

/** Horizontal extents of seed per texture row, by fill stage (row offsets from bowl top). */
const SEED_SPANS: Record<Exclude<BirdseedStage, 0>, Array<[row: number, from: number, to: number]>> = {
  1: [[3, 7, 14]],
  2: [
    [2, 5, 16],
    [3, 3, 18],
  ],
  3: [
    [-3, 9, 12],
    [-2, 6, 15],
    [-1, 4, 17],
    [0, 3, 18],
    [1, 3, 18],
    [2, 3, 18],
    [3, 3, 18],
  ],
};

function createBowlTextures(): Record<BirdseedStage, Texture> {
  const make = (stage: BirdseedStage) => {
    const c = new PixelCanvas(BOWL_WIDTH, TEX_HEIGHT);
    c.stamp(0, HEADROOM, BOWL_ROWS, BOWL_PALETTE);
    if (stage > 0) {
      const rng = createRng(1337 + stage);
      for (const [row, from, to] of SEED_SPANS[stage as 1 | 2 | 3]) {
        for (let x = from; x <= to; x++) {
          c.px(x, HEADROOM + row, SEED_COLORS[Math.floor(rng() * SEED_COLORS.length)]);
        }
      }
      if (stage === 3) {
        // Rim stays visible in front of the heaped seed.
        c.stamp(0, HEADROOM + 4, [BOWL_ROWS[4]], BOWL_PALETTE);
      }
    }
    return c.toTexture();
  };
  return { 0: make(0), 1: make(1), 2: make(2), 3: make(3) };
}

interface FallingSeed {
  x: number;
  y: number;
  vy: number;
  delay: number;
  landY: number;
  color: number;
}

/** Fraction of the sill's visible width at which the bowl sits. */
const BOWL_POSITION = 0.74;
const POUR_SECONDS = 0.55;
const BUMP_SECONDS = 0.35;
const GRAVITY = 260; // art px / s²

/**
 * The birdseed bowl on the windowsill. Tap it to fill it; birds (Step 4)
 * empty it via `BirdseedState.consume()`.
 */
export class BirdseedBowl {
  readonly container = new Container({ label: 'birdseed-bowl' });

  private readonly textures = createBowlTextures();
  private readonly sprite: Sprite;
  private readonly particles = new Graphics();
  private seeds: FallingSeed[] = [];
  private bump = 1;
  private bumpKind: 'fill' | 'wiggle' = 'fill';
  private surface: SillSurface | null = null;

  constructor(
    private readonly state: BirdseedState,
    /** Returns false to swallow a tap (e.g. it was the end of a pan gesture). */
    private readonly canTap: () => boolean,
  ) {
    this.sprite = new Sprite({ texture: this.textures[state.stage], anchor: { x: 0.5, y: 1 } });
    this.container.addChild(this.sprite, this.particles);
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    // Generous hit box so it's easy to tap on phones.
    this.container.hitArea = new Rectangle(-BOWL_WIDTH / 2 - 4, -TEX_HEIGHT - 6, BOWL_WIDTH + 8, TEX_HEIGHT + 8);
    this.container.on('pointertap', () => {
      if (this.canTap()) this.pour();
    });
    state.on('change', () => {
      this.sprite.texture = this.textures[state.stage];
    });
  }

  /**
   * Where a bird should stand to peck at the seed, in screen CSS px.
   * Anchored to the sill surface so it holds across layouts.
   */
  get perchPoint(): { x: number; y: number } {
    return { x: this.container.x, y: this.surface?.y ?? this.container.y };
  }

  /** Fill the bowl (with a little pouring animation). */
  pour(): void {
    if (!this.state.fill()) {
      this.bumpKind = 'wiggle';
      this.bump = 0;
      return;
    }
    this.bumpKind = 'fill';
    // Negative progress delays the settle until most of the seed has landed.
    this.bump = -(POUR_SECONDS * 0.8) / BUMP_SECONDS;
    const rng = Math.random;
    const count = 14;
    for (let i = 0; i < count; i++) {
      const color = SEED_COLORS[Math.floor(rng() * SEED_COLORS.length)];
      this.seeds.push({
        x: Math.round((rng() - 0.5) * 12),
        y: -TEX_HEIGHT - 10 - rng() * 10,
        vy: 0,
        delay: (i / count) * POUR_SECONDS,
        landY: -TEX_HEIGHT + HEADROOM + 1 + Math.floor(rng() * 3),
        color: Number.parseInt(color.slice(1), 16),
      });
    }
  }

  layout(surface: SillSurface, devicePixelRatio: number): void {
    this.surface = surface;
    const fs = surface.frameScale;
    const margin = (BOWL_WIDTH / 2 + 10) * fs;
    const span = surface.right - surface.left;
    const x = clamp(surface.left + span * BOWL_POSITION, surface.left + margin, surface.right - margin);
    this.container.scale.set(fs);
    this.container.position.set(
      snapToDevicePixel(Math.round(x / fs) * fs, devicePixelRatio),
      // Sit the foot slightly into the sill surface so it reads as resting on it.
      snapToDevicePixel(surface.y + fs, devicePixelRatio),
    );
  }

  update(deltaSeconds: number): void {
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
