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
 * Chronos: the simulated wall clock. By default it runs at 6× real time, so a
 * full day takes four real hours. It can be frozen, and set to any time, after
 * which it carries on from there.
 */
export class Clock extends Emitter<ClockEvents> {
  private _hours: number;
  private _day = 0;
  private _paused = false;
  private _phase: DayPhase;

  constructor(
    startHours = 9,
    readonly timeScale: number = TIME_SCALE,
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

  /**
   * Advance by a real-time step. Returns how many simulated hours passed
   * (0 while paused), which drives slower systems such as the weather.
   */
  update(realDeltaSeconds: number): number {
    if (this._paused || realDeltaSeconds <= 0) return 0;
    const simHours = (realDeltaSeconds * this.timeScale) / 3600;
    const next = this._hours + simHours;
    this._day += Math.floor(next / 24);
    this._hours = wrapHours(next);
    this.checkPhase();
    return simHours;
  }

  setTime(hours: number): void {
    this._hours = wrapHours(hours);
    this.emit('set', { hours: this._hours });
    this.checkPhase();
  }

  setPaused(paused: boolean): void {
    if (paused === this._paused) return;
    this._paused = paused;
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
