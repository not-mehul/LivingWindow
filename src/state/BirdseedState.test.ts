import { describe, expect, it, vi } from 'vitest';
import { BIRDSEED_MAX_ATTRACTION } from '../config';
import { BirdseedState } from './BirdseedState';

describe('BirdseedState', () => {
  it('starts empty with no attraction bonus', () => {
    const seed = new BirdseedState();
    expect(seed.level).toBe(0);
    expect(seed.isStocked).toBe(false);
    expect(seed.stage).toBe(0);
    expect(seed.attraction).toBe(1);
  });

  it('fills to the brim on a single click', () => {
    const seed = new BirdseedState();
    const filled = vi.fn();
    seed.on('filled', filled);
    expect(seed.fill()).toBe(true);
    expect(seed.level).toBe(1);
    expect(seed.isFull).toBe(true);
    expect(seed.stage).toBe(3);
    expect(seed.attraction).toBe(BIRDSEED_MAX_ATTRACTION);
    expect(filled).toHaveBeenCalledExactlyOnceWith({ level: 1 });
  });

  it('refuses to overfill a full bowl', () => {
    const seed = new BirdseedState();
    seed.fill();
    const change = vi.fn();
    seed.on('change', change);
    expect(seed.fill()).toBe(false);
    expect(change).not.toHaveBeenCalled();
  });

  it('is eaten down by pecking birds and reports depletion once', () => {
    const seed = new BirdseedState();
    const depleted = vi.fn();
    seed.on('depleted', depleted);
    seed.fill();

    expect(seed.consume(0.5)).toBe(0.5);
    expect(seed.stage).toBe(2);
    expect(seed.attraction).toBeGreaterThan(1);
    expect(seed.attraction).toBeLessThan(BIRDSEED_MAX_ATTRACTION);

    expect(seed.consume(0.3)).toBeCloseTo(0.3);
    expect(seed.stage).toBe(1);

    expect(seed.consume(5)).toBeCloseTo(0.2);
    expect(seed.level).toBe(0);
    expect(seed.consume(0.1)).toBe(0);
    expect(depleted).toHaveBeenCalledOnce();
  });

  it('keeps a strong pull even when nearly empty', () => {
    const seed = new BirdseedState();
    seed.fill(0.01);
    expect(seed.attraction).toBeGreaterThan(BIRDSEED_MAX_ATTRACTION / 2);
  });

  it('reports level changes with the previous value', () => {
    const seed = new BirdseedState();
    const change = vi.fn();
    seed.on('change', change);
    seed.fill(0.4);
    seed.consume(0.1);
    expect(change.mock.calls.map(([e]) => e)).toEqual([
      { level: 0.4, previous: 0 },
      { level: expect.closeTo(0.3), previous: 0.4 },
    ]);
  });
});
