import type { AudioSystem } from '../audio/AudioSystem';
import { LANDSCAPE_IDS, LANDSCAPE_LABELS, type LandscapeId } from '../landscapes/types';
import { UI_HIDE_DELAY_MS } from '../config';
import type { Viewport } from '../core/Viewport';
import type { BirdseedState } from '../state/BirdseedState';
import type { Clock } from '../state/Clock';
import { formatClock, PHASE_LABELS, PHASE_PRESETS, type DayPhase } from '../state/timeOfDay';
import { WEATHER_LABELS, type Weather, type WeatherType } from '../state/Weather';
import type { WindowState } from '../state/WindowState';
import type { ScreenWakeLock } from '../core/wakeLock';
import { createSoundPanel } from './SoundPanel';

export interface LandscapeControl {
  current: () => LandscapeId;
  set: (id: LandscapeId) => void;
  /** Warm up a landscape's code before it's chosen. */
  preload?: (id: LandscapeId) => void;
  onChange: (listener: (id: LandscapeId) => void) => void;
}

export interface OverlayOptions {
  landscape: LandscapeControl;
  windowState: WindowState;
  birdseed: BirdseedState;
  viewport: Viewport;
  clock: Clock;
  weather: Weather;
  onAddSeed: () => void;
  onToggleFullscreen: (() => void) | null;
  wakeLock?: ScreenWakeLock;
  /** The viewer moved or pressed something (wake the tablet's screen). */
  onActivity?: () => void;
  /** Where the tablet sits on screen, for the panel to lift out of and settle back into. */
  tabletRect?: () => { x: number; y: number; width: number; height: number } | null;
  /** The panel has been picked up (true) or put back down (false). */
  onOpenChange?: (open: boolean) => void;
}

const SECTIONS_KEY = 'livingWindow.ui.sections';
// The weather header keeps showing the current condition while folded.
const COMPACT_COLLAPSED = new Set(['weather', 'window', 'sound', 'radio']);

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

const PRESET_SHORT: Record<DayPhase, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  'golden-hour': 'Golden',
  dusk: 'Dusk',
  night: 'Night',
  'late-night': '2–4 AM',
};

const WEATHER_CHIPS: ReadonlyArray<{ value: WeatherType | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'clear', label: 'Clear' },
  { value: 'overcast', label: 'Cloudy' },
  { value: 'light-rain', label: 'Rain' },
  { value: 'thunderstorm', label: 'Storm' },
  { value: 'snow', label: 'Snow' },
];

/**
 * The control panel, as the screen of a tablet. It rests on the window sill
 * (see `window/SillTablet.ts`); tapping the tablet lifts it up to the middle
 * of the view with the settings on it, and tapping outside it (or Escape)
 * sets it back down. The mouse cursor hides after a few seconds of stillness
 * so the window can be watched undisturbed.
 */
export class Overlay {
  readonly element: HTMLElement;
  private readonly windowButton: HTMLButtonElement;
  private readonly seedButton: HTMLButtonElement;
  private readonly seedMeter: HTMLElement;
  private readonly seedFill: HTMLElement;
  private readonly panHint: HTMLElement;
  private readonly clockText: HTMLElement;
  private readonly phaseText: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly timeSlider: HTMLInputElement;
  private readonly weatherStatus: HTMLElement;
  private readonly presetButtons: HTMLButtonElement[];
  private readonly weatherButtons: HTMLButtonElement[];
  private hideTimer: number | undefined;
  private readonly backdrop: HTMLElement;
  private opened = false;
  private openedAt = 0;
  private animation: Animation | null = null;
  private hovered = false;
  private scrubbing = false;
  private lastMinute = -1;

