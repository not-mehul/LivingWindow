import { CitySoundscape } from '../audio/soundscapes/CitySoundscape';
import { CityLife } from '../life/CityLife';
import { CityScene } from '../scene/city/CityScene';
import { RUSTIC_THEME } from '../window/palette';
import type { Landscape, LandscapeDeps } from './types';

/** Scene 1: the downtown city rooftop. */
export function createCity(deps: LandscapeDeps): Landscape {
  const scene = new CityScene();
  const life = new CityLife(scene, deps);
  return {
    id: 'city',
    scene,
    life,
    theme: RUSTIC_THEME,
    createSoundscape: (engine, bed) => new CitySoundscape(engine, bed),
  };
}
