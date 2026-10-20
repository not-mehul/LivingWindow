import { describe, expect, it } from 'vitest';
import { loadReviews, prune, reviewReport, saveReviews, tally, type ReviewItem, type Reviews } from './review';

const items: ReviewItem[] = [
  { id: 'crow-caw', label: 'Crow caw', group: 'Birds', kind: 'synth' },
  { id: 'cow-moo', label: 'Cow moo', group: 'Animals', kind: 'synth' },
  { id: 'loop:creek', label: 'Creek', group: 'Loops', kind: 'loop' },
  { id: 'radio', label: 'Lofi radio', group: 'Radio', kind: 'generative' },
];

describe('review notes', () => {
  it('counts verdicts', () => {
    const reviews: Reviews = { 'crow-caw': { verdict: 'work' }, 'cow-moo': { verdict: 'good' }, 'loop:creek': { note: 'hmm' } };
    expect(tally(items, reviews)).toEqual({ good: 1, work: 1, unrated: 2 });
  });

  it('reports what needs work first, with notes', () => {
    const reviews: Reviews = {
      'cow-moo': { verdict: 'good' },
      'crow-caw': { verdict: 'work', note: 'too harsh, sounds like a duck' },
      'loop:creek': { note: 'a bit loud' },
    };
    const report = reviewReport('Sound review', items, reviews, new Date('2026-10-20T12:00:00Z'));
    expect(report).toContain('# Sound review, 2026-10-20');
    expect(report).toContain('1 need work · 1 good · 2 not rated');
    expect(report.indexOf('## Needs work')).toBeLessThan(report.indexOf('## Good'));
    expect(report).toContain('- **Crow caw** (Birds, synth, `crow-caw`): too harsh, sounds like a duck');
    expect(report).toContain('## Notes, not rated');
    expect(report).toContain('- **Creek** (Loops, loop, `loop:creek`): a bit loud');
    expect(report).toContain('## Not rated yet\n\nCreek, Lofi radio');
  });

  it('keeps only reviews with something in them', () => {
    expect(prune({ a: {}, b: { note: '  ' }, c: { verdict: 'good', note: ' ok ' } })).toEqual({ c: { verdict: 'good', note: 'ok' } });
  });

  it('round-trips through storage and survives junk', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveReviews('livingWindow.soundReview', { 'crow-caw': { verdict: 'work', note: 'harsh' } }, storage);
    expect(loadReviews('livingWindow.soundReview', storage)).toEqual({ 'crow-caw': { verdict: 'work', note: 'harsh' } });
    store.set('livingWindow.soundReview', '{not json');
    expect(loadReviews('livingWindow.soundReview', storage)).toEqual({});
    expect(loadReviews('livingWindow.spriteReview', storage)).toEqual({});
  });
});
