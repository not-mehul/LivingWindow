import { describe, expect, it } from 'vitest';

describe('sound catalog', () => {
  it('lists every one-shot exactly once', async () => {
    const { oneShotGroups } = await import('./soundCatalog');
    const { SOUND_IDS } = await import('../audio/sounds/SoundBank');
    const listed = oneShotGroups().flatMap((g) => g.ids);
    expect([...listed].sort()).toEqual([...SOUND_IDS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('puts sounds it has never heard of in the scene group', async () => {
    const { oneShotGroups } = await import('./soundCatalog');
    const groups = oneShotGroups(['crow-caw', 'brand-new' as never]);
    expect(groups.map((g) => [g.group, g.ids])).toEqual([
      ['Birds', ['crow-caw']],
      ['In the scene', ['brand-new']],
    ]);
  });

  it('builds every loop', async () => {
    const { LOOPS } = await import('./soundCatalog');
    for (const loop of LOOPS) expect(typeof loop.spec().render, loop.id).toBe('function');
  });
});
