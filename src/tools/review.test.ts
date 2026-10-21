import { describe, expect, it } from 'vitest';
import { hasNotes, loadReviews, mergeImport, prune, reportFileName, reviewExport, reviewReport, saveReviews, tally, type ReviewItem, type Reviews } from './review';

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

describe('review notes: tags, export and import', () => {
  const date = new Date('2026-10-21T09:00:00Z');

  it('puts tags before the note, and keeps a long note under its item', () => {
    const report = reviewReport('Sound review', items, { 'crow-caw': { verdict: 'work', tags: ['harsh', 'too loud'], note: 'like a duck\nwants a rounder caw' } }, date);
    expect(report).toContain('- **Crow caw** (Birds, synth, `crow-caw`): harsh, too loud. like a duck\n  wants a rounder caw');
  });

  it('lists tagged items that have no verdict', () => {
    const report = reviewReport('Sound review', items, { 'cow-moo': { tags: ['too long'] } }, date);
    expect(report).toContain('## Notes, not rated\n\n- **Cow moo** (Animals, synth, `cow-moo`): too long');
  });

  it('keeps tags when pruning and drops empty ones', () => {
    expect(prune({ a: { tags: [] }, b: { tags: ['', 'flicker'] }, c: { verdict: 'work', tags: [] } })).toEqual({ b: { tags: ['flicker'] }, c: { verdict: 'work' } });
  });

  it('exports every item, rated or not', () => {
    const data = reviewExport('sound', 'Sound review', items, { 'crow-caw': { verdict: 'work', tags: ['harsh'], note: ' duck ' } }, date);
    expect(data.page).toBe('sound');
    expect(data.exported).toBe('2026-10-21T09:00:00.000Z');
    expect(data.counts).toEqual({ good: 0, work: 1, unrated: 3 });
    expect(data.items).toHaveLength(items.length);
    expect(data.items[0]).toEqual({ ...items[0], verdict: 'work', tags: ['harsh'], note: 'duck' });
    expect(data.items[1].verdict).toBeNull();
  });

  it('imports an export back by id, skipping ids it does not know', () => {
    const data = reviewExport('sound', 'Sound review', items, { 'crow-caw': { verdict: 'work', note: 'duck' }, radio: { verdict: 'good' } }, date);
    data.items.push({ id: 'gone', label: 'Gone', group: 'Birds', kind: 'synth', verdict: 'good', tags: [], note: '' });
    const known = new Set(items.map((i) => i.id));
    const result = mergeImport({ 'cow-moo': { verdict: 'good' } }, JSON.parse(JSON.stringify(data)), known);
    expect(result.reviews).toEqual({ 'cow-moo': { verdict: 'good' }, 'crow-caw': { verdict: 'work', note: 'duck' }, radio: { verdict: 'good' } });
    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual(['gone']);
    expect(() => mergeImport({}, { nope: true }, known)).toThrow();
  });

  it('names report files by page and date', () => {
    expect(reportFileName('sprite', 'md', date)).toBe('living-window-sprite-review-2026-10-21.md');
    expect(reportFileName('sound', 'json', date)).toBe('living-window-sound-review-2026-10-21.json');
  });

  it('still reads marks saved before tags existed', () => {
    const storage = { getItem: () => JSON.stringify({ 'crow-caw': { verdict: 'work', note: 'old' } }) };
    expect(hasNotes(loadReviews('k', storage)['crow-caw'])).toBe(true);
  });
});
