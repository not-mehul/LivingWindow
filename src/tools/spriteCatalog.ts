import { PixelBuffer } from '../core/pixelBuffer';
import { createRng } from '../core/random';
import { ADS, drawAd, type AdId } from '../scene/city/ads';
import { idolArt, koiArt } from '../scene/city/Holograms';
import { drawLoco, drawVehicle, drawWagon } from '../scene/city/DistantTransit';
import { drawPalm, flattenPalm } from '../scene/beach/beachGenerator';
import { rustleFrames } from '../scene/common/rustle';
import { BROADLEAF, CONIFER, drawBroadleaf, drawConifer, drawOak, drawTallPine } from '../scene/common/trees';
import { drawBirch, drawFoxglove, drawMossStrand, drawRock, drawShrub, drawSnag } from '../scene/forest/forestFlora';
import { leafColors } from '../scene/forest/forestGenerator';
import { drawRotor } from '../scene/meadow/farmstead';
import { drawCoconut } from '../life/beach/BeachAir';
import { drawWeb } from '../life/forest/Webs';
import { TEMPERAMENTS } from '../sim/birdBrain';
import { drawCrab, drawDolphinSized, DOLPHIN_FRAMES, drawHatchling, drawHermitCrab, drawJellyfish, drawPelican, drawTurtleSized, HATCHLING_FRAMES, JELLY_FRAMES, type PelicanPose } from '../sprites/beachSprites';
import { CLOSE_SPECIES, drawBirdClose, FLAP_CYCLE_6 } from '../sprites/birdClose';
import { drawBirdAt, FLAP_CYCLE, SPECIES, type BirdPose, type SpeciesId } from '../sprites/birdSprites';
import { CAT_COATS, CAT_GROOM, CAT_STALK, CAT_WALK, drawCat, type CatCoat, type CatPose } from '../sprites/catSprites';
import { DOG_BREEDS, DOG_PANT_FACE, DOG_PANT_SIDE, drawWindowDog, type DogLook, type DogPose as WindowDogPose } from '../sprites/dogSprites';
import { DEER_WALK, drawDeerSized, drawSquirrelSized, SQUIRREL_CLIMB, SQUIRREL_RUN, type DeerKind, type DeerPose, type SquirrelCoat, type SquirrelPose } from '../sprites/forestSprites';
import type { Drawn } from '../sprites/kit';
import { COW_WALK, drawChickenSized, drawCowSized, drawDogSized, drawHorseSized, drawRabbitSized, drawScarecrow, drawSheepSized, drawTopFishSized, HORSE_WALK, RABBIT_HOP, SHEEP_WALK, TOP_FISH_HEADINGS, type ChickenCoat, type ChickenPose, type CowCoat, type CowPose, type DogPose, type FishKind, type HorsePose, type RabbitPose, type SheepPose } from '../sprites/meadowSprites';
import { drawOwl, drawOwlInHollow, type HollowFace } from '../sprites/owlSprites';
import { drawBusker, drawPerson, randomLook, type PersonFacing, type PersonPose } from '../sprites/people';
import type { PixelGrid } from '../sprites/raster';
import { drawEgret, drawFishingBoat, drawFrigatebird, drawGull, drawJumpFish, drawNightjar, drawSailboat, drawSandpiper, JUMP_FRAMES, NIGHTJAR_FRAMES, SANDPIPER_FLY, SANDPIPER_RUN, type EgretPose, type GullPose, type SandpiperPose } from '../sprites/shoreSprites';
import { drawBlimp, drawHelicopter, drawPadDrone } from '../sprites/skySprites';
import { drawStallLightsSized, drawStallSized, STALL_LIGHT_PALETTE, STALL_STAGES, type StallKind } from '../sprites/streetSprites';
import { drawPushcart, drawRider, drawSweeper, drawTaxi, randomRiderLook, SWEEPER_BRUSH, type RiderKind, type VehicleFacing } from '../sprites/vehicleSprites';
import { BEAR_WALK, BUTTERFLY_FLIGHT, drawBat, drawBear, drawButterfly, drawEagleSoar, drawFox, drawHedgehog, drawMushroom, drawWolf, drawWoodpeckerCling, EAGLE_STOOP, FOX_TROT, HEDGEHOG_SHUFFLE, WOLF_WALK, type BearPose, type ButterflyKind, type FoxPose, type MushroomKind, type WolfPose } from '../sprites/wildSprites';
import { dishGeometry, drawDish } from '../window/BirdseedBowl';
import { CLUMPS, drawLeaves, drawPot, LEAF_COLORS } from '../window/SillDecor';
import { drawBody, drawHomeScreen } from '../window/SillTablet';
import { dishSize, plantSize, tabletSize } from '../window/sillProps';
import type { BirdseedStage } from '../state/BirdseedState';

/**
 * Everything the sprite preview page shows: one entry per animation (or per
 * set of stills), with the frames it plays, how fast, the sizes it's drawn
 * at and its variants (coats, breeds, species…). Frame rates come from the
 * life modules that play them; gaits driven by distance walked carry `step`,
 * the art px travelled per frame, so the page can walk them across and show
 * any foot slide.
 */

/** A frame as the sprite modules draw it. */
export type Frame = Drawn | { grid: PixelGrid; colors: readonly number[] } | { buffer: PixelBuffer };

export interface SpriteEntry {
  id: string;
  label: string;
  group: string;
  /** Draw the frames for a variant at a size (the size is in the entry's own unit: px tall, wide, or a scale). */
  frames: (variant: string, size: number) => Frame[];
  /** Seconds each frame shows: one value for all, or per frame. */
  seconds: number | ((frame: number) => number);
  sizes: readonly number[];
  /** What a size means: px (tall, wide or across) or the window's scale. */
  sizeUnit?: 'px' | 'scale';
  variants: readonly string[];
  /** Art px travelled per frame at the first size, for gaits. */
  step?: number;
  /** A line of context: where it's seen, how its timing was found. */
  detail?: string;
}

export const STILL_SECONDS = 0.7;

/** An image of a frame: its size and RGBA pixels. */
export function frameImage(frame: Frame): { width: number; height: number; data: Uint8ClampedArray } {
  if ('buffer' in frame) return { width: frame.buffer.width, height: frame.buffer.height, data: frame.buffer.data };
  const colors = 'palette' in frame ? frame.palette.colors : frame.colors;
  return { width: frame.grid.width, height: frame.grid.height, data: frame.grid.toRGBA(colors) };
}

