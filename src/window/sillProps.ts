/**
 * Sizes of the things standing on the sill, nearest the viewer: the seed
 * dish and the potted plant. They're drawn large, like in the reference
 * drawing, but scale down a little on narrow screens so a portrait phone's
 * sill isn't swallowed.
 */

/** View width (frame art px) at which the props reach full size. */
const FULL_SIZE_WIDTH = 560;
const MIN_NEARNESS = 0.65;

/**
 * Nearness factor for a view this many frame art px wide, quantised to 0.05
 * so textures are only rebuilt when it actually changes.
 */
export function nearness(visibleArtWidth: number): number {
  const k = Math.min(1, Math.max(MIN_NEARNESS, visibleArtWidth / FULL_SIZE_WIDTH));
  return Math.round(k * 20) / 20;
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

export interface DishSize {
  /** Width of the dish, rim to rim. */
  width: number;
  /** Height of the dish itself (rim top to foot). */
  height: number;
  /** Extra rows above the rim for a heaped mound of seed. */
  mound: number;
}

export function dishSize(k: number): DishSize {
  const width = even(78 * k);
  return { width, height: Math.round(width * 0.34), mound: Math.max(4, Math.round(width * 0.13)) };
}

export interface PlantSize {
  potWidth: number;
  potHeight: number;
  leavesWidth: number;
  leavesHeight: number;
  /** Sill art (from the left of the view) kept clear of creatures. */
  reserve: number;
}

export function plantSize(k: number): PlantSize {
  const potWidth = even(34 * k);
  return {
    potWidth,
    potHeight: Math.round(28 * k),
    leavesWidth: even(100 * k),
    leavesHeight: Math.round(90 * k),
    reserve: potWidth + Math.round(10 * k),
  };
}

/** The curtain's width (art px) for a view this wide: slimmer on phones. */
export function curtainWidth(visibleArtWidth: number): number {
  return Math.round(Math.min(42, Math.max(26, visibleArtWidth * 0.12)));
}

export interface TabletSize {
  width: number;
  height: number;
  /** Sill art (from the right, beside the curtain) kept clear of creatures. */
  reserve: number;
}

/** The settings tablet propped on the sill's right-hand corner. */
export function tabletSize(k: number): TabletSize {
  const width = even(40 * k);
  return { width, height: Math.round(width * 0.74), reserve: width + Math.round(8 * k) };
}
