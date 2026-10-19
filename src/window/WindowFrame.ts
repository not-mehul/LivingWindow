import { Container, Sprite, TilingSprite, Texture } from 'pixi.js';
import { snapToDevicePixel } from '../core/math';
import { drawPixelTexture } from '../core/pixelTexture';
import type { ViewportLayout } from '../core/viewportLayout';
import { pixelHash } from '../sprites/raster';
import { HINGE_FRACTIONS, SASH_TUCK } from './casement';
import { IRON, RUSTIC_THEME, type FrameTheme } from './palette';
import { curtainWidth, nearness, plantSize, tabletSize } from './sillProps';
import { paintPlank, PixelBuffer } from './woodArt';
import { hexToNumber } from '../core/color';

/** Width of each jamb (side post), in frame art pixels. */
export const FRAME_SIDE = 19;
/** Height of the head beam across the top, in frame art pixels. */
export const FRAME_TOP = 21;
/** Total height of the windowsill, in frame art pixels: a deep top you look down on, its nosing, and the apron below. */
export const SILL_HEIGHT = 46;
/** Rows from the top of the sill art to where objects stand (about two-thirds of the way back across its top). */
export const SILL_SURFACE_OFFSET = 14;
/** The sill's top board ends (its front edge) at this row; the nosing and apron are below. */
const SILL_TOP_END = 22;


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
  /** Art rows of sill top in front of the standing line, out to the front edge (for things that rest nearer the room). */
  depth: number;
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

