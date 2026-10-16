import { MeadowSoundscape } from '../audio/soundscapes/MeadowSoundscape';
import { MeadowLife } from '../life/meadow/MeadowLife';
import { MeadowScene } from '../scene/meadow/MeadowScene';
import { RUSTIC_THEME } from '../window/palette';
import type { Landscape, LandscapeDeps } from './types';

/** Scene 2: the meadows, from a farmhouse. */
export function createMeadows(deps: LandscapeDeps): Landscape {
  const scene = new MeadowScene();
  return {
    id: 'meadows',
    scene,
    life: new MeadowLife(scene, deps),
    theme: RUSTIC_THEME,
    createSoundscape: (engine, bed) => new MeadowSoundscape(engine, bed),
  };
}
