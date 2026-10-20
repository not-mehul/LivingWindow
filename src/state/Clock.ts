import { TIME_SCALE } from '../config';
import { Emitter } from '../core/Emitter';
import { phaseAt, wrapHours, type DayPhase } from './timeOfDay';

export interface ClockEvents {
  /** The named phase of day changed (by time passing or by scrubbing). */
  phase: { phase: DayPhase; previous: DayPhase };
  /** The user set or scrubbed the time. */
  set: { hours: number };
  pause: { paused: boolean };
}

/**
 * Chronos: the window's clock. In fast mode it runs at 6× real time, so a
 * full day takes four real hours; in real-time mode it follows the wall clock
 * (read afresh each step, so a sleeping laptop or a background tab never
 * leaves it behind). Either way it can be frozen, and set to any time, after
 * which it carries on from there.
 */
export class Clock extends Emitter<ClockEvents> {
  private _hours: number;
  private _day = 0;
  private _paused = false;
  private _phase: DayPhase;
  /** Real-time mode: reads the wall clock (local hours). */
  private wall: (() => number) | null = null;
  /** In real-time mode, how far the shown time has been moved from the wall clock (hours). */
  private offset = 0;

  constructor(
    startHours = 9,
    private timeScale: number = TIME_SCALE,
  ) {
    super();
    this._hours = wrapHours(startHours);
    this._phase = phaseAt(this._hours);
  }

  /** Time of day in hours, [0, 24). */
  get hours(): number {
    return this._hours;
  }

  /** Whole simulated days elapsed since start. */
  get day(): number {
    return this._day;
  }

  get paused(): boolean {
    return this._paused;
  }

  get phase(): DayPhase {
    return this._phase;
  }

  /** Following the wall clock (and not moved off it). */
  get isRealTime(): boolean {
    return this.wall !== null;
  }

  /** Moved away from the wall clock in real-time mode. */
  get isOffset(): boolean {
    return this.wall !== null && Math.abs(this.offset) > 1 / 120;
  }

  /**
   * Follow the wall clock (`wall` gives local clock hours), or pass null to
   * run at `fastScale` times real time from wherever it is now.
   */
  setRealTime(wall: (() => number) | null, fastScale = TIME_SCALE): void {
    this.wall = wall;
    this.offset = 0;
    this.timeScale = wall ? 1 : fastScale;
    if (wall) this.setTime(wall(), false);
  }

  /** Back to the wall clock's time (real-time mode). */
  resetToNow(): void {
    if (!this.wall) return;
    this.offset = 0;
    this.setTime(this.wall());
  }

  /**
   * Advance by a real-time step. Returns how many simulated hours passed
   * (0 while paused), which drives slower systems such as the weather.
   */
  update(realDeltaSeconds: number): number {
    if (this._paused) return 0;
    if (this.wall) {
      const next = wrapHours(this.wall() + this.offset);
      const passed = wrapHours(next - this._hours);
      // A jump backwards (clocks going back) isn't time passing.
      if (passed > 12) {
        this._hours = next;
        this.checkPhase();
        return 0;
      }
      if (next < this._hours) this._day++;
      this._hours = next;
      this.checkPhase();
      return passed;
    }
    if (realDeltaSeconds <= 0) return 0;
    const simHours = (realDeltaSeconds * this.timeScale) / 3600;
    const next = this._hours + simHours;
    this._day += Math.floor(next / 24);
    this._hours = wrapHours(next);
    this.checkPhase();
    return simHours;
  }

  setTime(hours: number, announce = true): void {
    this._hours = wrapHours(hours);
    if (this.wall) this.offset = wrapOffset(this._hours - this.wall());
    if (announce) this.emit('set', { hours: this._hours });
    this.checkPhase();
  }

  setPaused(paused: boolean): void {
    if (paused === this._paused) return;
    this._paused = paused;
    // Resuming real time carries on from the paused moment.
    if (!paused && this.wall) this.offset = wrapOffset(this._hours - this.wall());
    this.emit('pause', { paused });
  }

  togglePaused(): void {
    this.setPaused(!this._paused);
  }

  private checkPhase(): void {
    const phase = phaseAt(this._hours);
    if (phase === this._phase) return;
    const previous = this._phase;
    this._phase = phase;
    this.emit('phase', { phase, previous });
  }
}

/** An offset in hours, folded into (-12, 12]. */
function wrapOffset(hours: number): number {
  const h = wrapHours(hours);
  return h > 12 ? h - 24 : h;
}
