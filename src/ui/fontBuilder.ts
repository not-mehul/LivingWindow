import { CAP_ROWS, EM_ROWS, GLYPHS, type PixelGlyph } from './pixelType';

/**
 * Turns the bitmap typeface into a small TrueType font, in the browser, so
 * the panel can use it as ordinary CSS text. Every glyph's ink is merged
 * into rectangles (runs across a row, stacked down while they line up) and
 * each rectangle becomes one square contour; one pixel is a tenth of the
 * em, so text at 10, 20 or 30 CSS px lands exactly on the pixel grid.
 */

/** Font units per pixel, and per em. */
export const PIXEL_UNITS = 100;
export const UNITS_PER_EM = PIXEL_UNITS * EM_ROWS;
const ASCENT = PIXEL_UNITS * (CAP_ROWS + 1);
const DESCENT = UNITS_PER_EM - ASCENT;

interface Rect {
  x0: number;
  x1: number;
  /** Rows, top (inclusive) to bottom (exclusive). */
  r0: number;
  r1: number;
}

/** A glyph's ink as rectangles: horizontal runs merged down through rows where they repeat exactly. */
export function glyphRects(glyph: PixelGlyph): Rect[] {
  const done: Rect[] = [];
  let open: Rect[] = [];
  const rows = glyph.rows.length;
  for (let r = 0; r <= rows; r++) {
    const row = glyph.rows[r] ?? '';
    const runs: Array<[number, number]> = [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      const start = c;
      while (c < row.length && row[c] === '#') c++;
      runs.push([start, c]);
    }
    const next: Rect[] = [];
    for (const [x0, x1] of runs) {
      const above = open.find((o) => o.x0 === x0 && o.x1 === x1);
      if (above) {
        above.r1 = r + 1;
        next.push(above);
        open = open.filter((o) => o !== above);
      } else next.push({ x0, x1, r0: r, r1: r + 1 });
    }
    done.push(...open);
    open = next;
  }
  done.push(...open);
  return done;
}

/** A growable big-endian byte writer. */
class Bytes {
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  length = 0;

  private grow(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
  }

  u8(v: number): this {
    this.grow(1);
    this.buf[this.length++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }

  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }

  u32(v: number): this {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff);
  }

  bytes(data: Uint8Array): this {
    this.grow(data.length);
    this.buf.set(data, this.length);
    this.length += data.length;
    return this;
  }

  pad4(): this {
    while (this.length % 4) this.u8(0);
    return this;
  }

  done(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.length);
  }
}

/** The sum of a table's big-endian 32-bit words (zero-padded), as TrueType checks it. */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

function utf16be(text: string): Uint8Array {
  const out = new Bytes();
  for (const ch of text) out.u16(ch.charCodeAt(0));
  return out.done();
}

interface BuiltGlyph {
  code: number;
  advance: number;
  rects: Rect[];
}

