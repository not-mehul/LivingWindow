import { Container, PerspectiveMesh, Rectangle, RenderTexture, Texture, type Renderer } from 'pixi.js';
import { snapToDevicePixel } from '../core/math';
import type { WindowState } from '../state/WindowState';
import {
  casementGeometry,
  HINGE_FRACTIONS,
  quadContains,
  SASH_TUCK,
  sashQuad,
  type CasementGeometry,
  type Quad,
} from './casement';
import { GLASS, IRON, RUSTIC_THEME, type FrameTheme, type WoodPalette } from './palette';
import type { ClearOpening } from './WindowFrame';
import { paintPlank, PixelBuffer } from './woodArt';

/** The glazing bar sits a little above half-way, as in the reference. */
const MID_FRACTION = 0.5;

type Side = 'left' | 'right';

/** Timber sizes scale with the window, so the sashes stay chunky on big screens. */
interface Timbers {
  stile: number;
  topRail: number;
  bottomRail: number;
  midRail: number;
}

function timbersFor(h: number): Timbers {
  const stile = Math.max(7, Math.min(13, Math.round(h * 0.034)));
  return { stile, topRail: stile, bottomRail: Math.round(stile * 1.35), midRail: Math.max(4, Math.round(stile * 0.6)) };
}

interface Panes {
  midY: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

function panesFor(w: number, h: number, t: Timbers): Panes {
  const midY = Math.round(h * MID_FRACTION - t.midRail / 2);
  return {
    midY,
    rects: [
      { x: t.stile, y: t.topRail, w: w - t.stile * 2, h: midY - t.topRail },
      { x: t.stile, y: midY + t.midRail, w: w - t.stile * 2, h: h - t.bottomRail - midY - t.midRail },
    ],
  };
}

/** The sash's timber, hinges and handle (transparent where the glass is). */
function drawSashWood(wood: WoodPalette, w: number, h: number, hinge: Side, seed: number) {
  const p = new PixelBuffer(w, h);
  const t = timbersFor(h);
  const { midY, rects } = panesFor(w, h, t);
  paintPlank(p, 0, 0, t.stile, h, { vertical: true, wood, seed: seed + 1, knots: 0.3 });
  paintPlank(p, w - t.stile, 0, t.stile, h, { vertical: true, wood, seed: seed + 2, knots: 0.3 });
  paintPlank(p, t.stile, 0, w - t.stile * 2, t.topRail, { vertical: false, wood, seed: seed + 3, knots: 0.2 });
  paintPlank(p, t.stile, midY, w - t.stile * 2, t.midRail, { vertical: false, wood, seed: seed + 4, knots: 0.15 });
  paintPlank(p, t.stile, h - t.bottomRail, w - t.stile * 2, t.bottomRail, {
    vertical: false,
    wood,
    seed: seed + 5,
    knots: 0.3,
  });
  // Joints: the rails' end grain meets the stiles.
  for (const x of [t.stile, w - t.stile - 1]) {
    p.vline(x, 0, t.topRail, wood.dark);
    p.vline(x, midY, t.midRail, wood.dark);
    p.vline(x, h - t.bottomRail, t.bottomRail, wood.dark);
  }
  // Rounded, lit inner arrises on the stiles (towards the room light).
  for (let y = 0; y < h; y++) {
    p.set(2, y, wood.highlight);
    p.set(w - 3, y, wood.highlight);
  }

  // Outer edges, and the joints where rails meet stiles.
  p.hline(0, 0, w, wood.outline);
  p.hline(0, h - 1, w, wood.outline);
  p.vline(0, 0, h, wood.outline);
  p.vline(w - 1, 0, h, wood.outline);
  p.hline(1, 1, w - 2, wood.highlight);
  p.hline(1, h - 2, w - 2, wood.shadow);
  // Glazing beads: a dark lip round each pane, lit along the lower edge.
  for (const r of rects) {
    p.hline(r.x - 1, r.y - 1, r.w + 2, wood.outline);
    p.hline(r.x - 1, r.y + r.h, r.w + 2, wood.outline);
    p.vline(r.x - 1, r.y, r.h, wood.outline);
    p.vline(r.x + r.w, r.y, r.h, wood.outline);
    p.hline(r.x, r.y + r.h + 1, r.w, wood.shine);
  }

  // Iron butt hinges on the hinge stile.
  const hingeX = hinge === 'left' ? 0 : w - 4;
  // (Leaves sit on the outer edge of the hinge stile, like butt hinges.)
  for (const f of HINGE_FRACTIONS) {
    const cy = Math.round(h * f);
    p.rect(hingeX, cy - 5, 4, 11, IRON.base);
    p.vline(hinge === 'left' ? 0 : w - 1, cy - 6, 13, IRON.outline);
    p.vline(hinge === 'left' ? 1 : w - 2, cy - 5, 11, IRON.light);
    p.hline(hingeX, cy - 6, 4, IRON.outline);
    p.hline(hingeX, cy + 6, 4, IRON.outline);
    p.set(hingeX + (hinge === 'left' ? 2 : 1), cy - 3, IRON.outline);
    p.set(hingeX + (hinge === 'left' ? 2 : 1), cy + 3, IRON.outline);
  }

  // A D-shaped iron pull on the free stile, level with the glazing bar.
  const free = hinge === 'left' ? w - t.stile : 0;
  const hx = free + Math.floor((t.stile - 4) / 2);
  const cy = midY + Math.floor(t.midRail / 2);
  for (const dy of [-9, 8]) {
    p.rect(hx, cy + dy, 4, 3, IRON.outline);
    p.rect(hx + 1, cy + dy, 2, 2, IRON.base);
    p.set(hx + 1, cy + dy, IRON.light);
  }
  const barX = hinge === 'left' ? hx + 2 : hx;
  p.rect(barX, cy - 8, 2, 17, IRON.base);
  p.vline(hinge === 'left' ? barX + 2 : barX - 1, cy - 8, 17, IRON.outline);
  p.vline(barX + (hinge === 'left' ? 0 : 1), cy - 7, 14, IRON.shine);
  return p.toTexture();
}

/** The panes' tint, edge shading and stair-stepped reflection streaks. */
function drawSashGlass(w: number, h: number) {
  const p = new PixelBuffer(w, h);
  const { rects } = panesFor(w, h, timbersFor(h));
  const tint = Math.round(GLASS.tintAlpha * 255);
  const shade = Math.round(GLASS.edgeShadeAlpha * 255);
  for (const r of rects) {
    p.rect(r.x, r.y, r.w, r.h, GLASS.tint, tint);
    p.rect(r.x, r.y, r.w, 2, GLASS.edgeShade, shade);
    p.rect(r.x, r.y, 1, r.h, GLASS.edgeShade, shade);
    const streaks = [
      { start: 0.14, width: 3, alpha: GLASS.highlightAlpha },
      { start: 0.26, width: 1, alpha: GLASS.highlightAlpha * 0.7 },
      { start: 0.68, width: 2, alpha: GLASS.highlightAlpha * 0.5 },
    ];
    for (const s of streaks) {
      const baseX = r.x + r.w * s.start;
      for (let row = 0; row < r.h; row += 2) {
        const x = Math.round(baseX + (r.h - row) * 0.35);
        for (let i = 0; i < s.width; i++) {
          const px = x + i;
          if (px >= r.x && px < r.x + r.w) {
            p.set(px, r.y + row, GLASS.highlight, Math.round(s.alpha * 255));
            p.set(px, r.y + row + 1, GLASS.highlight, Math.round(s.alpha * 255));
          }
        }
      }
    }
  }
  return p.toTexture();
}

interface SashParts {
  side: Side;
  glass: PerspectiveMesh;
  drops: PerspectiveMesh;
  wood: PerspectiveMesh;
  quad: Quad | null;
}

// The sashes keep their vertices on whole pixels (the renderer doesn't round, so the world's sway can move smoothly).
const meshOptions = () => ({ texture: Texture.EMPTY, verticesX: 14, verticesY: 14, roundPixels: true });

/**
 * The two hinged sashes. Closed, they meet in the middle of the opening;
 * opening swings them outward on their hinges (see `casement.ts`). Tap a
 * sash, or the meeting stiles of the closed window, to toggle it.
 *
 * Rain and snow on the glass are simulated on the flat, closed pane
 * (`glassRect`), rendered to a texture, and mapped onto each sash so the
 * drops swing with the glass.
 */
export class CasementSashes {
  readonly container = new Container({ label: 'casement-sashes' });

