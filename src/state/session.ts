import { WEATHER_TYPES, type WeatherType } from './Weather';

/** Where the window was left, to pick up from on the next visit. */
export interface SessionState {
  weather: WeatherType;
  /** Weather chosen by hand (rather than the automatic cycle). */
  locked: boolean;
  /** The 6× clock's time (real time needs no remembering). */
  hours: number;
  windowOpen: boolean;
}

const STORAGE_KEY = 'livingWindow.session';

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSession(storage: Storage | null = safeStorage()): SessionState | null {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<SessionState> | null;
    if (!raw || typeof raw !== 'object') return null;
    if (!WEATHER_TYPES.includes(raw.weather as WeatherType)) return null;
    if (typeof raw.locked !== 'boolean' || typeof raw.windowOpen !== 'boolean') return null;
    if (typeof raw.hours !== 'number' || !(raw.hours >= 0 && raw.hours < 24)) return null;
    return { weather: raw.weather as WeatherType, locked: raw.locked, hours: raw.hours, windowOpen: raw.windowOpen };
  } catch {
    return null;
  }
}

export function saveSession(state: SessionState, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not saved; next visit starts fresh.
  }
}
