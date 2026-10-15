import type { Landscape, LandscapeDeps, LandscapeId } from './types';

type Factory = (deps: LandscapeDeps) => Landscape;

/**
 * Each landscape is its own code chunk, loaded the first time it is shown,
 * so the first visit only downloads the scene it opens on.
 */
const LOADERS: Record<LandscapeId, () => Promise<Factory>> = {
  city: () => import('./city').then((m) => m.createCity),
  meadows: () => import('./meadows').then((m) => m.createMeadows),
  beach: () => import('./beach').then((m) => m.createBeach),
  forest: () => import('./forest').then((m) => m.createForest),
};

export async function createLandscape(id: LandscapeId, deps: LandscapeDeps): Promise<Landscape> {
  const factory = await LOADERS[id]();
  return factory(deps);
}

/** Start downloading a landscape's code without building it (e.g. on hover). */
export function preloadLandscape(id: LandscapeId): void {
  void LOADERS[id]().catch(() => undefined);
}

const STORAGE_KEY = 'livingWindow.landscape';

export function loadLandscapeChoice(): LandscapeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LOADERS) return saved as LandscapeId;
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
