import { clamp } from '../core/math';

/** Random pitch spread applied to every one-shot (±8%). */
export const PITCH_VARIATION = 0.08;
/** Random gain spread applied to every one-shot (±15%). */
export const GAIN_VARIATION = 0.15;

const NEAR_CUTOFF_HZ = 18000;
const FAR_CUTOFF_HZ = 2500;

export interface SpatialParams {
  /** Stereo position, -1 (left) .. 1 (right). */
  pan: number;
  gain: number;
  playbackRate: number;
  /** Low-pass cutoff simulating air absorption over distance. */
  cutoff: number;
}

/**
 * How a one-shot should sound for a source at a horizontal screen position
 * `screenX` ∈ [-1, 1] and depth `depthZ` ∈ [0, 1] (0 = the windowsill,
 * 1 = the horizon). Distant sounds are quieter and duller; every play gets a
 * little random pitch and gain so repeated calls never sound identical.
 */
export function spatialParams(screenX: number, depthZ: number, rng: () => number = Math.random): SpatialParams {
  const z = clamp(depthZ, 0, 1);
  const distanceGain = 1 / (1 + 4 * z);
  return {
    pan: clamp(screenX, -1, 1),
    gain: distanceGain * (1 + (rng() * 2 - 1) * GAIN_VARIATION),
    playbackRate: 1 + (rng() * 2 - 1) * PITCH_VARIATION,
    cutoff: NEAR_CUTOFF_HZ * (FAR_CUTOFF_HZ / NEAR_CUTOFF_HZ) ** z,
  };
}

export interface ThunderParams {
  /** Seconds between the flash and the first rumble (sound is slower than light). */
  delay: number;
  gain: number;
  /** Close strikes crack; distant ones only rumble. */
  cutoff: number;
  duration: number;
}

export function thunderParams(intensity: number, distance: number): ThunderParams {
  const d = clamp(distance, 0, 1);
  return {
    delay: 0.25 + d * 5,
    gain: clamp(intensity, 0, 1) * (1 - 0.6 * d),
    cutoff: 1400 * (240 / 1400) ** d,
    duration: 3.5 + d * 3,
  };
}
