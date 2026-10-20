import { describe, expect, it, vi } from 'vitest';

// Record every pose the catalogue draws, to check none is left out.
const drawn = { cat: new Set<string>(), dog: new Set<string>(), bird: new Set<string>() };
vi.mock('../sprites/catSprites', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sprites/catSprites')>();
  return { ...real, drawCat: (coat: never, pose: never) => (drawn.cat.add(pose), real.drawCat(coat, pose)) };
});
vi.mock('../sprites/dogSprites', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sprites/dogSprites')>();
  return { ...real, drawWindowDog: (look: never, pose: never) => (drawn.dog.add(pose), real.drawWindowDog(look, pose)) };
});
vi.mock('../sprites/birdClose', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sprites/birdClose')>();
  return { ...real, drawBirdClose: (species: never, pose: never, size: number) => (drawn.bird.add(pose), real.drawBirdClose(species, pose, size)) };
});

const { SPRITES, frameImage, frameSeconds } = await import('./spriteCatalog');
const { CAT_POSES } = await import('../sprites/catSprites');
const { DOG_POSES } = await import('../sprites/dogSprites');

describe('sprite catalogue', () => {
  it('has unique ids', () => {
    const ids = SPRITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws something in every frame, for every variant and size, with a sensible timing', () => {
    for (const entry of SPRITES) {
      for (const variant of entry.variants) {
        for (const size of entry.sizes) {
          const frames = entry.frames(variant, size);
          expect(frames.length, `${entry.id} ${variant} ${size}`).toBeGreaterThan(0);
          frames.forEach((frame, i) => {
            const image = frameImage(frame);
            expect(image.data.length, `${entry.id} ${variant} ${size} #${i}`).toBe(image.width * image.height * 4);
            let ink = false;
            for (let k = 3; k < image.data.length && !ink; k += 4) ink = image.data[k] > 0;
            expect(ink, `${entry.id} ${variant} ${size} frame ${i} is blank`).toBe(true);
            const seconds = frameSeconds(entry, i);
            expect(seconds, entry.id).toBeGreaterThan(0.005);
            expect(seconds, entry.id).toBeLessThan(5);
          });
        }
      }
    }
  }, 120_000);

  it('shows every pose of the window cat and dog, and every close-bird pose', () => {
    for (const entry of SPRITES) entry.frames(entry.variants[0], entry.sizes[0]);
    expect(CAT_POSES.filter((p) => !drawn.cat.has(p))).toEqual([]);
    expect(DOG_POSES.filter((p) => !drawn.dog.has(p))).toEqual([]);
    const closePoses = ['idle', 'idle-breathe', 'blink', 'tilt', 'look-up', 'look-back', 'fluff', 'preen-1', 'preen-2', 'scratch-1', 'scratch-2', 'tail-flick', 'hop-crouch', 'hop-air', 'hop-land', 'peck-reach', 'peck-down', 'peck-swallow', 'chirp', 'chirp-2', 'takeoff-1', 'takeoff-2', 'fly-1', 'fly-2', 'fly-3', 'fly-4', 'fly-5', 'fly-6', 'glide', 'flare-1', 'flare-2'];
    expect(closePoses.filter((p) => !drawn.bird.has(p))).toEqual([]);
  });
});
