/** Seconds to lift the bowl away, or set it back down. */
export const BOWL_AWAY_SECONDS = 0.35;
/** Stepped fade, so it reads as pixel-art frames rather than a smooth blend. */
const STEPS = 4;

/**
 * Whether the seed bowl is on the sill. The sashes would knock it off, so
 * it's taken in while the window closes and set back once it's open again.
 */
export class BowlPresence {
  private target: boolean;
  private t: number;

  constructor(present = true) {
    this.target = present;
    this.t = present ? 1 : 0;
  }

  setPresent(present: boolean): void {
    this.target = present;
  }

  update(deltaSeconds: number): void {
    const step = deltaSeconds / BOWL_AWAY_SECONDS;
    this.t = this.target ? Math.min(1, this.t + step) : Math.max(0, this.t - step);
  }

  /** Fully on the sill: it can be filled and visited. */
  get present(): boolean {
    return this.target && this.t >= 1;
  }

  /** Any part of the lift/set-down animation is showing. */
  get visible(): boolean {
    return this.t > 0;
  }

  /** Opacity in whole steps (0, 0.25, … 1). */
  get alpha(): number {
    return Math.ceil(this.t * STEPS) / STEPS;
  }

  /** Art pixels lifted off the sill while moving. */
  get lift(): number {
    return Math.round((1 - this.t) * 4);
  }
}
