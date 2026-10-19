import { describe, expect, it } from 'vitest';
import { TIDE_RANGE } from '../../sim/tides';
import { wrackLineS } from './Wrack';

describe('the strandline', () => {
  it('lies up the sand beyond the reach of the last high water', () => {
    expect(wrackLineS(1)).toBeLessThan(-TIDE_RANGE);
    expect(wrackLineS(-1)).toBeLessThan(0);
    // A bigger tide leaves it higher up the beach.
    expect(wrackLineS(0.9)).toBeLessThan(wrackLineS(0.3));
  });
});
