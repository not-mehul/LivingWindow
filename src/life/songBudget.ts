/**
 * How much the birds in view may sing between them. Each perched bird
 * chirps on its own whims, but a real flock doesn't call twice a second
 * without pause: songs come in bouts with quiet between. A token bucket
 * fills at `rate` calls a second (scaled by how lively the time of day is)
 * and holds up to `burst`, so a short exchange can happen, then a lull.
 */
export class SongBudget {
  private tokens: number;

  constructor(
    private readonly rate = 0.4,
    private readonly burst = 2.5,
  ) {
    this.tokens = burst;
  }

  /** `activity` 0..1: how much birds sing at this hour (a dawn chorus is 1). */
  tick(dt: number, activity: number): void {
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate * (0.3 + 0.7 * activity));
  }

  /** Spend a call if there's one to spend. */
  take(): boolean {
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
