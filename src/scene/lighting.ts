import { desaturate, lerpColor, luminance, scaleColor } from '../core/color';

/** Warm lamp light inside the room, which takes over from daylight at night. */
const ROOM_LAMP = 0xffd9b0;

/** Light on things inside the room: daylight through the window, a warm lamp at night. */
export function interiorTint(lighting: Pick<Lighting, 'ambient' | 'darkness'>): number {
  return lerpColor(lerpColor(0xffffff, lighting.ambient, 0.5), ROOM_LAMP, lighting.darkness * 0.55);
}
import { clamp } from '../core/math';
import { wrapHours } from '../state/timeOfDay';
import type { WeatherSnapshot } from '../state/Weather';

/**
 * Scene-agnostic lighting for a moment in time. Colours are 0xRRGGBB tints:
 * scene art is authored at full daylight and multiplied by these.
 */
/** The ambient tint, pushed `amount` of the way into the distance haze (for things further off). */
export function hazeTint(lighting: Pick<Lighting, 'ambient' | 'haze'>, amount: number): number {
  return lerpColor(lighting.ambient, lighting.haze, amount);
}

export interface Lighting {
  hours: number;
  skyTop: number;
  skyHorizon: number;
  /** Multiply tint for foreground and midground layers. */
  ambient: number;
  /** Tint for distant layers: ambient blended into the horizon haze. */
  haze: number;
  cloudTint: number;
  /** 0 = broad daylight, 1 = deep night (after weather). */
  darkness: number;
  /**
   * How far into true night it is, 0..1: scenes cross-fade their art to its
   * moonlit version by this. Zero through the day and twilight.
   */
  nightness: number;
  /**
   * The glow of dusk and dawn, 0..1: peaks while the sun is at or just below
   * the horizon and hands over to `nightness` as it gets dark.
   */
  twilight: number;
  /** How bright the moonlight is, 0..1 (cloud and storm dim it). */
  moonlight: number;
  stars: number;
  sun: CelestialBody;
  moon: CelestialBody;
  /** Fraction of building windows with their lights on. */
  windowsLit: number;
  /** Opacity of emissive layers (lit windows, lamps, fireflies). */
  emissive: number;
  /** Tint for falling rain / snow and drops on the glass. */
  precipitationTint: number;
}

export interface CelestialBody {
  visible: boolean;
  /** Progress across the sky, 0 (rising, left) → 1 (setting, right). */
  progress: number;
  /** Height above the horizon, 0..1 (sin of the arc). */
  elevation: number;
  color: number;
  /** Strength of the surrounding glow (sun) or brightness (moon), 0..1. */
  glow: number;
}

interface Keyframe {
  h: number;
  top: number;
  horizon: number;
  ambient: number;
  cloud: number;
  stars: number;
}

/** Clear-sky palette through the day; weather is layered on afterwards. */
const KEYFRAMES: readonly Keyframe[] = [
  { h: 0, top: 0x0b0e24, horizon: 0x1d2246, ambient: 0x3a4272, cloud: 0x2a2f52, stars: 1 },
  { h: 3, top: 0x070918, horizon: 0x141834, ambient: 0x30375f, cloud: 0x22263f, stars: 1 },
  { h: 4.75, top: 0x141a3e, horizon: 0x3a3462, ambient: 0x434673, cloud: 0x3a3858, stars: 0.8 },
  { h: 5.75, top: 0x2c3a78, horizon: 0xc87a86, ambient: 0x8a7aa0, cloud: 0xb88aa0, stars: 0.25 },
  { h: 6.5, top: 0x4a6ab4, horizon: 0xf6a77e, ambient: 0xc8a8b0, cloud: 0xf2b8a8, stars: 0 },
  { h: 7.5, top: 0x5a8ed4, horizon: 0xf4d2aa, ambient: 0xeadad0, cloud: 0xfbe6dc, stars: 0 },
  { h: 9, top: 0x4a90e0, horizon: 0xbadcf2, ambient: 0xf6f4f0, cloud: 0xffffff, stars: 0 },
  { h: 13, top: 0x3c88e0, horizon: 0xb4daf8, ambient: 0xffffff, cloud: 0xffffff, stars: 0 },
  { h: 16, top: 0x4a86d6, horizon: 0xd8dcc8, ambient: 0xfff2e0, cloud: 0xfff4e8, stars: 0 },
  { h: 17.5, top: 0x5470bc, horizon: 0xffb466, ambient: 0xffcc96, cloud: 0xffd2a8, stars: 0 },
  { h: 18.6, top: 0x3c3c86, horizon: 0xf07e6a, ambient: 0xc08a98, cloud: 0xf09a8a, stars: 0.1 },
  { h: 19.4, top: 0x262a66, horizon: 0x8a4e74, ambient: 0x7a6a92, cloud: 0x8a6082, stars: 0.4 },
  { h: 20.5, top: 0x121636, horizon: 0x2e2c56, ambient: 0x464c7e, cloud: 0x34365a, stars: 0.85 },
];

/** Fraction of city windows lit through the day: the evening peak, the 2–4 AM lull. */
const WINDOWS_LIT: ReadonlyArray<[hour: number, fraction: number]> = [
  [0, 0.15],
  [2, 0.07],
  [4, 0.06],
  [5.5, 0.14],
  [7, 0.12],
  [8.5, 0.04],
  [16, 0.05],
  [18, 0.16],
  [20, 0.22],
  [22.5, 0.2],
  [24, 0.15],
];

/** The cool blue the night lifts towards under the moon. */
const MOONLIGHT = 0x6878a8;

