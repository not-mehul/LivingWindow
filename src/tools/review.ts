/**
 * The preview pages' notes (sounds, sprites): a verdict and a comment per
 * item, kept in the browser, and turned into a report to hand back for fixing.
 */

export type Verdict = 'good' | 'work';

export interface Review {
  verdict?: Verdict;
  note?: string;
}

export type Reviews = Record<string, Review>;

/** An item as the report names it. */
export interface ReviewItem {
  id: string;
  label: string;
  group: string;
  /** e.g. "synth", "recording ×3", "6 frames". */
  kind: string;
}

export function loadReviews(key: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Reviews {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Reviews) : {};
  } catch {
    return {};
  }
}

export function saveReviews(key: string, reviews: Reviews, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(key, JSON.stringify(prune(reviews)));
  } catch {
    // Not persisted (private window, storage full); the page still works.
  }
}

/** Drop entries with nothing in them. */
export function prune(reviews: Reviews): Reviews {
  const out: Reviews = {};
  for (const [id, review] of Object.entries(reviews)) {
    const note = review.note?.trim();
    if (review.verdict || note) out[id] = { ...(review.verdict ? { verdict: review.verdict } : {}), ...(note ? { note } : {}) };
  }
  return out;
}

export function tally(items: readonly ReviewItem[], reviews: Reviews): { good: number; work: number; unrated: number } {
  let good = 0;
  let work = 0;
  for (const item of items) {
    const verdict = reviews[item.id]?.verdict;
    if (verdict === 'good') good++;
    else if (verdict === 'work') work++;
  }
  return { good, work, unrated: items.length - good - work };
}

/** A Markdown report: what needs work (with notes) first, then what's good, then what's still unreviewed. */
export function reviewReport(title: string, items: readonly ReviewItem[], reviews: Reviews, date = new Date()): string {
  const line = (item: ReviewItem) => {
    const note = reviews[item.id]?.note?.trim();
    return `- **${item.label}** (${item.group}, ${item.kind}, \`${item.id}\`)${note ? `: ${note}` : ''}`;
  };
  const by = (verdict: Verdict | undefined) => items.filter((item) => reviews[item.id]?.verdict === verdict);
  const work = by('work');
  const good = by('good');
  const unrated = by(undefined);
  const counts = tally(items, reviews);
  const out = [
    `# ${title}, ${date.toISOString().slice(0, 10)}`,
    '',
    `${counts.work} need work · ${counts.good} good · ${counts.unrated} not rated`,
  ];
  if (work.length > 0) out.push('', '## Needs work', '', ...work.map(line));
  if (good.length > 0) out.push('', '## Good', '', ...good.map(line));
  if (unrated.length > 0) {
    const noted = unrated.filter((item) => reviews[item.id]?.note?.trim());
    if (noted.length > 0) out.push('', '## Notes, not rated', '', ...noted.map(line));
    out.push('', '## Not rated yet', '', unrated.map((item) => item.label).join(', '));
  }
  return `${out.join('\n')}\n`;
}
