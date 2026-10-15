/**
 * The shoreline wave cycle. Each wave rolls in as a swell, breaks, rushes up
 * the sand and drains back. Waves overlap, vary in size and shape along the
 * beach, and come bigger and faster when the weather is rough.
 */

export interface Wave {
  age: number;
  amplitude: number;
  seed: number;
  broke: boolean;
}

/** Seconds a swell takes to roll in before it breaks. */
export const APPROACH = 3.4;
/** Seconds the broken wave rushes up the beach. */
export const RUN_UP = 1.8;
/** Seconds the backwash takes to drain away. */
export const BACKWASH = 3.2;
const LIFETIME = APPROACH + RUN_UP + BACKWASH;

export interface BreakEvent {
  amplitude: number;
}

export class WaveModel {
  readonly waves: Wave[] = [];
  private nextIn = 1;

  constructor(private readonly rng: () => number = Math.random) {}

  /**
   * @param energy sea state 0 (calm) .. 1 (storm)
   * @returns waves that broke during this step
   */
  update(dt: number, energy: number): BreakEvent[] {
    const breaks: BreakEvent[] = [];
    this.nextIn -= dt;
    if (this.nextIn <= 0) {
      this.nextIn = (6 + this.rng() * 5) / (0.7 + 0.6 * energy);
      this.waves.push({
        age: 0,
        amplitude: (12 + this.rng() * 14) * (0.7 + 0.8 * energy),
        seed: this.rng() * 100,
        broke: false,
      });
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt;
      if (!w.broke && w.age >= APPROACH) {
        w.broke = true;
        breaks.push({ amplitude: w.amplitude });
      }
      if (w.age >= LIFETIME) this.waves.splice(i, 1);
    }
    return breaks;
  }

  /** How far (px) the water has run up the beach at column x. */
  runUp(x: number): number {
    let reach = 0;
    for (const w of this.waves) {
      const t = w.age - APPROACH;
      if (t < 0) continue;
      let profile: number;
      if (t < RUN_UP) {
        const p = t / RUN_UP;
        profile = 1 - (1 - p) * (1 - p); // fast rush, slowing at the top
      } else {
        const p = (t - RUN_UP) / BACKWASH;
        profile = 1 - p * p * (3 - 2 * p);
      }
      const shape = 0.75 + 0.18 * Math.sin(x * 0.013 + w.seed) + 0.07 * Math.sin(x * 0.041 + w.seed * 2);
      reach = Math.max(reach, w.amplitude * shape * profile);
    }
    return reach;
  }

  /** Is the water at column x currently rushing up (true) or draining back? */
  rushing(x: number): boolean {
    for (const w of this.waves) {
      const t = w.age - APPROACH;
      if (t >= 0 && t < RUN_UP && this.runUp(x) > 1) return true;
    }
    return false;
  }

  /** Approaching swells: progress 0 (horizon side) .. 1 (about to break). */
  swells(): number[] {
    return this.waves.filter((w) => w.age < APPROACH).map((w) => w.age / APPROACH);
  }

  /** Waves currently breaking, with how far through the break they are (0..1). */
  breakers(): Array<{ progress: number; amplitude: number; seed: number }> {
    return this.waves
      .filter((w) => w.age >= APPROACH && w.age < APPROACH + RUN_UP)
      .map((w) => ({ progress: (w.age - APPROACH) / RUN_UP, amplitude: w.amplitude, seed: w.seed }));
  }
}
