import type { Drawn } from '../sprites/kit';
import { drawBusker, drawPerson, randomLook, type PersonFacing, type PersonPose } from '../sprites/people';
import type { PixelGrid } from '../sprites/raster';
import { drawBird, drawBirdAt, SPECIES, type BirdPose, type SpeciesId } from '../sprites/birdSprites';
import { CLOSE_SPECIES, drawBirdClose } from '../sprites/birdClose';
import { drawOwl, drawOwlInHollow, type HollowFace } from '../sprites/owlSprites';
import { CAT_COATS, CAT_POSES, drawCat } from '../sprites/catSprites';
import { DOG_BREEDS, DOG_POSES, drawWindowDog, type DogLook } from '../sprites/dogSprites';
import { DOLPHIN_FRAMES, drawCrab, drawDolphinSized, drawHatchling, drawHermitCrab, drawJellyfish, drawPelican, drawTurtleSized, type PelicanPose } from '../sprites/beachSprites';
import { drawEgret, drawFishingBoat, drawFrigatebird, drawGull, drawJumpFish, drawNightjar, drawSailboat, drawSandpiper, NIGHTJAR_FRAMES, JUMP_FRAMES, SANDPIPER_FLY, SANDPIPER_RUN, type EgretPose, type GullPose, type SandpiperPose } from '../sprites/shoreSprites';
import { drawDeerSized, drawSquirrelSized, type DeerKind, type DeerPose, type SquirrelPose } from '../sprites/forestSprites';
import { drawChickenSized, drawCowSized, drawDogSized, drawHorseSized, drawRabbitSized, drawSheepSized, drawTopFishSized, type ChickenCoat, type CowCoat, type CowPose, type DogPose, type HorsePose, type RabbitPose, type SheepPose } from '../sprites/meadowSprites';
import { drawBat, drawBear, drawEagleSoar, EAGLE_STOOP, drawButterfly, drawFox, drawHedgehog, drawMushroom, drawWoodpeckerCling, type BearPose, type ButterflyKind, type FoxPose, type MushroomKind, drawWolf, type WolfPose } from '../sprites/wildSprites';
import { drawPushcart, drawRider, drawSweeper, drawTaxi, randomRiderLook } from '../sprites/vehicleSprites';
import { ADS, drawAd, type AdId } from '../scene/city/ads';
import type { PixelBuffer } from '../core/pixelBuffer';
import { drawStallLightsSized, drawStallSized, STALL_LIGHT_PALETTE, type StallKind } from '../sprites/streetSprites';
import { createRng } from '../core/random';

/**
 * A dev page (open the app with `#gallery`) that lays out every procedural
 * sprite at the sizes and poses it's drawn in, magnified, on light and dark
 * grounds, for reviewing the pixel art side by side.
 */

interface Item {
  label: string;
  draw: () => Drawn | { grid: PixelGrid; colors: readonly number[] } | { buffer: PixelBuffer };
}

interface Section {
  title: string;
  rows: Item[][];
}

