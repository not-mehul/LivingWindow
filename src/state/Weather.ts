import { WEATHER_BLEND_SECONDS, WEATHER_MANUAL_BLEND_SECONDS } from '../config';
import { Emitter } from '../core/Emitter';
import { clamp } from '../core/math';
import { createRng } from '../core/random';
import { createSimplex2D, type Noise2D } from '../core/simplex';

export type WeatherType = 'clear' | 'overcast' | 'light-rain' | 'thunderstorm' | 'snow';
export type PrecipitationKind = 'none' | 'rain' | 'snow';

export const WEATHER_TYPES: readonly WeatherType[] = [
  'clear',
  'overcast',
  'light-rain',
  'thunderstorm',
  'snow',
];

export const WEATHER_LABELS: Record<WeatherType, string> = {
  clear: 'Clear',
  overcast: 'Overcast',
  'light-rain': 'Light Rain',
  thunderstorm: 'Thunderstorm',
  snow: 'Snow',
};

export interface WeatherProfile {
  cloudCover: number;
  precipitation: number;
  kind: PrecipitationKind;
  lightning: number;
  wind: number;
  /** How long the state lasts before the next Markov step, in simulated hours. */
  dwellHours: readonly [min: number, max: number];
}

export const WEATHER_PROFILES: Record<WeatherType, WeatherProfile> = {
  clear: { cloudCover: 0.12, precipitation: 0, kind: 'none', lightning: 0, wind: 0.2, dwellHours: [2, 6] },
  overcast: { cloudCover: 0.85, precipitation: 0, kind: 'none', lightning: 0, wind: 0.35, dwellHours: [1, 4] },
  'light-rain': { cloudCover: 0.9, precipitation: 0.45, kind: 'rain', lightning: 0, wind: 0.4, dwellHours: [0.75, 3] },
  thunderstorm: { cloudCover: 1, precipitation: 1, kind: 'rain', lightning: 1, wind: 0.85, dwellHours: [0.5, 1.5] },
  snow: { cloudCover: 0.85, precipitation: 0.6, kind: 'snow', lightning: 0, wind: 0.25, dwellHours: [1, 4] },
};

/** Markov transition probabilities, evaluated when a state's dwell time runs out. */
export const WEATHER_TRANSITIONS: Record<WeatherType, Partial<Record<WeatherType, number>>> = {
  clear: { clear: 0.45, overcast: 0.45, 'light-rain': 0.1 },
  overcast: { clear: 0.35, overcast: 0.2, 'light-rain': 0.3, thunderstorm: 0.08, snow: 0.07 },
  'light-rain': { overcast: 0.45, 'light-rain': 0.25, thunderstorm: 0.2, clear: 0.1 },
  thunderstorm: { 'light-rain': 0.6, overcast: 0.4 },
  snow: { overcast: 0.6, snow: 0.4 },
};

/** The season and mood the automatic weather plays to. */
export interface Climate {
  /** 0 = high summer, 1 = deep winter (see `winterness`). */
  winter: number;
  /** Calm mode: storms only when chosen by hand. */
  calm: boolean;
}

export const MILD_CLIMATE: Readonly<Climate> = { winter: 0.5, calm: false };

/** Below this much winter it's too warm to snow. */
const SNOW_LINE = 0.3;

/**
 * The Markov row for `from`, adjusted to the climate: snow only once it's
 * wintry enough (and more of it the deeper the winter), its share going to
 * rain otherwise; in calm mode the storm share goes to gentle rain too.
 */
export function climateTransitions(from: WeatherType, climate: Readonly<Climate>): Partial<Record<WeatherType, number>> {
  const row = { ...WEATHER_TRANSITIONS[from] };
  const snowiness = climate.winter < SNOW_LINE ? 0 : Math.min(1, (climate.winter - SNOW_LINE) / 0.4);
  const move = (what: WeatherType, keep: number, to: WeatherType) => {
    const p = row[what] ?? 0;
    if (p <= 0) return;
    row[what] = p * keep;
    row[to] = (row[to] ?? 0) + p * (1 - keep);
  };
  move('snow', snowiness, from === 'snow' ? 'overcast' : 'light-rain');
  if (climate.calm) move('thunderstorm', 0, 'light-rain');
  return row;
}