  private readonly parts: SashParts[];
  private dropsTexture: RenderTexture | null = null;
  /** The drops texture was cleared with no drops on the glass: nothing to redraw until it's wet again. */
  private dry = false;
  private geometry: CasementGeometry | null = null;
  private wood: WoodPalette = RUSTIC_THEME.wood;
  private flatWidth = 0;
  private flatHeight = 0;
  private leftWidth = 0;
  private angle = -1;

  constructor(
    private readonly state: WindowState,
    /** The container of drops to draw on the glass (rendered off-screen). */
    private readonly glassDrops: Container,
    onActivate: () => void,
  ) {
    this.parts = (['left', 'right'] as const).map((side) => {
      const part: SashParts = {
        side,
        glass: new PerspectiveMesh(meshOptions()),
        drops: new PerspectiveMesh(meshOptions()),
        wood: new PerspectiveMesh(meshOptions()),
        quad: null,
      };
      this.container.addChild(part.glass, part.drops, part.wood);
      return part;
    });
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = { contains: (x: number, y: number) => this.hits(x, y) };
    this.container.on('pointertap', onActivate);
  }

  setTheme(theme: FrameTheme): void {
    if (theme.wood === this.wood) return;
    this.wood = theme.wood;
    if (this.flatWidth > 0) this.redraw();
  }

