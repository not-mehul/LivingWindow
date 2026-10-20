import { describe, expect, it } from 'vitest';
import { drawBird, SPECIES, type BirdPose, type SpeciesId } from './birdSprites';
import { drawOwl } from './owlSprites';
import { CAT_COATS, CAT_HEIGHT, CAT_POSES, CAT_STALK, CAT_WALK, CAT_WIDTH, drawCat, type CatPose } from './catSprites';
import { PixelGrid } from './raster';
import { DOLPHIN_FRAMES, drawCrab, drawDolphinSized, drawHatchling, drawHermitCrab, drawJellyfish, drawPelican, drawTurtleSized } from './beachSprites';
import { drawDeerSized, drawSquirrelSized } from './forestSprites';
import { drawScarecrow, drawChickenSized, drawCowSized, drawDogSized, drawHorseSized, drawRabbitSized, drawSheepSized, drawTopFishSized, TOP_FISH_HEADINGS } from './meadowSprites';
import { drawBusker, drawPerson, randomLook } from './people';
import { drawBlimp, drawHelicopter, drawPadDrone } from './skySprites';
import { drawPushcart, drawRider, drawSweeper, drawTaxi, randomRiderLook } from './vehicleSprites';
import { drawBat, drawBear, drawButterfly, drawEagleSoar, drawFox, drawHedgehog, drawMushroom, drawWoodpeckerCling, EAGLE_STOOP } from './wildSprites';
import { drawStallLightsSized, drawStallSized, STALL_STAGES, type StallKind } from './streetSprites';

const POSES: BirdPose[] = ['idle', 'idle-breathe', 'look-up', 'look-back', 'peck-reach', 'peck-down', 'chirp', 'hop', 'fly-up', 'fly-mid', 'fly-down', 'glide', 'sleep'];

describe('PixelGrid', () => {
  it('fills shapes and outlines them', () => {
    const g = new PixelGrid(10, 10);
    g.ellipse(5, 5, 3, 3, 2);
    expect(g.get(5, 5)).toBe(2);
    expect(g.get(0, 0)).toBe(0);
    g.outline(1);
    expect(g.get(5, 1)).toBe(1);
    g.flip();
    expect(g.get(4, 5)).toBe(2);
  });

  it('ignores out-of-bounds writes', () => {
    const g = new PixelGrid(4, 4);
    expect(() => g.set(-1, 9, 3)).not.toThrow();
    expect(g.isEmpty()).toBe(true);
  });
});

describe('procedural birds', () => {
  it('draws every species and pose at every size without going blank', () => {
    for (const species of Object.keys(SPECIES) as SpeciesId[]) {
      for (const size of [6, 8, 12, 16, 24, 40, 48]) {
        for (const pose of POSES) {
          const g = drawBird(species, pose, size);
          expect(g.width).toBe(size);
          expect(g.isEmpty(), `${species} ${pose} ${size}`).toBe(false);
        }
      }
    }
  });

  it('renders distant birds as simple two-tone figures, with more detail up close', () => {
    for (const pose of ['idle', 'fly-up', 'peck-down'] as const) {
      const colors = new Set(drawBird('sparrow', pose, 8).data.filter((v) => v > 0));
      expect(colors.size).toBeGreaterThanOrEqual(2);
      expect(colors.size).toBeLessThanOrEqual(6);
    }
    expect(new Set(drawBird('pigeon', 'idle', 40).data).size).toBeGreaterThan(6);
  });

  it('keeps a perched bird standing on the bottom of its box', () => {
    const g = drawBird('sparrow', 'idle', 29);
    const lowest = [...Array(g.height).keys()].reverse().find((y) => [...Array(g.width).keys()].some((x) => g.get(x, y)));
    expect(lowest).toBeGreaterThanOrEqual(g.height - 3);
  });
});

