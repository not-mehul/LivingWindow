import { describe, expect, it } from 'vitest';
import type { BirdPose } from './birdSprites';
import { CLOSE_SPECIES, drawBirdClose, FLAP_CYCLE_6 } from './birdClose';

const key = (species: Parameters<typeof drawBirdClose>[0], pose: BirdPose, n: number) => Array.from(drawBirdClose(species, pose, n).grid.data).join(',');

describe('birds up close', () => {
  const standing: BirdPose[] = ['idle', 'idle-breathe', 'blink', 'tilt', 'look-up', 'look-back', 'fluff', 'preen-1', 'preen-2', 'scratch-1', 'scratch-2', 'tail-flick', 'hop-crouch', 'hop-air', 'hop-land', 'peck-reach', 'peck-down', 'peck-swallow', 'chirp', 'chirp-2', 'takeoff-1'];

  it('draws every species in every pose, each one different', () => {
    for (const species of CLOSE_SPECIES) {
      const frames = standing.map((p) => key(species, p, 32));
      expect(new Set(frames).size).toBe(standing.length);
      for (const f of frames) expect(f.split(',').filter((v) => v !== '0').length).toBeGreaterThan(150);
    }
  });

  it('beats its wings through six distinct frames, and flares to land', () => {
    for (const species of ['sparrow', 'seagull', 'pigeon'] as const) {
      const beats = FLAP_CYCLE_6.map((p) => key(species, p, 36));
      expect(new Set(beats).size).toBe(6);
      expect(key(species, 'flare-1', 36)).not.toBe(key(species, 'flare-2', 36));
    }
  });
});
