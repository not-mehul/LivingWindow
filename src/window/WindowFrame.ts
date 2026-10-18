import { Container, Sprite, TilingSprite, Texture } from 'pixi.js';
import { snapToDevicePixel } from '../core/math';
import { drawPixelTexture } from '../core/pixelTexture';
import type { ViewportLayout } from '../core/viewportLayout';
import { pixelHash } from '../sprites/raster';
import { HINGE_FRACTIONS, SASH_TUCK } from './casement';
import { IRON, RUSTIC_THEME, type FrameTheme } from './palette';
import { curtainWidth, nearness, plantSize } from './sillProps';
import { paintPlank, PixelBuffer } from './woodArt';

/** Width of each jamb (side post), in frame art pixels. */
export const FRAME_SIDE = 19;
/** Height of the head beam across the top, in frame art pixels. */
export const FRAME_TOP = 21;
/** Kept for callers that only need "the frame's thickness". */
export const FRAME_BORDER = FRAME_SIDE;
/** Total height of the windowsill, in frame art pixels. */
export const SILL_HEIGHT = 30;
/** Rows from the top of the sill art to where objects stand (mid-way across its top). */
export const SILL_SURFACE_OFFSET = 8;


/** The visible wall-depth faces inside the jambs and under the head. */
const REVEAL = 6;
const SOFFIT = 4;
/** How far the sill's ends overhang the opening when the wall shows (pillarbox). */
const SILL_OVERHANG = 6;

/** Screen-space strip along the sill where objects (bowl, perched birds) rest. */
export interface SillSurface {
  /** Left/right bounds creatures may use (CSS px), clear of the plant and curtain. */
  left: number;
  right: number;
  /** Y of the standing surface (CSS px). Objects anchor their feet here. */
  y: number;
  /** Top edge of the sill art (CSS px): where the closed sashes meet it. */
  top: number;
  frameScale: number;
}

/** The clear opening between the jambs, head and sill, in CSS px. */
export interface ClearOpening {
  x: number;
  y: number;
  width: number;
  height: number;
  frameScale: number;
}

