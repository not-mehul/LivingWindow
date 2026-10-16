import { FOCAL, type GroundPlane, type GroundPoint } from './groundPlane';

/** Where a walker may roam: a depth band, and a sideways limit at each depth. */
export interface WalkArea {
  minDepth: number;
  maxDepth: number;
  /** Largest |gx| allowed at a depth (ground px at depth 1). */
  halfWidth: (depth: number) => number;
}

export type Steering =
  | { kind: 'wander' }
  /** Head for a ground point. */
  | { kind: 'seek'; gx: number; depth: number }
  /** Leave by the nearest side of the panorama (ignores the area's sideways limit). */
  | { kind: 'exit'; side: -1 | 1 };

/**
 * A creature moving over a `GroundPlane` in two dimensions: sideways *and*
 * towards or away from the viewer. Speeds are in ground px per second at
 * depth 1, so the walker's apparent speed shrinks with distance. Each frame
 * `point` gives its world position and draw scale; sort by `point.y`.
 */
export class GroundWalker {
  gx: number;
  depth: number;
  /** Radians: 0 = moving right, π/2 = moving away from the viewer. */
  heading: number;
  speed = 0;
  steering: Steering = { kind: 'wander' };
  private turnRate = 0;

  constructor(
    private readonly plane: GroundPlane,
    readonly area: WalkArea,
    gx: number,
    depth: number,
    heading = 0,
    private readonly rng: () => number = Math.random,
  ) {
    this.gx = gx;
    this.depth = depth;
    this.heading = heading;
  }

  get point(): GroundPoint {
    return this.plane.project(this.gx, this.depth);
  }

  /** Which way the walker faces on screen: right (1) or left (−1). */
  get facing(): 1 | -1 {
    return Math.cos(this.heading) >= 0 ? 1 : -1;
  }

  /** True once an exiting walker is entirely off the panorama. */
  get gone(): boolean {
    const p = this.point;
    return this.steering.kind === 'exit' && (p.x < -60 || p.x > this.plane.vanishX * 2 + 60);
  }

  update(dt: number): void {
    const s = this.steering;
    if (s.kind === 'wander') {
      // A slowly wandering heading, nudged back inside the area near its edges.
      this.turnRate += (this.rng() - 0.5) * 2.2 * dt;
      this.turnRate *= Math.exp(-1.5 * dt);
      this.heading += this.turnRate * dt;
      this.steerInside(dt);
    } else if (s.kind === 'seek') {
      this.turnToward(Math.atan2((s.depth - this.depth) * FOCAL, s.gx - this.gx), 2.5, dt);
    } else {
      this.turnToward(s.side > 0 ? 0 : Math.PI, 3, dt);
    }
    this.gx += Math.cos(this.heading) * this.speed * dt;
    this.depth += (Math.sin(this.heading) * this.speed * dt) / FOCAL;
    this.depth = Math.min(this.area.maxDepth, Math.max(this.area.minDepth, this.depth));
    if (s.kind !== 'exit') {
      const limit = this.area.halfWidth(this.depth);
      this.gx = Math.min(limit, Math.max(-limit, this.gx));
    }
  }

  /** Distance (ground px at depth 1) to a seek target. */
  distanceTo(gx: number, depth: number): number {
    return Math.hypot(gx - this.gx, (depth - this.depth) * FOCAL);
  }

  private turnToward(target: number, rate: number, dt: number): void {
    let diff = target - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  private steerInside(dt: number): void {
    const { minDepth, maxDepth } = this.area;
    const limit = this.area.halfWidth(this.depth);
    const margin = 0.12;
    let pushX = 0;
    let pushZ = 0;
    if (this.gx > limit * (1 - margin)) pushX = -1;
    else if (this.gx < -limit * (1 - margin)) pushX = 1;
    const span = maxDepth - minDepth;
    if (this.depth > maxDepth - span * margin) pushZ = -1;
    else if (this.depth < minDepth + span * margin) pushZ = 1;
    if (pushX || pushZ) this.turnToward(Math.atan2(pushZ, pushX || Math.cos(this.heading)), 1.6, dt);
  }
}
