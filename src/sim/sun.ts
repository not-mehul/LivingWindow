import { clamp } from '../core/math';
import { wrapHours } from '../state/timeOfDay';

/** Where on Earth the window is (degrees; north and east positive). */
export interface GeoLocation {
  latitude: number;
  longitude: number;
}

/** Today's sun: local clock hours of sunrise and sunset. */
export interface SunTimes {
  sunrise: number;
  sunset: number;
}

/**
 * The scene's lighting keyframes are authored for a sunrise at 06:00 and a
 * sunset at 19:00. Real days are mapped onto that "solar" timeline, so dawn
 * colours arrive at the real dawn whatever the season or place.
 */
export const AUTHORED_SUNRISE = 6;
export const AUTHORED_SUNSET = 19;

/** The shortest and longest day we stretch to (polar winters and summers are clamped). */
const MIN_DAY_HOURS = 4;
const MAX_DAY_HOURS = 20;

const RAD = Math.PI / 180;

/** Day of the year, 1 = 1 January (local date). */
export function dayOfYearLocal(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Sunrise and sunset on `date` at `location`, in local clock hours (using
 * the date's own time-zone offset), from NOAA's solar position equations.
 * Days are clamped between 4 and 20 hours so the far north and south still
 * get a dawn and a dusk.
 */
export function sunTimes(date: Date, location: GeoLocation, utcOffsetHours = -date.getTimezoneOffset() / 60): SunTimes {
  const gamma = ((2 * Math.PI) / 365) * (dayOfYearLocal(date) - 1);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const lat = clamp(location.latitude, -89, 89) * RAD;
  const cosHa = (Math.cos(90.833 * RAD) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const halfDay = clamp((Math.acos(clamp(cosHa, -1, 1)) / RAD / 15), MIN_DAY_HOURS / 2, MAX_DAY_HOURS / 2);
  const noon = 12 - location.longitude / 15 - eqTime / 60 + utcOffsetHours;
  return { sunrise: wrapHours(noon - halfDay), sunset: wrapHours(noon + halfDay) };
}

/**
 * Map a clock time onto the authored solar timeline: real sunrise → 06:00,
 * real sunset → 19:00, with the day and the night each stretched evenly in
 * between.
 */
export function solarHours(hours: number, sun: SunTimes): number {
  const day = wrapHours(sun.sunset - sun.sunrise);
  const since = wrapHours(hours - sun.sunrise);
  const authoredDay = AUTHORED_SUNSET - AUTHORED_SUNRISE;
  if (since <= day) return wrapHours(AUTHORED_SUNRISE + (since / day) * authoredDay);
  return wrapHours(AUTHORED_SUNSET + ((since - day) / (24 - day)) * (24 - authoredDay));
}

/** Length of the synodic month (new moon to new moon), days. */
const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 6 January 2000, 18:14 UTC. */
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);

/** How far through its cycle the moon is: 0 = new, 0.5 = full, back to 1 = new. */
export function moonAge(date: Date): number {
  const days = (date.getTime() - NEW_MOON_2000) / 86_400_000;
  return ((days / SYNODIC_MONTH) % 1 + 1) % 1;
}

/** The lit fraction of the moon's disc for a given age. */
export function moonIllumination(age: number): number {
  return (1 - Math.cos(2 * Math.PI * age)) / 2;
}

/**
 * When the moon rises and sets on the authored solar timeline: a new moon
 * keeps company with the sun, a full moon rises as it sets, and in between
 * it rises about fifty minutes later each night.
 */
export function moonTimes(age: number): { rise: number; set: number } {
  const rise = wrapHours(AUTHORED_SUNRISE + age * 24);
  return { rise, set: wrapHours(rise + 12.5) };
}

/** Rough coordinates for common time zones, for a sensible sky without asking for location. */
const ZONES: Record<string, readonly [number, number]> = {
  'America/New_York': [40.7, -74],
  'America/Chicago': [41.9, -87.6],
  'America/Denver': [39.7, -105],
  'America/Phoenix': [33.4, -112],
  'America/Los_Angeles': [34, -118.2],
  'America/Anchorage': [61.2, -149.9],
  'America/Toronto': [43.7, -79.4],
  'America/Vancouver': [49.3, -123.1],
  'America/Mexico_City': [19.4, -99.1],
  'America/Sao_Paulo': [-23.5, -46.6],
  'America/Argentina/Buenos_Aires': [-34.6, -58.4],
  'America/Bogota': [4.7, -74.1],
  'America/Lima': [-12, -77],
  'America/Santiago': [-33.4, -70.6],
  'Pacific/Honolulu': [21.3, -157.8],
  'Pacific/Auckland': [-36.8, 174.8],
  'Europe/London': [51.5, -0.1],
  'Europe/Dublin': [53.3, -6.3],
  'Europe/Lisbon': [38.7, -9.1],
  'Europe/Madrid': [40.4, -3.7],
  'Europe/Paris': [48.9, 2.4],
  'Europe/Berlin': [52.5, 13.4],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Amsterdam': [52.4, 4.9],
  'Europe/Stockholm': [59.3, 18.1],
  'Europe/Oslo': [59.9, 10.8],
  'Europe/Helsinki': [60.2, 24.9],
  'Europe/Warsaw': [52.2, 21],
  'Europe/Athens': [38, 23.7],
  'Europe/Istanbul': [41, 29],
  'Europe/Moscow': [55.8, 37.6],
  'Africa/Cairo': [30, 31.2],
  'Africa/Lagos': [6.5, 3.4],
  'Africa/Nairobi': [-1.3, 36.8],
  'Africa/Johannesburg': [-26.2, 28],
  'Asia/Dubai': [25.2, 55.3],
  'Asia/Kolkata': [22.6, 88.4],
  'Asia/Calcutta': [22.6, 88.4],
  'Asia/Bangkok': [13.8, 100.5],
  'Asia/Singapore': [1.3, 103.8],
  'Asia/Jakarta': [-6.2, 106.8],
  'Asia/Shanghai': [31.2, 121.5],
  'Asia/Hong_Kong': [22.3, 114.2],
  'Asia/Seoul': [37.6, 127],
  'Asia/Tokyo': [35.7, 139.7],
  'Australia/Perth': [-31.9, 115.9],
  'Australia/Adelaide': [-34.9, 138.6],
  'Australia/Brisbane': [-27.5, 153],
  'Australia/Sydney': [-33.9, 151.2],
  'Australia/Melbourne': [-37.8, 145],
};

/** Typical latitudes by region, for zones not in the table. */
const REGION_LATITUDE: Record<string, number> = {
  America: 38,
  Europe: 50,
  Africa: 5,
  Asia: 30,
  Australia: -32,
  Pacific: -15,
  Atlantic: 35,
  Indian: -15,
  Antarctica: -75,
};

/**
 * Best guess at where the viewer is from their time zone alone: a known
 * city, or else the region's typical latitude and the longitude implied by
 * the clock offset. Good to within a few degrees, which is plenty for when
 * the sun comes up.
 */
export function guessLocation(timeZone: string | undefined, utcOffsetHours: number): GeoLocation {
  const known = timeZone ? ZONES[timeZone] : undefined;
  if (known) return { latitude: known[0], longitude: known[1] };
  const region = timeZone?.split('/')[0] ?? '';
  return { latitude: REGION_LATITUDE[region] ?? 40, longitude: clamp(utcOffsetHours * 15, -180, 180) };
}

/**
 * How wintry it is at `date` and `latitude`, 0 (high summer) .. 1 (deep
 * winter): it follows the sun's yearly swing, mirrored in the southern
 * hemisphere, and stays near zero in the tropics.
 */
export function winterness(date: Date, latitude: number): number {
  // Coldest about a month after the solstice.
  const phase = ((dayOfYearLocal(date) - 20) / 365) * 2 * Math.PI;
  const northern = (Math.cos(phase) + 1) / 2;
  const season = latitude >= 0 ? northern : 1 - northern;
  const reach = clamp((Math.abs(latitude) - 23) / 22, 0, 1);
  return season * reach;
}
