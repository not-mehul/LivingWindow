import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { shuffle } from './manifest';

describe('shuffle', () => {
  it('returns a permutation without touching the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const output = shuffle(input, createRng(1));
    expect([...output].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(output).not.toEqual(input);
  });
});
