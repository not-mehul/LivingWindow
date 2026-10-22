import { describe, expect, it } from 'vitest';
import { addNoiseBurst, Biquad, grainEdges, Stereo } from './synth';
import { burst, normalize, renderTexture, sampled, scattered } from './textures';

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

  it('scatters recorded taps into a texture', () => {
    const tap = Float32Array.from({ length: 200 }, (_, i) => Math.sin(i) * Math.exp(-i / 40));
    const out = renderTexture(sampled(30, [{ length: tap.length, getChannelData: () => tap }]), 8000, 2);
    expect(out.left.some((v) => Math.abs(v) > 0.05)).toBe(true);
    expect(out.right.some((v) => Math.abs(v) > 0.05)).toBe(true);
  });
});

describe('no crackle', () => {
  it('leaves a sparse texture quieter rather than making every tick a sharp crackle', () => {
    const sparse = renderTexture(scattered(3, (out, t, pan, rng) => burst(out, t, pan, rng, 'bandpass', 3000, 2, 1, 0.02)), 22050, 4);
    let peak = 0;
    for (const v of [...sparse.left, ...sparse.right]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it('starts and ends every grain at silence', () => {
    expect(grainEdges(0, 400, 66)).toBe(0);
    expect(grainEdges(399, 400, 66)).toBeLessThan(0.02);
    expect(grainEdges(200, 400, 66)).toBe(1);
    const out = new Stereo(2000, 22050);
    addNoiseBurst(out, 0, 0.05, Biquad.make('bandpass', 2000, 1, 22050), 1, 0, () => 0.9);
    const n = Math.round(0.05 * 22050);
    expect(Math.abs(out.left[0])).toBeLessThan(1e-3);
    expect(Math.abs(out.left[n - 1])).toBeLessThan(0.02);
  });
});
