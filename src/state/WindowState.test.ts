import { describe, expect, it, vi } from 'vitest';
import { WindowState } from './WindowState';

describe('WindowState', () => {
  it('starts open and settled by default', () => {
    const state = new WindowState();
    expect(state.isOpen).toBe(true);
    expect(state.openness).toBe(1);
    expect(state.isAnimating).toBe(false);
  });

  it('slides shut over the transition duration', () => {
    const state = new WindowState(true, 0.6);
    const settled = vi.fn();
    state.on('settled', settled);
    state.toggle();
    expect(state.isOpen).toBe(false);
    expect(state.isAnimating).toBe(true);

    state.update(0.3);
    expect(state.openness).toBeCloseTo(0.5);
    expect(state.isFullyClosed).toBe(false);
    expect(settled).not.toHaveBeenCalled();

    state.update(0.3);
    expect(state.openness).toBe(0);
    expect(state.isFullyClosed).toBe(true);
    expect(settled).toHaveBeenCalledExactlyOnceWith({ open: false });
  });

  it('emits toggle with the duration so audio can sweep in sync', () => {
    const state = new WindowState(true, 0.6);
    const toggle = vi.fn();
    state.on('toggle', toggle);
    state.setOpen(false);
    state.setOpen(false); // no-op: already closing
    expect(toggle).toHaveBeenCalledExactlyOnceWith({ open: false, durationSeconds: 0.6 });
  });

  it('reverses smoothly when toggled mid-slide', () => {
    const state = new WindowState(true, 1);
    state.toggle();
    state.update(0.25);
    const midway = state.openness;
    state.toggle();
    expect(state.openness).toBe(midway);
    state.update(0.25);
    expect(state.openness).toBe(1);
    expect(state.isAnimating).toBe(false);
  });

  it('eases rather than moving linearly', () => {
    const state = new WindowState(false, 1);
    state.toggle();
    state.update(0.1);
    expect(state.openness).toBeLessThan(0.1);
  });

  it('snaps instantly with a zero duration', () => {
    const state = new WindowState(true, 0);
    const settled = vi.fn();
    state.on('settled', settled);
    state.toggle();
    expect(state.openness).toBe(0);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('supports unsubscribing', () => {
    const state = new WindowState(true, 0);
    const listener = vi.fn();
    const off = state.on('toggle', listener);
    off();
    state.toggle();
    expect(listener).not.toHaveBeenCalled();
  });
});
