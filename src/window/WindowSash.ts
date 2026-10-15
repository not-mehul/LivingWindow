import { Container, Graphics, Rectangle } from 'pixi.js';
import { lerp, snapToDevicePixel } from '../core/math';
import type { ViewportLayout } from '../core/viewportLayout';
import type { WindowState } from '../state/WindowState';
import { CITY_THEME, GLASS, type FrameTheme, type WoodPalette } from './palette';
import type { SillSurface } from './WindowFrame';

const STILE = 3;
const TOP_RAIL = 3;
const BOTTOM_RAIL = 7;
/** Rows of the sash that tuck behind the frame head / sill when closed. */
const TUCK = 2;
/** Rows of the bottom rail left peeking below the frame head when open. */
const OPEN_PEEK = 6;

const hex = (color: string) => Number.parseInt(color.slice(1), 16);

/**
 * The sliding glass sash. Raised out of view when the window is open; slides
 * down onto the sill when closed. Click its bottom rail (or use the overlay /
 * `W` key) to toggle.
 *
 * `glassLayer` is a masked container in sash art-pixel coordinates where the
 * weather system will draw raindrops and snow on the pane (Step 2).
 */
export class WindowSash {
  readonly container = new Container({ label: 'window-sash' });
  readonly glassLayer = new Container({ label: 'glass-layer' });

  private readonly body = new Graphics();
  private readonly glassMask = new Graphics();
  private widthPx = 0;
  private heightPx = 0;
  private closedY = 0;
  private openY = 0;
  private frameScale = 1;
  private devicePixelRatio = 1;
  private wood: WoodPalette = CITY_THEME.wood;

  constructor(
    private readonly state: WindowState,
    onActivate: () => void,
  ) {
    this.glassLayer.mask = this.glassMask;
    this.container.addChild(this.body, this.glassMask, this.glassLayer);
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.on('pointertap', onActivate);
  }

  setTheme(theme: FrameTheme): void {
    this.wood = theme.wood;
    if (this.widthPx > 0) this.redraw();
  }

  /** The glass area inside the rails, in sash art pixels. */
  get glassRect(): Rectangle {
    return new Rectangle(
      STILE,
      TOP_RAIL,
      this.widthPx - STILE * 2,
      this.heightPx - TOP_RAIL - BOTTOM_RAIL,
    );
  }

  layout(layout: ViewportLayout, innerTop: number, sill: SillSurface): void {
    const fs = layout.frameScale;
    this.frameScale = fs;
    this.devicePixelRatio = layout.devicePixelRatio;
    // Extend a pixel under the frame on each side so no gap ever shows.
    this.widthPx = Math.ceil(layout.opening.width / fs) + 2;
    this.heightPx = Math.ceil((sill.top - innerTop) / fs) + TUCK * 2;
    this.closedY = innerTop - TUCK * fs;
    this.openY = innerTop + OPEN_PEEK * fs - this.heightPx * fs;

    this.container.scale.set(fs);
    this.container.x = snapToDevicePixel(layout.opening.x - fs, layout.devicePixelRatio);
    // Only the bottom rail is a click target; the glass stays "see-through".
    this.container.hitArea = new Rectangle(
      0,
      this.heightPx - BOTTOM_RAIL - 2,
      this.widthPx,
      BOTTOM_RAIL + 2,
    );
    this.redraw();
    this.update();
  }

  update(): void {
    const target = lerp(this.closedY, this.openY, this.state.openness);
    // Move in whole art pixels so the sash slides with a pixel-art cadence.
    const steps = Math.round((target - this.closedY) / this.frameScale);
    this.container.y = snapToDevicePixel(this.closedY + steps * this.frameScale, this.devicePixelRatio);
  }

  private redraw(): void {
    const w = this.widthPx;
    const h = this.heightPx;
    const g = this.body;
    const glass = this.glassRect;
    const WOOD = this.wood;
    g.clear();

    // Glass tint with darker edges for a hint of thickness.
    g.rect(glass.x, glass.y, glass.width, glass.height).fill({
      color: GLASS.tint,
      alpha: GLASS.tintAlpha,
    });
    g.rect(glass.x, glass.y, glass.width, 2).fill({ color: GLASS.edgeShade, alpha: GLASS.edgeShadeAlpha });
    g.rect(glass.x, glass.y, 1, glass.height).fill({ color: GLASS.edgeShade, alpha: GLASS.edgeShadeAlpha });

    // Two diagonal reflection streaks, stair-stepped like hand-placed pixels.
    const streaks = [
      { start: 0.18, width: 3, alpha: GLASS.highlightAlpha },
      { start: 0.27, width: 1, alpha: GLASS.highlightAlpha * 0.7 },
      { start: 0.71, width: 2, alpha: GLASS.highlightAlpha * 0.6 },
    ];
    for (const streak of streaks) {
      const baseX = glass.x + glass.width * streak.start;
      for (let row = 0; row < glass.height; row += 2) {
        const x = Math.round(baseX + (glass.height - row) * 0.35);
        const left = Math.max(glass.x, x);
        const right = Math.min(glass.x + glass.width, x + streak.width);
        if (right > left) {
          g.rect(left, glass.y + row, right - left, 2).fill({ color: GLASS.highlight, alpha: streak.alpha });
        }
      }
    }

    // Wooden rails and stiles.
    const wood = hex(WOOD.base);
    g.rect(0, 0, w, TOP_RAIL).fill(wood);
    g.rect(0, h - BOTTOM_RAIL, w, BOTTOM_RAIL).fill(wood);
    g.rect(0, 0, STILE, h).fill(wood);
    g.rect(w - STILE, 0, STILE, h).fill(wood);
    // Bevels: lit edges top/left, shaded bottom/right, dark lip against the glass.
    g.rect(0, h - BOTTOM_RAIL, w, 1).fill(hex(WOOD.highlight));
    g.rect(0, h - BOTTOM_RAIL + 3, w, 1).fill(hex(WOOD.dark));
    g.rect(0, h - 1, w, 1).fill(hex(WOOD.outline));
    g.rect(0, 0, w, 1).fill(hex(WOOD.highlight));
    g.rect(glass.x - 1, glass.y - 1, glass.width + 2, 1).fill(hex(WOOD.outline));
    g.rect(glass.x - 1, glass.y + glass.height, glass.width + 2, 1).fill(hex(WOOD.outline));
    g.rect(glass.x - 1, glass.y, 1, glass.height).fill(hex(WOOD.outline));
    g.rect(glass.x + glass.width, glass.y, 1, glass.height).fill(hex(WOOD.outline));

    // Brass lift handles on the bottom rail.
    for (const fraction of [0.15, 0.85]) {
      const hx = Math.round(w * fraction) - 4;
      const hy = h - BOTTOM_RAIL + 1;
      g.rect(hx, hy, 8, 3).fill(0x5a4316);
      g.rect(hx + 1, hy, 6, 2).fill(0xd9b45a);
      g.rect(hx + 1, hy, 3, 1).fill(0xf5e2a0);
    }

    this.glassMask.clear();
    this.glassMask.rect(glass.x, glass.y, glass.width, glass.height).fill(0xffffff);
  }
}
