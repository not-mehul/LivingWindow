import { Container, Graphics, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { BUNCHED, flockSpot, groundDistance, LOOSE, screenGap, type FlockSpread, type GroundSpot } from '../../sim/flock';
import { FOCAL, type GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { chance, fliesOut } from '../../sim/interplay';
import { cowsResting, sheepdogTime } from '../../sim/wildlife';
import { drawDogSized, drawHorseSized, drawSheepSized, HORSE_WALK, SHEEP_WALK, type DogPose, type HorsePose, type SheepPose } from '../../sprites/meadowSprites';
import { DrawnCache } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { evenSize } from '../../sprites/kit';

/** Heights (world px) at depth 1. */
const SHEEP_HEIGHT = 30;
const DOG_HEIGHT = 24;
const HORSE_HEIGHT = 66;

// --- The flock and its dog ----------------------------------------------------------

type SheepState = 'graze' | 'walk' | 'lie' | 'flee';

interface Sheep {
  walker: GroundWalker;
  state: SheepState;
  timer: number;
  /** Where it's strolling to, or grazing. */
  spot: GroundSpot;
  /** Its place in the bunch when the dog's working them (offset from the flock's middle). */
  tight: GroundSpot;
  stride: number;
  sprite: Sprite;
  /** Lambs keep close to their mothers and are smaller. */
  mother?: Sheep;
  size: number;
}

/** Where the flock grazes: the left of the pasture, among the oaks. */
const FLOCK_AREA = { gx0: -460, gx1: -40, depth0: 1.45, depth1: 3.3 };
/** How far a sheep strolls to a fresh mouthful (ground px). */
const STROLL = 220;

/**
 * A small flock of sheep and a lamb or two, scattered loosely across the
 * grass: each grazes its own patch, wanders off to a fresh one now and then,
 * and keeps a little apart from the others, while the flock as a whole
 * drifts slowly. They lie down at night and bleat now and then. Through the
 * day the sheepdog is sent round them: it races out in a wide arc, drops to
 * a crouch, and the flock bunches up and moves off ahead of it, spreading out
 * again over the next minute or two once it's gone.
 */
export class SheepFlock {
  private readonly sheep: Sheep[] = [];
  private readonly sprites = new DrawnCache();
  private centre = { gx: -250, depth: 2.3 };
  private centreTarget = { gx: -250, depth: 2.3 };
  private retarget = r(20, 40);
  private baaTimer = r(8, 20);
  /** Bunched up by a fright (thunder overhead) with no dog to do it. */
  private alarmed = 0;
  readonly dog: Sheepdog;

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
    count = 6,
  ) {
    const lambs = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < count + lambs; i++) {
      const mother = i >= count ? this.sheep[i - count] : undefined;
      const spot = mother
        ? { gx: mother.spot.gx + r(-14, 14), depth: mother.spot.depth + r(-0.04, 0.04) }
        : (this.pickSpot(null, Infinity, LOOSE) ?? { ...this.centre });
      const w = new GroundWalker(plane, area, spot.gx, spot.depth, Math.random() * Math.PI * 2);
      w.obstacles = obstacles;
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      container.addChild(sprite);
      const tight = { gx: r(-BUNCHED.gx, BUNCHED.gx), depth: r(-BUNCHED.depth, BUNCHED.depth) };
      this.sheep.push({ walker: w, state: 'graze', timer: r(1, 12), spot, tight, stride: Math.random() * 4, sprite, mother, size: mother ? r(0.58, 0.66) : r(0.94, 1.06) });
    }
    this.dog = new Sheepdog(container, plane, area, obstacles, () => this.centre, viewport, sound, () => {
      // A sheep answers the dog's boof.
      this.baaTimer = Math.min(this.baaTimer, r(0.4, 1.2));
    });
  }

  /** Bunch up tight where they stand, as if the dog were on them (a clap of thunder overhead). */
  startle(): void {
    this.alarmed = r(18, 32);
    this.baaTimer = Math.min(this.baaTimer, r(0.3, 1));
  }

  /** Bunched up, by the dog or a fright. */
  get bunched(): boolean {
    return this.dog.herding || this.alarmed > 0;
  }

  /** The middle of the flock. */
  get middle(): GroundSpot {
    return { ...this.centre };
  }

  get count(): number {
    return this.sheep.length;
  }

  /** How many are on their feet and moving off from the dog. */
  get fleeing(): number {
    return this.sheep.filter((s) => s.state === 'flee').length;
  }

  /** Where each one is on the ground (for tests and the debug view). */
  get positions(): GroundSpot[] {
    return this.sheep.map((s) => ({ gx: s.walker.gx, depth: s.walker.depth }));
  }

  update(dt: number, env: Environment): void {
    const resting = cowsResting(env.lighting.hours);
    // The flock's middle drifts slowly across the grass.
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = r(40, 90);
      this.centreTarget = { gx: r(FLOCK_AREA.gx0 + 60, FLOCK_AREA.gx1 - 60), depth: r(FLOCK_AREA.depth0 + 0.35, FLOCK_AREA.depth1 - 0.35) };
    }
    const dog = this.dog.position;
    if (dog && this.dog.herding) {
      // Pushed away from the dog, judged as it looks on screen.
      const dx = (this.centre.gx - dog.gx) / LOOSE.gx;
      const dz = (this.centre.depth - dog.depth) / LOOSE.depth;
      const d = Math.hypot(dx, dz) || 1;
      // Kept off the edges of their grass: hemmed in, they slip along it instead.
      this.centreTarget = {
        gx: Math.max(FLOCK_AREA.gx0 + 50, Math.min(FLOCK_AREA.gx1 - 50, this.centre.gx + (dx / d) * 90)),
        depth: Math.max(FLOCK_AREA.depth0 + 0.25, Math.min(FLOCK_AREA.depth1 - 0.25, this.centre.depth + (dz / d) * 0.35)),
      };
    }
    const k = Math.min(1, dt * (this.dog.herding ? 0.6 : 0.03));
    this.centre.gx += (this.centreTarget.gx - this.centre.gx) * k;
    this.centre.depth += (this.centreTarget.depth - this.centre.depth) * k;

    if (this.alarmed > 0) this.alarmed -= dt;
    for (const s of this.sheep) this.step(s, dt, resting);
    this.dog.update(dt, env);

    this.baaTimer -= dt;
    if (this.baaTimer <= 0) {
      this.baaTimer = this.bunched ? r(1.5, 4) : r(12, 35);
      const s = this.sheep[Math.floor(Math.random() * this.sheep.length)];
      if (!resting || Math.random() < 0.2) this.sound('sheep-baa', this.viewport.worldXToStereo(s.walker.point.x), (0.4 + 0.4 * (1 - s.walker.point.scale)) * (s.mother ? 0.7 : 1));
    }
    const tint = env.lighting.ambient;
    for (const s of this.sheep) this.draw(s, tint);
  }

  /** A fresh patch near the flock's middle, within `reach` of where `s` stands, clear of the others. */
  private pickSpot(s: Sheep | null, reach: number, spread: FlockSpread): GroundSpot | null {
    const others = this.sheep.filter((o) => o !== s && !o.mother).map((o) => (o.state === 'walk' ? o.spot : { gx: o.walker.gx, depth: o.walker.depth }));
    const from = s ? { gx: s.walker.gx, depth: s.walker.depth } : null;
    return flockSpot(this.plane, this.centre, others, spread, FLOCK_AREA, (gx, depth) => GroundWalker.blocked(this.obstacles, gx, depth, 6) || (from !== null && groundDistance(from, { gx, depth }) > reach));
  }

  private step(s: Sheep, dt: number, resting: boolean): void {
    const w = s.walker;
    s.timer -= dt;
    const herding = this.bunched;
    if (herding) {
      // Bunch up and move off ahead of the dog.
      if (s.state !== 'flee') s.state = 'flee';
      const m = s.mother;
      const tight = m ? { gx: m.tight.gx + 8, depth: m.tight.depth + 0.02 } : s.tight;
      s.spot = { gx: this.centre.gx + tight.gx, depth: this.centre.depth + tight.depth };
    } else if (s.state === 'flee') {
      // The dog's gone: stay bunched a while, then drift apart one by one.
      s.state = 'graze';
      s.timer = r(4, 60) * (s.mother ? 0.3 : 1);
    }
    if (resting && !herding) {
      if (s.state !== 'lie') {
        s.state = 'lie';
        s.timer = r(30, 90);
      }
    } else if (s.state === 'lie') {
      s.state = 'graze';
      s.timer = r(1, 10);
    }

    if (s.state === 'graze' && s.timer <= 0) {
      s.timer = r(6, 20);
      const m = s.mother;
      if (m) {
        // A lamb trots after its mother, and noses about close to her.
        const target = m.state === 'walk' ? m.spot : { gx: m.walker.gx, depth: m.walker.depth };
        s.spot = { gx: target.gx + r(-16, 16), depth: target.depth + r(-0.05, 0.05) };
        s.timer = r(2, 7);
        if (w.distanceTo(s.spot.gx, s.spot.depth) > 6) s.state = 'walk';
      } else {
        // Wander off to a fresh patch, more surely when it's strayed from the others or is crowded.
        const here = { gx: w.gx, depth: w.depth };
        const others = this.sheep.filter((o) => o !== s && !o.mother).map((o) => ({ gx: o.walker.gx, depth: o.walker.depth }));
        const crowded = screenGap(this.plane, here, others) < LOOSE.apart;
        const strayed = Math.abs(w.gx - this.centre.gx) > LOOSE.gx * 1.2 || Math.abs(w.depth - this.centre.depth) > LOOSE.depth * 1.2;
        if (crowded || strayed || Math.random() < 0.45) {
          const spot = this.pickSpot(s, strayed ? Infinity : STROLL, LOOSE);
          if (spot) {
            s.spot = spot;
            s.state = 'walk';
          }
        }
      }
    }

    if (s.state === 'flee' || s.state === 'walk') {
      w.steering = { kind: 'seek', ...s.spot };
      const arrived = w.distanceTo(s.spot.gx, s.spot.depth) < 4;
      w.speed = arrived ? 0 : s.state === 'flee' ? (s.mother ? 38 : 34) : s.mother ? 18 : 10;
      if (s.state === 'walk' && (arrived || s.timer < -40)) {
        s.state = 'graze';
        s.timer = s.mother ? r(1, 4) : r(8, 26);
      }
    } else w.speed = 0;
    w.update(dt);
    s.stride += w.speed * w.point.scale * dt;
  }

  private draw(s: Sheep, tint: number): void {
    const p = s.walker.point;
    const h = evenSize(SHEEP_HEIGHT * s.size * p.scale, 4);
    const pose: SheepPose = s.state === 'lie' ? 'lie' : s.walker.speed > 0 ? SHEEP_WALK[Math.floor(s.stride / (s.mother ? 1.8 : 2.5)) % 4] : Math.floor(s.timer * 1.5) % 4 === 0 ? 'stand' : Math.floor(s.timer * 2) % 2 === 0 ? 'graze-1' : 'graze-2';
    s.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawSheepSized(pose, h));
    s.sprite.scale.x = s.walker.facing;
    s.sprite.position.set(Math.round(p.x), Math.round(p.y));
    s.sprite.zIndex = p.y;
    s.sprite.tint = tint;
  }
}