describe('other sprites', () => {
  it('draws every cat pose inside its box', () => {
    for (const coat of CAT_COATS) {
      for (const pose of CAT_POSES) {
        const { grid } = drawCat(coat, pose);
        expect(grid.width).toBe(CAT_WIDTH);
        expect(grid.height).toBe(CAT_HEIGHT);
        expect(grid.isEmpty()).toBe(false);
      }
    }
  });

  it('stands the cat on the bottom of its box, and animates every cycle', () => {
    const bottom = (pose: CatPose) => {
      const { grid } = drawCat('grey-tabby', pose);
      return [...Array(grid.height).keys()].reverse().find((y) => [...Array(grid.width).keys()].some((x) => grid.get(x, y)));
    };
    for (const pose of ['sit', 'walk-1', 'loaf', 'nap-1', 'crouch-1'] as const) expect(bottom(pose)).toBeGreaterThanOrEqual(CAT_HEIGHT - 2);
    const key = (pose: CatPose) => drawCat('calico', pose).grid.data.join();
    for (const cycle of [CAT_WALK, CAT_STALK]) expect(new Set(cycle.map(key)).size).toBe(cycle.length);
    expect(key('sit')).not.toBe(key('sit-blink'));
    expect(key('yawn-1')).not.toBe(key('yawn-3'));
  });

  it('is clearly bigger than the plant pot', () => {
    expect(CAT_WIDTH).toBeGreaterThan(34 * 2);
  });

  it('draws pedestrians from every side, walking or not, with umbrellas, at every height', () => {
    for (let i = 0; i < 6; i++) {
      const look = randomLook(() => (i * 0.17 + 0.05) % 1);
      for (const h of [3, 5, 8, 10, 11, 16, 22, 30, 40]) {
        for (const facing of ['front', 'back', 'side'] as const) {
          for (const pose of ['stand', 'walk', 'browse'] as const) {
            for (const umbrella of [false, true]) {
              const { grid, palette } = drawPerson(look, facing, pose, i, umbrella, h);
              expect(grid.isEmpty(), `${facing} ${pose} ${h}`).toBe(false);
              // Feet on (or an outline pixel above) the bottom row, and every pixel a real colour.
              const bottom = [...Array(grid.height).keys()].reverse().find((y) => [...Array(grid.width).keys()].some((x) => grid.get(x, y)));
              expect(bottom).toBeGreaterThanOrEqual(grid.height - 2);
              for (const v of grid.data) expect(v < palette.colors.length).toBe(true);
            }
          }
        }
      }
    }
  });

  it('draws the street traffic coming and going at every size, with its lamps inside the sprite', () => {
    const look = randomRiderLook(() => 0.4);
    for (const h of [5, 8, 12, 18, 26, 40]) {
      for (const facing of ['front', 'back'] as const) {
        const all = [
          drawRider('bike', look, facing, 0, h),
          drawRider('bike', look, facing, 1, h),
          drawRider('scooter', look, facing, 0, h),
          drawSweeper(facing, 0, h),
          drawTaxi(facing, h),
          drawPushcart(facing, 1, h),
        ];
        for (const v of all) {
          expect(v.grid.isEmpty()).toBe(false);
          expect(v.lamps.length).toBeGreaterThan(0);
          for (const lamp of v.lamps) {
            expect(lamp.x).toBeGreaterThanOrEqual(-1);
            expect(lamp.x).toBeLessThanOrEqual(v.grid.width + 1);
            expect(lamp.y).toBeGreaterThanOrEqual(-1);
            expect(lamp.y).toBeLessThanOrEqual(v.grid.height + 1);
          }
        }
      }
    }
  });

  it('draws the blimp, the helicopter with its rotor turning, and the pad drone', () => {
    expect(drawBlimp().grid.isEmpty()).toBe(false);
    expect(Array.from(drawHelicopter(0).grid.data).join()).not.toBe(Array.from(drawHelicopter(1).grid.data).join());
    for (const span of [7, 10, 16]) for (const f of [0, 1, 2]) expect(drawPadDrone(span, f).grid.width).toBe(span + 8);
  });

  it('draws the busker with a guitar at every size', () => {
    const look = randomLook(() => 0.6);
    for (const h of [4, 10, 16, 30]) {
      for (const f of [0, 1]) {
        const busker = drawBusker(look, f, h).grid;
        const plain = drawPerson(look, 'front', 'stand', 0, false, h).grid;
        expect(busker.isEmpty()).toBe(false);
        // The guitar adds pixels over the plain figure.
        expect([...busker.data].some((v, i) => v !== plain.data[i])).toBe(true);
      }
    }
  });

  it('draws every stall at each stage and size, and lights the night ones', () => {
    const kinds: StallKind[] = ['produce', 'tea', 'flowers', 'noodles', 'tech', 'skewers'];
    for (const kind of kinds) {
      for (const h of [5, 8, 12, 18, 26, 38]) {
        for (let stage = 0; stage < STALL_STAGES; stage++) {
          const { grid } = drawStallSized(kind, stage, h);
          expect(grid.height).toBe(h);
          expect(grid.isEmpty(), `${kind} ${stage} ${h}`).toBe(false);
        }
        const lights = drawStallLightsSized(kind, h);
        if (['noodles', 'tech', 'skewers'].includes(kind)) expect(lights?.isEmpty()).toBe(false);
        else expect(lights).toBeNull();
      }
    }
  });
});