function sections(): Section[] {
  const out: Section[] = [];
  // City ads, every frame, at the sizes their screens are.
  const adSizes: Record<AdId, Array<[number, number]>> = {
    neurocola: [[72, 31], [40, 16]],
    kaiju: [[64, 28], [40, 17]],
    dreamdive: [[56, 24], [34, 15]],
    askkai: [[68, 90], [56, 24]],
    soulsync: [[60, 26], [40, 17]],
    nanocare: [[56, 22], [34, 15]],
    ramen: [[40, 18], [26, 40]],
    curfew: [[76, 7]],
  };
  const ads: Item[][] = [];
  for (const id of Object.keys(adSizes) as AdId[]) {
    for (const [w, h] of adSizes[id]) {
      const frames = Math.min(ADS[id].frames, 6);
      ads.push(Array.from({ length: frames }, (_, f) => ({ label: `${id} ${w}x${h} ${f}`, draw: () => ({ buffer: drawAd(id, id === 'curfew' ? f * 12 : f, w, h, f === 0 ? 'dead-column' : null) }) })));
    }
  }
  out.push({ title: 'City ads', rows: ads });
  // People: one look per row at every size, then poses at a near size.
  const people: Item[][] = [];
  const looks = Array.from({ length: 6 }, (_, i) => randomLook(createRng(i * 7919 + 101)));
  for (const look of looks.slice(0, 3)) {
    people.push([4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40].map((h) => ({ label: `${h}`, draw: () => drawPerson(look, 'front', 'walk', 0, false, h) })));
  }
  const poses: Array<[PersonFacing, PersonPose, number, boolean]> = [];
  for (const facing of ['front', 'back', 'side'] as const) for (let f = 0; f < 4; f++) poses.push([facing, 'walk', f, false]);
  for (const facing of ['front', 'back', 'side'] as const) poses.push([facing, 'stand', 0, false], [facing, 'browse', 0, false], [facing, 'walk', 0, true]);
  for (const look of looks) {
    for (const h of [30, 16]) people.push(poses.map(([facing, pose, f, umbrella]) => ({ label: `${facing[0]}${pose[0]}${f}${umbrella ? 'u' : ''}`, draw: () => drawPerson(look, facing, pose, f, umbrella, h) })));
  }
  out.push({ title: 'People', rows: people });
  // Small moments: looking up, waving, hailing, crouching, clapping.
  const moments: Array<[PersonFacing, PersonPose, number]> = [];
  for (const facing of ['front', 'back', 'side'] as const) {
    moments.push([facing, 'look-up', 0], [facing, 'wave', 0], [facing, 'wave', 1], [facing, 'hail', 0], [facing, 'crouch', 0], [facing, 'clap', 0], [facing, 'clap', 1]);
  }
  out.push({
    title: 'People moments',
    rows: looks.slice(0, 4).flatMap((look) => [30, 14].map((h) => moments.map(([facing, pose, f]) => ({ label: `${facing[0]} ${pose}${f}`, draw: () => drawPerson(look, facing, pose, f, false, h) })))),
  });

  const stalls: Item[][] = [];
  for (const kind of ['produce', 'tea', 'flowers', 'noodles', 'tech', 'skewers'] as StallKind[]) {
    const row: Item[] = [6, 10, 14, 18, 24, 30, 38].map((h) => ({ label: `${kind} ${h}`, draw: () => drawStallSized(kind, 3, h) }));
    for (let stage = 0; stage < 3; stage++) row.push({ label: `stage ${stage}`, draw: () => drawStallSized(kind, stage, 30) });
    const lights = drawStallLightsSized(kind, 38);
    if (lights) row.push({ label: 'lights', draw: () => ({ grid: lights, colors: STALL_LIGHT_PALETTE }) });
    stalls.push(row);
  }
  out.push({ title: 'Stalls', rows: stalls });

  const riders = [0, 1, 2].map((i) => randomRiderLook(createRng(i * 31 + 7)));
  const vehicles: Item[][] = [];
  for (const kind of ['bike', 'scooter'] as const) {
    const row: Item[] = [];
    for (const h of [8, 12, 18, 26, 34]) for (const facing of ['front', 'back'] as const) row.push({ label: `${kind[0]}${facing[0]}${h}`, draw: () => drawRider(kind, riders[h % 3], facing, 0, h) });
    row.push({ label: 'pedal', draw: () => drawRider(kind, riders[0], 'back', 1, 34) });
    vehicles.push(row);
  }
  vehicles.push(
    [10, 16, 24, 34].flatMap((h) => (['front', 'back'] as const).map((facing) => ({ label: `sweep ${facing[0]}${h}`, draw: () => drawSweeper(facing, h % 2, h) }))),
    [8, 12, 18, 26].flatMap((h) => (['front', 'back'] as const).map((facing) => ({ label: `taxi ${facing[0]}${h}`, draw: () => drawTaxi(facing, h) }))),
    [10, 16, 24, 32].flatMap((h) => (['front', 'back'] as const).map((facing) => ({ label: `cart ${facing[0]}${h}`, draw: () => drawPushcart(facing, 0, h) }))),
  );
  vehicles.push([10, 16, 22, 30, 40].flatMap((h) => [0, 1].map((f) => ({ label: `busker ${h}/${f}`, draw: () => drawBusker(looks[2], f, h) }))));
  out.push({ title: 'Vehicles', rows: vehicles });

  const foxPoses: FoxPose[] = ['trot-1', 'trot-2', 'trot-3', 'trot-4', 'sniff', 'sit', 'crouch', 'pounce', 'run-1', 'run-2'];
  out.push({
    title: 'Wild',
    rows: [
      [8, 12, 16, 20, 28, 36].map((h) => ({ label: `fox ${h}`, draw: () => drawFox('trot-1', h) })),
      foxPoses.map((pose) => ({ label: pose, draw: () => drawFox(pose, 26) })),
      [10, 14, 20].flatMap((h) => (['sit', 'alert', 'hop-1', 'hop-2'] as const).map((pose) => ({ label: `hare ${pose} ${h}`, draw: () => drawRabbitSized(pose, h, 'hare') }))),
      [6, 8, 12, 16, 24].flatMap((n) => [0, 1, 2, 3].map((f) => ({ label: `bat ${n}/${f}`, draw: () => drawBat(f, n) }))),
      [8, 12, 18].flatMap((h) => (['walk-1', 'walk-4', 'sniff'] as BearPose[]).map((pose) => ({ label: `bear ${pose} ${h}`, draw: () => drawBear(pose, h) }))),
      (['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'sniff', 'sniff-air'] as BearPose[]).map((pose) => ({ label: `bear ${pose}`, draw: () => drawBear(pose, 32) })),
      [8, 12, 18, 30].flatMap((h) => (['walk-1', 'walk-2', 'walk-3', 'walk-4', 'sit', 'howl'] as WolfPose[]).map((pose) => ({ label: `wolf ${pose} ${h}`, draw: () => drawWolf(pose, h) }))),
      [6, 8, 12, 16, 24].flatMap((n) => [0, 1, 2, 3].map((f) => ({ label: `wp ${n}/${f}`, draw: () => drawWoodpeckerCling(f, n) }))),
      (['fly-agaric', 'bolete', 'cluster'] as MushroomKind[]).flatMap((kind) => [3, 5, 8, 12].map((n) => ({ label: `${kind} ${n}`, draw: () => drawMushroom(kind, n) }))),
    ],
  });

  out.push({
    title: 'Butterflies',
    rows: (['monarch', 'white', 'blue', 'brimstone'] as ButterflyKind[]).map((kind) => [4, 6, 9, 12].flatMap((n) => [0, 1, 2, 3].map((f) => ({ label: `${kind[0]}${n}/${f}`, draw: () => drawButterfly(kind, f, n) })))),
  });

  const cows: Item[][] = [];
  const cowPoses: CowPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'lie'];
  for (const coat of ['holstein', 'jersey', 'brown'] as CowCoat[]) {
    cows.push([10, 14, 18, 24, 30, 40, 58].map((h) => ({ label: `${coat} ${h}`, draw: () => drawCowSized(coat, 'stand', h) })));
    cows.push(cowPoses.map((pose) => ({ label: pose, draw: () => drawCowSized(coat, pose, 40) })));
  }
  out.push({ title: 'Cows', rows: cows });

  out.push({
    title: 'Farm',
    rows: [
      [8, 12, 16, 22, 30].map((h) => ({ label: `sheep ${h}`, draw: () => drawSheepSized('stand', h) })),
      (['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'lie'] as SheepPose[]).map((pose) => ({ label: pose, draw: () => drawSheepSized(pose, 26) })),
      [8, 12, 18, 24].flatMap((h) => (['run-1', 'run-2', 'trot-1', 'trot-2', 'crouch', 'sit', 'lie'] as DogPose[]).map((pose) => ({ label: `${pose} ${h}`, draw: () => drawDogSized(pose, h) }))),
      [10, 14, 20, 30, 40].map((h) => ({ label: `horse ${h}`, draw: () => drawHorseSized('stand', h) })),
      (['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'swish'] as HorsePose[]).map((pose) => ({ label: pose, draw: () => drawHorseSized(pose, 40) })),
      [6, 10, 14, 18].flatMap((n) => [0, 1].map((f) => ({ label: `hog ${n}/${f}`, draw: () => drawHedgehog(f, n) })).concat([{ label: 'ball', draw: () => drawHedgehog(0, n, true) }])),
    ],
  });

  const hens: Item[][] = [];
  for (const coat of ['white', 'brown', 'black'] as ChickenCoat[]) {
    const row: Item[] = [6, 8, 10, 12, 14, 18, 22].map((h) => ({ label: `${h}`, draw: () => drawChickenSized(coat, 'stand', h) }));
    for (const pose of ['peck', 'walk', 'walk-2', 'scratch', 'flap'] as const) row.push({ label: pose, draw: () => drawChickenSized(coat, pose, 20) });
    hens.push(row);
  }
  out.push({ title: 'Hens', rows: hens });

  const rabbitPoses: RabbitPose[] = ['sit', 'alert', 'groom', 'hop-1', 'hop-2', 'hop-3', 'peek'];
  out.push({
    title: 'Rabbits',
    rows: [
      [6, 8, 10, 12, 14, 16, 20].map((h) => ({ label: `${h}`, draw: () => drawRabbitSized('sit', h) })),
      rabbitPoses.map((pose) => ({ label: pose, draw: () => drawRabbitSized(pose, 16) })),
      rabbitPoses.map((pose) => ({ label: pose, draw: () => drawRabbitSized(pose, 10) })),
    ],
  });

  const deer: Item[][] = [];
  const deerPoses: DeerPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'graze-1', 'graze-3', 'stand', 'stand-flick', 'alert', 'bound-1', 'bound-2'];
  for (const kind of ['doe', 'buck', 'fawn', 'roe', 'elk'] as DeerKind[]) {
    deer.push([8, 12, 16, 22, 30, 40, 48].map((h) => ({ label: `${kind} ${h}`, draw: () => drawDeerSized(kind, 'walk-1', h) })));
    if (kind === 'doe' || kind === 'buck' || kind === 'elk') deer.push(deerPoses.map((pose) => ({ label: pose, draw: () => drawDeerSized(kind, pose, 40) })));
  }
  out.push({ title: 'Deer', rows: deer });

  const squirrelPoses: SquirrelPose[] = ['run-1', 'run-2', 'run-3', 'run-4', 'sit', 'nibble', 'climb-1', 'climb-2', 'climb-3', 'climb-4', 'cling', 'cling-flick'];
  out.push({
    title: 'Squirrels',
    rows: [
      ...[6, 8, 10, 13].map((size) => squirrelPoses.map((pose) => ({ label: `${pose} ${size}`, draw: () => drawSquirrelSized('red', pose, size) }))),
      squirrelPoses.map((pose) => ({ label: pose, draw: () => drawSquirrelSized('red', pose, 22) })),
      squirrelPoses.map((pose) => ({ label: pose, draw: () => drawSquirrelSized('grey', pose, 22) })),
    ],
  });

  const birds: Item[][] = [];
  for (const species of ['sparrow', 'pigeon', 'crow', 'robin', 'jay', 'seagull', 'sandpiper', 'bluebird'] as SpeciesId[]) {
    const row: Item[] = [];
    for (const size of [6, 8, 10, 13, 16]) {
      for (const pose of ['idle', 'peck-down', 'fly-up', 'fly-mid', 'fly-down'] as const) row.push({ label: `${size}${pose.slice(0, 5)}`, draw: () => drawBirdAt(species, pose, size) });
    }
    birds.push(row);
  }
  out.push({ title: 'Small birds', rows: birds });

  // Birds near the window, drawn in full.
  const closePoses: BirdPose[] = ['idle', 'idle-breathe', 'blink', 'tilt', 'look-up', 'look-back', 'fluff', 'preen-1', 'preen-2', 'scratch-1', 'tail-flick', 'hop-crouch', 'hop-air', 'hop-land', 'peck-reach', 'peck-down', 'peck-swallow', 'chirp', 'chirp-2', 'takeoff-1', 'fly-1', 'fly-2', 'fly-3', 'fly-4', 'fly-5', 'fly-6', 'glide', 'flare-1', 'flare-2'];
  const closeSizes = Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('closeSize') ?? 0);
  out.push({
    title: 'Close birds',
    rows: [...CLOSE_SPECIES].map((species) => closePoses.map((pose) => ({ label: `${species.slice(0, 4)} ${pose}`, draw: () => drawBirdClose(species, pose, closeSizes || Math.round(48 * SPECIES[species].size)) }))),
  });

  // The sill cat: every pose in one coat, then every coat.
  out.push({
    title: 'Window cat',
    rows: [
      CAT_POSES.slice(0, 16).map((pose) => ({ label: pose, draw: () => drawCat('orange-tabby', pose) })),
      CAT_POSES.slice(16).map((pose) => ({ label: pose, draw: () => drawCat('orange-tabby', pose) })),
      ...CAT_COATS.map((coat) => (['sit', 'walk-3', 'groom-1', 'loaf', 'nap-1', 'crouch-2', 'pounce-2', 'yawn-3', 'sit-look'] as const).map((pose) => ({ label: `${coat} ${pose}`, draw: () => drawCat(coat, pose) }))),
    ],
  });

  // The dog at the window: every pose for a husky, then each breed and coat.
  const husky: DogLook = { breed: 'husky', coat: 0, eyes: 'odd', collar: 1 };
  out.push({
    title: 'Window dog',
    rows: [
      DOG_POSES.slice(0, 12).map((pose) => ({ label: pose, draw: () => drawWindowDog(husky, pose) })),
      DOG_POSES.slice(12).map((pose) => ({ label: pose, draw: () => drawWindowDog(husky, pose) })),
      ...DOG_BREEDS.flatMap((breed) =>
        [0, 1, 2].map((coat) => (['away', 'side', 'side-pant-2', 'face', 'face-tilt-pant', 'side-up'] as const).map((pose) => ({ label: `${breed}${coat} ${pose}`, draw: () => drawWindowDog({ breed, coat, eyes: 'brown', collar: coat }, pose) }))),
      ),
    ],
  });

  const woodBirds: Item[][] = [];
  for (const species of ['chickadee', 'woodpecker', 'finch'] as SpeciesId[]) {
    const row: Item[] = [];
    for (const size of [10, 16, 24]) {
      for (const pose of ['idle', 'sleep', 'look-back', 'fly-up', 'fly-mid', 'fly-down', 'glide'] as const) row.push({ label: `${size}${pose.slice(0, 5)}`, draw: () => ({ grid: drawBird(species, pose, size), colors: SPECIES[species].palette }) });
    }
    woodBirds.push(row);
  }
  out.push({ title: 'Woodland birds', rows: woodBirds });
  const owlPerched: BirdPose[] = ['idle', 'idle-breathe', 'blink', 'sleep', 'fluff', 'look-back', 'tilt', 'chirp', 'peck-reach', 'peck-down', 'hop'];
  const owlFlying: BirdPose[] = ['fly-1', 'fly-2', 'fly-3', 'fly-4', 'fly-5', 'fly-6', 'glide', 'flare-1', 'flare-2'];
  out.push({
    title: 'Owls',
    rows: [
      ...[12, 18, 26, 40].map((size) => owlPerched.map((pose) => ({ label: `${size} ${pose}`, draw: () => drawOwl(pose, size) }))),
      ...[12, 20, 30].map((size) => owlFlying.map((pose) => ({ label: `${size} ${pose}`, draw: () => drawOwl(pose, size) }))),
      (['sleep', 'blink', 'awake', 'look-l', 'look-r', 'empty'] as HollowFace[]).map((face) => ({ label: `hollow ${face}`, draw: () => drawOwlInHollow(7, face) })),
    ],
  });
  out.push({ title: 'Eagle overhead', rows: [10, 14, 18].map((size) => [0, 1, 2, EAGLE_STOOP].map((frame) => ({ label: `${size} ${frame === EAGLE_STOOP ? 'stoop' : `flex${frame}`}`, draw: () => drawEagleSoar(frame, size) }))) });

  out.push({
    title: 'Sea turtles and dolphins',
    rows: [
      [8, 12, 16, 20, 28, 36, 54].map((w) => ({ label: `${w}`, draw: () => drawTurtleSized(1, w) })),
      ([0, 1, 2] as const).map((f) => ({ label: `crawl ${f}`, draw: () => drawTurtleSized(f, 40) })),
      Array.from({ length: DOLPHIN_FRAMES }, (_, f) => ({ label: `breach ${f}`, draw: () => drawDolphinSized(f) })),
      Array.from({ length: DOLPHIN_FRAMES }, (_, f) => ({ label: `breach ${f}`, draw: () => drawDolphinSized(f, 28) })),
    ],
  });

  out.push({
    title: 'Shore creatures',
    rows: [
      [6, 9, 12, 16, 22].flatMap((n) => [0, 1, 2, 3].map((f) => ({ label: `crab ${n}/${f}`, draw: () => drawCrab(f, n) })).concat([{ label: 'hid', draw: () => drawCrab(0, n, true) }])),
      [6, 9, 12, 16].flatMap((n) => [0, 1].map((f) => ({ label: `hermit ${n}/${f}`, draw: () => drawHermitCrab(f, n) })).concat([{ label: 'in', draw: () => drawHermitCrab(0, n, true) }])),
      [16, 24, 36, 48].flatMap((n) => (['glide', 'flap-up', 'flap-down', 'dive', 'float'] as PelicanPose[]).map((pose) => ({ label: `${pose} ${n}`, draw: () => drawPelican(pose, n) }))),
      [4, 6, 9, 14].flatMap((n) => [0, 1, 2, 3].map((f) => ({ label: `jelly ${n}/${f}`, draw: () => drawJellyfish(f, n) }))),
      [4, 6, 8, 11].flatMap((n) => [0, 1, 2, 3].map((f) => ({ label: `hatch ${n}/${f}`, draw: () => drawHatchling(f, n) }))),
    ],
  });

  const sandpiperPoses: SandpiperPose[] = ['stand', ...SANDPIPER_RUN, 'peck', 'probe', ...SANDPIPER_FLY];
  const gullPoses: GullPose[] = ['stand', 'call', 'stretch', 'float', 'float-dip', 'hover-0', 'hover-1', 'tug-0', 'tug-1', 'glide', 'flap-up', 'flap-down'];
  const egretPoses: EgretPose[] = ['stand', 'step-0', 'step-1', 'crouch', 'strike', 'fly-0', 'fly-1'];
  out.push({
    title: 'Shore birds',
    rows: [
      ...[8, 12, 18].map((n) => sandpiperPoses.map((pose) => ({ label: `${pose} ${n}`, draw: () => drawSandpiper(pose, n) }))),
      ...[10, 16, 24].map((n) => gullPoses.map((pose) => ({ label: `${pose} ${n}`, draw: () => drawGull(pose, n) }))),
      ...[14, 22, 34].map((n) => egretPoses.map((pose) => ({ label: `${pose} ${n}`, draw: () => drawEgret(pose, n) }))),
      [12, 16].flatMap((n) => Array.from({ length: NIGHTJAR_FRAMES }, (_, f) => ({ label: `nightjar ${n}/${f}`, draw: () => drawNightjar(f, n) }))),
      [6, 9, 13].flatMap((n) => [0, 1, 2].map((f) => ({ label: `sail ${n}/${f}`, draw: () => drawSailboat(f, n) }))).concat([14, 20].flatMap((n) => [0, 1].map((f) => ({ label: `trawler ${n}/${f}`, draw: () => drawFishingBoat(f, n) })))),
      [10, 16, 24].flatMap((n) => [0, 1].map((f) => ({ label: `frigate ${n}/${f}`, draw: () => drawFrigatebird(f, n) }))).concat([5, 8].flatMap((n) => Array.from({ length: JUMP_FRAMES }, (_, f) => ({ label: `jump ${n}/${f}`, draw: () => drawJumpFish(f, n) })))),
    ],
  });

  out.push({
    title: 'Creek fish',
    rows: (['trout', 'minnow'] as const).map((kind) => Array.from({ length: 16 }, (_, h) => ({ label: `${h}`, draw: () => drawTopFishSized(kind, h, (h % 2) as 0 | 1) }))),
  });
  return out;
}

function render(item: Item, scale: number, dark: boolean): HTMLElement {
  const drawn = item.draw();
  const grid = 'buffer' in drawn ? drawn.buffer : drawn.grid;
  const rgba = 'buffer' in drawn ? drawn.buffer.data : drawn.grid.toRGBA('palette' in drawn ? drawn.palette.colors : drawn.colors);
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba) as Uint8ClampedArray<ArrayBuffer>, grid.width, grid.height), 0, 0);
  canvas.style.cssText = `width:${grid.width * scale}px;height:${grid.height * scale}px;image-rendering:pixelated;background:${dark ? '#1c2230' : '#c8b898'}`;
  const cell = document.createElement('figure');
  cell.style.cssText = 'margin:0 6px 8px 0;display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom';
  const caption = document.createElement('figcaption');
  caption.textContent = item.label;
  caption.style.cssText = 'font:10px monospace;color:#8a8a8a';
  cell.append(canvas, caption);
  return cell;
}

export function showGallery(): void {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const scale = Number(params.get('scale') ?? 3);
  const only = params.get('only');
  document.body.style.cssText = 'position:static;margin:0;padding:16px;background:#0e1018;color:#e8e0d0;overflow:visible;height:auto';
  document.documentElement.style.cssText = 'overflow:auto;height:auto';
  const root = document.getElementById('app') ?? document.body;
  root.style.cssText = 'position:static;width:auto;height:auto';
  for (const section of sections()) {
    if (only && !section.title.toLowerCase().includes(only.toLowerCase())) continue;
    const h = document.createElement('h2');
    h.textContent = section.title;
    h.style.cssText = 'font:bold 14px monospace;margin:12px 0 6px';
    root.append(h);
    for (const row of section.rows) {
      for (const dark of [false, true]) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;align-items:flex-end;flex-wrap:wrap';
        for (const item of row) line.append(render(item, scale, dark));
        root.append(line);
      }
    }
  }
  document.body.dataset.gallery = 'ready';
}