type DogState = 'away' | 'outrun' | 'crouch' | 'sit' | 'lie' | 'chase' | 'leave';

/** The dog's outrun round the flock's middle: across (ground px) and in depth. */
const OUTRUN = { gx: 170, depth: 0.5 };

/**
 * The sheepdog: out in a wide, fast arc round the flock with a boof or two,
 * a crouching stalk, then it sits to watch its work and lies down, head on
 * its paws, before trotting off. A fox near the flock gets chased off.
 */
export class Sheepdog {
  private walker: GroundWalker | null = null;
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private state: DogState = 'away';
  private timer = r(60, 180);
  private angle = 0;
  private stride = 0;
  private spin: 1 | -1 = 1;
  private quarry: (() => GroundSpot | null) | null = null;

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
    private readonly flockCentre: () => { gx: number; depth: number },
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
    private readonly onBoof: () => void = () => {},
  ) {
    this.sprite.visible = false;
    container.addChild(this.sprite);
  }

  get herding(): boolean {
    return this.state === 'outrun' || this.state === 'crouch';
  }

  get position(): { gx: number; depth: number } | null {
    return this.walker ? { gx: this.walker.gx, depth: this.walker.depth } : null;
  }

  get chasing(): boolean {
    return this.state === 'chase';
  }

  summon(): void {
    this.timer = 0;
  }

  /** See off something prowling near the flock: out from the farm if it's away, then flat out at it. */
  chase(target: () => GroundSpot | null): void {
    if (this.state === 'chase' || this.state === 'leave') return;
    if (this.state === 'away') this.start(target()?.gx);
    this.quarry = target;
    this.state = 'chase';
    this.timer = 0;
    this.boof(0.9);
  }

  private boof(gain: number): void {
    const w = this.walker;
    if (!w) return;
    this.sound('dog-boof', this.viewport.worldXToStereo(w.point.x), gain * (0.45 + 0.4 * Math.min(1, w.point.scale)));
    this.onBoof();
  }

  update(dt: number, env: Environment): void {
    if (this.state === 'away') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(150, 360);
        if (sheepdogTime(env.lighting.hours)) this.start();
      }
      return;
    }
    const w = this.walker!;
    this.timer += dt;
    const c = this.flockCentre();
    if (this.state === 'outrun') {
      // Round the flock in a wide arc, keeping it between itself and the window.
      this.angle += this.spin * dt * 0.55;
      // An ellipse on the ground that reads as a wide loop on screen, outside the bunched flock.
      w.steering = { kind: 'seek', gx: c.gx + Math.cos(this.angle) * OUTRUN.gx, depth: c.depth + Math.sin(this.angle) * OUTRUN.depth };
      w.speed = 85;
      // A boof to move them on.
      if (chance(2.5, dt)) this.boof(0.7);
      if (this.timer > 14) {
        this.state = 'crouch';
        this.timer = 0;
      }
    } else if (this.state === 'crouch') {
      w.speed = 0;
      if (this.timer > 6) {
        // Job done: it sits up to watch them settle.
        this.state = 'sit';
        this.timer = -r(6, 14);
      }
    } else if (this.state === 'sit' || this.state === 'lie') {
      w.speed = 0;
      if (this.timer > 0) {
        if (this.state === 'sit' && Math.random() < 0.7) {
          // Then lies down, head on its paws.
          this.state = 'lie';
          this.timer = -r(8, 22);
        } else this.leave();
      }
    } else if (this.state === 'chase') {
      const q = this.quarry?.() ?? null;
      if (!q || this.timer > 14 || groundDistance(q, { gx: w.gx, depth: w.depth }) < 40) {
        // Seen off (or lost): it stands its ground a moment, watching where it went.
        this.quarry = null;
        this.state = 'sit';
        this.timer = -r(4, 8);
      } else {
        w.steering = { kind: 'seek', gx: q.gx, depth: q.depth };
        w.speed = 95;
        if (chance(6, dt)) this.boof(0.9);
      }
    } else {
      w.speed = 45;
      if (w.gone) {
        // Back to the farm for a good while before it's sent out again.
        this.state = 'away';
        this.timer = r(300, 720);
        this.walker = null;
        this.sprite.visible = false;
        return;
      }
    }
    w.update(dt);
    this.stride += w.speed * w.point.scale * dt;
    const p = w.point;
    const h = evenSize(DOG_HEIGHT * p.scale, 6);
    const settled = this.state === 'crouch' || this.state === 'sit' || this.state === 'lie';
    const pose: DogPose = this.state === 'crouch' || this.state === 'sit' || this.state === 'lie'
      ? this.state
      : this.state === 'leave'
        ? Math.floor(this.stride / 4) % 2 === 0
          ? 'trot-1'
          : 'trot-2'
        : Math.floor(this.stride / 5) % 2 === 0
          ? 'run-1'
          : 'run-2';
    this.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawDogSized(pose, h));
    // Crouched, sitting or lying, it faces the flock.
    this.sprite.scale.x = settled ? (c.gx > w.gx ? 1 : -1) : w.facing;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y));
    this.sprite.zIndex = p.y;
    this.sprite.tint = env.lighting.ambient;
  }

  private leave(): void {
    const w = this.walker!;
    this.state = 'leave';
    this.timer = 0;
    w.steering = { kind: 'exit', side: w.gx < 0 ? -1 : 1 };
  }

  /** Out onto the field from one side (the side nearest `nearGx`, if given). */
  private start(nearGx?: number): void {
    const side = nearGx !== undefined ? (nearGx < 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
    const depth = r(1.8, 2.8);
    const w = new GroundWalker(this.plane, { ...this.area, halfWidth: (d) => this.plane.halfWidthAt(d) + 60 * d }, side * (this.plane.halfWidthAt(depth) + 30 * depth), depth, side > 0 ? Math.PI : 0);
    w.obstacles = this.obstacles;
    this.walker = w;
    this.state = 'outrun';
    this.timer = 0;
    const c = this.flockCentre();
    this.angle = Math.atan2((depth - c.depth) / OUTRUN.depth, (w.gx - c.gx) / OUTRUN.gx);
    this.spin = Math.random() < 0.5 ? 1 : -1;
    this.sprite.visible = true;
  }
}