export function sampleTransition(from: WeatherType, rng: () => number, climate: Readonly<Climate> = MILD_CLIMATE): WeatherType {
  const row = climateTransitions(from, climate);
  let roll = rng();
  let last: WeatherType = from;
  for (const [to, p] of Object.entries(row) as Array<[WeatherType, number]>) {
    last = to;
    roll -= p;
    if (roll < 0) return to;
  }
  return last;
}

/** Continuous, blended weather values that renderers and audio read each frame. */
export interface WeatherSnapshot {
  /** The state the weather is in, or blending towards. */
  type: WeatherType;
  locked: boolean;
  cloudCover: number;
  /** Current precipitation intensity, 0..1, with organic flutter. */
  precipitation: number;
  /** What is currently falling (switches only once the old kind has stopped). */
  kind: PrecipitationKind;
  /** Storminess, 0..1 (drives lightning frequency and darkness). */
  lightning: number;
  /** Signed wind, roughly -1..1; positive blows towards +x. */
  wind: number;
}

export interface WeatherEvents {
  change: { type: WeatherType; previous: WeatherType; manual: boolean };
  lock: { locked: boolean };
  /** A lightning strike. `distance` 0..1 lets audio delay and soften thunder. */
  lightning: { intensity: number; distance: number };
}

export interface WeatherOptions {
  initial?: WeatherType;
  rng?: () => number;
  noise?: Noise2D;
}

/** Strikes per real second at full storm intensity (before noise bursts). */
const LIGHTNING_RATE = 0.14;
const PRECIP_EPSILON = 0.02;

/**
 * Weather engine: a Markov chain picks the next state when the current one
 * has run its course (in simulated time), and every continuous value eases
 * towards the new state's profile in real time, with simplex noise layered
 * on top so gusts and downpours never repeat.
 */
export class Weather extends Emitter<WeatherEvents> {
  private readonly rng: () => number;
  private readonly noise: Noise2D;
  private _type: WeatherType;
  private _locked = false;
  private remainingHours: number;
  private blendSeconds = WEATHER_BLEND_SECONDS;
  private elapsed = 0;
  private climate: Climate = { ...MILD_CLIMATE };

  private cloud: number;
  private precipBase: number;
  private storm: number;
  private windBase: number;
  private kind: PrecipitationKind;

  private readonly _snapshot: WeatherSnapshot;

  constructor(options: WeatherOptions = {}) {
    super();
    this.rng = options.rng ?? Math.random;
    this.noise = options.noise ?? createSimplex2D(createRng(Math.floor(this.rng() * 2 ** 31)));
    this._type = options.initial ?? 'clear';
    const profile = WEATHER_PROFILES[this._type];
    this.cloud = profile.cloudCover;
    this.precipBase = profile.precipitation;
    this.storm = profile.lightning;
    this.windBase = profile.wind;
    this.kind = profile.kind;
    this.remainingHours = this.sampleDwell(this._type);
    this._snapshot = {
      type: this._type,
      locked: false,
      cloudCover: this.cloud,
      precipitation: this.precipBase,
      kind: this.kind,
      lightning: this.storm,
      wind: this.windBase,
    };
    this.refreshSnapshot();
  }

  get type(): WeatherType {
    return this._type;
  }

  get locked(): boolean {
    return this._locked;
  }

  /** Live values; the same object is updated in place every frame. */
  get snapshot(): Readonly<WeatherSnapshot> {
    return this._snapshot;
  }

  /** Pick up where a previous visit left off, without a blend. */
  restore(type: WeatherType, locked: boolean): void {
    this.setLocked(locked);
    this.transitionTo(type, false);
    const profile = WEATHER_PROFILES[type];
    this.cloud = profile.cloudCover;
    this.precipBase = profile.precipitation;
    this.storm = profile.lightning;
    this.windBase = profile.wind;
    this.kind = profile.kind;
    this.refreshSnapshot();
  }

  /** Switch weather by hand. By default the choice is locked until `unlock()`. */
  setWeather(type: WeatherType, lock = true): void {
    this.setLocked(lock);
    this.blendSeconds = WEATHER_MANUAL_BLEND_SECONDS;
    this.transitionTo(type, true);
  }

  /** Hand control back to the automatic weather cycle. */
  unlock(): void {
    this.setLocked(false);
  }

