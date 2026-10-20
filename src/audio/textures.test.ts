import { describe, expect, it } from 'vitest';
import { normalize } from './textures';

describe('texture levels', () => {
  it('levels a loop to the target RMS', () => {
    const data = Float32Array.from({ length: 1000 }, (_, i) => 0.01 * Math.sin(i));
    const buffer = { numberOfChannels: 1, getChannelData: () => data };
    normalize(buffer, 0.1);
    const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
    expect(rms).toBeCloseTo(0.1, 3);
  });

  it('never pushes a peak past 0.95', () => {
    const data = new Float32Array(1000);
    data[10] = 0.5;
    normalize({ numberOfChannels: 1, getChannelData: () => data }, 0.5);
    expect(Math.max(...data)).toBeCloseTo(0.95, 5);
  });
});
