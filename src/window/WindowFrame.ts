import { Container, NineSliceSprite, TilingSprite, type Texture } from 'pixi.js';
import { snapToDevicePixel } from '../core/math';
import { drawPixelTexture } from '../core/pixelTexture';
import type { ViewportLayout } from '../core/viewportLayout';
import { CITY_THEME, type FrameTheme } from './palette';
import { pixelHash } from '../sprites/raster';
import type { PixelCanvas } from '../core/pixelTexture';

/** Thickness of the frame's top and side borders, in frame art pixels. */
export const FRAME_BORDER = 6;
/** Total height of the windowsill, in frame art pixels. */
export const SILL_HEIGHT = 18;
/** Rows from the top of the sill art to the surface objects stand on. */
export const SILL_SURFACE_OFFSET = 5;
/** How far the sill's "horns" overhang the opening when pillarboxed. */
const SILL_OVERHANG = 5;

const FRAME_TEX = 20;
const SILL_TEX_WIDTH = 24;
const SILL_CAP = 4;

/** Screen-space strip along the sill where objects (bowl, perched birds) rest. */
export interface SillSurface {
  /** Left/right bounds that are actually visible on screen (CSS px). */
  left: number;
  right: number;
  /** Y of the standing surface (CSS px). Objects anchor their feet here. */
  y: number;
  /** Top edge of the sill art (CSS px) — where the closed sash meets it. */
  top: number;
  frameScale: number;
}

/** Flecks of bare wood where paint has worn away. */
function chip(c: PixelCanvas, theme: FrameTheme, seed: number, density = 0.05): void {
  if (!theme.chipped) return;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const pixel = c.ctx.getImageData(x, y, 1, 1).data;
      if (pixel[3] > 0 && pixelHash(x, y, seed) < density) c.px(x, y, theme.chipped);
    }
  }
}

function createFrameTexture(theme: FrameTheme): Texture {
  const WOOD = theme.wood;
  const b = FRAME_BORDER;
  const s = FRAME_TEX;
  return drawPixelTexture(s, s, (c) => {
    // Wood body.
    c.rect(0, 0, s, b, WOOD.base);
    c.rect(0, 0, b, s, WOOD.base);
    c.rect(s - b, 0, b, s, WOOD.base);
    c.rect(0, s - b, s, b, WOOD.base);
    // Grain lines running along each member.
    c.hline(0, 2, s, WOOD.dark);
    c.vline(2, 0, s, WOOD.dark);
    c.vline(s - 3, 0, s, WOOD.dark);
    c.hline(0, s - 3, s, WOOD.dark);
    // Outer edge (against the wall).
    c.hline(0, 0, s, WOOD.outline);
    c.vline(0, 0, s, WOOD.outline);
    c.vline(s - 1, 0, s, WOOD.outline);
    c.hline(0, s - 1, s, WOOD.outline);
    // Bevelled inner edge: lit from the top-left, shadowed bottom-right.
    c.hline(b - 2, b - 2, s - 2 * b + 4, WOOD.highlight);
    c.vline(b - 2, b - 2, s - 2 * b + 4, WOOD.highlight);
    c.vline(s - b + 1, b - 2, s - 2 * b + 4, WOOD.shadow);
    c.hline(b - 2, s - b + 1, s - 2 * b + 4, WOOD.shadow);
    // Dark lip where the frame meets the glass / outside.
    c.hline(b - 1, b - 1, s - 2 * b + 2, WOOD.outline);
    c.vline(b - 1, b - 1, s - 2 * b + 2, WOOD.outline);
    c.vline(s - b, b - 1, s - 2 * b + 2, WOOD.outline);
    c.hline(b - 1, s - b, s - 2 * b + 2, WOOD.outline);
    chip(c, theme, 3);
  });
}

