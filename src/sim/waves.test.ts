import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { School } from './boids';
import { APPROACH, WaveModel } from './waves';

function run(model: WaveModel, seconds: number, energy = 0.3, dt = 0.05) {
  let breaks = 0;
  for (let t = 0; t < seconds; t += dt) breaks += model.update(dt, energy).length;
  return breaks;
}

describe('WaveModel', () => {
  it('breaks a wave every several seconds', () => {
    const model = new WaveModel(createRng(1));
    const breaks = run(model, 120);
    expect(breaks).toBeGreaterThan(8);
    expect(breaks).toBeLessThan(25);
  });

  it('sends bigger, more frequent waves in a storm', () => {
    const calm = new WaveModel(createRng(2));
    const storm = new WaveModel(createRng(2));
    expect(run(storm, 200, 1)).toBeGreaterThan(run(calm, 200, 0));
  });

  it('runs water up the sand after a break and drains it again', () => {
    const model = new WaveModel(createRng(3));
    let peak = 0;
    let rushed = false;
    for (let t = 0; t < 30; t += 0.05) {
      model.update(0.05, 0.4);
      peak = Math.max(peak, model.runUp(300));
      rushed ||= model.rushing(300);
    }
    expect(peak).toBeGreaterThan(5);
    expect(rushed).toBe(true);
    // Keep running with no new waves... eventually a lull leaves the sand dry.
    const runUps = [];
    for (let t = 0; t < 60; t += 0.05) {
      model.update(0.05, 0.4);
      runUps.push(model.runUp(300));
    }
    expect(Math.min(...runUps)).toBeLessThan(1);
    expect(Math.max(...runUps)).toBeLessThan(50);
  });

  it('reports swells approaching before they break', () => {
    const model = new WaveModel(createRng(4));
    model.update(1.2, 0.3);
    model.update(APPROACH / 2, 0.3);
    const swells = model.swells();
    expect(swells.length).toBeGreaterThan(0);
    for (const s of swells) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });
});

describe('School (boids)', () => {
  const bounds = { x0: 100, x1: 300, y0: 260, y1: 280 };

  it('stays together inside the shallows', () => {
    const school = new School(20, bounds, createRng(5));
    for (let i = 0; i < 2000; i++) school.update(1 / 30);
    for (const f of school.fish) {
      expect(f.x).toBeGreaterThan(bounds.x0 - 30);
      expect(f.x).toBeLessThan(bounds.x1 + 30);
      expect(f.y).toBeGreaterThanOrEqual(bounds.y0 - 2);
      expect(f.y).toBeLessThanOrEqual(bounds.y1 + 2);
    }
    const c = school.centre;
    const spread = Math.max(...school.fish.map((f) => Math.hypot(f.x - c.x, f.y - c.y)));
    expect(spread).toBeLessThan(60);
  });

  it('scatters away from a predator', () => {
    const school = new School(20, bounds, createRng(6));
    for (let i = 0; i < 300; i++) school.update(1 / 30);
    const c = school.centre;
    const before = school.fish.reduce((s, f) => s + Math.hypot(f.x - c.x, f.y - c.y), 0);
    school.scare(c.x, c.y);
    expect(school.panicking).toBe(true);
    for (let i = 0; i < 20; i++) school.update(1 / 30);
    const after = school.fish.reduce((s, f) => s + Math.hypot(f.x - c.x, f.y - c.y), 0);
    expect(after).toBeGreaterThan(before * 1.3);
    for (let i = 0; i < 120; i++) school.update(1 / 30);
    expect(school.panicking).toBe(false);
  });
});
