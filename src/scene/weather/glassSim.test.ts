import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/random';
import { GlassRainSim } from './glassSim';

const dry = { rain: 0, snow: 0, wind: 0, exposure: 1 };

function step(sim: GlassRainSim, seconds: number, conditions: typeof dry, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) sim.update(dt, conditions);
}

describe('GlassRainSim', () => {
  it('only collects rain when the glass is exposed', () => {
    const open = new GlassRainSim(createRng(1));
    open.resize(400, 300);
    step(open, 5, { ...dry, rain: 1, exposure: 0 });
    expect(open.drops.length).toBe(0);

    const closed = new GlassRainSim(createRng(1));
    closed.resize(400, 300);
    step(closed, 5, { ...dry, rain: 1 });
    expect(closed.drops.length).toBeGreaterThan(50);
  });

  it('keeps drops on the pane and under the cap', () => {
    const sim = new GlassRainSim(createRng(2), 300);
    sim.resize(300, 200);
    step(sim, 60, { ...dry, rain: 1, wind: 1 });
    expect(sim.drops.length).toBeLessThanOrEqual(300);
    for (const d of sim.drops) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(300);
      expect(d.y).toBeLessThan(200);
    }
  });

  it('grows runners that slide down and leave bead trails', () => {
    const sim = new GlassRainSim(createRng(3));
    sim.resize(200, 400);
    let sawRunner = false;
    let sawTrail = false;
    for (let t = 0; t < 40; t += 1 / 30) {
      sim.update(1 / 30, { ...dry, rain: 1 });
      sawRunner ||= sim.drops.some((d) => d.sliding);
      sawTrail ||= sim.drops.some((d) => d.trail);
    }
    expect(sawRunner).toBe(true);
    expect(sawTrail).toBe(true);
  });

  it('dries off once the rain stops', () => {
    const sim = new GlassRainSim(createRng(4));
    sim.resize(300, 200);
    step(sim, 10, { ...dry, rain: 1 });
    expect(sim.drops.length).toBeGreaterThan(0);
    step(sim, 200, dry, 0.25);
    expect(sim.drops.length).toBe(0);
  });

  it('sticks snowflakes that melt away', () => {
    const sim = new GlassRainSim(createRng(5));
    sim.resize(300, 200);
    step(sim, 5, { ...dry, snow: 1 });
    expect(sim.drops.some((d) => d.snow)).toBe(true);
    step(sim, 40, dry, 0.25);
    expect(sim.drops.some((d) => d.snow)).toBe(false);
  });

  it('discards drops outside a smaller pane after resizing', () => {
    const sim = new GlassRainSim(createRng(6));
    sim.resize(400, 300);
    step(sim, 5, { ...dry, rain: 1 });
    sim.resize(100, 100);
    expect(sim.drops.every((d) => d.x < 100 && d.y < 100)).toBe(true);
  });
});
