import { describe, expect, it } from 'vitest';
import { BOWL_AWAY_SECONDS, BowlPresence } from './bowlPresence';

describe('BowlPresence', () => {
  it('starts on the sill when the window starts open', () => {
    const bowl = new BowlPresence(true);
    expect(bowl.present).toBe(true);
    expect(bowl.visible).toBe(true);
    expect(bowl.alpha).toBe(1);
    expect(bowl.lift).toBe(0);
  });

  it('can no longer be filled the moment it starts being taken in', () => {
    const bowl = new BowlPresence(true);
    bowl.setPresent(false);
    expect(bowl.present).toBe(false);
    bowl.update(BOWL_AWAY_SECONDS / 2);
    expect(bowl.visible).toBe(true);
    expect(bowl.alpha).toBe(0.5);
    expect(bowl.lift).toBe(2);
    bowl.update(BOWL_AWAY_SECONDS);
    expect(bowl.visible).toBe(false);
  });

  it('is only usable again once it is fully back', () => {
    const bowl = new BowlPresence(false);
    expect(bowl.visible).toBe(false);
    bowl.setPresent(true);
    bowl.update(BOWL_AWAY_SECONDS * 0.6);
    expect(bowl.visible).toBe(true);
    expect(bowl.present).toBe(false);
    bowl.update(BOWL_AWAY_SECONDS);
    expect(bowl.present).toBe(true);
  });

  it('fades in whole steps', () => {
    const bowl = new BowlPresence(false);
    bowl.setPresent(true);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      bowl.update(BOWL_AWAY_SECONDS / 40);
      seen.add(bowl.alpha);
    }
    expect([...seen].sort()).toEqual([0.25, 0.5, 0.75, 1]);
  });
});
