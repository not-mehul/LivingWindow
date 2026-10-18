import { BIRDSEED_MAX_ATTRACTION } from '../config';
import { Emitter } from '../core/Emitter';
import { clamp } from '../core/math';

export interface BirdseedEvents {
  change: { level: number; previous: number };
  filled: { level: number };
  depleted: Record<string, never>;
}

/** Visual fill stages for the bowl sprite: empty, low, half, full. */
export type BirdseedStage = 0 | 1 | 2 | 3;

/**
 * How much seed is in the windowsill bowl (0 = empty, 1 = full).
 *
 * Birds (Step 4) call `consume()` as they peck, and read `attraction` to bias
 * their choice of perch towards the foreground sill while seed remains.
 */
export class BirdseedState extends Emitter<BirdseedEvents> {
  private _level = 0;

  get level(): number {
    return this._level;
  }

  get isStocked(): boolean {
    return this._level > 0;
  }

  get isFull(): boolean {
    return this._level >= 1;
  }

  get stage(): BirdseedStage {
    if (this._level <= 0) return 0;
    if (this._level <= 1 / 3) return 1;
    if (this._level < 1) return 2;
    return 3;
  }

  /**
   * Multiplier for the probability that a bird chooses to visit the sill.
   * 1 when empty; jumps to half the max boost with any seed, rising to the
   * full boost when the bowl is full.
   */
  get attraction(): number {
    if (!this.isStocked) return 1;
    const boost = BIRDSEED_MAX_ATTRACTION - 1;
    return 1 + boost * (0.5 + 0.5 * this._level);
  }

  /** Pour seed into the bowl (defaults to filling it to the brim). */
  fill(amount = 1): boolean {
    if (this.isFull || amount <= 0) return false;
    this.setLevel(this._level + amount);
    this.emit('filled', { level: this._level });
    return true;
  }

  /** Remove seed (a bird pecking). Returns how much was actually eaten. */
  consume(amount: number): number {
    if (amount <= 0 || !this.isStocked) return 0;
    const eaten = Math.min(amount, this._level);
    this.setLevel(this._level - eaten);
    if (!this.isStocked) this.emit('depleted', {});
    return eaten;
  }

  private setLevel(value: number): void {
    const previous = this._level;
    // Snap tiny floating-point residue to an exact empty bowl.
    const next = clamp(value, 0, 1);
    this._level = next < 1e-6 ? 0 : next;
    if (this._level !== previous) this.emit('change', { level: this._level, previous });
  }
}
