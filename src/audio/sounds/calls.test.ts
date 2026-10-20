import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/random';
import { Stereo } from '../synth';
import { CALL_VOICES, MAX_CALL_SECONDS } from './calls';

describe('animal calls', () => {
  for (const [id, [voice]] of Object.entries(CALL_VOICES)) {
    it(`synthesizes ${id}`, () => {
      const rate = 22050;
      for (const seed of [1, 2, 3]) {
        const out = new Stereo(MAX_CALL_SECONDS * rate, rate);
        const length = voice(out, createRng(seed));
        expect(length).toBeGreaterThan(0.05);
        expect(length).toBeLessThanOrEqual(MAX_CALL_SECONDS);
        let energy = 0;
        let after = 0;
        const end = Math.ceil((length + 0.1) * rate);
        for (let i = 0; i < out.length; i++) {
          const v = out.left[i];
          expect(Number.isFinite(v)).toBe(true);
          if (i < end) energy += v * v;
          else after += v * v;
        }
        expect(energy).toBeGreaterThan(0);
        // It says how long it is truthfully: nothing of note rings past the end.
        expect(after).toBeLessThan(energy * 1e-3);
      }
    });
  }

  it('varies from take to take', () => {
    const [voice] = CALL_VOICES['robin-song'];
    const a = new Stereo(MAX_CALL_SECONDS * 8000, 8000);
    const b = new Stereo(MAX_CALL_SECONDS * 8000, 8000);
    voice(a, createRng(1));
    voice(b, createRng(2));
    expect(a.left).not.toEqual(b.left);
  });
});
