import { describe, expect, it } from 'vitest';
import { trimmedLength } from './render';

const fakeBuffer = (data: Float32Array, sampleRate = 1000) => ({
  length: data.length,
  sampleRate,
  numberOfChannels: 1,
  getChannelData: () => data,
});

describe('pre-rendered takes', () => {
  it('trims trailing silence but keeps a ringing tail', () => {
    const data = new Float32Array(5000);
    for (let i = 0; i < 1500; i++) data[i] = Math.exp(-i / 200) * (i % 2 ? 1 : -1);
    const keep = trimmedLength(fakeBuffer(data), 0.5);
    // Past the nominal 0.5 s, to where the tail fades below -70 dB.
    expect(keep).toBeGreaterThan(500);
    expect(keep).toBeLessThan(2000);
  });

  it('never trims inside the sound', () => {
    const data = new Float32Array(3000);
    expect(trimmedLength(fakeBuffer(data), 2)).toBeGreaterThanOrEqual(2000);
    expect(trimmedLength(fakeBuffer(data), 10)).toBe(3000);
  });
});
