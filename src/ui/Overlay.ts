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
import type { Preferences } from '../state/Preferences';
import { paintSlider } from './slider';
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
  preferences: Preferences;
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
  /** Today's sunrise and sunset at the window's place (clock hours), and whether the place is a guess. */
  daylight?: () => { sunrise: number; sunset: number; guessed: boolean };
  /** The address of the view as it is now, for bookmarking. */
  shareUrl?: () => string;
}

/** Choice rows: a preference and the values its buttons stand for. */
type ChoiceKey = 'clockMode' | 'rotateMinutes' | 'frameRate';
const NUMERIC_CHOICES: ReadonlySet<ChoiceKey> = new Set(['rotateMinutes', 'frameRate']);

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

/** Line icons for the panel (they take the text colour). */
const svg = (body: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CLOUD = '<path d="M7 17h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7 9.5 3.75 3.75 0 0 0 7 17z"/>';
const ICONS: Record<string, string> = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>'),
  auto: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3.2"/><path d="M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6"/>'),
  clear: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  overcast: svg(CLOUD),
  'light-rain': svg('<path d="M7 14h10a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7 7.5 3.25 3.25 0 0 0 7 14z"/><path d="M9 17l-1 2.5M13 17l-1 2.5M17 17l-1 2.5"/>'),
  thunderstorm: svg('<path d="M7 14h10a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7 7.5 3.25 3.25 0 0 0 7 14z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>'),
  snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M10 4.5l2 1.5 2-1.5M10 19.5l2-1.5 2 1.5"/>'),
};

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
  private readonly weatherNow: HTMLElement;
  private readonly seedNote: HTMLElement;
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
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'Living Window settings');
    // An iPad: a thin black bezel round a dark, scrolling sheet of settings.
    this.element.innerHTML = `
      <div class="sheet">
      <header class="sheet__head">
        <div>
          <div class="sheet__time" data-clock aria-live="off">00:00</div>
          <div class="sheet__sub"><span data-phase></span><span class="dot">·</span><span data-weather-now></span></div>
        </div>
        <button type="button" class="icon-btn" data-action="close" aria-label="Close settings">${ICONS.close}</button>
      </header>
      <section class="group">
        <div class="group__label">Place</div>
        <div class="segmented" role="radiogroup" aria-label="Landscape">
          ${LANDSCAPE_IDS.map(
            (id, i) =>
              `<button type="button" role="radio" data-landscape="${id}" aria-keyshortcuts="${i + 1}">${LANDSCAPE_LABELS[id]}</button>`,
          ).join('')}
        </div>
      </section>
      <details class="group" data-section="time" open>
        <summary class="group__label">Time</summary>
        <div class="row">
          <button type="button" class="icon-btn icon-btn--filled" data-action="pause" aria-keyshortcuts="Space"></button>
          <input type="range" class="slider" min="0" max="1439" step="1" aria-label="Time of day" data-time />
        </div>
        <div class="pills">
          ${PHASE_PRESETS.map(
            (p) =>
              `<button type="button" class="pill" data-hours="${p.hours}" title="${PHASE_LABELS[p.phase]}">${PRESET_SHORT[p.phase]}</button>`,
          ).join('')}
          <button type="button" class="pill" data-action="now" title="Back to the time it is now">Now</button>
        </div>
      </details>
      <details class="group" data-section="weather" open>
        <summary class="group__label">Weather <span class="group__status" data-weather-status></span></summary>
        <div class="segmented segmented--icons" data-weather>
          ${WEATHER_CHIPS.map(
            (c) => `<button type="button" data-weather-value="${c.value}">${ICONS[c.value]}<span>${c.label}</span></button>`,
          ).join('')}
        </div>
      </details>
      <details class="group" data-section="viewing" open>
        <summary class="group__label">Viewing</summary>
        <div class="list" data-viewing>
          <button type="button" class="list__row" role="switch" data-pref="calm"><span>Calm <small>no storms unless chosen, fewer visitors, softer city</small></span><span class="switch" aria-hidden="true"></span></button>
          <div class="list__row">
            <span>Clock <small>real time, or a day in four hours</small></span>
            <span class="segmented segmented--inline" role="radiogroup" aria-label="Clock speed" data-choice="clockMode">
              <button type="button" role="radio" data-value="real">Real</button><button type="button" role="radio" data-value="fast">6×</button>
            </span>
          </div>
          <div class="list__row">
            <span>Change place <small>move on to the next one now and then</small></span>
            <span class="segmented segmented--inline" role="radiogroup" aria-label="Change place every" data-choice="rotateMinutes">
              <button type="button" role="radio" data-value="0">Off</button><button type="button" role="radio" data-value="30">30m</button><button type="button" role="radio" data-value="60">1h</button><button type="button" role="radio" data-value="120">2h</button>
            </span>
          </div>
          <div class="list__row">
            <span>Sun <small data-sun-note></small></span>
            <button type="button" class="text-btn" data-action="locate">Use my location</button>
          </div>
          <button type="button" class="list__row" role="switch" data-pref="drift"><span>Slow drift <small>wander across the view when left alone</small></span><span class="switch" aria-hidden="true"></span></button>
          <button type="button" class="list__row" role="switch" data-pref="hideTablet"><span>Tuck the tablet away <small>it fades out after two quiet minutes</small></span><span class="switch" aria-hidden="true"></span></button>
          <div class="list__row">
            <span>Frame rate <small>lower is lighter on the battery</small></span>
            <span class="segmented segmented--inline" role="radiogroup" aria-label="Frame rate" data-choice="frameRate">
              <button type="button" role="radio" data-value="60">60</button><button type="button" role="radio" data-value="30">30</button><button type="button" role="radio" data-value="20">20</button>
            </span>
          </div>
          <div class="list__row">
            <span>Link to this view <small data-link-note>bookmark the place, time and weather</small></span>
            <button type="button" class="text-btn" data-action="link">Copy</button>
          </div>
        </div>
      </details>
      <details class="group" data-section="window" open>
        <summary class="group__label">Window</summary>
        <div class="list">
          <button type="button" class="list__row" role="switch" data-action="window" aria-keyshortcuts="W"><span>Window open</span><span class="switch" aria-hidden="true"></span></button>
          <div class="list__row">
            <span>Birdseed <small data-seed-note></small></span>
            <span class="list__end">
              <span class="meter seed-meter" role="meter" aria-label="Birdseed" aria-valuemin="0" aria-valuemax="100"><span class="seed-meter__fill"></span></span>
              <button type="button" class="text-btn" data-action="seed" aria-keyshortcuts="B">Add</button>
            </span>
          </div>
          <button type="button" class="list__row" role="switch" data-action="wake"><span>Keep screen awake <small data-wake-note></small></span><span class="switch" aria-hidden="true"></span></button>
          <button type="button" class="list__row" role="switch" data-action="fullscreen" aria-keyshortcuts="F"><span>Full screen</span><span class="switch" aria-hidden="true"></span></button>
        </div>
      </details>
      <div data-audio-slot></div>
      <footer class="sheet__foot">
        <span data-hint="pan"></span>
        <span class="sheet__keys">S or Esc close · 1–4 place · Space pause · [ ] time · W window · B seed · R radio · M mute · F full screen</span>
      </footer>
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
    this.seedNote = this.query('[data-seed-note]');
    this.weatherNow = this.query('[data-weather-now]');
    const fullscreenButton = this.query<HTMLButtonElement>('[data-action="fullscreen"]');
    this.query('[data-action="close"]').addEventListener('click', () => this.close());

    this.windowButton.addEventListener('click', () => windowState.toggle());
    this.seedButton.addEventListener('click', () => options.onAddSeed());
    if (options.onToggleFullscreen) {
      fullscreenButton.addEventListener('click', () => options.onToggleFullscreen?.());
      const refreshFullscreen = () => fullscreenButton.setAttribute('aria-checked', String(Boolean(document.fullscreenElement)));
      document.addEventListener('fullscreenchange', refreshFullscreen);
      refreshFullscreen();
    } else {
      fullscreenButton.hidden = true;
    }

    const landscapeButtons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-landscape]')];
    const refreshLandscape = () => {
      const active = options.landscape.current();
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
    const wakeNote = this.query('[data-wake-note]');
    const wake = options.wakeLock;
    if (wake?.supported) {
      const refreshWake = () => {
        wakeButton.setAttribute('aria-checked', String(wake.enabled));
        wakeNote.textContent = wake.enabled && !wake.active ? 'tap to start' : '';
      };
      wakeButton.addEventListener('click', () => wake.setEnabled(!wake.enabled));
      wake.on('change', refreshWake);
      refreshWake();
    } else {
      wakeButton.hidden = true;
    }

    this.bindPreferences();

    this.pauseButton.addEventListener('click', () => clock.togglePaused());
    this.timeSlider.addEventListener('pointerdown', () => (this.scrubbing = true));
    this.timeSlider.addEventListener('pointerup', () => (this.scrubbing = false));
    this.timeSlider.addEventListener('change', () => (this.scrubbing = false));
    this.timeSlider.addEventListener('input', () => {
      paintSlider(this.timeSlider);
      clock.setTime(Number(this.timeSlider.value) / 60);
    });
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
    // Grow out of the tablet's screen on the sill (and shrink back into it).
    const dx = from.x + from.width / 2 - (box.x + box.width / 2);
    const dy = from.y + from.height / 2 - (box.y + box.height / 2);
    const sx = Math.max(0.02, from.width / box.width);
    const sy = Math.max(0.02, from.height / box.height);
    const down = { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${sx}, ${sy})`, opacity: 0.5, borderRadius: '4px' };
    const up = { transform: 'translate(-50%, -50%) scale(1, 1)', opacity: 1 };
    this.animation = this.element.animate(opening ? [down, up] : [up, down], { duration: opening ? 360 : 280, easing: opening ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.5,0,.75,.2)' });
    return this.animation;
  }

  /** Any movement wakes the tablet's screen and the cursor; stillness hides the cursor again. */
  private activity(): void {
    document.body.classList.remove('is-idle');
    this.options.onActivity?.();
    this.scheduleHide();
  }

  /** Switch rows for on/off preferences (`data-pref="key"`) and choice rows (`data-choice="key"`). */
  private bindPreferences(): void {
    const prefs = this.options.preferences;
    const switches = [...this.element.querySelectorAll<HTMLButtonElement>('button[data-pref]')];
    const choices = [...this.element.querySelectorAll<HTMLElement>('[data-choice]')];
    type SwitchKey = 'calm' | 'drift' | 'hideTablet';
    const refresh = () => {
      for (const button of switches) button.setAttribute('aria-checked', String(Boolean(prefs.get(button.dataset.pref as SwitchKey))));
      for (const group of choices) {
        const value = String(prefs.get(group.dataset.choice as ChoiceKey));
        for (const button of group.querySelectorAll<HTMLButtonElement>('[data-value]')) button.setAttribute('aria-checked', String(button.dataset.value === value));
      }
      this.refreshSun();
      this.refreshClock(true);
    };
    for (const button of switches) {
      const key = button.dataset.pref as SwitchKey;
      button.addEventListener('click', () => prefs.set(key, !prefs.get(key)));
    }
    for (const group of choices) {
      const key = group.dataset.choice as ChoiceKey;
      for (const button of group.querySelectorAll<HTMLButtonElement>('[data-value]')) {
        button.addEventListener('click', () => {
          const raw = button.dataset.value ?? '';
          prefs.set(key, (NUMERIC_CHOICES.has(key) ? Number(raw) : raw) as never);
        });
      }
    }
    this.query('[data-action="now"]').addEventListener('click', () => this.options.clock.resetToNow());
    const link = this.query<HTMLButtonElement>('[data-action="link"]');
    const linkNote = this.query('[data-link-note]');
    if (!this.options.shareUrl) link.closest('.list__row')?.setAttribute('hidden', '');
    link.addEventListener('click', () => {
      const url = this.options.shareUrl?.();
      if (!url) return;
      const done = (text: string) => (linkNote.textContent = text);
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => done('copied: paste it into a bookmark'), () => done(url));
      else done(url);
    });
    const locate = this.query<HTMLButtonElement>('[data-action="locate"]');
    if (!('geolocation' in navigator)) locate.hidden = true;
    locate.addEventListener('click', () => {
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          locate.disabled = false;
          // A tenth of a degree is plenty for the sun, and keeps the place vague.
          const round = (v: number) => Math.round(v * 10) / 10;
          prefs.set('location', { latitude: round(position.coords.latitude), longitude: round(position.coords.longitude) });
        },
        () => (locate.disabled = false),
        { maximumAge: 24 * 3600 * 1000, timeout: 15000 },
      );
    });
    prefs.on('change', refresh);
    refresh();
  }

  private refreshSun(): void {
    const note = this.element.querySelector<HTMLElement>('[data-sun-note]');
    const sky = this.options.daylight?.();
    if (!note || !sky) return;
    note.textContent = `up ${formatClock(sky.sunrise)}, down ${formatClock(sky.sunset)}${sky.guessed ? ' · place guessed from time zone' : ''}`;
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
    this.windowButton.setAttribute('aria-checked', String(windowState.isOpen));

    const percent = Math.round(birdseed.level * 100);
    this.seedFill.style.width = `${percent}%`;
    this.seedMeter.setAttribute('aria-valuenow', String(percent));
    // The bowl is taken in while the window is shut.
    const bowlOut = windowState.isOpen && !windowState.isAnimating;
    this.seedButton.disabled = birdseed.isFull || !bowlOut;
    this.seedNote.textContent = !bowlOut ? 'open the window to feed' : birdseed.isFull ? 'bowl is full' : '';

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
    paintSlider(this.timeSlider);
    this.timeSlider.setAttribute('aria-valuetext', `${formatClock(clock.hours)}, ${PHASE_LABELS[clock.phase]}`);
    this.pauseButton.innerHTML = clock.paused ? ICONS.play : ICONS.pause;
    this.query('[data-action="now"]').hidden = !clock.isRealTime || (!clock.isOffset && !clock.paused);
    // Sunrise and sunset move a little each day.
    if (minute % 30 === 0) this.refreshSun();
    this.pauseButton.setAttribute('aria-label', clock.paused ? 'Play' : 'Pause');
    this.pauseButton.setAttribute('aria-pressed', String(clock.paused));
    for (const button of this.presetButtons) {
      const preset = PHASE_PRESETS.find((p) => p.hours === Number(button.dataset.hours));
      button.setAttribute('aria-pressed', String(preset?.phase === clock.phase));
    }
  }

  private refreshWeather(): void {
    const { weather } = this.options;
    this.weatherStatus.textContent = weather.locked ? 'Fixed' : 'Automatic';
    this.weatherNow.textContent = WEATHER_LABELS[weather.type];
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
