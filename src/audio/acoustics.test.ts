import { describe, expect, it } from 'vitest';
import { ACOUSTICS, impulseResponse } from './acoustics';
import { reverbSend } from './spatial';

const rms = (data: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
};

describe('outdoor acoustics', () => {
  it('builds a decaying stereo tail for every landscape', () => {
    for (const acoustics of Object.values(ACOUSTICS)) {
      const rate = 8000;
      const [left, right] = impulseResponse(acoustics, rate);
      const pre = Math.floor(rate * acoustics.predelay);
      expect(left.length).toBe(Math.floor(rate * (acoustics.predelay + acoustics.decay)));
      expect(left[0]).toBe(0);
      const early = rms(left, pre + 200, pre + 1200);
      const late = rms(left, left.length - 1000, left.length);
      expect(late).toBeLessThan(early * 0.05);
      // The two channels differ, for width.
      expect(left.some((v, i) => Math.abs(v - right[i]) > 1e-3)).toBe(true);
    }
  });

  it('returns the same energy whatever the space', () => {
    const energy = (data: Float32Array) => data.reduce((sum, v) => sum + v * v, 0);
    const [city] = impulseResponse(ACOUSTICS.city, 8000);
    const [forest] = impulseResponse(ACOUSTICS.forest, 8000);
    expect(energy(city)).toBeCloseTo(energy(forest), 3);
  });

  it('sends distant sounds into the reverb more than near ones', () => {
    expect(reverbSend(0, 0.5)).toBeLessThan(reverbSend(0.5, 0.5));
    expect(reverbSend(0.5, 0.5)).toBeLessThan(reverbSend(1, 0.5));
    expect(reverbSend(1, 0.5)).toBeCloseTo(0.5);
  });
});