describe('landscape creatures', () => {
  it('draws deer and squirrels in every pose', () => {
    for (const kind of ['doe', 'buck', 'fawn', 'roe', 'elk'] as const) {
      for (const h of [8, 14, 22, 30, 48]) {
        for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'graze-1', 'graze-2', 'graze-3', 'stand', 'stand-flick', 'alert', 'bound-1', 'bound-2'] as const) {
          const { grid } = drawDeerSized(kind, pose, h);
          expect(grid.height).toBe(h);
          expect(grid.isEmpty(), `${kind} ${pose} ${h}`).toBe(false);
        }
      }
    }
    for (const coat of ['red', 'grey'] as const) {
      for (const size of [6, 8, 13, 22]) {
        for (const pose of ['run-1', 'run-2', 'run-3', 'run-4', 'sit', 'nibble', 'climb-1', 'climb-2', 'climb-3', 'climb-4', 'cling', 'cling-flick'] as const) {
          expect(drawSquirrelSized(coat, pose, size).grid.isEmpty()).toBe(false);
        }
      }
    }
  });

  it('gives a buck antlers in the box', () => {
    const buck = drawDeerSized('buck', 'walk-1', 36).grid;
    const doe = drawDeerSized('doe', 'walk-1', 36).grid;
    const topRow = (g: PixelGrid) => [...Array(g.height).keys()].find((y) => [...Array(g.width).keys()].some((x) => g.get(x, y)));
    expect(topRow(buck)!).toBeLessThan(topRow(doe)!);
  });

  it('walks a cow in four distinct beats, hooves lifting in turn, with white lower legs on a Holstein', () => {
    const frames = (['walk-1', 'walk-2', 'walk-3', 'walk-4'] as const).map((pose) => Array.from(drawCowSized('holstein', pose, 40).grid.data).join(','));
    expect(new Set(frames).size).toBe(4);
    // Each frame has a hoof off the ground: fewer hoof pixels sit on the bottom row than when standing.
    const bottom = (pose: 'stand' | 'walk-1') => {
      const { grid } = drawCowSized('jersey', pose, 40);
      let n = 0;
      for (let x = 0; x < grid.width; x++) if (grid.get(x, grid.height - 1)) n++;
      return n;
    };
    expect(bottom('walk-1')).toBeLessThan(bottom('stand'));
    const { grid, palette } = drawCowSized('holstein', 'stand', 40);
    const dark = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255) < 200;
    let darkLeg = 0;
    // Shins: between the knees and the hooves (rows 31-36), away from the tail.
    for (let y = 31; y < 36; y++) for (let x = 14; x < grid.width - 10; x++) if (grid.get(x, y) && dark(palette.colors[grid.get(x, y)])) darkLeg++;
    expect(darkLeg).toBeLessThan(12);
  });

  it('draws cows, chickens, rabbits, fish, turtles and dolphins', () => {
    for (const coat of ['holstein', 'jersey', 'brown'] as const) {
      for (const h of [8, 14, 22, 40, 58]) {
        for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'lie'] as const) {
          const { grid } = drawCowSized(coat, pose, h);
          expect(grid.height).toBe(h);
          expect(grid.isEmpty(), `${coat} ${pose} ${h}`).toBe(false);
        }
      }
    }
    for (const coat of ['white', 'brown', 'black'] as const) {
      for (const h of [6, 10, 14, 22]) {
        for (const pose of ['stand', 'peck', 'walk', 'walk-2', 'scratch', 'flap'] as const) expect(drawChickenSized(coat, pose, h).grid.isEmpty()).toBe(false);
      }
    }
    for (const h of [6, 10, 16, 20]) {
      for (const pose of ['sit', 'alert', 'groom', 'hop-1', 'hop-2', 'hop-3', 'peek'] as const) expect(drawRabbitSized(pose, h).grid.isEmpty()).toBe(false);
    }
    for (const kind of ['trout', 'minnow'] as const) {
      for (let h = 0; h < TOP_FISH_HEADINGS; h++) expect(drawTopFishSized(kind, h, 0).grid.isEmpty()).toBe(false);
    }
    for (const w of [8, 14, 20, 36, 54]) for (const f of [0, 1, 2] as const) expect(drawTurtleSized(f, w).grid.isEmpty()).toBe(false);
    for (let f = 0; f < DOLPHIN_FRAMES; f++) expect(drawDolphinSized(f).grid.isEmpty()).toBe(false);
  });
});

