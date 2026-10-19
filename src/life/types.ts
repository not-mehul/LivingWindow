import type { SoundId } from '../audio/sounds/SoundBank';
import { clamp } from '../core/math';
import type { SillSurface } from '../window/WindowFrame';

/** How living things make noise: a sound id, stereo position (-1..1) and depth (0..1). */
export type LifeSoundSink = (id: SoundId, pan: number, depth: number) => void;

/** Live facts about the windowsill, refreshed each frame from the screen-space window. */
export interface SillState {
  surface: SillSurface;
  /** Bowl centre, in sill art pixels from `surface.left`. */
  bowlX: number;
  bowlHalfWidth: number;
  /** Fully open (not opening or closing). Sill visitors need an open window. */
  windowOpen: boolean;
  /** The cat's position in sill art pixels, when it is visiting. */
  catX: number | null;
  catStalking: boolean;
  /** A rain puddle on the sill (sill art px), while there is one. */
  puddleX?: number | null;
}

/** Sill width in art pixels. */
export function sillWidth(sill: SillState): number {
  return (sill.surface.right - sill.surface.left) / sill.surface.frameScale;
}

/** Screen x of a point `x` sill art px along the sill. */
export function sillScreenX(sill: SillState, x: number): number {
  return sill.surface.left + x * sill.surface.frameScale;
}

/** The same, snapped to the sill's art-pixel grid (for placing sprites). */
export function sillSnapX(sill: SillState, x: number): number {
  const fs = sill.surface.frameScale;
  return Math.round(sillScreenX(sill, x) / fs) * fs;
}

/** Stereo pan (−1..1) of a point along the sill, from its left end to its right. */
export function sillPan(sill: SillState, x: number): number {
  const { left, right } = sill.surface;
  const half = Math.max(1, (right - left) / 2);
  return clamp((sillScreenX(sill, x) - (left + half)) / half, -1, 1);
}

/** A horizontal surface a bird can stand on, in world pixels. */
export interface Ledge {
  x0: number;
  x1: number;
  /** World y of the surface (birds' feet). */
  y: number;
  /** Which world depth layer the perch belongs to (for occlusion). */
  layer: 'far' | 'mid' | 'near';
  kind: string;
  /** Depth override; otherwise derived from the layer. */
  z?: number;
  /** How far the branch has moved with the wind right now (world px), for birds perched on a swaying tree. */
  sway?: () => { x: number; y: number };
}
