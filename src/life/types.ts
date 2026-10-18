import type { SoundId } from '../audio/sounds/SoundBank';
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
}

/** Sill width in art pixels. */
export function sillWidth(sill: SillState): number {
  return (sill.surface.right - sill.surface.left) / sill.surface.frameScale;
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
