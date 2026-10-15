import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { catStateDuration, chooseCatState, type CatContext, type CatState } from './catBrain';

const ctx: CatContext = { birdsOnSill: 0, elapsed: 10, visitLength: 120, wet: false };

describe('cat behaviour', () => {
  it('leaves when the visit is over or it starts to rain', () => {
    expect(chooseCatState('sit', { ...ctx, elapsed: 200 })).toBe('exit');
    expect(chooseCatState('nap', { ...ctx, wet: true })).toBe('exit');
  });

  it('stalks birds, then pounces, then sits back down', () => {
    const rng = createRng(4);
    let stalks = 0;
    for (let i = 0; i < 200; i++) if (chooseCatState('sit', { ...ctx, birdsOnSill: 2 }, rng) === 'stalk') stalks++;
    expect(stalks).toBeGreaterThan(120);
    expect(chooseCatState('stalk', ctx)).toBe('pounce');
    expect(chooseCatState('pounce', ctx)).toBe('sit');
  });

  it('wakes from a nap with a stretch more often than not', () => {
    const rng = createRng(5);
    let stretches = 0;
    for (let i = 0; i < 500; i++) if (chooseCatState('nap', ctx, rng) === 'stretch') stretches++;
    expect(stretches / 500).toBeGreaterThan(0.3);
  });

  it('never naps twice in a row or stretches twice in a row', () => {
    const rng = createRng(6);
    for (let i = 0; i < 300; i++) {
      expect(chooseCatState('nap', ctx, rng)).not.toBe('nap');
      expect(chooseCatState('stretch', ctx, rng)).not.toBe('stretch');
    }
  });

  it('naps for a good long while', () => {
    const states: CatState[] = ['sit', 'stretch', 'nap', 'pounce'];
    for (const s of states) expect(catStateDuration(s)).toBeGreaterThan(0);
    expect(catStateDuration('nap', () => 0)).toBeGreaterThanOrEqual(25);
  });
});
