import { describe, expect, it } from 'vitest';
import { approach, clamp, easeInOutCubic, snapToDevicePixel } from './math';
import { createRng } from './random';

describe('math helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });

  it('approaches without overshooting', () => {
    expect(approach(0, 1, 0.4)).toBe(0.4);
    expect(approach(0.9, 1, 0.4)).toBe(1);
    expect(approach(1, 0, 0.4)).toBe(0.6);
  });

  it('eases from 0 to 1 symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
  });

  it('snaps to physical device pixels', () => {
    expect(snapToDevicePixel(10.3, 1)).toBe(10);
    expect(snapToDevicePixel(10.3, 2)).toBe(10.5);
  });
});

describe('createRng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(values[0]);
  });
});
