import { describe, expect, it } from 'vitest';
import { PixelBuffer } from './pixelBuffer';

describe('PixelBuffer', () => {
  it('outlines a drawing with ink in the empty pixels round it', () => {
    const p = new PixelBuffer(5, 5);
    p.set(2, 2, 0xff0000);
    p.outline(0x000000);
    expect(p.get(2, 2)).toBe(0xff0000);
    for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) expect(p.get(x, y)).toBe(0);
    expect(p.get(1, 1)).toBe(-1);
  });

  it('draws one buffer into another, clipped, skipping empty pixels', () => {
    const src = new PixelBuffer(3, 3);
    src.set(0, 0, 0x112233);
    src.set(2, 2, 0x445566);
    const dst = new PixelBuffer(4, 4);
    dst.set(1, 1, 0xabcdef);
    dst.draw(src, 2, 2);
    expect(dst.get(2, 2)).toBe(0x112233);
    expect(dst.get(1, 1)).toBe(0xabcdef);
    // (4, 4) falls outside; nothing wraps round.
    expect(dst.get(0, 0)).toBe(-1);
    dst.draw(src, -2, -2, (c) => c + 1);
    expect(dst.get(0, 0)).toBe(0x445567);
  });
});