const SUNRISE = 6;
const SUNSET = 19;
const MOONRISE = 19.5;
const MOONSET = 6.5;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleKeyframes(hours: number): Keyframe {
  const h = wrapHours(hours);
  let a = KEYFRAMES[KEYFRAMES.length - 1];
  let b = KEYFRAMES[0];
  for (let i = 0; i < KEYFRAMES.length; i++) {
    const next = KEYFRAMES[(i + 1) % KEYFRAMES.length];
    const nextH = i + 1 < KEYFRAMES.length ? next.h : next.h + 24;
    if (h >= KEYFRAMES[i].h && h < nextH) {
      a = KEYFRAMES[i];
      b = next;
      break;
    }
  }
  const span = (b.h <= a.h ? b.h + 24 : b.h) - a.h;
  const t = smoothstep(clamp((h - a.h) / span, 0, 1));
  return {
    h,
    top: lerpColor(a.top, b.top, t),
    horizon: lerpColor(a.horizon, b.horizon, t),
    ambient: lerpColor(a.ambient, b.ambient, t),
    cloud: lerpColor(a.cloud, b.cloud, t),
    stars: a.stars + (b.stars - a.stars) * t,
  };
}

export function windowsLitAt(hours: number): number {
  const h = wrapHours(hours);
  for (let i = 0; i < WINDOWS_LIT.length - 1; i++) {
    const [h0, f0] = WINDOWS_LIT[i];
    const [h1, f1] = WINDOWS_LIT[i + 1];
    if (h >= h0 && h < h1) return f0 + ((f1 - f0) * (h - h0)) / (h1 - h0);
  }
  return WINDOWS_LIT[0][1];
}

function arc(hours: number, rise: number, set: number): { visible: boolean; progress: number; elevation: number } {
  const length = wrapHours(set - rise);
  const since = wrapHours(hours - rise);
  // Allow a little travel below the horizon so bodies sink behind the skyline.
  const margin = 0.4;
  const beforeRise = since >= 24 - margin;
  const visible = since <= length + margin || beforeRise;
  const p = beforeRise ? (since - 24) / length : since / length;
  return { visible, progress: p, elevation: Math.sin(Math.PI * clamp(p, 0, 1)) };
}

/** Darkness implied by an ambient colour: ~0 at noon, ~1 at midnight. */
function darknessOf(ambient: number): number {
  return clamp((0.86 - luminance(ambient)) / 0.6, 0, 1);
}

const CLEAR_WEATHER: Pick<WeatherSnapshot, 'cloudCover' | 'lightning' | 'precipitation'> = {
  cloudCover: 0,
  lightning: 0,
  precipitation: 0,
};

export function computeLighting(
  hours: number,
  weather: Pick<WeatherSnapshot, 'cloudCover' | 'lightning' | 'precipitation'> = CLEAR_WEATHER,
): Lighting {
  const key = sampleKeyframes(hours);
  const cloud = clamp(weather.cloudCover, 0, 1);
  const storm = clamp(weather.lightning, 0, 1);

  // Overcast skies drain colour towards a grey cloud deck; storms darken it.
  const overcast = clamp(cloud * 0.75 + storm * 0.2, 0, 0.92);
  const deck = (color: number) => scaleColor(desaturate(color, 1), 0.92 - storm * 0.4);
  const skyTop = lerpColor(key.top, deck(key.top), overcast);
  const skyHorizon = lerpColor(key.horizon, deck(key.horizon), overcast);

  const dimmed = scaleColor(desaturate(key.ambient, cloud * 0.35), 1 - cloud * 0.22 - storm * 0.22);
  const darkness = darknessOf(dimmed);
  // By moonlight the night isn't murky: things lift towards a cool, readable blue.
  const nightness = smoothstep(clamp((darkness - 0.55) / 0.4, 0, 1));
  const moonlight = clamp(1 - cloud * 0.55 - storm * 0.3, 0, 1);
  const twilight = smoothstep(clamp((darkness - 0.12) / 0.26, 0, 1)) * (1 - nightness);
  const ambient = lerpColor(dimmed, MOONLIGHT, nightness * 0.6 * moonlight);
  const haze = lerpColor(ambient, skyHorizon, 0.38);
  const cloudTint = scaleColor(desaturate(key.cloud, cloud * 0.5), 1 - cloud * 0.3 - storm * 0.3);

  const sunArc = arc(hours, SUNRISE, SUNSET);
  const moonArc = arc(hours, MOONRISE, MOONSET);
  const lowSun = 1 - sunArc.elevation;

  return {
    hours: key.h,
    skyTop,
    skyHorizon,
    ambient,
    haze,
    cloudTint,
    darkness,
    nightness,
    twilight,
    moonlight,
    stars: key.stars * (1 - cloud) * (1 - cloud),
    sun: {
      ...sunArc,
      color: lerpColor(0xfff6d8, 0xffa860, lowSun * lowSun),
      glow: sunArc.visible ? (0.2 + 0.7 * lowSun) * (1 - cloud * 0.9) : 0,
    },
    moon: {
      ...moonArc,
      color: lerpColor(0xf4f2e8, 0xffd9a0, (1 - moonArc.elevation) ** 2),
      glow: moonArc.visible ? (0.35 + 0.65 * darknessOf(key.ambient)) * (1 - cloud * 0.85) : 0,
    },
    windowsLit: clamp(windowsLitAt(hours) + 0.12 * storm * (1 - darkness), 0, 1),
    emissive: 0.25 + 0.75 * darkness,
    precipitationTint: lerpColor(ambient, 0x9aa8c8, 0.45),
  };
}
