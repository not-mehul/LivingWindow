import { MeshPlane, type Texture } from 'pixi.js';
import { createNearestTexture, PixelCanvas } from '../core/pixelTexture';
import { valueNoise } from '../scene/common/paint';
import { pixelHash } from '../sprites/raster';
import { LINEN } from './palette';

const hex = (c: string) => Number.parseInt(c.slice(1), 16);
const rgba = (c: number) => ((255 << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
/** Linen, outline to highlight, as pixels. */
const TONES = [LINEN.outline, LINEN.shadow, LINEN.dark, LINEN.base, LINEN.light, LINEN.highlight].map((c) => rgba(hex(c)));
/** The hem's stitching. */
const STITCH = rgba(hex(LINEN.light));

/**
 * Paint the curtain into `out` (W×H pixels): linen drawn back to the right
 * of the window, gathered tight at the top and falling in pleats that fan
 * out towards the hem, each pleat lit on one face and shadowed on the
 * other; soft diagonal creases where it's bunched at the top; the leading
 * edge turning away from the light; a weighted hem that follows the folds,
 * stitched. `phase` shifts the pleats, as the cloth moves.
 */
export function paintCurtain(out: Uint32Array, W: number, H: number, phase: number): void {
  out.fill(0);
  const hemTop = H - 6;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    // Narrow where it's gathered, swelling lower down.
    const s = Math.min(1, Math.max(0, (t - 0.03) / 0.5));
    const ease = s * s * (3 - 2 * s);
    // The pleats sway more the lower they hang.
    const drift = phase * (0.3 + t * 1.4);
    const width = Math.round(11 + (W - 12) * ease + Math.sin(t * 9 + drift * 0.7) * 1.4 * ease);
    const left = W - width;
    const pleats = 2.6 + ease * 2.6;
    const row = y * W;
    for (let x = left; x < W; x++) {
      const u = (x - left) / width;
      // Each pleat: a ridge catching the light, then a face turned away into shadow.
      const fold = Math.sin(u * Math.PI * 2 * pleats * 0.5 + 0.7 + drift);
      const ridge = Math.max(0, Math.sin(u * Math.PI * 2 * pleats * 0.5 + 1.25 + drift)) ** 6;
      let shade = 2.9 + fold * 1.75 + ridge * 1.1;
      // The leading edge turns away from the light; the back edge is in the wall's shade.
      shade -= Math.max(0, 1 - (x - left) / 3) * 1.7 + (u > 0.88 ? 0.7 : 0);
      // Creases where it's bunched at the top: short diagonal shadows.
      if (t < 0.28 && Math.abs(((u * 5 + t * 14 + Math.floor(u * 5) * 0.37) % 1) - 0.5) < 0.07) shade -= 0.9 * (1 - t / 0.28);
      // The weave's slubs.
      shade += (valueNoise(x, y * 3, 4, 913) - 0.5) * 0.5;
      // The hem: a turned-up band, weighted, its bottom edge following the folds.
      const hemEdge = H - 1 - Math.round(Math.max(0, -fold) * 1.5);
      if (y > hemEdge) continue;
      if (y >= hemTop - Math.round(Math.max(0, -fold) * 1.5)) shade -= 0.5;
      out[row + x] = TONES[Math.max(1, Math.min(5, Math.round(shade)))];
      if (y === hemEdge) out[row + x] = TONES[0];
    }
    out[row + left] = TONES[0];
    // A lit ridge just inside the leading edge.
    if (left + 3 < W && pixelHash(left + 3, y, 3) < 0.6) out[row + left + 3] = TONES[5];
    // Stitching along the hem.
    if (y === hemTop + 1) for (let x = left + 2; x < W; x += 2) if (out[row + x]) out[row + x] = STITCH;
  }
}

/** How much the curtain stirs (art px at its foot): a little even shut in, more with the window open, most in a blow. */
export function curtainStir(openness: number, wind: number): number {
  return (0.25 + openness * openness * (0.4 + 1.6 * Math.min(1, Math.abs(wind)))) * 5;
}

const COLS = 8;
const ROWS = 28;

/**
 * The curtain on the right of the window. Its pleats shift as the cloth
 * moves; it sways from its gathered top, a ripple running down it; and when
 * the wind comes through the open window, the free lower part billows out
 * into the room and lifts, the leading edge most.
 */
export class Curtain {
  readonly mesh: MeshPlane;
  private readonly canvas: PixelCanvas;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly texture: Texture;
  private readonly base: Float32Array;
  private phase = 0;
  private drawnPhase = Number.NaN;
  private stir = 0;
  private lastTime = Number.NaN;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = new PixelCanvas(width, height);
    this.image = this.canvas.ctx.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.texture = createNearestTexture(this.canvas.canvas);
    this.redraw();
    this.mesh = new MeshPlane({ texture: this.texture, verticesX: COLS, verticesY: ROWS });
    this.base = new Float32Array(this.mesh.geometry.positions);
  }

  update(time: number, wind: number, openness: number): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    // Ease towards the wanted amount, so a gust builds and dies away.
    const want = curtainStir(openness, wind);
    this.stir += (want - this.stir) * Math.min(1, dt * 1.5);
    const amp = this.stir;
    const dir = wind < 0 ? 1 : -1;
    // A gust swells and fades every so often.
    const gust = 0.7 + 0.3 * Math.sin(time * 0.37) + 0.25 * Math.sin(time * 0.91 + 1.3);
    const positions = this.mesh.geometry.positions;
    const { base } = this;
    for (let j = 0; j < ROWS; j++) {
      const t = j / (ROWS - 1);
      const hang = t ** 1.5;
      // A ripple running down the cloth.
      const wave = Math.sin(time * 1.3 - t * 3.2) * 0.6 + Math.sin(time * 2.1 - t * 5 + 0.8) * 0.3;
      for (let i = 0; i < COLS; i++) {
        const k = (j * COLS + i) * 2;
        const u = i / (COLS - 1);
        // The leading (left) edge is free; the back edge hangs against the wall.
        const free = 1 - u * 0.65;
        const billow = amp * hang * free * (wave * 0.6 + gust * Math.min(1, Math.abs(wind) * 1.5 + 0.2));
        positions[k] = base[k] + dir * billow;
        // Lifting a little at the hem as it billows.
        positions[k + 1] = base[k + 1] - Math.max(0, billow) * 0.18 * t * t;
      }
    }
    this.mesh.geometry.getBuffer('aPosition').update();
    // The pleats shift with the cloth: quicker in a breeze.
    this.phase += dt * (0.05 + amp * 0.09) * (0.6 + 0.4 * Math.sin(time * 0.7));
    if (Math.abs(this.phase - this.drawnPhase) > 0.04) this.redraw();
  }

  destroy(): void {
    this.mesh.destroy();
    this.texture.destroy(true);
  }

  private redraw(): void {
    this.drawnPhase = this.phase;
    paintCurtain(this.pixels, this.width, this.height, this.phase);
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }
}
