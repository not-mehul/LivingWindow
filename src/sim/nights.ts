/**
 * Names each simulated night — the real date plus how many times the clock
 * has passed noon since the page opened — so per-night events (fireworks,
 * a glowing sea, a hatching nest) are decided once and stay put all night.
 */
export class NightKey {
  private evening = 0;
  private lastHours = -1;
  private current = '';

  constructor(private readonly dayKey: () => string = () => new Date().toDateString()) {}

  /** Advance with the clock; returns tonight's key. */
  update(hours: number): string {
    if (this.lastHours < 0 || (this.lastHours < 12 && hours >= 12)) {
      if (this.lastHours >= 0) this.evening++;
      this.current = `${this.dayKey()}#${this.evening}`;
    }
    this.lastHours = hours;
    return this.current;
  }

  get key(): string {
    return this.current;
  }
}