function createWallTexture(theme: FrameTheme): Texture {
  const WALL = theme.wall;
  return drawPixelTexture(16, 16, (c) => {
    c.rect(0, 0, 16, 16, WALL.base);
    if (theme.wallPattern === 'logs') {
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
      c.px(5, 12, WALL.dark);
    } else {
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

/** An iron nail head. */
function nail(p: PixelBuffer, x: number, y: number): void {
  p.set(x, y, IRON.dark);
  p.set(x + 1, y, IRON.base);
  p.set(x, y + 1, IRON.outline);
  p.set(x + 1, y + 1, IRON.dark);
  p.set(x + 1, y, IRON.light);
}

/**
 * The jambs and head beam of the timber casement, drawn at the opening's
 * exact size so the grain, knots and nails never stretch.
 */
function drawFrame(theme: FrameTheme, width: number, height: number, sillRow: number, pillarboxed: boolean): Texture {
  const W = theme.wood;
  const p = new PixelBuffer(width, height);
  const plank = FRAME_SIDE - REVEAL;
  const beam = FRAME_TOP - SOFFIT;

  // Jambs: a plank post with the wall's depth showing as a reveal inside it.
  for (const side of ['left', 'right'] as const) {
    const x = side === 'left' ? 0 : width - FRAME_SIDE;
    const plankX = side === 'left' ? x : x + REVEAL;
    const revealX = side === 'left' ? x + plank : x;
    paintPlank(p, plankX, 0, plank, height, { vertical: true, wood: W, seed: side === 'left' ? 11 : 23, knots: 0.5 });
    // The reveal: lit by daylight on the left, in shadow on the right.
    paintPlank(p, revealX, 0, REVEAL, height, {
      vertical: true,
      wood: W,
      seed: side === 'left' ? 31 : 37,
      knots: 0,
      tone: side === 'left' ? 1 : -1,
    });
    const seamX = side === 'left' ? plankX + plank - 1 : plankX;
    const edgeX = side === 'left' ? revealX + REVEAL - 1 : revealX;
    const litX = side === 'left' ? plankX : plankX + plank - 1;
    p.vline(seamX, 0, height, W.outline);
    p.vline(edgeX, 0, height, W.outline);
    // A worn, rounded outer arris on each post.
    for (let y = 0; y < height; y++) if (pixelHash(litX, y, 5) > 0.2) p.set(litX + (side === 'left' ? 1 : -1), y, W.highlight);
    if (pillarboxed) p.vline(side === 'left' ? 0 : width - 1, 0, height, W.outline);
    // Iron hinge leaves screwed to the reveal, beside each sash hinge.
    const sashTop = FRAME_TOP - SASH_TUCK;
    const sashHeight = sillRow - FRAME_TOP + SASH_TUCK * 2;
    for (const f of HINGE_FRACTIONS) {
      const cy = Math.round(sashTop + sashHeight * f);
      const hx = side === 'left' ? revealX : revealX + 1;
      p.rect(hx, cy - 5, REVEAL - 1, 11, IRON.base);
      p.vline(hx, cy - 5, 11, side === 'left' ? IRON.light : IRON.dark);
      p.hline(hx, cy - 6, REVEAL - 1, IRON.outline);
      p.hline(hx, cy + 6, REVEAL - 1, IRON.outline);
      p.set(hx + 1, cy - 3, IRON.outline);
      p.set(hx + 1, cy + 3, IRON.outline);
    }
  }

  // Head: a heavy beam across the full width, with its underside (soffit).
  paintPlank(p, 0, 0, width, beam, { vertical: false, wood: W, seed: 47, knots: 0.35 });
  paintPlank(p, FRAME_SIDE - REVEAL, beam, width - (FRAME_SIDE - REVEAL) * 2, SOFFIT, {
    vertical: false,
    wood: W,
    seed: 53,
    knots: 0,
    tone: -1,
  });
  if (pillarboxed) p.hline(0, 0, width, W.outline);
  p.hline(0, pillarboxed ? 1 : 2, width, W.highlight);
  p.hline(0, beam - 2, width, W.dark);
  p.hline(0, beam - 1, width, W.outline);
  p.hline(FRAME_SIDE - 1, FRAME_TOP - 1, width - (FRAME_SIDE - 1) * 2, W.outline);
  // Mitre where the soffit meets each reveal.
  for (let i = 0; i < SOFFIT; i++) {
    p.set(FRAME_SIDE - REVEAL + i, beam + i, W.outline);
    p.set(width - FRAME_SIDE + REVEAL - 1 - i, beam + i, W.outline);
  }
  // Nails pinning the beam to each post.
  for (const x of [3, plank - 5, width - plank + 3, width - 5]) {
    nail(p, x, 5);
    nail(p, x, beam - 6);
  }
  return p.toTexture();
}

/** The deep sill: a worn top you can see across, a rounded lip and a plank face. */
function drawSill(theme: FrameTheme, width: number, caps: boolean): Texture {
  const W = theme.wood;
  const p = new PixelBuffer(width, SILL_HEIGHT);
  p.hline(0, 0, width, W.outline);
  // Shadow cast where the sill meets the window.
  p.hline(0, 1, width, W.shadow);
  p.hline(0, 2, width, W.dark);
  // The top surface, darker at the back and paler towards the room.
  paintPlank(p, 0, 3, width, 2, { vertical: false, wood: W, seed: 61, knots: 0, tone: -1 });
  paintPlank(p, 0, 5, width, 4, { vertical: false, wood: W, seed: 67, knots: 0.25 });
  paintPlank(p, 0, 9, width, 3, { vertical: false, wood: W, seed: 71, knots: 0, tone: 1 });
  // Pale wear where things get set down most.
  for (let x = 0; x < width; x++) {
    const centre = 1 - Math.abs(x / width - 0.5) * 2;
    for (let y = 6; y <= 10; y++) if (pixelHash(x, y, 73) < centre * 0.12) p.set(x, y, W.shine);
  }
  // Rounded front lip.
  p.hline(0, 12, width, W.shine);
  p.hline(0, 13, width, W.highlight);
  // Front face: two boards.
  paintPlank(p, 0, 14, width, 6, { vertical: false, wood: W, seed: 79, knots: 0.3 });
  paintPlank(p, 0, 21, width, SILL_HEIGHT - 23, { vertical: false, wood: W, seed: 83, knots: 0.3, tone: -1 });
  p.hline(0, 14, width, W.light);
  p.hline(0, 20, width, W.outline);
  p.hline(0, SILL_HEIGHT - 2, width, W.shadow);
  p.hline(0, SILL_HEIGHT - 1, width, W.outline);
  if (caps) {
    // End grain where the sill's horns stick out onto the wall.
    for (const x of [0, width - 4]) {
      p.rect(x, 3, 4, SILL_HEIGHT - 4, W.dark);
      p.rect(x + 1, 4, 2, SILL_HEIGHT - 7, W.base);
      for (let y = 6; y < SILL_HEIGHT - 4; y += 4) p.hline(x + 1, y, 2, W.light);
      p.vline(x === 0 ? 0 : width - 1, 0, SILL_HEIGHT, W.outline);
    }
  }
  return p.toTexture();
}

/**
 * The screen-space room around the view: the interior wall (only visible on
 * extreme ultrawides), the rustic timber frame pinned to the opening's edges,
 * and the deep windowsill along the bottom of the screen.
 */
export class WindowFrame {
  /** Wall + frame. Sits above the world and the sashes. */
  readonly container = new Container({ label: 'window-frame' });
  /** The sill. Sits above the sashes so their bottom rails tuck behind it. */
  readonly sillContainer = new Container({ label: 'window-sill' });

  private readonly wallLeft: TilingSprite;
  private readonly wallRight: TilingSprite;
  private readonly frame = new Sprite({ label: 'frame' });
  private readonly sill = new Sprite({ label: 'sill' });
  private theme: FrameTheme;
  private lastLayout: ViewportLayout | null = null;
  private _surface: SillSurface = { left: 0, right: 0, y: 0, top: 0, frameScale: 1 };
  private _clear: ClearOpening = { x: 0, y: 0, width: 0, height: 0, frameScale: 1 };
  private _nearness = 1;

  constructor(theme: FrameTheme = RUSTIC_THEME) {
    this.theme = theme;
    const wallTexture = createWallTexture(theme);
    this.wallLeft = new TilingSprite({ texture: wallTexture, label: 'wall-left' });
    this.wallRight = new TilingSprite({ texture: wallTexture, label: 'wall-right' });
    this.container.addChild(this.wallLeft, this.wallRight, this.frame);
    this.sillContainer.addChild(this.sill);
  }

  /** Re-skin the window (all landscapes currently share one theme). */
  setTheme(theme: FrameTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    const wall = createWallTexture(theme);
    this.wallLeft.texture = wall;
    this.wallRight.texture = wall;
    if (this.lastLayout) this.layout(this.lastLayout);
  }

  get sillSurface(): SillSurface {
    return this._surface;
  }

  /** Y (CSS px) of the underside of the head beam. */
  get innerTop(): number {
    return this._clear.y;
  }

  /** How large the sill's props are drawn for this view (see `sillProps`). */
  get nearness(): number {
    return this._nearness;
  }

  /** The glazed opening the sashes fill. */
  get clearOpening(): ClearOpening {
    return this._clear;
  }

  layout(layout: ViewportLayout): void {
    this.lastLayout = layout;
    const { opening, frameScale: fs, screenWidth, screenHeight, devicePixelRatio } = layout;
    const snap = (v: number) => snapToDevicePixel(v, devicePixelRatio);

    // Wall: only visible beside the opening on extreme ultrawides (pillarbox).
    const pillarboxed = layout.mode === 'pillarbox';
    const wallLeftWidth = Math.ceil(opening.x / fs) + FRAME_SIDE;
    const wallRightX = opening.x + opening.width;
    const wallRightWidth = Math.ceil((screenWidth - wallRightX) / fs) + FRAME_SIDE;
    for (const wall of [this.wallLeft, this.wallRight]) {
      wall.visible = pillarboxed;
      wall.scale.set(fs);
      wall.height = screenHeight / fs;
    }
    this.wallLeft.position.set(0, 0);
    this.wallLeft.width = wallLeftWidth;
    this.wallRight.position.set(snap(wallRightX - FRAME_SIDE * fs), 0);
    this.wallRight.width = wallRightWidth;
    this.wallRight.tilePosition.x = -(this.wallRight.x / fs);

    // Frame: when the opening fills the screen, its outer edge is pushed just
    // off-screen so the posts and beam read as continuing beyond the view.
    const bleed = pillarboxed ? 0 : 2;
    const frameX = snap(opening.x - bleed * fs);
    const frameY = snap(opening.y - bleed * fs);
    const frameWidth = Math.ceil(opening.width / fs) + bleed * 2;
    const frameHeight = Math.ceil(opening.height / fs) + bleed * 2;
    const sillTop = snap(screenHeight - SILL_HEIGHT * fs);
    const sillRow = Math.round((sillTop - frameY) / fs);
    this.replace(this.frame, drawFrame(this.theme, frameWidth, frameHeight, sillRow, pillarboxed));
    this.frame.scale.set(fs);
    this.frame.position.set(frameX, frameY);

    // Sill: spans the screen, or overhangs onto the wall when there is one.
    const overhang = pillarboxed ? SILL_OVERHANG : 1;
    const sillX = snap(opening.x - overhang * fs);
    const sillWidth = Math.ceil(opening.width / fs) + overhang * 2;
    this.replace(this.sill, drawSill(this.theme, sillWidth, pillarboxed));
    this.sill.scale.set(fs);
    this.sill.position.set(sillX, sillTop);

    const clearLeft = frameX + FRAME_SIDE * fs;
    const clearRight = frameX + (frameWidth - FRAME_SIDE) * fs;
    const clearTop = frameY + FRAME_TOP * fs;
    this._clear = { x: clearLeft, y: clearTop, width: clearRight - clearLeft, height: sillTop - clearTop, frameScale: fs };

    const visibleLeft = Math.max(0, opening.x);
    const visibleRight = Math.min(screenWidth, opening.x + opening.width);
    this._nearness = nearness((visibleRight - visibleLeft) / fs);
    this._surface = {
      // Clear of the potted plant at the left end.
      left: visibleLeft + plantSize(this._nearness).reserve * fs,
      // Clear of the curtain's foot, which tucks in a little at the bottom.
      right: visibleRight - (curtainWidth((visibleRight - visibleLeft) / fs) - 6) * fs,
      y: sillTop + SILL_SURFACE_OFFSET * fs,
      top: sillTop,
      frameScale: fs,
    };
  }

  private replace(sprite: Sprite, texture: Texture): void {
    const old = sprite.texture;
    sprite.texture = texture;
    if (old && old !== Texture.EMPTY) old.destroy(true);
  }
}