function createSillTexture(theme: FrameTheme): Texture {
  const WOOD = theme.wood;
  const w = SILL_TEX_WIDTH;
  const h = SILL_HEIGHT;
  return drawPixelTexture(w, h, (c) => {
    // Back of the sill, shadowed by the frame/sash above it.
    c.hline(0, 0, w, WOOD.outline);
    c.hline(0, 1, w, WOOD.dark);
    // Top surface (lighter towards the viewer for depth).
    c.rect(0, 2, w, 2, WOOD.light);
    c.rect(0, 4, w, 3, WOOD.highlight);
    for (let x = 3; x < w - 3; x += 7) c.hline(x, 3, 3, WOOD.base);
    for (let x = 6; x < w - 3; x += 9) c.hline(x, 5, 2, WOOD.light);
    // Rounded front lip.
    c.hline(0, 7, w, WOOD.shine);
    c.hline(0, 8, w, WOOD.light);
    // Front face with a couple of grain lines.
    c.rect(0, 9, w, h - 9, WOOD.base);
    c.hline(0, 11, w, WOOD.dark);
    for (let x = 2; x < w; x += 8) c.hline(x, 13, 4, WOOD.dark);
    c.hline(0, h - 3, w, WOOD.dark);
    c.hline(0, h - 2, w, WOOD.shadow);
    c.hline(0, h - 1, w, WOOD.outline);
    // End-grain caps so the sill reads as a solid plank when its ends show.
    for (const x of [0, w - SILL_CAP]) {
      c.rect(x, 2, SILL_CAP, h - 3, WOOD.dark);
      c.rect(x + 1, 3, SILL_CAP - 2, h - 6, WOOD.base);
      c.vline(x === 0 ? 0 : w - 1, 0, h, WOOD.outline);
    }
    chip(c, theme, 7, 0.04);
  });
}

function createWallTexture(theme: FrameTheme): Texture {
  const WALL = theme.wall;
  return drawPixelTexture(16, 16, (c) => {
    c.rect(0, 0, 16, 16, WALL.base);
    if (theme.wallPattern === 'logs') {
      // Stacked logs: a lit top edge and a dark seam on each.
      for (const y of [0, 8]) {
        c.hline(0, y, 16, WALL.light);
        c.hline(0, y + 6, 16, WALL.dark);
        c.hline(0, y + 7, 16, WALL.trim);
      }
      c.px(5, 3, WALL.dark);
      c.px(12, 11, WALL.dark);
    } else if (theme.wallPattern === 'boards') {
      // Vertical tongue-and-groove boards.
      for (const x of [0, 8]) {
        c.vline(x, 0, 16, WALL.trim);
        c.vline(x + 1, 0, 16, WALL.light);
      }
      c.px(4, 6, WALL.dark);
      c.px(12, 13, WALL.dark);
    } else {
      // Subtle plaster speckle.
      for (const [x, y] of [
        [2, 3],
        [9, 1],
        [13, 7],
        [5, 10],
        [11, 13],
        [1, 14],
      ]) {
        c.px(x, y, WALL.light);
      }
      for (const [x, y] of [
        [7, 6],
        [14, 2],
        [3, 7],
        [10, 9],
      ]) {
        c.px(x, y, WALL.dark);
      }
    }
  });
}

/**
 * The screen-space room around the view: interior wall (only visible on
 * extreme ultrawides), the window frame pinned to the opening's edges with a
 * nine-slice, and the bottom windowsill.
 */
export class WindowFrame {
  /** Wall + frame borders. Sits above the world and sash. */
  readonly container = new Container({ label: 'window-frame' });
  /** The sill. Sits above the sash so the closing pane tucks behind it. */
  readonly sillContainer = new Container({ label: 'window-sill' });

  private readonly wallLeft: TilingSprite;
  private readonly wallRight: TilingSprite;
  private readonly frame: NineSliceSprite;
  private readonly sill: NineSliceSprite;
  private _surface: SillSurface = { left: 0, right: 0, y: 0, top: 0, frameScale: 1 };
  private _innerTop = 0;