/** Build the TrueType font file for `family` from the bitmap glyphs. */
export function buildPixelFont(family = 'Living Window Pixel', glyphs: Readonly<Record<string, PixelGlyph>> = GLYPHS): ArrayBuffer {
  const list: BuiltGlyph[] = Object.entries(glyphs)
    .map(([ch, glyph]) => ({ code: ch.codePointAt(0)!, advance: (glyph.width + 1) * PIXEL_UNITS, rects: glyphRects(glyph) }))
    .filter((g) => g.code <= 0xffff)
    .sort((a, b) => a.code - b.code);
  // Glyph 0 is .notdef: a hollow box would be kinder, but an empty advance is enough.
  const all: BuiltGlyph[] = [{ code: -1, advance: 4 * PIXEL_UNITS, rects: [] }, ...list];

  // glyf + loca
  const glyf = new Bytes();
  const loca: number[] = [];
  let xMin = 0;
  let xMax = 0;
  let yMin = 0;
  let yMax = 0;
  let maxPoints = 0;
  let maxContours = 0;
  const bounds: Array<{ xMin: number; xMax: number }> = [];
  for (const glyph of all) {
    loca.push(glyf.length);
    if (glyph.rects.length === 0) {
      bounds.push({ xMin: 0, xMax: 0 });
      continue;
    }
    const px = (c: number) => c * PIXEL_UNITS;
    const py = (r: number) => (CAP_ROWS - r) * PIXEL_UNITS;
    const gx0 = Math.min(...glyph.rects.map((r) => px(r.x0)));
    const gx1 = Math.max(...glyph.rects.map((r) => px(r.x1)));
    const gy0 = Math.min(...glyph.rects.map((r) => py(r.r1)));
    const gy1 = Math.max(...glyph.rects.map((r) => py(r.r0)));
    bounds.push({ xMin: gx0, xMax: gx1 });
    xMin = Math.min(xMin, gx0);
    xMax = Math.max(xMax, gx1);
    yMin = Math.min(yMin, gy0);
    yMax = Math.max(yMax, gy1);
    glyf.i16(glyph.rects.length).i16(gx0).i16(gy0).i16(gx1).i16(gy1);
    glyph.rects.forEach((_, i) => glyf.u16(i * 4 + 3));
    glyf.u16(0); // no instructions
    const points: Array<[number, number]> = [];
    // Clockwise outlines (TrueType's filled direction): top-left, top-right, bottom-right, bottom-left.
    for (const r of glyph.rects) points.push([px(r.x0), py(r.r0)], [px(r.x1), py(r.r0)], [px(r.x1), py(r.r1)], [px(r.x0), py(r.r1)]);
    for (let i = 0; i < points.length; i++) glyf.u8(0x01); // on-curve, full 16-bit deltas
    let last = 0;
    for (const [px0] of points) {
      glyf.i16(px0 - last);
      last = px0;
    }
    last = 0;
    for (const [, py0] of points) {
      glyf.i16(py0 - last);
      last = py0;
    }
    glyf.pad4();
    maxPoints = Math.max(maxPoints, points.length);
    maxContours = Math.max(maxContours, glyph.rects.length);
  }
  loca.push(glyf.length);
  const locaTable = new Bytes();
  for (const offset of loca) locaTable.u32(offset);

  const numGlyphs = all.length;
  const advanceMax = Math.max(...all.map((g) => g.advance));

  const head = new Bytes()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment, filled in at the end
    .u32(0x5f0f3cf5)
    .u16(0x000b) // baseline at y=0, lsb at x=0, integer scaling
    .u16(UNITS_PER_EM)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .i16(xMin)
    .i16(yMin)
    .i16(xMax)
    .i16(yMax)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(1) // long loca offsets
    .i16(0);

  const hhea = new Bytes()
    .u32(0x00010000)
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(advanceMax)
    .i16(0)
    .i16(Math.min(...all.map((g, i) => g.advance - bounds[i].xMax)))
    .i16(xMax)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(numGlyphs);

  const hmtx = new Bytes();
  all.forEach((g, i) => hmtx.u16(g.advance).i16(bounds[i].xMin));

  const maxp = new Bytes()
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(maxPoints)
    .u16(maxContours)
    .u16(0)
    .u16(0)
    .u16(2)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0);

  // cmap: format 4, one segment per character, then the closing 0xFFFF segment.
  const segments = [...list.map((g, i) => ({ code: g.code, delta: (i + 1 - g.code + 0x10000) % 0x10000 })), { code: 0xffff, delta: 1 }];
  const segCount = segments.length;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  const sub = new Bytes();
  sub
    .u16(4)
    .u16(16 + segCount * 8)
    .u16(0)
    .u16(segCount * 2)
    .u16(searchRange)
    .u16(Math.floor(Math.log2(segCount)))
    .u16(segCount * 2 - searchRange);
  for (const s of segments) sub.u16(s.code);
  sub.u16(0);
  for (const s of segments) sub.u16(s.code);
  for (const s of segments) sub.u16(s.delta);
  for (let i = 0; i < segCount; i++) sub.u16(0);
  const cmap = new Bytes().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.done());

  // name
  const names: Array<[number, string]> = [
    [1, family],
    [2, 'Regular'],
    [3, `${family} Regular`],
    [4, family],
    [5, 'Version 1.0'],
    [6, family.replace(/[^A-Za-z0-9]/g, '')],
  ];
  const strings = names.map(([, text]) => utf16be(text));
  const name = new Bytes().u16(0).u16(names.length).u16(6 + names.length * 12);
  let offset = 0;
  names.forEach(([id], i) => {
    name.u16(3).u16(1).u16(0x0409).u16(id).u16(strings[i].length).u16(offset);
    offset += strings[i].length;
  });
  for (const s of strings) name.bytes(s);

  const post = new Bytes().u32(0x00030000).u32(0).i16(-PIXEL_UNITS).i16(PIXEL_UNITS).u32(0).u32(0).u32(0).u32(0).u32(0);

  const codes = list.map((g) => g.code);
  const avg = Math.round(list.reduce((s, g) => s + g.advance, 0) / Math.max(1, list.length));
  const os2 = new Bytes()
    .u16(4)
    .i16(avg)
    .u16(400)
    .u16(5)
    .u16(0)
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(75)
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(350)
    .i16(PIXEL_UNITS)
    .i16(250)
    .i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0); // panose
  os2
    .u32(0b11) // Basic Latin, Latin-1 Supplement
    .u32(0)
    .u32(0)
    .u32(0)
    .bytes(new Uint8Array([0x4e, 0x4f, 0x4e, 0x45])) // 'NONE'
    .u16(0x0040) // regular
    .u16(Math.min(...codes))
    .u16(Math.max(...codes))
    .i16(ASCENT)
    .i16(-DESCENT)
    .i16(0)
    .u16(ASCENT)
    .u16(DESCENT)
    .u32(1)
    .u32(0)
    .i16(5 * PIXEL_UNITS)
    .i16(CAP_ROWS * PIXEL_UNITS)
    .u16(0)
    .u16(32)
    .u16(1);

  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.done()],
    ['cmap', cmap.done()],
    ['glyf', glyf.done()],
    ['head', head.done()],
    ['hhea', hhea.done()],
    ['hmtx', hmtx.done()],
    ['loca', locaTable.done()],
    ['maxp', maxp.done()],
    ['name', name.done()],
    ['post', post.done()],
  ];
  tables.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const n = tables.length;
  const dirRange = 16 * 2 ** Math.floor(Math.log2(n));
  const font = new Bytes().u32(0x00010000).u16(n).u16(dirRange).u16(Math.floor(Math.log2(n))).u16(n * 16 - dirRange);
  let at = 12 + n * 16;
  const placed: Array<{ data: Uint8Array; offset: number }> = [];
  for (const [tag, data] of tables) {
    for (const ch of tag) font.u8(ch.charCodeAt(0));
    font.u32(tableChecksum(data)).u32(at).u32(data.length);
    placed.push({ data, offset: at });
    at += Math.ceil(data.length / 4) * 4;
  }
  for (const { data } of placed) font.bytes(data).pad4();
  const out = font.done();
  // The whole-font checksum adjustment lives in 'head'.
  const headAt = placed[tables.findIndex(([tag]) => tag === 'head')].offset;
  const adjust = (0xb1b0afba - tableChecksum(out)) >>> 0;
  new DataView(out.buffer).setUint32(headAt + 8, adjust);
  return out.buffer;
}

/** The family name the stylesheet asks for. */
export const UI_FONT_FAMILY = 'Living Window Pixel';

let loading: Promise<boolean> | null = null;

/**
 * Build and register the interface font (once). Resolves true when it's
 * ready; on any failure the panel simply keeps the system font.
 */
export function loadUiFont(): Promise<boolean> {
  if (loading) return loading;
  loading = (async () => {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    try {
      const face = new FontFace(UI_FONT_FAMILY, buildPixelFont(UI_FONT_FAMILY));
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  })();
  return loading;
}