const entries: SpriteEntry[] = [];
const NO_VARIANT = [''] as const;

function add(entry: Omit<SpriteEntry, 'variants' | 'sizes'> & { variants?: readonly string[]; sizes?: readonly number[] }): void {
  entries.push({ variants: NO_VARIANT, sizes: [0], ...entry });
}

/** Stills: shown one after another, slowly. */
function stills(entry: Omit<SpriteEntry, 'variants' | 'sizes' | 'seconds'> & { variants?: readonly string[]; sizes?: readonly number[] }): void {
  add({ seconds: STILL_SECONDS, ...entry });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const speciesName = (s: SpeciesId) => (s === 'seagull' ? 'Gull' : cap(s));

// ---------------------------------------------------------------- Birds

/** Perched life near the window (`life/BirdSystem.ts` MICRO, 0.16 s a beat). */
const PERCHED: readonly BirdPose[] = ['idle', 'idle-breathe', 'blink', 'idle', 'tilt', 'tilt', 'look-up', 'look-back', 'idle', 'fluff', 'fluff', 'idle-breathe', 'preen-1', 'preen-2', 'preen-1', 'preen-2', 'scratch-1', 'scratch-2', 'scratch-1', 'tail-flick', 'idle', 'tail-flick'];
const FEEDING: readonly BirdPose[] = ['idle', 'peck-reach', 'peck-down', 'peck-swallow', 'idle', 'chirp', 'chirp-2', 'chirp', 'idle', 'hop-crouch', 'hop-air', 'hop-land', 'idle'];
const COMINGS: readonly BirdPose[] = ['idle', 'takeoff-1', 'takeoff-2', ...FLAP_CYCLE_6, ...FLAP_CYCLE_6, 'glide', 'glide', 'flare-1', 'flare-2', 'hop-land', 'idle'];

for (const species of CLOSE_SPECIES) {
  const name = speciesName(species);
  const size = Math.round(48 * SPECIES[species].size);
  const sizes = [size, Math.round(size * 0.6)];
  const flap = TEMPERAMENTS[species].flapRate;
  add({
    id: `bird:${species}:flap`,
    label: `${name} · flap`,
    group: 'Birds near the window',
    frames: (_v, n) => FLAP_CYCLE_6.map((pose) => drawBirdClose(species, pose, n)),
    seconds: 1 / (flap * 6),
    sizes,
    detail: `${flap} beats a second`,
  });
  add({ id: `bird:${species}:perched`, label: `${name} · perched`, group: 'Birds near the window', frames: (_v, n) => PERCHED.map((pose) => drawBirdClose(species, pose, n)), seconds: 0.16, sizes, detail: 'blink, tilt, fluff, preen, scratch, tail' });
  add({ id: `bird:${species}:feeding`, label: `${name} · feeding`, group: 'Birds near the window', frames: (_v, n) => FEEDING.map((pose) => drawBirdClose(species, pose, n)), seconds: 0.14, sizes, detail: 'peck, chirp, hop' });
  add({ id: `bird:${species}:landing`, label: `${name} · take off and land`, group: 'Birds near the window', frames: (_v, n) => COMINGS.map((pose) => drawBirdClose(species, pose, n)), seconds: 1 / (flap * 6), sizes });
}

const FAR_SPECIES: readonly SpeciesId[] = ['sparrow', 'pigeon', 'crow', 'robin', 'jay', 'seagull', 'sandpiper', 'bluebird', 'chickadee', 'woodpecker', 'finch'];
add({
  id: 'bird:far:flight',
  label: 'Far birds · flight',
  group: 'Birds far off',
  variants: FAR_SPECIES,
  frames: (v, n) => FLAP_CYCLE.map((pose) => drawBirdAt(v as SpeciesId, pose, n)),
  seconds: 1 / 10,
  sizes: [10, 6, 13, 16],
  detail: 'flocks and passing birds, about 10 frames a second',
});
stills({ id: 'bird:far:ground', label: 'Far birds · on the ground', group: 'Birds far off', variants: FAR_SPECIES, frames: (v, n) => (['idle', 'peck-down', 'look-back', 'sleep', 'glide'] as const).map((pose) => drawBirdAt(v as SpeciesId, pose, n)), sizes: [10, 6, 13, 16] });

const OWL_SIZES = [26, 12, 18, 40];
add({ id: 'owl:perched', label: 'Owl · perched', group: 'Birds far off', frames: (_v, n) => (['idle', 'idle-breathe', 'blink', 'idle', 'tilt', 'look-back', 'fluff', 'chirp', 'sleep'] as BirdPose[]).map((pose) => drawOwl(pose, n)), seconds: 0.4, sizes: OWL_SIZES });
add({ id: 'owl:flight', label: 'Owl · flight', group: 'Birds far off', frames: (_v, n) => ([...FLAP_CYCLE_6, ...FLAP_CYCLE_6, 'glide', 'glide', 'flare-1', 'flare-2'] as BirdPose[]).map((pose) => drawOwl(pose, n)), seconds: 1 / 24, sizes: [20, 12, 30] });
stills({ id: 'owl:hollow', label: 'Owl · in its hollow', group: 'Birds far off', frames: () => (['sleep', 'blink', 'awake', 'look-l', 'look-r', 'empty'] as HollowFace[]).map((face) => drawOwlInHollow(7, face)) });
add({ id: 'eagle:soar', label: 'Eagle · soaring', group: 'Birds far off', frames: (_v, n) => [0, 1, 2, 1, EAGLE_STOOP].map((f) => drawEagleSoar(f, n)), seconds: 0.5, sizes: [14, 10, 18], detail: 'wing flex, then the stoop' });
add({ id: 'woodpecker:cling', label: 'Woodpecker · drumming', group: 'Birds far off', frames: (_v, n) => [0, 1, 2, 3].map((f) => drawWoodpeckerCling(f, n)), seconds: 0.06, sizes: [12, 8, 16, 24] });
add({ id: 'bat:flight', label: 'Bat · flight', group: 'Birds far off', frames: (_v, n) => [0, 1, 2, 3].map((f) => drawBat(f, n)), seconds: 1 / 14, sizes: [12, 8, 16, 24] });
add({ id: 'nightjar:flight', label: 'Nightjar · flight', group: 'Shore birds', frames: (_v, n) => Array.from({ length: NIGHTJAR_FRAMES }, (_, f) => drawNightjar(f, n)), seconds: 1 / 10, sizes: [16, 12] });

const SANDPIPER_SIZES = [12, 8, 18];
add({ id: 'sandpiper:run', label: 'Sandpiper · run', group: 'Shore birds', frames: (_v, n) => SANDPIPER_RUN.map((pose) => drawSandpiper(pose, n)), seconds: 1 / 16, step: 1.5, sizes: SANDPIPER_SIZES, detail: '16 frames a second' });
add({ id: 'sandpiper:fly', label: 'Sandpiper · flight', group: 'Shore birds', frames: (_v, n) => SANDPIPER_FLY.map((pose) => drawSandpiper(pose, n)), seconds: 1 / 15, sizes: SANDPIPER_SIZES });
stills({ id: 'sandpiper:feed', label: 'Sandpiper · feeding', group: 'Shore birds', frames: (_v, n) => (['stand', 'peck', 'probe'] as SandpiperPose[]).map((pose) => drawSandpiper(pose, n)), sizes: SANDPIPER_SIZES });
const GULL_SIZES = [16, 10, 24];
add({ id: 'gull:flap', label: 'Gull · flying', group: 'Shore birds', frames: (_v, n) => (['flap-up', 'glide', 'flap-down', 'glide'] as GullPose[]).map((pose) => drawGull(pose, n)), seconds: 1 / 6, sizes: GULL_SIZES, detail: '6 frames a second' });
add({ id: 'gull:hover', label: 'Gull · hovering', group: 'Shore birds', frames: (_v, n) => (['hover-0', 'hover-1'] as GullPose[]).map((pose) => drawGull(pose, n)), seconds: 1 / 7, sizes: GULL_SIZES });
add({ id: 'gull:float', label: 'Gull · floating', group: 'Shore birds', frames: (_v, n) => (['float', 'float-dip'] as GullPose[]).map((pose) => drawGull(pose, n)), seconds: 0.6, sizes: GULL_SIZES });
add({ id: 'gull:ground', label: 'Gull · on the sand', group: 'Shore birds', frames: (_v, n) => (['stand', 'call', 'stand', 'stretch', 'tug-0', 'tug-1', 'tug-0', 'tug-1'] as GullPose[]).map((pose) => drawGull(pose, n)), seconds: 0.35, sizes: GULL_SIZES });
const EGRET_SIZES = [22, 14, 34];
add({ id: 'egret:walk', label: 'Egret · wading', group: 'Shore birds', frames: (_v, n) => (['step-0', 'stand', 'step-1', 'stand'] as EgretPose[]).map((pose) => drawEgret(pose, n)), seconds: 0.35, step: 1, sizes: EGRET_SIZES, detail: 'rate estimated' });
add({ id: 'egret:hunt', label: 'Egret · hunting', group: 'Shore birds', frames: (_v, n) => (['stand', 'crouch', 'crouch', 'strike', 'stand'] as EgretPose[]).map((pose) => drawEgret(pose, n)), seconds: 0.4, sizes: EGRET_SIZES });
add({ id: 'egret:fly', label: 'Egret · flight', group: 'Shore birds', frames: (_v, n) => (['fly-0', 'fly-1'] as EgretPose[]).map((pose) => drawEgret(pose, n)), seconds: 0.25, sizes: EGRET_SIZES });
const PELICAN_SIZES = [36, 16, 24, 48];
add({ id: 'pelican:flap', label: 'Pelican · flying', group: 'Shore birds', frames: (_v, n) => (['flap-up', 'flap-mid', 'flap-down', 'flap-mid', 'glide', 'glide'] as PelicanPose[]).map((pose) => drawPelican(pose, n)), seconds: 0.18, sizes: PELICAN_SIZES });
add({ id: 'pelican:fish', label: 'Pelican · diving and fishing', group: 'Shore birds', frames: (_v, n) => (['glide', 'dive', 'float', 'pouch-0', 'pouch-1', 'pouch-0', 'float'] as PelicanPose[]).map((pose) => drawPelican(pose, n)), seconds: 0.4, sizes: PELICAN_SIZES });
add({ id: 'frigatebird:flight', label: 'Frigatebird · flight', group: 'Shore birds', frames: (_v, n) => [0, 1].map((f) => drawFrigatebird(f, n)), seconds: 0.5, sizes: [16, 10, 24] });

// ---------------------------------------------------------------- The window's cat and dog

const CAT_GROUP = 'Window cat and dog';
const cat = (poses: readonly CatPose[]) => (v: string) => poses.map((pose) => drawCat(v as CatCoat, pose));
// `life/RooftopCat.ts`: a walk frame every 2.5 px at 22 px/s, a stalk frame every 2.8 px at 8 px/s.
add({ id: 'cat:walk', label: 'Cat · walk', group: CAT_GROUP, variants: CAT_COATS, frames: cat(CAT_WALK), seconds: 2.5 / 22, step: 2.5 });
add({ id: 'cat:stalk', label: 'Cat · stalk', group: CAT_GROUP, variants: CAT_COATS, frames: cat(CAT_STALK), seconds: 2.8 / 8, step: 2.8 });
add({ id: 'cat:groom', label: 'Cat · groom', group: CAT_GROUP, variants: CAT_COATS, frames: cat(CAT_GROOM), seconds: 0.24 });
add({ id: 'cat:sit', label: 'Cat · sitting', group: CAT_GROUP, variants: CAT_COATS, frames: cat(['sit', 'sit-breathe', 'sit', 'sit-blink', 'sit', 'sit-look', 'sit-look', 'sit-ear', 'sit', 'sit-swish-1', 'sit-swish-2', 'sit-swish-3', 'sit-swish-3', 'sit-swish-2', 'sit-swish-1']), seconds: 0.3, detail: 'breathe, blink, look, ear, tail swish' });
add({ id: 'cat:yawn', label: 'Cat · yawn and stretch', group: CAT_GROUP, variants: CAT_COATS, frames: cat(['sit', 'yawn-1', 'yawn-2', 'yawn-3', 'yawn-3', 'yawn-2', 'yawn-1', 'sit', 'stretch-1', 'stretch-2', 'stretch-3', 'stretch-3', 'stretch-2', 'stretch-1']), seconds: 0.3 });
add({ id: 'cat:rest', label: 'Cat · loaf and nap', group: CAT_GROUP, variants: CAT_COATS, frames: cat(['loaf', 'loaf', 'loaf-blink', 'loaf', 'nap-1', 'nap-2']), seconds: 0.8, detail: 'naps breathe every 1.6 s' });
add({ id: 'cat:pounce', label: 'Cat · pounce', group: CAT_GROUP, variants: CAT_COATS, frames: cat(['crouch-2', 'wiggle-1', 'wiggle-2', 'wiggle-1', 'wiggle-2', 'wiggle-1', 'wiggle-2', 'pounce-1', 'pounce-2', 'pounce-3', 'sit']), seconds: 0.11 });
add({ id: 'cat:chatter', label: 'Cat · chattering at a bird', group: CAT_GROUP, variants: CAT_COATS, frames: cat(['chatter-1', 'chatter-2']), seconds: 0.09 });

const DOG_LOOKS = DOG_BREEDS.flatMap((breed) => [0, 1, 2].map((coat) => `${breed} ${coat + 1}`));
const dogLook = (v: string): DogLook => {
  const [breed, coat] = v.split(' ');
  return { breed: breed as DogLook['breed'], coat: Number(coat) - 1, eyes: breed === 'husky' ? 'odd' : 'brown', collar: Number(coat) - 1 };
};
const dog = (poses: readonly WindowDogPose[]) => (v: string) => poses.map((pose) => drawWindowDog(dogLook(v), pose));
// `life/WindowDog.ts`: panting at 0.13 s a frame.
add({ id: 'dog:pant-side', label: 'Dog · panting, side on', group: CAT_GROUP, variants: DOG_LOOKS, frames: dog(DOG_PANT_SIDE), seconds: 0.13 });
add({ id: 'dog:pant-face', label: 'Dog · panting, facing in', group: CAT_GROUP, variants: DOG_LOOKS, frames: dog(DOG_PANT_FACE), seconds: 0.13 });
add({ id: 'dog:side', label: 'Dog · looking out', group: CAT_GROUP, variants: DOG_LOOKS, frames: dog(['side', 'side-breathe', 'side', 'side-blink', 'side', 'side-ear', 'side-sniff', 'side-sniff', 'side-lick', 'side']), seconds: 0.35 });
add({ id: 'dog:face', label: 'Dog · looking in', group: CAT_GROUP, variants: DOG_LOOKS, frames: dog(['face', 'face-blink', 'face', 'face-tilt', 'face-tilt-pant', 'face-tilt', 'face-lick', 'face']), seconds: 0.35 });
add({ id: 'dog:away', label: 'Dog · coming and going', group: CAT_GROUP, variants: DOG_LOOKS, frames: dog(['reach', 'away', 'away-breathe', 'away', 'away-ear', 'away']), seconds: 0.4 });
add({ id: 'dog:up', label: 'Dog · up at the glass, howling', group: CAT_GROUP, variants: DOG_LOOKS, frames: dog(['side', 'side-up', 'side-up-pant', 'side-up', 'howl', 'howl', 'side-up']), seconds: 0.4 });

// ---------------------------------------------------------------- Animals

const DEER_KINDS: readonly DeerKind[] = ['doe', 'buck', 'fawn', 'roe', 'elk'];
const deer = (poses: readonly DeerPose[]) => (v: string, n: number) => poses.map((pose) => drawDeerSized(v as DeerKind, pose, n));
add({ id: 'deer:walk', label: 'Deer · walk', group: 'Forest animals', variants: DEER_KINDS, frames: deer(DEER_WALK), seconds: 0.16, step: 1.6, sizes: [40, 16, 30, 48], detail: 'rate estimated' });
add({ id: 'deer:graze', label: 'Deer · grazing', group: 'Forest animals', variants: DEER_KINDS, frames: deer(['stand', 'graze-1', 'graze-2', 'graze-3', 'graze-2', 'graze-3', 'graze-2', 'graze-1', 'stand']), seconds: 0.35, sizes: [40, 16, 30, 48] });
add({ id: 'deer:alert', label: 'Deer · alert', group: 'Forest animals', variants: DEER_KINDS, frames: deer(['stand', 'stand-flick', 'stand', 'alert', 'alert', 'stand']), seconds: 0.4, sizes: [40, 16, 30, 48] });
add({ id: 'deer:bound', label: 'Deer · bounding away', group: 'Forest animals', variants: DEER_KINDS, frames: deer(['bound-1', 'bound-2']), seconds: 0.16, step: 6, sizes: [40, 16, 30, 48], detail: 'rate estimated' });

const SQUIRRELS: readonly SquirrelCoat[] = ['red', 'grey'];
const squirrel = (poses: readonly SquirrelPose[]) => (v: string, n: number) => poses.map((pose) => drawSquirrelSized(v as SquirrelCoat, pose, n));
// `life/SillSquirrel.ts`: a run frame every 4 px.
add({ id: 'squirrel:run', label: 'Squirrel · run', group: 'Forest animals', variants: SQUIRRELS, frames: squirrel(SQUIRREL_RUN), seconds: 0.07, step: 4, sizes: [22, 8, 13] });
add({ id: 'squirrel:climb', label: 'Squirrel · climb', group: 'Forest animals', variants: SQUIRRELS, frames: squirrel(SQUIRREL_CLIMB), seconds: 0.08, sizes: [22, 8, 13] });
add({ id: 'squirrel:sit', label: 'Squirrel · sit, nibble, cling', group: 'Forest animals', variants: SQUIRRELS, frames: squirrel(['sit', 'nibble', 'sit', 'nibble', 'cling', 'cling-flick', 'cling']), seconds: 0.3, sizes: [22, 8, 13] });

const fox = (poses: readonly FoxPose[]) => (_v: string, n: number) => poses.map((pose) => drawFox(pose, n));
// `life/common/Fox.ts`: a trot frame every 3 px.
add({ id: 'fox:trot', label: 'Fox · trot', group: 'Forest animals', frames: fox(FOX_TROT), seconds: 0.12, step: 3, sizes: [26, 12, 20, 36] });
add({ id: 'fox:run', label: 'Fox · run', group: 'Forest animals', frames: fox(['run-1', 'run-2']), seconds: 0.09, step: 5, sizes: [26, 12, 20, 36], detail: 'rate estimated' });
add({ id: 'fox:hunt', label: 'Fox · hunting', group: 'Forest animals', frames: fox(['sniff', 'sniff', 'sit', 'sit', 'crouch', 'crouch', 'pounce', 'crouch']), seconds: 0.35, sizes: [26, 12, 20, 36] });
// `life/forest/BigWildlife.ts`: a step every 2 px; `NightCalls.ts`: the wolf every 2.2 px.
add({ id: 'bear:walk', label: 'Bear · walk', group: 'Forest animals', frames: (_v, n) => BEAR_WALK.map((pose) => drawBear(pose, n)), seconds: 0.2, step: 2, sizes: [32, 12, 18] });
add({ id: 'bear:sniff', label: 'Bear · sniffing', group: 'Forest animals', frames: (_v, n) => (['sniff', 'sniff', 'sniff-air', 'sniff'] as BearPose[]).map((pose) => drawBear(pose, n)), seconds: 0.6, sizes: [32, 12, 18] });
add({ id: 'wolf:walk', label: 'Wolf · walk', group: 'Forest animals', frames: (_v, n) => WOLF_WALK.map((pose) => drawWolf(pose, n)), seconds: 0.14, step: 2.2, sizes: [30, 12, 18] });
add({ id: 'wolf:howl', label: 'Wolf · sit and howl', group: 'Forest animals', frames: (_v, n) => (['sit', 'sit', 'howl', 'howl', 'howl', 'sit'] as WolfPose[]).map((pose) => drawWolf(pose, n)), seconds: 0.5, sizes: [30, 12, 18] });
add({ id: 'hedgehog:shuffle', label: 'Hedgehog · shuffle and curl', group: 'Forest animals', frames: (_v, n) => [...Array.from({ length: HEDGEHOG_SHUFFLE }, (_, f) => drawHedgehog(f, n)), ...Array.from({ length: HEDGEHOG_SHUFFLE }, (_, f) => drawHedgehog(f, n)), drawHedgehog(0, n, true), drawHedgehog(0, n, true)], seconds: 0.16, sizes: [18, 10, 24] });
add({
  id: 'butterfly:flight',
  label: 'Butterflies · flight',
  group: 'Forest animals',
  variants: ['monarch', 'white', 'blue', 'brimstone'],
  frames: (v, n) => BUTTERFLY_FLIGHT.map((f) => drawButterfly(v as ButterflyKind, f, n)),
  seconds: 1 / 12,
  sizes: [9, 4, 6, 12],
});
stills({ id: 'mushrooms', label: 'Mushrooms', group: 'Forest animals', variants: ['fly-agaric', 'bolete', 'cluster'], frames: (v) => [3, 5, 8, 12].map((n) => drawMushroom(v as MushroomKind, n)), detail: 'each size' });

const COATS: readonly CowCoat[] = ['holstein', 'jersey', 'brown'];
const cow = (poses: readonly CowPose[]) => (v: string, n: number) => poses.map((pose) => drawCowSized(v as CowCoat, pose, n));
add({ id: 'cow:walk', label: 'Cow · walk', group: 'Meadow animals', variants: COATS, frames: cow(COW_WALK), seconds: 0.22, step: 4.8, sizes: [40, 14, 24, 58], detail: 'a step every 0.12 of its height' });
add({ id: 'cow:graze', label: 'Cow · grazing, lying', group: 'Meadow animals', variants: COATS, frames: cow(['stand', 'graze-1', 'graze-2', 'graze-1', 'graze-2', 'stand', 'lie']), seconds: 0.5, sizes: [40, 14, 24, 58] });
// `life/meadow/Pastoral.ts`: sheep a step every 2.5 px, the horse every 2.5 px walking.
add({ id: 'sheep:walk', label: 'Sheep · walk', group: 'Meadow animals', frames: (_v, n) => SHEEP_WALK.map((pose) => drawSheepSized(pose, n)), seconds: 0.2, step: 2.5, sizes: [26, 8, 16] });
add({ id: 'sheep:graze', label: 'Sheep · grazing, lying', group: 'Meadow animals', frames: (_v, n) => (['stand', 'graze-1', 'graze-2', 'graze-1', 'graze-2', 'stand', 'lie'] as SheepPose[]).map((pose) => drawSheepSized(pose, n)), seconds: 0.5, sizes: [26, 8, 16] });
add({ id: 'horse:walk', label: 'Horse · walk', group: 'Meadow animals', frames: (_v, n) => HORSE_WALK.map((pose) => drawHorseSized(pose, n)), seconds: 0.2, step: 2.5, sizes: [40, 14, 24] });
add({ id: 'horse:graze', label: 'Horse · grazing, tail swish', group: 'Meadow animals', frames: (_v, n) => (['stand', 'graze-1', 'graze-2', 'graze-1', 'stand', 'swish', 'stand', 'swish'] as HorsePose[]).map((pose) => drawHorseSized(pose, n)), seconds: 0.45, sizes: [40, 14, 24] });
const sheepdog = (poses: readonly DogPose[]) => (_v: string, n: number) => poses.map((pose) => drawDogSized(pose, n));
add({ id: 'sheepdog:run', label: 'Sheepdog · run', group: 'Meadow animals', frames: sheepdog(['run-1', 'run-2']), seconds: 0.1, step: 4, sizes: [18, 8, 24], detail: 'rate estimated' });
add({ id: 'sheepdog:trot', label: 'Sheepdog · trot', group: 'Meadow animals', frames: sheepdog(['trot-1', 'trot-2']), seconds: 0.16, step: 2.5, sizes: [18, 8, 24], detail: 'rate estimated' });
stills({ id: 'sheepdog:rest', label: 'Sheepdog · crouch, sit, lie', group: 'Meadow animals', frames: sheepdog(['crouch', 'sit', 'lie']), sizes: [18, 8, 24] });
const HENS: readonly ChickenCoat[] = ['white', 'brown', 'black'];
const hen = (poses: readonly ChickenPose[]) => (v: string, n: number) => poses.map((pose) => drawChickenSized(v as ChickenCoat, pose, n));
add({ id: 'hen:walk', label: 'Hen · walk', group: 'Meadow animals', variants: HENS, frames: hen(['walk', 'walk-2']), seconds: 0.18, step: 1.5, sizes: [20, 8, 14], detail: 'rate estimated' });
add({ id: 'hen:peck', label: 'Hen · peck, scratch, flap', group: 'Meadow animals', variants: HENS, frames: hen(['stand', 'peck', 'stand', 'peck', 'scratch', 'stand', 'flap', 'stand']), seconds: 0.25, sizes: [20, 8, 14] });
// `life/meadow/Wild.ts`: a hop frame every 3 px.
add({ id: 'rabbit:hop', label: 'Rabbit and hare · hop', group: 'Meadow animals', variants: ['rabbit', 'hare'], frames: (v, n) => RABBIT_HOP.map((pose) => drawRabbitSized(pose, n, v as 'rabbit' | 'hare')), seconds: 0.11, step: 3, sizes: [16, 10, 20] });
add({ id: 'rabbit:sit', label: 'Rabbit and hare · sit, groom, peek', group: 'Meadow animals', variants: ['rabbit', 'hare'], frames: (v, n) => (['sit', 'alert', 'sit', 'groom', 'groom', 'sit', 'peek'] as RabbitPose[]).map((pose) => drawRabbitSized(pose, n, v as 'rabbit' | 'hare')), seconds: 0.4, sizes: [16, 10, 20] });
add({ id: 'fish:swim', label: 'Creek fish · swimming', group: 'Meadow animals', variants: ['trout', 'minnow'], frames: (v) => [0, 1].map((f) => drawTopFishSized(v as FishKind, 4, f as 0 | 1)), seconds: 0.2 });
add({ id: 'fish:turn', label: 'Creek fish · turning', group: 'Meadow animals', variants: ['trout', 'minnow'], frames: (v) => Array.from({ length: TOP_FISH_HEADINGS }, (_, h) => drawTopFishSized(v as FishKind, h, (h % 2) as 0 | 1)), seconds: 0.12, detail: 'all 16 headings' });
add({ id: 'fish:shadow', label: 'Creek fish · shadow', group: 'Meadow animals', variants: ['trout', 'minnow'], frames: (v) => [0, 1].map((f) => drawTopFishSized(v as FishKind, 4, f as 0 | 1, true)), seconds: 0.2 });
add({ id: 'scarecrow', label: 'Scarecrow · in the wind', group: 'Meadow animals', frames: (_v, n) => [0, 1, 2, 1].map((f) => drawScarecrow(n, f)), seconds: 0.5, sizes: [30, 14, 20, 44] });

add({ id: 'crab:scuttle', label: 'Crab · scuttle and hide', group: 'Shore creatures', frames: (_v, n) => [0, 1, 2, 3, 0, 1, 2, 3].map((f) => drawCrab(f, n)).concat([drawCrab(0, n, true), drawCrab(0, n, true)]), seconds: 0.1, step: 1, sizes: [12, 6, 9, 16, 22] });
add({ id: 'hermit:walk', label: 'Hermit crab · walk and withdraw', group: 'Shore creatures', frames: (_v, n) => [0, 1, 0, 1, 0, 1].map((f) => drawHermitCrab(f, n)).concat([drawHermitCrab(0, n, true), drawHermitCrab(0, n, true)]), seconds: 0.25, sizes: [12, 6, 9, 16] });
add({ id: 'jellyfish', label: 'Jellyfish · pulse', group: 'Shore creatures', frames: (_v, n) => Array.from({ length: JELLY_FRAMES }, (_, f) => drawJellyfish(f, n)), seconds: 0.3, sizes: [9, 4, 6, 14], detail: 'the shore plays frames 0–2 of these 4' });
add({ id: 'hatchling', label: 'Turtle hatchling · crawl', group: 'Shore creatures', frames: (_v, n) => Array.from({ length: HATCHLING_FRAMES }, (_, f) => drawHatchling(f, n)), seconds: 0.2, sizes: [8, 4, 6, 11], detail: 'the shore plays 2 of these 4' });
add({ id: 'turtle:crawl', label: 'Sea turtle · crawl', group: 'Shore creatures', frames: (_v, n) => ([0, 1, 2, 1] as const).map((f) => drawTurtleSized(f, n)), seconds: 0.3, sizes: [40, 12, 20, 54] });
// `life/beach/Shoreline.ts` BREACH_FRAME.
add({ id: 'dolphin:breach', label: 'Dolphin · breach', group: 'Shore creatures', frames: (_v, n) => Array.from({ length: DOLPHIN_FRAMES }, (_, f) => drawDolphinSized(f, n)), seconds: 0.17, sizes: [16, 28] });
add({ id: 'jumpfish', label: 'Fish · jumping', group: 'Shore creatures', frames: (_v, n) => Array.from({ length: JUMP_FRAMES }, (_, f) => drawJumpFish(f, n)), seconds: 0.1, sizes: [8, 5] });

// ---------------------------------------------------------------- People

const LOOKS = Array.from({ length: 6 }, (_, i) => `look ${i + 1}`);
const lookOf = (v: string) => randomLook(createRng((Number(v.split(' ')[1] || 1) - 1) * 7919 + 101));
const person = (facing: PersonFacing, pose: PersonPose, frames: readonly number[], umbrella = false) => (v: string, n: number) => frames.map((f) => drawPerson(lookOf(v), facing, pose, f, umbrella, n));
const PEOPLE_SIZES = [30, 10, 16, 40];
// `life/StreetLife.ts`: walking frames by distance walked (estimated here); waving and clapping at 220 ms.
for (const facing of ['side', 'front', 'back'] as const) {
  add({ id: `person:walk-${facing}`, label: `Person · walk, ${facing === 'side' ? 'side on' : facing === 'front' ? 'towards' : 'away'}`, group: 'People', variants: LOOKS, frames: person(facing, 'walk', [0, 1, 2, 3]), seconds: 0.16, step: facing === 'side' ? 2 : undefined, sizes: PEOPLE_SIZES, detail: 'rate estimated' });
}
add({ id: 'person:umbrella', label: 'Person · walk with umbrella', group: 'People', variants: LOOKS, frames: person('side', 'walk', [0, 1, 2, 3], true), seconds: 0.16, step: 2, sizes: PEOPLE_SIZES, detail: 'rate estimated' });
add({ id: 'person:wave', label: 'Person · wave', group: 'People', variants: LOOKS, frames: person('front', 'wave', [0, 1]), seconds: 0.22, sizes: PEOPLE_SIZES });
add({ id: 'person:clap', label: 'Person · clap', group: 'People', variants: LOOKS, frames: person('front', 'clap', [0, 1]), seconds: 0.22, sizes: PEOPLE_SIZES });
stills({
  id: 'person:moments',
  label: 'Person · stand, browse, look up, hail, crouch',
  group: 'People',
  variants: LOOKS,
  frames: (v, n) => (['stand', 'browse', 'look-up', 'hail', 'crouch'] as PersonPose[]).flatMap((pose) => (['front', 'side', 'back'] as const).map((facing) => drawPerson(lookOf(v), facing, pose, 0, false, n))),
  sizes: PEOPLE_SIZES,
});
add({ id: 'busker', label: 'Busker · playing', group: 'People', variants: LOOKS, frames: (v, n) => [0, 1].map((f) => drawBusker(lookOf(v), f, n)), seconds: 1 / 4, sizes: [30, 16, 40], detail: '4 frames a second' });

// ---------------------------------------------------------------- Vehicles and machines

const RIDERS = (['bike', 'scooter'] as const).flatMap((kind) => (['front', 'back'] as const).map((facing) => `${kind} ${facing}`));
const riderLook = randomRiderLook(createRng(7));
add({ id: 'rider', label: 'Bike and scooter riders', group: 'Vehicles and machines', variants: RIDERS, frames: (v, n) => [0, 1].map((f) => { const [kind, facing] = v.split(' '); return drawRider(kind as RiderKind, riderLook, facing as VehicleFacing, f, n); }), seconds: 0.18, sizes: [26, 8, 18, 34] });
add({ id: 'sweeper', label: 'Street sweeper', group: 'Vehicles and machines', variants: ['front', 'back'], frames: (v, n) => Array.from({ length: SWEEPER_BRUSH }, (_, f) => drawSweeper(v as VehicleFacing, f, n)), seconds: 0.1, sizes: [24, 10, 34] });
add({ id: 'pushcart', label: 'Pushcart', group: 'Vehicles and machines', variants: ['front', 'back'], frames: (v, n) => [0, 1].map((f) => drawPushcart(v as VehicleFacing, f, n)), seconds: 0.25, sizes: [24, 10, 32] });
stills({ id: 'taxi', label: 'Taxi', group: 'Vehicles and machines', frames: (_v, n) => (['front', 'back'] as const).map((facing) => drawTaxi(facing, n)), sizes: [18, 8, 26] });
stills({ id: 'blimp', label: 'Blimp', group: 'Vehicles and machines', frames: () => [drawBlimp()] });
add({ id: 'helicopter', label: 'Helicopter', group: 'Vehicles and machines', frames: () => [0, 1].map((f) => drawHelicopter(f)), seconds: 1 / 18, detail: '18 frames a second' });
add({ id: 'paddrone', label: 'Pad drone', group: 'Vehicles and machines', frames: (_v, n) => [0, 1, 2].map((f) => drawPadDrone(n, f)), seconds: 0.06, sizes: [12, 8, 16] });
add({ id: 'sailboat', label: 'Sailboat · heeling', group: 'Vehicles and machines', frames: (_v, n) => [0, 1, 2, 1].map((f) => drawSailboat(f, n)), seconds: 0.8, sizes: [9, 6, 13] });
add({ id: 'trawler', label: 'Fishing boat · rocking', group: 'Vehicles and machines', frames: (_v, n) => [0, 1].map((f) => drawFishingBoat(f, n)), seconds: 0.7, sizes: [20, 14] });

// ---------------------------------------------------------------- City

const STALLS: readonly StallKind[] = ['produce', 'tea', 'flowers', 'noodles', 'tech', 'skewers'];
stills({
  id: 'stalls',
  label: 'Market stalls · setting up, lit',
  group: 'City',
  variants: STALLS,
  frames: (v, n) => {
    const kind = v as StallKind;
    const out: Frame[] = Array.from({ length: STALL_STAGES }, (_, stage) => drawStallSized(kind, stage, n));
    const lights = drawStallLightsSized(kind, n);
    if (lights) out.push({ grid: lights, colors: STALL_LIGHT_PALETTE });
    return out;
  },
  sizes: [30, 10, 18, 38],
});
const AD_SIZES: Record<AdId, [number, number]> = {
  neurocola: [72, 31],
  kaiju: [64, 28],
  dreamdive: [56, 24],
  askkai: [68, 90],
  soulsync: [60, 26],
  nanocare: [56, 22],
  ramen: [40, 18],
  curfew: [76, 7],
};
for (const id of Object.keys(AD_SIZES) as AdId[]) {
  const [w, h] = AD_SIZES[id];
  add({ id: `ad:${id}`, label: `Sign · ${id}`, group: 'City', frames: () => Array.from({ length: ADS[id].frames }, (_, f) => ({ buffer: drawAd(id, f, w, h) })), seconds: (f) => ADS[id].frameSeconds(f), detail: `${ADS[id].frames} frames, timed as on the street` });
}
add({ id: 'hologram:koi', label: 'Hologram · koi', group: 'City', frames: () => [0, 1, 2, 3].map((f) => ({ buffer: koiArt(f) })), seconds: 1 / 3 });
add({ id: 'hologram:idol', label: 'Hologram · idol', group: 'City', frames: () => [0, 1].map((f) => ({ buffer: idolArt(f) })), seconds: 1 / 0.9 });

stills({
  id: 'transit:vehicles',
  label: 'Distant highway · cars, vans, lorries',
  group: 'City',
  frames: () => (['car', 'van', 'truck'] as const).flatMap((kind) => [0xdedcd4, 0x9a3a36, 0x3c5a88].map((color) => ({ buffer: drawVehicle(kind, color).body }))),
  detail: 'far off; lights shown at night',
});
stills({
  id: 'transit:freight',
  label: 'Freight train · locomotive and wagons',
  group: 'City',
  frames: () => [{ buffer: drawLoco().body }, ...(['container', 'tank', 'hopper', 'flat'] as const).map((kind) => ({ buffer: drawWagon(kind, kind === 'container' ? 0xa0442e : kind === 'tank' ? 0x2e2e32 : 0x6a5a46) }))],
});

// ---------------------------------------------------------------- Window and room

/** The sill plant: the pot and its three clumps of stems, each rustling (the sway itself is a mesh bend in the app). */
function plantFrames(k: number): Frame[] {
  const size = plantSize(k);
  const pot = drawPot(size);
  const leafSet = new Set(LEAF_COLORS);
  const clumps = CLUMPS.map((clump, i) => rustleFrames(drawLeaves(size, clump), 3, 60 + i, (c) => leafSet.has(c)));
  const leaves = clumps[0][0];
  const rimDrop = Math.max(3, Math.round(size.potHeight * 0.12));
  const width = Math.max(leaves.width, pot.width);
  const top = leaves.height - rimDrop;
  return [0, 1, 2].map((f) => {
    const out = new PixelBuffer(width, top + pot.height);
    for (const frames of [...clumps].reverse()) out.draw(frames[f], Math.round((width - leaves.width) / 2), 0);
    out.draw(pot, Math.round((width - pot.width) / 2), top);
    return { buffer: out };
  });
}
add({ id: 'window:plant', label: 'Sill plant · rustle', group: 'Window and room', frames: (_v, k) => plantFrames(k), seconds: 1 / 3, sizes: [1, 1.5, 2], sizeUnit: 'scale', detail: 'the sway is a mesh bend, not shown' });
stills({ id: 'window:bowl', label: 'Seed bowl · empty to full', group: 'Window and room', frames: (_v, k) => ([0, 1, 2, 3] as BirdseedStage[]).map((stage) => ({ buffer: drawDish(dishGeometry(dishSize(k)), stage) })), sizes: [1, 1.5, 2], sizeUnit: 'scale' });
stills({
  id: 'window:tablet',
  label: 'Tablet · through the day',
  group: 'Window and room',
  frames: (_v, k) => {
    const { width: W, height: H } = tabletSize(k);
    return [7, 12, 18.5, 23].map((hours, i) => {
      const body = drawBody(W, H);
      const screen = drawHomeScreen(W - 8, H - 7, { hours, weather: ['clear', 'overcast', 'clear', 'light-rain'][i], nightness: hours > 20 ? 1 : 0 });
      body.draw(screen, 6, 3);
      return { buffer: body };
    });
  },
  sizes: [1, 1.5, 2],
  sizeUnit: 'scale',
});

// ---------------------------------------------------------------- Scenery

const SEEDS = ['seed 1', 'seed 2', 'seed 3'];
const seedOf = (v: string) => Number(v.split(' ')[1] || 1) * 101;
/** A tree's leaves stirring, as the scenes rustle them. */
function rustlingTree(buffer: PixelBuffer, leaves: readonly number[], seed: number): Frame[] {
  const set = new Set(leaves);
  return rustleFrames(buffer, 4, seed, (c) => set.has(c)).map((b) => ({ buffer: b }));
}
add({ id: 'tree:conifer', label: 'Conifer · rustle', group: 'Scenery', variants: SEEDS, frames: (v, n) => rustlingTree(drawConifer(n, seedOf(v)).buffer, leafColors(CONIFER), seedOf(v)), seconds: 0.25, sizes: [40, 16, 24, 64] });
add({ id: 'tree:pine', label: 'Tall pine · rustle', group: 'Scenery', variants: SEEDS, frames: (v, n) => rustlingTree(drawTallPine(n, seedOf(v)).buffer, leafColors(CONIFER), seedOf(v)), seconds: 0.25, sizes: [56, 24, 80] });
add({ id: 'tree:broadleaf', label: 'Broadleaf · rustle', group: 'Scenery', variants: SEEDS, frames: (v, n) => rustlingTree(drawBroadleaf(n, seedOf(v)).buffer, leafColors(BROADLEAF), seedOf(v)), seconds: 0.25, sizes: [40, 16, 24, 64] });
add({ id: 'tree:oak', label: 'Oak · rustle', group: 'Scenery', variants: SEEDS, frames: (v, n) => rustlingTree(drawOak(n, seedOf(v)).buffer, leafColors(BROADLEAF), seedOf(v)), seconds: 0.25, sizes: [56, 30, 80] });
stills({ id: 'tree:palm', label: 'Palms', group: 'Scenery', variants: SEEDS, frames: (v, n) => [-0.3, 0, 0.3].map((lean) => ({ buffer: flattenPalm(drawPalm(n, lean, seedOf(v))) })), sizes: [60, 30, 90], detail: 'leaning left, upright, right' });
stills({ id: 'tree:birch', label: 'Birch and snag', group: 'Scenery', variants: SEEDS, frames: (v, n) => [{ buffer: drawBirch(n, seedOf(v), BROADLEAF, 0, 0).buffer }, { buffer: drawSnag(n, seedOf(v), 0, 0).buffer }], sizes: [48, 24, 72] });
stills({ id: 'flora:shrubs', label: 'Holly and bramble', group: 'Scenery', variants: SEEDS, frames: (v) => (['holly', 'bramble'] as const).flatMap((kind) => [5, 10].map((month) => ({ buffer: drawShrub(kind, 30, 18, seedOf(v), 0, 0, month) }))), detail: 'spring and autumn' });
stills({ id: 'flora:foxglove', label: 'Foxgloves', group: 'Scenery', variants: SEEDS, frames: (v) => [1, 1.5, 2].map((scale) => ({ buffer: drawFoxglove(scale, seedOf(v)) })) });
stills({ id: 'flora:rocks', label: 'Rocks and moss', group: 'Scenery', variants: SEEDS, frames: (v) => [{ buffer: drawRock(24, 14, seedOf(v), 0, 0) }, { buffer: drawRock(12, 8, seedOf(v), 0, 0) }, { buffer: drawMossStrand(18, seedOf(v), 0, 0) }] });
stills({ id: 'web', label: 'Spider web', group: 'Scenery', variants: SEEDS, frames: (v) => [8, 12, 16].map((r) => ({ buffer: drawWeb(r, seedOf(v)).buffer })) });
stills({ id: 'coconut', label: 'Coconuts', group: 'Scenery', frames: () => [2, 3, 4, 5].map((n) => ({ buffer: drawCoconut(n) })) });
// The meadow's wind pump turns through six drawings of its rotor.
add({ id: 'windmill', label: 'Wind pump rotor', group: 'Scenery', frames: (_v, r) => Array.from({ length: 6 }, (_, f) => ({ buffer: drawRotor(r, f, 6) })), seconds: 0.12, sizes: [10, 6, 16] });

export const SPRITES: readonly SpriteEntry[] = entries;

/** Frame `index`'s seconds. */
export function frameSeconds(entry: SpriteEntry, index: number): number {
  return typeof entry.seconds === 'number' ? entry.seconds : entry.seconds(index);
}