  constructor(theme: FrameTheme = CITY_THEME) {
    const wallTexture = createWallTexture(theme);
    this.wallLeft = new TilingSprite({ texture: wallTexture, label: 'wall-left' });
    this.wallRight = new TilingSprite({ texture: wallTexture, label: 'wall-right' });
    this.frame = new NineSliceSprite({
      texture: createFrameTexture(theme),
      leftWidth: FRAME_BORDER,
      rightWidth: FRAME_BORDER,
      topHeight: FRAME_BORDER,
      bottomHeight: FRAME_BORDER,
      label: 'frame',
    });
    this.sill = new NineSliceSprite({
      texture: createSillTexture(theme),
      leftWidth: SILL_CAP,
      rightWidth: SILL_CAP,
      topHeight: 0,
      bottomHeight: 0,
      label: 'sill',
    });
    this.container.addChild(this.wallLeft, this.wallRight, this.frame);
    this.sillContainer.addChild(this.sill);
  }

  /** Re-skin the window for another landscape. */
  setTheme(theme: FrameTheme): void {
    const wall = createWallTexture(theme);
    this.wallLeft.texture = wall;
    this.wallRight.texture = wall;
    this.frame.texture = createFrameTexture(theme);
    this.sill.texture = createSillTexture(theme);
  }

  get sillSurface(): SillSurface {
    return this._surface;
  }

  /** Y (CSS px) of the inner edge of the top frame border. */
  get innerTop(): number {
    return this._innerTop;
  }

  layout(layout: ViewportLayout): void {
    const { opening, frameScale, screenWidth, screenHeight, devicePixelRatio } = layout;
    const snap = (v: number) => snapToDevicePixel(v, devicePixelRatio);

    // Wall: only visible beside the opening on extreme ultrawides (pillarbox).
    const pillarboxed = layout.mode === 'pillarbox';
    const wallLeftWidth = Math.ceil(opening.x / frameScale) + FRAME_BORDER;
    const wallRightX = opening.x + opening.width;
    const wallRightWidth = Math.ceil((screenWidth - wallRightX) / frameScale) + FRAME_BORDER;
    for (const wall of [this.wallLeft, this.wallRight]) {
      wall.visible = pillarboxed;
      wall.scale.set(frameScale);
      wall.height = screenHeight / frameScale;
    }
    this.wallLeft.position.set(0, 0);
    this.wallLeft.width = wallLeftWidth;
    this.wallRight.position.set(snap(wallRightX - FRAME_BORDER * frameScale), 0);
    this.wallRight.width = wallRightWidth;
    // Keep the right wall's pattern continuous with the left one.
    this.wallRight.tilePosition.x = -(this.wallRight.x / frameScale);

    // Frame: when the opening fills the screen, its outer edge is pushed just
    // off-screen so only the inner bevel and trim remain — maximum view.
    const bleed = pillarboxed ? 0 : 2;
    const frameX = snap(opening.x - bleed * frameScale);
    const frameY = snap(opening.y - bleed * frameScale);
    this.frame.scale.set(frameScale);
    this.frame.position.set(frameX, frameY);
    this.frame.width = opening.width / frameScale + bleed * 2;
    this.frame.height = opening.height / frameScale + bleed * 2;
    this._innerTop = frameY + FRAME_BORDER * frameScale;

    // Sill: spans the opening and overhangs onto the wall when there is one.
    const overhang = pillarboxed ? SILL_OVERHANG : SILL_CAP;
    const sillTop = snap(screenHeight - SILL_HEIGHT * frameScale);
    const sillX = snap(opening.x - overhang * frameScale);
    this.sill.scale.set(frameScale);
    this.sill.position.set(sillX, sillTop);
    this.sill.width = opening.width / frameScale + overhang * 2;
    this.sill.height = SILL_HEIGHT;

    this._surface = {
      left: Math.max(0, opening.x),
      right: Math.min(screenWidth, opening.x + opening.width),
      y: sillTop + SILL_SURFACE_OFFSET * frameScale,
      top: sillTop,
      frameScale,
    };
  }
}
