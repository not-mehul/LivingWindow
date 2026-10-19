import { describe, expect, it } from 'vitest';
import { drawFishingBoat, drawSailboat } from '../../sprites/shoreSprites';
import { fishingTide, sailingWeather } from './Boats';

describe('boats on the horizon', () => {
  it('bring the sailors out on fair, breezy days, not in a storm or at night', () => {
    expect(sailingWeather(14, 0.3, 0, 0)).toBe(1);
    expect(sailingWeather(14, 0.3, 0.6, 0)).toBe(0);
    expect(sailingWeather(14, 0.3, 0, 0.8)).toBe(0);
    expect(sailingWeather(2, 0.3, 0, 0)).toBeLessThan(0.3);
    expect(sailingWeather(14, 0.95, 0, 0)).toBeLessThan(0.5);
  });

  it('send the fishing boat out at first light and home towards evening', () => {
    expect(fishingTide(6)).toBeGreaterThan(fishingTide(13));
    expect(fishingTide(18)).toBeGreaterThan(fishingTide(13));
  });

  it('draw a sail wider at the foot than the head, heeling over in the wind', () => {
    const boat = drawSailboat(0, 13);
    const width = (y: number) => Array.from({ length: boat.grid.width }, (_, x) => boat.grid.get(x, y)).filter((v) => v).length;
    expect(width(boat.grid.height - 4)).toBeGreaterThan(width(1));
    const frames = [0, 1, 2].map((h) => Array.from(drawSailboat(h, 13).grid.data).join(','));
    expect(new Set(frames).size).toBe(3);
    expect(Array.from(drawFishingBoat(0, 20).grid.data).join(',')).not.toBe(Array.from(drawFishingBoat(1, 20).grid.data).join(','));
  });
});
