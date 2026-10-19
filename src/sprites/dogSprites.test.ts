import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { chooseGaze } from '../life/WindowDog';
import { DOG_BREEDS, DOG_HEIGHT, DOG_PANT_FACE, DOG_POSES, DOG_SURFACE_ROW, DOG_WIDTH, drawWindowDog, randomDogLook, type DogLook, type DogPose } from './dogSprites';

const look = (breed: DogLook['breed'], coat = 0): DogLook => ({ breed, coat, eyes: 'brown', collar: 0 });

describe('the dog at the window', () => {
  it('draws every pose of every breed in its box', () => {
    for (const breed of DOG_BREEDS) {
      for (const pose of DOG_POSES) {
        const { grid } = drawWindowDog(look(breed), pose);
        expect(grid.width).toBe(DOG_WIDTH);
        expect(grid.height).toBe(DOG_HEIGHT);
        expect(grid.isEmpty()).toBe(false);
      }
    }
  });

  it('rests its paws on the sill just in front of the standing line, and lifts them to get up', () => {
    // The lowest paw pixels sit within a few rows of the sill's surface line; the head rises well above it.
    const topRow = (pose: DogPose) => {
      const { grid } = drawWindowDog(look('golden'), pose);
      return [...Array(grid.height).keys()].find((y) => [...Array(grid.width).keys()].some((x) => grid.get(x, y)));
    };
    expect(topRow('away')).toBeLessThan(DOG_SURFACE_ROW - 40);
    const pawRow = (pose: DogPose) => {
      const { grid } = drawWindowDog(look('husky'), pose);
      // The paw column, out to the side of the neck.
      const x = Math.round(grid.width / 2 + grid.width * 0.245);
      return [...Array(grid.height).keys()].find((y) => grid.get(x, y));
    };
    expect(Math.abs(pawRow('away')! - DOG_SURFACE_ROW)).toBeLessThan(8);
    expect(pawRow('reach')!).toBeLessThan(pawRow('away')!);
  });

  it('animates: panting frames, blinks and head turns all differ', () => {
    const key = (pose: DogPose) => drawWindowDog(look('collie'), pose).grid.data.join();
    expect(new Set(DOG_PANT_FACE.map(key)).size).toBe(3);
    expect(key('face')).not.toBe(key('face-blink'));
    expect(key('side')).not.toBe(key('side-up'));
    expect(key('away')).not.toBe(key('side'));
  });

  it('comes as many breeds and coats, now and then without a collar', () => {
    const rng = createRng(3);
    const looks = Array.from({ length: 200 }, () => randomDogLook(rng));
    expect(new Set(looks.map((l) => l.breed)).size).toBe(DOG_BREEDS.length);
    expect(looks.some((l) => l.collar === null)).toBe(true);
    expect(looks.some((l) => l.breed === 'husky' && l.eyes === 'blue')).toBe(true);
  });

  it('turns to watch a bird when there is one', () => {
    const rng = createRng(9);
    let side = 0;
    for (let i = 0; i < 300; i++) if (chooseGaze('out', true, rng) === 'side') side++;
    expect(side / 300).toBeGreaterThan(0.5);
  });
});
