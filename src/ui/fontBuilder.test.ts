import { describe, expect, it } from 'vitest';
import { buildPixelFont, glyphRects, PIXEL_UNITS, tableChecksum } from './fontBuilder';
import { CAP_ROWS, EM_ROWS, GLYPHS } from './pixelType';

/** Read a font's table directory. */
function tables(font: ArrayBuffer): Map<string, { offset: number; length: number; checksum: number }> {
  const view = new DataView(font);
  const n = view.getUint16(4);
  const out = new Map<string, { offset: number; length: number; checksum: number }>();
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...new Uint8Array(font, at, 4));
    out.set(tag, { checksum: view.getUint32(at + 4), offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  return out;
}

/** Look a character up in the format 4 cmap. */
function glyphIndex(font: ArrayBuffer, ch: string): number {
  const view = new DataView(font);
  const cmap = tables(font).get('cmap')!.offset;
  const sub = cmap + view.getUint32(cmap + 8);
  const segCount = view.getUint16(sub + 6) / 2;
  const code = ch.charCodeAt(0);
  for (let i = 0; i < segCount; i++) {
    const end = view.getUint16(sub + 14 + i * 2);
    const start = view.getUint16(sub + 16 + segCount * 2 + i * 2);
    if (code >= start && code <= end) return (code + view.getUint16(sub + 16 + segCount * 4 + i * 2)) & 0xffff;
  }
  return 0;
}

describe('the pixel UI font', () => {
  const font = buildPixelFont();

  it('is a well-formed TrueType file', () => {
    const view = new DataView(font);
    expect(view.getUint32(0)).toBe(0x00010000);
    const dir = tables(font);
    expect([...dir.keys()]).toEqual(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
    for (const [tag, t] of dir) {
      expect(t.offset % 4, tag).toBe(0);
      const data = new Uint8Array(font, t.offset, t.length);
      if (tag !== 'head') expect(tableChecksum(data), tag).toBe(t.checksum);
    }
    expect(dir.get('head')!.length).toBe(54);
    expect(dir.get('hhea')!.length).toBe(36);
    expect(dir.get('maxp')!.length).toBe(32);
    expect(dir.get('OS/2')!.length).toBe(96);
    expect(dir.get('post')!.length).toBe(32);
    // The whole file sums to the magic number once the head adjustment is in.
    expect(tableChecksum(new Uint8Array(font))).toBe(0xb1b0afba);
  });

  it('maps every character to its own glyph, with its advance', () => {
    const view = new DataView(font);
    const dir = tables(font);
    const numGlyphs = view.getUint16(dir.get('maxp')!.offset + 4);
    expect(numGlyphs).toBe(Object.keys(GLYPHS).length + 1);
    const seen = new Set<number>();
    for (const [ch, glyph] of Object.entries(GLYPHS)) {
      const id = glyphIndex(font, ch);
      expect(id, ch).toBeGreaterThan(0);
      seen.add(id);
      const advance = view.getUint16(dir.get('hmtx')!.offset + id * 4);
      expect(advance, ch).toBe((glyph.width + 1) * PIXEL_UNITS);
    }
    expect(seen.size).toBe(Object.keys(GLYPHS).length);
    expect(glyphIndex(font, '☃')).toBe(0);
  });

  it('covers each pixel of ink exactly once', () => {
    for (const [ch, glyph] of Object.entries(GLYPHS)) {
      const ink = new Set<string>();
      glyph.rows.forEach((row, r) => [...row].forEach((c, x) => c === '#' && ink.add(`${x},${r}`)));
      const covered: string[] = [];
      for (const rect of glyphRects(glyph)) for (let r = rect.r0; r < rect.r1; r++) for (let x = rect.x0; x < rect.x1; x++) covered.push(`${x},${r}`);
      expect(new Set(covered).size, ch).toBe(covered.length);
      expect(new Set(covered), ch).toEqual(ink);
    }
  });
});

describe('the pixel typeface', () => {
  it('draws every glyph within the grid, in ink and space only', () => {
    for (const [ch, glyph] of Object.entries(GLYPHS)) {
      expect(glyph.rows.length, ch).toBeLessThanOrEqual(EM_ROWS - 1);
      for (const row of glyph.rows) {
        expect(row, ch).toMatch(/^[#.]*$/);
        expect(row.length, ch).toBeLessThanOrEqual(glyph.width);
      }
    }
    // Capitals stand the full cap height; lowercase x-height letters start lower.
    expect(GLYPHS.H.rows.length).toBe(CAP_ROWS);
    expect(GLYPHS.x.rows[0]).toBe('');
  });

  it('has every character the panel shows', () => {
    // Everything in the panel's source text (code included) must be drawable.
    const sources = import.meta.glob(['./Overlay.ts', './SoundPanel.ts', '../state/timeOfDay.ts', '../state/Weather.ts', '../audio/mixer.ts', '../landscapes/types.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(6);
    const missing = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const ch of text) {
        if (/\s/.test(ch)) continue;
        if (!(ch in GLYPHS)) missing.add(ch);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
