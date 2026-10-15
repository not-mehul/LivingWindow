import { createBeach } from './beach';
import { createCity } from './city';
import { createForest } from './forest';
import { createMeadows } from './meadows';
import type { Landscape, LandscapeDeps, LandscapeId } from './types';

const FACTORIES: Record<LandscapeId, (deps: LandscapeDeps) => Landscape> = {
  city: createCity,
  meadows: createMeadows,
  beach: createBeach,
  forest: createForest,
};

export function createLandscape(id: LandscapeId, deps: LandscapeDeps): Landscape {
  return FACTORIES[id](deps);
}

const STORAGE_KEY = 'livingWindow.landscape';

export function loadLandscapeChoice(): LandscapeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in FACTORIES) return saved as LandscapeId;
  } catch {
    // No storage: default view.
  }
  return 'city';
}

export function saveLandscapeChoice(id: LandscapeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not persisted.
  }
}
