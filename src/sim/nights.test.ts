import { describe, expect, it } from 'vitest';
import { NightKey } from './nights';

describe('NightKey', () => {
  it('keeps one name through a night and moves on at noon', () => {
    const k = new NightKey(() => 'day');
    const tonight = k.update(20);
    expect(k.update(23)).toBe(tonight);
    expect(k.update(2)).toBe(tonight);
    expect(k.update(11)).toBe(tonight);
    expect(k.update(12.5)).not.toBe(tonight);
  });
});
