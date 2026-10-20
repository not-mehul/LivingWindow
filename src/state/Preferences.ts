import { Emitter } from '../core/Emitter';
import type { GeoLocation } from '../sim/sun';

/** `real`: the window's clock is your clock. `fast`: a day passes in four hours. */
export type ClockMode = 'real' | 'fast';
/** Frames per second to draw at: smooth, balanced or low-power. */
export type FrameRate = 60 | 30 | 20;

export interface PreferenceValues {
  /** Calm mode: no storms unless chosen, gentler lightning, fewer visitors, a cosier city. */
  calm: boolean;
  clockMode: ClockMode;
  /** Change to the next place every this many minutes (0 = never). */
  rotateMinutes: number;
  /** Drift slowly across the parts of the view that don't fit the screen. */
  drift: boolean;
  /** Let the tablet fade away when nothing has moved for a while. */
  hideTablet: boolean;
  frameRate: FrameRate;
  /** Where the viewer is, for real sunrise and sunset (null: guessed from the time zone). */
  location: GeoLocation | null;
}

export const DEFAULT_PREFERENCES: Readonly<PreferenceValues> = {
  calm: true,
  clockMode: 'real',
  rotateMinutes: 0,
  drift: true,
  hideTablet: true,
  frameRate: 60,
  location: null,
};

export const ROTATE_CHOICES: readonly number[] = [0, 30, 60, 120];
export const FRAME_RATES: readonly FrameRate[] = [60, 30, 20];

export interface PreferenceEvents {
  change: { key: keyof PreferenceValues };
}

const STORAGE_KEY = 'livingWindow.preferences';

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keep only well-formed values from stored or URL input, falling back to defaults. */
export function sanitizePreferences(input: unknown): PreferenceValues {
  const out: PreferenceValues = { ...DEFAULT_PREFERENCES };
  if (!input || typeof input !== 'object') return out;
  const raw = input as Record<string, unknown>;
  if (typeof raw.calm === 'boolean') out.calm = raw.calm;
  if (raw.clockMode === 'real' || raw.clockMode === 'fast') out.clockMode = raw.clockMode;
  if (typeof raw.rotateMinutes === 'number' && ROTATE_CHOICES.includes(raw.rotateMinutes)) out.rotateMinutes = raw.rotateMinutes;
  if (typeof raw.drift === 'boolean') out.drift = raw.drift;
  if (typeof raw.hideTablet === 'boolean') out.hideTablet = raw.hideTablet;
  if (typeof raw.frameRate === 'number' && (FRAME_RATES as readonly number[]).includes(raw.frameRate)) out.frameRate = raw.frameRate as FrameRate;
  const loc = raw.location as Partial<GeoLocation> | null | undefined;
  if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && Math.abs(loc.latitude!) <= 90 && Math.abs(loc.longitude!) <= 180) {
    out.location = { latitude: loc.latitude!, longitude: loc.longitude! };
  }
  return out;
}

/** The viewer's choices for how the window behaves, saved in the browser. */
export class Preferences extends Emitter<PreferenceEvents> {
  private readonly values: PreferenceValues;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    super();
    let stored: unknown = null;
    try {
      stored = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      // Corrupt: start from the defaults.
    }
    this.values = sanitizePreferences(stored);
  }

  get<K extends keyof PreferenceValues>(key: K): PreferenceValues[K] {
    return this.values[key];
  }

  set<K extends keyof PreferenceValues>(key: K, value: PreferenceValues[K], persist = true): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    if (persist) this.save();
    this.emit('change', { key });
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Private mode or quota: not saved.
    }
  }
}