  constructor(
    parent: HTMLElement,
    private readonly options: OverlayOptions,
  ) {
    const { windowState, birdseed, viewport, clock, weather } = options;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'overlay-backdrop is-hidden';
    // The click that picked the tablet up lands on the backdrop as it appears: ignore it.
    this.backdrop.addEventListener('click', () => {
      if (performance.now() - this.openedAt > 400) this.close();
    });
    parent.appendChild(this.backdrop);

    this.element = document.createElement('div');
    this.element.className = 'overlay is-hidden';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Living Window controls');
    // The outer element carries the neon glow; the body is clipped to the
    // chamfered HUD shape and scrolls (a clip-path would cut the glow off).
    this.element.innerHTML = `
      <div class="overlay__body">
      <div class="overlay__bar" aria-hidden="true"><span data-bar-clock></span><span class="overlay__bar-icons">▮▮▮ ◔</span></div>
      <div class="overlay__title" data-text="Living Window">Living Window</div>
      <div class="overlay__sys" aria-hidden="true">
        <span data-feed></span>
        <span class="overlay__live">Live</span>
      </div>
      <div class="chip-row chip-row--landscapes" role="radiogroup" aria-label="Landscape">
        ${LANDSCAPE_IDS.map(
          (id, i) =>
            `<button type="button" class="chip" role="radio" data-landscape="${id}" aria-keyshortcuts="${i + 1}">${LANDSCAPE_LABELS[id]}</button>`,
        ).join('')}
      </div>
      <details class="overlay__section" data-section="time" open>
        <summary>Time</summary>
        <div class="overlay__row overlay__row--between">
          <div class="clock" aria-live="off">
            <span class="clock__time" data-clock>00:00</span>
            <span class="clock__phase" data-phase></span>
          </div>
          <button type="button" class="pixel-button pixel-button--small" data-action="pause" aria-keyshortcuts="Space"></button>
        </div>
        <input type="range" class="pixel-range" min="0" max="1439" step="1" aria-label="Time of day" data-time />
        <div class="chip-row" data-presets>
          ${PHASE_PRESETS.map(
            (p) =>
              `<button type="button" class="chip" data-hours="${p.hours}" title="${PHASE_LABELS[p.phase]}">${PRESET_SHORT[p.phase]}</button>`,
          ).join('')}
        </div>
      </details>
      <details class="overlay__section" data-section="weather" open>
        <summary>Weather <span class="overlay__status" data-weather-status></span></summary>
        <div class="chip-row" data-weather>
          ${WEATHER_CHIPS.map(
            (c) => `<button type="button" class="chip" data-weather-value="${c.value}">${c.label}</button>`,
          ).join('')}
        </div>
      </details>
      <details class="overlay__section" data-section="window" open>
        <summary>Window</summary>
        <button type="button" class="pixel-button" data-action="window" aria-keyshortcuts="W"></button>
        <div class="overlay__row">
          <button type="button" class="pixel-button" data-action="seed" aria-keyshortcuts="B">Add birdseed</button>
          <div class="seed-meter" role="meter" aria-label="Birdseed" aria-valuemin="0" aria-valuemax="100">
            <div class="seed-meter__fill"></div>
          </div>
        </div>
        <button type="button" class="pixel-button" data-action="fullscreen" aria-keyshortcuts="F">Fullscreen</button>
        <button type="button" class="pixel-button" data-action="wake" aria-pressed="false">Keep screen awake</button>
      </details>
      <div data-audio-slot></div>
      <div class="overlay__hint" data-hint="pan"></div>
      <div class="overlay__hint overlay__hint--keys">S or Esc put down · 1–4 landscape · Space pause · [ ] time · W window · B seed · R radio · M mute · F fullscreen</div>
      </div>
    `;
    parent.appendChild(this.element);

    this.windowButton = this.query('[data-action="window"]');
    this.seedButton = this.query('[data-action="seed"]');
    this.seedMeter = this.query('.seed-meter');
    this.seedFill = this.query('.seed-meter__fill');
    this.panHint = this.query('[data-hint="pan"]');
    this.clockText = this.query('[data-clock]');
    this.phaseText = this.query('[data-phase]');
    this.pauseButton = this.query('[data-action="pause"]');
    this.timeSlider = this.query('[data-time]');
    this.weatherStatus = this.query('[data-weather-status]');
    this.presetButtons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-hours]')];
    this.weatherButtons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-weather-value]')];
    const fullscreenButton = this.query<HTMLButtonElement>('[data-action="fullscreen"]');

    this.windowButton.addEventListener('click', () => windowState.toggle());
    this.seedButton.addEventListener('click', () => options.onAddSeed());
    if (options.onToggleFullscreen) {
      fullscreenButton.addEventListener('click', () => options.onToggleFullscreen?.());
    } else {
      fullscreenButton.hidden = true;
    }

    const landscapeButtons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-landscape]')];
    const feed = this.query('[data-feed]');
    const refreshLandscape = () => {
      const active = options.landscape.current();
      feed.textContent = `Feed://${active}`;
      for (const button of landscapeButtons) button.setAttribute('aria-checked', String(button.dataset.landscape === active));
    };
    for (const button of landscapeButtons) {
      const id = button.dataset.landscape as LandscapeId;
      button.addEventListener('click', () => options.landscape.set(id));
      button.addEventListener('pointerenter', () => options.landscape.preload?.(id), { once: true });
    }
    options.landscape.onChange(refreshLandscape);
    refreshLandscape();

    const wakeButton = this.query<HTMLButtonElement>('[data-action="wake"]');
    const wake = options.wakeLock;
    if (wake?.supported) {
      const refreshWake = () => {
        wakeButton.setAttribute('aria-pressed', String(wake.enabled));
        wakeButton.textContent = wake.enabled ? `Screen stays awake${wake.active ? '' : ' (tap)'}` : 'Keep screen awake';
      };
      wakeButton.addEventListener('click', () => wake.setEnabled(!wake.enabled));
      wake.on('change', refreshWake);
      refreshWake();
    } else {
      wakeButton.hidden = true;
    }

    this.pauseButton.addEventListener('click', () => clock.togglePaused());
    this.timeSlider.addEventListener('pointerdown', () => (this.scrubbing = true));
    this.timeSlider.addEventListener('pointerup', () => (this.scrubbing = false));
    this.timeSlider.addEventListener('change', () => (this.scrubbing = false));
    this.timeSlider.addEventListener('input', () => clock.setTime(Number(this.timeSlider.value) / 60));
    for (const button of this.presetButtons) {
      button.addEventListener('click', () => clock.setTime(Number(button.dataset.hours)));
    }
    for (const button of this.weatherButtons) {
      button.addEventListener('click', () => {
        const value = button.dataset.weatherValue as WeatherType | 'auto';
        if (value === 'auto') weather.unlock();
        else weather.setWeather(value);
      });
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
    windowState.on('settled', () => this.refresh());
    birdseed.on('change', () => this.refresh());
    viewport.on('layout', () => this.refresh());
    clock.on('pause', () => this.refreshClock(true));
    clock.on('phase', () => this.refreshClock(true));
    weather.on('change', () => this.refreshWeather());
    weather.on('lock', () => this.refreshWeather());

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, () => this.activity(), { passive: true });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.opened) {
        e.preventDefault();
        this.close();
      }
    });

    this.restoreSections();
    this.refresh();
    this.refreshClock(true);
    this.refreshWeather();
    this.activity();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Pick the tablet up: the panel lifts out of it to the middle of the view. */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.openedAt = performance.now();
    this.element.classList.remove('is-hidden');
    this.backdrop.classList.remove('is-hidden');
    this.options.onOpenChange?.(true);
    this.animate(true);
    this.show();
  }

  /** Put it back down on the sill. */
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.backdrop.classList.add('is-hidden');
    if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const done = () => {
      if (this.opened) return;
      this.element.classList.add('is-hidden');
      this.options.onOpenChange?.(false);
    };
    const anim = this.animate(false);
    if (anim) anim.finished.then(done, done);
    else done();
  }

  /** Fly between the tablet on the sill and the middle of the view (or just fade, if it can't be found). */
  private animate(opening: boolean): Animation | null {
    this.animation?.cancel();
    const from = this.options.tabletRect?.();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || reduce || typeof this.element.animate !== 'function') return null;
    const box = this.element.getBoundingClientRect();
    if (box.width === 0) return null;
    const dx = from.x + from.width / 2 - (box.x + box.width / 2);
    const dy = from.y + from.height / 2 - (box.y + box.height / 2);
    const s = Math.max(0.05, from.width / box.width);
    const down = { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${s}) rotate(-6deg)`, opacity: 0.4 };
    const up = { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 };
    this.animation = this.element.animate(opening ? [down, up] : [up, down], { duration: opening ? 340 : 260, easing: opening ? 'cubic-bezier(.2,.9,.3,1.1)' : 'cubic-bezier(.5,0,.8,.4)' });
    return this.animation;
  }

  /** Any movement wakes the tablet's screen and the cursor; stillness hides the cursor again. */
  private activity(): void {
    document.body.classList.remove('is-idle');
    this.options.onActivity?.();
    this.scheduleHide();
  }

  /** Add the mixer and radio controls once the audio system is ready. */
  attachAudio(audio: AudioSystem): void {
    const slot = this.query('[data-audio-slot]');
    slot.replaceWith(createSoundPanel(audio));
    this.restoreSections();
  }

  /** Remember which panel sections the viewer collapsed (per browser only). */
  private restoreSections(): void {
    let saved: Record<string, boolean> = {};
    try {
      saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
    } catch {
      // Storage unavailable: every section starts open.
    }
    // On phones (portrait or landscape), start with the less-used sections
    // folded away so the panel leaves most of the view clear.
    const compact = window.innerWidth < 600 || window.innerHeight < 500;
    for (const details of this.element.querySelectorAll<HTMLDetailsElement>('details[data-section]')) {
      const name = details.dataset.section ?? '';
      if (name in saved) details.open = saved[name];
      else if (compact && COMPACT_COLLAPSED.has(name)) details.open = false;
      if (details.dataset.bound) continue;
      details.dataset.bound = 'true';
      details.addEventListener('toggle', () => {
        try {
          const current = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
          current[name] = details.open;
          localStorage.setItem(SECTIONS_KEY, JSON.stringify(current));
        } catch {
          // Not persisted; that's fine.
        }
      });
    }
  }

  /** Call once per frame; only touches the DOM when the displayed minute changes. */
  tick(): void {
    this.refreshClock(false);
  }

  show(): void {
    document.body.classList.remove('is-idle');
    this.scheduleHide();
  }

  /** Stillness: hide the cursor (the panel itself stays as it is, open or down). */
  hide(): void {
    if (this.opened && (this.hovered || this.scrubbing || this.element.contains(document.activeElement))) return;
    if (this.opened) return;
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
    // The bowl is taken in while the window is shut.
    const bowlOut = windowState.isOpen && !windowState.isAnimating;
    this.seedButton.disabled = birdseed.isFull || !bowlOut;
    this.seedButton.textContent = !bowlOut ? 'Open window to feed' : birdseed.isFull ? 'Bowl is full' : 'Add birdseed';

    const touch = window.matchMedia('(pointer: coarse)').matches;
    this.panHint.hidden = !viewport.isPannable;
    this.panHint.textContent = touch ? 'Drag to look around' : 'Drag or scroll to look around';
  }

  private refreshClock(force: boolean): void {
    const { clock } = this.options;
    const minute = Math.floor(clock.hours * 60);
    if (!force && minute === this.lastMinute) return;
    this.lastMinute = minute;
    this.clockText.textContent = formatClock(clock.hours);
    const bar = this.element.querySelector('[data-bar-clock]');
    if (bar) bar.textContent = formatClock(clock.hours);
    this.phaseText.textContent = PHASE_LABELS[clock.phase];
    if (!this.scrubbing) this.timeSlider.value = String(minute);
    this.timeSlider.setAttribute('aria-valuetext', `${formatClock(clock.hours)}, ${PHASE_LABELS[clock.phase]}`);
    this.pauseButton.textContent = clock.paused ? 'Play' : 'Pause';
    this.pauseButton.setAttribute('aria-pressed', String(clock.paused));
    for (const button of this.presetButtons) {
      const preset = PHASE_PRESETS.find((p) => p.hours === Number(button.dataset.hours));
      button.setAttribute('aria-pressed', String(preset?.phase === clock.phase));
    }
  }

  private refreshWeather(): void {
    const { weather } = this.options;
    this.weatherStatus.textContent = weather.locked
      ? `${WEATHER_LABELS[weather.type]} (locked)`
      : `Auto: ${WEATHER_LABELS[weather.type]}`;
    for (const button of this.weatherButtons) {
      const value = button.dataset.weatherValue;
      const active = value === 'auto' ? !weather.locked : weather.locked && value === weather.type;
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.element.querySelector<T>(selector);
    if (!el) throw new Error(`Overlay element missing: ${selector}`);
    return el;
  }
}
