/**
 * A school of fish following classic boids rules — stay together, swim
 * the same way, don't collide — inside a band of shallow water, with a
 * slowly wandering centre and a strong urge to flee predators.
 */

export interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SchoolBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface Threat {
  x: number;
  y: number;
  life: number;
}

const MAX_SPEED = 22;
const PANIC_SPEED = 55;
const NEIGHBOUR = 14;
const SEPARATION = 3.5;
const THREAT_RADIUS = 50;

export class School {
  readonly fish: Fish[] = [];
  /** Where the school as a whole is drifting towards. */
  goal: { x: number; y: number };
  private readonly threats: Threat[] = [];
  private goalTimer = 0;

  constructor(
    count: number,
    public bounds: SchoolBounds,
    private readonly rng: () => number = Math.random,
  ) {
    const cx = (bounds.x0 + bounds.x1) / 2;
    const cy = (bounds.y0 + bounds.y1) / 2;
    this.goal = { x: cx, y: cy };
    for (let i = 0; i < count; i++) {
      this.fish.push({
        x: cx + (rng() - 0.5) * 30,
        y: cy + (rng() - 0.5) * 8,
        vx: (rng() - 0.5) * 10,
        vy: (rng() - 0.5) * 4,
      });
    }
  }

  get centre(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const f of this.fish) {
      x += f.x;
      y += f.y;
    }
    return { x: x / this.fish.length, y: y / this.fish.length };
  }

  /** Something dangerous splashed down here (a diving gull). */
  scare(x: number, y: number): void {
    this.threats.push({ x, y, life: 2.5 });
  }

  get panicking(): boolean {
    return this.threats.length > 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const { bounds, rng } = this;
    this.goalTimer -= dt;
    if (this.goalTimer <= 0) {
      this.goalTimer = 4 + rng() * 6;
      this.goal = {
        x: bounds.x0 + 20 + rng() * (bounds.x1 - bounds.x0 - 40),
        y: bounds.y0 + 2 + rng() * (bounds.y1 - bounds.y0 - 4),
      };
    }
    for (let i = this.threats.length - 1; i >= 0; i--) {
      this.threats[i].life -= dt;
      if (this.threats[i].life <= 0) this.threats.splice(i, 1);
    }

    for (const f of this.fish) {
      let cx = 0;
      let cy = 0;
      let ax = 0;
      let ay = 0;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const o of this.fish) {
        if (o === f) continue;
        const dx = o.x - f.x;
        const dy = o.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d > NEIGHBOUR) continue;
        n++;
        cx += o.x;
        cy += o.y;
        ax += o.vx;
        ay += o.vy;
        if (d < SEPARATION && d > 0.001) {
          sx -= dx / d;
          sy -= dy / d;
        }
      }
      let fx = 0;
      let fy = 0;
      if (n > 0) {
        fx += (cx / n - f.x) * 0.9 + (ax / n - f.vx) * 0.6;
        fy += (cy / n - f.y) * 0.9 + (ay / n - f.vy) * 0.6;
      }
      fx += sx * 14;
      fy += sy * 14;
      // Drift with the school's goal.
      fx += (this.goal.x - f.x) * 0.25;
      fy += (this.goal.y - f.y) * 0.35;
      // Flee threats.
      let panic = false;
      for (const t of this.threats) {
        const dx = f.x - t.x;
        const dy = f.y - t.y;
        const d = Math.hypot(dx, dy);
        if (d < THREAT_RADIUS) {
          panic = true;
          const push = (1 - d / THREAT_RADIUS) * 260 * Math.min(1, t.life);
          fx += (dx / (d || 1)) * push;
          fy += (dy / (d || 1)) * push * 0.4;
        }
      }
      // Keep to the band of shallow water.
      if (f.x < bounds.x0) fx += (bounds.x0 - f.x) * 4;
      if (f.x > bounds.x1) fx -= (f.x - bounds.x1) * 4;
      if (f.y < bounds.y0) fy += (bounds.y0 - f.y) * 6;
      if (f.y > bounds.y1) fy -= (f.y - bounds.y1) * 6;

      f.vx += fx * dt;
      f.vy += fy * dt;
      const speed = Math.hypot(f.vx, f.vy);
      const limit = panic ? PANIC_SPEED : MAX_SPEED;
      if (speed > limit) {
        f.vx = (f.vx / speed) * limit;
        f.vy = (f.vy / speed) * limit;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // Never leave the water, even in a panic.
      f.y = Math.min(bounds.y1 + 2, Math.max(bounds.y0 - 2, f.y));
    }
  }
}
