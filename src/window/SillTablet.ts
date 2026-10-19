import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { lerpColor } from '../core/color';
import { PixelBuffer } from '../core/pixelBuffer';
import { glowTexture } from '../scene/common/glow';
import { drawText, textWidth } from '../scene/city/pixelFont';
import type { SillSurface } from './WindowFrame';
import { tabletSize } from './sillProps';

/** What the tablet's lock screen shows. */
export interface TabletStatus {
  hours: number;
  /** clear | overcast | light-rain | thunderstorm | snow */
  weather: string;
  /** 0 by day, 1 deep in the night. */
  nightness: number;
}

/**
 * The settings, as an iPad stood on the right-hand corner of the sill,
 * leaning back against the glass: a slim black bezel in a thin aluminium
 * edge, its home screen glowing (the wallpaper changing with the time of
 * day, a clock and weather widget, a row of apps, the dock). It dims when
 * left alone and brightens when you move. Tap it to pick it up: the panel
 * grows out of its screen; put it down and it's back on the sill.
 */
export class SillTablet {
  readonly container = new Container({ label: 'sill-tablet' });
  private readonly body = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly screen = new Sprite();
  private readonly glow = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private readonly spill = new Sprite({ anchor: { x: 0.5, y: 0.5 }, blendMode: 'add' });
  private size = tabletSize(1);
  private screenRect = { x: 0, y: 0, w: 0, h: 0 };
  private lastKey = '';
  private wake = 0;
  private lifted = false;

  constructor(
    private readonly canTap: () => boolean,
    private readonly onOpen: () => void,
  ) {
    this.container.addChild(this.spill, this.glow, this.body, this.screen);
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.on('pointertap', () => {
      if (this.canTap() && !this.lifted) this.onOpen();
    });
  }

  /** Brighten the screen for a moment (the viewer moved): a hint it can be picked up. */
  nudge(): void {
    this.wake = 3;
  }

  /** Hide it while it's lifted up as the open panel. */
  setLifted(lifted: boolean): void {
    this.lifted = lifted;
    this.container.visible = !lifted;
  }

  /**
   * The tablet's screen on the page (CSS px), for the panel to grow out of.
   * Worked out from where it's laid out, so it's right even while it's hidden.
   */
  screenBounds(): { x: number; y: number; width: number; height: number } {
    const k = this.container.scale.x;
    const { x, y, w, h } = this.screenRect;
    return { x: this.container.x + x * k, y: this.container.y + y * k, width: w * k, height: h * k };
  }

  layout(surface: SillSurface, nearness: number, visibleRight: number, curtainArt: number): void {
    const fs = surface.frameScale;
    const size = tabletSize(nearness);
    const rebuild = size.width !== this.size.width || !this.body.texture || this.body.texture === Texture.EMPTY;
    this.size = size;
    const W = size.width;
    const H = size.height;
    if (rebuild) {
      this.body.texture?.destroy(true);
      this.body.texture = drawBody(W, H).toTexture();
      this.lastKey = '';
    }
    // On the sill between the bowl's side and the curtain's foot, resting near the front.
    const right = visibleRight - (curtainArt - 6) * fs;
    const x = Math.round(right - (size.reserve / 2 + 2) * fs);
    this.container.scale.set(fs);
    this.container.position.set(x, Math.round(surface.y + Math.min(4, surface.depth) * fs));
    // The body sprite is W+4 wide and H+3 tall (the device, its bottom edge, its shadow).
    this.screenRect = { x: Math.round(-W / 2 + 4), y: -(H + 3) + 3, w: W - 8, h: H - 7 };
    this.screen.position.set(this.screenRect.x, this.screenRect.y);
    this.glow.texture = glowTexture(Math.round(W * 0.6), 0xa8c8ff, 0.65, false);
    this.glow.position.set(0, -H / 2 - 2);
    // A faint pool of the screen's light on the sill in front of it.
    this.spill.texture = glowTexture(Math.round(W * 0.55), 0xa8c8ff, 0.22, false);
    this.spill.position.set(0, 0);
    this.container.hitArea = new Rectangle(-W / 2 - 4, -H - 6, W + 8, H + 10);
  }