// --- The horse in its paddock ---------------------------------------------------------

/** The paddock: ground rectangle beyond the pasture on the left. */
export const PADDOCK = { gx0: -820, gx1: -520, depth0: 3.8, depth1: 5.0 };

type HorseState = 'graze' | 'walk' | 'stand' | 'canter';

/**
 * A bay horse in a railed paddock across the field: grazing, ambling to a
 * fresh patch, standing to swish its tail at the flies (all the more on a
 * warm, still afternoon), whinnying now and then, and cantering a lap of
 * its paddock when thunder cracks overhead.
 */
export class HorsePaddock {
  readonly back = new Graphics();
  readonly front = new Graphics();
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private gx = -680;
  private depth = 4.3;
  private target = { gx: -680, depth: 4.3 };
  private state: HorseState = 'graze';
  private timer = r(4, 10);
  private stride = 0;
  private dir: 1 | -1 = 1;
  private whinnyTimer = r(40, 120);
  /** Corners of the paddock it canters round when spooked. */
  private lap: Array<{ gx: number; depth: number }> = [];

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    container.addChild(this.back, this.sprite, this.front);
    this.drawFence();
  }

  /** Rails and posts round the paddock: the back and sides behind the horse, the front rail before it. */
  private drawFence(): void {
    const { gx0, gx1, depth0, depth1 } = PADDOCK;
    const rail = 0x9a8262;
    const shade = 0x5a4a38;
    const post = (g: Graphics, gx: number, depth: number) => {
      const p = this.plane.project(gx, depth);
      const h = Math.max(3, Math.round(36 * p.scale));
      g.rect(Math.round(p.x), Math.round(p.y) - h, 1, h).fill(shade);
    };
    const railLine = (g: Graphics, a: { gx: number; depth: number }, b: { gx: number; depth: number }) => {
      for (const hgt of [18, 32]) {
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const gx = a.gx + (b.gx - a.gx) * t;
          const depth = a.depth + (b.depth - a.depth) * t;
          const p = this.plane.project(gx, depth);
          const y = Math.round(p.y - hgt * p.scale);
          g.rect(Math.round(p.x), y, 1, 1).fill(rail);
        }
      }
    };
    // Back and sides.
    railLine(this.back, { gx: gx0, depth: depth1 }, { gx: gx1, depth: depth1 });
    railLine(this.back, { gx: gx0, depth: depth0 }, { gx: gx0, depth: depth1 });
    railLine(this.back, { gx: gx1, depth: depth0 }, { gx: gx1, depth: depth1 });
    for (let gx = gx0; gx <= gx1; gx += 75) post(this.back, gx, depth1);
    for (let d = depth0; d <= depth1; d += 0.3) {
      post(this.back, gx0, d);
      post(this.back, gx1, d);
    }
    // Front.
    railLine(this.front, { gx: gx0, depth: depth0 }, { gx: gx1, depth: depth0 });
    for (let gx = gx0; gx <= gx1; gx += 75) post(this.front, gx, depth0);
    this.back.zIndex = this.plane.project(0, depth1).y - 0.5;
    this.front.zIndex = this.plane.project(0, depth0).y + 0.5;
  }

  /** Spooked (a crack of thunder): off round the paddock at a canter, with a whinny. */
  spook(): void {
    const { gx0, gx1, depth0, depth1 } = PADDOCK;
    const corners = [
      { gx: gx0 + 30, depth: depth0 + 0.15 },
      { gx: gx1 - 30, depth: depth0 + 0.15 },
      { gx: gx1 - 30, depth: depth1 - 0.15 },
      { gx: gx0 + 30, depth: depth1 - 0.15 },
    ];
    // Round from the nearest corner, one way or the other, a lap and a bit.
    const start = corners.reduce((best, c, i) => (Math.abs(c.gx - this.gx) + Math.abs(c.depth - this.depth) * FOCAL < Math.abs(corners[best].gx - this.gx) + Math.abs(corners[best].depth - this.depth) * FOCAL ? i : best), 0);
    const way = Math.random() < 0.5 ? 1 : 3;
    this.lap = Array.from({ length: 5 + Math.floor(Math.random() * 2) }, (_, k) => corners[(start + way * (k + 1)) % 4]);
    this.state = 'canter';
    this.whinnyTimer = r(0.2, 0.8);
  }

  update(dt: number, env: Environment): void {
    const night = cowsResting(env.lighting.hours);
    const flies = fliesOut(env.lighting.hours, env.weather.wind, env.weather.cloudCover, env.weather.precipitation);
    this.timer -= dt;
    if (this.state === 'canter') {
      const target = this.lap[0];
      const dx = target.gx - this.gx;
      const dz = (target.depth - this.depth) * FOCAL;
      const d = Math.hypot(dx, dz);
      const s = Math.min(d, 42 * dt);
      this.gx += (dx / (d || 1)) * s;
      this.depth += ((dz / (d || 1)) * s) / FOCAL;
      this.stride += s * this.plane.project(this.gx, this.depth).scale;
      if (Math.abs(dx) > 1) this.dir = dx > 0 ? 1 : -1;
      if (d < 3) {
        this.lap.shift();
        if (this.lap.length === 0) {
          // Blowing, it stands a while before it settles.
          this.state = 'stand';
          this.timer = r(6, 12);
        }
      }
    } else if (this.state === 'walk') {
      const dx = this.target.gx - this.gx;
      const dz = (this.target.depth - this.depth) * FOCAL;
      const d = Math.hypot(dx, dz);
      if (d < 2) {
        this.state = 'graze';
        this.timer = r(6, 16);
      } else {
        const s = Math.min(d, 9 * dt);
        this.gx += (dx / d) * s;
        this.depth += ((dz / d) * s) / FOCAL;
        this.stride += s * this.plane.project(this.gx, this.depth).scale;
        if (Math.abs(dx) > 1) this.dir = dx > 0 ? 1 : -1;
      }
    } else if (this.timer <= 0) {
      this.timer = r(5, 14);
      const roll = Math.random();
      if (night) this.state = 'stand';
      else if (roll < 0.4) {
        this.state = 'walk';
        this.target = { gx: r(PADDOCK.gx0 + 30, PADDOCK.gx1 - 30), depth: r(PADDOCK.depth0 + 0.12, PADDOCK.depth1 - 0.12) };
      } else this.state = roll < 0.8 ? 'graze' : 'stand';
    }
    this.whinnyTimer -= dt;
    const p = this.plane.project(this.gx, this.depth);
    if (this.whinnyTimer <= 0) {
      this.whinnyTimer = r(60, 180);
      if (!night || this.state === 'canter') this.sound('horse-whinny', this.viewport.worldXToStereo(p.x), 0.75);
    }
    const h = evenSize(HORSE_HEIGHT * p.scale, 6);
    let pose: HorsePose;
    // Flies about: the tail goes more often, even with its head down grazing.
    const swishEvery = flies > 0.3 ? 2 : 5;
    if (this.state === 'canter') pose = HORSE_WALK[Math.floor(this.stride / 1.6) % 4];
    else if (this.state === 'walk') pose = HORSE_WALK[Math.floor(this.stride / 2.5) % 4];
    else if (this.state === 'graze') pose = flies > 0.3 && Math.floor(env.time * 1.1) % 4 === 0 ? 'swish' : Math.floor(env.time * 0.8) % 2 === 0 ? 'graze-1' : 'graze-2';
    else pose = !night && Math.floor(env.time * 1.3) % swishEvery === 0 ? 'swish' : 'stand';
    this.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawHorseSized(pose, h));
    this.sprite.scale.x = this.dir;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y));
    this.sprite.zIndex = p.y;
    const tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.12);
    this.sprite.tint = tint;
    this.back.tint = tint;
    this.front.tint = tint;
  }
}
