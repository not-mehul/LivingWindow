/**
 * The preview pages' notes (sounds, sprites): a verdict, quick tags and a
 * comment per item, kept in the browser, and turned into a report (Markdown
 * or JSON) to hand back for fixing.
 */

export type Verdict = 'good' | 'work';

export interface Review {
  verdict?: Verdict;
  /** Quick tags naming the problem ("too loud", "foot slide"). */
  tags?: string[];
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

/** Drop empty notes and tags, and entries with nothing in them. */
export function prune(reviews: Reviews): Reviews {
  const out: Reviews = {};
  for (const [id, review] of Object.entries(reviews)) {
    const note = review.note?.trim();
    const tags = review.tags?.filter((t) => t.trim()) ?? [];
    if (!review.verdict && !note && tags.length === 0) continue;
    out[id] = { ...(review.verdict ? { verdict: review.verdict } : {}), ...(tags.length ? { tags } : {}), ...(note ? { note } : {}) };
  }
  return out;
}

/** Whether a review has anything written in it (a note or tags). */
export function hasNotes(review: Review | undefined): boolean {
  return Boolean(review?.note?.trim() || review?.tags?.length);
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
    const review = reviews[item.id];
    const tags = review?.tags?.length ? review.tags.join(', ') : '';
    // A note of several lines carries on indented under its item, so the list holds together.
    const note = review?.note?.trim().replace(/\n+/g, '\n  ') ?? '';
    const said = [tags, note].filter(Boolean).join('. ');
    return `- **${item.label}** (${item.group}, ${item.kind}, \`${item.id}\`)${said ? `: ${said}` : ''}`;
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
    const noted = unrated.filter((item) => hasNotes(reviews[item.id]));
    if (noted.length > 0) out.push('', '## Notes, not rated', '', ...noted.map(line));
    out.push('', '## Not rated yet', '', unrated.map((item) => item.label).join(', '));
  }
  return `${out.join('\n')}\n`;
}

/** The report as data: every item, with its verdict (null when unrated), tags and note. */
export interface ReviewExport {
  page: string;
  title: string;
  exported: string;
  counts: { good: number; work: number; unrated: number };
  items: Array<ReviewItem & { verdict: Verdict | null; tags: string[]; note: string }>;
}

export function reviewExport(page: string, title: string, items: readonly ReviewItem[], reviews: Reviews, date = new Date()): ReviewExport {
  return {
    page,
    title,
    exported: date.toISOString(),
    counts: tally(items, reviews),
    items: items.map((item) => {
      const review = reviews[item.id];
      return { ...item, verdict: review?.verdict ?? null, tags: review?.tags ?? [], note: review?.note?.trim() ?? '' };
    }),
  };
}

/**
 * Bring marks back from an exported file (another browser, or before a
 * clear), by id. Entries in the file win; ids this page doesn't list are
 * skipped and returned.
 */
export function mergeImport(reviews: Reviews, data: unknown, knownIds: ReadonlySet<string>): { reviews: Reviews; imported: number; skipped: string[] } {
  const list = (data as Partial<ReviewExport> | null)?.items;
  if (!Array.isArray(list)) throw new Error('Not a review export: no list of items.');
  const out: Reviews = { ...reviews };
  const skipped: string[] = [];
  let imported = 0;
  for (const entry of list as Array<Partial<ReviewExport['items'][number]>>) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (!knownIds.has(id)) {
      if (id) skipped.push(id);
      continue;
    }
    const review: Review = {
      ...(entry.verdict === 'good' || entry.verdict === 'work' ? { verdict: entry.verdict } : {}),
      ...(Array.isArray(entry.tags) ? { tags: entry.tags.filter((t): t is string => typeof t === 'string') } : {}),
      ...(typeof entry.note === 'string' ? { note: entry.note } : {}),
    };
    if (!review.verdict && !hasNotes(review)) continue;
    out[id] = review;
    imported++;
  }
  return { reviews: prune(out), imported, skipped };
}

/** "living-window-sound-review-2026-10-21.md". */
export function reportFileName(page: string, extension: 'md' | 'json', date = new Date()): string {
  return `living-window-${page}-review-${date.toISOString().slice(0, 10)}.${extension}`;
}
