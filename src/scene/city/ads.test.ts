import { describe, expect, it } from 'vitest';
import { PixelBuffer } from '../../core/pixelBuffer';
import { ADS, drawAd, type AdId } from './ads';
import { drawText, FONT_HEIGHT, GLYPHS, glyphFor, textWidth } from './pixelFont';

describe('pixel font', () => {
  it('has well-formed glyphs: every row of a letter the same width, and the face height', () => {
    for (const face of ['small', 'bold'] as const) {
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!?+-%¥ ') {
        const g = glyphFor(ch, face);
        expect(g, `${face} ${ch}`).toBeDefined();
        expect(g!.length).toBe(FONT_HEIGHT[face]);
        for (const row of g!) expect(row.length).toBe(g![0].length);
      }
    }
    for (const g of GLYPHS) {
      expect(g.length).toBe(5);
      for (const row of g) expect(row).toMatch(/^[#.]{5}$/);
    }
  });

  it('measures and draws text', () => {
    expect(textWidth('HI', 'small')).toBe(7);
    const buf = new PixelBuffer(20, 8);
    expect(drawText(buf, 'HI', 1, 1, 0xffffff)).toBe(7);
    expect(buf.isSet(1, 1)).toBe(true);
    expect(buf.isSet(0, 0)).toBe(false);
  });
});

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('ads', () => {
  const sizes: Array<[number, number]> = [
    [72, 31],
    [64, 28],
    [56, 24],
    [68, 90],
    [40, 16],
    [34, 15],
    [76, 7],
  ];
  it('draws every frame of every ad at every size as a full screen, the same each time', { timeout: 60000 }, () => {
    for (const id of Object.keys(ADS) as AdId[]) {
      const frames = Math.min(ADS[id].frames, 8);
      for (const [w, h] of sizes) {
        for (let f = 0; f < frames; f++) {
          const art = drawAd(id, f, w, h, f === 0 ? 'dead-column' : null, 3);
          expect(art.width).toBe(w);
          let empty = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!art.isSet(x, y)) empty++;
          expect(empty).toBe(0);
          expect(same(drawAd(id, f, w, h, f === 0 ? 'dead-column' : null, 3).data, art.data)).toBe(true);
        }
        expect(ADS[id].frameSeconds(0)).toBeGreaterThan(0);
      }
    }
  });

  it('animates: frames differ', () => {
    for (const id of Object.keys(ADS) as AdId[]) {
      const a = drawAd(id, 0, 72, 31).data;
      const b = drawAd(id, ADS[id].frames > 2 ? 2 : 1, 72, 31).data;
      expect(same(a, b)).toBe(false);
    }
  });
});
