import { describe, expect, it } from 'vitest';
import { crowdLevel, MAX_PEDESTRIANS, pedestrianTarget } from './crowd';
import { stallProgress } from './stalls';

const dry = { kind: 'none' as const, precipitation: 0 };

describe('crowd schedule', () => {
  it('is crowded at 6 PM and empty at 2:30 AM', () => {
    expect(pedestrianTarget(18, dry)).toBe(MAX_PEDESTRIANS);
    expect(pedestrianTarget(2.5, dry)).toBeLessThanOrEqual(1);
  });

  it('has a morning rush and a lively evening', () => {
    expect(crowdLevel(8.75)).toBeGreaterThan(crowdLevel(11));
    expect(crowdLevel(20)).toBeGreaterThan(crowdLevel(15));
  });

  it('clears the streets in the rain, less so in snow', () => {
    const rain = pedestrianTarget(18, { kind: 'rain', precipitation: 1 });
    const snow = pedestrianTarget(18, { kind: 'snow', precipitation: 1 });
    expect(rain).toBeLessThan(MAX_PEDESTRIANS * 0.4);
    expect(snow).toBeGreaterThan(rain);
    expect(snow).toBeLessThan(MAX_PEDESTRIANS);
  });
});

describe('market stalls', () => {
  it('sets up day stalls in the morning and packs them away by evening', () => {
    expect(stallProgress('day', 6.5)).toBe(0);
    expect(stallProgress('day', 7.3)).toBeGreaterThan(0);
    expect(stallProgress('day', 7.3)).toBeLessThan(1);
    expect(stallProgress('day', 12)).toBe(1);
    expect(stallProgress('day', 18.1)).toBeLessThan(1);
    expect(stallProgress('day', 19)).toBe(0);
  });

  it('opens the night market in the evening and closes it before midnight', () => {
    expect(stallProgress('night', 12)).toBe(0);
    expect(stallProgress('night', 20)).toBe(1);
    expect(stallProgress('night', 23.95)).toBe(0);
    expect(stallProgress('night', 2)).toBe(0);
  });

  it('staggers stalls with an offset', () => {
    expect(stallProgress('day', 7.3, 0.4)).toBe(0);
    expect(stallProgress('day', 7.3, -0.4)).toBe(1);
  });
});
