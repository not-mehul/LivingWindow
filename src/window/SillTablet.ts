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
 * The settings, as a tablet propped up in its folio case on the right-hand
 * corner of the sill. Its lock screen shows the time and the weather, and
 * brightens when you move the mouse. Tap it to pick it up (the panel lifts
 * out of it); put it down and it's back on the sill.
 */
export class SillTablet {
  readonly container = new Container({ label: 'sill-tablet' });
  private readonly body = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly screen = new Sprite();
  private readonly glow = new Sprite({ anchor: 0.5, blendMode: 'add' });
  private size = tabletSize(1);
  private screenRect = { x: 0, y: 0, w: 0, h: 0 };
  private lastKey = '';
  private wake = 0;
  private lifted = false;

  constructor(
    private readonly canTap: () => boolean,
    private readonly onOpen: () => void,
  ) {
    this.container.addChild(this.glow, this.body, this.screen);
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

  /** The tablet's outline on screen (CSS px), for the panel to grow out of. */
  screenBounds(): { x: number; y: number; width: number; height: number } {
    const b = this.container.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  layout(surface: SillSurface, nearness: number, visibleRight: number, curtainArt: number): void {
    const fs = surface.frameScale;
    const size = tabletSize(nearness);
    const rebuild = size.width !== this.size.width || !this.body.texture || this.body.texture === Texture.EMPTY;
    this.size = size;
    if (rebuild) {
      this.body.texture?.destroy(true);
      this.body.texture = drawBody(size.width, size.height).toTexture();
      this.lastKey = '';
    }
    // On the sill between the bowl's side and the curtain's foot.
    const right = visibleRight - (curtainArt - 6) * fs;
    const x = Math.round(right - (size.reserve / 2 + 2) * fs);
    this.container.scale.set(fs);
    this.container.position.set(x, Math.round(surface.y + 4 * fs));
    const W = size.width;
    const H = size.height;
    this.screenRect = { x: Math.round(-W / 2 + 4), y: -H + 4, w: W - 8, h: H - 11 };
    this.screen.position.set(this.screenRect.x, this.screenRect.y);
    this.glow.texture = glowTexture(Math.round(W * 0.7), 0x6ab8ff, 0.7, false);
    this.glow.position.set(0, -H / 2);
    this.container.hitArea = new Rectangle(-W / 2 - 4, -H - 4, W + 8, H + 8);
  }

  /** `room` is the room's light, which falls on the tablet's case (its screen makes its own). */
  update(dt: number, status: TabletStatus, room = 0xffffff): void {
    this.wake = Math.max(0, this.wake - dt);
    const minute = Math.floor(status.hours * 60);
    const key = `${minute}:${status.weather}:${this.screenRect.w}`;
    if (key !== this.lastKey && this.screenRect.w > 0) {
      this.lastKey = key;
      this.screen.texture?.destroy(true);
      this.screen.texture = drawScreen(this.screenRect.w, this.screenRect.h, status).toTexture();
    }
    // The screen's own light: dim when idle, bright when woken; it glows into the dark.
    const awake = Math.min(1, this.wake);
    this.screen.tint = lerpColor(0x8a8a9a, 0xffffff, 0.35 + awake * 0.65);
    this.glow.alpha = (0.15 + awake * 0.35) * (0.3 + status.nightness * 0.7);
    this.body.tint = room;
  }
}

/** The folio case and the tablet in it, leaning back a little: bezel, camera, home button, the case's stand behind. */
function drawBody(W: number, H: number): PixelBuffer {
  const p = new PixelBuffer(W + 6, H + 2);
  const ox = 3;
  // The case's stand, a leather flap behind the right side.
  for (let y = 4; y < H; y++) for (let x = W - 6; x < W + 3; x++) if (x - (W - 6) < (y - 4) * 0.5 + 2) p.set(ox + x, y, y % 4 === 0 ? 0x5a3a26 : 0x6e4a30);
  // The tablet: a little narrower at the top, as it leans back.
  for (let y = 0; y < H - 1; y++) {
    const inset = Math.round((1 - y / H) * 2);
    for (let x = inset; x < W - inset; x++) {
      const edge = x === inset || x === W - inset - 1 || y === 0 || y === H - 2;
      const corner = (y === 0 || y === H - 2) && (x <= inset + 1 || x >= W - inset - 2);
      if (corner) continue;
      p.set(ox + x, y, edge ? 0x0a0b0e : y < 2 ? 0x3a3e48 : x < inset + 2 ? 0x2e3138 : 0x1c1e24);
    }
  }
  // Camera dot, and the home button.
  p.set(ox + Math.round(W / 2), 2, 0x4a5060);
  for (let x = -2; x <= 2; x++) p.set(ox + Math.round(W / 2) + x, H - 4, x === 0 ? 0x5a6070 : 0x2e3138);
  // Its shadow on the sill.
  for (let x = 2; x < W + 2; x++) p.set(ox + x, H, 0x000000, 70);
  return p;
}

/** The lock screen: a dusky wallpaper, the time large, the weather as a small glyph, a row of app dots. */
function drawScreen(w: number, h: number, status: TabletStatus): PixelBuffer {
  const p = new PixelBuffer(w, h);
  const night = status.nightness > 0.5;
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    const c = night ? lerpColor(0x141a3a, 0x3a2a5a, t) : lerpColor(0x3a7ab8, 0xe89a7a, t);
    for (let x = 0; x < w; x++) p.set(x, y, (x + y) % 7 === 0 ? lerpColor(c, 0xffffff, 0.06) : c);
  }
  // A line of hills along the bottom of the wallpaper.
  for (let x = 0; x < w; x++) {
    const top = Math.round(h - 3 - Math.sin(x * 0.35) * 1.5 - (x > w / 2 ? 1 : 0));
    for (let y = top; y < h; y++) p.set(x, y, night ? 0x1a2030 : 0x3a6a4a);
  }
  const hh = Math.floor(status.hours) % 24;
  const mm = Math.floor((status.hours * 60) % 60);
  const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const tw = textWidth(time, 'small');
  drawText(p, time, Math.round((w - tw) / 2), 2, 0xffffff, 'small');
  // The weather, in a 5×5 glyph under the time.
  const gx = Math.round(w / 2 - 2);
  const gy = 9;
  const glyph = WEATHER_GLYPHS[status.weather === 'clear' && night ? 'night' : status.weather] ?? WEATHER_GLYPHS.clear;
  glyph.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') p.set(gx + x, gy + y, GLYPH_COLORS[row[x]]);
  });
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