  /** `room` is the room's light, which falls on the tablet's case (its screen makes its own). */
  update(dt: number, status: TabletStatus, room = 0xffffff): void {
    this.wake = Math.max(0, this.wake - dt);
    const minute = Math.floor(status.hours * 60);
    const key = `${minute}:${status.weather}:${this.screenRect.w}`;
    if (key !== this.lastKey && this.screenRect.w > 0) {
      this.lastKey = key;
      this.screen.texture?.destroy(true);
      this.screen.texture = drawHomeScreen(this.screenRect.w, this.screenRect.h, status).toTexture();
    }
    // The screen's own light: dim when idle, bright when woken; it glows into the dark.
    const awake = Math.min(1, this.wake);
    this.screen.tint = lerpColor(0x6a6a78, 0xffffff, 0.45 + awake * 0.55);
    const dark = 0.25 + status.nightness * 0.75;
    this.glow.alpha = (0.1 + awake * 0.3) * dark;
    this.spill.alpha = (0.15 + awake * 0.35) * status.nightness;
    this.body.tint = room;
  }
}

const ALU = { light: 0xd4d8de, base: 0xaeb3ba, dark: 0x80858d, edge: 0x5e636a };
const BEZEL = 0x0b0c0f;

/**
 * The iPad leaning back against the glass, in landscape: a thin aluminium
 * edge (lit on the left and top, in shadow on the right), rounded corners,
 * a slim even black bezel with the camera in the middle of the top edge;
 * a touch narrower at the top, as it leans away; the bottom edge where it
 * rests on the sill, and its soft shadow.
 */
function drawBody(W: number, H: number): PixelBuffer {
  const p = new PixelBuffer(W + 4, H + 3);
  const ox = 2;
  for (let y = 0; y < H; y++) {
    // Narrower at the top as it leans back.
    const inset = Math.round((1 - y / (H - 1)) * 1.4);
    const x0 = inset;
    const x1 = W - 1 - inset;
    for (let x = x0; x <= x1; x++) {
      const fromEdge = Math.min(x - x0, x1 - x, y, H - 1 - y);
      // Rounded corners: trim the outermost pixels at each.
      const cornerX = Math.min(x - x0, x1 - x);
      const cornerY = Math.min(y, H - 1 - y);
      if (cornerX + cornerY < 2) continue;
      let c: number;
      if (fromEdge === 0) {
        // The aluminium edge.
        c = x === x0 ? ALU.light : x === x1 ? ALU.dark : y === 0 ? ALU.base : ALU.edge;
        if (cornerX + cornerY === 2) c = ALU.base;
      } else c = BEZEL;
      p.set(ox + x, y, c);
    }
  }
  // The camera, in the middle of the top bezel.
  p.set(ox + Math.round(W / 2), 2, 0x2a3242);
  // The bottom edge, where it rests on the sill.
  for (let x = 3; x < W - 3; x++) p.set(ox + x, H, ALU.dark);
  // Its shadow, soft at the ends.
  for (let x = 1; x < W + 3; x++) {
    const end = Math.min(x, W + 2 - x);
    p.set(x, H + 1, 0x000000, end < 3 ? 40 : 90);
    if (end > 4) p.set(x, H + 2, 0x000000, 35);
  }
  return p;
}

const APPS = [0x34c759, 0x0a84ff, 0xff9f0a, 0xff375f, 0xbf5af2, 0x64d2ff, 0xffd60a, 0x30d158, 0x5e5ce6];

/** The wallpaper's colours, top to bottom, for the hour: dawn, day, dusk, night. */
function wallpaper(hours: number): [number, number, number] {
  const h = ((hours % 24) + 24) % 24;
  if (h < 5 || h >= 21) return [0x0e1434, 0x2a2058, 0x4a2a6a];
  if (h < 8) return [0x3a4a8a, 0xb07aa8, 0xf0a88a];
  if (h < 17.5) return [0x1a6ad0, 0x4aa8e8, 0x9ad8f0];
  return [0x3a2a6a, 0xb05a7a, 0xf09a5a];
}

/**
 * The home screen: a soft wallpaper of sweeping colour bands, the status
 * bar's battery, a clock widget and a weather widget, a row of app icons,
 * and the frosted dock with four more. A faint diagonal reflection lies
 * across the glass.
 */
