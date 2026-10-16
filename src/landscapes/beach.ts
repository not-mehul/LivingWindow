import { BeachSoundscape } from '../audio/soundscapes/BeachSoundscape';
import { BeachLife } from '../life/beach/BeachLife';
import { BeachScene } from '../scene/beach/BeachScene';
import { RUSTIC_THEME } from '../window/palette';
import type { Landscape, LandscapeDeps } from './types';

/** Scene 3: the beach, from a weathered beach house. */
export function createBeach(deps: LandscapeDeps): Landscape {
  const scene = new BeachScene();
  return {
    id: 'beach',
    scene,
    life: new BeachLife(scene, deps),
    theme: RUSTIC_THEME,
    createSoundscape: (engine, bed) => new BeachSoundscape(engine, scene, bed),
  };
}
