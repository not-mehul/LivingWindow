import { loadUiFont } from '../ui/fontBuilder';
import { loadReviews, reviewReport, saveReviews, tally, type ReviewItem, type Reviews, type Verdict } from './review';
import './reviewPage.css';

/**
 * The shared frame of the preview pages (sounds, sprites): a header with the
 * tally, a filter and the report, then rows grouped under headings, each
 * with Good / Needs work buttons and a note. The page fills each row's lead
 * (a play button, an animated sprite) and its extras.
 */

export interface PageRow {
  item: ReviewItem;
  detail?: string;
  /** Lays the row out with its lead on a line of its own (sprite players). */
  wide?: boolean;
}

export type Filter = 'all' | 'unrated' | 'work' | 'good';

export interface ReviewPageOptions<R extends PageRow> {
  /** The page heading. */
  heading: string;
  /** The report's title, e.g. "Sound review". */
  reportTitle: string;
  storageKey: string;
  /** What the items are called in the tally ("sounds", "sprites"). */
  noun: string;
  rows: readonly R[];
  /** Extra header buttons, as HTML (wire them up through `page.$`). */
  actions?: string;
  /** The sticky bar of page controls, as HTML. */
  controls: string;
  controlsLabel: string;
  /** A line under the rows. */
  footnote?: string;
  /** Fill in a row's lead and extras, once. */
  build: (row: R, el: RowElements) => void;
  /** Bring a row's own state up to date (playing, frame…), on every refresh. */
  update?: (row: R, el: RowElements) => void;
}

export interface RowElements {
  row: HTMLElement;
  lead: HTMLElement;
  extra: HTMLElement;
  detail: HTMLElement | null;
}

export interface ReviewPage {
  $: <T extends HTMLElement = HTMLElement>(selector: string) => T;
  elements: (id: string) => RowElements;
  refresh: () => void;
}

export function createReviewPage<R extends PageRow>(root: HTMLElement, options: ReviewPageOptions<R>): ReviewPage {
  void loadUiFont();
  const { rows, storageKey } = options;
  const items = rows.map((r) => r.item);
  let reviews: Reviews = loadReviews(storageKey);
  let filter: Filter = 'all';

  root.innerHTML = `
    <header class="sp-head">
      <h1>${options.heading}</h1>
      <p class="sp-tally" data-tally></p>
      <div class="sp-actions">
        <label>Show <select data-filter>
          <option value="all">all</option><option value="unrated">not rated</option><option value="work">needs work</option><option value="good">good</option>
        </select></label>
        <button type="button" data-copy>Copy report</button>
        ${options.actions ?? ''}
        <button type="button" data-clear>Clear marks</button>
      </div>
    </header>
    <section class="sp-controls" aria-label="${options.controlsLabel}">${options.controls}</section>
    <main data-groups></main>
    ${options.footnote ? `<p class="sp-footnote">${options.footnote}</p>` : ''}
    <details class="sp-report"><summary>Report</summary><textarea readonly rows="14" data-report></textarea></details>
  `;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const groups = $('[data-groups]');
  const rowEls = new Map<string, RowElements>();
  let section: HTMLElement | null = null;
  let current = '';

  for (const row of rows) {
    if (row.item.group !== current) {
      current = row.item.group;
      section = document.createElement('section');
      section.className = 'sp-group';
      section.innerHTML = `<h2>${current}</h2>`;
      groups.appendChild(section);
    }
    const el = document.createElement('div');
    el.className = row.wide ? 'sp-row sp-row--wide' : 'sp-row';
    el.dataset.id = row.item.id;
    el.innerHTML = `
      <div class="sp-lead"></div>
      <div class="sp-name">${row.item.label}<small>${row.item.kind}${row.detail ? ` · <span data-detail>${row.detail}</span>` : ''}</small></div>
      <span class="sp-extra"></span>
      <span class="sp-verdict" role="group" aria-label="Verdict on ${row.item.label}">
        <button type="button" data-verdict="good">Good</button><button type="button" data-verdict="work">Needs work</button>
      </span>
      <input type="text" class="sp-note" placeholder="What's wrong with it?" aria-label="Note on ${row.item.label}" />
    `;
    for (const button of el.querySelectorAll<HTMLButtonElement>('[data-verdict]')) {
      button.addEventListener('click', () => {
        const verdict = button.dataset.verdict as Verdict;
        const review = { ...reviews[row.item.id] };
        review.verdict = review.verdict === verdict ? undefined : verdict;
        reviews = { ...reviews, [row.item.id]: review };
        saveReviews(storageKey, reviews);
        refresh();
      });
    }
    const note = el.querySelector<HTMLInputElement>('.sp-note')!;
    note.value = reviews[row.item.id]?.note ?? '';
    note.addEventListener('input', () => {
      reviews = { ...reviews, [row.item.id]: { ...reviews[row.item.id], note: note.value } };
      saveReviews(storageKey, reviews);
      refreshReport();
    });
    const parts: RowElements = {
      row: el,
      lead: el.querySelector<HTMLElement>('.sp-lead')!,
      extra: el.querySelector<HTMLElement>('.sp-extra')!,
      detail: el.querySelector<HTMLElement>('[data-detail]'),
    };
    options.build(row, parts);
    section!.appendChild(el);
    rowEls.set(row.item.id, parts);
  }

  const report = $<HTMLTextAreaElement>('[data-report]');
  const refreshReport = () => {
    const counts = tally(items, reviews);
    $('[data-tally]').textContent = `${items.length} ${options.noun} · ${counts.work} need work · ${counts.good} good · ${counts.unrated} not rated`;
    report.value = reviewReport(options.reportTitle, items, reviews);
  };
  const refresh = () => {
    for (const row of rows) {
      const parts = rowEls.get(row.item.id)!;
      const verdict = reviews[row.item.id]?.verdict;
      for (const button of parts.row.querySelectorAll<HTMLButtonElement>('[data-verdict]')) button.setAttribute('aria-pressed', String(button.dataset.verdict === verdict));
      parts.row.hidden = filter !== 'all' && (filter === 'unrated' ? Boolean(verdict) : verdict !== filter);
      options.update?.(row, parts);
    }
    for (const s of groups.querySelectorAll<HTMLElement>('.sp-group')) s.hidden = ![...s.querySelectorAll<HTMLElement>('.sp-row')].some((r) => !r.hidden);
    refreshReport();
  };

  $<HTMLSelectElement>('[data-filter]').addEventListener('change', (e) => {
    filter = (e.target as HTMLSelectElement).value as Filter;
    refresh();
  });
  $('[data-copy]').addEventListener('click', () => {
    const done = (text: string) => ($('[data-copy]').textContent = text);
    const fallback = () => {
      $<HTMLDetailsElement>('.sp-report').open = true;
      report.select();
      done('Select and copy below');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(report.value).then(() => done('Copied'), fallback);
    else fallback();
    window.setTimeout(() => done('Copy report'), 2000);
  });
  $('[data-clear]').addEventListener('click', () => {
    if (!window.confirm('Clear every mark and note?')) return;
    reviews = {};
    saveReviews(storageKey, reviews);
    for (const note of root.querySelectorAll<HTMLInputElement>('.sp-note')) note.value = '';
    refresh();
  });

  return { $, elements: (id) => rowEls.get(id)!, refresh };
}
