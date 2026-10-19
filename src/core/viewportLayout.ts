import {
  MIN_VISIBLE_HEIGHT_FRACTION,
  VERTICAL_FOCUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../config';
import { clamp } from './math';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How the panoramic world maps onto the current screen.
 * - `panoramic`: the whole 21:9 width is visible (ultrawides).
 * - `cropped`: a centred slice is visible and can be panned (16:9, tablets).
 * - `portrait`: tall screens; the world fits the height and pans horizontally.
 * - `pillarbox`: wider than the world can stretch to; the wall fills the sides.
 */
export type ViewportMode = 'panoramic' | 'cropped' | 'portrait' | 'pillarbox';

export interface ViewportLayout {
  /** Screen size in CSS pixels. */
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  /** CSS pixels per world pixel. */
  scale: number;
  /**
   * CSS pixels per window-frame art pixel. Always an integer number of device
   * pixels so the frame, sill and bowl stay perfectly crisp.
   */
  frameScale: number;
  /** Screen-space rectangle (CSS px) through which the world is visible. */
  opening: Rect;
  /** Size of the visible slice of the world, in world pixels. */
  visibleWorldWidth: number;
  visibleWorldHeight: number;
  /** World pixels cropped from the top of the panorama. */
  cropY: number;
  /** Largest horizontal pan offset (world px). 0 when nothing can be panned. */
  maxPanX: number;
  mode: ViewportMode;
}

export interface WorldSize {
  width: number;
  height: number;
}

const DEFAULT_WORLD: WorldSize = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

/** Below this many world pixels of overflow, panning is pointless. */
const PAN_EPSILON = 0.5;

export function computeViewportLayout(
  screenWidth: number,
  screenHeight: number,
  devicePixelRatio = 1,
  world: WorldSize = DEFAULT_WORLD,
): ViewportLayout {
  const sw = Math.max(1, screenWidth);
  const sh = Math.max(1, screenHeight);
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;

  const fitHeight = sh / world.height;
  const fitWidth = sw / world.width;
  const maxCropScale = sh / (world.height * MIN_VISIBLE_HEIGHT_FRACTION);
  // Always fill the screen height. Wider screens may zoom in (cropping the
  // top/bottom) to fill their width, up to the allowed vertical crop.
  const scale = Math.max(fitHeight, Math.min(fitWidth, maxCropScale));

  const worldScreenWidth = world.width * scale;
  // Treat sub-pixel shortfalls (floating-point noise) as filling the screen.
  const pillarboxed = worldScreenWidth < sw - 0.5;
  const openingWidth = pillarboxed ? worldScreenWidth : sw;
  const opening: Rect = {
    x: (sw - openingWidth) / 2,
    y: 0,
    width: openingWidth,
    height: sh,
  };

  const visibleWorldWidth = openingWidth / scale;
  const visibleWorldHeight = Math.min(world.height, sh / scale);
  const cropY = (world.height - visibleWorldHeight) * VERTICAL_FOCUS;
  const overflow = world.width - visibleWorldWidth;
  const maxPanX = overflow > PAN_EPSILON ? overflow : 0;

  let mode: ViewportMode;
  if (pillarboxed) mode = 'pillarbox';
  else if (maxPanX === 0) mode = 'panoramic';
  else if (sh > sw) mode = 'portrait';
  else mode = 'cropped';

  return {
    screenWidth: sw,
    screenHeight: sh,
    devicePixelRatio: dpr,
    scale,
    frameScale: computeFrameScale(chromeScale(scale, sw, sh), dpr),
    opening,
    visibleWorldWidth,
    visibleWorldHeight,
    cropY,
    maxPanX,
    mode,
  };
}

/** The screen size the window's chrome was designed at: its art px are 2 CSS px there. */
const CHROME_REFERENCE = { width: 1280, height: 720, scale: 2 };

/**
 * How big the window's chrome (frame, sill, plant, tablet, the creatures on
 * the sill) is drawn: by the screen's overall size rather than its height,
 * so a phone shows the same proportions of frame to view as a monitor does.
 * Never larger than the world's own scale (big screens are unchanged).
 */
export function chromeScale(worldScale: number, screenWidth: number, screenHeight: number): number {
  const area = (screenWidth * screenHeight) / (CHROME_REFERENCE.width * CHROME_REFERENCE.height);
  return Math.max(1, Math.min(worldScale, CHROME_REFERENCE.scale * Math.sqrt(area)));
}

/**
 * The frame is drawn at the integer device-pixel scale closest to the world
 * scale, so its art pixels line up with the landscape's as closely as
 * possible without ever being blurred or unevenly sized.
 */
export function computeFrameScale(worldScale: number, devicePixelRatio: number): number {
  const devicePixels = Math.max(1, Math.round(worldScale * devicePixelRatio));
  return devicePixels / devicePixelRatio;
}

export function clampPan(panX: number, layout: ViewportLayout): number {
  return clamp(panX, 0, layout.maxPanX);
}

/** Pan offset that shows the centre of the panorama. */
export function centeredPan(layout: ViewportLayout): number {
  return layout.maxPanX / 2;
}

/**
 * Keep the same point of the world centred when the layout changes
 * (window resize, device rotation).
 */
export function panAfterResize(
  panX: number,
  previous: ViewportLayout,
  next: ViewportLayout,
): number {
  const centerWorldX = panX + previous.visibleWorldWidth / 2;
  return clampPan(centerWorldX - next.visibleWorldWidth / 2, next);
}
