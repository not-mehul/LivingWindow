/**
 * Rain and snow on the window pane, in glass art pixels.
 *
 * Drops land and sit; neighbours merge; once a drop is heavy enough it
 * breaks loose and runs down the glass, swallowing the drops in its path and
 * leaving a bead trail behind. Snowflakes stick and slowly melt into water.
 */

export interface GlassDrop {
  x: number;
  y: number;
  /** Rough diameter in art pixels. */
  size: number;
  vy: number;
  sliding: boolean;
  snow: boolean;
  /** Small bead left behind by a runner; evaporates on its own clock. */
  trail: boolean;
  age: number;
  life: number;
  /** Distance travelled since the last trail bead (runners only). */
  sinceTrail: number;
}

export interface GlassConditions {
  /** Rain intensity 0..1 (0 when it isn't raining). */
  rain: number;
  /** Snow intensity 0..1. */
  snow: number;
  /** Signed wind -1..1: runners drift with it a little. */
  wind: number;
  /** How much of the glass faces the weather: 1 closed, 0 fully raised. */
  exposure: number;
}

/** Impacts per second at full rain on a reference pane of 150,000 px². */
const RAIN_IMPACTS = 85;
const SNOW_IMPACTS = 45;
const REFERENCE_AREA = 150_000;
const MAX_SIZE = 5;
const SLIDE_START_SIZE = 2.6;
const SLIDE_STOP_SIZE = 1.8;
const CELL = 3;

export class GlassRainSim {
  readonly drops: GlassDrop[] = [];
  private width = 0;
  private height = 0;
  private rainBudget = 0;
  private snowBudget = 0;
  private readonly grid = new Map<number, GlassDrop>();

  constructor(
    private readonly rng: () => number = Math.random,
    public maxDrops = 700,
  ) {}

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.x < 0 || d.x >= width || d.y < 0 || d.y >= height) this.drops.splice(i, 1);
    }
  }

  update(dt: number, conditions: GlassConditions): void {
    if (this.width <= 0 || this.height <= 0 || dt <= 0) return;
    this.rebuildGrid();
    const areaScale = (this.width * this.height) / REFERENCE_AREA;

    this.rainBudget += dt * RAIN_IMPACTS * conditions.rain * conditions.exposure * areaScale;
    while (this.rainBudget >= 1) {
      this.rainBudget -= 1;
      this.impact(false);
    }
    this.snowBudget += dt * SNOW_IMPACTS * conditions.snow * conditions.exposure * areaScale;
    while (this.snowBudget >= 1) {
      this.snowBudget -= 1;
      this.impact(true);
    }

    const drying = conditions.rain <= 0.01;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.snow) {
        d.size -= dt * 0.12;
        if (d.size < 0.7) {
          // Most of a melting flake leaves a little bead of water.
          if (this.rng() < 0.4) {
            d.snow = false;
            d.size = 1;
          } else {
            this.remove(i);
          }
        }
        continue;
      }
      if (d.trail) {
        if (d.age >= d.life) this.remove(i);
        continue;
      }
      if (d.sliding) {
        if (this.slide(d, dt, conditions.wind)) this.remove(i);
        continue;
      }
      if (drying) d.size -= dt * 0.03;
      if (d.size < 0.6) {
        this.remove(i);
      } else if (d.size >= SLIDE_START_SIZE && this.rng() < (d.size - 2.4) * 0.6 * dt) {
        d.sliding = true;
        d.vy = 4;
        d.sinceTrail = 0;
      }
    }
  }

  private impact(snow: boolean): void {
    const x = Math.floor(this.rng() * this.width);
    const y = Math.floor(this.rng() * this.height);
    const size = snow ? 1 + this.rng() : 1.2 + this.rng() * 1.5;
    const existing = this.grid.get(this.key(x, y));
    if (existing && !existing.sliding && !existing.trail && existing.snow === snow) {
      existing.size = Math.min(MAX_SIZE, Math.hypot(existing.size, size));
      return;
    }
    if (this.drops.length >= this.maxDrops) return;
    const drop: GlassDrop = { x, y, size, vy: 0, sliding: false, snow, trail: false, age: 0, life: 0, sinceTrail: 0 };
    this.drops.push(drop);
    this.grid.set(this.key(x, y), drop);
  }

  /** Move a runner. Returns true when it has run off the bottom of the pane. */
  private slide(d: GlassDrop, dt: number, wind: number): boolean {
    const maxSpeed = 10 + d.size * 12;
    d.vy = Math.min(maxSpeed, d.vy + (8 + d.size * 10) * dt);
    const dy = d.vy * dt;
    d.y += dy;
    // Runners wander: surface tension snags them left or right now and then.
    if (this.rng() < dt * 3) d.x += this.rng() < 0.5 + wind * 0.3 ? 1 : -1;
    d.x = Math.max(0, Math.min(this.width - 1, d.x));
    if (d.y >= this.height) return true;

    // Swallow resting drops in the path.
    const hit = this.grid.get(this.key(d.x, d.y));
    if (hit && hit !== d && !hit.sliding && !hit.snow) {
      d.size = Math.min(MAX_SIZE, Math.hypot(d.size, hit.size));
      hit.size = 0; // removed on its own turn
      hit.trail = true;
      hit.life = 0;
    }

    d.sinceTrail += dy;
    if (d.sinceTrail >= 3 + this.rng() * 4) {
      d.sinceTrail = 0;
      d.size -= 0.07;
      if (this.drops.length < this.maxDrops) {
        this.drops.push({
          x: Math.round(d.x),
          y: Math.round(d.y - d.size),
          size: 0.8,
          vy: 0,
          sliding: false,
          snow: false,
          trail: true,
          age: 0,
          life: 3 + this.rng() * 7,
          sinceTrail: 0,
        });
      }
    }
    if (d.size < SLIDE_STOP_SIZE) d.sliding = false;
    return false;
  }

  private remove(index: number): void {
    const last = this.drops.length - 1;
    if (index !== last) this.drops[index] = this.drops[last];
    this.drops.pop();
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const d of this.drops) {
      if (!d.sliding) this.grid.set(this.key(d.x, d.y), d);
    }
  }

  private key(x: number, y: number): number {
    return Math.floor(y / CELL) * 4096 + Math.floor(x / CELL);
  }
}
