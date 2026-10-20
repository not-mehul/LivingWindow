import { describe, expect, it } from 'vitest';
import { SongBudget } from './songBudget';

describe('song budget', () => {
  it('keeps a chattering flock to about 0.4 calls a second', () => {
    const budget = new SongBudget();
    let calls = 0;
    // Ten birds each wanting to chirp three times a second, for ten minutes.
    for (let t = 0; t < 600; t += 0.1) {
      budget.tick(0.1, 1);
      for (let b = 0; b < 3; b++) if (budget.take()) calls++;
    }
    expect(calls / 600).toBeLessThanOrEqual(0.41);
    expect(calls / 600).toBeGreaterThan(0.35);
  });

  it('sings less in the quiet of midday than at dawn', () => {
    const count = (activity: number) => {
      const budget = new SongBudget();
      let calls = 0;
      for (let t = 0; t < 600; t += 0.1) {
        budget.tick(0.1, activity);
        if (budget.take()) calls++;
      }
      return calls;
    };
    expect(count(0.55)).toBeLessThan(count(1));
  });
});