/** The wall round the window: vertical tongue-and-groove boards. */
function createWallTexture(theme: FrameTheme): Texture {
  const WALL = theme.wall;
  return drawPixelTexture(16, 16, (c) => {
    c.rect(0, 0, 16, 16, WALL.base);
    for (const x of [0, 8]) {
      c.vline(x, 0, 16, WALL.trim);
      c.vline(x + 1, 0, 16, WALL.light);
    }
    c.px(4, 6, WALL.dark);
    c.px(12, 13, WALL.dark);
    c.px(5, 12, WALL.dark);
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

/**
 * The deep sill, jutting out into the room: a broad top board you look down
 * across (in shadow at the back under the window, the jambs' shadows falling
 * forward from their feet, a pool of window light between them, and worn
 * pale where things get set down), a heavy rounded nosing along the front
 * with a shadow under it, and the apron board below.
 * `jambs` are the art columns the jambs stand on.
 */
function drawSill(theme: FrameTheme, width: number, caps: boolean, jambs: ReadonlyArray<[number, number]>): Texture {
  const W = theme.wood;
  const ramp = [W.outline, W.shadow, W.dark, W.base, W.light, W.highlight, W.shine];
  const p = new PixelBuffer(width, SILL_HEIGHT);
  const index = new Map(ramp.map((c, i) => [hexToNumber(c), i]));
  /** Step a pixel lighter (+) or darker (−) along the wood's ramp. */
  const shift = (x: number, y: number, by: number) => {
    const i = index.get(p.get(x, y));
    if (i !== undefined) p.set(x, y, ramp[Math.max(1, Math.min(ramp.length - 1, i + by))]);
  };
  p.hline(0, 0, width, W.outline);
  // Shadow cast where the sill meets the window.
  p.hline(0, 1, width, W.shadow);
  p.hline(0, 2, width, W.dark);
  // The top: one broad board, its grain running along it.
  paintPlank(p, 0, 3, width, SILL_TOP_END - 3, { vertical: false, wood: W, seed: 67, knots: 0.2 });
  const inWindow = (x: number) => jambs.length === 2 && x > jambs[0][1] && x < jambs[1][0];
  for (let y = 3; y < SILL_TOP_END; y++) {
    const back = (9 - y) / 6;
    const front = (y - (SILL_TOP_END - 5)) / 5;
    for (let x = 0; x < width; x++) {
      // Shade in streaks along the grain, not pixel by pixel.
      const h = pixelHash(Math.floor((x + y * 3) / 7), y, 74);
      // Darker at the back, under the window; lighter towards the room.
      if (back > 0 && h < back) shift(x, y, -1);
      else if (front > 0 && h < front * 0.7) shift(x, y, 1);
      // Daylight through the glass lies in a soft pool on the back of the board.
      else if (inWindow(x) && y >= 5 && y < 11 && h > 0.7) shift(x, y, 1);
      // A little pale wear where things get set down most.
      const centre = 1 - Math.abs(x / width - 0.5) * 2;
      if (y > 10 && y < SILL_TOP_END - 2 && pixelHash(x, y, 73) < centre * 0.015) p.set(x, y, W.highlight);
    }
  }
  // The jambs' shadows falling forward from where they stand.
  for (const [x0, x1] of jambs) {
    for (let y = 3; y < 12; y++) {
      const fade = 1 - (y - 3) / 9;
      for (let x = Math.max(0, x0 - 1); x <= Math.min(width - 1, x1 + 1); x++) if (pixelHash(Math.floor(x / 3), y, 76) < fade) shift(x, y, -1);
      if (x1 + 1 < width) p.set(x1 + 1, y, y < 6 ? W.shadow : W.dark);
    }
  }
  // The rounded nosing along the front edge: the lit top of the bullnose, its curve, and the shadow under it.
  const nose = SILL_TOP_END;
  p.hline(0, nose, width, W.shine);
  p.hline(0, nose + 1, width, W.highlight);
  paintPlank(p, 0, nose + 2, width, 2, { vertical: false, wood: W, seed: 79, knots: 0, tone: 1 });
  paintPlank(p, 0, nose + 4, width, 2, { vertical: false, wood: W, seed: 81, knots: 0 });
  p.hline(0, nose + 6, width, W.dark);
  p.hline(0, nose + 7, width, W.outline);
  // The apron board under the nosing, set back in its shadow.
  const apron = nose + 8;
  paintPlank(p, 0, apron, width, SILL_HEIGHT - apron - 3, { vertical: false, wood: W, seed: 83, knots: 0.3, tone: -1 });
  for (let x = 0; x < width; x++) {
    p.set(x, apron, W.shadow);
    if (pixelHash(x, apron + 1, 85) < 0.7) p.set(x, apron + 1, W.shadow);
    if (pixelHash(x, apron + 2, 86) < 0.3) shift(x, apron + 2, -1);
  }
  // A bead run along the apron.
  const bead = apron + 7;
  p.hline(0, bead, width, W.light);
  p.hline(0, bead + 1, width, W.dark);
  p.hline(0, SILL_HEIGHT - 3, width, W.highlight);
  p.hline(0, SILL_HEIGHT - 2, width, W.shadow);
  p.hline(0, SILL_HEIGHT - 1, width, W.outline);
  if (caps) {
    // End grain where the sill's horns stick out past the frame onto the wall.
    for (const x of [0, width - 5]) {
      p.rect(x, 3, 5, nose + 5, W.dark);
      p.rect(x + 1, 4, 3, nose + 2, W.base);
      for (let y = 6; y < nose + 4; y += 4) p.hline(x + 1, y, 3, W.light);
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
  private _surface: SillSurface = { left: 0, right: 0, y: 0, top: 0, depth: SILL_TOP_END - SILL_SURFACE_OFFSET, frameScale: 1 };
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
    // Where the jambs stand on it, in the sill's art columns.
    const jambCol = (screenX: number) => Math.round((screenX - sillX) / fs);
    const jambs: Array<[number, number]> = [
      [jambCol(frameX), jambCol(frameX) + FRAME_SIDE - 1],
      [jambCol(frameX) + frameWidth - FRAME_SIDE, jambCol(frameX) + frameWidth - 1],
    ];
    this.replace(this.sill, drawSill(this.theme, sillWidth, pillarboxed, jambs));
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
      // Clear of the curtain's foot (which tucks in a little at the bottom) and the tablet beside it.
      right: visibleRight - (curtainWidth((visibleRight - visibleLeft) / fs) - 6 + tabletSize(this._nearness).reserve) * fs,
      y: sillTop + SILL_SURFACE_OFFSET * fs,
      top: sillTop,
      depth: SILL_TOP_END - SILL_SURFACE_OFFSET,
      frameScale: fs,
    };
  }

  private replace(sprite: Sprite, texture: Texture): void {
    const old = sprite.texture;
    sprite.texture = texture;
    if (old && old !== Texture.EMPTY) old.destroy(true);
  }
}
