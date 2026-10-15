import { UI_HIDE_DELAY_MS } from '../config';
import type { Viewport } from '../core/Viewport';
import type { BirdseedState } from '../state/BirdseedState';
import type { WindowState } from '../state/WindowState';

export interface OverlayOptions {
  windowState: WindowState;
  birdseed: BirdseedState;
  viewport: Viewport;
  onAddSeed: () => void;
  onToggleFullscreen: (() => void) | null;
}

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Minimal pixel-styled control panel. Appears on any activity (mouse move,
 * tap, key press) and fades out after a few seconds of stillness, taking the
 * mouse cursor with it so the window can be watched undisturbed.
 */
export class Overlay {
  readonly element: HTMLElement;
  private readonly windowButton: HTMLButtonElement;
  private readonly seedButton: HTMLButtonElement;
  private readonly seedMeter: HTMLElement;
  private readonly seedFill: HTMLElement;
  private readonly panHint: HTMLElement;
  private hideTimer: number | undefined;
  private hovered = false;

  constructor(
    parent: HTMLElement,
    private readonly options: OverlayOptions,
  ) {
    const { windowState, birdseed, viewport } = options;

    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Living Window controls');
    this.element.innerHTML = `
      <div class="overlay__title">Living Window</div>
      <button type="button" class="pixel-button" data-action="window" aria-keyshortcuts="W"></button>
      <div class="overlay__row">
        <button type="button" class="pixel-button" data-action="seed" aria-keyshortcuts="B">Add birdseed</button>
        <div class="seed-meter" role="meter" aria-label="Birdseed" aria-valuemin="0" aria-valuemax="100">
          <div class="seed-meter__fill"></div>
        </div>
      </div>
      <button type="button" class="pixel-button" data-action="fullscreen" aria-keyshortcuts="F">Fullscreen</button>
      <div class="overlay__hint" data-hint="pan"></div>
      <div class="overlay__hint overlay__hint--keys">W window · B seed · ←→ look · F fullscreen</div>
    `;
    parent.appendChild(this.element);

    this.windowButton = this.query('[data-action="window"]');
    this.seedButton = this.query('[data-action="seed"]');
    this.seedMeter = this.query('.seed-meter');
    this.seedFill = this.query('.seed-meter__fill');
    this.panHint = this.query('[data-hint="pan"]');
    const fullscreenButton = this.query<HTMLButtonElement>('[data-action="fullscreen"]');

    this.windowButton.addEventListener('click', () => windowState.toggle());
    this.seedButton.addEventListener('click', () => options.onAddSeed());
    if (options.onToggleFullscreen) {
      fullscreenButton.addEventListener('click', () => options.onToggleFullscreen?.());
    } else {
      fullscreenButton.hidden = true;
    }

    this.element.addEventListener('pointerenter', () => {
      this.hovered = true;
      this.show();
    });
    this.element.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.scheduleHide();
    });
    this.element.addEventListener('focusin', () => this.show());
    this.element.addEventListener('focusout', () => this.scheduleHide());

    windowState.on('toggle', () => this.refresh());
    birdseed.on('change', () => this.refresh());
    viewport.on('layout', () => this.refresh());

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, () => this.show(), { passive: true });
    }

    this.refresh();
    this.show();
  }

  show(): void {
    this.element.classList.remove('is-hidden');
    document.body.classList.remove('is-idle');
    this.scheduleHide();
  }

  hide(): void {
    if (this.hovered || this.element.contains(document.activeElement)) return;
    this.element.classList.add('is-hidden');
    document.body.classList.add('is-idle');
  }

  private scheduleHide(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), UI_HIDE_DELAY_MS);
  }

  private refresh(): void {
    const { windowState, birdseed, viewport } = this.options;
    this.windowButton.textContent = windowState.isOpen ? 'Close window' : 'Open window';
    this.windowButton.setAttribute('aria-pressed', String(!windowState.isOpen));

    const percent = Math.round(birdseed.level * 100);
    this.seedFill.style.width = `${percent}%`;
    this.seedMeter.setAttribute('aria-valuenow', String(percent));
    this.seedButton.disabled = birdseed.isFull;
    this.seedButton.textContent = birdseed.isFull ? 'Bowl is full' : 'Add birdseed';

    const touch = window.matchMedia('(pointer: coarse)').matches;
    this.panHint.hidden = !viewport.isPannable;
    this.panHint.textContent = touch ? 'Drag to look around' : 'Drag or scroll to look around';
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.element.querySelector<T>(selector);
    if (!el) throw new Error(`Overlay element missing: ${selector}`);
    return el;
  }
}