function drawHomeScreen(w: number, h: number, status: TabletStatus): PixelBuffer {
  const p = new PixelBuffer(w, h);
  const [top, mid, low] = wallpaper(status.hours);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Two sweeping bands across the wallpaper.
      const wave = y / h + Math.sin(x * 0.22) * 0.06 - x * 0.004;
      const c = wave < 0.45 ? lerpColor(top, mid, wave / 0.45) : lerpColor(mid, low, Math.min(1, (wave - 0.45) / 0.45));
      p.set(x, y, c);
    }
  }
  const frost = (x0: number, y0: number, ww: number, hh: number, toward: number, k: number) => {
    for (let y = y0; y < y0 + hh; y++) {
      for (let x = x0; x < x0 + ww; x++) {
        const corner = (x === x0 || x === x0 + ww - 1) && (y === y0 || y === y0 + hh - 1);
        if (corner || x < 0 || x >= w || y < 0 || y >= h) continue;
        p.set(x, y, lerpColor(p.get(x, y), toward, k));
      }
    }
  };
  const icon = (x: number, y: number, color: number) => {
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        if ((i === 0 || i === 3) && (j === 0 || j === 3)) continue;
        p.set(x + i, y + j, j === 0 ? lerpColor(color, 0xffffff, 0.3) : j === 3 ? lerpColor(color, 0x000000, 0.2) : color);
      }
    }
    // A little white glyph in the middle.
    p.set(x + 1 + ((color >> 3) & 1), y + 1 + ((color >> 5) & 1), 0xffffff);
  };
  // The status bar: the battery at the right.
  p.hline(w - 6, 1, 4, 0xffffff);
  p.set(w - 2, 1, 0xc8c8c8);
  p.set(w - 9, 1, 0xffffff);
  p.set(w - 11, 1, 0xffffff);
  // Widgets: the clock, and the weather beside it.
  const night = status.nightness > 0.5;
  let rowY = 4;
  if (w >= 30) {
    const hh = Math.floor(status.hours) % 24;
    const mm = Math.floor((status.hours * 60) % 60);
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const tw = textWidth(time, 'small');
    frost(2, 3, tw + 4, 9, 0x000000, 0.35);
    drawText(p, time, 4, 5, 0xffffff, 'small');
    const gx = tw + 8;
    frost(gx, 3, 9, 9, 0xffffff, 0.22);
    const glyph = WEATHER_GLYPHS[status.weather === 'clear' && night ? 'night' : status.weather] ?? WEATHER_GLYPHS.clear;
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] !== '.') p.set(gx + 2 + x, 5 + y, GLYPH_COLORS[row[x]]);
    });
    rowY = 14;
  }
  // A row of apps.
  const per = Math.max(1, Math.floor((w - 2) / 6));
  const rowX = Math.round((w - (per * 6 - 2)) / 2);
  if (rowY + 4 < h - 7) for (let i = 0; i < per; i++) icon(rowX + i * 6, rowY, APPS[i % APPS.length]);
  // The dock: frosted, rounded, four apps in it.
  const dockW = Math.min(w - 4, 4 * 6 + 2);
  const dockX = Math.round((w - dockW) / 2);
  frost(dockX, h - 6, dockW, 6, 0xffffff, 0.3);
  for (let i = 0; i < 4; i++) icon(dockX + 2 + i * 6, h - 5, APPS[(i * 2 + 3) % APPS.length]);
  // A faint reflection across the glass.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = x + y * 1.4 - w * 0.55;
      if (d > 0 && d < 5) p.set(x, y, lerpColor(p.get(x, y), 0xffffff, 0.1));
    }
  }
  return p;
}

const GLYPH_COLORS: Record<string, number> = { s: 0xffd040, c: 0xe8eef4, r: 0x6ab8ff, m: 0xf0e8c0, l: 0xfff07a };
const WEATHER_GLYPHS: Record<string, string[]> = {
  clear: ['s.s.s', '.sss.', 'sssss', '.sss.', 's.s.s'],
  night: ['.mm..', 'mm...', 'mm...', 'mm...', '.mm..'],
  overcast: ['.....', '.cc..', 'cccc.', 'ccccc', '.....'],
  'light-rain': ['.cc..', 'cccc.', 'ccccc', 'r.r.r', '.r.r.'],
  thunderstorm: ['.cc..', 'cccc.', 'ccccc', '..l..', '.l...'],
  snow: ['c.c.c', '.c.c.', 'c.c.c', '.c.c.', 'c.c.c'],
};
