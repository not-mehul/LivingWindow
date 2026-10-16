import { describe, expect, it } from 'vitest';
import { drawBird, SPECIES, type BirdPose, type SpeciesId } from './birdSprites';
import { CAT_HEIGHT, CAT_WIDTH, drawCat, type CatPose } from './catSprites';
import { PixelGrid } from './raster';
import { drawDolphin, drawTurtle } from './beachSprites';
import { drawDeer, drawSquirrel } from './forestSprites';
import { drawChicken, drawCow, drawRabbit, drawTopFish, TOP_FISH_HEADINGS } from './meadowSprites';
import { drawPerson, drawStall, randomLook } from './streetSprites';

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

  it('renders distant birds as single-colour silhouettes', () => {
    const colors = new Set(drawBird('pigeon', 'fly-up', 6).data.filter((v) => v > 0));
    expect(colors.size).toBe(1);
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

  it('draws pedestrians with and without umbrellas, and stalls at each stage', () => {
    const look = randomLook(() => 0.3);
    expect(drawPerson(look, 'walk-a', true).isEmpty()).toBe(false);
    expect(drawPerson(look, 'stand', false).isEmpty()).toBe(false);
    for (const stage of [0, 1, 2, 3]) expect(drawStall('fruit', stage).isEmpty()).toBe(false);
  });
});

describe('landscape creatures', () => {
  it('draws deer and squirrels in every pose', () => {
    for (const kind of ['doe', 'buck', 'fawn'] as const) {
      for (const pose of ['walk-1', 'walk-3', 'graze-1', 'alert', 'bound-1'] as const) {
        const g = drawDeer(kind, pose, 30);
        expect(g.height).toBe(30);
        expect(g.isEmpty()).toBe(false);
      }
    }
    for (const pose of ['run-1', 'sit', 'nibble', 'climb-1', 'cling'] as const) {
      expect(drawSquirrel(pose, 13).isEmpty()).toBe(false);
    }
  });

  it('gives a buck antlers in the box', () => {
    const buck = drawDeer('buck', 'walk-1', 36);
    const doe = drawDeer('doe', 'walk-1', 36);
    const topRow = (g: PixelGrid) => [...Array(g.height).keys()].find((y) => [...Array(g.width).keys()].some((x) => g.get(x, y)));
    expect(topRow(buck)!).toBeLessThan(topRow(doe)!);
  });

  it('draws cows, chickens, rabbits, fish, turtles and dolphins', () => {
    for (const coat of ['holstein', 'jersey', 'brown'] as const) {
      for (const pose of ['walk-2', 'graze-1', 'stand', 'lie'] as const) expect(drawCow(coat, pose, 22).isEmpty()).toBe(false);
    }
    for (const pose of ['stand', 'peck', 'walk', 'flap'] as const) expect(drawChicken(pose).isEmpty()).toBe(false);
    for (const pose of ['sit', 'hop-1', 'hop-2', 'peek'] as const) expect(drawRabbit(pose).isEmpty()).toBe(false);
    for (let h = 0; h < TOP_FISH_HEADINGS; h++) expect(drawTopFish('trout', h, 0).isEmpty()).toBe(false);
    expect(drawTurtle(1).isEmpty()).toBe(false);
    for (let f = 0; f < 4; f++) expect(drawDolphin(f).isEmpty()).toBe(false);
  });
});