describe('wild creatures', () => {
  it('draws the fox in every pose and size, feet on the ground', () => {
    for (const h of [6, 10, 16, 22, 30]) {
      for (const pose of ['trot-1', 'trot-2', 'trot-3', 'trot-4', 'sniff', 'sit', 'crouch', 'pounce', 'run-1', 'run-2'] as const) {
        const { grid } = drawFox(pose, h);
        expect(grid.isEmpty(), `${pose} ${h}`).toBe(false);
        expect(grid.height).toBe(h);
      }
    }
  });

  it('draws hares, bats, bears, butterflies, woodpeckers and mushrooms', () => {
    for (const h of [8, 14, 22]) for (const pose of ['sit', 'alert', 'hop-1', 'peek'] as const) expect(drawRabbitSized(pose, h, 'hare').grid.isEmpty()).toBe(false);
    // A hare's black-tipped ears make it differ from a rabbit.
    expect([...drawRabbitSized('sit', 20, 'hare').grid.data].join()).not.toBe([...drawRabbitSized('sit', 20).grid.data].join());
    for (const n of [4, 8, 14, 24]) for (const f of [0, 1, 2, 3]) expect(drawBat(f, n).grid.isEmpty()).toBe(false);
    for (const h of [6, 12, 24, 36]) for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'sniff', 'sniff-air'] as const) expect(drawBear(pose, h).grid.isEmpty()).toBe(false);
    // The bear's walk and the bat's wingbeat are all distinct frames.
    const frames = (draw: (k: number) => { grid: PixelGrid }, n: number) => new Set(Array.from({ length: n }, (_, k) => Array.from(draw(k).grid.data).join(','))).size;
    expect(frames((k) => drawBear((['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6'] as const)[k], 30), 6)).toBe(6);
    expect(frames((k) => drawBat(k, 16), 4)).toBe(4);
    expect(frames((k) => drawWoodpeckerCling(k, 16), 4)).toBe(4);
    for (const kind of ['monarch', 'white', 'blue', 'brimstone'] as const) {
      for (const n of [4, 6, 9, 14]) for (const f of [0, 1, 2, 3]) expect(drawButterfly(kind, f, n).grid.isEmpty()).toBe(false);
      expect(frames((k) => drawButterfly(kind, k, 12), 4)).toBe(4);
    }
    for (const n of [5, 8, 13, 24]) for (const f of [0, 1, 2, 3]) expect(drawWoodpeckerCling(f, n).grid.isEmpty()).toBe(false);
    for (const kind of ['fly-agaric', 'bolete', 'cluster'] as const) for (const n of [3, 6, 10]) expect(drawMushroom(kind, n).grid.isEmpty()).toBe(false);
  });

  it('draws the owl perched and in flight at every size, with a slow, changing wingbeat', () => {
    const poses: BirdPose[] = ['idle', 'idle-breathe', 'blink', 'sleep', 'fluff', 'look-back', 'chirp', 'peck-down', 'hop', 'fly-1', 'fly-3', 'fly-4', 'fly-up', 'fly-mid', 'fly-down', 'glide', 'flare-1'];
    for (const n of [8, 12, 18, 26, 40]) for (const pose of poses) expect(drawOwl(pose, n).grid.isEmpty(), `${pose} ${n}`).toBe(false);
    const beat = ['fly-1', 'fly-2', 'fly-3', 'fly-4', 'fly-5', 'fly-6'] as BirdPose[];
    expect(new Set(beat.map((p) => Array.from(drawOwl(p, 24).grid.data).join(','))).size).toBe(6);
    // Asleep its eyes are shut; awake they catch the light.
    const glint = (pose: BirdPose) => {
      const { grid, palette } = drawOwl(pose, 30);
      return grid.data.some((c) => palette.colors[c] === 0xfff4e0);
    };
    expect(glint('idle')).toBe(true);
    expect(glint('sleep')).toBe(false);
  });

  it('draws the scarecrow at every size, its sleeves flapping through three frames', () => {
    for (const h of [9, 15, 22, 40]) {
      const frames = [0, 1, 2].map((f) => drawScarecrow(h, f).grid);
      for (const g of frames) expect(g.height).toBe(Math.max(9, h) + 2);
      expect(new Set(frames.map((g) => Array.from(g.data).join(','))).size).toBe(3);
    }
  });

  it('soars the eagle with wings that flex, and folds them to stoop', () => {
    for (const n of [10, 14, 18]) {
      const all = [0, 1, 2, EAGLE_STOOP].map((f) => drawEagleSoar(f, n).grid);
      for (const g of all) {
        expect(g.isEmpty()).toBe(false);
        expect(g.width).toBeGreaterThan(g.height * 1.8);
      }
      expect(new Set(all.map((g) => Array.from(g.data).join(','))).size).toBe(4);
    }
  });
});

