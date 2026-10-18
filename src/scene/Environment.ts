import type { WeatherSnapshot } from '../state/Weather';
import type { Lighting } from './lighting';

/** Everything a scene needs to know about the world outside, once per frame. */
export interface Environment {
  /** Real seconds since the simulation started (for animation phases). */
  time: number;
  lighting: Lighting;
  weather: Readonly<WeatherSnapshot>;
}
