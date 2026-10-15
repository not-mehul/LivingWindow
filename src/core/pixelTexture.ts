import { CanvasSource, Texture } from 'pixi.js';

/** Thin wrapper over a 2D canvas for drawing pixel art one art-pixel at a time. */
export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported in this browser.');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  px(x: number, y: number, color: string): void {
    this.rect(x, y, 1, 1, color);
  }

  hline(x: number, y: number, w: number, color: string): void {
    this.rect(x, y, w, 1, color);
  }

  vline(x: number, y: number, h: number, color: string): void {
    this.rect(x, y, 1, h, color);
  }

  /**
   * Draw a sprite from rows of characters, where each character is looked up
   * in `palette` ('.' or any unmapped character is transparent).
   */
  stamp(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, string>>): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const color = palette[row[dx]];
        if (color) this.px(x + dx, y + dy, color);
      }
    });
  }

  toTexture(): Texture {
    return createNearestTexture(this.canvas);
  }
}

/** Upload a canvas as a crisp, nearest-neighbour sampled texture. */
export function createNearestTexture(canvas: HTMLCanvasElement): Texture {
  const source = new CanvasSource({
    resource: canvas,
    scaleMode: 'nearest',
    antialias: false,
    resolution: 1,
  });
  return new Texture({ source });
}

/** Build a texture by drawing into a fresh `PixelCanvas`. */
export function drawPixelTexture(
  width: number,
  height: number,
  draw: (canvas: PixelCanvas) => void,
): Texture {
  const canvas = new PixelCanvas(width, height);
  draw(canvas);
  return canvas.toTexture();
}
