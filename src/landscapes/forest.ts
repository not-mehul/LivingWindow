import { ForestSoundscape } from '../audio/soundscapes/ForestSoundscape';
import { ForestLife } from '../life/forest/ForestLife';
import { ForestScene } from '../scene/forest/ForestScene';
import { CABIN_THEME } from '../window/palette';
import type { Landscape, LandscapeDeps } from './types';

/** Scene 4: the deep forest, from a log cabin. */
export function createForest(deps: LandscapeDeps): Landscape {
  const scene = new ForestScene();
  return {
    id: 'forest',
    scene,
    life: new ForestLife(scene, deps),
    theme: CABIN_THEME,
    createSoundscape: (engine, bed) => new ForestSoundscape(engine, bed),
  };
}
