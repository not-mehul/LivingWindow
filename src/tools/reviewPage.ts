import { loadUiFont } from '../ui/fontBuilder';
import { hasNotes, loadReviews, mergeImport, reportFileName, reviewExport, reviewReport, saveReviews, tally, type Review, type ReviewItem, type Reviews, type Verdict } from './review';
import './reviewPage.css';

/**
 * The shared frame of the preview pages (sounds, sprites): a header with the
 * tally, a filter and the report (to copy, export or import), then rows
 * grouped under headings, each with Good / Needs work buttons. Marking
 * something Needs work opens its notes: quick tags naming the problem and a
 * note. The page fills each row's lead (a play button, an animated sprite)
 * and its extras.
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
  /** Short name for exported files ("sound" → living-window-sound-review-…). */
  page: string;
  storageKey: string;
  /** What the items are called in the tally ("sounds", "sprites"). */
  noun: string;
  rows: readonly R[];
  /** Quick tags offered in the notes, naming common problems. */
  tags: readonly string[];
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

interface NotesElements {
  panel: HTMLElement;
  note: HTMLTextAreaElement;
  add: HTMLButtonElement;
}

/** Hand the browser a file to save. */
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createReviewPage<R extends PageRow>(root: HTMLElement, options: ReviewPageOptions<R>): ReviewPage {
  void loadUiFont();
  const { rows, storageKey } = options;
  const items = rows.map((r) => r.item);
  const knownIds = new Set(items.map((i) => i.id));
  let reviews: Reviews = loadReviews(storageKey);
  let filter: Filter = 'all';
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  root.innerHTML = `
    <header class="sp-head">
      <h1>${options.heading}</h1>
      <p class="sp-tally" data-tally></p>
      <div class="sp-actions">
        <label>Show <select data-filter>
          <option value="all">all</option><option value="unrated">not rated</option><option value="work">needs work</option><option value="good">good</option>
        </select></label>
        <button type="button" data-copy>Copy report</button>
        <span class="sp-export" role="group" aria-label="Export or import the report">
          <span class="sp-export__label">Export</span>
          <button type="button" data-export="md" title="Download the report as Markdown">.md</button>
          <button type="button" data-export="json" title="Download every item and its marks as JSON">.json</button>
          <button type="button" data-import title="Bring marks back from an exported .json">Import…</button>
          <input type="file" accept="application/json,.json" hidden data-import-file />
        </span>
        ${options.actions ?? ''}
        <button type="button" data-clear>Clear marks</button>
        <span class="sp-status" role="status" aria-live="polite" data-status></span>
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
  const notesEls = new Map<string, NotesElements>();
  let section: HTMLElement | null = null;
  let current = '';

  const save = () => saveReviews(storageKey, reviews);
  const update = (id: string, change: Partial<Review>) => {
    reviews = { ...reviews, [id]: { ...reviews[id], ...change } };
    save();
  };
  /** The note box grows with what's written in it. */
  const fit = (note: HTMLTextAreaElement) => {
    note.style.height = 'auto';
    note.style.height = `${note.scrollHeight + 2}px`;
  };
  const openNotes = (id: string, open: boolean, focus = false) => {
    const notes = notesEls.get(id)!;
    notes.panel.hidden = !open;
    notes.add.hidden = open;
    if (open) fit(notes.note);
    if (open && focus) notes.note.focus();
  };

  for (const row of rows) {
    if (row.item.group !== current) {
      current = row.item.group;
      section = document.createElement('section');
      section.className = 'sp-group';
      section.innerHTML = `<h2>${current}</h2>`;
      groups.appendChild(section);
    }
    const { id, label } = row.item;
    const el = document.createElement('div');
    el.className = row.wide ? 'sp-row sp-row--wide' : 'sp-row';
    el.dataset.id = id;
    el.innerHTML = `
      <div class="sp-lead"></div>
      <div class="sp-name">${label}<small>${row.item.kind}${row.detail ? ` · <span data-detail>${row.detail}</span>` : ''}</small></div>
      <span class="sp-extra"></span>
      <span class="sp-verdict" role="group" aria-label="Verdict on ${label}">
        <button type="button" data-verdict="good">Good</button><button type="button" data-verdict="work">Needs work</button>
        <button type="button" class="sp-add-note" data-add-note aria-label="Add a note on ${label}">＋ Note</button>
      </span>
      <div class="sp-notes" hidden>
        <div class="sp-tags" role="group" aria-label="What's wrong with ${label}">
          ${options.tags.map((tag) => `<button type="button" data-tag="${escape(tag)}">${tag}</button>`).join('')}
        </div>
        <textarea class="sp-note" rows="2" placeholder="What's wrong, and what would be better?" aria-label="Note on ${label}"></textarea>
      </div>
    `;
    const notes: NotesElements = {
      panel: el.querySelector<HTMLElement>('.sp-notes')!,
      note: el.querySelector<HTMLTextAreaElement>('.sp-note')!,
      add: el.querySelector<HTMLButtonElement>('[data-add-note]')!,
    };
    notesEls.set(id, notes);

    for (const button of el.querySelectorAll<HTMLButtonElement>('[data-verdict]')) {
      button.addEventListener('click', () => {
        const verdict = button.dataset.verdict as Verdict;
        const next = reviews[id]?.verdict === verdict ? undefined : verdict;
        update(id, { verdict: next });
        // Needs work opens the notes, ready to type; otherwise they fold away unless something's written.
        if (next === 'work') openNotes(id, true, true);
        else if (!hasNotes(reviews[id])) openNotes(id, false);
        refresh();
      });
    }
    notes.add.addEventListener('click', () => openNotes(id, true, true));
    for (const chip of el.querySelectorAll<HTMLButtonElement>('[data-tag]')) {
      chip.addEventListener('click', () => {
        const tag = chip.dataset.tag ?? '';
        const tags = reviews[id]?.tags ?? [];
        update(id, { tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] });
        refresh();
      });
    }
    notes.note.value = reviews[id]?.note ?? '';
    notes.note.addEventListener('input', () => {
      fit(notes.note);
      update(id, { note: notes.note.value });
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
    rowEls.set(id, parts);
    openNotes(id, reviews[id]?.verdict === 'work' || hasNotes(reviews[id]));
  }

  const report = $<HTMLTextAreaElement>('[data-report]');
  const refreshReport = () => {
    const counts = tally(items, reviews);
    $('[data-tally]').textContent = `${items.length} ${options.noun} · ${counts.work} need work · ${counts.good} good · ${counts.unrated} not rated`;
    report.value = reviewReport(options.reportTitle, items, reviews);
  };
  const refresh = () => {
    for (const row of rows) {
      const { id } = row.item;
      const parts = rowEls.get(id)!;
      const review = reviews[id];
      for (const button of parts.row.querySelectorAll<HTMLButtonElement>('[data-verdict]')) button.setAttribute('aria-pressed', String(button.dataset.verdict === review?.verdict));
      for (const chip of parts.row.querySelectorAll<HTMLButtonElement>('[data-tag]')) chip.setAttribute('aria-pressed', String(review?.tags?.includes(chip.dataset.tag ?? '') ?? false));
      parts.row.hidden = filter !== 'all' && (filter === 'unrated' ? Boolean(review?.verdict) : review?.verdict !== filter);
      options.update?.(row, parts);
    }
    for (const s of groups.querySelectorAll<HTMLElement>('.sp-group')) s.hidden = ![...s.querySelectorAll<HTMLElement>('.sp-row')].some((r) => !r.hidden);
    refreshReport();
  };
  /** Show the notes as stored: after a clear or an import. */
  const reloadNotes = () => {
    for (const { id } of items) {
      const notes = notesEls.get(id)!;
      notes.note.value = reviews[id]?.note ?? '';
      openNotes(id, reviews[id]?.verdict === 'work' || hasNotes(reviews[id]));
    }
    refresh();
  };
  let statusTimer = 0;
  const status = (text: string) => {
    $('[data-status]').textContent = text;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => ($('[data-status]').textContent = ''), 5000);
  };

  $<HTMLSelectElement>('[data-filter]').addEventListener('change', (e) => {
    filter = (e.target as HTMLSelectElement).value as Filter;
    refresh();
  });
  $('[data-copy]').addEventListener('click', () => {
    const fallback = () => {
      $<HTMLDetailsElement>('.sp-report').open = true;
      report.select();
      status('Select the report below and copy it');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(report.value).then(() => status('Report copied'), fallback);
    else fallback();
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-export]')) {
    button.addEventListener('click', () => {
      const date = new Date();
      if (button.dataset.export === 'json') {
        const data = reviewExport(options.page, options.reportTitle, items, reviews, date);
        download(reportFileName(options.page, 'json', date), `${JSON.stringify(data, null, 2)}\n`, 'application/json');
      } else {
        download(reportFileName(options.page, 'md', date), reviewReport(options.reportTitle, items, reviews, date), 'text/markdown');
      }
      status('Report downloaded');
    });
  }
  const file = $<HTMLInputElement>('[data-import-file]');
  $('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    void chosen.text().then((text) => {
      try {
        const result = mergeImport(reviews, JSON.parse(text), knownIds);
        reviews = result.reviews;
        save();
        reloadNotes();
        status(`Imported ${result.imported} marks${result.skipped.length ? `; skipped ${result.skipped.length} this page doesn't have` : ''}`);
      } catch (error) {
        status(`Couldn't import that file: ${error instanceof Error ? error.message : 'not a review export'}`);
      }
    });
  });
  $('[data-clear]').addEventListener('click', () => {
    if (!window.confirm('Clear every mark and note?')) return;
    reviews = {};
    save();
    reloadNotes();
  });

  return { $, elements: (id) => rowEls.get(id)!, refresh };
}
