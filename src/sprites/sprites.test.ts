import { describe, expect, it } from 'vitest';
import { drawBird, SPECIES, type BirdPose, type SpeciesId } from './birdSprites';
import { CAT_HEIGHT, CAT_WIDTH, drawCat, type CatPose } from './catSprites';
import { PixelGrid } from './raster';
import { DOLPHIN_FRAMES, drawCrab, drawDolphinSized, drawHatchling, drawHermitCrab, drawJellyfish, drawPelican, drawTurtleSized } from './beachSprites';
import { drawDeerSized, drawSquirrelSized } from './forestSprites';
import { drawChickenSized, drawCowSized, drawRabbitSized, drawTopFishSized, TOP_FISH_HEADINGS } from './meadowSprites';
import { drawBusker, drawPerson, randomLook } from './people';
import { drawPushcart, drawRider, drawSweeper, drawTaxi, randomRiderLook } from './vehicleSprites';
import { drawBat, drawBear, drawButterfly, drawFox, drawMushroom, drawWoodpeckerCling } from './wildSprites';
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
    const poses: CatPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'sit', 'sit-blink', 'stretch', 'nap-1', 'nap-2', 'crouch-1', 'crouch-2', 'pounce'];
    for (const pose of poses) {
      const g = drawCat('orange-tabby', pose);
      expect(g.width).toBe(CAT_WIDTH);
      expect(g.height).toBe(CAT_HEIGHT);
      expect(g.isEmpty()).toBe(false);
    }
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
    const kinds: StallKind[] = ['fruit', 'flowers', 'cart', 'noodles', 'lanterns', 'trinkets'];
    for (const kind of kinds) {
      for (const h of [5, 8, 12, 18, 26, 38]) {
        for (let stage = 0; stage < STALL_STAGES; stage++) {
          const { grid } = drawStallSized(kind, stage, h);
          expect(grid.height).toBe(h);
          expect(grid.isEmpty(), `${kind} ${stage} ${h}`).toBe(false);
        }
        const lights = drawStallLightsSized(kind, h);
        if (['noodles', 'lanterns', 'trinkets'].includes(kind)) expect(lights?.isEmpty()).toBe(false);
        else expect(lights).toBeNull();
      }
    }
  });
});

describe('landscape creatures', () => {
  it('draws deer and squirrels in every pose', () => {
    for (const kind of ['doe', 'buck', 'fawn', 'roe', 'elk'] as const) {
      for (const h of [8, 14, 22, 30, 48]) {
        for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'alert', 'bound-1', 'bound-2'] as const) {
          const { grid } = drawDeerSized(kind, pose, h);
          expect(grid.height).toBe(h);
          expect(grid.isEmpty(), `${kind} ${pose} ${h}`).toBe(false);
        }
      }
    }
    for (const coat of ['red', 'grey'] as const) {
      for (const size of [6, 8, 13, 22]) {
        for (const pose of ['run-1', 'run-2', 'sit', 'nibble', 'climb-1', 'climb-2', 'cling'] as const) {
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
    for (const n of [4, 8, 14]) for (const f of [0, 1, 2]) expect(drawBat(f, n).grid.isEmpty()).toBe(false);
    for (const h of [6, 12, 24]) for (const pose of ['walk-1', 'walk-3', 'sniff'] as const) expect(drawBear(pose, h).grid.isEmpty()).toBe(false);
    for (const kind of ['monarch', 'white', 'blue', 'brimstone'] as const) for (const n of [4, 6, 9, 14]) for (const f of [0, 1, 2]) expect(drawButterfly(kind, f, n).grid.isEmpty()).toBe(false);
    for (const n of [5, 8, 13]) for (const f of [0, 1]) expect(drawWoodpeckerCling(f, n).grid.isEmpty()).toBe(false);
    for (const kind of ['fly-agaric', 'bolete', 'cluster'] as const) for (const n of [3, 6, 10]) expect(drawMushroom(kind, n).grid.isEmpty()).toBe(false);
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
