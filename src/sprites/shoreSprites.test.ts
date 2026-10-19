import { describe, expect, it } from 'vitest';
import { drawHatchling, drawJellyfish, drawPelican, HATCHLING_FRAMES, JELLY_FRAMES } from './beachSprites';
import type { Drawn } from './kit';
import { drawEgret, drawFrigatebird, drawGull, drawJumpFish, drawSandpiper, JUMP_FRAMES, SANDPIPER_FLY, SANDPIPER_RUN, type EgretPose, type GullPose } from './shoreSprites';

const filled = (d: Drawn) => Array.from(d.grid.data).filter((v) => v !== 0).length;
const key = (d: Drawn) => Array.from(d.grid.data).join(',');

describe('shore sprites', () => {
  it('give the sandpiper a real run and wingbeat: every frame different', () => {
    for (const cycle of [SANDPIPER_RUN, SANDPIPER_FLY]) {
      const frames = cycle.map((pose) => drawSandpiper(pose, 18));
      expect(new Set(frames.map(key)).size).toBe(cycle.length);
      for (const f of frames) expect(filled(f)).toBeGreaterThan(40);
    }
  });

  it('draw every gull and egret pose, at every size', () => {
    const gulls: GullPose[] = ['stand', 'call', 'stretch', 'float', 'float-dip', 'hover-0', 'hover-1', 'tug-0', 'tug-1', 'glide', 'flap-up', 'flap-down'];
    const egrets: EgretPose[] = ['stand', 'step-0', 'step-1', 'crouch', 'strike', 'fly-0', 'fly-1'];
    for (const n of [8, 16, 26]) {
      const g = gulls.map((p) => drawGull(p, n));
      for (const d of g) expect(filled(d)).toBeGreaterThan(n);
      expect(new Set(g.map(key)).size).toBe(gulls.length);
      for (const p of egrets) expect(filled(drawEgret(p, n + 10))).toBeGreaterThan(n);
    }
  });

  it('pulse the jellyfish, row the hatchling and flex the frigatebird', () => {
    expect(new Set(Array.from({ length: JELLY_FRAMES }, (_, f) => key(drawJellyfish(f, 12)))).size).toBe(JELLY_FRAMES);
    expect(new Set(Array.from({ length: HATCHLING_FRAMES }, (_, f) => key(drawHatchling(f, 10)))).size).toBe(HATCHLING_FRAMES);
    expect(key(drawFrigatebird(0, 16))).not.toBe(key(drawFrigatebird(1, 16)));
    expect(new Set(Array.from({ length: JUMP_FRAMES }, (_, f) => key(drawJumpFish(f, 8)))).size).toBe(JUMP_FRAMES);
  });

  it("shakes the pelican's pouch", () => {
    expect(key(drawPelican('pouch-0', 36))).not.toBe(key(drawPelican('pouch-1', 36)));
    expect(filled(drawPelican('flap-mid', 36))).toBeGreaterThan(100);
  });
});
