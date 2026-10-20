import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { loopedNoise } from './noise';

describe('looping noise', () => {
  it('flows from its last sample into its first without a click', () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const data = loopedNoise(20000, color, createRng(3), 400);
      // The wrap is no bigger a jump than the steps inside the loop.
      let biggest = 0;
      for (let i = 1; i < data.length; i++) biggest = Math.max(biggest, Math.abs(data[i] - data[i - 1]));
      expect(Math.abs(data[0] - data[data.length - 1])).toBeLessThanOrEqual(biggest);
    }
  });

  it('keeps brown noise smooth across the wrap', () => {
    const data = loopedNoise(20000, 'brown', createRng(9), 400);
    let typical = 0;
    for (let i = 1; i < data.length; i++) typical += Math.abs(data[i] - data[i - 1]);
    typical /= data.length - 1;
    expect(Math.abs(data[0] - data[data.length - 1])).toBeLessThan(typical * 6);
  });
});