  /** The flat, closed glass plane the drop simulation runs on (art px). */
  get glassRect(): Rectangle {
    return new Rectangle(0, 0, this.flatWidth, this.flatHeight);
  }

  layout(clear: ClearOpening, devicePixelRatio: number): void {
    const fs = clear.frameScale;
    const clearWidth = Math.round(clear.width / fs);
    const clearHeight = Math.round(clear.height / fs);
    this.flatWidth = clearWidth + SASH_TUCK * 2;
    this.flatHeight = clearHeight + SASH_TUCK * 2;
    this.leftWidth = Math.floor(this.flatWidth / 2);
    this.geometry = casementGeometry(0, 0, this.flatWidth, this.flatHeight);
    this.container.scale.set(fs);
    this.container.position.set(
      snapToDevicePixel(clear.x - SASH_TUCK * fs, devicePixelRatio),
      snapToDevicePixel(clear.y - SASH_TUCK * fs, devicePixelRatio),
    );

    this.dropsTexture?.destroy(true);
    this.dry = false;
    this.dropsTexture = RenderTexture.create({
      width: this.flatWidth,
      height: this.flatHeight,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false,
    });
    const source = this.dropsTexture.source;
    const [left, right] = this.parts;
    this.swap(left.drops, new Texture({ source, frame: new Rectangle(0, 0, this.leftWidth, this.flatHeight) }), false);
    this.swap(
      right.drops,
      new Texture({ source, frame: new Rectangle(this.leftWidth, 0, this.flatWidth - this.leftWidth, this.flatHeight) }),
      false,
    );
    this.redraw();
    this.angle = -1;
    this.update();
  }

  /** Swing the sashes to match the window state (whole-art-pixel corners). */
  update(): void {
    const g = this.geometry;
    if (!g) return;
    const angle = this.state.openness * g.openAngle;
    if (angle === this.angle) return;
    this.angle = angle;
    for (const part of this.parts) {
      const q = sashQuad(g, part.side, angle);
      const r = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
      const quad: Quad = {
        topLeft: r(q.topLeft),
        topRight: r(q.topRight),
        bottomRight: r(q.bottomRight),
        bottomLeft: r(q.bottomLeft),
      };
      part.quad = quad;
      for (const mesh of [part.glass, part.drops, part.wood]) {
        mesh.setCorners(
          quad.topLeft.x,
          quad.topLeft.y,
          quad.topRight.x,
          quad.topRight.y,
          quad.bottomRight.x,
          quad.bottomRight.y,
          quad.bottomLeft.x,
          quad.bottomLeft.y,
        );
      }
    }
  }

  /**
   * Draw the drops onto the flat glass texture. Call once per frame with how
   * many drops there are: a dry pane (fair weather, or an open window that
   * has dried off) is cleared once and then left alone.
   */
  render(renderer: Renderer, drops: number): void {
    if (!this.dropsTexture || (drops === 0 && this.dry)) return;
    renderer.render({ container: this.glassDrops, target: this.dropsTexture, clear: true });
    this.dry = drops === 0;
  }

  private redraw(): void {
    const [left, right] = this.parts;
    const rightWidth = this.flatWidth - this.leftWidth;
    this.swap(left.wood, drawSashWood(this.wood, this.leftWidth, this.flatHeight, 'left', 101), true);
    this.swap(right.wood, drawSashWood(this.wood, rightWidth, this.flatHeight, 'right', 211), true);
    this.swap(left.glass, drawSashGlass(this.leftWidth, this.flatHeight), true);
    this.swap(right.glass, drawSashGlass(rightWidth, this.flatHeight), true);
    this.angle = -1;
    this.update();
  }

  private swap(mesh: PerspectiveMesh, texture: Texture, destroySource: boolean): void {
    const old = mesh.texture;
    mesh.texture = texture;
    if (old && old !== Texture.EMPTY) old.destroy(destroySource);
  }

  /** Open sashes are tappable anywhere; a closed window by its meeting stiles and bottom rails. */
  private hits(x: number, y: number): boolean {
    if (this.state.openness < 0.02) {
      const t = timbersFor(this.flatHeight);
      const nearMeeting = Math.abs(x - this.leftWidth) <= t.stile + 4;
      const onBottomRail = y >= this.flatHeight - SASH_TUCK - t.bottomRail - 2;
      return (nearMeeting || onBottomRail) && x >= 0 && x <= this.flatWidth && y >= 0 && y <= this.flatHeight;
    }
    return this.parts.some((part) => part.quad !== null && quadContains(part.quad, x, y));
  }
}
