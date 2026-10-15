import { describe, expect, it } from 'vitest';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import {
  centeredPan,
  clampPan,
  computeFrameScale,
  computeViewportLayout,
  panAfterResize,
} from './viewportLayout';

describe('computeViewportLayout', () => {
  it('shows the central 640×360 on a 16:9 monitor', () => {
    const layout = computeViewportLayout(1920, 1080);
    expect(layout.mode).toBe('cropped');
    expect(layout.scale).toBe(3);
    expect(layout.visibleWorldWidth).toBe(640);
    expect(layout.visibleWorldHeight).toBe(WORLD_HEIGHT);
    expect(layout.maxPanX).toBe(200);
    expect(centeredPan(layout)).toBe(100);
    expect(layout.opening).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('shows the entire panorama on a 21:9 ultrawide', () => {
    const layout = computeViewportLayout(3440, 1440);
    expect(layout.mode).toBe('panoramic');
    expect(layout.visibleWorldWidth).toBeCloseTo(WORLD_WIDTH);
    expect(layout.maxPanX).toBe(0);
    // Slightly wider than 21:9 → a sliver is cropped vertically, never letterboxed.
    expect(layout.visibleWorldHeight).toBeLessThanOrEqual(WORLD_HEIGHT);
    expect(layout.opening.width).toBe(3440);
  });

  it('pillarboxes a 32:9 super-ultrawide instead of over-cropping', () => {
    const layout = computeViewportLayout(5120, 1440);
    expect(layout.mode).toBe('pillarbox');
    expect(layout.visibleWorldWidth).toBeCloseTo(WORLD_WIDTH);
    expect(layout.visibleWorldHeight).toBeCloseTo(WORLD_HEIGHT * 0.8);
    expect(layout.opening.x).toBeGreaterThan(0);
    expect(layout.opening.x * 2 + layout.opening.width).toBeCloseTo(5120);
    expect(layout.maxPanX).toBe(0);
  });

  it('fits the height and pans horizontally on a portrait phone', () => {
    const layout = computeViewportLayout(390, 844, 3);
    expect(layout.mode).toBe('portrait');
    expect(layout.scale).toBeCloseTo(844 / WORLD_HEIGHT);
    expect(layout.visibleWorldHeight).toBeCloseTo(WORLD_HEIGHT);
    expect(layout.visibleWorldWidth).toBeCloseTo(390 / (844 / WORLD_HEIGHT));
    expect(layout.maxPanX).toBeCloseTo(WORLD_WIDTH - layout.visibleWorldWidth);
  });

  it('crops vertically around the configured focus', () => {
    const layout = computeViewportLayout(5120, 1440);
    const cropped = WORLD_HEIGHT - layout.visibleWorldHeight;
    expect(layout.cropY).toBeGreaterThan(0);
    expect(layout.cropY).toBeLessThan(cropped);
  });

  it('survives degenerate sizes', () => {
    const layout = computeViewportLayout(0, 0, 0);
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(layout.devicePixelRatio).toBe(1);
  });
});

describe('computeFrameScale', () => {
  it('uses whole device pixels per art pixel', () => {
    expect(computeFrameScale(3, 1)).toBe(3);
    expect(computeFrameScale(2.34, 1)).toBe(2);
    expect(computeFrameScale(2.34, 3)).toBeCloseTo(7 / 3);
    expect(computeFrameScale(0.2, 1)).toBe(1);
    for (const [scale, dpr] of [
      [2.7, 1.25],
      [3.9, 2],
      [1.1, 1.5],
    ]) {
      const devicePixels = computeFrameScale(scale, dpr) * dpr;
      expect(devicePixels).toBeCloseTo(Math.round(devicePixels));
    }
  });
});

describe('panning', () => {
  it('clamps to the panorama bounds', () => {
    const layout = computeViewportLayout(1920, 1080);
    expect(clampPan(-50, layout)).toBe(0);
    expect(clampPan(999, layout)).toBe(200);
    expect(clampPan(42, layout)).toBe(42);
  });

  it('keeps the same world point centred across a rotation', () => {
    const landscape = computeViewportLayout(844, 390);
    const portrait = computeViewportLayout(390, 844);
    const pan = 60;
    const center = pan + landscape.visibleWorldWidth / 2;
    const next = panAfterResize(pan, landscape, portrait);
    expect(next + portrait.visibleWorldWidth / 2).toBeCloseTo(center);
  });

  it('collapses to zero when the whole panorama fits', () => {
    const cropped = computeViewportLayout(1920, 1080);
    const ultrawide = computeViewportLayout(3440, 1440);
    expect(panAfterResize(150, cropped, ultrawide)).toBe(0);
  });
});
