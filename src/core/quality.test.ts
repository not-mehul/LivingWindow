import { describe, expect, it } from 'vitest';
import { QualityMonitor } from './quality';

function feed(monitor: QualityMonitor, ms: number, seconds: number) {
  for (let t = 0; t < seconds * 1000; t += ms) monitor.sample(ms);
}

describe('QualityMonitor', () => {
  it('stays high on a smooth 60 fps', () => {
    const q = new QualityMonitor('');
    feed(q, 16.7, 30);
    expect(q.level).toBe('high');
    expect(q.scale).toBe(1);
  });

  it('drops to low after a few seconds of struggling, and recovers', () => {
    const q = new QualityMonitor('');
    feed(q, 45, 10);
    expect(q.level).toBe('low');
    expect(q.scale).toBe(0.5);
    feed(q, 16.7, 30);
    expect(q.level).toBe('high');
  });

  it('ignores a single long pause, like returning to a background tab', () => {
    const q = new QualityMonitor('');
    feed(q, 16.7, 2);
    q.sample(5000);
    feed(q, 16.7, 2);
    expect(q.level).toBe('high');
  });

  it('honours ?quality= in the URL', () => {
    const q = new QualityMonitor('?quality=low');
    feed(q, 10, 30);
    expect(q.level).toBe('low');
  });
});
