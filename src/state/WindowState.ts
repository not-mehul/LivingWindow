import { WINDOW_TRANSITION_SECONDS } from '../config';
import { Emitter } from '../core/Emitter';
import { approach, easeInOutCubic } from '../core/math';

export interface WindowStateEvents {
  /** Fired the moment the user asks the window to open or close. */
  toggle: { open: boolean; durationSeconds: number };
  /** Fired once the sash finishes sliding. */
  settled: { open: boolean };
}

/**
 * Source of truth for whether the window is open.
 *
 * Other systems subscribe rather than poll: the sash view animates from
 * `openness`, the audio engine (Step 3) sweeps its low-pass filter on
 * `toggle`, and the weather system (Step 2) starts rain-on-glass once the
 * window is shut.
 */
export class WindowState extends Emitter<WindowStateEvents> {
  private target: boolean;
  /** Linear animation progress: 0 = fully closed, 1 = fully open. */
  private progress: number;

  constructor(
    initiallyOpen = true,
    readonly durationSeconds: number = WINDOW_TRANSITION_SECONDS,
  ) {
    super();
    this.target = initiallyOpen;
    this.progress = initiallyOpen ? 1 : 0;
  }

  /** The state the window is in, or is moving towards. */
  get isOpen(): boolean {
    return this.target;
  }

  /** True only when the sash has fully settled shut. */
  get isFullyClosed(): boolean {
    return !this.target && this.progress === 0;
  }

  get isAnimating(): boolean {
    return this.progress !== (this.target ? 1 : 0);
  }

  /** Eased openness for rendering: 0 = shut, 1 = raised out of the way. */
  get openness(): number {
    return easeInOutCubic(this.progress);
  }

  setOpen(open: boolean): void {
    if (open === this.target) return;
    this.target = open;
    this.emit('toggle', { open, durationSeconds: this.durationSeconds });
    if (this.durationSeconds <= 0) this.finish();
  }

  toggle(): void {
    this.setOpen(!this.target);
  }

  update(deltaSeconds: number): void {
    if (!this.isAnimating) return;
    if (this.durationSeconds <= 0) {
      this.finish();
      return;
    }
    const goal = this.target ? 1 : 0;
    this.progress = approach(this.progress, goal, deltaSeconds / this.durationSeconds);
    if (this.progress === goal) this.emit('settled', { open: this.target });
  }

  private finish(): void {
    this.progress = this.target ? 1 : 0;
    this.emit('settled', { open: this.target });
  }
}
