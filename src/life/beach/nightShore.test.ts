import { describe, expect, it } from 'vitest';
import { drawNightjar, NIGHTJAR_FRAMES } from '../../sprites/shoreSprites';
import { nightjarActivity } from './NightShore';

describe('the night shore', () => {
  it('brings the nightjars out at dusk and before dawn, never by day', () => {
    expect(nightjarActivity(20)).toBe(1);
    expect(nightjarActivity(4.5)).toBeGreaterThan(0.5);
    expect(nightjarActivity(1)).toBeGreaterThan(0);
    expect(nightjarActivity(12)).toBe(0);
    expect(nightjarActivity(17)).toBe(0);
  });

  it("beats the nightjar's wings through four distinct frames", () => {
    const frames = Array.from({ length: NIGHTJAR_FRAMES }, (_, f) => Array.from(drawNightjar(f, 16).grid.data).join(','));
    expect(new Set(frames).size).toBe(NIGHTJAR_FRAMES);
  });
});
