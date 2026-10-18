import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { chooseNextState, PERCHED_STATES, stateDuration, transitionWeights, type BirdState, type PerchContext } from './birdBrain';

const base: PerchContext = {
  species: 'sparrow',
  onSill: true,
  atBowl: false,
  seedAvailable: false,
  canHop: true,
  restlessness: 0,
};

function distribution(ctx: PerchContext, from: BirdState = 'perch-idle', n = 5000) {
  const rng = createRng(1);
  const counts: Partial<Record<BirdState, number>> = {};
  for (let i = 0; i < n; i++) {
    const s = chooseNextState(from, ctx, rng);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return (s: BirdState) => (counts[s] ?? 0) / n;
}

describe('bird FSM', () => {
  it('only moves between perched states or takes off', () => {
    const rng = createRng(2);
    for (const from of PERCHED_STATES) {
      for (let i = 0; i < 200; i++) {
        const next = chooseNextState(from, { ...base, restlessness: rng() }, rng);
        expect([...PERCHED_STATES, 'take-off']).toContain(next);
      }
    }
  });

  it('pecks far more when standing at a stocked bowl', () => {
    const hungry = distribution({ ...base, atBowl: true, seedAvailable: true });
    const empty = distribution({ ...base, atBowl: true, seedAvailable: false });
    expect(hungry('peck-seed')).toBeGreaterThan(empty('peck-seed') * 3);
  });

  it('hops towards the bowl when there is seed out', () => {
    const lured = distribution({ ...base, seedAvailable: true });
    const plain = distribution(base);
    expect(lured('hop')).toBeGreaterThan(plain('hop') * 1.5);
  });

  it('grows restless and leaves', () => {
    const fresh = distribution({ ...base, restlessness: 0 });
    const tired = distribution({ ...base, restlessness: 1 });
    expect(fresh('take-off')).toBeLessThan(0.02);
    expect(tired('take-off')).toBeGreaterThan(0.25);
  });

  it('can always eventually leave, wherever it is', () => {
    const rng = createRng(3);
    let state: BirdState = 'perch-idle';
    let steps = 0;
    for (; steps < 500 && state !== 'take-off'; steps++) {
      state = chooseNextState(state, { ...base, restlessness: Math.min(1, steps / 40) }, rng);
    }
    expect(state).toBe('take-off');
  });

  it('never hops where there is no room', () => {
    for (const [state] of transitionWeights('perch-idle', { ...base, canHop: false })) expect(state).not.toBe('hop');
  });

  it('gives every settled state a positive duration', () => {
    for (const state of PERCHED_STATES) expect(stateDuration(state, 'pigeon')).toBeGreaterThan(0);
  });
});
