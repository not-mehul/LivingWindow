/**
 * Watches the frame rate and drops to a lighter mode on devices that
 * struggle: the beach water redraws less often, fewer raindrops fall and
 * fewer drops collect on the glass. `?quality=low` or `?quality=high` in the
 * URL forces a mode.
 */
export type QualityLevel = 'high' | 'low';

const SLOW_FRAME_MS = 30;
const FAST_FRAME_MS = 19;
const DOWNGRADE_AFTER = 4;
const UPGRADE_AFTER = 15;

export class QualityMonitor {
  private _level: QualityLevel = 'high';
  private readonly forced: QualityLevel | null;
  private average = 16;
  private slowFor = 0;
  private fastFor = 0;

  constructor(search = typeof location === 'undefined' ? '' : location.search) {
    const param = new URLSearchParams(search).get('quality');
    this.forced = param === 'low' || param === 'high' ? param : null;
    if (this.forced) this._level = this.forced;
  }

  get level(): QualityLevel {
    return this._level;
  }

  /** Multiplier for particle counts and other per-frame work. */
  get scale(): number {
    return this._level === 'high' ? 1 : 0.5;
  }

  /** Feed one frame's real duration. */
  sample(frameMs: number): void {
    if (this.forced) return;
    // Ignore huge gaps (a background tab), they aren't a sign of slowness.
    if (frameMs > 250) return;
    this.average += (frameMs - this.average) * 0.05;
    const seconds = frameMs / 1000;
    if (this.average > SLOW_FRAME_MS) {
      this.slowFor += seconds;
      this.fastFor = 0;
    } else if (this.average < FAST_FRAME_MS) {
      this.fastFor += seconds;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this._level === 'high' && this.slowFor > DOWNGRADE_AFTER) {
      this._level = 'low';
      this.slowFor = 0;
    } else if (this._level === 'low' && this.fastFor > UPGRADE_AFTER) {
      this._level = 'high';
      this.fastFor = 0;
    }
  }
}

/** The app-wide monitor. */
export const quality = new QualityMonitor();

/** True when the viewer has asked their OS for less motion (we soften lightning). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
