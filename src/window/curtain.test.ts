import { describe, expect, it } from 'vitest';
import { curtainStir, paintCurtain } from './Curtain';

describe('the curtain', () => {
  it('hangs in pleats that shift as it moves', () => {
    const W = 40;
    const H = 200;
    const a = new Uint32Array(W * H);
    const b = new Uint32Array(W * H);
    paintCurtain(a, W, H, 0);
    paintCurtain(b, W, H, 0.6);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    expect(diff).toBeGreaterThan(W * H * 0.1);
    // Gathered narrow at the top, full width lower down.
    const filled = (y: number) => Array.from(a.subarray(y * W, (y + 1) * W)).filter((v) => v !== 0).length;
    expect(filled(2)).toBeLessThan(filled(150));
    // Several tones across a row: folds, not a flat sheet.
    expect(new Set(Array.from(a.subarray(150 * W, 151 * W)).filter((v) => v)).size).toBeGreaterThanOrEqual(3);
  });

  it('stirs a little shut in, more with the window open, most in a blow', () => {
    expect(curtainStir(0, 0.8)).toBeGreaterThan(0);
    expect(curtainStir(1, 0.1)).toBeGreaterThan(curtainStir(0, 0.1));
    expect(curtainStir(1, 0.9)).toBeGreaterThan(curtainStir(1, 0.1) * 1.8);
  });
});
