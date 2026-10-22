import { crickets, creek, distantBirds, foam, frogs, grasshoppers, katydids, murmur, shingle, trill } from '../audio/soundscapes/nature';
import { SOUND_IDS, type SoundId } from '../audio/sounds/SoundBank';
import type { TextureSpec } from '../audio/textures';

/**
 * Everything the sound preview page lists. One-shots are grouped by hand;
 * any id not named here lands in "In the scene", so new sounds always show.
 */

const BIRDS: readonly SoundId[] = [
  'sparrow-chirp',
  'robin-song',
  'chickadee-call',
  'finch-song',
  'bluebird-song',
  'pigeon-coo',
  'crow-caw',
  'raven-croak',
  'jay-call',
  'gull-cry',
  'sandpiper-peep',
  'owl-hoot',
  'eagle-cry',
  'nightjar-churr',
  'woodpecker-drum',
  'wing-flap',
];
const ANIMALS: readonly SoundId[] = [
  'cat-meow',
  'cat-purr',
  'dog-boof',
  'dog-howl',
  'wolf-howl',
  'elk-bugle',
  'fox-bark',
  'cow-moo',
  'sheep-baa',
  'horse-whinny',
  'squirrel-chatter',
  'chicken-cluck',
  'deer-snort',
  'bear-huff',
];
/** Sounds of the room itself: played centred and dry, as the app does. */
export const ROOM_SOUNDS: ReadonlySet<SoundId> = new Set(['glass-tap', 'seed-pour', 'window-thunk', 'wood-creak']);
/** Pets in the room: heard close, never muffled by the window. */
export const PET_SOUNDS: ReadonlySet<SoundId> = new Set(['cat-meow', 'cat-purr', 'dog-boof', 'dog-howl']);

export function oneShotGroups(ids: readonly SoundId[] = SOUND_IDS): Array<{ group: string; ids: SoundId[] }> {
  const named: Array<[string, readonly SoundId[]]> = [
    ['Birds', BIRDS],
    ['Animals', ANIMALS],
    ['Room and window', [...ROOM_SOUNDS]],
  ];
  const known = new Set(ids);
  const placed = new Set<SoundId>();
  const groups = named.map(([group, list]) => {
    const present = list.filter((id) => known.has(id));
    for (const id of present) placed.add(id);
    return { group, ids: present };
  });
  groups.push({ group: 'In the scene', ids: ids.filter((id) => !placed.has(id)) });
  return groups.filter((g) => g.ids.length > 0);
}

export interface LoopEntry {
  id: string;
  label: string;
  /** Where the app uses it. */
  where: string;
  spec: () => TextureSpec;
  /** About the level the app plays it at. */
  level: number;
}

export const LOOPS: readonly LoopEntry[] = [
  { id: 'loop:crickets', label: 'Crickets', where: 'night, everywhere', spec: () => crickets(6), level: 0.24 },
  { id: 'loop:katydids', label: 'Katydids', where: 'forest at night', spec: () => katydids(3), level: 0.2 },
  { id: 'loop:trill', label: 'Insect trill', where: 'forest at night', spec: trill, level: 0.18 },
  { id: 'loop:frogs', label: 'Frogs', where: 'meadow pond, dusk', spec: () => frogs(6), level: 0.26 },
  { id: 'loop:grasshoppers', label: 'Grasshoppers', where: 'meadow by day', spec: grasshoppers, level: 0.22 },
  { id: 'loop:creek', label: 'Creek', where: 'meadow stream', spec: creek, level: 0.32 },
  { id: 'loop:birds', label: 'Distant birds', where: 'meadow and forest by day', spec: distantBirds, level: 0.2 },
  { id: 'loop:foam', label: 'Foam fizz', where: 'beach', spec: foam, level: 0.25 },
  { id: 'loop:shingle', label: 'Shingle', where: 'beach backwash', spec: shingle, level: 0.25 },
  { id: 'loop:murmur', label: 'Crowd murmur', where: 'city street', spec: murmur, level: 0.25 },
];

/** "sparrow-chirp" → "Sparrow chirp". */
export function soundLabel(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