describe('shore creatures', () => {
  it('draws crabs, hermit crabs, pelicans, jellyfish and hatchlings at every size', () => {
    for (const n of [5, 8, 12, 20]) {
      for (let f = 0; f < 4; f++) expect(drawCrab(f, n).grid.isEmpty()).toBe(false);
      expect(drawCrab(0, n, true).grid.isEmpty()).toBe(false);
      for (const f of [0, 1]) expect(drawHermitCrab(f, n).grid.isEmpty()).toBe(false);
      expect(drawHermitCrab(0, n, true).grid.isEmpty()).toBe(false);
    }
    for (const n of [8, 16, 34, 48]) for (const pose of ['glide', 'flap-up', 'flap-down', 'dive', 'float'] as const) expect(drawPelican(pose, n).grid.isEmpty()).toBe(false);
    for (const n of [3, 6, 10]) for (let f = 0; f < 3; f++) expect(drawJellyfish(f, n).grid.isEmpty()).toBe(false);
    for (const n of [3, 5, 8]) for (const f of [0, 1]) expect(drawHatchling(f, n).grid.isEmpty()).toBe(false);
  });
});

describe('farm animals', () => {
  it('draws sheep, the sheepdog, the horse and the hedgehog in every pose', () => {
    for (const h of [6, 12, 22, 30]) {
      for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'lie'] as const) expect(drawSheepSized(pose, h).grid.height).toBe(h);
      for (const pose of ['run-1', 'run-2', 'trot-1', 'trot-2', 'crouch', 'sit', 'lie'] as const) expect(drawDogSized(pose, h).grid.isEmpty()).toBe(false);
      for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'swish'] as const) expect(drawHorseSized(pose, h).grid.isEmpty()).toBe(false);
    }
    for (const n of [6, 10, 14, 18]) {
      for (const f of [0, 1, 2, 3]) expect(drawHedgehog(f, n).grid.isEmpty()).toBe(false);
      expect(drawHedgehog(0, n, true).grid.isEmpty()).toBe(false);
    }
    // A four-beat shuffle, every beat different.
    expect(new Set([0, 1, 2, 3].map((f) => Array.from(drawHedgehog(f, 18).grid.data).join(','))).size).toBe(4);
  });
});
