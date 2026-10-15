import { UI_HIDE_DELAY_MS } from '../config';
import type { Viewport } from '../core/Viewport';
import type { BirdseedState } from '../state/BirdseedState';
import type { Clock } from '../state/Clock';
import { formatClock, PHASE_LABELS, PHASE_PRESETS, type DayPhase } from '../state/timeOfDay';
import { WEATHER_LABELS, type Weather, type WeatherType } from '../state/Weather';
import type { WindowState } from '../state/WindowState';

export interface OverlayOptions {
  windowState: WindowState;
  birdseed: BirdseedState;
  viewport: Viewport;
  clock: Clock;
  weather: Weather;
  onAddSeed: () => void;
  onToggleFullscreen: (() => void) | null;
}

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
  private readonly clockText: HTMLElement;
  private readonly phaseText: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly timeSlider: HTMLInputElement;
  private readonly weatherStatus: HTMLElement;
  private readonly presetButtons: HTMLButtonElement[];
  private readonly weatherButtons: HTMLButtonElement[];
  private hideTimer: number | undefined;
  private hovered = false;
  private scrubbing = false;
  private lastMinute = -1;

  constructor(
    parent: HTMLElement,
    private readonly options: OverlayOptions,
  ) {
    const { windowState, birdseed, viewport, clock, weather } = options;

    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Living Window controls');
    this.element.innerHTML = `
      <div class="overlay__title">Living Window</div>
      <section class="overlay__section" aria-label="Time of day">
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
      </section>
      <section class="overlay__section" aria-label="Weather">
        <div class="overlay__label">Weather <span data-weather-status></span></div>
        <div class="chip-row" data-weather>
          ${WEATHER_CHIPS.map(
            (c) => `<button type="button" class="chip" data-weather-value="${c.value}">${c.label}</button>`,
          ).join('')}
        </div>
      </section>
      <section class="overlay__section" aria-label="Window">
        <button type="button" class="pixel-button" data-action="window" aria-keyshortcuts="W"></button>
        <div class="overlay__row">
          <button type="button" class="pixel-button" data-action="seed" aria-keyshortcuts="B">Add birdseed</button>
          <div class="seed-meter" role="meter" aria-label="Birdseed" aria-valuemin="0" aria-valuemax="100">
            <div class="seed-meter__fill"></div>
          </div>
        </div>
        <button type="button" class="pixel-button" data-action="fullscreen" aria-keyshortcuts="F">Fullscreen</button>
      </section>
      <div class="overlay__hint" data-hint="pan"></div>
      <div class="overlay__hint overlay__hint--keys">Space pause · [ ] time · W window · B seed · F fullscreen</div>
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
    birdseed.on('change', () => this.refresh());
    viewport.on('layout', () => this.refresh());
    clock.on('pause', () => this.refreshClock(true));
    clock.on('phase', () => this.refreshClock(true));
    weather.on('change', () => this.refreshWeather());
    weather.on('lock', () => this.refreshWeather());

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, () => this.show(), { passive: true });
    }

    this.refresh();
    this.refreshClock(true);
    this.refreshWeather();
    this.show();
  }

  /** Call once per frame; only touches the DOM when the displayed minute changes. */
  tick(): void {
    this.refreshClock(false);
  }

  show(): void {
    this.element.classList.remove('is-hidden');
    document.body.classList.remove('is-idle');
    this.scheduleHide();
  }

  hide(): void {
    if (this.hovered || this.scrubbing || this.element.contains(document.activeElement)) return;
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

  private refreshClock(force: boolean): void {
    const { clock } = this.options;
    const minute = Math.floor(clock.hours * 60);
    if (!force && minute === this.lastMinute) return;
    this.lastMinute = minute;
    this.clockText.textContent = formatClock(clock.hours);
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
      ? `· ${WEATHER_LABELS[weather.type]} (locked)`
      : `· Auto: ${WEATHER_LABELS[weather.type]}`;
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
