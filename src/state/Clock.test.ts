import { describe, expect, it, vi } from 'vitest';
import { Clock } from './Clock';
import { formatClock, phaseAt, PHASE_PRESETS } from './timeOfDay';

describe('Clock', () => {
  it('runs a full day in four real hours by default', () => {
    const clock = new Clock(0);
    const simHours = clock.update(4 * 3600);
    expect(simHours).toBeCloseTo(24);
    expect(clock.hours).toBeCloseTo(0);
    expect(clock.day).toBe(1);
  });

  it('advances one simulated hour per ten real minutes', () => {
    const clock = new Clock(9);
    clock.update(600);
    expect(clock.hours).toBeCloseTo(10);
  });

  it('freezes while paused and resumes from the same moment', () => {
    const clock = new Clock(17.5);
    clock.setPaused(true);
    expect(clock.update(1000)).toBe(0);
    expect(clock.hours).toBe(17.5);
    clock.setPaused(false);
    clock.update(60);
    expect(clock.hours).toBeCloseTo(17.6);
  });

  it('can be scrubbed to any time and carries on from there', () => {
    const clock = new Clock(12);
    const set = vi.fn();
    clock.on('set', set);
    clock.setTime(26.5);
    expect(clock.hours).toBe(2.5);
    expect(clock.phase).toBe('late-night');
    expect(set).toHaveBeenCalledWith({ hours: 2.5 });
    clock.update(600);
    expect(clock.hours).toBeCloseTo(3.5);
  });

  it('announces phase changes', () => {
    const clock = new Clock(18.4);
    const phase = vi.fn();
    clock.on('phase', phase);
    clock.update(120); // +0.2 sim hours → 18:36
    expect(phase).toHaveBeenCalledExactlyOnceWith({ phase: 'dusk', previous: 'golden-hour' });
  });
});

describe('time of day', () => {
  it('names the phases of the day', () => {
    expect(phaseAt(3)).toBe('late-night');
    expect(phaseAt(4.5)).toBe('night');
    expect(phaseAt(6)).toBe('dawn');
    expect(phaseAt(9)).toBe('morning');
    expect(phaseAt(13)).toBe('midday');
    expect(phaseAt(17.5)).toBe('golden-hour');
    expect(phaseAt(19)).toBe('dusk');
    expect(phaseAt(23)).toBe('night');
    expect(phaseAt(-1)).toBe('night');
  });

  it('places every preset inside its own phase', () => {
    for (const preset of PHASE_PRESETS) expect(phaseAt(preset.hours)).toBe(preset.phase);
  });

  it('formats a 24-hour clock', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(17.5)).toBe('17:30');
    expect(formatClock(23.999)).toBe('23:59');
    expect(formatClock(24)).toBe('00:00');
  });
});

describe('real-time clock', () => {
  it('follows the wall clock, however long between steps', () => {
    let wall = 8;
    const clock = new Clock(0);
    clock.setRealTime(() => wall);
    expect(clock.hours).toBe(8);
    wall = 8.5;
    expect(clock.update(0.016)).toBeCloseTo(0.5);
    expect(clock.hours).toBe(8.5);
    // Hours in a background tab: caught up at once.
    wall = 13;
    clock.update(0.016);
    expect(clock.hours).toBe(13);
  });

  it('keeps a scrubbed time moving with the wall clock, until reset', () => {
    let wall = 10;
    const clock = new Clock(0);
    clock.setRealTime(() => wall);
    clock.setTime(22);
    expect(clock.isOffset).toBe(true);
    wall = 11;
    clock.update(1);
    expect(clock.hours).toBeCloseTo(23);
    clock.resetToNow();
    expect(clock.hours).toBe(11);
    expect(clock.isOffset).toBe(false);
  });

  it('crosses midnight into a new day', () => {
    let wall = 23.9;
    const clock = new Clock(0);
    clock.setRealTime(() => wall);
    wall = 0.1;
    clock.update(1);
    expect(clock.day).toBe(1);
  });

  it('freezes while paused and carries on from there', () => {
    let wall = 9;
    const clock = new Clock(0);
    clock.setRealTime(() => wall);
    clock.setPaused(true);
    wall = 10;
    expect(clock.update(1)).toBe(0);
    expect(clock.hours).toBe(9);
    clock.setPaused(false);
    wall = 10.25;
    clock.update(1);
    expect(clock.hours).toBeCloseTo(9.25);
  });

  it('runs fast again from where it is', () => {
    const clock = new Clock(0);
    clock.setRealTime(() => 7);
    clock.setRealTime(null);
    clock.update(600);
    expect(clock.hours).toBeCloseTo(8);
  });
});
