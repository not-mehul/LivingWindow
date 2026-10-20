import { LANDSCAPE_IDS, type LandscapeId } from '../landscapes/types';
import { WEATHER_TYPES, type WeatherType } from './Weather';
import { ROTATE_CHOICES, type ClockMode } from './Preferences';

/**
 * A view set up from the address bar, so a favourite can be bookmarked:
 * `?place=forest&time=21:30&weather=light-rain&clock=real&calm=1&rotate=60&ui=hidden`.
 * Anything missing or malformed is simply left alone.
 */
export interface UrlPreset {
  place?: LandscapeId;
  /** Clock hours, [0, 24). */
  time?: number;
  weather?: WeatherType | 'auto';
  clockMode?: ClockMode;
  calm?: boolean;
  rotateMinutes?: number;
  /** Hide the tablet entirely (the panel still opens with S). */
  hideUi?: boolean;
}

/** Friendly names accepted for weather alongside the real ones. */
const WEATHER_ALIASES: Record<string, WeatherType> = { rain: 'light-rain', storm: 'thunderstorm', cloudy: 'overcast', sunny: 'clear' };

export function parseUrlPreset(search: string): UrlPreset {
  const params = new URLSearchParams(search);
  const out: UrlPreset = {};
  const place = params.get('place')?.toLowerCase();
  if (place) {
    const id = place === 'meadow' ? 'meadows' : place;
    if ((LANDSCAPE_IDS as readonly string[]).includes(id)) out.place = id as LandscapeId;
  }
  const time = params.get('time')?.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (time) {
    const h = Number(time[1]);
    const m = Number(time[2] ?? 0);
    if (h < 24 && m < 60) out.time = h + m / 60;
  }
  const weather = params.get('weather')?.toLowerCase();
  if (weather === 'auto') out.weather = 'auto';
  else if (weather) {
    const type = WEATHER_ALIASES[weather] ?? weather;
    if ((WEATHER_TYPES as readonly string[]).includes(type)) out.weather = type as WeatherType;
  }
  const clock = params.get('clock')?.toLowerCase();
  if (clock === 'real' || clock === 'fast') out.clockMode = clock;
  const flag = (name: string) => {
    const v = params.get(name)?.toLowerCase();
    return v === '1' || v === 'true' || v === 'on' ? true : v === '0' || v === 'false' || v === 'off' ? false : undefined;
  };
  const calm = flag('calm');
  if (calm !== undefined) out.calm = calm;
  const rotate = Number(params.get('rotate'));
  if (params.has('rotate') && ROTATE_CHOICES.includes(rotate)) out.rotateMinutes = rotate;
  if (params.get('ui')?.toLowerCase() === 'hidden') out.hideUi = true;
  return out;
}

/** The address of the current view, for bookmarking or sharing. */
export function presetUrl(base: string, preset: UrlPreset): string {
  const url = new URL(base);
  url.search = '';
  if (preset.place) url.searchParams.set('place', preset.place);
  if (preset.time !== undefined) {
    const minutes = Math.round(preset.time * 60) % 1440;
    url.searchParams.set('time', `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (preset.weather) url.searchParams.set('weather', preset.weather);
  if (preset.clockMode) url.searchParams.set('clock', preset.clockMode);
  if (preset.calm !== undefined) url.searchParams.set('calm', preset.calm ? '1' : '0');
  if (preset.rotateMinutes) url.searchParams.set('rotate', String(preset.rotateMinutes));
  if (preset.hideUi) url.searchParams.set('ui', 'hidden');
  return url.toString();
}
