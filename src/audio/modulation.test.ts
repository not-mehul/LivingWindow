import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { wanderCurve } from './modulation';

describe('audio-clock wander', () => {
  const curve = wanderCurve(16, 200, createRng(5));

  it('stays within ±1', () => {
    for (const v of curve) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('moves smoothly, with no steps', () => {
    for (let i = 1; i < curve.length; i++) expect(Math.abs(curve[i] - curve[i - 1])).toBeLessThan(0.02);
  });

  it('loops seamlessly', () => {
    expect(Math.abs(curve[0] - curve[curve.length - 1])).toBeLessThan(0.02);
  });
});