  /**
   * Tell the automatic weather the season and mood. Weather that no longer
   * fits (snow in summer, a storm in calm mode) moves on soon, gently.
   */
  setClimate(climate: Readonly<Climate>): void {
    this.climate = { ...climate };
    if (this._locked) return;
    const outOfSeason = this._type === 'snow' && climate.winter < SNOW_LINE;
    const tooRough = this._type === 'thunderstorm' && climate.calm;
    if (outOfSeason || tooRough) this.remainingHours = Math.min(this.remainingHours, 0.25);
  }

  /**
   * @param realDeltaSeconds real time step (drives blending, noise, lightning)
   * @param simHours simulated time that passed (drives the Markov chain)
   */
  update(realDeltaSeconds: number, simHours: number): void {
    this.elapsed += realDeltaSeconds;

    if (!this._locked && simHours > 0) {
      this.remainingHours -= simHours;
      if (this.remainingHours <= 0) {
        this.blendSeconds = WEATHER_BLEND_SECONDS;
        this.transitionTo(sampleTransition(this._type, this.rng, this.climate), false);
      }
    }

    this.blend(realDeltaSeconds);
    this.refreshSnapshot();
    this.maybeStrike(realDeltaSeconds);
  }

  private transitionTo(type: WeatherType, manual: boolean): void {
    this.remainingHours = this.sampleDwell(type);
    if (type === this._type) return;
    const previous = this._type;
    this._type = type;
    this.emit('change', { type, previous, manual });
  }

  private setLocked(locked: boolean): void {
    if (locked === this._locked) return;
    this._locked = locked;
    this.emit('lock', { locked });
  }

  private sampleDwell(type: WeatherType): number {
    const [min, max] = WEATHER_PROFILES[type].dwellHours;
    return min + (max - min) * this.rng();
  }

  private blend(dt: number): void {
    const profile = WEATHER_PROFILES[this._type];
    // Exponential approach: ~95% of the way there after `blendSeconds`.
    const k = dt <= 0 ? 0 : 1 - Math.exp((-3 * dt) / this.blendSeconds);
    const ease = (current: number, target: number) => current + (target - current) * k;

    // Whatever is falling now must stop before something else (or nothing)
    // takes over: rain tapers off before the first snowflakes appear.
    const mustStop = this.kind !== 'none' && this.kind !== profile.kind;
    const precipTarget = mustStop ? 0 : profile.precipitation;

    this.cloud = ease(this.cloud, profile.cloudCover);
    this.precipBase = ease(this.precipBase, precipTarget);
    this.storm = ease(this.storm, profile.lightning);
    this.windBase = ease(this.windBase, profile.wind);

    if (mustStop && this.precipBase < PRECIP_EPSILON) this.kind = profile.kind;
    if (this.kind === 'none' && profile.kind !== 'none') this.kind = profile.kind;
  }

  private refreshSnapshot(): void {
    const t = this.elapsed;
    const s = this._snapshot;
    const flutter = this.noise(t * 0.07, 11.3); // slow swells in intensity
    const gust = this.noise(t * 0.045, 42.1);
    const direction = clamp(this.noise(t * 0.003, 97.7) * 1.6, -1, 1);

    s.type = this._type;
    s.locked = this._locked;
    s.cloudCover = clamp(this.cloud + 0.05 * this.noise(t * 0.01, 3.3), 0, 1);
    s.kind = this.kind;
    s.precipitation =
      this.kind === 'none' ? 0 : clamp(this.precipBase * (0.8 + 0.2 * flutter), 0, 1);
    s.lightning = this.storm;
    s.wind = this.windBase * (0.65 + 0.35 * gust) * (0.4 + 0.6 * direction);
  }

  private maybeStrike(dt: number): void {
    if (this.storm < 0.05 || dt <= 0) return;
    // Noise makes strikes arrive in bursts rather than at a steady rate.
    const burst = 0.4 + 0.8 * (0.5 + 0.5 * this.noise(this.elapsed * 0.08, 71.9));
    const rate = LIGHTNING_RATE * this.storm * burst;
    if (this.rng() < rate * dt) {
      this.emit('lightning', {
        intensity: 0.5 + 0.5 * this.rng(),
        distance: this.rng(),
      });
    }
  }
}
