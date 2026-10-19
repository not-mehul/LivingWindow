import type { Container } from 'pixi.js';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Soundscape } from '../audio/soundscapes/Soundscape';
import type { Viewport } from '../core/Viewport';
import type { LifeSoundSink, SillState } from '../life/types';
import type { Environment } from '../scene/Environment';
import type { WorldScene } from '../scene/WorldScene';
import type { BirdseedState } from '../state/BirdseedState';
import type { FrameTheme } from '../window/palette';

export type LandscapeId = 'city' | 'meadows' | 'beach' | 'forest';

export const LANDSCAPE_IDS: readonly LandscapeId[] = ['city', 'meadows', 'beach', 'forest'];

export const LANDSCAPE_LABELS: Record<LandscapeId, string> = {
  city: 'City',
  meadows: 'Meadows',
  beach: 'Beach',
  forest: 'Forest',
};

/** The sill as the shared window sees it (the landscape adds its own visitor). */
export type SillBase = Omit<SillState, 'catX' | 'catStalking'>;

/** Everything alive in a landscape. */
export interface SceneLife {
  update(dt: number, env: Environment, sill: SillBase): void;
  /** A tap on the view; returns true if a creature reacted. */
  tap(screenX: number, screenY: number): boolean;
  /** Scare the birds (lightning, etc). */
  startleAll(probability: number): void;
  /** Scare sill visitors near a sill x (e.g. seed being poured). */
  startleNear(sillX: number, radius: number): void;
  /** Landscape-specific activity for the ambience (crowd size, herd…), 0..1. */
  readonly ambienceLevel: number;
}

/** Screen-space containers a landscape's creatures draw into. */
export interface LandscapeLayers {
  /** Things flying close to the window, outside the glass. */
  near: Container;
  /** Sill visitors behind the bowl (cat, squirrel). */
  sillBack: Container;
  /** Sill visitors in front of the bowl (birds). */
  sillFront: Container;
  /** In the room, in front of the sill (the dog at the window). */
  room: Container;
}

export interface LandscapeDeps {
  viewport: Viewport;
  layers: LandscapeLayers;
  birdseed: BirdseedState;
  sound: LifeSoundSink;
  canTap: () => boolean;
}

export interface Landscape {
  id: LandscapeId;
  scene: WorldScene;
  life: SceneLife;
  theme: FrameTheme;
  createSoundscape: (engine: AudioEngine, bed?: AudioBuffer) => Soundscape;
}
