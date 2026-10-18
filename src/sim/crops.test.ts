import { describe, expect, it } from 'vitest';
import { cropState, dayOfYear, mazeOpen } from './crops';

const on = (month: number, day: number) => new Date(2026, month - 1, day);

describe('the farm year', () => {
  it('counts days from the new year', () => {
    expect(dayOfYear(on(1, 1))).toBe(0);
    expect(dayOfYear(on(2, 1))).toBe(31);
  });

  it('grows wheat green in spring, gold in summer, and cuts it in August', () => {
    expect(cropState('wheat', on(4, 20)).stage).toBe('growing');
    expect(cropState('wheat', on(4, 20)).ripeness).toBe(0);
    expect(cropState('wheat', on(7, 25)).stage).toBe('ripe');
    expect(cropState('wheat', on(8, 25)).stage).toBe('stubble');
    expect(cropState('wheat', on(10, 1)).stage).toBe('ploughed');
    expect(cropState('wheat', on(5, 1)).height).toBeLessThan(cropState('wheat', on(6, 20)).height);
  });

  it('stands maize tall from midsummer to its harvest, with the maze open', () => {
    expect(cropState('maize', on(3, 1)).stage).toBe('ploughed');
    expect(cropState('maize', on(6, 10)).height).toBeLessThan(0.6);
    expect(mazeOpen(on(8, 20))).toBe(true);
    expect(mazeOpen(on(10, 18))).toBe(true);
    expect(mazeOpen(on(11, 20))).toBe(false);
    expect(cropState('maize', on(10, 18)).ripeness).toBeGreaterThan(cropState('maize', on(8, 1)).ripeness);
  });

  it('changes week by week', () => {
    const a = cropState('wheat', on(6, 1));
    const b = cropState('wheat', on(6, 15));
    expect(b.ripeness).toBeGreaterThan(a.ripeness);
  });
});
