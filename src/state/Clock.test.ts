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
